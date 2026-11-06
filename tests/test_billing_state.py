"""Durable billing state: restart survival, corruption handling, concurrency."""

from __future__ import annotations

import http.client
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from sg16.config import BrainConfig
from sg16.server.app import build_server
from sg16.server.billing_state import BillingStateError, BillingStateStore

from .test_fixes import WHSEC, _sign_webhook, _success_event

BILLING_SECRET = "a-stable-test-billing-secret-that-is-long-enough"


def _config() -> BrainConfig:
    raw = json.loads(json.dumps(BrainConfig.default().raw))
    raw.setdefault("billing", {})["secret"] = BILLING_SECRET
    raw["billing"]["dodo"] = {
        "test_mode": True,
        "webhook_secret": WHSEC,
        "api_key": "ddo_key_configured",
        "product_ids": {"week": "pds_test_week"},
    }
    return BrainConfig(raw=raw)


class _Host:
    """A real server on an ephemeral port, backed by one state file."""

    def __init__(self, path: Path) -> None:
        self.server = build_server(_config(), host="127.0.0.1", port=0, billing_state_path=path)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def request(self, method: str, path: str, body=None, headers=None):
        conn = http.client.HTTPConnection(*self.server.server_address, timeout=10)
        if isinstance(body, dict):
            body = json.dumps(body).encode("utf-8")
            headers = {"Content-Type": "application/json", **(headers or {})}
        conn.request(method, path, body=body, headers=headers or {})
        response = conn.getresponse()
        raw = response.read()
        conn.close()
        return response.status, raw

    def stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()


class _TmpCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.path = Path(self._tmp.name) / "state" / "billing_state.json"


class RestartSurvivalTests(_TmpCase):
    def test_paid_pass_survives_a_restart(self) -> None:
        first = _Host(self.path)
        first.server.dodo_pending["sess_test_1"] = {
            "pass": "week", "region": "Malaysia", "session_id": "sess_test_1",
            "status": "pending", "opened_at": int(time.time()),
        }
        body, headers = _sign_webhook(WHSEC, _success_event())
        status, _ = first.request("POST", "/api/dodo/webhook", body, headers)
        self.assertEqual(status, 200)
        status, raw = first.request("POST", "/api/dodo/confirm", {"session_id": "sess_test_1"})
        record = json.loads(raw)["record"]
        first.stop()

        second = _Host(self.path)
        self.addCleanup(second.stop)
        # the paid record is still there and still verifies
        status, raw = second.request("POST", "/api/dodo/confirm", {"session_id": "sess_test_1"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)["record"]["token"], record["token"])
        status, raw = second.request("POST", "/api/pass/verify", {"token": record["token"]})
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(raw)["valid"])
        # the replayed webhook is still recognised as a duplicate
        status, raw = second.request("POST", "/api/dodo/webhook", body, headers)
        self.assertTrue(json.loads(raw)["duplicate"])

    def test_nested_status_change_is_saved(self) -> None:
        # a status flip on an aliased checkout (stored under two keys) must be
        # persisted and must reload as ONE shared object
        host = _Host(self.path)
        pending = {
            "pass": "week", "region": None, "session_id": "ref-1",
            "gateway_session_id": "gw-1", "status": "creating", "opened_at": int(time.time()),
        }
        host.server.dodo_pending["ref-1"] = pending
        host.server.dodo_pending["gw-1"] = pending
        with host.server.dodo_lock:
            pending["status"] = "pending"
        host.server.persist_billing()
        host.stop()

        reloaded = _Host(self.path)
        self.addCleanup(reloaded.stop)
        self.assertIs(reloaded.server.dodo_pending["ref-1"], reloaded.server.dodo_pending["gw-1"])
        self.assertEqual(reloaded.server.dodo_pending["gw-1"]["status"], "pending")

    def test_state_file_is_owner_only(self) -> None:
        host = _Host(self.path)
        self.addCleanup(host.stop)
        self.assertTrue(host.server.persist_billing())
        self.assertTrue(self.path.exists())
        if os.name == "posix":
            self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def test_billing_manifest_describes_the_real_storage(self) -> None:
        host = _Host(self.path)
        self.addCleanup(host.stop)
        status, raw = host.request("GET", "/api/billing")
        gateway = json.loads(raw)["gateway"]
        self.assertIn("durable", gateway["storage"])
        self.assertNotIn("process memory", gateway["storage"])


