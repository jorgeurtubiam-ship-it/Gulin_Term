#!/usr/bin/env bash
# sync-plugins.sh - Sincroniza plugins del entorno dev a la app instalada
# Funciona en: macOS, Linux, Windows (Git Bash/MSYS2/Cygwin)
# GuLiN Agent v2.0.3

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# ── Detectar SO y rutas ──
UNAME_S="$(uname -s)"
case "$UNAME_S" in
    Darwin)
        APP_PLUGINS_DIR="$HOME/Library/Application Support/gulin/plugins"
        ;;
    Linux)
        APP_PLUGINS_DIR="$HOME/.config/gulin/plugins"
        ;;
    MINGW*|MSYS*|CYGWIN*)
        # Windows: usa %APPDATA% si existe, sino ~/AppData/Roaming
        if [ -n "${APPDATA:-}" ]; then
            APP_PLUGINS_DIR="${APPDATA}/gulin/plugins"
        else
            APP_PLUGINS_DIR="$HOME/AppData/Roaming/gulin/plugins"
        fi
        # Convertir barras invertidas a normales
        APP_PLUGINS_DIR="${APP_PLUGINS_DIR//\\//}"
        ;;
    *)
        echo "[!] SO no soportado: $UNAME_S"
        exit 1
        ;;
esac

DEV_PLUGINS_DIR="$HOME/.config/gulin-dev/plugins"

echo "══════════════════════════════════════════"
echo "  Sincronizando plugins de GuLiN..."
echo "  SO: $UNAME_S"
echo "══════════════════════════════════════════"

# Crear directorio destino si no existe
mkdir -p "$APP_PLUGINS_DIR"

# Contadores
copied=0
failed=0

for plugin in "$DEV_PLUGINS_DIR"/*.js; do
    [ -f "$plugin" ] || continue
    name=$(basename "$plugin")
    if cp "$plugin" "$APP_PLUGINS_DIR/$name" 2>/dev/null; then
        echo -e "  ${GREEN}[✓]${NC} $name"
        ((copied++))
    else
        echo -e "  ${RED}[✗]${NC} $name (error al copiar)"
        ((failed++))
    fi
done

echo ""
echo "══════════════════════════════════════════"
echo "  Resumen: $copied copiados, $failed errores"
echo "  Destino: $APP_PLUGINS_DIR"
echo "══════════════════════════════════════════"

exit $failed
