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

apt_hint() {
  if command -v apt-get >/dev/null 2>&1; then
    printf 'On Ubuntu/WSL, run:\n  sudo apt update\n  sudo apt install -y %s\n' "$1" >&2
  fi
}

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    if [ "$#" -ge 3 ]; then
      apt_hint "$3"
    fi
    fail "$2"
  fi
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return
  fi

  need_command corepack "pnpm was not found and Corepack was not found. Install Node.js 20.19 or newer, then run this script again."

  info "pnpm was not found; enabling it with Corepack"
  pnpm_spec="$(node -p "require('./package.json').packageManager")"
  corepack enable
  corepack prepare "$pnpm_spec" --activate
  hash -r

  if ! command -v pnpm >/dev/null 2>&1; then
    fail "pnpm is still not available after enabling Corepack. Close and reopen your shell, then run this script again."
  fi
}

ensure_clean_ownership() {
  for path in .venv node_modules; do
    if [ -e "$path" ] && [ ! -w "$path" ]; then
      fail "$path is not writable by $USER. It may have been created with sudo. Run: sudo chown -R \"$USER:$USER\" $path"
    fi
  done
}

ensure_python_venv_support() {
  if python3 -m venv --help >/dev/null 2>&1; then
    return
  fi

  apt_hint "python3-venv python3-pip"
  fail "Python venv support is missing. Install python3-venv and python3-pip, then run this script again."
}

ensure_venv_pip() {
  if .venv/bin/python -m pip --version >/dev/null 2>&1; then
    return
  fi

  apt_hint "python3-venv python3-pip"
  fail "pip is missing inside .venv. Install python3-venv and python3-pip, then run: rm -rf .venv && ./tools/setup_local.sh"
}

info "CSV Chat local setup"
info ""

if [ "${EUID:-$(id -u)}" -eq 0 ]; then
  fail "Do not run this script with sudo. Run ./tools/setup_local.sh as your normal WSL user."
fi

ensure_clean_ownership

need_command python3 "python3 was not found. Install Python 3.11 or newer, then run this script again." "python3 python3-venv python3-pip"
need_command node "Node.js was not found. Install Node.js 20.19 or newer, then run this script again."

python3 - <<'PY'
import sys

if sys.version_info < (3, 11):
    raise SystemExit("Python 3.11 or newer is required.")
PY

node - <<'JS'
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 20 || (major === 20 && minor < 19)) {
  throw new Error("Node.js 20.19 or newer is required.");
}
JS

ensure_pnpm
ensure_python_venv_support

if [ ! -d ".venv" ]; then
  info "Creating Python virtual environment in .venv"
  python3 -m venv .venv
else
  info "Using existing .venv"
fi

info "Installing Python dependencies"
ensure_venv_pip
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
info "1. For demo data, run: pnpm db:start && pnpm db:seed && pnpm db:urls"
info "2. For real Windows/pgAdmin data, export a backup and run: pnpm db:import /mnt/c/Users/YOU/Downloads/app.backup app_copy"
info "3. Run: pnpm dev:app"
info "4. Open: http://127.0.0.1:5173"
info "5. In Settings, add a model provider and prepare database context."
info ""
info "To check what is missing later, run: pnpm check:setup"
info "For a full local setup diagnosis, run: pnpm run doctor"
