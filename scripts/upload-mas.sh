#!/bin/sh
# Validates and uploads the Mac App Store package to App Store Connect.
#   npm run dist:mas && npm run upload:mas
# Credentials, one of:
#   ASC_KEY_ID + ASC_ISSUER_ID   App Store Connect API key (.p8 in ~/.appstoreconnect/private_keys/)
#   APPLE_ID                     Apple ID with an app-specific password stored once with:
#                                xcrun altool --store-password-in-keychain-item AC_PASSWORD -u "$APPLE_ID" -p <app-specific-password>
set -eu
PKG=$(ls -t release/mas-universal/*.pkg 2>/dev/null | head -n 1 || true)
[ -n "$PKG" ] || { echo "No package in release/mas-universal: run npm run dist:mas first." >&2; exit 1; }
if [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ]; then
  set -- --api-key "$ASC_KEY_ID" --api-issuer "$ASC_ISSUER_ID"
elif [ -n "${APPLE_ID:-}" ]; then
  set -- -u "$APPLE_ID" -p "@keychain:${ASC_KEYCHAIN_ITEM:-AC_PASSWORD}"
else
  echo "Set ASC_KEY_ID + ASC_ISSUER_ID, or APPLE_ID (see the top of this script)." >&2
  exit 1
fi
echo "Validating $PKG"
xcrun altool --validate-app -f "$PKG" -t macos "$@"
echo "Uploading $PKG"
xcrun altool --upload-app -f "$PKG" -t macos "$@"
