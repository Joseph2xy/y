from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import psycopg
from psycopg import sql

from tools.calibration import provision_database
from tools.complex_calibration import MARKETPLACE_DOMAIN, SAAS_DOMAIN
from tools.finance_calibration import seed_schema as seed_finance_schema
from tools.realistic_calibration import seed_schema as seed_retail_schema


DEFAULT_BASE_DIR = Path.home() / ".local" / "share" / "csv-chat-pg"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 5432
DEFAULT_READONLY_PASSWORD = "readonly"
DEFAULT_IMPORTED_READONLY_USER = "csv_chat_import_readonly"
ROOT = Path(__file__).resolve().parents[1]


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
    elif args.command == "import":
        import_database(
            backup_path=args.backup_path.expanduser(),
            database=args.database,
            base_dir=base_dir,
            host=args.host,
            port=args.port,
            readonly_user=args.readonly_user,
            readonly_password=args.readonly_password,
            write_env=not args.no_write_env,
            replace=not args.no_replace,
        )
    else:
        raise SystemExit(f"Unknown command: {args.command}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Manage the persistent local CSV Chat Postgres cluster.")
    parser.add_argument(
        "--base-dir",
        type=Path,
        default=DEFAULT_BASE_DIR,
        help=f"Persistent Postgres cluster directory parent. Default: {DEFAULT_BASE_DIR}",
    )
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--readonly-password", default=DEFAULT_READONLY_PASSWORD)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("init", "start", "stop", "status", "seed", "urls"):
        subparsers.add_parser(command)

    import_parser = subparsers.add_parser(
        "import",
        help="Import a pgAdmin/Postgres backup into the local WSL Postgres cluster.",
    )
    import_parser.add_argument("backup_path", type=Path, help="Path to a .backup/.dump/.sql file.")
    import_parser.add_argument("database", help="Local database name to create or replace.")
    import_parser.add_argument(
        "--readonly-user",
        default=DEFAULT_IMPORTED_READONLY_USER,
        help=f"Read-only user created for CSV Chat. Default: {DEFAULT_IMPORTED_READONLY_USER}",
    )
    import_parser.add_argument(
        "--no-write-env",
        action="store_true",
        help="Print the DATABASE_URL without writing it to .env.",
    )
    import_parser.add_argument(
        "--no-replace",
        action="store_true",
        help="Fail if the target database already exists instead of replacing it.",
    )
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
    provision_database(
        admin_url=admin_url,
        database="csv_chat_demo",
        readonly_user="csv_chat_readonly",
        readonly_password=readonly_password,
        readonly_host=host,
        seed_schema=seed_demo_schema,
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


def import_database(
    *,
    backup_path: Path,
    database: str,
    base_dir: Path,
    host: str,
    port: int,
    readonly_user: str,
    readonly_password: str,
    write_env: bool,
    replace: bool,
) -> None:
    require_command("createdb")
    require_command("psql")
    validate_database_identifier(database, "database")
    validate_database_identifier(readonly_user, "readonly user")
    if not backup_path.exists():
        raise SystemExit(f"Backup file not found: {backup_path}")
    if not backup_path.is_file():
        raise SystemExit(f"Backup path is not a file: {backup_path}")

    start_cluster(base_dir, host, port)
    admin_url = admin_database_url(host, port)
    target_url = database_url(host, port, "postgres", database)

    if replace:
        drop_database_if_exists(admin_url, database)
    elif database_exists(admin_url, database):
        raise SystemExit(f"Database already exists: {database}. Use the default replace behavior or choose another name.")

    run(["createdb", "-h", host, "-p", str(port), "-U", "postgres", database])
    try:
        restore_backup(backup_path, target_url)
        configure_readonly_user(
            admin_url=admin_url,
            database_url=target_url,
            database=database,
            readonly_user=readonly_user,
            readonly_password=readonly_password,
        )
    except Exception:
        if replace:
            drop_database_if_exists(admin_url, database)
        raise

    readonly_url = database_url(host, port, readonly_user, database, password=readonly_password)
    print("")
    print("Imported database for CSV Chat.")
    print(f"Database: {database}")
    print(f"Read-only user: {readonly_user}")
    print(f"DATABASE_URL={readonly_url}")
    if write_env:
        write_database_url(ROOT / ".env", readonly_url)
        os.environ["DATABASE_URL"] = readonly_url
        print("Updated .env with this DATABASE_URL.")
    else:
        print("Skipped .env update.")
    print("")
    print("Next steps:")
    print("1. Run: pnpm db:test-url")
    print("2. Run: pnpm rescan:context")
    print("3. Run: pnpm dev:app")


def restore_backup(backup_path: Path, target_url: str) -> None:
    suffix = backup_path.suffix.lower()
    if suffix == ".sql":
        run(["psql", target_url, "-v", "ON_ERROR_STOP=1", "-f", str(backup_path)])
        return

    require_command("pg_restore")
    run(
        [
            "pg_restore",
            "--dbname",
            target_url,
            "--no-owner",
            "--no-acl",
            "--exit-on-error",
            str(backup_path),
        ]
    )


def configure_readonly_user(
    *,
    admin_url: str,
    database_url: str,
    database: str,
    readonly_user: str,
    readonly_password: str,
) -> None:
    with psycopg.connect(admin_url, autocommit=True) as conn:
        row = conn.execute("select 1 from pg_roles where rolname = %s", (readonly_user,)).fetchone()
        if row is None:
            conn.execute(
                sql.SQL("create role {} login password {}").format(
                    sql.Identifier(readonly_user),
                    sql.Literal(readonly_password),
                )
            )
        else:
            conn.execute(
                sql.SQL("alter role {} with login password {}").format(
                    sql.Identifier(readonly_user),
                    sql.Literal(readonly_password),
                )
            )
        conn.execute(
            sql.SQL("grant connect on database {} to {}").format(
                sql.Identifier(database),
                sql.Identifier(readonly_user),
            )
        )

    with psycopg.connect(database_url, autocommit=True) as conn:
        rows = conn.execute(
            """
            select schema_name
            from information_schema.schemata
            where schema_name <> 'information_schema'
              and schema_name not like 'pg_%'
            order by schema_name
            """
        ).fetchall()
        schemas = [str(row[0]) for row in rows]
        for schema_name in schemas:
            conn.execute(
                sql.SQL("grant usage on schema {} to {}").format(
                    sql.Identifier(schema_name),
                    sql.Identifier(readonly_user),
                )
            )
            conn.execute(
                sql.SQL("grant select on all tables in schema {} to {}").format(
                    sql.Identifier(schema_name),
                    sql.Identifier(readonly_user),
                )
            )
            conn.execute(
                sql.SQL("grant select on all sequences in schema {} to {}").format(
                    sql.Identifier(schema_name),
                    sql.Identifier(readonly_user),
                )
            )


def drop_database_if_exists(admin_url: str, database: str) -> None:
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute("select pg_terminate_backend(pid) from pg_stat_activity where datname = %s", (database,))
        conn.execute(sql.SQL("drop database if exists {}").format(sql.Identifier(database)))


def database_exists(admin_url: str, database: str) -> bool:
    with psycopg.connect(admin_url, autocommit=True) as conn:
        row = conn.execute("select 1 from pg_database where datname = %s", (database,)).fetchone()
    return row is not None


def database_url(host: str, port: int, user: str, database: str, *, password: str | None = None) -> str:
    auth = quote(user, safe="")
    if password is not None:
        auth = f"{auth}:{quote(password, safe='')}"
    return f"postgresql://{auth}@{host}:{port}/{quote(database, safe='')}"


def validate_database_identifier(value: str, label: str) -> None:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,62}", value):
        raise SystemExit(
            f"Invalid {label}: {value!r}. Use letters, numbers, and underscores, starting with a letter or underscore."
        )


