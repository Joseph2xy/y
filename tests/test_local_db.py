from pathlib import Path

import pytest

from tools import local_db


def test_write_database_url_creates_env_file(tmp_path: Path) -> None:
    env_path = tmp_path / ".env"

    local_db.write_database_url(env_path, "postgresql://user:pass@127.0.0.1:5432/appdb")

    assert env_path.read_text(encoding="utf-8") == "DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/appdb\n"


def test_write_database_url_replaces_existing_value(tmp_path: Path) -> None:
    env_path = tmp_path / ".env"
    env_path.write_text("OTHER=value\nDATABASE_URL=old\n", encoding="utf-8")

    local_db.write_database_url(env_path, "postgresql://user:pass@127.0.0.1:5432/appdb")

    assert env_path.read_text(encoding="utf-8") == "OTHER=value\nDATABASE_URL=postgresql://user:pass@127.0.0.1:5432/appdb\n"


def test_validate_database_identifier_rejects_shell_like_values() -> None:
    with pytest.raises(SystemExit) as exc_info:
        local_db.validate_database_identifier("customer-copy;drop", "database")

    assert "Invalid database" in str(exc_info.value)


def test_database_url_percent_encodes_auth_values() -> None:
    assert (
        local_db.database_url("127.0.0.1", 5432, "csv user", "appdb", password="p@ss word")
        == "postgresql://csv%20user:p%40ss%20word@127.0.0.1:5432/appdb"
    )


def test_restore_backup_uses_psql_for_plain_sql(tmp_path: Path, monkeypatch) -> None:
    commands: list[list[str]] = []
    backup = tmp_path / "backup.sql"
    backup.write_text("select 1;", encoding="utf-8")
    monkeypatch.setattr(local_db, "run", commands.append)

    local_db.restore_backup(backup, "postgresql://postgres@127.0.0.1:5432/customer_copy")

    assert commands == [["psql", "postgresql://postgres@127.0.0.1:5432/customer_copy", "-v", "ON_ERROR_STOP=1", "-f", str(backup)]]


def test_restore_backup_uses_pg_restore_for_custom_backup(tmp_path: Path, monkeypatch) -> None:
    commands: list[list[str]] = []
    backup = tmp_path / "backup.backup"
    backup.write_bytes(b"PGDMP")
    monkeypatch.setattr(local_db, "require_command", lambda name: None)
    monkeypatch.setattr(local_db, "run", commands.append)

    local_db.restore_backup(backup, "postgresql://postgres@127.0.0.1:5432/customer_copy")

    assert commands == [
        [
            "pg_restore",
            "--dbname",
            "postgresql://postgres@127.0.0.1:5432/customer_copy",
            "--no-owner",
            "--no-acl",
            "--exit-on-error",
            str(backup),
        ]
    ]
