"""SG16 BRAIN - durable billing state for the HTTP host.

Issued passes, in-flight Dodo checkouts and webhook replay markers survive a
restart by living in one JSON file.  Pass records are bearer credentials, so
the file is created ``0600`` and every write is atomic: the new content goes to
a temp file in the same directory, is fsynced, then renamed over the old file.

Rules this module keeps:

* serialisation happens while the caller's lock is held, on a private copy of
  the data, so a half-mutated structure is never written;
* a file that cannot be parsed is renamed to ``<name>.corrupt`` (and logged) -
  the host never silently starts empty and then overwrites it;
* if even that rename fails the host refuses to start;
* a failed save is logged and reported through :attr:`last_error`; it never
  raises into the request that triggered it.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import time
from pathlib import Path

__all__ = ["BillingStateStore", "BillingStateError", "SCHEMA_VERSION"]

SCHEMA_VERSION = 1
log = logging.getLogger("sg16.billing_state")

#: unpaid checkouts older than this can no longer be confirmed (see the webhook
#: handler's 24h window) and are dropped on load
PENDING_MAX_AGE_SECONDS = 24 * 3600
#: webhook ids only matter inside the signature replay window (5 minutes); keep
#: them far longer than that, then forget them
WEBHOOK_ID_MAX_AGE_SECONDS = 7 * 24 * 3600


class BillingStateError(RuntimeError):
    """The state file is unusable and could not be moved aside."""


def _quarantine(path: Path, reason: str) -> None:
    target = path.with_name(path.name + ".corrupt")
    if target.exists():
        target = path.with_name(f"{path.name}.{int(time.time())}.corrupt")
    try:
        os.replace(path, target)
    except OSError as exc:
        log.critical("billing state %s is unusable (%s) and cannot be moved aside: %s", path, reason, exc)
        raise BillingStateError(
            f"billing state file {path} is unusable ({reason}) and could not be renamed; "
            "refusing to start rather than overwrite it"
        ) from exc
    log.error("billing state %s is unusable (%s); moved to %s and starting empty", path, reason, target)


def _is_legacy(data: object) -> bool:
    """The format written by the host's earlier persistence code (before schema versions):
    ``{"passes": {...}, "dodo_pending": {...}, "dodo_seen_webhooks": [...]}``."""
    return (
        isinstance(data, dict)
        and "version" not in data
        and isinstance(data.get("passes"), dict)
        and isinstance(data.get("dodo_pending", {}), dict)
    )


def _from_legacy(data: dict, now: float) -> dict:
    """Legacy file -> the intermediate form (see ``_from_current``)."""
    passes = {
        str(k): v for k, v in data["passes"].items()
        if isinstance(v, dict) and isinstance(v.get("expires_at"), (int, float))
    }
    primaries: dict[str, dict] = {}
    aliases: dict[str, str] = {}
    # the old code saved each checkout once per key, so aliases arrive as separate copies
    for key, entry in (data.get("dodo_pending") or {}).items():
        if not isinstance(entry, dict):
            continue
        sid = str(entry.get("session_id") or key)
        if sid == str(key):
            primaries[str(key)] = entry
        else:
            aliases[str(key)] = sid
            primaries.setdefault(sid, entry)
    seen_raw = data.get("dodo_seen_webhooks") or []
    seen = {str(w): int(now) for w in seen_raw} if isinstance(seen_raw, (list, tuple)) else {}
    return {"passes": passes, "pending": primaries, "aliases": aliases, "seen": seen}


def _from_current(data: dict) -> dict:
    """A schema-1 file -> the intermediate form. Raises ValueError when malformed."""
    if (
        not isinstance(data, dict)
        or data.get("version") != SCHEMA_VERSION
        or not isinstance(data.get("passes"), dict)
        or not isinstance(data.get("pending"), dict)
        or not isinstance(data.get("aliases", {}), dict)
        or not isinstance(data.get("seen_webhooks"), dict)
    ):
        raise ValueError("unexpected structure or version")
    passes = {
        str(k): v for k, v in data["passes"].items()
        if isinstance(v, dict) and isinstance(v.get("expires_at"), (int, float))
    }
    if len(passes) != len(data["passes"]):
        raise ValueError("malformed pass record")
    pending = {str(k): v for k, v in data["pending"].items()}
    if not all(isinstance(v, dict) for v in pending.values()):
        raise ValueError("malformed pending checkout")
    return {
        "passes": passes,
        "pending": pending,
        "aliases": {str(k): str(v) for k, v in data.get("aliases", {}).items()},
        "seen": {str(k): int(v) for k, v in data["seen_webhooks"].items()},
    }


def _merge(into: dict, other: dict) -> None:
    """Add what ``other`` has and ``into`` lacks; ``into`` always wins."""
    for part in ("passes", "pending", "aliases", "seen"):
        for k, v in other[part].items():
            into[part].setdefault(k, v)


class BillingStateStore:
    def __init__(self, path: str | os.PathLike) -> None:
        self.path = Path(path)
        self._write_lock = threading.Lock()
        self._seq = 0          # snapshots taken
        self._written_seq = 0  # newest snapshot already on disk
        self.last_error: str | None = None
        self.saves = 0
        #: set by load() when what it recovered should be written out in the current format
        self.needs_save = False
        #: recorded in the file once old-format data has been folded in, so it happens only once
        self.legacy_merged = False

    # ------------------------------------------------------------------ load
    def load(self, now: float | None = None) -> dict:
        """Read, validate and prune the state file.

        Returns ``{"passes", "pending", "seen_webhooks"}`` (empty when there is
        no file).  ``pending`` aliases are re-linked to one shared dict so a
        status change through either key is seen through both.

        Two recoveries for data written by the host's earlier persistence code
        (a different, unversioned format):
          * a main file in that format is converted (the original is kept as
            ``<name>.legacy-backup``);
          * if an earlier build of this loader moved such a file aside as
            ``<name>.corrupt``, its contents are folded in once (the file itself
            is never modified or deleted).
        """
        now = time.time() if now is None else now
        state = {"passes": {}, "pending": {}, "aliases": {}, "seen": {}}
        already_merged = False
        try:
            raw = self.path.read_bytes()
        except FileNotFoundError:
            raw = None
        except OSError as exc:
            _quarantine(self.path, f"unreadable: {exc}")
            raw = None
        if raw is not None:
            try:
                data = json.loads(raw.decode("utf-8"))
                if _is_legacy(data):
                    state = _from_legacy(data, now)
                    self._keep_legacy_copy()
                    self.needs_save = True
                    log.warning("billing state %s is in the old format; converted (original kept as .legacy-backup)", self.path)
                else:
                    state = _from_current(data)
                    already_merged = bool(data.get("legacy_merged"))
            except (UnicodeDecodeError, ValueError, TypeError) as exc:
                _quarantine(self.path, f"corrupt: {exc}")
                state = {"passes": {}, "pending": {}, "aliases": {}, "seen": {}}
        self.legacy_merged = already_merged
        if not already_merged:
            self._merge_quarantined_legacy(state, now)

        passes = {k: v for k, v in state["passes"].items() if v["expires_at"] > now}
        pending = {
            k: v for k, v in state["pending"].items()
            if (v.get("status") == "paid" and v.get("record_token") in passes)
            or (v.get("status") != "paid" and now - int(v.get("opened_at", 0)) <= PENDING_MAX_AGE_SECONDS)
        }
        seen = {k: t for k, t in state["seen"].items() if now - t <= WEBHOOK_ID_MAX_AGE_SECONDS}

        linked = dict(pending)
        for alias, primary in state["aliases"].items():
            if primary in pending:
                linked[alias] = pending[primary]
        return {"passes": passes, "pending": linked, "seen_webhooks": seen}

    def _keep_legacy_copy(self) -> None:
        target = self.path.with_name(self.path.name + ".legacy-backup")
        if target.exists():
            return
        try:
            shutil.copy2(self.path, target)
        except OSError as exc:
            log.error("could not keep a copy of the old-format state file: %s", exc)

    def _merge_quarantined_legacy(self, state: dict, now: float) -> None:
        quarantined = self.path.with_name(self.path.name + ".corrupt")
        try:
            data = json.loads(quarantined.read_bytes().decode("utf-8"))
        except (OSError, UnicodeDecodeError, ValueError):
            return  # absent, unreadable or genuinely corrupt: nothing to recover
        if not _is_legacy(data):
            return
        recovered = _from_legacy(data, now)
        before = len(state["passes"]), len(state["pending"])
        _merge(state, recovered)
        self.legacy_merged = True
        self.needs_save = True
        log.warning(
            "recovered old-format billing data from %s: +%d passes, +%d checkouts (file left untouched)",
            quarantined, len(state["passes"]) - before[0], len(state["pending"]) - before[1],
        )

    # ------------------------------------------------------------- snapshot
    def snapshot(self, passes: dict, pending: dict, seen_webhooks: dict) -> tuple[int, str]:
        """Serialise a private copy.  Call this while holding the lock that
        guards the three structures; the returned text is safe to write later.
        """
        primaries: dict[str, dict] = {}
        aliases: dict[str, str] = {}
        for key, entry in pending.items():
            primary = str(entry.get("session_id") or key)
            if primary == key:
                primaries[key] = entry
            else:
                aliases[key] = primary
                primaries.setdefault(primary, entry)
        text = json.dumps(
            {
                "version": SCHEMA_VERSION,
                "passes": passes,
                "pending": primaries,
                "aliases": aliases,
                "seen_webhooks": seen_webhooks,
                **({"legacy_merged": True} if self.legacy_merged else {}),
            },
            sort_keys=True,
        )
        self._seq += 1
        return self._seq, text

    # ---------------------------------------------------------------- write
    def write(self, seq: int, text: str) -> bool:
        """Atomically replace the state file.  Never raises; returns success."""
        with self._write_lock:
            if seq <= self._written_seq:
                return True  # a newer snapshot already reached the disk
            tmp = self.path.with_name(f"{self.path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    handle.write(text)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.chmod(tmp, 0o600)
                os.replace(tmp, self.path)
                self._fsync_dir()
            except OSError as exc:
                self.last_error = f"{type(exc).__name__}: {exc}"
                log.error("billing state save failed (%s): %s", self.path, exc)
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                return False
            self._written_seq = seq
            self.saves += 1
            self.last_error = None
            return True

    def _fsync_dir(self) -> None:
        if os.name != "posix":
            return
        fd = os.open(self.path.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
