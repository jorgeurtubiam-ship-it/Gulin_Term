#!/usr/bin/env bash
# =============================================================================
# install_quick.sh - Instalación RÁPIDA de GuLiN (modo desarrollo)
# =============================================================================
# Este script compila el backend e inicia el servidor de desarrollo
# con hot-reload. Ideal para desarrollo diario.
# No empaqueta .app - ejecuta directamente con electron-vite.
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()     { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
info()    { echo -e "${CYAN}[i]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${CYAN}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║    GuLiN - Instalación Rápida (Dev)      ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${NC}"

# Verificar dependencias
info "Verificando dependencias..."
command -v go >/dev/null 2>&1 || { warn "Go no encontrado"; exit 1; }
command -v node >/dev/null 2>&1 || { warn "Node no encontrado"; exit 1; }
command -v npm >/dev/null 2>&1 || { warn "npm no encontrado"; exit 1; }
log "Dependencias básicas OK"

# npm install si es necesario
if [ ! -d "node_modules" ]; then
    info "Instalando dependencias npm..."
    npm install
    log "npm install completado"
else
    log "node_modules existe, omitiendo npm install"
fi

# go mod download si es necesario
if [ ! -f "go.sum" ]; then
    info "Descargando dependencias Go..."
    go mod download
    log "go mod download completado"
else
    log "go.sum existe, Go deps OK"
fi

# Compilar backend rápido (sin task, compilación directa)
info "Compilando backend (gulinsrv)..."
mkdir -p dist/bin

cd "$SCRIPT_DIR/cmd/gulinsrv"
go build -o "$SCRIPT_DIR/dist/bin/gulinsrv" . 2>&1 && log "gulinsrv compilado" || warn "gulinsrv falló"

cd "$SCRIPT_DIR/cmd/wsh"
go build -o "$SCRIPT_DIR/dist/bin/wsh" . 2>&1 && log "wsh compilado" || warn "wsh falló"

cd "$SCRIPT_DIR"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✅  Listo para desarrollo                       ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Ejecuta:                                        ║${NC}"
echo -e "${GREEN}║    npm run dev          (con hot-reload)         ║${NC}"
echo -e "${GREEN}║    task electron:dev    (vía task runner)        ║${NC}"
echo -e "${GREEN}║    task electron:quickdev (más rápido)          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# Preguntar si iniciar dev server
info "¿Iniciar servidor de desarrollo ahora? (s/N)"
read -r response
if [[ "$response" =~ ^[sS]$ ]]; then
    if command -v task &>/dev/null; then
        info "Iniciando task electron:quickdev..."
        task electron:quickdev
    else
        info "Iniciando npm run dev..."
        npm run dev
    fi
fi
