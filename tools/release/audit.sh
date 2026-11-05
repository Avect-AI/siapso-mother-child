#!/usr/bin/env sh
# SPDX-License-Identifier: MIT
# Pre-publication audit over the whole git history (docs/audit/2026-11-audit.md).
#
# Every commit reachable from every ref is scanned, not only the working tree:
# - secrets: gitleaks 8.30.1 over the history of every ref. The release
#   archive is downloaded at run time into the git-ignored cache (.cache/audit
#   at the root of this repository, or $AUDIT_CACHE) and its SHA-256 is checked
#   against the value pinned below before every run. Nothing of it is committed.
# - licences: reuse lint on the working tree, with the version pinned in
#   tools/reuse/requirements.txt (installed into the cache when missing).
# - sources: no forbidden source of knowledge/sources.yaml (DDInter, LEDIAM,
#   e-lactancia, CRAT, Theriaque, Vidal, DrugBank) named in any file of any
#   commit, except in the files that declare or enforce the ban.
# - personal-data: phone numbers of Senegal, email addresses other than
#   placeholders, IP address literals, private key headers, cloud access keys
#   and access tokens, in any file of any commit and in commit messages.
# - large-files: any file over 1 MiB in any commit.
# - file-names: access key, private key, .env and secrets files, and
#   TerangaHealth paths, added in any commit.
# - identities (information only): author and committer addresses, by domain
#   and number of commits.
#
# Every file of every commit was added, line by line, by that commit or one of
# its ancestors. Reading every line added by every commit (git log -p, renames
# as additions, a merge against its first parent) therefore reads the tree of
# every commit.
#
# Values are never printed: a finding names the check, the kind of match, the
# path and the earliest commit that added it, for a review in place.
#
# Usage: sh tools/release/audit.sh [--repo DIR] [--published] [--only LIST]
#   --repo DIR   the repository to audit (default: the current one)
#   --published  audit every ref the remote "origin" serves (branches, tags and
#                pull request refs, which stay readable after a branch is
#                deleted) through a mirror clone kept in the cache, instead of
#                the local refs; licences are still checked on the working tree
#   --only LIST  comma-separated checks to run, among: secrets, licences,
#                sources, personal-data, large-files, file-names, identities
#                (default: all)
# Environment: AUDIT_CACHE (cache folder), AUDIT_GITLEAKS_BASE_URL (a mirror of
# the gitleaks release files; the pinned checksums still apply).
# Exit code: 0 no finding, 1 findings, 2 usage or tool error.
# Tested by tools/release/audit.test.sh.
set -eu
export LC_ALL=C

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHECKS='secrets licences sources personal-data large-files file-names identities'
MAX_FILE_BYTES=1048576
TAB="$(printf '\t')"

GITLEAKS_VERSION=8.30.1
GITLEAKS_BASE_URL="${AUDIT_GITLEAKS_BASE_URL:-https://github.com/gitleaks/gitleaks/releases/download/v$GITLEAKS_VERSION}"

# SHA-256 of the gitleaks 8.30.1 release archives (published 2026-03-21), as
# listed in gitleaks_8.30.1_checksums.txt of the release.
gitleaks_sha256() {
  case "$1" in
    linux_x64.tar.gz) echo 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;;
    linux_arm64.tar.gz) echo e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080 ;;
    darwin_x64.tar.gz) echo dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709 ;;
    darwin_arm64.tar.gz) echo b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5 ;;
    windows_x64.zip) echo d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e ;;
    *) return 1 ;;
  esac
}

