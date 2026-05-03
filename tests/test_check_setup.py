from app.context_store import ensure_context_files
from app.database_identity import database_source_from_url
from app.models import SchemaContext
import app.main as main
from tools import check_setup


PROVIDER_ENV_VARS = (
    "MODEL_NAME",
    "LITELLM_MODEL",
    "MODEL_API_KEY",
    "LITELLM_API_KEY",
    "MODEL_BASE_URL",
    "LITELLM_API_BASE",
    "WORKER_LLM_PROVIDER",
    "WORKER_OPENROUTER_MODEL",
    "OPENROUTER_API_KEY",
)


def clear_provider_env(monkeypatch) -> None:
    for name in PROVIDER_ENV_VARS:
        monkeypatch.delenv(name, raising=False)


def test_check_setup_returns_nonzero_when_setup_is_incomplete(tmp_path, monkeypatch, capsys) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    clear_provider_env(monkeypatch)

    assert check_setup.main() == 1

    output = capsys.readouterr().out
    assert "Ready: False" in output
    assert "Next action: configure_database" in output
    assert "edit .env and set DATABASE_URL" in output


def test_check_setup_returns_zero_when_setup_is_ready(tmp_path, monkeypatch, capsys) -> None:
    monkeypatch.chdir(tmp_path)
    database_url = "postgresql://readonly:password@localhost:5432/appdb"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("MODEL_NAME", "openrouter/openai/gpt-4o-mini")
    monkeypatch.setenv("MODEL_API_KEY", "sk-or-test")
    monkeypatch.setattr(main, "test_database_connection", lambda database_url: None)
    ensure_context_files(schema=SchemaContext(source=database_source_from_url(database_url)))

    assert check_setup.main() == 0

    output = capsys.readouterr().out
    assert "Ready: True" in output
    assert "Database: ready" in output
    assert "Model provider: ready" in output
    assert "Context: ready" in output
    assert "Context scanned from: appdb on localhost:5432" in output
    assert "run `pnpm dev:app`" in output
