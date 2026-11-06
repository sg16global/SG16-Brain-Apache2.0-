#!/usr/bin/env python3
"""Build the Sovereign SG16 Brain Portable zip package.

Usage:
    python3 scripts/build_portable.py [--output dist/Sovereign-SG16-Brain-Portable.zip]

Packages the complete standalone Sovereign SG16 Brain into a portable distribution
archive (~2.1 MB) containing the mathematical core, web UI, knowledge base,
configuration, documentation, scripts, and tests.
"""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import sys
import zipfile

# Exclude VCS, cache, build artifacts and unneeded binaries
EXCLUDE_DIRS = {
    ".git",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    "node_modules",
    "dist",
    "build",
    ".venv",
    "venv",
    ".idea",
    ".vscode",
}

EXCLUDE_EXTS = {
    ".pyc",
    ".pyo",
    ".pyd",
    ".DS_Store",
}

EXCLUDE_FILES = {
    ".DS_Store",
    "Thumbs.db",
}


def build_portable_zip(root_dir: Path, output_zip: Path) -> int:
    output_zip.parent.mkdir(parents=True, exist_ok=True)

    # If destination zip already exists inside output_zip, remove it first
    if output_zip.exists():
        output_zip.unlink()

    count = 0
    with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for current_root, dirs, files in os.walk(root_dir):
            # Prune excluded directories in-place
            dirs[:] = sorted([
                d for d in dirs
                if d not in EXCLUDE_DIRS and not d.startswith(".")
            ])

            for filename in sorted(files):
                # Skip excluded extensions, files, or hidden files (except .gitignore)
                if filename in EXCLUDE_FILES or any(filename.endswith(ext) for ext in EXCLUDE_EXTS):
                    continue
                if filename.startswith(".") and filename != ".gitignore":
                    continue

                full_path = Path(current_root) / filename
                # Never include the output file or anything in dist
                try:
                    rel_path = full_path.relative_to(root_dir)
                except ValueError:
                    continue

                if rel_path.parts and rel_path.parts[0] in EXCLUDE_DIRS:
                    continue

                zf.write(full_path, str(rel_path))
                count += 1

    size_bytes = output_zip.stat().st_size
    size_mb = size_bytes / (1024 * 1024)

    # Compute SHA256 digest
    hasher = hashlib.sha256()
    with open(output_zip, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    sha256 = hasher.hexdigest()

    print("=" * 70)
    print("Sovereign SG16 Brain - Portable Package Built Successfully")
    print("=" * 70)
    print(f"Archive: {output_zip}")
    print(f"Files:   {count} files packaged")
    print(f"Size:    {size_bytes} bytes ({size_mb:.2f} MB)")
    print(f"SHA256:  {sha256}")
    print("=" * 70)

    return size_bytes


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Sovereign SG16 Brain Portable zip")
    parser.add_argument(
        "--output",
        "-o",
        default="dist/Sovereign-SG16-Brain-Portable.zip",
        help="Path for destination zip archive",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    output_path = (repo_root / args.output).resolve() if not Path(args.output).is_absolute() else Path(args.output)

    build_portable_zip(repo_root, output_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