class LoadPruningTests(_TmpCase):
    def test_expired_passes_and_old_webhook_ids_are_pruned(self) -> None:
        now = int(time.time())
        store = BillingStateStore(self.path)
        passes = {
            "live": {"expires_at": now + 3600, "pass": "day"},
            "dead": {"expires_at": now - 5, "pass": "day"},
        }
        pending = {
            "paid-live": {"session_id": "paid-live", "status": "paid", "record_token": "live", "opened_at": now},
            "paid-dead": {"session_id": "paid-dead", "status": "paid", "record_token": "dead", "opened_at": now},
            "stale": {"session_id": "stale", "status": "pending", "opened_at": now - 3 * 24 * 3600},
            "fresh": {"session_id": "fresh", "status": "pending", "opened_at": now},
        }
        seen = {"new": now, "old": now - 30 * 24 * 3600}
        seq, text = store.snapshot(passes, pending, seen)
        self.assertTrue(store.write(seq, text))

        loaded = BillingStateStore(self.path).load()
        self.assertEqual(set(loaded["passes"]), {"live"})
        self.assertEqual(set(loaded["pending"]), {"paid-live", "fresh"})
        self.assertEqual(set(loaded["seen_webhooks"]), {"new"})


class CorruptFileTests(_TmpCase):
    def _write_raw(self, data: bytes) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_bytes(data)

    def test_corrupt_file_is_moved_aside_and_logged_not_overwritten(self) -> None:
        self._write_raw(b'{"version": 1, "passes": {"abc": ')  # truncated write
        with self.assertLogs("sg16.billing_state", level="ERROR") as logs:
            host = _Host(self.path)
        self.addCleanup(host.stop)
        self.assertIn("moved to", logs.output[0])
        corrupt = self.path.with_name(self.path.name + ".corrupt")
        self.assertEqual(corrupt.read_bytes(), b'{"version": 1, "passes": {"abc": ')
        self.assertFalse(self.path.exists())  # nothing silently rewritten yet
        self.assertEqual(host.server.passes, {})
        # a later save writes a fresh file and leaves the evidence alone
        self.assertTrue(host.server.persist_billing())
        self.assertTrue(self.path.exists())
        self.assertEqual(corrupt.read_bytes(), b'{"version": 1, "passes": {"abc": ')

    def test_wrong_structure_counts_as_corrupt(self) -> None:
        self._write_raw(json.dumps({"version": 99, "passes": []}).encode())
        with self.assertLogs("sg16.billing_state", level="ERROR"):
            loaded = BillingStateStore(self.path).load()
        self.assertEqual(loaded["passes"], {})
        self.assertTrue(self.path.with_name(self.path.name + ".corrupt").exists())

    def test_second_corrupt_file_does_not_clobber_the_first(self) -> None:
        corrupt = self.path.with_name(self.path.name + ".corrupt")
        self._write_raw(b"first")
        with self.assertLogs("sg16.billing_state", level="ERROR"):
            BillingStateStore(self.path).load()
        self._write_raw(b"second")
        with self.assertLogs("sg16.billing_state", level="ERROR"):
            BillingStateStore(self.path).load()
        self.assertEqual(corrupt.read_bytes(), b"first")
        others = [p for p in self.path.parent.iterdir() if p.name.endswith(".corrupt") and p != corrupt]
        self.assertEqual([p.read_bytes() for p in others], [b"second"])

    def test_refuses_to_start_if_the_bad_file_cannot_be_moved(self) -> None:
        self._write_raw(b"garbage")
        with patch("sg16.server.billing_state.os.replace", side_effect=PermissionError("read-only")):
            with self.assertLogs("sg16.billing_state", level="CRITICAL"):
                with self.assertRaises(BillingStateError):
                    BillingStateStore(self.path).load()
        self.assertEqual(self.path.read_bytes(), b"garbage")

    def test_failed_save_keeps_the_old_file_and_is_logged(self) -> None:
        store = BillingStateStore(self.path)
        good = {"k": {"expires_at": time.time() + 1000}}
        seq, text = store.snapshot(good, {}, {})
        self.assertTrue(store.write(seq, text))
        before = self.path.read_bytes()
        seq, text = store.snapshot({}, {}, {})
        with patch("sg16.server.billing_state.os.fsync", side_effect=OSError("disk full")):
            with self.assertLogs("sg16.billing_state", level="ERROR"):
                self.assertFalse(store.write(seq, text))
        self.assertEqual(self.path.read_bytes(), before)
        self.assertIn("disk full", store.last_error or "")
        self.assertEqual([p.name for p in self.path.parent.iterdir()], [self.path.name])  # no temp left


