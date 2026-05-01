from pathlib import Path

import pytest

from app.export_service import ExportError, create_export, export_path
from app.models import CSVColumnIntent, CSVIntent, ContextPolicy


def intent(columns: list[str], max_row_count: int = 100) -> CSVIntent:
    return CSVIntent(
        summary="Customer export",
        row_meaning="One row per customer",
        columns=[CSVColumnIntent(name=column, description=column) for column in columns],
        max_row_count=max_row_count,
    )


def test_create_export_writes_csv(tmp_path: Path) -> None:
    response = create_export(
        intent=intent(["email", "note"]),
        sql="select email, note from customers limit 10",
        policy=ContextPolicy(max_row_count=100),
        query_runner=lambda sql: [{"email": "a@example.com", "note": "=1+1"}],
        export_dir=tmp_path,
    )

    assert response.row_count == 1
    assert response.columns == ["email", "note"]
    assert response.download_url == f"/exports/{response.export_id}/download"
    assert (tmp_path / f"{response.export_id}.csv").read_text(encoding="utf-8") == (
        "email,note\na@example.com,'=1+1\n"
    )


def test_create_export_rejects_invalid_sql(tmp_path: Path) -> None:
    with pytest.raises(ExportError, match="SQL validation failed"):
        create_export(
            intent=intent(["email"]),
            sql="delete from customers",
            policy=ContextPolicy(),
            query_runner=lambda sql: [],
            export_dir=tmp_path,
        )


def test_create_export_rejects_sql_with_wrong_output_columns(tmp_path: Path) -> None:
    with pytest.raises(ExportError, match="output columns"):
        create_export(
            intent=intent(["email", "status"]),
            sql="select email, created_at from customers limit 10",
            policy=ContextPolicy(),
            query_runner=lambda sql: [{"email": "a@example.com", "created_at": "2026-01-01"}],
            export_dir=tmp_path,
        )


def test_create_export_rejects_missing_expected_column(tmp_path: Path) -> None:
    with pytest.raises(ExportError, match="missing expected CSV columns"):
        create_export(
            intent=intent(["email", "status"]),
            sql="select email, status from customers limit 10",
            policy=ContextPolicy(),
            query_runner=lambda sql: [{"email": "a@example.com"}],
            export_dir=tmp_path,
        )


def test_create_export_rejects_too_many_rows(tmp_path: Path) -> None:
    with pytest.raises(ExportError, match="row limit"):
        create_export(
            intent=intent(["email"], max_row_count=1),
            sql="select email from customers limit 10",
            policy=ContextPolicy(max_row_count=10),
            query_runner=lambda sql: [{"email": "a@example.com"}, {"email": "b@example.com"}],
            export_dir=tmp_path,
        )


def test_create_export_rejects_too_many_bytes(tmp_path: Path) -> None:
    with pytest.raises(ExportError, match="byte export limit"):
        create_export(
            intent=intent(["email"]),
            sql="select email from customers limit 10",
            policy=ContextPolicy(max_export_bytes=5),
            query_runner=lambda sql: [{"email": "a@example.com"}],
            export_dir=tmp_path,
        )

    assert list(tmp_path.iterdir()) == []


def test_export_path_rejects_path_traversal() -> None:
    with pytest.raises(ExportError):
        export_path("../secret")