# Accepted findings, as shell patterns over "check:kind:path:detail" (the
# detail of a secret names its commit and line, so a new leak in the same file
# is still reported). Each one was reviewed and is recorded with its reason in
# docs/audit/2026-11-audit.md.
accepted() {
  case "$1:$2:$3:$4" in
    # The files that declare or enforce the ban on the forbidden sources.
    sources:*:knowledge/sources.yaml:*) return 0 ;;
    sources:*:tools/knowledge/src/provenance.ts:* | sources:*:tools/knowledge/test/*) return 0 ;;
    sources:*:CLAUDE.md:* | sources:*:docs/superpowers/*) return 0 ;;
    sources:*:docs/audit/* | sources:*:tools/release/audit*) return 0 ;;
    # The demo mode switch of the app, no secret (docs/pack-signing.md).
    'file-names:.env file:app/.env.demo:'*) return 0 ;;
    # Test inputs that the app and the API must refuse as identifying data
    # (a phone number typed as a pseudonym, a phone field sent to the API),
    # and a URL with user info in a test of the forbidden domains check.
    # Pinned to each commit that adds them: another commit is still reported.
    'personal-data:phone number:app/src/domain/profile-form.test.ts:commit 261d6333a90b' | \
      'personal-data:phone number:app/src/domain/profile-form.test.ts:commit 870008614717') return 0 ;;
    'personal-data:phone number:app/src/screens/ProfileEdit.test.tsx:commit 261d6333a90b' | \
      'personal-data:phone number:app/src/screens/ProfileEdit.test.tsx:commit 870008614717') return 0 ;;
    'personal-data:phone number:server/test/http.test.ts:commit 375915be5ffd' | \
      'personal-data:phone number:server/test/http.test.ts:commit 42f7c1af6d6e' | \
      'personal-data:phone number:server/test/http.test.ts:commit 9ea32d6e736f') return 0 ;;
    'personal-data:email address:tools/knowledge/test/provenance.test.ts:commit 375e6cb9e199' | \
      'personal-data:email address:tools/knowledge/test/provenance.test.ts:commit 7558f8f15a71' | \
      'personal-data:email address:tools/knowledge/test/provenance.test.ts:commit baddd17ded46') return 0 ;;
    # A deprecation notice of a third-party package, copied by pnpm from the
    # npm registry into the lockfile.
    'personal-data:email address:pnpm-lock.yaml:commit 19e907283699' | \
      'personal-data:email address:pnpm-lock.yaml:commit bdb61bb3c3a8') return 0 ;;
    # Font data of the impeccable plugin, JSON text, this version only (its
    # data licence is a team decision recorded in the audit report).
    'large-files:file over 1048576 bytes:.claude/skills/impeccable/scripts/data/font-index.json:1100013 bytes, blob 9d2029971df2') return 0 ;;
    # Test values of the API tests, not secrets: two made-up keys (helpers.ts)
    # and a made-up identifying string that must never be echoed
    # (http.test.ts). Pinned to the commits and lines reviewed.
    'secrets:generic-api-key:server/test/helpers.ts:commit 375915be5ffd, line 1'[78] | \
      'secrets:generic-api-key:server/test/helpers.ts:commit 9ea32d6e736f, line 1'[78] | \
      'secrets:generic-api-key:server/test/helpers.ts:commit 42f7c1af6d6e, line 1'[78]) return 0 ;;
    'secrets:generic-api-key:server/test/http.test.ts:commit 375915be5ffd, line 104' | \
      'secrets:generic-api-key:server/test/http.test.ts:commit 9ea32d6e736f, line 104' | \
      'secrets:generic-api-key:server/test/http.test.ts:commit 42f7c1af6d6e, line 104') return 0 ;;
  esac
  return 1
}

die() {
  echo "audit: $1" >&2
  exit 2
}

usage() {
  sed -n 's/^# \{0,1\}//; /^Usage:/,/^Tested by/p' "$0" | sed '$d' >&2
  exit 2
}

REPO=''
PUBLISHED=no
ONLY="$CHECKS"
while [ $# -gt 0 ]; do
  case "$1" in
    --repo)
      [ $# -ge 2 ] || usage
      REPO="$2"
      shift 2
      ;;
    --published)
      PUBLISHED=yes
      shift
      ;;
    --only)
      [ $# -ge 2 ] || usage
      ONLY="$(printf '%s' "$2" | tr ',' ' ')"
      shift 2
      ;;
    -h | --help) usage ;;
    *)
      echo "audit: unknown option \"$1\"" >&2
      usage
      ;;
  esac
done
for check in $ONLY; do
  case " $CHECKS " in
    *" $check "*) ;;
    *) die "unknown check \"$check\" (checks: $CHECKS)" ;;
  esac
done

wants() {
  case " $ONLY " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

if [ -z "$REPO" ]; then REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git repository"; fi
git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || die "$REPO is not a git repository"
WORKTREE="$(git -C "$REPO" rev-parse --show-toplevel 2>/dev/null || true)"

CACHE="${AUDIT_CACHE:-$ROOT/.cache/audit}"
mkdir -p "$CACHE"
TMP="$(mktemp -d "$CACHE/run.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT INT TERM
: >"$TMP/findings"
: >"$TMP/accepted"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  else
    openssl dgst -sha256 -r "$1" | cut -d ' ' -f 1
  fi
}

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 -o "$2" "$1"
  else
    wget -q -O "$2" "$1"
  fi
}

# Records a finding, unless it is accepted: check, kind, path, detail.
finding() {
  if accepted "$1" "$2" "$3" "$4"; then
    echo "$1" >>"$TMP/accepted"
    return 0
  fi
  printf 'FINDING [%s] %s: %s (%s)\n' "$1" "$2" "$3" "$4"
  echo "$1" >>"$TMP/findings"
}

plural() {
  if [ "$1" = 1 ]; then echo "1 $2"; else echo "$1 ${2}s"; fi
}

# --- Scope -------------------------------------------------------------------

HISTORY="$REPO"
if [ "$PUBLISHED" = yes ]; then
  url="$(git -C "$REPO" remote get-url origin 2>/dev/null)" || die "--published needs a remote named origin"
  printf '%s' "$url" >"$TMP/url"
  HISTORY="$CACHE/mirror-$(sha256_of "$TMP/url" | cut -c 1-12).git"
  if [ -d "$HISTORY" ]; then
    git -C "$HISTORY" fetch --prune --quiet origin || die "could not update the mirror of origin"
  else
    git clone --mirror --quiet "$url" "$HISTORY" || die "could not clone a mirror of origin"
  fi
fi
commits="$(git -C "$HISTORY" rev-list --all --count)" || die "could not list the commits"
refs="$(git -C "$HISTORY" for-each-ref --format='%(refname)' | wc -l | tr -d ' ')"
echo "Pre-publication audit"
if [ "$PUBLISHED" = yes ]; then
  echo "Scope: $(plural "$commits" commit) reachable from the $(plural "$refs" ref) served by the remote origin (mirror clone)."
else
  echo "Scope: $(plural "$commits" commit) reachable from the $(plural "$refs" ref) of $REPO."
fi
echo "Values are never printed: open the commit and the path to review a finding."

# --- secrets -----------------------------------------------------------------

gitleaks_platform() {
  case "$(uname -s)" in
    Linux) os=linux ext=tar.gz ;;
    Darwin) os=darwin ext=tar.gz ;;
    MINGW* | MSYS* | CYGWIN*) os=windows ext=zip ;;
    *) return 1 ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) return 1 ;;
  esac
  echo "${os}_$arch.$ext"
}

# Sets GITLEAKS to a binary extracted from the verified release archive.
install_gitleaks() {
  platform="$(gitleaks_platform)" || die "gitleaks: no pinned release for $(uname -s) $(uname -m)"
  expected="$(gitleaks_sha256 "$platform")" || die "gitleaks: no pinned checksum for $platform"
  name="gitleaks_${GITLEAKS_VERSION}_$platform"
  archive="$CACHE/$name"
  if [ ! -f "$archive" ] || [ "$(sha256_of "$archive")" != "$expected" ]; then
    rm -f "$archive" "$archive.part"
    fetch "$GITLEAKS_BASE_URL/$name" "$archive.part" || die "gitleaks: could not download $name"
    actual="$(sha256_of "$archive.part")"
    if [ "$actual" != "$expected" ]; then
      rm -f "$archive.part"
      die "gitleaks: checksum mismatch for $name (expected $expected, got $actual)"
    fi
    mv "$archive.part" "$archive"
  fi
  mkdir "$TMP/gitleaks"
  case "$platform" in
    *.zip)
      if command -v unzip >/dev/null 2>&1; then
        unzip -q -o "$archive" gitleaks.exe -d "$TMP/gitleaks" || die "gitleaks: could not extract $name"
      else
        sh "$ROOT/tools/hygiene/py.sh" -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extract("gitleaks.exe", sys.argv[2])' \
          "$archive" "$TMP/gitleaks" || die "gitleaks: could not extract $name"
      fi
      GITLEAKS="$TMP/gitleaks/gitleaks.exe"
      ;;
    *)
      tar -xzf "$archive" -C "$TMP/gitleaks" gitleaks || die "gitleaks: could not extract $name"
      GITLEAKS="$TMP/gitleaks/gitleaks"
      ;;
  esac
  chmod +x "$GITLEAKS"
}

check_secrets() {
  echo "== secrets: gitleaks $GITLEAKS_VERSION over the history of every ref"
  install_gitleaks
  # The report holds the rule, commit, file and line of each leak, never its value.
  printf '{{ range . }}{{ .RuleID }}\t{{ .Commit }}\t{{ .File }}\t{{ .StartLine }}\n{{ end }}' >"$TMP/gitleaks.tmpl"
  if ! "$GITLEAKS" git --no-banner --redact --exit-code 0 --log-level warn \
    --log-opts='--all --full-history --diff-merges=first-parent' \
    --report-format template --report-template "$TMP/gitleaks.tmpl" \
    --report-path "$TMP/gitleaks.tsv" "$HISTORY" >"$TMP/gitleaks.log" 2>&1; then
    sed 's/^/  /' "$TMP/gitleaks.log" >&2
    die "gitleaks failed"
  fi
  sort -t "$TAB" -k 3,3 -k 1,1 -k 2,2 -k 4,4n "$TMP/gitleaks.tsv" >"$TMP/gitleaks.sorted"
  while IFS="$TAB" read -r rule commit file line; do
    [ -n "$rule" ] || continue
    finding secrets "$rule" "$file" "commit $(printf '%s' "$commit" | cut -c 1-12), line $line"
  done <"$TMP/gitleaks.sorted"
}

# --- licences ----------------------------------------------------------------

# Sets REUSE to a reuse command of the pinned version.
install_reuse() {
  requirements="$ROOT/tools/reuse/requirements.txt"
  pinned="$(sed -n 's/^reuse\(\[[^]]*\]\)\{0,1\}==\([0-9][0-9.]*\).*/\2/p' "$requirements")"
  [ -n "$pinned" ] || die "licences: no pinned reuse version in tools/reuse/requirements.txt"
  if command -v reuse >/dev/null 2>&1 && reuse --version 2>/dev/null | grep -q "reuse, version $pinned\$"; then
    REUSE=reuse
    return 0
  fi
  venv="$CACHE/reuse-$pinned"
  if [ ! -f "$venv/ready" ]; then
    rm -rf "$venv"
    sh "$ROOT/tools/hygiene/py.sh" -m venv "$venv" || die "licences: could not create a Python virtual environment"
    if [ -x "$venv/bin/python" ]; then python="$venv/bin/python"; else python="$venv/Scripts/python"; fi
    "$python" -m pip install --quiet --require-virtualenv -r "$requirements" >"$TMP/pip.log" 2>&1 || {
      cat "$TMP/pip.log" >&2
      die "licences: could not install reuse $pinned"
    }
    : >"$venv/ready"
  fi
  if [ -x "$venv/bin/reuse" ]; then REUSE="$venv/bin/reuse"; else REUSE="$venv/Scripts/reuse"; fi
}

