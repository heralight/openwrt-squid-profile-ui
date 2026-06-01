#!/bin/sh

set -eu

SDK_DIR="${1:-}"
PACKAGE_DIR="${2:-}"
USIGN_SECRET="${3:-}"

fail() {
	printf 'ERROR: %s\n' "$*" >&2
	exit 1
}

[ -n "$SDK_DIR" ] || fail "missing SDK directory argument"
[ -n "$PACKAGE_DIR" ] || fail "missing package directory argument"
[ -d "$SDK_DIR" ] || fail "SDK directory does not exist: $SDK_DIR"
[ -d "$PACKAGE_DIR" ] || fail "package directory does not exist: $PACKAGE_DIR"
[ -x "$SDK_DIR/scripts/ipkg-make-index.sh" ] || fail "missing SDK index script: $SDK_DIR/scripts/ipkg-make-index.sh"
[ -x "$SDK_DIR/staging_dir/host/bin/usign" ] || fail "missing SDK usign binary: $SDK_DIR/staging_dir/host/bin/usign"

(
	cd "$PACKAGE_DIR"
	"$SDK_DIR/scripts/ipkg-make-index.sh" . 2>/dev/null > Packages.manifest
	grep -vE '^(Maintainer|LicenseFiles|Source|SourceName|Require|SourceDateEpoch):' Packages.manifest > Packages
	gzip -9nc Packages > Packages.gz
	if [ -n "$USIGN_SECRET" ]; then
		[ -f "$USIGN_SECRET" ] || fail "usign secret key file does not exist: $USIGN_SECRET"
		"$SDK_DIR/staging_dir/host/bin/usign" -S -m Packages -s "$USIGN_SECRET" -x Packages.sig
	fi
)

printf 'Generated OPKG index in %s\n' "$PACKAGE_DIR"
