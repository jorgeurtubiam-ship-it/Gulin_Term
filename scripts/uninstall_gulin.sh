#!/usr/bin/env bash
# =============================================================================
# uninstall_gulin.sh - Desinstalador de GuLiN Agent
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }
info()  { echo -e "${CYAN}[i]${NC} $1"; }

GULIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${RED}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║       GuLiN Agent - Desinstalador        ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${NC}"

info "Esto eliminará GuLiN de tu sistema."
info "¿Estás seguro? (s/N)"
read -r response
if [[ ! "$response" =~ ^[sS]$ ]]; then
    info "Desinstalación cancelada."
    exit 0
fi

# 1. Eliminar app de /Applications
if [ -d "/Applications/GuLiN.app" ]; then
    info "Eliminando /Applications/GuLiN.app..."
    sudo rm -rf "/Applications/GuLiN.app"
    log "GuLiN.app eliminado"
else
    info "GuLiN.app no encontrado en /Applications"
fi

# 2. Eliminar enlaces simbólicos en /usr/local/bin
for cmd in gulinsrv wsh; do
    if [ -L "/usr/local/bin/$cmd" ] || [ -f "/usr/local/bin/$cmd" ]; then
        sudo rm -f "/usr/local/bin/$cmd"
        log "Eliminado: /usr/local/bin/$cmd"
    fi
done

# 3. Limpiar PATH de ~/.zshrc
ZSHRC="$HOME/.zshrc"
if grep -q "GuLiN CLI tools" "$ZSHRC" 2>/dev/null; then
    info "Limpiando configuración de PATH en ~/.zshrc..."
    sed -i '' '/^# GuLiN CLI tools$/d' "$ZSHRC"
    sed -i '' '\|dist/bin|d' "$ZSHRC"
    log "Configuración de PATH eliminada de ~/.zshrc"
fi

# 4. Limpiar Dock (opcional)
if defaults read com.apple.dock persistent-apps 2>/dev/null | grep -q "GuLiN"; then
    warn "GuLiN está en el Dock. ¿Deseas removerlo? (s/N)"
    read -r dock_response
    if [[ "$dock_response" =~ ^[sS]$ ]]; then
        defaults delete com.apple.dock persistent-apps 2>/dev/null || true
        killall Dock
        log "Dock limpiado"
    fi
fi

# 5. Limpiar cachés de GuLiN
CACHE_DIRS=(
    "$HOME/Library/Application Support/gulin"
    "$HOME/Library/Caches/gulin"
    "$HOME/Library/Preferences/dev.gulin.app.plist"
    "$HOME/Library/Saved Application State/dev.gulin.app.savedState"
)

for dir in "${CACHE_DIRS[@]}"; do
    if [ -e "$dir" ]; then
        info "Eliminando: $dir"
        rm -rf "$dir"
        log "Eliminado: $dir"
    fi
done

echo ""
log "GuLiN ha sido desinstalado de tu sistema."
info "El código fuente en $GULIN_DIR no se ha modificado."
info "Si deseas eliminar también el código fuente: rm -rf $GULIN_DIR"
echo ""
info "Recarga tu terminal con: source ~/.zshrc"