check_licences() {
  echo "== licences: reuse lint on the working tree"
  [ -n "$WORKTREE" ] || die "licences: $REPO has no working tree"
  install_reuse
  if "$REUSE" --root "$WORKTREE" lint >"$TMP/reuse.log" 2>&1; then
    echo "  reuse lint: compliant"
  else
    sed 's/^/  /' "$TMP/reuse.log"
    finding licences 'reuse lint failed' '(working tree)' 'see the reuse output above'
  fi
}

# --- sources and personal-data -----------------------------------------------

# Reads "git log -p" (mode=diff) or commit messages (mode=message) and prints
# check, kind, commit and path of every match, never the matched text.
# shellcheck disable=SC2016
SCAN_AWK='
function rep(s, n,   r) { r = ""; while (n-- > 0) r = r s; return r }
function count(range,   i) { i = index(range, ","); return i ? substr(range, i + 1) + 0 : 1 }

# Whether a match is a real value and not a placeholder or a look-alike.
function real(kind, v, a, a2,   d, l, tld, o, i) {
  if (kind == "email") {
    d = tolower(v); sub(/^.*@/, "", d)
    l = tolower(v); sub(/@.*$/, "", l)
    tld = d; sub(/^.*\./, "", tld)
    if (tld ~ /^(png|jpe?g|gif|svg|webp|avif|ico|js|mjs|cjs|ts|tsx|jsx|json|css|scss|md|html?|wasm|onnx|bin|txt|ya?ml|map|woff2?|ttf|otf)$/) return 0
    if (d == "example.com" || d == "example.org" || d == "example.net" || d == "localhost") return 0
    if (d ~ /\.example\.(com|org|net)$/ || d ~ /\.(example|invalid|test|localhost)$/) return 0
    if (d == "users.noreply.github.com" || d == "noreply.github.com") return 0
    if (l == "noreply" || l == "no-reply" || (l == "git" && d == "github.com")) return 0
    return 1
  }
  if (kind == "ip") {
    if (a == "." && a2 ~ /[0-9]/) return 0
    split(v, o, ".")
    for (i = 1; i <= 4; i++) if (length(o[i]) > 3 || o[i] + 0 > 255) return 0
    if (o[1] == 127 || v == "0.0.0.0" || v == "255.255.255.255") return 0
    if ((o[1] == 192 && o[2] == 0 && o[3] == 2) || (o[1] == 198 && o[2] == 51 && o[3] == 100) || (o[1] == 203 && o[2] == 0 && o[3] == 113)) return 0
    return 1
  }
  if (kind == "number") return !(a == "." && a2 ~ /[0-9]/)
  return 1
}

