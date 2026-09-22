#!/bin/sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
case "$(/usr/bin/uname -m)" in
  arm64) runtime_name="node-arm64" ;;
  x86_64) runtime_name="node-x64" ;;
  *) runtime_name="" ;;
esac

if [[ -n "$runtime_name" ]]; then
  for application_dir in "/Applications" "${HOME:-}/Applications"; do
    bundled_node="$application_dir/Codex Local Hub.app/Contents/Resources/runtime/$runtime_name"
    if [[ -x "$bundled_node" ]]; then
      exec "$bundled_node" "$script_dir/deliver-image.mjs" "$@"
    fi
  done
fi

if command -v node >/dev/null 2>&1; then
  exec node "$script_dir/deliver-image.mjs" "$@"
fi

echo "Codex Local Hub's bundled Node.js runtime was not found. Install or launch Codex Local Hub first." >&2
exit 1
