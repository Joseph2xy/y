import csv
from pathlib import Path
from typing import Any, Iterable


FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")
FORMULA_LEADING_WHITESPACE = (" ", "\t", "\r", "\n")


def escape_csv_cell(value: Any) -> Any:
    if isinstance(value, str) and (
        value.startswith(FORMULA_PREFIXES)
        or value.lstrip("".join(FORMULA_LEADING_WHITESPACE)).startswith(("=", "+", "-", "@"))
    ):
        return "'" + value
    return value


def write_csv(path: Path, columns: list[str], rows: Iterable[dict[str, Any]]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    row_count = 0

    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()

        for row in rows:
            writer.writerow({column: escape_csv_cell(row.get(column, "")) for column in columns})
            row_count += 1

    return row_count


def count_csv_bytes(path: Path) -> int:
    return path.stat().st_size