# Pattern k matched against t. Each pattern has its own call to match(): awk
# then compiles each regular expression once instead of on every line.
function find(t, k) {
  if (k == 1) return match(t, P[1])
  if (k == 2) return match(t, P[2])
  if (k == 3) return match(t, P[3])
  if (k == 4) return match(t, P[4])
  if (k == 5) return match(t, P[5])
  if (k == 6) return match(t, P[6])
  if (k == 7) return match(t, P[7])
  if (k == 8) return match(t, P[8])
  if (k == 9) return match(t, P[9])
  if (k == 10) return match(t, P[10])
  if (k == 11) return match(t, P[11])
  if (k == 12) return match(t, P[12])
  if (k == 13) return match(t, P[13])
  if (k == 14) return match(t, P[14])
  if (k == 15) return match(t, P[15])
  if (k == 16) return match(t, P[16])
  if (k == 17) return match(t, P[17])
  return 0
}

# Whether pattern k matches s where the character before the match is not in
# BEFORE[k] and the one after not in AFTER[k] ("" for any), with a real value
# of KIND[k].
function hit(s, k,   off, t, b, a) {
  off = 0; t = s
  while (t != "" && find(t, k)) {
    b = (off + RSTART > 1) ? substr(s, off + RSTART - 1, 1) : ""
    a = substr(t, RSTART + RLENGTH, 1)
    if ((BEFORE[k] == "" || b == "" || b !~ BEFORE[k]) && (AFTER[k] == "" || a == "" || a !~ AFTER[k]) && real(KIND[k], substr(t, RSTART, RLENGTH), a, substr(t, RSTART + RLENGTH + 1, 1))) return 1
    off += RSTART; t = substr(t, RSTART + 1)
  }
  return 0
}

