"""Secret-backed owner identification for server-side operational exemptions.

An email address or public digest is an identifier, not an authenticator. The
only accepted credential is a bearer token supplied by the server operator via
``SG16_OWNER_SECRET``. Keep that value server-side; never ship it to browser
code. If it is unset, no request is treated as the owner.
"""

from __future__ import annotations

import hmac
import os

__all__ = ["matches_owner", "resolve_signature"]


def matches_owner(signature: str | None, secret: str | None = None) -> bool:
    """Check a bearer credential against the configured server-side secret.

    ``secret`` is an explicit injection point for tests and trusted embedding;
    the HTTP server leaves it unset and reads ``SG16_OWNER_SECRET``. Email
    addresses, public hashes, and an unconfigured server never authenticate.
    """
    expected = secret if secret is not None else os.environ.get("SG16_OWNER_SECRET")
    if not isinstance(signature, str) or not isinstance(expected, str):
        return False
    candidate = signature.strip()
    expected = expected.strip()
    if not candidate or not expected:
        return False
    return hmac.compare_digest(candidate, expected)


def resolve_signature(headers: dict, secret: str | None = None) -> bool:
    """Check only the secret-bearing owner signature header."""
    signature = next(
        (
            value
            for key, value in headers.items()
            if str(key).casefold() == "x-sg16-owner-sig"
        ),
        None,
    )
    return matches_owner(signature, secret=secret)
