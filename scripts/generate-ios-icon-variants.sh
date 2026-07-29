#!/usr/bin/env bash
# Generates iOS 18+/26 AppIcon variants (light, dark, tinted) so the app icon
# participates in Liquid Glass effects and adapts to dark / tinted home screens.
#
# Sources (PNG with transparency, ideally >= 1024x1024):
#   resources/icon.png           (required - also used as fallback)
#   resources/icon-dark.png      (optional - artwork tuned for dark backdrop)
#   resources/icon-tinted.png    (optional - artwork tuned for monochrome tint)
#
# @capacitor/assets 3.x flattens iOS icons onto a single opaque background and
# does not emit appearance-variant entries. This script runs after it and
# rewrites the AppIcon.appiconset so iOS picks the correct variant per mode.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RESOURCES_DIR="$REPO_ROOT/resources"
DEST_DIR="$REPO_ROOT/ios/App/App/Assets.xcassets/AppIcon.appiconset"

LIGHT_SOURCE="$RESOURCES_DIR/icon.png"
DARK_SOURCE="$RESOURCES_DIR/icon-dark.png"
TINTED_SOURCE="$RESOURCES_DIR/icon-tinted.png"
LIGHT_BACKGROUND="${IOS_ICON_LIGHT_BACKGROUND:-#ffffff}"

if ! command -v magick >/dev/null 2>&1; then
	echo "error: ImageMagick 7 (\`magick\`) is required - install with \`brew install imagemagick\`" >&2
	exit 1
fi

if [[ ! -f "$LIGHT_SOURCE" ]]; then
	echo "error: source icon not found at $LIGHT_SOURCE" >&2
	exit 1
fi

[[ -f "$DARK_SOURCE" ]] || DARK_SOURCE="$LIGHT_SOURCE"
[[ -f "$TINTED_SOURCE" ]] || TINTED_SOURCE="$LIGHT_SOURCE"

mkdir -p "$DEST_DIR"

# resources/icon.png carries uneven padding (the artwork sits at +64+128 in a 1024
# square, so 128px above against 64px below) and reads visibly low once iOS rounds
# the corners. Trim to the artwork and re-centre instead of editing the source, so
# the same file keeps serving the watch script and any future variant.
TRIM_FUZZ="${IOS_ICON_TRIM_FUZZ:-5%}"
CANVAS=1024
# leave a little breathing room rather than bleeding the artwork to the rounded edge
ART_BOX=$(awk -v canvas="$CANVAS" 'BEGIN { printf "%d", canvas * 0.92 }')

# Light: opaque 1024x1024 composited over the brand light background. iOS still
# rounds the corners; the PNG itself stays a full square per Apple's spec.
magick "$LIGHT_SOURCE" \
	-fuzz "$TRIM_FUZZ" -trim +repage \
	-resize "${ART_BOX}x${ART_BOX}" \
	-background "$LIGHT_BACKGROUND" -gravity center -extent "${CANVAS}x${CANVAS}" \
	-alpha remove -alpha off \
	"$DEST_DIR/AppIcon-Light.png"

# Dark: keep the transparent background. iOS composites this over its own dark
# backdrop and applies the Liquid Glass material.
magick "$DARK_SOURCE" \
	-fuzz "$TRIM_FUZZ" -trim +repage \
	-resize "${ART_BOX}x${ART_BOX}" \
	-background none -gravity center -extent "${CANVAS}x${CANVAS}" \
	"$DEST_DIR/AppIcon-Dark.png"

# Tinted: grayscale luminance map with preserved alpha. iOS uses the luminance
# to apply the user / wallpaper tint - brighter pixels receive more color.
magick "$TINTED_SOURCE" \
	-fuzz "$TRIM_FUZZ" -trim +repage \
	-resize "${ART_BOX}x${ART_BOX}" \
	-background none -gravity center -extent "${CANVAS}x${CANVAS}" \
	-colorspace gray \
	"$DEST_DIR/AppIcon-Tinted.png"

# The legacy single-image catalog entry is no longer referenced.
rm -f "$DEST_DIR/AppIcon-512@2x.png"

cat >"$DEST_DIR/Contents.json" <<'JSON'
{
	"images": [
		{
			"filename": "AppIcon-Light.png",
			"idiom": "universal",
			"platform": "ios",
			"size": "1024x1024"
		},
		{
			"appearances": [
				{
					"appearance": "luminosity",
					"value": "dark"
				}
			],
			"filename": "AppIcon-Dark.png",
			"idiom": "universal",
			"platform": "ios",
			"size": "1024x1024"
		},
		{
			"appearances": [
				{
					"appearance": "luminosity",
					"value": "tinted"
				}
			],
			"filename": "AppIcon-Tinted.png",
			"idiom": "universal",
			"platform": "ios",
			"size": "1024x1024"
		}
	],
	"info": {
		"author": "xcode",
		"version": 1
	}
}
JSON

echo "iOS AppIcon variants written to $DEST_DIR"
