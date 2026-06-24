#!/usr/bin/env bash
# =============================================================================
# install.sh - Instalador COMPLETO de GuLiN
# =============================================================================
# Este script compila backend Go + frontend Electron y empaqueta un instalable
# (.dmg en macOS, .AppImage/.deb en Linux, .exe en Windows)
#
# Uso:
#   ./install.sh                    # Instalación completa (build from scratch)
#   ./install.sh --quick            # Solo empaqueta (asume build existente)
#   ./install.sh --no-backend       # Solo frontend + empaquetado
#   ./install.sh --only-build       # Solo compila, no empaqueta
#   ./install.sh --help             # Muestra ayuda
# =============================================================================

set -euo pipefail

# ─── Colores ────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Flags ───────────────────────────────────────────────────────────────────
QUICK=false
NO_BACKEND=false
ONLY_BUILD=false

# ─── Funciones ──────────────────────────────────────────────────────────────
log()     { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
info()    { echo -e "${CYAN}[i]${NC} $1"; }
error()   { echo -e "${RED}[✗]${NC} $1"; }
header()  { echo -e "\n${BOLD}${CYAN}$1${NC}"; }

usage() {
    echo "Uso: $0 [opciones]"
    echo ""
    echo "Opciones:"
    echo "  --quick          Empaqueta usando builds existentes (más rápido)"
    echo "  --no-backend     Omite compilación del backend Go"
    echo "  --only-build     Solo compila, no empaqueta"
    echo "  --help           Muestra esta ayuda"
    exit 0
}

# ─── Parsear argumentos ─────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --quick)      QUICK=true; shift ;;
        --no-backend) NO_BACKEND=true; shift ;;
        --only-build) ONLY_BUILD=true; shift ;;
        --help)       usage ;;
        *)            error "Argumento desconocido: $1"; usage ;;
    esac
done

# ─── Banner ─────────────────────────────────────────────────────────────────
echo -e "${CYAN}"
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║         GuLiN - Instalador Profesional       ║"
echo "  ║         $(node -e "console.log(require('./package.json').version)")                        ║"
echo "  ╚══════════════════════════════════════════════╝"
echo -e "${NC}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

START_TIME=$(date +%s)

# ─── 1. Verificar dependencias ──────────────────────────────────────────────
header "🔍 Verificando dependencias..."

DEPS_OK=true

if ! command -v node &>/dev/null; then
    error "Node.js no encontrado. Instálalo desde https://nodejs.org"
    DEPS_OK=false
else
    log "Node.js: $(node -v)"
fi

if ! command -v npm &>/dev/null; then
    error "npm no encontrado."
    DEPS_OK=false
else
    log "npm: $(npm -v)"
fi

if ! command -v go &>/dev/null; then
    warn "Go no encontrado. El backend no se compilará."
    WARN_GO=true
else
    log "Go: $(go version | head -c 30)"
    WARN_GO=false
fi

if ! command -v npx &>/dev/null; then
    error "npx no encontrado."
    DEPS_OK=false
fi

$DEPS_OK || exit 1

# ─── 2. npm install ─────────────────────────────────────────────────────────
header "📦 Instalando dependencias npm..."

if [ ! -d "node_modules" ] || [ "$QUICK" = false ]; then
    info "Ejecutando npm install..."
    npm install
    log "npm install completado"
else
    log "node_modules existe, omitiendo (usa --quick)"
fi

# ─── 3. Instalar sharp si no existe (necesario para vite-plugin-image-optimizer) ──
if ! node -e "require('sharp')" 2>/dev/null; then
    info "Instalando sharp..."
    npm install sharp
    log "sharp instalado"
fi

# ─── 4. Compilar backend Go ─────────────────────────────────────────────────
if [ "$NO_BACKEND" = false ] && [ "$WARN_GO" = false ]; then
    header "🔧 Compilando backend Go..."

    mkdir -p dist/bin

    info "Compilando gulinsrv..."
    cd "$SCRIPT_DIR/cmd/gulinsrv"
    go build -ldflags="-s -w" -o "$SCRIPT_DIR/dist/bin/gulinsrv" . 2>&1 && log "gulinsrv compilado" || warn "gulinsrv falló"

    info "Compilando wsh..."
    cd "$SCRIPT_DIR/cmd/wsh"
    go build -ldflags="-s -w" -o "$SCRIPT_DIR/dist/bin/wsh" . 2>&1 && log "wsh compilado" || warn "wsh falló"

    cd "$SCRIPT_DIR"