class ConcurrencyTests(_TmpCase):
    def test_concurrent_mutations_leave_a_complete_valid_file(self) -> None:
        host = _Host(self.path)
        self.addCleanup(host.stop)
        server = host.server
        expires = int(time.time()) + 3600
        errors: list[BaseException] = []

        def worker(n: int) -> None:
            try:
                for i in range(25):
                    token = f"{n:02d}{i:02d}".ljust(64, "a")
                    with server.dodo_lock:
                        server.passes[token] = {"pass": "day", "expires_at": expires, "token": token}
                    server.persist_billing()
            except BaseException as exc:  # pragma: no cover - failure path
                errors.append(exc)

        threads = [threading.Thread(target=worker, args=(n,)) for n in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(errors, [])

        # the file on disk parses and holds every pass: no torn or stale write won
        on_disk = json.loads(self.path.read_text("utf-8"))
        self.assertEqual(len(on_disk["passes"]), 8 * 25)
        self.assertEqual(sorted(on_disk["passes"]), sorted(server.passes))
        self.assertEqual([p.name for p in self.path.parent.iterdir()], [self.path.name])

    def test_older_snapshot_never_overwrites_a_newer_one(self) -> None:
        store = BillingStateStore(self.path)
        old_seq, old_text = store.snapshot({"a": {"expires_at": 1}}, {}, {})
        new_seq, new_text = store.snapshot({"b": {"expires_at": 2}}, {}, {})
        self.assertTrue(store.write(new_seq, new_text))
        self.assertTrue(store.write(old_seq, old_text))  # late arrival is dropped
        self.assertEqual(set(json.loads(self.path.read_text("utf-8"))["passes"]), {"b"})


class LegacyFormatTests(_TmpCase):
    """The host's earlier persistence code wrote {passes, dodo_pending, dodo_seen_webhooks}. A loader
    that rejected it would silently drop every issued pass on the next restart."""

    def _record(self, token: str, pass_id: str = "day", ttl: int = 3600) -> dict:
        return {"pass": pass_id, "token": token, "expires_at": int(time.time()) + ttl, "activated_at": int(time.time())}

    def _legacy(self, **over) -> dict:
        now = int(time.time())
        tok = "a" * 64
        base = {
            "passes": {tok: self._record(tok)},
            "dodo_pending": {
                "ref-1": {"pass": "week", "session_id": "ref-1", "gateway_session_id": "gw-1", "status": "pending", "opened_at": now},
                "gw-1": {"pass": "week", "session_id": "ref-1", "gateway_session_id": "gw-1", "status": "pending", "opened_at": now},
            },
            "dodo_seen_webhooks": ["msg_1"],
        }
        base.update(over)
        return base

    def _write(self, path: Path, data) -> bytes:
        path.parent.mkdir(parents=True, exist_ok=True)
        raw = data if isinstance(data, bytes) else json.dumps(data).encode()
        path.write_bytes(raw)
        return raw

    def test_old_format_main_file_is_converted_not_quarantined(self) -> None:
        original = self._write(self.path, self._legacy())
        with self.assertLogs("sg16.billing_state", level="WARNING"):
            host = _Host(self.path)
        self.addCleanup(host.stop)
        s = host.server
        self.assertIn("a" * 64, s.passes)
        self.assertIn("msg_1", s.dodo_seen_webhooks)
        self.assertIs(s.dodo_pending["ref-1"], s.dodo_pending["gw-1"])  # the saved copies become one shared checkout
        self.assertEqual(self.path.with_name(self.path.name + ".legacy-backup").read_bytes(), original)
        self.assertFalse(self.path.with_name(self.path.name + ".corrupt").exists())
        rewritten = json.loads(self.path.read_text("utf-8"))  # saved in the current format right away
        self.assertEqual(rewritten["version"], 1)
        self.assertIn("a" * 64, rewritten["passes"])

    def test_a_legacy_pass_still_verifies_after_the_restart(self) -> None:
        from sg16 import billing

        record = billing.issue_record("day", None, BILLING_SECRET)
        self._write(self.path, {"passes": {record["token"]: record}, "dodo_pending": {}, "dodo_seen_webhooks": []})
        with self.assertLogs("sg16.billing_state", level="WARNING"):
            host = _Host(self.path)
        self.addCleanup(host.stop)
        status, raw = host.request("POST", "/api/pass/verify", {"token": record["token"]})
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(raw)["valid"])

    def test_expired_legacy_passes_are_pruned(self) -> None:
        live, dead = "b" * 64, "c" * 64
        self._write(self.path, self._legacy(passes={live: self._record(live), dead: self._record(dead, ttl=-10)}))
        with self.assertLogs("sg16.billing_state", level="WARNING"):
            loaded = BillingStateStore(self.path).load()
        self.assertEqual(set(loaded["passes"]), {live})

    def test_a_file_an_earlier_loader_moved_aside_is_recovered_once_and_left_untouched(self) -> None:
        a, b = "a" * 64, "b" * 64
        quarantined = self.path.with_name(self.path.name + ".corrupt")
        original = self._write(quarantined, self._legacy(passes={a: self._record(a), b: self._record(b)}))
        self.assertFalse(self.path.exists())

        with self.assertLogs("sg16.billing_state", level="WARNING") as logs:
            first = _Host(self.path)
        self.assertTrue(any("recovered old-format billing data" in m for m in logs.output))
        self.assertEqual(set(first.server.passes), {a, b})
        self.assertTrue(json.loads(self.path.read_text("utf-8"))["legacy_merged"])  # recorded, so it runs only once
        self.assertEqual(quarantined.read_bytes(), original)  # the original is never modified or deleted
        # an operator-visible change after recovery: one pass is removed (e.g. it failed verification)
        with first.server.dodo_lock:
            first.server.passes.pop(b)
        first.server.persist_billing()
        first.stop()

        second = _Host(self.path)
        self.addCleanup(second.stop)
        self.assertEqual(set(second.server.passes), {a})  # b is NOT resurrected from the old file
        self.assertEqual(quarantined.read_bytes(), original)

    def test_recovery_never_overrides_newer_state(self) -> None:
        shared, only_old = "d" * 64, "e" * 64
        store = BillingStateStore(self.path)
        newer = {"pass": "week", "token": shared, "expires_at": int(time.time()) + 7200}
        seq, text = store.snapshot({shared: newer}, {}, {})
        store.write(seq, text)
        self._write(
            self.path.with_name(self.path.name + ".corrupt"),
            self._legacy(passes={shared: self._record(shared, "day"), only_old: self._record(only_old)}),
        )
        with self.assertLogs("sg16.billing_state", level="WARNING"):
            loaded = BillingStateStore(self.path).load()
        self.assertEqual(loaded["passes"][shared]["pass"], "week")  # the current file wins
        self.assertIn(only_old, loaded["passes"])  # what only the old file had is added

    def test_a_genuinely_corrupt_quarantined_file_is_ignored(self) -> None:
        self._write(self.path.with_name(self.path.name + ".corrupt"), b'{"passes": {"x": ')
        store = BillingStateStore(self.path)
        loaded = store.load()
        self.assertEqual(loaded["passes"], {})
        self.assertFalse(store.needs_save)

    def test_unrelated_wrong_structure_is_still_quarantined_not_converted(self) -> None:
        self._write(self.path, {"version": 99, "passes": {}})
        with self.assertLogs("sg16.billing_state", level="ERROR"):
            BillingStateStore(self.path).load()
        self.assertTrue(self.path.with_name(self.path.name + ".corrupt").exists())


class DodoUserAgentTests(unittest.TestCase):
    def test_gateway_requests_identify_the_host_honestly(self) -> None:
        from sg16.server.dodo import USER_AGENT, DodoClient

        seen = {}

        class _Resp:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def read(self):
                return b'{"session_id": "s", "checkout_url": "https://x.test/c"}'

        def fake_urlopen(request, timeout=None):
            seen.update({k.lower(): v for k, v in request.header_items()})
            return _Resp()

        with patch("sg16.server.dodo.urllib.request.urlopen", fake_urlopen):
            DodoClient("key").create_checkout({"product_cart": []})
        self.assertEqual(seen["user-agent"], "SG16-Brain/1.0 (+https://mistralbrain.com)")
        self.assertEqual(USER_AGENT, seen["user-agent"])


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
