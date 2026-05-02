from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import setup_status


def main() -> int:
    status = setup_status()
    print(f"Ready: {status.ready}")
    print_check("Database", status.database)
    print_check("Model provider", status.model_provider)
    print_check("Context", status.context)
    if status.next_action:
        print(f"Next action: {status.next_action}")
    return 0 if status.ready else 1


def print_check(label: str, check: object) -> None:
    configured = getattr(check, "configured")
    ready = getattr(check, "ready")
    message = getattr(check, "message")
    state = "ready" if ready else "not ready"
    print(f"{label}: {state} (configured={configured})")
    if message:
        print(f"  {message}")


if __name__ == "__main__":
    raise SystemExit(main())