# Sets found[check TAB label] for every pattern that matches in s. Identity
# trailers of commit messages (sign-off, co-author) are reported with the
# identities, not here.
function scan_part(s,   l, k, trailer) {
  trailer = (mode == "message" && tolower(s) ~ /^(signed-off-by|co-authored-by):/)
  if (personal) {
    for (k = 1; k <= LAST_PERSONAL; k++) {
      if (k == EMAIL && (trailer || !index(s, "@"))) continue
      if (!(("personal-data\t" LABEL[k]) in found) && hit(s, k)) found["personal-data\t" LABEL[k]] = 1
    }
    if (index(s, "\"service_account\"")) found["personal-data\tcloud access key"] = 1
  }
  if (sources) {
    l = tolower(s)
    for (k = LAST_PERSONAL + 1; k <= LAST; k++) if (hit(l, k)) found["sources\t" LABEL[k]] = 1
  }
}

# A long line (minified code, a one-line JSON file) is read in overlapping
# parts, so that each attempt copies at most one part.
function scan(s,   i, n, k) {
  split("", found)
  n = length(s)
  if (n <= PART) scan_part(s)
  else for (i = 1; i <= n; i += PART - OVERLAP) scan_part(substr(s, i, PART))
  for (k in found) print k "\t" commit "\t" path
}

