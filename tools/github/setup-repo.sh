#!/usr/bin/env sh
# SPDX-License-Identifier: MIT
# Creates and configures the private GitHub repository. Run once, from the
# repository root, after `gh auth login` with an account that can create
# repositories in the Avect-AI organisation.
set -eu

ORG="${ORG:-Avect-AI}"
REPO="${REPO:-siapso-mother-child}"
FULL="$ORG/$REPO"

if ! gh repo view "$FULL" >/dev/null 2>&1; then
  gh repo create "$FULL" --private --source . --remote origin \
    --description "Offline medicine and remedy safety for pregnancy and breastfeeding (private until release)" \
    --disable-wiki
fi
git push -u origin main

# Merge policy: squash only, PR title as commit title, commit messages (with
# their Signed-off-by lines) as commit body, branches deleted after merge.
gh api -X PATCH "repos/$FULL" \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true -F allow_update_branch=true \
  -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=COMMIT_MESSAGES >/dev/null
echo "Merge policy: squash only."

# Auto-merge: GitHub accepts the request on every plan but only stores it where
# the feature exists (not for private repositories on the Free plan), so read
# the value back instead of trusting the response.
gh api -X PATCH "repos/$FULL" -F allow_auto_merge=true >/dev/null 2>&1 || true
if [ "$(gh api "repos/$FULL" --jq .allow_auto_merge)" = "true" ]; then
  echo "GitHub auto-merge: enabled."
else
  echo "GitHub auto-merge not available on this plan: use tools/github/merge-pr.sh."
fi

# Dependabot: vulnerability alerts and security updates.
gh api -X PUT "repos/$FULL/vulnerability-alerts" >/dev/null && echo "Dependabot alerts: enabled."
gh api -X PUT "repos/$FULL/automated-security-fixes" >/dev/null && echo "Dependabot security updates: enabled."

# Branch protection on main: requires GitHub Team for private repositories.
cat > "${TMPDIR:-/tmp}/protection.json" <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["Text hygiene", "Developer Certificate of Origin"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
if gh api -X PUT "repos/$FULL/branches/main/protection" --input "${TMPDIR:-/tmp}/protection.json" >/dev/null 2>&1; then
  echo "Branch protection on main: enabled (CI required)."
else
  echo "Branch protection not available on this plan for a private repository: CI is still checked before every merge."
fi

gh repo view "$FULL" --json visibility,url --jq '"Repository " + .url + ": " + .visibility'
