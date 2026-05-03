#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

info() {
  printf '%s\n' "$1"
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "$2"
  fi
}

info "CSV Chat local setup"
info ""

need_command python3 "python3 was not found. Install Python 3.11 or newer, then run this script again."
need_command pnpm "pnpm was not found. Install Node.js and pnpm, then run this script again."

python3 - <<'PY'
import sys

if sys.version_info < (3, 11):
    raise SystemExit("Python 3.11 or newer is required.")
PY

if [ ! -d ".venv" ]; then
  info "Creating Python virtual environment in .venv"
  python3 -m venv .venv
else
  info "Using existing .venv"
fi

info "Installing Python dependencies"
.venv/bin/python -m pip install -e '.[test]'

info "Installing frontend dependencies"
pnpm install

if [ ! -f ".env" ]; then
  info "Creating .env from .env.example"
  cp .env.example .env
else
  info "Keeping existing .env"
fi

info ""
info "Next steps:"
info "1. Edit .env with a read-only DATABASE_URL and model provider key."
info "2. Run: pnpm check:setup"
info "3. Run: pnpm dev:app"
info "4. Open: http://127.0.0.1:5173"
