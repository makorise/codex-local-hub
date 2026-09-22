#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h:h}"
dist_dir="$project_dir/dist"
version="${CORE_VERSION:-$(cd "$project_dir" && node -p "require('./package.json').version")}"
minimum_host="${CORE_MINIMUM_HOST_VERSION:-$(cd "$project_dir" && node -p "require('./package.json').codexLocalHub.minimumCoreHostVersion")}"
stage_dir="$(mktemp -d /tmp/codex-local-hub-core.XXXXXX)"
archive="$dist_dir/Codex-Local-Hub-core-$version.zip"

trap '/bin/rm -rf "$stage_dir"' EXIT
mkdir -p "$dist_dir" "$stage_dir/src" "$stage_dir/public"
cp "$project_dir/src/"*.mjs "$stage_dir/src/"
cp "$project_dir/public/"* "$stage_dir/public/"
/usr/bin/printf '{"schemaVersion":1,"version":"%s","minimumHostVersion":"%s"}\n' "$version" "$minimum_host" > "$stage_dir/core-manifest.json"
/bin/rm -f "$archive" "$archive.sha256"
(cd "$stage_dir" && /usr/bin/zip -qry "$archive" core-manifest.json src public)
/usr/bin/shasum -a 256 "$archive" > "$archive.sha256"
echo "$archive"
