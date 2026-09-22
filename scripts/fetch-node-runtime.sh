#!/bin/zsh
set -euo pipefail

destination="${1:?usage: fetch-node-runtime.sh DESTINATION}"
version="${NODE_RUNTIME_VERSION:-24.21.0}"
cache_root="${CODEX_HUB_BUILD_CACHE:-${TMPDIR:-/tmp}/codex-local-hub-runtime-cache}"
release_url="https://nodejs.org/dist/v${version}"
mkdir -p "$destination" "$cache_root"

checksums="$cache_root/SHASUMS256-v${version}.txt"
[[ -f "$checksums" ]] || /usr/bin/curl --fail --location --silent --show-error "$release_url/SHASUMS256.txt" -o "$checksums"

for arch in arm64 x64; do
  archive="node-v${version}-darwin-${arch}.tar.gz"
  archive_path="$cache_root/$archive"
  [[ -f "$archive_path" ]] || /usr/bin/curl --fail --location --silent --show-error "$release_url/$archive" -o "$archive_path"
  expected="$(/usr/bin/awk -v name="$archive" '$2 == name { print $1 }' "$checksums")"
  [[ -n "$expected" ]] || { echo "Missing checksum for $archive" >&2; exit 1; }
  actual="$(/usr/bin/shasum -a 256 "$archive_path" | /usr/bin/awk '{ print $1 }')"
  [[ "$actual" == "$expected" ]] || { echo "Checksum mismatch for $archive" >&2; exit 1; }
  extract_dir="$(mktemp -d /tmp/codex-local-hub-node.XXXXXX)"
  /usr/bin/tar -xzf "$archive_path" -C "$extract_dir" "node-v${version}-darwin-${arch}/bin/node"
  /bin/cp "$extract_dir/node-v${version}-darwin-${arch}/bin/node" "$destination/node-${arch}"
  /bin/chmod 755 "$destination/node-${arch}"
done
