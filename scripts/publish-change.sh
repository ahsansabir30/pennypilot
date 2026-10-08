
#!/usr/bin/env bash
set -euo pipefail

# Usage:
# ./scripts/publish-change.sh "feat: add dashboard"

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "Usage: $0 'type: description'"
  exit 1
fi

MESSAGE="$1"
BRANCH="$(git branch --show-current)"

if [[ -z "$BRANCH" ]]; then
  echo "ERROR: Detached HEAD."
  exit 1
fi

git remote get-url origin >/dev/null

# Only explicitly staged changes may be published.
if git diff --cached --quiet; then
  echo "ERROR: No staged changes."
  exit 1
fi

# Detect whitespace errors.
git diff --cached --check

# Reject common sensitive files from staged changes.
git diff --cached --name-only -z |
while IFS= read -r -d '' file; do
  case "$file" in
    *.db|*.sqlite|*.sqlite3|\
    .env|.env.*|*/.env|*/.env.*|\
    *.pem|*.key|\
    private-data/*|bank-statements/*|\
    uploads/*|exports/*|backups/*|data/*)
      echo "ERROR: Sensitive file staged: $file"
      exit 1
      ;;
  esac
done


echo "Running verification..."

if [[ -f backend/pyproject.toml ]]; then
  (
    cd backend
    uv run ruff check .
    uv run ruff format --check .
    uv run pytest -q
  )
fi

if [[ -f frontend/package.json ]]; then
  (
    cd frontend
    npm run lint
    npx tsc --noEmit
    npx vitest run
    npm run build
  )
fi

echo "Files being published:"
git diff --cached --stat

echo "Creating commit..."
git commit -m "$MESSAGE"

echo "Pushing to origin/$BRANCH..."
git push -u origin "$BRANCH"

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(
  git ls-remote --heads origin "$BRANCH" |
  awk '{print $1}'
)"

if [[ "$LOCAL_SHA" != "$REMOTE_SHA" ]]; then
  echo "ERROR: Remote commit verification failed."
  exit 1
fi

echo "SUCCESS: Changes published to GitHub."
echo "Branch: $BRANCH"
echo "Commit: $LOCAL_SHA"
git status --short
