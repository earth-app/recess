#!/usr/bin/env bash
# Generates the watchOS AppIcon for the Watch target from the shared resources/
# source. watchOS 10+ catalogs accept a single 1024x1024 universal image and the
# system handles every device-specific size at runtime, so we don't need to emit
# the legacy per-size matrix the way iOS 17 and earlier did.
#
# watchOS masks the icon to a CIRCLE, which makes two properties of the source
# load-bearing that a square icon can ignore:
#
#   1. The artwork must be centred. resources/icon.png has the slide sitting at
#      +64+128 in a 1024 square - 128px of headroom against 64px below - so it
#      renders low and the mask eats the bottom of the slide.
#   2. The artwork's bounding-box DIAGONAL, not its width, has to fit the circle.
#      The untouched source measures 896x832, a 1223px diagonal against a 1024px
#      mask, so its corners are clipped however well it is centred.
#
# Both are corrected here rather than in resources/icon.png, so the square iOS
# icon keeps using the artwork at full bleed.
#
# Sources:
#   resources/icon-watch.png  (optional - artwork tuned for the small canvas)
#   resources/icon.png        (required - fallback when icon-watch.png is absent)
#
# Output:
#   ios/App/Watch/Assets.xcassets/AppIcon.appiconset/AppIcon.png
#   ios/App/Watch/Assets.xcassets/AppIcon.appiconset/Contents.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RESOURCES_DIR="$REPO_ROOT/resources"
DEST_DIR="$REPO_ROOT/ios/App/Watch/Assets.xcassets/AppIcon.appiconset"

WATCH_SOURCE="$RESOURCES_DIR/icon-watch.png"
FALLBACK_SOURCE="$RESOURCES_DIR/icon.png"
# Watch icons are circular masks on a colored background - keep the same brand
# wash as the iOS light variant so the two icons look like the same product.
WATCH_BACKGROUND="${WATCH_ICON_BACKGROUND:-#3498db}"

CANVAS=1024
# fraction of the mask diameter the artwork's diagonal may occupy; the remainder
# is the optical margin between the artwork and the circle's edge
SAFE_FRACTION="${WATCH_ICON_SAFE_FRACTION:-0.90}"
# tolerance for "this pixel is the background"; the source is flat-filled
TRIM_FUZZ="${WATCH_ICON_TRIM_FUZZ:-5%}"

if ! command -v magick >/dev/null 2>&1; then
	echo "error: ImageMagick 7 (\`magick\`) is required - install with \`brew install imagemagick\`" >&2
	exit 1
fi

[[ -f "$WATCH_SOURCE" ]] || WATCH_SOURCE="$FALLBACK_SOURCE"

if [[ ! -f "$WATCH_SOURCE" ]]; then
	echo "error: source icon not found at $WATCH_SOURCE" >&2
	exit 1
fi

mkdir -p "$DEST_DIR"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# measure the artwork itself, ignoring however much transparent or flat padding
# the source happens to carry
read -r ART_W ART_H <<<"$(magick "$WATCH_SOURCE" -fuzz "$TRIM_FUZZ" -trim -format '%w %h' info:)"

if [[ -z "$ART_W" || -z "$ART_H" || "$ART_W" -eq 0 || "$ART_H" -eq 0 ]]; then
	echo "error: could not measure artwork bounds in $WATCH_SOURCE" >&2
	exit 1
fi

TARGET_W=$(awk -v w="$ART_W" -v h="$ART_H" -v canvas="$CANVAS" -v frac="$SAFE_FRACTION" \
	'BEGIN { d = sqrt(w*w + h*h); s = (canvas * frac) / d; if (s > 1) s = 1; printf "%d", w * s + 0.5 }')
TARGET_H=$(awk -v w="$ART_W" -v h="$ART_H" -v canvas="$CANVAS" -v frac="$SAFE_FRACTION" \
	'BEGIN { d = sqrt(w*w + h*h); s = (canvas * frac) / d; if (s > 1) s = 1; printf "%d", h * s + 0.5 }')

echo "artwork ${ART_W}x${ART_H} -> ${TARGET_W}x${TARGET_H}, centred on ${CANVAS}x${CANVAS}"

# trim to the artwork, rescale to fit the circle, then centre on an opaque square.
# The PNG itself stays a 1024x1024 square per Apple's spec; the system applies the
# circular crop and any device-specific resize.
magick "$WATCH_SOURCE" \
	-fuzz "$TRIM_FUZZ" -trim +repage \
	-resize "${TARGET_W}x${TARGET_H}!" \
	-background "$WATCH_BACKGROUND" -gravity center -extent "${CANVAS}x${CANVAS}" \
	-alpha remove -alpha off \
	"$DEST_DIR/AppIcon.png"

# Prove the circular mask clips nothing, rather than trusting the arithmetic: mask
# the result, recomposite over the same background, and require an exact match.
RADIUS=$(awk -v canvas="$CANVAS" 'BEGIN { printf "%.1f", (canvas - 1) / 2 }')
magick -size "${CANVAS}x${CANVAS}" xc:black \
	-fill white -draw "circle $RADIUS,$RADIUS $RADIUS,0" \
	"$WORK_DIR/mask.png"
magick "$DEST_DIR/AppIcon.png" "$WORK_DIR/mask.png" \
	-alpha off -compose CopyOpacity -composite \
	-background "$WATCH_BACKGROUND" -alpha remove -alpha off \
	"$WORK_DIR/masked.png"

# `compare -metric AE` reports on stderr as `<absolute> (<normalized>)`
CLIPPED=$(magick compare -metric AE "$DEST_DIR/AppIcon.png" "$WORK_DIR/masked.png" null: 2>&1 || true)
CLIPPED=$(awk '{ sub(/\..*/, "", $1); print $1 }' <<<"$CLIPPED")

if [[ "$CLIPPED" != "0" ]]; then
	echo "error: the circular mask would clip $CLIPPED px of artwork" >&2
	echo "       lower WATCH_ICON_SAFE_FRACTION (currently $SAFE_FRACTION) and re-run" >&2
	exit 1
fi

echo "circular mask clips 0 px"

# NOTE: no "platform" key. On a watchOS-only target Xcode treats `platform:
# watchos` as a filter that excludes the image, and the asset compiler then fails
# with "app icon set ... did not have any applicable content".
cat >"$DEST_DIR/Contents.json" <<'JSON'
{
	"images": [
		{
			"filename": "AppIcon.png",
			"idiom": "universal",
			"size": "1024x1024"
		}
	],
	"info": {
		"author": "xcode",
		"version": 1
	}
}
JSON

echo "watchOS AppIcon written to $DEST_DIR"
