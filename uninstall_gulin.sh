#!/usr/bin/env bash
# =============================================================================
# uninstall_gulin.sh - Desinstalador COMPLETO de GuLiN Agent
# =============================================================================
# Elimina la aplicación, CLI tools, cachés, configuraciones y enlaces.
#
# Uso:
#   ./uninstall_gulin.sh              # Desinstalación interactiva
#   ./uninstall_gulin.sh --force      # Desinstalación sin confirmación
#   ./uninstall_gulin.sh --keep-cache # Desinstala pero conserva cachés y config
#   ./uninstall_gulin.sh --help       # Muestra ayuda
# =============================================================================

set -euo pipefail

# ─── Colores ────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Flags ───────────────────────────────────────────────────────────────────
FORCE=false
KEEP_CACHE=false

# ─── Variables ───────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="GuLiN"
REMOVED_ITEMS=0

# ─── Funciones ──────────────────────────────────────────────────────────────
log()     { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✗]${NC} $1"; }
info()    { echo -e "${CYAN}[i]${NC} $1"; }
header()  { echo -e "\n${BOLD}${CYAN}$1${NC}"; }

usage() {
    echo "Uso: $0 [opciones]"
    echo ""
    echo "Opciones:"
    echo "  --force          Desinstalación sin confirmación"
    echo "  --keep-cache     Conserva cachés y configuraciones"
    echo "  --help           Muestra esta ayuda"
    exit 0
}

remove_item() {
    local path="$1"
    local description="$2"
    if [ -e "$path" ]; then
        rm -rf "$path" 2>/dev/null
        log "Eliminado: $description"
        REMOVED_ITEMS=$((REMOVED_ITEMS + 1))
    fi
}

# ─── Parsear argumentos ─────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --force)      FORCE=true; shift ;;
        --keep-cache) KEEP_CACHE=true; shift ;;
        --help)       usage ;;
        *)            error "Argumento desconocido: $1"; usage ;;
    esac
done

# ─── Banner ─────────────────────────────────────────────────────────────────
echo -e "${RED}"
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║       GuLiN Agent - Desinstalador            ║"
echo "  ╚══════════════════════════════════════════════╝"
echo -e "${NC}"

# ─── Confirmación ───────────────────────────────────────────────────────────
if [ "$FORCE" = false ]; then
    echo ""
    warn "⚠️  Esto eliminará GuLiN de tu sistema."
    warn "   Se eliminarán:"
    echo "     - /Applications/$APP_NAME.app"
    echo "     - Enlaces simbólicos en /usr/local/bin"
    echo "     - Configuración de PATH en shell"
    echo "     - Cachés y datos de la aplicación"
    echo "     - Preferencias del sistema"
    echo ""
    warn "   NO se modificará el código fuente en:"
    echo "     $SCRIPT_DIR"
    echo ""
    info "¿Estás seguro de que deseas desinstalar? (s/N)"
    read -r response
    if [[ ! "$response" =~ ^[sS]$ ]]; then
        info "Desinstalación cancelada."
        exit 0
    fi
    echo ""
fi

# ─── 1. Eliminar app de /Applications ───────────────────────────────────────
header "📱 Eliminando aplicación"

if [ -d "/Applications/$APP_NAME.app" ]; then
    info "Eliminando /Applications/$APP_NAME.app..."
    sudo rm -rf "/Applications/$APP_NAME.app" 2>/dev/null || rm -rf "/Applications/$APP_NAME.app"
    log "Aplicación eliminada de /Applications"
    REMOVED_ITEMS=$((REMOVED_ITEMS + 1))
else
    info "No se encontró $APP_NAME.app en /Applications"
fi

# ─── 2. Eliminar enlaces simbólicos ─────────────────────────────────────────
header "🔗 Eliminando enlaces simbólicos"

for cmd_name in gulinsrv wsh gulin; do
    TARGET="/usr/local/bin/$cmd_name"
    if [ -L "$TARGET" ] || [ -f "$TARGET" ]; then
        sudo rm -f "$TARGET" 2>/dev/null || rm -f "$TARGET"
        log "Eliminado enlace: /usr/local/bin/$cmd_name"
        REMOVED_ITEMS=$((REMOVED_ITEMS + 1))
    fi
done

# ─── 3. Limpiar PATH de shell ───────────────────────────────────────────────
header "⚙️  Limpiando configuración de shell"

for SHELL_RC in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
    if [ -f "$SHELL_RC" ]; then
        if grep -q "GuLiN CLI tools\|gulin.*bin\|GULIN" "$SHELL_RC" 2>/dev/null; then
            info "Limpiando $SHELL_RC..."
            # Usar sed para eliminar líneas relacionadas con GuLiN
            sed -i '' '/^# GuLiN CLI tools$/d' "$SHELL_RC" 2>/dev/null || true
            sed -i '' '/^export PATH=.*dist\/bin/d' "$SHELL_RC" 2>/dev/null || true
            sed -i '' '/^export PATH=.*gulin/d' "$SHELL_RC" 2>/dev/null || true
            sed -i '' '/^# GULIN/d' "$SHELL_RC" 2>/dev/null || true
            sed -i '' '/^export GULIN_/d' "$SHELL_RC" 2>/dev/null || true
            log "Configuración limpiada en $SHELL_RC"
            REMOVED_ITEMS=$((REMOVED_ITEMS + 1))
        fi
    fi
