from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.db_diagnostics import diagnose_database_url


def main() -> int:
    load_dotenv(ROOT / ".env")
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set in .env.", file=sys.stderr)
        print("Add DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB_NAME to .env.", file=sys.stderr)
        return 1

    info, diagnostics = diagnose_database_url(database_url)
    if info:
        print(f"Database: {info.safe_label}")

    for diagnostic in diagnostics:
        prefix = "OK" if diagnostic.ok else "FAIL"
        print(f"[{prefix}] {diagnostic.summary}")
        if diagnostic.detail:
            print(diagnostic.detail)
        if diagnostic.next_step and not diagnostic.ok:
            print(f"Next step: {diagnostic.next_step}")
        if not diagnostic.ok:
            return 1

    print("DATABASE_URL works.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
