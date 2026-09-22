#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h:h}"
dist_dir="$project_dir/dist"
app_name="Codex Local Hub.app"
stage_dir="$(mktemp -d /tmp/codex-task-bridge-build.XXXXXX)"
app_dir="$stage_dir/$app_name"
contents_dir="$app_dir/Contents"
resources_dir="$contents_dir/Resources"
server_dir="$resources_dir/server"
iconset_dir="$stage_dir/AppIcon.iconset"
runtime_dir="$resources_dir/runtime"

mkdir -p "$contents_dir/MacOS" "$server_dir/src" "$server_dir/public" "$iconset_dir" "$dist_dir"
cp "$project_dir/desktop/Info.plist" "$contents_dir/Info.plist"
for localization in "$project_dir/desktop/"*.lproj; do
  [[ -d "$localization" ]] && /bin/cp -R "$localization" "$resources_dir/"
done
cp "$project_dir/src/"*.mjs "$server_dir/src/"
cp "$project_dir/public/"* "$server_dir/public/"

/usr/bin/swiftc -parse-as-library -O -target arm64-apple-macos13 -framework AppKit -framework CoreImage "$project_dir/desktop/CodexBridgeApp.swift" -o "$stage_dir/CodexLocalHub-arm64"
/usr/bin/swiftc -parse-as-library -O -target x86_64-apple-macos13 -framework AppKit -framework CoreImage "$project_dir/desktop/CodexBridgeApp.swift" -o "$stage_dir/CodexLocalHub-x64"
/usr/bin/lipo -create "$stage_dir/CodexLocalHub-arm64" "$stage_dir/CodexLocalHub-x64" -output "$contents_dir/MacOS/CodexLocalHub"
/usr/bin/swiftc -O -framework AppKit "$project_dir/desktop/IconGenerator.swift" -o "$stage_dir/icon-generator"
"$stage_dir/icon-generator" "$stage_dir/icon-1024.png"
/usr/bin/sips -z 192 192 "$stage_dir/icon-1024.png" --out "$server_dir/public/app-icon-192.png" >/dev/null
/usr/bin/sips -z 512 512 "$stage_dir/icon-1024.png" --out "$server_dir/public/app-icon-512.png" >/dev/null

for spec in "16:16" "16:16@2x" "32:32" "32:32@2x" "128:128" "128:128@2x" "256:256" "256:256@2x" "512:512" "512:512@2x"; do
  base="${spec%%:*}"
  suffix="${spec#*:}"
  pixels="$base"
  name="icon_${suffix}.png"
  if [[ "$suffix" == *"@2x" ]]; then
    pixels=$((base * 2))
  fi
  /usr/bin/sips -z "$pixels" "$pixels" "$stage_dir/icon-1024.png" --out "$iconset_dir/$name" >/dev/null
done
/usr/bin/iconutil -c icns "$iconset_dir" -o "$resources_dir/AppIcon.icns"

if [[ "${BUNDLE_NODE:-0}" == "1" ]]; then
  mkdir -p "$runtime_dir"
  NODE_RUNTIME_VERSION="${NODE_RUNTIME_VERSION:-24.21.0}" "$project_dir/scripts/fetch-node-runtime.sh" "$runtime_dir"
fi

if [[ -n "${DEVELOPER_ID_APPLICATION:-}" ]]; then
  if [[ -d "$runtime_dir" ]]; then
    for runtime in "$runtime_dir"/node-*; do
      /usr/bin/codesign --force --options runtime --timestamp --entitlements "$project_dir/desktop/NodeRuntime.entitlements" --sign "$DEVELOPER_ID_APPLICATION" "$runtime"
    done
  fi
  /usr/bin/codesign --force --options runtime --timestamp --sign "$DEVELOPER_ID_APPLICATION" "$app_dir"
else
  /usr/bin/codesign --force --deep --sign - "$app_dir" >/dev/null
fi

target="$dist_dir/$app_name"
if [[ -e "$target" ]]; then
  backup="$dist_dir/Codex Local Hub.previous.$(date +%Y%m%d-%H%M%S).app"
  mv "$target" "$backup"
fi
mv "$app_dir" "$target"
echo "$target"
