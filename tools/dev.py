from __future__ import annotations

import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND_URL = "http://127.0.0.1:8000"
FRONTEND_URL = "http://127.0.0.1:5173"


def main() -> int:
    missing = missing_prerequisites()
    if missing:
        for message in missing:
            print(message, file=sys.stderr)
        return 1

    processes: list[subprocess.Popen[bytes]] = []
    stopping = False

    def stop_processes(*_: object) -> None:
        nonlocal stopping
        if stopping:
            return
        stopping = True
        for process in processes:
            if process.poll() is None:
                process.terminate()
        deadline = time.monotonic() + 8
        for process in processes:
            remaining = max(0, deadline - time.monotonic())
            try:
                process.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                process.kill()

    signal.signal(signal.SIGINT, stop_processes)
    signal.signal(signal.SIGTERM, stop_processes)

    try:
        processes.append(
            subprocess.Popen(
                [str(ROOT / ".venv/bin/python"), "-m", "uvicorn", "app.main:app", "--reload"],
                cwd=ROOT,
            )
        )
        processes.append(subprocess.Popen(["pnpm", "dev"], cwd=ROOT))
        print(f"Backend:  {BACKEND_URL}")
        print(f"Frontend: {FRONTEND_URL}")
        print("Press Ctrl+C to stop both servers.")

        while True:
            for process in processes:
                return_code = process.poll()
                if return_code is not None:
                    stop_processes()
                    return return_code
            time.sleep(0.5)
    finally:
        stop_processes()


def missing_prerequisites() -> list[str]:
    missing: list[str] = []
    if not (ROOT / ".venv/bin/python").exists():
        missing.append("Missing .venv. Run: python3 -m venv .venv && .venv/bin/python -m pip install -e '.[test]'")
    if shutil.which("pnpm") is None:
        missing.append("Missing pnpm. Install pnpm, then run: pnpm install")
    if not (ROOT / "node_modules").exists():
        missing.append("Missing node_modules. Run: pnpm install")
    return missing


if __name__ == "__main__":
    raise SystemExit(main())
