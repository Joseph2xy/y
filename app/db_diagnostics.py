from __future__ import annotations

import socket
from dataclasses import dataclass
from urllib.parse import unquote, urlparse

import psycopg
from psycopg import errors


@dataclass(frozen=True)
class DatabaseUrlInfo:
    raw_url: str
    host: str
    port: int
    database: str
    username: str | None

    @property
    def safe_label(self) -> str:
        user = f"{self.username}@" if self.username else ""
        return f"{user}{self.host}:{self.port}/{self.database}"


@dataclass(frozen=True)
class DatabaseDiagnostic:
    ok: bool
    summary: str
    detail: str | None = None
    next_step: str | None = None


def parse_database_url(database_url: str) -> DatabaseUrlInfo:
    parsed = urlparse(database_url)
    if parsed.scheme not in {"postgresql", "postgres"}:
        raise ValueError("DATABASE_URL must start with postgresql://")
    if not parsed.hostname:
        raise ValueError("DATABASE_URL is missing a host.")
    database = unquote(parsed.path.lstrip("/"))
    if not database:
        raise ValueError("DATABASE_URL is missing a database name.")
    return DatabaseUrlInfo(
        raw_url=database_url,
        host=parsed.hostname,
        port=parsed.port or 5432,
        database=database,
        username=unquote(parsed.username) if parsed.username else None,
    )


def test_tcp_reachability(info: DatabaseUrlInfo, timeout_seconds: float = 3.0) -> DatabaseDiagnostic:
    try:
        with socket.create_connection((info.host, info.port), timeout=timeout_seconds):
            pass
    except socket.timeout:
        return DatabaseDiagnostic(
            ok=False,
            summary=f"Timed out reaching {info.host}:{info.port}.",
            detail="The host/port is not reachable from this shell.",
            next_step=_network_next_step(info),
        )
    except OSError as exc:
        return DatabaseDiagnostic(
            ok=False,
            summary=f"Could not reach {info.host}:{info.port}.",
            detail=str(exc),
            next_step=_network_next_step(info),
        )
    return DatabaseDiagnostic(ok=True, summary=f"Reached {info.host}:{info.port}.")


def test_postgres_login(database_url: str) -> DatabaseDiagnostic:
    try:
        with psycopg.connect(database_url, connect_timeout=5) as conn:
            conn.execute("select 1")
    except errors.InvalidPassword:
        return DatabaseDiagnostic(
            ok=False,
            summary="Postgres rejected the username or password.",
            next_step="Check the username and password in DATABASE_URL.",
        )
    except errors.InvalidCatalogName:
        return DatabaseDiagnostic(
            ok=False,
            summary="Postgres says the database does not exist.",
            next_step="Check the database name at the end of DATABASE_URL.",
        )
    except errors.InsufficientPrivilege:
        return DatabaseDiagnostic(
            ok=False,
            summary="The database user does not have enough permission.",
            next_step="Use a read-only user with CONNECT plus SELECT access to the needed schemas.",
        )
    except psycopg.OperationalError as exc:
        text = str(exc)
        if "no pg_hba.conf entry" in text:
            return DatabaseDiagnostic(
                ok=False,
                summary="Postgres is reachable, but pg_hba.conf does not allow this connection.",
                detail=text,
                next_step="Allow this WSL host/user/database in pg_hba.conf, then restart Postgres.",
            )
        if "connection timeout expired" in text or "timeout expired" in text:
            return DatabaseDiagnostic(
                ok=False,
                summary="Postgres connection timed out.",
                detail=text,
                next_step="Check the host, port, firewall, and Postgres listen_addresses setting.",
            )
        if "Connection refused" in text or "connection refused" in text:
            return DatabaseDiagnostic(
                ok=False,
                summary="Postgres refused the connection.",
                detail=text,
                next_step="Make sure Postgres is running and listening on the configured host/port.",
            )
        return DatabaseDiagnostic(
            ok=False,
            summary="Postgres connection failed.",
            detail=text,
            next_step="Check DATABASE_URL and run pnpm db:test-url for a focused diagnosis.",
        )
    except Exception as exc:
        return DatabaseDiagnostic(
            ok=False,
            summary="Database check failed.",
            detail=str(exc),
            next_step="Check DATABASE_URL and run pnpm db:test-url for a focused diagnosis.",
        )
    return DatabaseDiagnostic(ok=True, summary="Postgres login worked and select 1 succeeded.")


def diagnose_database_url(database_url: str) -> tuple[DatabaseUrlInfo | None, list[DatabaseDiagnostic]]:
    try:
        info = parse_database_url(database_url)
    except ValueError as exc:
        return None, [
            DatabaseDiagnostic(
                ok=False,
                summary=str(exc),
                next_step="Set DATABASE_URL like postgresql://USER:PASSWORD@HOST:5432/DB_NAME.",
            )
        ]

    tcp = test_tcp_reachability(info)
    diagnostics = [tcp]
    if tcp.ok:
        diagnostics.append(test_postgres_login(database_url))
    return info, diagnostics


def explain_database_failure(exc: Exception, database_url: str | None = None) -> str:
    if not isinstance(exc, psycopg.Error):
        return str(exc)
    if database_url:
        info, diagnostics = diagnose_database_url(database_url)
        lines: list[str] = []
        if info:
            lines.append(f"Database: {info.safe_label}")
        for diagnostic in diagnostics:
            lines.append(diagnostic.summary)
            if diagnostic.next_step:
                lines.append(f"Next step: {diagnostic.next_step}")
            if not diagnostic.ok:
                break
        return "\n".join(lines)
    return str(exc)


def _network_next_step(info: DatabaseUrlInfo) -> str:
    if info.host in {"localhost", "127.0.0.1", "::1"}:
        return (
            "If Postgres is running on Windows and this command is running in WSL, "
            "use the WSL gateway IP instead of localhost."
        )
    return (
        "Check that Postgres is running, Windows Firewall allows TCP "
        f"{info.port}, and Postgres listens on this address."
    )
