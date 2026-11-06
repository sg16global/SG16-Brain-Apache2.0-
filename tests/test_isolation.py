"""Block 3, rule 1: no external model dependency, no remote API, no daemon.

This test is the mechanical enforcement of the in-process mandate.  It parses
every module in the mathematical core and fails if it finds network I/O, a
subprocess, a threading primitive, dynamic code execution, or any third-party
import at all.
"""

from __future__ import annotations

import ast
import pathlib
import sys
import unittest

PACKAGE_ROOT = pathlib.Path(__file__).resolve().parent.parent / "sg16"

#: Modules that must never appear in the mathematical core.
FORBIDDEN_ROOTS = {
    "requests",
    "httpx",
    "aiohttp",
    "urllib",
    "urllib3",
    "http",
    "socket",
    "socketserver",
    "subprocess",
    "multiprocessing",
    "concurrent",
    "asyncio",
    "threading",
    "ctypes",
    "torch",
    "tensorflow",
    "jax",
    "numpy",
    "scipy",
    "transformers",
    "ollama",
    "openai",
    "anthropic",
    "google",
    "grpc",
    "websocket",
    "websockets",
    "flask",
    "fastapi",
    "django",
    "celery",
    "redis",
    "pymongo",
    "psycopg2",
    "sqlalchemy",
    "numpy",
}

#: Bare calls that would break determinism or the sealed boundary.  Matched as
#: plain names only: ``re.compile`` is a legitimate, fully deterministic call
#: and must not be mistaken for the builtin ``compile``.
FORBIDDEN_CALLS = {"eval", "exec", "compile", "__import__", "input", "breakpoint"}

#: Attribute calls that would spawn or drive an external process.
FORBIDDEN_ATTRIBUTES = {"system", "popen", "spawn", "spawnl", "execv", "fork", "urlopen"}

#: The mathematical core: everything except the HTTP host.
CORE_GLOBS = (
    "fixed.py",
    "tensor.py",
    "tokenizer.py",
    "matrix.py",
    "retrieval.py",
    "calc.py",
    "knowledge.py",
    "solution.py",
    "character.py",
    "brain.py",
    "charter.py",
    "transport.py",
    "engine/*.py",
    "gate/*.py",
    "policy/*.py",
)

#: Standard library modules the core is allowed to use.
ALLOWED_STDLIB = {
    "ast",
    "collections",
    "dataclasses",
    "enum",
    "hashlib",
    "io",
    "json",
    "math",
    "operator",
    "os",
    "pathlib",
    "re",
    "struct",
    "types",
    "typing",
    "unicodedata",
    "wave",
    "__future__",
}


def _core_modules() -> list[pathlib.Path]:
    found: set[pathlib.Path] = set()
    for pattern in CORE_GLOBS:
        found.update(PACKAGE_ROOT.glob(pattern))
    return sorted(found)


def _imports(tree: ast.AST) -> set[str]:
    roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                roots.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.level and node.level > 0:
                continue  # relative import inside the package
            if node.module:
                roots.add(node.module.split(".")[0])
    return roots


def _bare_calls(tree: ast.AST) -> set[str]:
    """Calls made by plain name, e.g. ``eval(...)``."""
    return {
        node.func.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }


def _attribute_calls(tree: ast.AST) -> set[str]:
    """Calls made through an attribute, e.g. ``os.system(...)``."""
    return {
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    }


class IsolationTests(unittest.TestCase):
    def test_core_modules_were_found(self) -> None:
        self.assertGreater(len(_core_modules()), 15, "the core glob matched nothing")

    def test_no_forbidden_imports_in_the_core(self) -> None:
        offenders: list[str] = []
        for path in _core_modules():
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for root in _imports(tree):
                if root in FORBIDDEN_ROOTS:
                    offenders.append(f"{path.name}: imports {root}")
        self.assertEqual(offenders, [])

    def test_no_dynamic_code_execution_in_the_core(self) -> None:
        offenders: list[str] = []
        for path in _core_modules():
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for name in _bare_calls(tree) & FORBIDDEN_CALLS:
                offenders.append(f"{path.name}: calls {name}()")
            for name in _attribute_calls(tree) & FORBIDDEN_ATTRIBUTES:
                offenders.append(f"{path.name}: calls .{name}()")
        self.assertEqual(offenders, [])

    def test_every_import_in_the_package_is_standard_library(self) -> None:
        # The rule is "no third-party dependency", not a fixed allow-list: any
        # module that ships with the interpreter is acceptable, and everything
        # else is a violation.  sys.stdlib_module_names is the interpreter's own
        # list, so this cannot drift from what Python actually provides.
        offenders: list[str] = []
        for path in sorted(PACKAGE_ROOT.rglob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for root in _imports(tree):
                if root in ("sg16",) or root in sys.stdlib_module_names:
                    continue
                offenders.append(f"{path.relative_to(PACKAGE_ROOT)}: imports {root}")
        self.assertEqual(offenders, [], "the brain must have zero third-party dependencies")

    def test_server_is_the_only_module_touching_the_network(self) -> None:
        for path in sorted(PACKAGE_ROOT.rglob("*.py")):
            if "server" in path.parts:
                continue
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for root in _imports(tree) & {"socket", "socketserver", "http", "urllib"}:
                self.fail(f"{path.relative_to(PACKAGE_ROOT)} imports {root}")

    def test_transport_never_probes_the_network(self) -> None:
        """Checked on the syntax tree, not by substring: "ping" is inside
        "typing", and a naive search would fail for the wrong reason."""
        path = PACKAGE_ROOT / "transport.py"
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        self.assertEqual(_imports(tree) & FORBIDDEN_ROOTS, set())
        self.assertEqual(_attribute_calls(tree) & FORBIDDEN_ATTRIBUTES, set())
        self.assertEqual(_bare_calls(tree) & FORBIDDEN_CALLS, set())

    def test_no_hardcoded_external_endpoints(self) -> None:
        for path in _core_modules():
            text = path.read_text(encoding="utf-8").lower()
            for token in ("http://", "https://", "api.openai", "localhost:", "127.0.0.1"):
                self.assertNotIn(token, text, f"{path.name} references {token}")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
