#!/usr/bin/env python3
"""Regenerate SHA256.json for the current delivery.

The original 0.8.0-rc.1 manifest is preserved as
``SHA256_RELEASE_0.8.0-rc.1.json``. This script covers the static site, the
canonical data payloads, the pipeline source, the added modules and the review
documents. It deliberately excludes ``.env``, caches and raw downloads.

    python scripts/hash_release.py
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

INCLUDE_DIRS = ["site", "public/data", "scripts", "src", "tests", "docs"]
INCLUDE_FILES = [
    "README.md",
    "RELEASE_REVIEW.md",
    "serve.py",
    "SOURCES_AND_APPROVALS.md",
    "TEAM_REVIEW.md",
    "VERIFICATION.json",
    "VERIFICATION_SCREENING.json",
    "SCREENING_INTEGRATION.md",
]
EXCLUDE_SUFFIXES = {".pyc", ".tmp", ".part"}
EXCLUDE_PARTS = {"__pycache__", "artifacts", "cache"}


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    entries: dict[str, str] = {}
    for name in INCLUDE_FILES:
        path = ROOT / name
        if path.is_file():
            entries[name] = digest(path)
    for folder in INCLUDE_DIRS:
        base = ROOT / folder
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(ROOT).as_posix()
            if path.suffix.lower() in EXCLUDE_SUFFIXES:
                continue
            if any(part in EXCLUDE_PARTS for part in path.parts):
                continue
            entries[rel] = digest(path)
    output = ROOT / "SHA256.json"
    output.write_text(json.dumps(dict(sorted(entries.items())), indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output} ({len(entries)} files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
