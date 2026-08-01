#!/usr/bin/env bash
# builds recess for the ios simulator and runs the maestro flows against it

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/maestro-common.sh"

PLATFORM='ios'
REPRODUCE='bun run maestro:ios'

DOTENV="$ROOT/.env.ios"
DERIVED="${MAESTRO_DERIVED_DATA:-$WORK_DIR/derived-data-ios}"
APP_PATH="$DERIVED/Build/Products/Debug-iphonesimulator/App.app"

# #region device

# deliberately NOT "whatever is already booted": an older-runtime simulator left booted
# makes maestro fail with "Failed to get app binary directory", so the pick stays
# deterministic. MAESTRO_IOS_DEVICE overrides it
pick_simulator() {
	local udid=''

	if [ -n "${MAESTRO_IOS_DEVICE:-}" ]; then
		printf '%s' "$MAESTRO_IOS_DEVICE"
		return 0
	fi

	# runtimes are listed oldest first, so the last iphone is on the newest one available
	udid="$(xcrun simctl list devices available | grep -E '^[[:space:]]+iPhone' |
		grep -Eo '\([0-9A-Fa-f-]{36}\)' | tr -d '()' | tail -1 || true)"
	[ -n "$udid" ] || die "no available iphone simulator; create one in Xcode > Devices"
	printf '%s' "$udid"
}

boot_simulator() {
	local udid="$1"
	log "booting simulator $udid"
	xcrun simctl bootstatus "$udid" -b
	# the window server makes wkwebview rendering (and screenshots) behave
	open -a Simulator --args -CurrentDeviceUDID "$udid" >/dev/null 2>&1 || true
}

# #endregion

# the XCUITest driver wedges often enough on this machine that reinstalling it is the default;
# every flow after the first then fails in 0s with nothing in its own logs, which reads exactly
# like an app regression. MAESTRO_REINSTALL_DRIVER=0 opts out for a faster local loop
: "${MAESTRO_REINSTALL_DRIVER:=1}"
export MAESTRO_REINSTALL_DRIVER

require_cmd xcrun 'install Xcode and its command line tools'
require_cmd bun
resolve_maestro

build_web "$DOTENV"
assert_bundle_mode ios

log 'syncing the capacitor ios project'
bunx cap sync ios

# -destination, never -sdk: the App target embeds Watch.app, and `-sdk iphonesimulator`
# overrides SDKROOT for every target in the scheme, so the watchOS target then compiles
# against the iOS SDK and dies on `unable to resolve module dependency: 'WatchKit'`
log 'building App.app for the ios simulator'
xcodebuild \
	-project ios/App/App.xcodeproj \
	-scheme App \
	-configuration Debug \
	-destination 'generic/platform=iOS Simulator' \
	-derivedDataPath "$DERIVED" \
	-quiet \
	CODE_SIGNING_ALLOWED=NO \
	CODE_SIGNING_REQUIRED=NO \
	build

[ -d "$APP_PATH" ] || die "xcodebuild produced no app at $APP_PATH"

UDID="$(pick_simulator)"
boot_simulator "$UDID"

log "installing $APP_PATH"
xcrun simctl install "$UDID" "$APP_PATH"

run_flows "$UDID"

finish
