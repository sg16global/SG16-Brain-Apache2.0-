"""Run the sovereign host: ``python3 -m sg16.server [host] [port]``."""

from __future__ import annotations

from .app import main

if __name__ == "__main__":
    raise SystemExit(main())
