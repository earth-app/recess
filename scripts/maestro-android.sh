#!/usr/bin/env bash
# builds recess for an android emulator and runs the maestro flows against it

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/maestro-common.sh"

PLATFORM='android'
REPRODUCE='bun run maestro:android'

DOTENV="$ROOT/.env.android"
APK_PATH="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
APP_ID='com.earthapp.recess'

pick_device() {
	local serial=''

	if [ -n "${MAESTRO_ANDROID_DEVICE:-}" ]; then
		printf '%s' "$MAESTRO_ANDROID_DEVICE"
		return 0
	fi

	serial="$(adb devices | awk '/\tdevice$/ { print $1; exit }' || true)"
	[ -n "$serial" ] || die "no android device or emulator attached; start one with: emulator -avd <name>
       check what is attached with: adb devices"
	printf '%s' "$serial"
}

require_cmd adb 'install the android sdk platform-tools'
require_cmd bun
resolve_maestro

build_web "$DOTENV"
assert_bundle_mode md

log 'syncing the capacitor android project'
bunx cap sync android

# capacitor's plugin modules pin `kotlin { jvmToolchain(21) }`, so a jdk 17 gradle run
# fails on the plugin projects rather than on ours
log 'assembling the debug apk'
(cd android && ./gradlew --console=plain assembleDebug)

[ -f "$APK_PATH" ] || die "gradle produced no apk at $APK_PATH"

SERIAL="$(pick_device)"

log "installing $APK_PATH on $SERIAL"
adb -s "$SERIAL" install -r -d "$APK_PATH"

run_flows "$SERIAL"

finish
