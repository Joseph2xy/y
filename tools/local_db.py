from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import psycopg

from tools.calibration import provision_database
from tools.complex_calibration import MARKETPLACE_DOMAIN, SAAS_DOMAIN
from tools.finance_calibration import seed_schema as seed_finance_schema
from tools.postgres_smoke import provision_demo_database
from tools.realistic_calibration import seed_schema as seed_retail_schema


DEFAULT_BASE_DIR = Path.home() / ".local" / "share" / "csv-chat-pg"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 5432
DEFAULT_READONLY_PASSWORD = "readonly"


def main() -> None:
    args = parse_args()
    base_dir = args.base_dir.expanduser()

    if args.command == "init":
        init_cluster(base_dir)
    elif args.command == "start":
        start_cluster(base_dir, args.host, args.port)
    elif args.command == "stop":
        stop_cluster(base_dir)
    elif args.command == "status":
        print_status(base_dir, args.host, args.port)
    elif args.command == "seed":
        seed_databases(args.host, args.port, args.readonly_password)
    elif args.command == "urls":
        print_urls(args.host, args.port, args.readonly_password)
    else:
        raise SystemExit(f"Unknown command: {args.command}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Manage the persistent local CSV Chat Postgres test cluster.")
    parser.add_argument(
        "--base-dir",
        type=Path,
        default=DEFAULT_BASE_DIR,
        help=f"Persistent Postgres cluster directory parent. Default: {DEFAULT_BASE_DIR}",
    )
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--readonly-password", default=DEFAULT_READONLY_PASSWORD)
    parser.add_argument("command", choices=("init", "start", "stop", "status", "seed", "urls"))
    return parser.parse_args()


def init_cluster(base_dir: Path) -> None:
    require_command("initdb")
    data_dir = _data_dir(base_dir)
    socket_dir = _socket_dir(base_dir)
    socket_dir.mkdir(parents=True, exist_ok=True)

    if _is_initialized(data_dir):
        print(f"Already initialized: {data_dir}")
        return

    base_dir.mkdir(parents=True, exist_ok=True)
    run(["initdb", "-D", str(data_dir), "--auth=trust", "--username=postgres"])
    print(f"Initialized local Postgres cluster: {data_dir}")


def start_cluster(base_dir: Path, host: str, port: int) -> None:
    require_command("pg_ctl")
    if not _is_initialized(_data_dir(base_dir)):
        init_cluster(base_dir)

    _socket_dir(base_dir).mkdir(parents=True, exist_ok=True)
    if is_ready(host, port):
        print(f"Postgres is already accepting connections on {host}:{port}")
        return

    run(
        [
            "pg_ctl",
            "-D",
            str(_data_dir(base_dir)),
            "-l",
            str(_log_file(base_dir)),
            "-o",
            f"-h {host} -p {port} -k {_socket_dir(base_dir)}",
            "start",
        ]
    )
    print(f"Started local Postgres on {host}:{port}")


def stop_cluster(base_dir: Path) -> None:
    require_command("pg_ctl")
    if not _is_initialized(_data_dir(base_dir)):
        print(f"No local Postgres cluster found at {_data_dir(base_dir)}")
        return

    run(["pg_ctl", "-D", str(_data_dir(base_dir)), "stop"])
    print("Stopped local Postgres.")


def print_status(base_dir: Path, host: str, port: int) -> None:
    print(f"Cluster: {_data_dir(base_dir)}")
    if not _is_initialized(_data_dir(base_dir)):
        print("Status: not initialized")
        return

    if not is_ready(host, port):
        print(f"Status: not running on {host}:{port}")
        return

    print(f"Status: running on {host}:{port}")
    databases = list_csv_chat_databases(host, port)
    if not databases:
        print("Databases: none seeded")
        return

    print("Databases:")
    for database in databases:
        print(f"- {database}")


def seed_databases(host: str, port: int, readonly_password: str) -> None:
    if not is_ready(host, port):
        raise SystemExit(f"Postgres is not running on {host}:{port}. Run `pnpm db:start` first.")

    admin_url = admin_database_url(host, port)
    provision_demo_database(
        admin_url=admin_url,
        database="csv_chat_demo",
        readonly_user="csv_chat_readonly",
        readonly_password=readonly_password,
    )
    print("Seeded demo database: csv_chat_demo")

    calibration_databases: list[tuple[str, str, str, Callable[[psycopg.Connection[Any]], None]]] = [
        ("retail", "csv_chat_retail_calibration", "csv_chat_retail_readonly", seed_retail_schema),
        ("finance", "csv_chat_finance_calibration", "csv_chat_finance_readonly", seed_finance_schema),
        ("saas", SAAS_DOMAIN.database, SAAS_DOMAIN.readonly_user, SAAS_DOMAIN.seed_schema),
        ("marketplace", MARKETPLACE_DOMAIN.database, MARKETPLACE_DOMAIN.readonly_user, MARKETPLACE_DOMAIN.seed_schema),
    ]
    for label, database, readonly_user, seed_schema in calibration_databases:
        provision_database(
            admin_url=admin_url,
            database=database,
            readonly_user=readonly_user,
            readonly_password=readonly_password,
            readonly_host=host,
            seed_schema=seed_schema,
        )
        print(f"Seeded {label} database: {database}")

    print("")
    print_urls(host, port, readonly_password)


def print_urls(host: str, port: int, readonly_password: str) -> None:
    urls = [
        ("Demo", "csv_chat_readonly", "csv_chat_demo"),
        ("Retail", "csv_chat_retail_readonly", "csv_chat_retail_calibration"),
        ("Finance", "csv_chat_finance_readonly", "csv_chat_finance_calibration"),
        ("SaaS complex", SAAS_DOMAIN.readonly_user, SAAS_DOMAIN.database),
        ("Marketplace complex", MARKETPLACE_DOMAIN.readonly_user, MARKETPLACE_DOMAIN.database),
    ]
    print("DATABASE_URL values:")
    for label, user, database in urls:
        print(f"{label}: postgresql://{user}:{readonly_password}@{host}:{port}/{database}")


def list_csv_chat_databases(host: str, port: int) -> list[str]:
    with psycopg.connect(admin_database_url(host, port), autocommit=True) as conn:
        rows = conn.execute(
            "select datname from pg_database where datname like 'csv_chat_%' order by datname"
        ).fetchall()
    return [str(row[0]) for row in rows]


def is_ready(host: str, port: int) -> bool:
    if shutil.which("pg_isready") is None:
        return False
    result = subprocess.run(
        ["pg_isready", "-h", host, "-p", str(port)],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return result.returncode == 0


def admin_database_url(host: str, port: int) -> str:
    return f"postgresql://postgres@{host}:{port}/postgres"


def require_command(name: str) -> None:
    if shutil.which(name) is None:
        raise SystemExit(f"`{name}` was not found. Install PostgreSQL client/server tools first.")


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def _data_dir(base_dir: Path) -> Path:
    return base_dir / "data"


def _socket_dir(base_dir: Path) -> Path:
    return base_dir / "socket"


def _log_file(base_dir: Path) -> Path:
    return base_dir / "postgres.log"


def _is_initialized(data_dir: Path) -> bool:
    return (data_dir / "PG_VERSION").exists()


if __name__ == "__main__":
    main()
