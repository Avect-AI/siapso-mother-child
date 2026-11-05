#!/usr/bin/env sh
# SPDX-License-Identifier: MIT
# Tests tools/release/audit.sh on fixture repositories built at run time: it
# finds what was added in any commit of any ref (even when a later commit
# deleted it), names the commit and the path but never prints the value,
# skips placeholders and the accepted paths, scans the pull request refs of
# the remote with --published, and refuses a gitleaks archive whose checksum
# does not match the pinned one.
# Usage: sh tools/release/audit.test.sh
# The secret scan scenario downloads the pinned gitleaks release; set
# AUDIT_TEST_OFFLINE=1 to skip it.
#
# The planted values are assembled at run time from pieces (digits are spelled
# with letters, see "digits") so that this file holds none of them and the
# audit of this repository stays clean.
# The scenario functions are called by name, through "scenario".
# shellcheck disable=SC2329
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT INT TERM
export AUDIT_CACHE="$work/cache"

failures=0
total=0

# Letters a to j stand for the digits 0 to 9.
digits() {
  printf '%s' "$1" | tr 'abcdefghij' '0123456789'
}

# Planted values, never written in this file as they are.
PHONE="+$(digits ccb) $(digits hh) $(digits bcd) $(digits ef) $(digits gh)"
LOCAL_PHONE="$(digits hg) $(digits jhi) $(digits ef) $(digits gh)"
EMAIL="fixture.person@""provider.sn"
MESSAGE_EMAIL="reviewer.person@""provider.sn"
CO_AUTHOR="co.author@""provider.sn"
IP="$(digits eb).$(digits ic).$(digits cf).$(digits cd)"
KEY_HEADER="-----BEGIN ""OPENSSH PRIVATE KEY-----"
CLOUD_KEY="AK""IA$(printf 'Q%.0s' 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16)"

# A fixture repository with a test identity and no line ending conversion.
new_repo() {
  git init -q -b main "$1"
  git -C "$1" config user.name 'Fixture Author'
  git -C "$1" config user.email 'fixture@example.org'
  git -C "$1" config core.autocrlf false
  git -C "$1" config commit.gpgsign false
}

# commit <repo> <message>: commits everything in the working tree.
commit() {
  git -C "$1" add -A
  git -C "$1" commit -q -m "$2"
}

# Clean content: placeholders, allowed addresses and look-alikes only.
clean_tree() {
  mkdir -p "$1/knowledge"
  cat >"$1/README.md" <<'EOF'
Contact jane@example.org or someone@users.noreply.github.com; merges by noreply@github.com.
The server listens on 127.0.0.1 and 0.0.0.0; the docs use 192.0.2.10.
Pinned: pnpm@12.14.0, nvidia-cudnn-cu12==9.10.2.21, see icon@2x.png.
Phone: +221 XX XXX XX XX. Fonts: Vidaloka, unicode-range U+2212, U+2215. A democrat wrote it.
EOF
  cat >"$1/knowledge/sources.yaml" <<'EOF'
forbidden:
  - id: ddinter
    domains: [ddinter.scbdd.com]
  - id: lediam
EOF
}

build_history() {
  repo="$1"
  new_repo "$repo"
  clean_tree "$repo"
  commit "$repo" 'docs: start'

  printf 'Call %s, write to %s.\nHost %s\n%s\nkey %s\n' \
    "$PHONE" "$EMAIL" "$IP" "$KEY_HEADER" "$CLOUD_KEY" >"$repo/notes.txt"
  mkdir -p "$repo/knowledge/rules"
  printf 'id: moringa\nnote: copied from LEDIAM\n' >"$repo/knowledge/rules/r.yaml"
  commit "$repo" 'docs: add notes'
  git -C "$repo" rm -q notes.txt
  commit "$repo" 'docs: remove notes'

  mkdir -p "$repo/deploy" "$repo/server" "$repo/app" "$repo/config" "$repo/terangahealth"
  printf 'id,value\n' >"$repo/MDP_accessKeys.csv"
  printf 'not a key\n' >"$repo/deploy/prod-key.pem"
  printf 'A=1\n' >"$repo/server/.env"
  printf 'VITE_ALLOW_UNSIGNED_PACK=true\n' >"$repo/app/.env.demo"
  printf 'a: b\n' >"$repo/config/app-secrets.yaml"
  printf 'readme\n' >"$repo/terangahealth/README.md"
  commit "$repo" 'chore: add files'
  git -C "$repo" rm -q -r MDP_accessKeys.csv deploy server config terangahealth
  # Identity trailers are reported with the identities, not as findings.
  git -C "$repo" commit -q -s -m 'chore: remove files' -m "Co-authored-by: Co Author <$CO_AUTHOR>"

  git -C "$repo" checkout -q -b side
  dd if=/dev/zero of="$repo/big.bin" bs=1024 count=1100 2>/dev/null
  printf 'Call %s\n' "$LOCAL_PHONE" >"$repo/contacts.md"
  commit "$repo" "chore: side work for $MESSAGE_EMAIL"
  git -C "$repo" checkout -q main
}

