#!/bin/bash
# Publica una nueva actualización OTA de Credo en GitHub Releases.
# Uso: ./publish-update.sh 1.0.1 "Mejoras de rendimiento y diseño"
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
NEW_VER="${1:-}"
NOTES="${2:-Mejoras de rendimiento, diseño y estabilidad en Credo.}"

if [ -z "$NEW_VER" ]; then
  echo "Uso: ./publish-update.sh <version> \"<notas>\""
  echo "Ejemplo: ./publish-update.sh 1.0.1 \"Nuevo reproductor y mejoras\""
  exit 1
fi

VER_FILE="$ROOT_DIR/android-app/version.properties"
CUR_CODE=$(grep '^VERSION_CODE=' "$VER_FILE" | cut -d= -f2)
NEXT_CODE=$((CUR_CODE + 1))

cat > "$VER_FILE" <<EOF
VERSION_CODE=$NEXT_CODE
VERSION_NAME=$NEW_VER
EOF

echo "→ [1/4] Compilando APK firmado v$NEW_VER (code $NEXT_CODE)..."
(
  cd "$ROOT_DIR/android-app"
  ./gradlew assembleRelease --no-daemon
)

mkdir -p "$ROOT_DIR/releases"
APK_OUT="$ROOT_DIR/releases/Credo-v${NEW_VER}.apk"
cp "$ROOT_DIR/android-app/app/build/outputs/apk/release/app-release.apk" "$APK_OUT"
shasum -a 256 "$APK_OUT" > "${APK_OUT}.sha256"

echo "→ [2/4] Guardando versión en Git..."
git -C "$ROOT_DIR" add android-app/version.properties
git -C "$ROOT_DIR" commit -m "release: Credo Android v${NEW_VER}" || true
git -C "$ROOT_DIR" tag -f "v${NEW_VER}"

echo "→ [3/4] Subiendo a GitHub..."
git -C "$ROOT_DIR" push origin main --tags

echo "→ [4/4] Publicando GitHub Release v${NEW_VER} (los Android instalados recibirán el aviso OTA)..."
gh release create "v${NEW_VER}" \
  "$APK_OUT" "${APK_OUT}.sha256" \
  --repo ThePunisherBaby/credo-app \
  --title "Credo v${NEW_VER}" \
  --notes "$NOTES"

echo "✔ Actualización v${NEW_VER} publicada en GitHub Releases."
