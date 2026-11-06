"""SG16 BRAIN - operational throttles for the host.

Guest sessions (no pass, not the owner) are bounded by a sliding-window request
limit and a token (character) budget, so the open door cannot be abused as an
unmetered pipe.  Two classes are exempt:

* the **VIP owner** (``sg16.owner``) - zero-restriction priority path;
* sessions holding a **verified pass** - every tier sells unlimited execution.

The safety gate is not a throttle and is never bypassed by this module.
"""

from __future__ import annotations

import time

__all__ = ["Throttle", "ThrottleExceeded"]


class ThrottleExceeded(RuntimeError):
    """Raised when a non-exempt session crosses an operational limit."""


class Throttle:
    """Sliding-window request + token accounting, in-memory only."""

    def __init__(
        self,
        max_requests: int = 30,
        window_seconds: float = 60.0,
        max_chars: int = 200_000,
    ) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.max_chars = max_chars
        self._hits: dict[str, list[float]] = {}
        self._chars: dict[str, list[tuple[float, int]]] = {}

    # ------------------------------------------------------------------
    def _prune(self, entries: list[float], cutoff: float) -> list[float]:
        return [t for t in entries if t >= cutoff]

    def check(self, session_id: str, chars: int, exempt: bool = False) -> None:
        """Record one request; raise if a non-exempt session exceeds limits."""
        if exempt:
            return
        now = time.monotonic()
        cutoff = now - self.window_seconds

        hits = self._prune(self._hits.get(session_id, []), cutoff)
        if len(hits) >= self.max_requests:
            self._hits[session_id] = hits
            raise ThrottleExceeded(
                f"rate limit: {self.max_requests} requests per "
                f"{int(self.window_seconds)}s"
            )
        hits.append(now)
        self._hits[session_id] = hits

        budget = self._prune_chars(self._chars.get(session_id, []), cutoff)
        total = sum(c for _, c in budget) + chars
        if total > self.max_chars:
            self._chars[session_id] = budget
            raise ThrottleExceeded(
                f"token budget: {self.max_chars} characters per "
                f"{int(self.window_seconds)}s"
            )
        budget.append((now, chars))
        self._chars[session_id] = budget

    @staticmethod
    def _prune_chars(
        entries: list[tuple[float, int]], cutoff: float
    ) -> list[tuple[float, int]]:
        return [e for e in entries if e[0] >= cutoff]

    def counters(self, session_id: str) -> dict:
        now = time.monotonic()
        cutoff = now - self.window_seconds
        hits = self._prune(self._hits.get(session_id, []), cutoff)
        chars = sum(c for _, c in self._prune_chars(self._chars.get(session_id, []), cutoff))
        return {"requests_in_window": len(hits), "chars_in_window": chars}
