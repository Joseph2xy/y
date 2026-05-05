from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.db_diagnostics import diagnose_database_url


def main() -> int:
    load_dotenv(ROOT / ".env")
    checks: list[tuple[str, bool, str]] = []

    checks.append(check_python())
    checks.append(check_venv())
    checks.append(check_node())
    checks.append(check_pnpm())
    checks.append(check_env_file())
    checks.extend(check_database_url())

    print("CSV Chat doctor")
    print("")
    for label, ok, message in checks:
        marker = "OK" if ok else "FAIL"
        print(f"[{marker}] {label}: {message}")

    failures = [check for check in checks if not check[1]]
    if failures:
        print("")
        print("Fix the FAIL items above, then rerun: pnpm doctor")
        return 1

    print("")
    print("Local setup checks passed.")
    return 0


def check_python() -> tuple[str, bool, str]:
    version = sys.version_info
    label = "Python"
    if version < (3, 11):
        return label, False, "Python 3.11 or newer is required."
    return label, True, f"{version.major}.{version.minor}.{version.micro}"


def check_venv() -> tuple[str, bool, str]:
    pip_path = ROOT / ".venv" / "bin" / "pip"
    python_path = ROOT / ".venv" / "bin" / "python"
    if not python_path.exists():
        return (
            "Python venv",
            False,
            "Missing .venv. Run: sudo apt install -y python3-venv python3-pip && ./tools/setup_local.sh",
        )
    if not pip_path.exists():
        return (
            "Python venv",
            False,
            "Missing pip inside .venv. Run: sudo apt install -y python3-venv python3-pip && rm -rf .venv && ./tools/setup_local.sh",
        )
    return "Python venv", True, ".venv exists and has pip"


def check_node() -> tuple[str, bool, str]:
    node = shutil.which("node")
    if node is None:
        return "Node.js", False, "Missing node. Install Node.js 20.19 or newer."
    result = run([node, "-p", "process.versions.node"])
    if result.returncode != 0:
        return "Node.js", False, result.stderr.strip() or "Could not read Node.js version."
    version_text = result.stdout.strip()
    major, minor, *_ = [int(part) for part in version_text.split(".")]
    if major < 20 or (major == 20 and minor < 19):
        return "Node.js", False, f"{version_text}; Node.js 20.19 or newer is required."
    return "Node.js", True, version_text


def check_pnpm() -> tuple[str, bool, str]:
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        if shutil.which("corepack") is not None:
            return "pnpm", False, "Missing pnpm. Run: corepack prepare pnpm@10.33.2 --activate"
        return "pnpm", False, "Missing pnpm and Corepack. Install Node.js 20.19 or newer."
    result = run([pnpm, "--version"])
    if result.returncode != 0:
        return "pnpm", False, result.stderr.strip() or "Could not read pnpm version."
    return "pnpm", True, result.stdout.strip()


def check_env_file() -> tuple[str, bool, str]:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return ".env", False, "Missing .env. Run ./tools/setup_local.sh, then set DATABASE_URL."
    return ".env", True, ".env exists"


def check_database_url() -> list[tuple[str, bool, str]]:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        return [
            (
                "DATABASE_URL",
                False,
                "Not set. Add DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB_NAME to .env.",
            )
        ]

    info, diagnostics = diagnose_database_url(database_url)
    checks: list[tuple[str, bool, str]] = []
    if info:
        checks.append(("DATABASE_URL", True, info.safe_label))
    for diagnostic in diagnostics:
        message = diagnostic.summary
        if diagnostic.detail:
            message = f"{message} {diagnostic.detail}"
        if diagnostic.next_step and not diagnostic.ok:
            message = f"{message} Next step: {diagnostic.next_step}"
        checks.append(("Database", diagnostic.ok, message))
        if not diagnostic.ok:
            break
    return checks


def run(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)


if __name__ == "__main__":
    raise SystemExit(main())
