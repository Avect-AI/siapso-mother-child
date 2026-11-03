#!/usr/bin/env sh
# Runs a real Python 3 interpreter: the Windows launcher first, then python3,
# then python. The Microsoft Store placeholder fails the version check.
if command -v py >/dev/null 2>&1 && py -3 -c "" >/dev/null 2>&1; then
  exec py -3 "$@"
fi
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 \
    && "$candidate" -c "import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)" >/dev/null 2>&1; then
    exec "$candidate" "$@"
  fi
done
echo "Python 3 introuvable : installez-le pour les controles d'hygiene." >&2
exit 1
