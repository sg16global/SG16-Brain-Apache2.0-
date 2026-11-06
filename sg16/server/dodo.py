"""SG16 BRAIN - Dodo Payments Merchant-of-Record gateway client.

This module lives inside ``sg16/server/`` on purpose: the HTTP host is the
*only* part of the brain allowed to touch the network, and
``tests/test_isolation.py`` enforces that mechanically.  The payment
gateway is a host-side concern exactly like the HTTP socket itself - the
mathematical core behind the sealed perimeter has no idea money exists.

Responsibilities
----------------
* create a Dodo checkout session for one subscription pass
  (``POST {api_base}/checkouts``, bearer-authenticated),
* map gateway failures onto a single :class:`DodoError` the HTTP layer can
  render as a predictable JSON error.

Responsibilities it deliberately does **not** have:

* webhook verification and token signing - those are pure mathematics and
  live in :mod:`sg16.billing` so they are auditable without any network,
* any pricing logic - the host derives every price itself; the gateway is
  never authoritative over what a tier costs.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

__all__ = ["DodoError", "DodoClient", "DEFAULT_TIMEOUT", "USER_AGENT"]

DEFAULT_TIMEOUT = 10

# Said plainly: this is the SG16 host talking, not a browser.
USER_AGENT = "SG16-Brain/1.0 (+https://mistralbrain.com)"

# Official Dodo Payments environment URLs (docs.dodopayments.com,
# "API Reference - Introduction"): Test Mode and Live Mode.
_TEST_BASE = "https://test.dodopayments.com"
_LIVE_BASE = "https://live.dodopayments.com"


class DodoError(RuntimeError):
    """A Dodo Payments gateway failure, ready to render as an HTTP error."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"dodo payments: {message}")
        self.status = status
        self.message = message


class DodoClient:
    """Minimal bearer client for the Dodo Payments checkout-session API.

    Constructed only when an API key is configured; without one the host runs
    the sovereign local issuance path and never imports this class at runtime.
    """

    def __init__(
        self,
        api_key: str,
        test_mode: bool = True,
        api_bases: dict[str, str] | None = None,
        timeout: int = DEFAULT_TIMEOUT,
    ) -> None:
        bases = api_bases or {}
        if test_mode:
            self.api_base = bases.get("test") or _TEST_BASE
        else:
            self.api_base = bases.get("live") or _LIVE_BASE
        if not api_key:
            raise ValueError("DodoClient requires an API key")
        self.api_key = api_key
        self.timeout = timeout

    def create_checkout(self, body: dict) -> dict:
        """Create one checkout session.

        Returns the Dodo response (``session_id``, ``checkout_url``,
        ``payment_id``, ...).  Raises :class:`DodoError` for anything that is
        not a usable 2xx JSON response, so the HTTP layer always has a
        predictable error to render.
        """
        request = urllib.request.Request(
            f"{self.api_base}/checkouts",
            data=json.dumps(body).encode("utf-8"),
            method="POST",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": USER_AGENT,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:200]
            raise DodoError(exc.code, f"checkout rejected: {detail}") from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise DodoError(502, f"gateway unreachable: {exc}") from exc
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise DodoError(502, f"gateway response was not valid json: {exc}") from exc
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise DodoError(502, "gateway response was not valid json") from exc
        if not isinstance(parsed, dict):
            raise DodoError(502, "gateway response was not a json object")
        return parsed
