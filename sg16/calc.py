"""SG16 BRAIN - safe arithmetic.

Charter invariant ``zero_hallucination`` forbids fabrication, but it does not
forbid computation.  When the answer is a matter of arithmetic the brain
*computes* it and returns a real number, rather than guessing at one.

This evaluator walks a parsed AST.  It never calls ``eval``/``exec`` and it
never touches ``__``-anything, so there is no injection surface.
"""

from __future__ import annotations

import ast
import math
import operator
from typing import Callable

__all__ = [
    "ArithmeticError_",
    "INPUT_ERROR_TOKEN",
    "evaluate",
    "try_evaluate",
    "looks_numeric",
]

MAX_EXPONENT = 64
MAX_NUMERIC_LENGTH = 4096

#: Structural input-error bound token.  When an expression is refused by the
#: safe compute path - most notably a chain deep enough to exhaust the
#: interpreter stack - :func:`try_evaluate` returns this token instead of
#: letting the exception escape.  The character layer maps it onto a canonical
#: deferral, so the host answers predictably instead of crashing (Bug #1).
INPUT_ERROR_TOKEN = "__sg16_input_error__"


class ArithmeticError_(ValueError):
    """Raised for unsupported or unsafe expressions."""


_BINOPS: dict[type, Callable[[float, float], float]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}

_UNARYOPS: dict[type, Callable[[float], float]] = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}

_FUNCTIONS: dict[str, Callable[..., float]] = {
    "abs": abs,
    "round": round,
    "min": min,
    "max": max,
    "sqrt": math.sqrt,
    "log": math.log,
    "log10": math.log10,
    "log2": math.log2,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "exp": math.exp,
    "floor": math.floor,
    "ceil": math.ceil,
}

_CONSTANTS: dict[str, float] = {
    "pi": math.pi,
    "e": math.e,
    "tau": math.tau,
}


def _clean(text: str) -> str:
    out = text.strip()
    for token in ("=", "what is", "calculate", "compute", "how much is", "?"):
        if out.lower().startswith(token):
            out = out[len(token) :].strip()
    return out.rstrip("?.! ").strip()


def _node(node: ast.AST) -> float:
    if isinstance(node, ast.Expression):
        return _node(node.body)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise ArithmeticError_("only numbers are allowed")
        return float(node.value)
    if isinstance(node, ast.BinOp):
        op = _BINOPS.get(type(node.op))
        if op is None:
            raise ArithmeticError_("unsupported operator")
        left = _node(node.left)
        right = _node(node.right)
        if isinstance(node.op, ast.Pow):
            if abs(right) > MAX_EXPONENT:
                raise ArithmeticError_("exponent too large")
            if left == 0 and right < 0:
                raise ArithmeticError_("division by zero")
        if isinstance(node.op, (ast.Div, ast.FloorDiv, ast.Mod)) and right == 0:
            raise ArithmeticError_("division by zero")
        result = op(left, right)
        if isinstance(result, complex):
            raise ArithmeticError_("complex results are not supported")
        return float(result)
    if isinstance(node, ast.UnaryOp):
        op = _UNARYOPS.get(type(node.op))
        if op is None:
            raise ArithmeticError_("unsupported unary operator")
        return float(op(_node(node.operand)))
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name):
            raise ArithmeticError_("only plain function calls are allowed")
        fn = _FUNCTIONS.get(node.func.id)
        if fn is None:
            raise ArithmeticError_(f"unknown function {node.func.id!r}")
        if node.keywords:
            raise ArithmeticError_("keyword arguments are not allowed")
        args = [_node(a) for a in node.args]
        return float(fn(*args))
    if isinstance(node, ast.Name):
        if node.id in _CONSTANTS:
            return _CONSTANTS[node.id]
        raise ArithmeticError_(f"unknown name {node.id!r}")
    raise ArithmeticError_("unsupported expression element")


def looks_numeric(text: str) -> bool:
    """Cheap gate: does this look like an arithmetic question at all?"""
    cleaned = _clean(text)
    if not cleaned or len(cleaned) > MAX_NUMERIC_LENGTH:
        return False
    digits = sum(c.isdigit() for c in cleaned)
    if digits == 0:
        return False
    if not any(c in cleaned for c in "+-*/%^"):
        return False
    # a sentence that merely contains a number is not an arithmetic question
    letters = sum(c.isalpha() for c in cleaned)
    return letters <= 12


def evaluate(text: str) -> float:
    """Evaluate an arithmetic expression.  Raises :class:`ArithmeticError_`."""
    cleaned = _clean(text).replace("^", "**")
    if not cleaned:
        raise ArithmeticError_("empty expression")
    tree = ast.parse(cleaned, mode="eval")
    result = _node(tree)
    if not math.isfinite(result):
        raise ArithmeticError_("result is not finite")
    return result


def format_result(value: float) -> str:
    """Render a float without floating-point noise."""
    if abs(value - round(value)) < 1e-9 and abs(value) < 1e15:
        return f"{int(round(value)):,}"
    return f"{value:,.10f}".rstrip("0").rstrip(".")


def try_evaluate(text: str) -> str | None:
    """Return a formatted answer, or ``None`` when this is not arithmetic.

    Structural input errors never escape as exceptions.  A chain such as
    ``1+1+1+...`` a few thousand terms long parses into a tree deeper than the
    interpreter recursion limit; :meth:`_node` would otherwise raise
    ``RecursionError`` straight through the caller.  That case is bounded to
    :data:`INPUT_ERROR_TOKEN`, which the character layer converts into a
    canonical deferral - the request is answered, never crashed.
    """
    if not looks_numeric(text):
        return None
    try:
        return format_result(evaluate(text))
    except (ArithmeticError_, SyntaxError, ValueError, OverflowError, ZeroDivisionError):
        return None
    except RecursionError:
        return INPUT_ERROR_TOKEN
