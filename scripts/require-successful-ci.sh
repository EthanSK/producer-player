#!/usr/bin/env bash
# One exact-source CI gate, reused before packaging and before public promotion.
set -euo pipefail
ci_run="$(gh run list --repo "$GITHUB_REPOSITORY" --workflow ci.yml --commit "$GITHUB_SHA" --limit 1 --json databaseId --jq '.[0].databaseId // empty')"
if [ -z "$ci_run" ]; then
  echo "::error::No CI run found for this exact source commit; refusing publication."
  exit 1
fi
gh run watch "$ci_run" --repo "$GITHUB_REPOSITORY" --exit-status
