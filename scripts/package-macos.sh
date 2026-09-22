#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h:h}"
version="$(cd "$project_dir" && node -p "require('./package.json').version")"
app_path="$project_dir/dist/Codex Local Hub.app"
dmg_path="$project_dir/dist/Codex-Local-Hub-${version}-universal.dmg"
stage_dir="$(mktemp -d /tmp/codex-local-hub-dmg.XXXXXX)"

BUNDLE_NODE=1 "$project_dir/scripts/build-macos-app.sh"
/usr/bin/ditto "$app_path" "$stage_dir/Codex Local Hub.app"
/bin/ln -s /Applications "$stage_dir/Applications"
/bin/rm -f "$dmg_path"
/usr/sbin/diskutil image create from --volumeName "Codex Local Hub" --format UDZO "$stage_dir" "$dmg_path"

if [[ -n "${DEVELOPER_ID_APPLICATION:-}" ]]; then
  /usr/bin/codesign --force --timestamp --sign "$DEVELOPER_ID_APPLICATION" "$dmg_path"
fi

if [[ -n "${DEVELOPER_ID_APPLICATION:-}" && -n "${APPLE_NOTARY_PROFILE:-}" ]]; then
  /usr/bin/xcrun notarytool submit "$dmg_path" --keychain-profile "$APPLE_NOTARY_PROFILE" --wait
  /usr/bin/xcrun stapler staple "$dmg_path"
  /usr/bin/xcrun stapler validate "$dmg_path"
elif [[ -n "${DEVELOPER_ID_APPLICATION:-}" && -n "${APPLE_ID:-}" && -n "${APPLE_TEAM_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]]; then
  /usr/bin/xcrun notarytool submit "$dmg_path" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --wait
  /usr/bin/xcrun stapler staple "$dmg_path"
  /usr/bin/xcrun stapler validate "$dmg_path"
fi

/usr/bin/codesign --verify --deep --strict --verbose=2 "$app_path"
/usr/bin/lipo -info "$app_path/Contents/MacOS/CodexLocalHub"
echo "$dmg_path"
