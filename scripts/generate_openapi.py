#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
DOCS_PATH = REPO_ROOT / "docs" / "openapi.yaml"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app  # noqa: E402


def main() -> None:
    DOCS_PATH.parent.mkdir(parents=True, exist_ok=True)
    schema = app.openapi()
    with DOCS_PATH.open("w", encoding="utf-8") as fh:
        json.dump(schema, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"Wrote {DOCS_PATH}")


if __name__ == "__main__":
    main()
