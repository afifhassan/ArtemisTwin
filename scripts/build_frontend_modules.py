#!/usr/bin/env python3
"""Build the additive screening modules into the static production root.

There is no bundler in this delivery: the modules are native ES modules copied
side by side, so their relative imports keep working. This keeps the existing
Vite-built bundle untouched.

    python scripts/build_frontend_modules.py
    python scripts/build_frontend_modules.py --check   # verify only
"""
from __future__ import annotations

import argparse
import json
import shutil

from common import ROOT, SITE, banner, sha256_file, step, utc_now_iso, warn, write_json

SRC_MODULES = ROOT / "src" / "modules"
SRC_CSS = ROOT / "src" / "styles" / "analog-fit.css"
OUT = SITE / "assets" / "analog-fit"
VERSION = "1.0.0"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    banner("Frontend · build additive screening modules")
    modules = sorted(SRC_MODULES.glob("*.js"))
    if not modules:
        warn("No modules found.")
        return 2
    missing = [m.name for m in modules if m.stat().st_size == 0]
    if missing:
        warn(f"Empty modules: {', '.join(missing)}")
        return 2

    if args.check:
        ok = all((OUT / m.name).is_file() for m in modules) and (OUT / "analog-fit.css").is_file()
        step(f"Output present: {ok}")
        return 0 if ok else 1

    OUT.mkdir(parents=True, exist_ok=True)
    for module in modules:
        shutil.copy2(module, OUT / module.name)
    shutil.copy2(SRC_CSS, OUT / "analog-fit.css")

    files = {}
    for path in sorted(OUT.glob("*")):
        if path.is_file() and path.name != "manifest.json":
            files[path.name] = {"bytes": path.stat().st_size, "sha256": sha256_file(path)}
    write_json(
        OUT / "manifest.json",
        {
            "schemaVersion": "1.0",
            "version": VERSION,
            "generated": utc_now_iso(),
            "note": "Additive ES modules; the original Vite bundle is unchanged.",
            "files": files,
        },
    )
    step(f"Copied {len(modules)} modules + 1 stylesheet into {OUT.relative_to(ROOT)}")
    step("index.html must reference /assets/analog-fit/analog-fit.css and /assets/analog-fit/analog-fit.js")

    index = (SITE / "index.html").read_text(encoding="utf-8")
    refs = ["analog-fit/analog-fit.css", "analog-fit/analog-fit.js"]
    for ref in refs:
        step(f"index.html references {ref}: {ref in index}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
