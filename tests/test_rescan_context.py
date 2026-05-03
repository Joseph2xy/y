from app.models import ContextScanResponse, ContextDocument, ContextPolicy, SchemaContext
from tools import rescan_context


def test_rescan_context_reports_updated_files(monkeypatch, capsys) -> None:
    response = ContextScanResponse(
        context=ContextDocument(
            context="# Context\n",
            schema_context=SchemaContext(),
            policy=ContextPolicy(),
        ).context,
        schema_context=SchemaContext(),
        policy=ContextPolicy(),
        table_count=2,
        column_count=7,
    )
    monkeypatch.setattr(rescan_context, "scan_context", lambda: response)

    assert rescan_context.main() == 0

    output = capsys.readouterr().out
    assert "Context rescan complete." in output
    assert "Tables: 2" in output
    assert "Updated: data/context/schema.json" in output
    assert "Preserved: data/context/context.md" in output