# Runs the audit; stores its output in $out and its exit code in $status.
run_audit() {
  out="$work/out.$total"
  status=0
  sh "$here/audit.sh" "$@" >"$out" 2>&1 || status=$?
}

problems=''
fail() {
  problems="$problems
  $1"
}

expect_status() {
  if [ "$status" != "$1" ]; then fail "exit code $status, expected $1"; fi
}

expect_line() {
  if ! grep -Fq -- "$1" "$out"; then fail "missing: $1"; fi
}

expect_no_line() {
  if grep -Fq -- "$1" "$out"; then fail "unexpected: $1"; fi
}

# The planted values never appear in the output.
expect_no_value() {
  for value in "$PHONE" "$LOCAL_PHONE" "$EMAIL" "$MESSAGE_EMAIL" "$CO_AUTHOR" "$IP" "$KEY_HEADER" "$CLOUD_KEY" "$@"; do
    if grep -Fq -- "$value" "$out"; then fail "a planted value is printed"; fi
  done
}

finds_everything_in_the_history() {
  build_history "$work/history"
  run_audit --repo "$work/history" --only sources,personal-data,large-files,file-names,identities
  expect_status 1
  expect_line '[personal-data] phone number: notes.txt ('
  expect_line '[personal-data] email address: notes.txt ('
  expect_line '[personal-data] IP address: notes.txt ('
  expect_line '[personal-data] private key header: notes.txt ('
  expect_line '[personal-data] cloud access key: notes.txt ('
  expect_line '[personal-data] phone number: contacts.md ('
  side="$(git -C "$work/history" rev-parse --short=12 side)"
  expect_line "[personal-data] email address: (commit message) (commit $side)"
  expect_line '[sources] LEDIAM named: knowledge/rules/r.yaml ('
  expect_line '[file-names] access key file: MDP_accessKeys.csv ('
  expect_line '[file-names] private key file: deploy/prod-key.pem ('
  expect_line '[file-names] .env file: server/.env ('
  expect_line '[file-names] secrets file: config/app-secrets.yaml ('
  expect_line '[file-names] TerangaHealth path: terangahealth/README.md ('
  expect_line '[large-files] file over 1048576 bytes: big.bin ('
  expect_line '[identities] address 1 (example.org): author of 6 commits, committer of 6 commits, in the trailers of 1 commit'
  expect_line '[identities] address 2 (provider.sn): author of 0 commits, committer of 0 commits, in the trailers of 1 commit'
  expect_line 'Result: 14 findings.'
  expect_no_line ': README.md ('
  expect_no_line 'knowledge/sources.yaml'
  expect_no_line 'app/.env.demo'
  expect_no_value
}

names_the_commit_that_added_the_value() {
  build_history "$work/commits"
  added="$(git -C "$work/commits" rev-parse --short=12 main~3)"
  run_audit --repo "$work/commits" --only personal-data
  expect_line "[personal-data] IP address: notes.txt (commit $added)"
}

# Each commit that adds a match is its own finding, so that an accepted match
# never hides a later one in the same file.
reports_each_commit_that_adds_a_match() {
  new_repo "$work/twice"
  clean_tree "$work/twice"
  printf 'Host %s\n' "$IP" >"$work/twice/hosts.txt"
  commit "$work/twice" 'docs: add a host'
  first="$(git -C "$work/twice" rev-parse --short=12 HEAD)"
  printf 'Host %s\n' "$IP" >>"$work/twice/hosts.txt"
  commit "$work/twice" 'docs: add the host again'
  second="$(git -C "$work/twice" rev-parse --short=12 HEAD)"
  run_audit --repo "$work/twice" --only personal-data
  expect_line "[personal-data] IP address: hosts.txt (commit $first)"
  expect_line "[personal-data] IP address: hosts.txt (commit $second)"
  expect_line 'Result: 2 findings.'
}

reads_what_only_a_merge_adds() {
  new_repo "$work/merge"
  clean_tree "$work/merge"
  commit "$work/merge" 'docs: start'
  git -C "$work/merge" checkout -q -b topic
  printf 'topic\n' >"$work/merge/topic.txt"
  commit "$work/merge" 'docs: add topic'
  git -C "$work/merge" checkout -q main
  printf 'main\n' >"$work/merge/main.txt"
  commit "$work/merge" 'docs: add main'
  git -C "$work/merge" merge -q --no-ff --no-commit topic >/dev/null 2>&1
  printf 'Host %s\n' "$IP" >"$work/merge/merged.txt"
  git -C "$work/merge" add merged.txt
  git -C "$work/merge" commit -q -m 'Merge branch topic'
  run_audit --repo "$work/merge" --only personal-data
  expect_status 1
  expect_line '[personal-data] IP address: merged.txt ('
}

