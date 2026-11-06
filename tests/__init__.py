"""SG16 BRAIN test suite.

Run with::

    python3 -m unittest discover -s tests -v

Standard library only, matching the zero-dependency mandate of the engine.
"""

# Servers built by tests must never read or write the real
# state/billing_state.json, and must not inherit another test's passes: every
# server that is not given an explicit path gets its own fresh temp file.
import atexit as _atexit
import itertools as _itertools
import os as _os
import shutil as _shutil
import tempfile as _tempfile

from sg16.server import app as _app

_STATE_DIR = _tempfile.mkdtemp(prefix="sg16-test-state-")
_atexit.register(_shutil.rmtree, _STATE_DIR, True)
_counter = _itertools.count()
_original_init = _app.BrainHTTPServer.__init__


def _init_with_private_state(self, address, handler, brain, config, billing_state_path=None):
    if billing_state_path is None:
        billing_state_path = _os.path.join(_STATE_DIR, f"billing-{next(_counter)}.json")
    _original_init(self, address, handler, brain, config, billing_state_path=billing_state_path)


_app.BrainHTTPServer.__init__ = _init_with_private_state
