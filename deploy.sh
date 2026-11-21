#!/bin/bash
# Empaqueta el PWA Apple-grade (web/) en backend/public y despliega al servicio aislado `credo` en el VPS.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "→ [1/2] Copiando PWA ultra-ligero (web/) a backend/public..."
rm -rf "$ROOT_DIR/backend/public"
mkdir -p "$ROOT_DIR/backend/public"
cp -R "$ROOT_DIR/web/." "$ROOT_DIR/backend/public/"

echo "→ [2/2] Subiendo y desplegando en el VPS (servicio: credo)..."
~/.claude/skills/servicios-vps/subir.sh credo "$ROOT_DIR/backend"