# Declares pattern number LAST: label, regular expression, classes of the
# characters refused before and after the match, kind of value for real().
function pattern(label, re, before, after, kind) {
  LAST++; LABEL[LAST] = label; P[LAST] = re; BEFORE[LAST] = before; AFTER[LAST] = after; KIND[LAST] = kind
  return LAST
}

BEGIN {
  PART = 4096; OVERLAP = 256
  D = "[0-9]"; S = "[ .-]?"; SEP = "[ \t._-]*"
  EDGE = "[0-9A-Za-z_./+-]"; WORD = "[0-9A-Za-z_]"; KEY = "[0-9A-Za-z_-]"
  # Personal data (find() has one call per pattern: at most 17 in all).
  # Senegal: country code, mobile lines (70, 75 to 78) and fixed lines (33 8, 33 9).
  pattern("phone number", "(\\+|00)221[ ().-]*[0-9]", WORD, "", "")
  pattern("phone number", "7[05-8]" S D D D S D D S D D, EDGE, WORD, "number")
  pattern("phone number", "33" S "[89]" D D S D D S D D, EDGE, WORD, "number")
  EMAIL = pattern("email address", "[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)*\\.[A-Za-z][A-Za-z]+", "[A-Za-z0-9._%+-]", "", "email")
  pattern("IP address", D "+\\." D "+\\." D "+\\." D "+", "[0-9A-Za-z.=_~^<>-]", WORD, "ip")
  pattern("private key header", "-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY-----|PuTTY-User-Key-File-[0-9]", "", "", "")
  pattern("cloud access key", "(AKIA|ASIA|ABIA|ACCA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|APKA)" rep("[A-Z2-7]", 16), "[A-Z0-9]", "[A-Z0-9]", "")
  pattern("cloud access key", "AIza" rep("[0-9A-Za-z_-]", 35), KEY, KEY, "")
  pattern("cloud access key", "AccountKey=" rep("[A-Za-z0-9+/]", 40), "", "", "")
  LAST_PERSONAL = pattern("access token", "(ghp|gho|ghu|ghs|ghr)_" rep("[A-Za-z0-9]", 36) "|github_pat_" rep("[A-Za-z0-9_]", 40) "|hf_" rep("[A-Za-z]", 34) "|xox[abposr]-[0-9]+-[0-9A-Za-z-]+", WORD, WORD, "")
  # knowledge/sources.yaml, forbidden: matched in lowercase, tolerant to
  # separators, never inside a word.
  pattern("DDInter named", "d" SEP "d" SEP "inter", "[a-z]", "", "")
  pattern("LEDIAM named", "l" SEP "e" SEP "d" SEP "i" SEP "a" SEP "m", "[a-z]", "[a-z]", "")
  pattern("e-lactancia named", "e" SEP "lactancia", "[a-z]", "", "")
  pattern("CRAT named", "(l" SEP "e" SEP ")?c" SEP "r" SEP "a" SEP "t", "[a-z]", "[a-z]", "")
  pattern("Theriaque named", "th(e|\303\251|\303\211)riaque", "[a-z]", "", "")
  pattern("Vidal named", "vidal", "[a-z]", "[a-z]", "")
  pattern("DrugBank named", "drug" SEP "bank", "[a-z]", "", "")
}

