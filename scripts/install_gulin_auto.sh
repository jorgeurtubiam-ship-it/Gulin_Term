#!/usr/bin/env bash
# =============================================================================
# install_gulin_auto.sh - Instalador automático de GuLiN Agent (sin prompts)
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GULIN_DIR="$SCRIPT_DIR"

log()     { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✗]${NC} $1"; }
info()    { echo -e "${CYAN}[i]${NC} $1"; }
section() { echo -e "\n${CYAN}══════════════════════════════════════════════${NC}"; echo -e "${CYAN}  $1${NC}"; echo -e "${CYAN}══════════════════════════════════════════════${NC}\n"; }

cd "$GULIN_DIR"

echo -e "${CYAN}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   GuLiN Agent - Instalación Automática   ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${NC}"

# ── 1. Dependencias ──
section "Verificando dependencias"

command -v go >/dev/null 2>&1 && log "Go $(go version | sed 's/.*go\([0-9]*\.[0-9]*\).*/\1/')" || { error "Go no instalado"; exit 1; }
command -v node >/dev/null 2>&1 && log "Node $(node -v)" || { error "Node no instalado"; exit 1; }
command -v npm >/dev/null 2>&1 && log "npm $(npm -v)" || { error "npm no instalado"; exit 1; }
command -v task >/dev/null 2>&1 && log "Task $(task --version 2>/dev/null)" || warn "Task no instalado"
command -v zig >/dev/null 2>&1 && log "Zig $(zig version 2>/dev/null)" || warn "Zig no instalado"
xcode-select -p &>/dev/null && log "Xcode CLI Tools OK" || { error "Xcode CLI no instalado"; exit 1; }

# ── 2. Archivos requeridos ──
section "Verificando estructura del proyecto"
for f in package.json go.mod Taskfile.yml electron-builder.config.cjs electron.vite.config.ts; do
    [ -f "$GULIN_DIR/$f" ] && log "$f" || { error "Falta $f"; exit 1; }
done

# ── 3. npm install ──
section "Instalando dependencias npm"
if [ -d "node_modules" ]; then
    info "node_modules existe, verificando actualización..."
    npm install --silent 2>&1 | tail -3
else
    npm install 2>&1 | tail -5
fi
log "npm install completado"

# ── 4. go mod download ──
section "Descargando dependencias Go"
go mod download 2>&1 | tail -3
log "go mod download completado"

# ── 5. Compilar backend ──
section "Compilando backend Go"
mkdir -p dist/bin

if command -v task &>/dev/null; then
    info "Usando task build:backend..."
    task build:backend 2>&1 | tail -10 || {
        warn "task build:backend falló, compilando directamente..."
        go build -o dist/bin/gulinsrv ./cmd/gulinsrv/ 2>&1
        go build -o dist/bin/wsh ./cmd/wsh/ 2>&1
    }
else
    go build -o dist/bin/gulinsrv ./cmd/gulinsrv/ 2>&1
    go build -o dist/bin/wsh ./cmd/wsh/ 2>&1
fi

if [ -f "dist/bin/gulinsrv" ] || ls dist/bin/gulinsrv* 1>/dev/null 2>&1; then
    log "Backend Go compilado correctamente"
else
    warn "Verifica la compilación del backend manualmente"
fi

# ── 6. Build frontend ──
section "Compilando frontend Electron (producción)"
npm run build:prod 2>&1 | tail -15
log "Frontend compilado en dist/"

# ── 7. Empaquetar .app ──
section "Empaquetando aplicación macOS"
mkdir -p "$GULIN_DIR/build_output"
npx electron-builder --mac --x64 --config electron-builder.config.cjs --publish never 2>&1 | tail -20
log "Empaquetado completado"

# ── 8. Instalar en /Applications ──
section "Instalando en /Applications"

# Buscar DMG
DMG=$(ls -t make/*.dmg 2>/dev/null | head -1)
if [ -n "$DMG" ] && [ -f "$DMG" ]; then
    info "DMG encontrado: $DMG"
    hdiutil detach "/Volumes/GuLiN" -quiet 2>/dev/null || true
    hdiutil attach "$DMG" -nobrowse -quiet
    if [ -d "/Volumes/GuLiN" ]; then
        rm -rf "/Applications/GuLiN.app" 2>/dev/null || true
        cp -R "/Volumes/GuLiN/GuLiN.app" /Applications/
        hdiutil detach "/Volumes/GuLiN" -quiet
        log "GuLiN.app instalado en /Applications/"
    fi
else
    # Buscar .app directo
    APP=$(find make -name "GuLiN.app" -type d 2>/dev/null | head -1)
    if [ -n "$APP" ]; then
        rm -rf "/Applications/GuLiN.app" 2>/dev/null || true
        cp -R "$APP" /Applications/
        log "GuLiN.app instalado en /Applications/"
    else
        warn "No se encontró .app generado. Revisa make/"
    fi
fi

# ── 9. Configurar PATH ──
section "Configurando CLI en PATH"
ZSHRC="$HOME/.zshrc"
if grep -qF "$GULIN_DIR/dist/bin" "$ZSHRC" 2>/dev/null; then
    info "PATH ya configurado en .zshrc"
else
    echo "" >> "$ZSHRC"
    echo "# GuLiN CLI tools" >> "$ZSHRC"
    echo "export PATH=\"\$PATH:$GULIN_DIR/dist/bin\"" >> "$ZSHRC"
    log "PATH agregado a ~/.zshrc (recarga con: source ~/.zshrc)"
fi

# Enlaces en /usr/local/bin
if [ -d "/usr/local/bin" ]; then
    for cmd_path in "$GULIN_DIR/dist/bin/gulinsrv"*; do
        [ -f "$cmd_path" ] && sudo ln -sf "$cmd_path" "/usr/local/bin/gulinsrv" 2>/dev/null && log "Enlace: /usr/local/bin/gulinsrv" && break
    done
    for cmd_path in "$GULIN_DIR/dist/bin/wsh"*; do
        [ -f "$cmd_path" ] && sudo ln -sf "$cmd_path" "/usr/local/bin/wsh" 2>/dev/null && log "Enlace: /usr/local/bin/wsh" && break
    done
fi

# ── 10. Sincronizar plugins ──
section "Sincronizando plugins"
SCRIPTS_DIR="$GULIN_DIR/scripts"
if [ -f "$SCRIPTS_DIR/sync-plugins.sh" ]; then
    bash "$SCRIPTS_DIR/sync-plugins.sh"
    log "Plugins sincronizados"
else
    warn "Script sync-plugins.sh no encontrado en $SCRIPTS_DIR"
fi

# ── 11. Resumen ──
section "🎉 Instalación completada"
echo -e "  ${GREEN}GuLiN Agent v2.0.3${NC}"
echo ""
echo -e "  📍 App:     ${CYAN}/Applications/GuLiN.app${NC}"
echo -e "  📍 Código:  ${CYAN}$GULIN_DIR${NC}"
echo -e "  📍 Builds:  ${CYAN}$GULIN_DIR/make/${NC}"
echo -e "  📍 CLI:     ${CYAN}$GULIN_DIR/dist/bin/${NC}"
echo ""
echo -e "  ${YELLOW}Para iniciar:${NC} open /Applications/GuLiN.app"
echo -e "  ${YELLOW}Para dev:${NC}     task electron:dev (o npm run dev)"
echo ""