elif [ "$NO_BACKEND" = true ]; then
    info "Backend omitido (--no-backend)"
else
    warn "Go no disponible, backend no compilado"
fi

# ─── 5. Build frontend + main + preload (Electron + Vite) ───────────────────
header "🏗️  Compilando frontend Electron..."

if [ "$QUICK" = false ]; then
    info "Ejecutando: npm run build:prod"
    npm run build:prod
    log "Build completada"
else
    if [ -d "dist/main" ] && [ -d "dist/frontend" ]; then
        log "Build existente en dist/, omitiendo (--quick)"
    else
        info "Build no encontrada en dist/, compilando..."
        npm run build:prod
        log "Build completada"
    fi
fi

# ─── 6. Verificar que exista binario gulinsrv ────────────────────────────────
if [ ! -f "dist/bin/gulinsrv" ] && [ ! -f "dist/bin/gulinsrv.x64" ] && [ ! -f "dist/bin/gulinsrv.aarch64" ]; then
    warn "No se encontró binario gulinsrv en dist/bin/. El paquete final podría no funcionar correctamente."
fi

# ─── 7. Si es solo build, salir ─────────────────────────────────────────────
if [ "$ONLY_BUILD" = true ]; then
    header "✅ Build completado (--only-build)"
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))
    info "Tiempo total: ${DURATION}s"
    info "Los archivos están en:"
    echo "  - dist/main/        (proceso principal Electron)"
    echo "  - dist/frontend/    (frontend React+Vite)"
    echo "  - dist/bin/         (binarios Go)"
    exit 0
fi

# ─── 8. Empaquetar con electron-builder ─────────────────────────────────────
header "📀 Empaquetando instalador con electron-builder..."

# Determinar arquitectura
ARCH=$(uname -m)
case "$ARCH" in
    x86_64)  ARCH_SHORT="x64" ;;
    arm64)   ARCH_SHORT="arm64" ;;
    *)       ARCH_SHORT="$ARCH" ;;
esac

info "Arquitectura detectada: $ARCH ($ARCH_SHORT)"
info "Objetivos: DMG (macOS)"

npx electron-builder build --mac --config electron-builder.config.cjs 2>&1

BUILD_EXIT=$?

if [ $BUILD_EXIT -eq 0 ]; then
    header "✅ Instalador generado con éxito"
    
    # Encontrar el .dmg más reciente
    LATEST_DMG=$(ls -t make/GuLiN-darwin-*.dmg 2>/dev/null | head -1)
    
    if [ -n "$LATEST_DMG" ]; then
        DMG_SIZE=$(du -h "$LATEST_DMG" | cut -f1)
        log "Archivo: $(basename "$LATEST_DMG") (${DMG_SIZE})"
    fi
    
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  🚀  GuLiN instalado correctamente                  ║${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║  Para instalar:                                     ║${NC}"
    echo -e "${GREEN}║    open make/GuLiN-darwin-${ARCH_SHORT}-*.dmg         ║${NC}"
    echo -e "${GREEN}║                                                      ║${NC}"
    echo -e "${GREEN}║  Para desarrollo (hot-reload):                       ║${NC}"
    echo -e "${GREEN}║    npm run dev                                       ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
else
    error "electron-builder falló con código $BUILD_EXIT"
    info "Revisa los logs arriba para más detalles."
    info "Intenta: ./install.sh --quick   (si ya tienes builds previas)"
    exit $BUILD_EXIT
fi

# ─── Tiempo total ───────────────────────────────────────────────────────────
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

if [ $DURATION -gt 60 ]; then
    MINS=$((DURATION / 60))
    SECS=$((DURATION % 60))
    info "Tiempo total: ${MINS}m ${SECS}s"
else
    info "Tiempo total: ${DURATION}s"
fi

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  GuLiN v$(node -e "console.log(require('./package.json').version)") - AI-Native Terminal     ${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
