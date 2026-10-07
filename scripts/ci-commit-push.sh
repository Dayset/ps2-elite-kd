#!/usr/bin/env bash
# Commit data/ changes (if any) and push to the default branch, rebasing on
# top of concurrent pushes (Pages / user commits). Used by refresh-cache.yml.
#   scripts/ci-commit-push.sh "commit message"
set -uo pipefail
msg="${1:?commit message required}"
branch="${GITHUB_REF_NAME:-main}"

git add -A data/
if git diff --staged --quiet; then
  echo "No data/ changes to commit."
  exit 0
fi
git commit -q -m "$msg"

for attempt in 1 2 3 4 5; do
  if git push -q origin "HEAD:${branch}"; then
    echo "Pushed: $msg"
    exit 0
  fi
  echo "Push rejected (attempt $attempt); rebasing on origin/${branch}…"
  sleep $((attempt * 5))
  # During a rebase "theirs" = our bot commit, so fresh cache data wins any
  # conflict inside data/. Non-data files are never touched by the bot.
  if ! git pull -q --rebase -X theirs origin "$branch"; then
    git rebase --abort 2>/dev/null || true
    git fetch -q origin "$branch" && git rebase -X theirs "origin/${branch}" || git rebase --abort 2>/dev/null || true
  fi
done
echo "::error::Could not push after 5 attempts"
exit 1
