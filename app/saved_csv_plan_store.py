import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from pydantic import ValidationError

from app.models import CSVIntent, SavedCSVPlan


SAVED_CSV_PLAN_DIR = Path("data/saved_csv_plans")


class SavedCSVPlanStoreError(RuntimeError):
    pass


def create_saved_csv_plan(
    *,
    name: str,
    description: str | None,
    intent: CSVIntent,
    sql: str,
    schema_fingerprint: str | None,
    plan_dir: Path = SAVED_CSV_PLAN_DIR,
) -> SavedCSVPlan:
    now = datetime.now(UTC)
    plan = SavedCSVPlan(
        id=uuid4().hex,
        name=name.strip(),
        description=_clean_optional(description),
        intent=intent,
        sql=sql,
        created_at=now,
        updated_at=now,
        schema_fingerprint=schema_fingerprint,
        row_limit=intent.max_row_count,
    )
    return save_saved_csv_plan(plan, plan_dir)


def list_saved_csv_plans(plan_dir: Path = SAVED_CSV_PLAN_DIR) -> list[SavedCSVPlan]:
    if not plan_dir.exists():
        return []

    plans = [load_saved_csv_plan(path.stem, plan_dir) for path in sorted(plan_dir.glob("*.json"))]
    return sorted(plans, key=lambda plan: plan.updated_at, reverse=True)


def load_saved_csv_plan(plan_id: str, plan_dir: Path = SAVED_CSV_PLAN_DIR) -> SavedCSVPlan:
    path = _saved_csv_plan_path(plan_id, plan_dir)
    if not path.exists():
        raise SavedCSVPlanStoreError("Saved CSV not found.")

    try:
        return SavedCSVPlan.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise SavedCSVPlanStoreError(f"Saved CSV file is invalid: {exc}") from exc


def update_saved_csv_plan(
    plan_id: str,
    *,
    name: str,
    description: str | None,
    plan_dir: Path = SAVED_CSV_PLAN_DIR,
) -> SavedCSVPlan:
    plan = load_saved_csv_plan(plan_id, plan_dir)
    plan.name = name.strip()
    plan.description = _clean_optional(description)
    plan.updated_at = datetime.now(UTC)
    return save_saved_csv_plan(plan, plan_dir)


def mark_saved_csv_plan_run(
    plan_id: str,
    *,
    export_id: str,
    plan_dir: Path = SAVED_CSV_PLAN_DIR,
) -> SavedCSVPlan:
    plan = load_saved_csv_plan(plan_id, plan_dir)
    plan.last_run_at = datetime.now(UTC)
    plan.last_export_id = export_id
    plan.updated_at = plan.last_run_at
    return save_saved_csv_plan(plan, plan_dir)


def delete_saved_csv_plan(plan_id: str, plan_dir: Path = SAVED_CSV_PLAN_DIR) -> None:
    path = _saved_csv_plan_path(plan_id, plan_dir)
    if not path.exists():
        raise SavedCSVPlanStoreError("Saved CSV not found.")
    path.unlink()


def save_saved_csv_plan(plan: SavedCSVPlan, plan_dir: Path = SAVED_CSV_PLAN_DIR) -> SavedCSVPlan:
    plan_dir.mkdir(parents=True, exist_ok=True)
    _saved_csv_plan_path(plan.id, plan_dir).write_text(
        json.dumps(plan.model_dump(mode="json"), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return plan


def _saved_csv_plan_path(plan_id: str, plan_dir: Path) -> Path:
    if not plan_id or any(character in plan_id for character in ("/", "\\", ".")):
        raise SavedCSVPlanStoreError("Invalid saved CSV id.")
    return plan_dir / f"{plan_id}.json"


def _clean_optional(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None