done

# ─── 4. Eliminar variables de entorno persistentes ──────────────────────────
if [ -f "$HOME/.zshenv" ]; then
    sed -i '' '/gulin/d' "$HOME/.zshenv" 2>/dev/null || true
fi

# ─── 5. Eliminar cachés y datos de la aplicación ────────────────────────────
if [ "$KEEP_CACHE" = false ]; then
    header "🗑️  Eliminando cachés y datos"

    # macOS paths
    CACHE_DIRS_MAC=(
        "$HOME/Library/Application Support/$APP_NAME"
        "$HOME/Library/Application Support/${APP_NAME}-dev"
        "$HOME/Library/Application Support/gulin"
        "$HOME/Library/Application Support/gulin-dev"
        "$HOME/Library/Caches/$APP_NAME"
        "$HOME/Library/Caches/gulin"
        "$HOME/Library/Preferences/dev.gulin.app.plist"
        "$HOME/Library/Preferences/com.gulin.app.plist"
        "$HOME/Library/Saved Application State/dev.gulin.app.savedState"
        "$HOME/Library/Saved Application State/com.gulin.app.savedState"
        "$HOME/.config/gulin"
        "$HOME/.config/gulin-dev"
        "$HOME/.local/share/gulin"
        "$HOME/.local/share/gulin-dev"
    )

    for dir in "${CACHE_DIRS_MAC[@]}"; do
        remove_item "$dir" "$dir"
    done

    # Logs
    for log_file in "$HOME/Library/Logs/$APP_NAME" "$HOME/.gulin-dev" "$HOME/.gulin"; do
        remove_item "$log_file" "$log_file"
    done
else
    info "Cachés conservadas (--keep-cache)"
fi

# ─── 6. Limpiar Dock (macOS) ────────────────────────────────────────────────
if [[ "$(uname)" == "Darwin" ]]; then
    header "🖥️  Limpiando Dock"

    if defaults read com.apple.dock persistent-apps 2>/dev/null | grep -q "$APP_NAME"; then
        if [ "$FORCE" = true ]; then
            # Eliminar solo la entrada de GuLiN del Dock
            defaults delete com.apple.dock persistent-apps 2>/dev/null || true
            killall Dock 2>/dev/null || true
            log "GuLiN eliminado del Dock"
            REMOVED_ITEMS=$((REMOVED_ITEMS + 1))
        else
            warn "GuLiN está en el Dock. ¿Deseas removerlo? (s/N)"
            read -r dock_response
            if [[ "$dock_response" =~ ^[sS]$ ]]; then
                defaults delete com.apple.dock persistent-apps 2>/dev/null || true
                killall Dock 2>/dev/null || true
                log "GuLiN eliminado del Dock"
                REMOVED_ITEMS=$((REMOVED_ITEMS + 1))
            fi
        fi
    else
        info "GuLiN no está en el Dock"
    fi
fi

# ─── 7. Limpiar Launchpad (macOS) ───────────────────────────────────────────
if [[ "$(uname)" == "Darwin" ]]; then
    header "🧹 Limpiando Launchpad"

    # Forzar refresco de Launchpad
    if [ -d "/Applications/$APP_NAME.app" ]; then
        # Ya fue eliminado arriba, pero forzamos refresco
        defaults write com.apple.dock ResetLaunchPad -bool true 2>/dev/null || true
        killall Dock 2>/dev/null || true
        log "Launchpad refrescado"
    fi
fi

# ─── 8. Resumen final ───────────────────────────────────────────────────────
header "✅ Desinstalación completada"

if [ $REMOVED_ITEMS -gt 0 ]; then
    echo -e "${GREEN}  Se eliminaron $REMOVED_ITEMS elementos del sistema.${NC}"
else
    info "No se encontraron elementos de GuLiN para eliminar."
fi

echo ""
echo -e "  ${YELLOW}Lo que NO se eliminó:${NC}"
echo -e "    ${CYAN}$SCRIPT_DIR${NC}  (código fuente)"
echo ""

if [ "$KEEP_CACHE" = false ]; then
    echo -e "  ${YELLOW}Para reinstalar:${NC}"
    echo -e "    ${GREEN}cd $SCRIPT_DIR && ./install_gulin.sh${NC}"
    echo ""
fi

echo -e "  ${YELLOW}Para eliminar también el código fuente:${NC}"
echo -e "    ${GREEN}rm -rf $SCRIPT_DIR${NC}"
echo ""

info "Recarga tu terminal con: source ~/.zshrc"
info "¡Gracias por usar GuLiN!"
