#!/usr/bin/env sh
# Creates and configures the private GitHub repository. Run once, from the
# repository root, after `gh auth login` with an account that can create
# repositories in the Avect-AI organisation.
set -eu

ORG="${ORG:-Avect-AI}"
REPO="${REPO:-siapso-mere-enfant}"
FULL="$ORG/$REPO"

if ! gh repo view "$FULL" >/dev/null 2>&1; then
  gh repo create "$FULL" --private --source . --remote origin \
    --description "Offline medicine and remedy safety for pregnancy and breastfeeding (private until release)" \
    --disable-wiki
fi
git push -u origin main

# Merge policy: squash only, PR title as commit title, branches deleted after merge.
gh api -X PATCH "repos/$FULL" \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true -F allow_update_branch=true \
  -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY >/dev/null
echo "Politique de fusion : squash uniquement."

# Auto-merge: only on plans that support it for private repositories.
if gh api -X PATCH "repos/$FULL" -F allow_auto_merge=true >/dev/null 2>&1; then
  echo "Fusion automatique GitHub : activee."
else
  echo "Fusion automatique GitHub indisponible sur ce plan : fusion par gh apres CI verte."
fi

# Dependabot: vulnerability alerts and security updates.
gh api -X PUT "repos/$FULL/vulnerability-alerts" >/dev/null && echo "Alertes Dependabot : activees."
gh api -X PUT "repos/$FULL/automated-security-fixes" >/dev/null && echo "Correctifs de securite Dependabot : actives."

# Branch protection on main: requires GitHub Team for private repositories.
cat > "${TMPDIR:-/tmp}/protection.json" <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["Texte propre (tirets cadratins, emojis, attribution)"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
if gh api -X PUT "repos/$FULL/branches/main/protection" --input "${TMPDIR:-/tmp}/protection.json" >/dev/null 2>&1; then
  echo "Protection de main : activee (CI obligatoire)."
else
  echo "Protection de main indisponible sur ce plan pour un depot prive : la CI reste verifiee avant chaque fusion par gh."
fi

gh repo view "$FULL" --json visibility,url --jq '"Depot " + .url + " : " + .visibility'