reads_a_long_line_in_parts() {
  new_repo "$work/long"
  clean_tree "$work/long"
  # One line of 14 000 characters; the value crosses the end of the first part.
  printf '%4090s%s%10000s\n' '' "$IP" '' >"$work/long/bundle.min.js"
  commit "$work/long" 'build: add a bundle'
  run_audit --repo "$work/long" --only personal-data
  expect_status 1
  expect_line '[personal-data] IP address: bundle.min.js ('
}

a_clean_history_passes() {
  new_repo "$work/clean"
  clean_tree "$work/clean"
  # A message may say that no forbidden source is used: messages are not content.
  commit "$work/clean" 'docs: start, with no LEDIAM or DDInter data'
  run_audit --repo "$work/clean" --only sources,personal-data,large-files,file-names
  expect_status 0
  expect_line 'Result: no finding.'
}

published_scans_the_pull_request_refs() {
  git init -q --bare -b main "$work/origin.git"
  new_repo "$work/author"
  clean_tree "$work/author"
  commit "$work/author" 'docs: start'
  git -C "$work/author" push -q "$work/origin.git" main
  printf 'Host %s\n' "$IP" >"$work/author/pr.txt"
  commit "$work/author" 'docs: add a host'
  # Only a pull request ref holds the commit, as on GitHub after a branch is deleted.
  git -C "$work/author" push -q "$work/origin.git" HEAD:refs/pull/1/head
  git clone -q "$work/origin.git" "$work/local"

  run_audit --repo "$work/local" --only personal-data
  expect_status 0
  run_audit --repo "$work/local" --published --only personal-data
  expect_status 1
  expect_line '[personal-data] IP address: pr.txt ('
  expect_no_value
}

refuses_unknown_options() {
  run_audit --bogus
  expect_status 2
  run_audit --only personal-data,nope
  expect_status 2
  expect_line 'unknown check "nope"'
}

refuses_an_archive_with_a_wrong_checksum() {
  new_repo "$work/tampered"
  clean_tree "$work/tampered"
  commit "$work/tampered" 'docs: start'
  mkdir "$work/release"
  for name in linux_x64.tar.gz linux_arm64.tar.gz darwin_x64.tar.gz darwin_arm64.tar.gz windows_x64.zip; do
    printf 'not the release\n' >"$work/release/gitleaks_8.30.1_$name"
  done
  dir="$work/release"
  if command -v cygpath >/dev/null 2>&1; then dir="$(cygpath -m "$dir")"; fi
  export AUDIT_GITLEAKS_BASE_URL="file:///${dir#/}"
  run_audit --repo "$work/tampered" --only secrets
  unset AUDIT_GITLEAKS_BASE_URL
  expect_status 2
  expect_line 'checksum mismatch'
}

finds_a_secret_with_gitleaks() {
  token="ghp_$(printf 'audit fixture' | sha256sum | cut -c1-36)"
  new_repo "$work/secrets"
  clean_tree "$work/secrets"
  commit "$work/secrets" 'docs: start'
  printf 'token = "%s"\n' "$token" >"$work/secrets/config.txt"
  commit "$work/secrets" 'chore: add config'
  git -C "$work/secrets" rm -q config.txt
  commit "$work/secrets" 'chore: remove config'
  run_audit --repo "$work/secrets" --only secrets
  expect_status 1
  expect_line '[secrets] github-pat: config.txt ('
  expect_no_value "$token"
}

# Runs the scenario named $1 and reports it.
scenario() {
  total=$((total + 1))
  problems=''
  "$1"
  if [ -z "$problems" ]; then
    echo "ok   $1"
  else
    failures=$((failures + 1))
    echo "FAIL $1:$problems"
    sed 's/^/     | /' "$out"
  fi
}

scenario finds_everything_in_the_history
scenario names_the_commit_that_added_the_value
scenario reports_each_commit_that_adds_a_match
scenario reads_what_only_a_merge_adds
scenario reads_a_long_line_in_parts
scenario a_clean_history_passes
scenario published_scans_the_pull_request_refs
scenario refuses_unknown_options
scenario refuses_an_archive_with_a_wrong_checksum
if [ "${AUDIT_TEST_OFFLINE:-0}" = 1 ]; then
  echo "skip finds_a_secret_with_gitleaks (AUDIT_TEST_OFFLINE=1)"
else
  scenario finds_a_secret_with_gitleaks
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures of $total scenarios failed." >&2
  exit 1
fi
echo "All $total scenarios passed."