$0 == "audit-git-failed" { failed = 1; next }
/^audit-commit [0-9a-f]+$/ { commit = substr($0, 14); path = (mode == "message") ? "(commit message)" : ""; left = 0; next }
mode == "message" { scan($0); next }
left > 0 {
  c = substr($0, 1, 1)
  if (c == "+") { left--; scan(substr($0, 2)); next }
  if (c == "-") { left--; next }
  if (c == "\\") next
  left = 0
}
/^diff --git / { path = ""; next }
/^\+\+\+ b\// { path = substr($0, 7); sub(/\t$/, "", path); next }
/^\+\+\+ "b\// { path = substr($0, 8); sub(/"\t?$/, "", path); next }
/^@@ / { split($0, f, " "); left = count(f[2]) + count(f[3]); next }
END { if (failed) exit 3 }
'

# Prints check, kind, path and commit once for each commit that adds a match:
# an accepted match never hides a later one in the same file.
aggregate() {
  awk -F "$TAB" '!seen[$0]++ { print $1 FS $2 FS $4 FS $3 }' "$1" |
    sort -t "$TAB" -k 1,1 -k 2,2 -k 3,3 -k 4,4
}

check_content() {
  { git -C "$HISTORY" -c core.quotePath=false log --all --topo-order --no-renames \
    --diff-merges=first-parent --no-color --no-ext-diff --no-textconv -p -U0 \
    --format='audit-commit %H' || echo audit-git-failed; } |
    awk -v mode=diff -v personal="$1" -v sources="$2" "$SCAN_AWK" >"$TMP/content.raw" ||
    die "could not read the history"
  # Messages are read for personal data only: the ban on forbidden sources is
  # about content, and a message may say that none of their data is used.
  if [ "$1" = 1 ]; then
    { git -C "$HISTORY" log --all --topo-order --format='audit-commit %H%n%B' || echo audit-git-failed; } |
      awk -v mode=message -v personal=1 -v sources=0 "$SCAN_AWK" >>"$TMP/content.raw" ||
      die "could not read the commit messages"
  fi
  aggregate "$TMP/content.raw" >"$TMP/content.tsv"
}

report_content() {
  while IFS="$TAB" read -r check kind path commit; do
    [ "$check" = "$1" ] || continue
    finding "$check" "$kind" "$path" "commit $(printf '%s' "$commit" | cut -c 1-12)"
  done <"$TMP/content.tsv"
}

# --- large-files -------------------------------------------------------------

check_large_files() {
  echo "== large-files: files over $MAX_FILE_BYTES bytes in any commit"
  { git -C "$HISTORY" rev-list --objects --all || echo audit-git-failed; } >"$TMP/objects"
  if grep -qx audit-git-failed "$TMP/objects"; then die "could not list the objects"; fi
  git -C "$HISTORY" cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' <"$TMP/objects" |
    awk -v max="$MAX_FILE_BYTES" '$1 == "blob" && $3 + 0 > max + 0 {
      path = $0; sub(/^[^ ]+ [^ ]+ [^ ]+ /, "", path)
      print path "\t" $3 "\t" substr($2, 1, 12)
    }' | sort >"$TMP/large.tsv"
  while IFS="$TAB" read -r path size blob; do
    finding large-files "file over $MAX_FILE_BYTES bytes" "$path" "$size bytes, blob $blob"
  done <"$TMP/large.tsv"
}

# --- file-names --------------------------------------------------------------

