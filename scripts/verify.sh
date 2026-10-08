#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

for tool in npm cargo; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: Required verification tool '$tool' is not installed." >&2
    exit 1
  fi
done

echo "Checking frontend lint..."
npm run lint

echo "Checking frontend types..."
npm run typecheck

echo "Running frontend tests..."
npm test

echo "Auditing frontend dependencies..."
npm audit --audit-level=high

echo "Building frontend..."
npm run build

echo "Checking Rust formatting..."
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check

echo "Running Rust lint..."
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

echo "Running Rust tests..."
RUST_MIN_STACK=8388608 cargo test --manifest-path src-tauri/Cargo.toml --all-targets

echo "Building desktop application..."
npm run tauri build -- --no-bundle
