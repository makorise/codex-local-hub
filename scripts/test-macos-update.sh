#!/bin/zsh
set -euo pipefail

project_dir="${0:A:h:h}"
test_dir="$(mktemp -d /tmp/codex-local-hub-update-tests.XXXXXX)"
trap '/bin/rm -rf "$test_dir"' EXIT

CORE_VERSION=0.2.3 CORE_MINIMUM_HOST_VERSION=0.2.2 "$project_dir/scripts/package-core.sh" >/dev/null
core_archive="$project_dir/dist/Codex-Local-Hub-core-0.2.3.zip"
core_checksum="$(/usr/bin/shasum -a 256 "$core_archive" | /usr/bin/awk '{print $1}')"
CORE_VERSION=0.2.4 CORE_MINIMUM_HOST_VERSION=0.2.2 "$project_dir/scripts/package-core.sh" >/dev/null
next_core_archive="$project_dir/dist/Codex-Local-Hub-core-0.2.4.zip"
next_core_checksum="$(/usr/bin/shasum -a 256 "$next_core_archive" | /usr/bin/awk '{print $1}')"
CORE_VERSION=0.2.5 CORE_MINIMUM_HOST_VERSION=0.2.2 "$project_dir/scripts/package-core.sh" >/dev/null
third_core_archive="$project_dir/dist/Codex-Local-Hub-core-0.2.5.zip"
third_core_checksum="$(/usr/bin/shasum -a 256 "$third_core_archive" | /usr/bin/awk '{print $1}')"

/usr/bin/swiftc "$project_dir/desktop/UpdateChecker.swift" "$project_dir/test/update-checker-tests.swift" -o "$test_dir/update-checker-tests"
"$test_dir/update-checker-tests"
/usr/bin/swiftc -framework CryptoKit "$project_dir/desktop/UpdateChecker.swift" "$project_dir/desktop/CoreUpdateManager.swift" "$project_dir/test/core-update-tests.swift" -o "$test_dir/core-update-tests"
"$test_dir/core-update-tests" "$core_archive" "$core_checksum" "$next_core_archive" "$next_core_checksum" "$third_core_archive" "$third_core_checksum"
/usr/bin/swiftc "$project_dir/desktop/ServerEnvironment.swift" "$project_dir/test/server-environment-tests.swift" -o "$test_dir/server-environment-tests"
"$test_dir/server-environment-tests"
/usr/bin/swiftc "$project_dir/desktop/RuntimeHealth.swift" "$project_dir/test/runtime-health-tests.swift" -o "$test_dir/runtime-health-tests"
"$test_dir/runtime-health-tests"