check_file_names() {
  echo "== file-names: key, .env and secrets files, TerangaHealth paths, in any commit"
  { git -C "$HISTORY" -c core.quotePath=false log --all --topo-order --no-renames \
    --diff-merges=first-parent --diff-filter=A --name-only --format='audit-commit %H' ||
    echo audit-git-failed; } |
    awk '
      $0 == "audit-git-failed" { failed = 1; next }
      /^audit-commit [0-9a-f]+$/ { commit = substr($0, 14); next }
      $0 == "" { next }
      {
        base = tolower($0); sub(/.*\//, "", base)
        if (base ~ /accesskeys.*\.csv$/) print "file-names\taccess key file\t" commit "\t" $0
        if (base ~ /\.(pem|key|p12|pfx|jks|keystore|ppk)$/ || base ~ /^id_(rsa|dsa|ecdsa|ed25519)/) print "file-names\tprivate key file\t" commit "\t" $0
        if (base == ".env" || base ~ /^\.env\./) print "file-names\t.env file\t" commit "\t" $0
        if (base ~ /secrets.*\.ya?ml$/) print "file-names\tsecrets file\t" commit "\t" $0
        if (tolower($0) ~ /teranga/) print "file-names\tTerangaHealth path\t" commit "\t" $0
      }
      END { if (failed) exit 3 }
    ' >"$TMP/names.raw" || die "could not list the paths"
  aggregate "$TMP/names.raw" >"$TMP/names.tsv"
  while IFS="$TAB" read -r check kind path commit; do
    finding "$check" "$kind" "$path" "commit $(printf '%s' "$commit" | cut -c 1-12)"
  done <"$TMP/names.tsv"
}

# --- identities --------------------------------------------------------------

check_identities() {
  echo "== identities: author, committer and trailer addresses (information, not a finding)"
  { git -C "$HISTORY" log --all --format='audit-commit%x09%ae%x09%ce%n%B' || echo audit-git-failed; } |
    awk -F "$TAB" '
      function add(e) { if (!(e in seen)) { seen[e] = 1; order[++m] = e } }
      function times(k) { return k == 1 ? "1 commit" : k " commits" }
      $0 == "audit-git-failed" { failed = 1; next }
      $1 == "audit-commit" && NF == 3 {
        a = tolower($2); c = tolower($3); add(a); add(c); author[a]++; committer[c]++
        split("", here); next
      }
      # Sign-off and co-author trailers name an address in the message.
      tolower($0) ~ /^(signed-off-by|co-authored-by):/ && match($0, /<[^<>]*@[^<>]*>/) {
        e = tolower(substr($0, RSTART + 1, RLENGTH - 2)); add(e)
        if (!(e in here)) { here[e] = 1; trailer[e]++ }
      }
      END {
        if (failed) exit 3
        for (i = 1; i <= m; i++) {
          e = order[i]; d = e; sub(/^.*@/, "", d)
          note = (e ~ /noreply/) ? ", noreply" : ""
          printf "INFO [identities] address %d (%s%s): author of %s, committer of %s, in the trailers of %s\n", i, d, note, times(author[e] + 0), times(committer[e] + 0), times(trailer[e] + 0)
        }
      }' || die "could not list the identities"
}

# --- Run ---------------------------------------------------------------------

if wants secrets; then check_secrets; fi
if wants licences; then check_licences; fi
if wants sources || wants personal-data; then
  personal=0
  sources=0
  if wants personal-data; then personal=1; fi
  if wants sources; then sources=1; fi
  check_content "$personal" "$sources"
fi
if wants sources; then
  echo "== sources: forbidden sources named in any file of any commit"
  report_content sources
fi
if wants personal-data; then
  echo "== personal-data: any file of any commit, and commit messages"
  report_content personal-data
fi
if wants large-files; then check_large_files; fi
if wants file-names; then check_file_names; fi
if wants identities; then check_identities; fi

echo "== summary"
total=0
for check in $ONLY; do
  [ "$check" = identities ] && continue
  n="$(grep -cx -- "$check" "$TMP/findings" || true)"
  a="$(grep -cx -- "$check" "$TMP/accepted" || true)"
  total=$((total + n))
  echo "  $check: $(plural "$n" finding), $a accepted"
done
if [ "$total" -eq 0 ]; then
  echo "Result: no finding."
  exit 0
fi
echo "Result: $(plural "$total" finding)."
exit 1
