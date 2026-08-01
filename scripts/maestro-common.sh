#!/usr/bin/env bash
# shared plumbing for the maestro lanes; sourced by maestro-ios.sh / maestro-android.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# maestro enables anonymous telemetry by default; a build tool should not phone home
export MAESTRO_CLI_NO_ANALYTICS=1

# A driver that fails to start burns this budget and then reports NO assertion error and no
# failing-step screenshot, so unrelated flows all fail at near-identical durations and look like
# one app bug. Keep it low enough that the driver's own error surfaces instead.
# Uniform durations across unrelated flows = a fixed timeout, not variable work.
: "${MAESTRO_DRIVER_STARTUP_TIMEOUT:=60000}"
export MAESTRO_DRIVER_STARTUP_TIMEOUT

WORK_DIR="${MAESTRO_WORK_DIR:-/tmp/recess-maestro}"
SHOT_DIR="${MAESTRO_SHOT_DIR:-/tmp/recess-maestro-shots}"
TAGS="${MAESTRO_TAGS:-gate}"
# the workspace root, not flows/: config.yaml's `flows:` globs are relative to it
WORKSPACE="${MAESTRO_WORKSPACE:-$ROOT/.maestro}"
CONFIG_FILE="$WORKSPACE/config.yaml"

PLATFORM=''
REPRODUCE=''
MAESTRO=''
# bash 3.2 (the macos default, and what GitHub's macos runners use for `run:`) exits 0
# on a `set -u` abort inside a function, so success has to be stated, not assumed
COMPLETED=0

# stderr, so a function that logs can still return a value on stdout
log() { printf '\n[maestro] %s\n' "$*" >&2; }
warn() { printf '[maestro] warning: %s\n' "$*" >&2; }

hint() {
	if [ -n "$REPRODUCE" ]; then
		printf '[maestro] reproduce: %s\n' "$REPRODUCE" >&2
	fi
}

die() {
	printf '\n[maestro] FAILED: %s\n' "$*" >&2
	hint
	exit 1
}

on_err() {
	printf '\n[maestro] FAILED (exit %s) at: %s\n' "$1" "$2" >&2
	hint
}

finish() { COMPLETED=1; }

cleanup() {
	local rc=$?
	if [ "$COMPLETED" != '1' ] && [ "$rc" -eq 0 ]; then
		printf '\n[maestro] FAILED: the run aborted before finishing (see the error above)\n' >&2
		hint
		exit 1
	fi
	exit "$rc"
}

trap 'on_err "$?" "$BASH_COMMAND"' ERR
trap cleanup EXIT INT TERM

require_cmd() {
	command -v "$1" >/dev/null 2>&1 || die "$1 is required but not on PATH${2:+ ($2)}"
}

# #region maestro cli

resolve_maestro() {
	if command -v maestro >/dev/null 2>&1; then
		MAESTRO="$(command -v maestro)"
	elif [ -x "$HOME/.maestro/bin/maestro" ]; then
		MAESTRO="$HOME/.maestro/bin/maestro"
	else
		die "maestro cli not found; install it with: curl -Ls https://get.maestro.mobile.dev | bash
       homebrew's formula wants a different Command Line Tools version than this machine
       has, and reconciling that needs sudo, so the vendor installer is the supported path"
	fi
	require_cmd java 'maestro needs a jdk 17 or newer'
	log "maestro $("$MAESTRO" --version 2>/dev/null | tail -1) at $MAESTRO"
}

# #endregion

# #region web bundle

# recess has no backend, so unlike sky there is nothing to stand up here and no ports to
# reconcile - `bun run test:e2e` and this lane can run at the same time
build_web() {
	local dotenv="$1"
	log "building the web bundle with $dotenv"
	NODE_OPTIONS='--max-old-space-size=8192' bunx nuxi build --dotenv "$dotenv"
}

# `ssr: false` bakes the ionic mode into the client bundle, and the whole point of the ios
# dotenv is that ionic renders its ios variant - a bundle left over from `bun run generate`
# is md, so every ios-shaped selector would be testing the wrong widget set
assert_bundle_mode() {
	local expected="$1" entry="$ROOT/.output/public"
	[ -d "$entry" ] || die "no .output/public after the build"
	grep -rqs "\"$expected\"" "$entry"/_nuxt/*.js ||
		grep -rqs "mode:\"$expected\"" "$entry" ||
		die "the bundle does not look built for ionic mode '$expected'; delete .output and re-run"
	log "bundle built for ionic mode $expected"
}

# #endregion

# #region flows

run_flows() {
	local device="$1" out_dir="$WORK_DIR/$PLATFORM" artifacts junit
	junit="$out_dir/report.xml"
	if [ "$TAGS" = 'eval' ]; then
		artifacts="$SHOT_DIR/$PLATFORM"
	else
		artifacts="$out_dir/artifacts"
	fi
	# each run starts clean, or the eval lane would score stale frames
	case "$artifacts" in
		/*/*) rm -rf "$artifacts" ;;
		*) die "refusing to clear a suspicious artifacts path: '$artifacts'" ;;
	esac
	mkdir -p "$artifacts" "$out_dir"

	# the XCUITest driver wedges occasionally and then every flow after the first fails in 0s
	# with nothing in the flow logs; reinstalling it is the documented remedy
	local -a driver_args=()
	if [ "${MAESTRO_REINSTALL_DRIVER:-0}" = '1' ]; then
		log 'reinstalling the maestro driver'
		driver_args=(--reinstall-driver)
	fi

	local -a config_args=()
	if [ -f "$CONFIG_FILE" ]; then
		# pass it explicitly; maestro only auto-discovers config.yaml in the folder it is given
		config_args=(--config "$CONFIG_FILE")
	else
		warn "no $CONFIG_FILE; running without a workspace config"
	fi

	[ -d "$WORKSPACE/flows" ] || die "no flows at $WORKSPACE/flows"

	log "running '$TAGS' flows from $WORKSPACE on $device"
	"$MAESTRO" test \
		--udid "$device" \
		--include-tags="$TAGS" \
		--format=JUNIT \
		--output="$junit" \
		--test-output-dir="$artifacts" \
		${config_args[@]+"${config_args[@]}"} \
		${driver_args[@]+"${driver_args[@]}"} \
		-e SHOT_DIR="$artifacts" \
		"$WORKSPACE"

	log "junit report: $junit"
	log "artifacts:    $artifacts"
}

# #endregion
