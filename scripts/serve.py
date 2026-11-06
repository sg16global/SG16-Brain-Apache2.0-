#!/usr/bin/env python3
"""Start the SG16 BRAIN sovereign host.

Usage:
    python3 scripts/serve.py [host] [port]

Defaults come from config/brain.json (0.0.0.0:8080).  The transport label may be
declared with SG16_TRANSPORT=online|offline; it is never probed.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sg16.server.app import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
