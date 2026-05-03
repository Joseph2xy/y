from __future__ import annotations

from datetime import UTC, datetime
from hashlib import sha256

from psycopg.conninfo import conninfo_to_dict

from app.models import DatabaseSource


def database_source_from_url(database_url: str, *, scanned_at: datetime | None = None) -> DatabaseSource:
    parts = conninfo_to_dict(database_url)
    host = _blank_to_none(parts.get("host"))
    port = _blank_to_none(parts.get("port")) or "5432"
    database = _blank_to_none(parts.get("dbname"))
    identity = _identity(host=host, port=port, database=database)
    return DatabaseSource(
        host=host,
        port=port,
        database=database,
        scanned_at=scanned_at or datetime.now(UTC),
        fingerprint=_fingerprint(identity),
    )


def database_sources_match(left: DatabaseSource | None, right: DatabaseSource | None) -> bool:
    if left is None or right is None:
        return False
    return left.fingerprint == right.fingerprint


def database_source_label(source: DatabaseSource | None) -> str:
    if source is None:
        return "unknown database"
    host = source.host or "default host"
    database = source.database or "default database"
    if source.port:
        host = f"{host}:{source.port}"
    return f"{database} on {host}"


def _blank_to_none(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


def _identity(*, host: str | None, port: str | None, database: str | None) -> str:
    return "|".join((host or "", port or "", database or ""))


def _fingerprint(identity: str) -> str:
    return sha256(identity.encode("utf-8")).hexdigest()
