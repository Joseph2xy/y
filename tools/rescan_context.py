from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.context_store import ContextStoreError
from app.main import scan_context


def main() -> int:
    try:
        response = asyncio.run(scan_context())
    except HTTPException as exc:
        print(f"Context rescan failed: {exc.detail}", file=sys.stderr)
        return 1
    except ContextStoreError as exc:
        print(f"Context rescan failed: {exc}", file=sys.stderr)
        return 1

    print("Context rescan complete.")
    print(f"Tables: {response.table_count}")
    print(f"Columns: {response.column_count}")
    print("Updated: data/context/schema.json")
    print("Preserved: data/context/policy.json")
    print("Preserved: data/context/context.md unless it was still the untouched default")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
