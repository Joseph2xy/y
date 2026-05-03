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
    if status.current_database:
        print(f"Current database: {database_label(status.current_database)}")
    if status.context_source:
        print(
            "Context scanned from: "
            f"{database_label(status.context_source)} at {status.context_source.scanned_at.isoformat()}"
        )
    if status.next_action:
        print(f"Next action: {status.next_action}")
        print_next_step(status.next_action)
    else:
        print("Next step: run `pnpm dev:app` and open http://127.0.0.1:5173")
    return 0 if status.ready else 1


def print_check(label: str, check: object) -> None:
    configured = getattr(check, "configured")
    ready = getattr(check, "ready")
    message = getattr(check, "message")
    state = "ready" if ready else "not ready"
    print(f"{label}: {state} (configured={configured})")
    if message:
        print(f"  {message}")


def print_next_step(action: str) -> None:
    if action == "configure_database":
        print("Next step: edit .env and set DATABASE_URL for a read-only Postgres user.")
        print("Then rerun: pnpm check:setup")
    elif action == "configure_model_provider":
        print("Next step: edit .env with OpenRouter settings, or use the setup screen.")
        print("Then rerun: pnpm check:setup")
    elif action == "setup_context":
        print("Next step: run `pnpm dev:app` and open http://127.0.0.1:5173")
        print("The setup screen will scan the database and generate local context.")
    elif action == "rescan_context":
        print("Next step: run `pnpm rescan:context` to update context for the current database.")
        print("Then rerun: pnpm check:setup")
    else:
        print("Next step: review README.md and docs/troubleshooting.md.")


def database_label(source: object) -> str:
    database = getattr(source, "database") or "default database"
    host = getattr(source, "host") or "default host"
    port = getattr(source, "port")
    if port:
        host = f"{host}:{port}"
    return f"{database} on {host}"


if __name__ == "__main__":
    raise SystemExit(main())