def write_database_url(env_path: Path, database_url_value: str) -> None:
    line = f"DATABASE_URL={database_url_value}"
    if not env_path.exists():
        env_path.write_text(line + "\n", encoding="utf-8")
        return

    lines = env_path.read_text(encoding="utf-8").splitlines()
    for index, existing in enumerate(lines):
        if existing.startswith("DATABASE_URL="):
            lines[index] = line
            break
    else:
        if lines and lines[-1].strip():
            lines.append("")
        lines.append(line)
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


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


def seed_demo_schema(conn: psycopg.Connection[Any]) -> None:
    conn.execute(
        """
        create table accounts (
          id integer primary key,
          name text not null,
          plan text not null
        )
        """
    )
    conn.execute(
        """
        create table customers (
          id integer primary key,
          account_id integer not null references accounts(id),
          email text not null,
          full_name text not null,
          status text not null,
          created_at date not null
        )
        """
    )
    conn.execute(
        """
        insert into accounts (id, name, plan) values
          (1, 'Acme Co', 'Pro'),
          (2, 'Globex', 'Starter'),
          (3, 'Initech', 'Enterprise')
        """
    )
    conn.execute(
        """
        insert into customers (id, account_id, email, full_name, status, created_at) values
          (1, 1, 'ada@example.com', 'Ada Lovelace', 'active', date '2026-04-12'),
          (2, 1, 'grace@example.com', 'Grace Hopper', 'active', date '2026-03-09'),
          (3, 2, 'alan@example.com', 'Alan Turing', 'inactive', date '2026-02-01'),
          (4, 3, 'katherine@example.com', 'Katherine Johnson', 'active', date '2026-01-17'),
          (5, 2, 'margaret@example.com', 'Margaret Hamilton', 'active', date '2025-12-28')
        """
    )


if __name__ == "__main__":
    main()
