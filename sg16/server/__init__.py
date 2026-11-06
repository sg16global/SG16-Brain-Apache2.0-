"""SG16 BRAIN - the HTTP host.

This is the *only* part of the brain allowed to touch the network, and it is a
host, not a model dependency: it serves the sealed perimeter over HTTP.  The
mathematical core behind it has no idea the network exists.
"""

from __future__ import annotations

from .app import BrainHTTPServer, build_server, main

__all__ = ["BrainHTTPServer", "build_server", "main"]
