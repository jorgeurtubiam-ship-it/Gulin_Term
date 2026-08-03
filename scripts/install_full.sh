#!/usr/bin/env bash
# =============================================================================
# install_full.sh - COMPILA GuLiN desde el código fuente y lo deja INSTALADO
# =============================================================================
# A diferencia de install.sh (que descarga un DMG precompilado y depende de que
# ese DMG esté bien firmado), este script COMPILA TODO desde el repo y firma
# los binarios ad-hoc, de modo que macOS NO bloquee la app al abrirla.
#
# Flujo:
#   1. Instala dependencias (npm + Go) si faltan
#   2. Compila el frontend (electron-vite build)
#   3. Compila los binarios del backend Go (gulinsrv, wsh)
#   4. Firma ad-hoc cada binario (código: codesign -s -)
#   5. Empaqueta con electron-builder en modo --dir (.app)
#   6. Firma ad-hoc el .app completo
#   7. Copia el .app a /Applications (eliminando la versión anterior)
#   8. Configura los comandos CLI (gulinsrv/wsh) en el PATH
#
# Uso:
#   ./scripts/install_full.sh              # compila e instala localmente
#   ./scripts/install_full.sh --no-install # compila/empaqueta, no instala
#   ./scripts/install_full.sh --only-build # compila binarios, no frontend ni app
#   ./scripts/install_full.sh --quick      # usa builds existentes (más rápido)
# =============================================================================

set -euo pipefail

# ─── Colores ────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
    GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
else
    GREEN=''; YELLOW=''; CYAN=''; RED=''; BOLD=''; NC=''
fi

# ─── Flags ──────────────────────────────────────────────────────────────────
ONLY_BUILD=false
NO_INSTALL=false
QUICK=false

for arg in "$@"; do
    case "$arg" in
        --only-build)  ONLY_BUILD=true ;;
        --no-install)  NO_INSTALL=true ;;
        --quick)       QUICK=true ;;
        -h|--help)     echo "Uso: $0 [--quick] [--only-build] [--no-install]"; exit 0 ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" && pwd)"
# Instalador autocontenido: clona el repo si no estamos dentro de el.
if [ -f "$PWD/package.json" ] && [ -d "$PWD/cmd" ]; then
    ROOT="$PWD"
elif [ -d "$SCRIPT_DIR/.." ] && [ -f "$SCRIPT_DIR/../package.json" ] && [ -d "$SCRIPT_DIR/../cmd" ]; then
    cd "$SCRIPT_DIR/.."
    ROOT="$(pwd)"
else
    INSTALL_DIR="${GULIN_DIR:-$HOME/gulin-term}"
    if [ ! -d "$INSTALL_DIR/cmd" ]; then
        info "Clonando GuLiN desde GitHub en $INSTALL_DIR..."
        GIT_REPO="${GULIN_REPO:-https://github.com/jorgeurtubiam-ship-it/Gulin_Term.git}"
        git clone --depth 1 "$GIT_REPO" "$INSTALL_DIR" || { error "No se pudo clonar $GIT_REPO"; exit 1; }
    fi
    cd "$INSTALL_DIR"
    ROOT="$(pwd)"
fi
APP_NAME="GuLiN"
APP_VERSION="$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "0.0.0")"
HOST_ARCH="$(uname -m)"
START_TIME=$(date +%s)

log()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
info()  { echo -e "${CYAN}[i]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }
header(){ echo -e "\n${BOLD}${CYAN}════════════════════════════════════════════════════════${NC}"; echo -e "${BOLD}${CYAN}  $1${NC}"; echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════${NC}\n"; }

# ─── 1. Verificar herramientas ──────────────────────────────────────────────
header "🔍 Verificando herramientas de desarrollo"

FAULT=0
command -v npm  >/dev/null || { error "Falta npm"; FAULT=1; }
command -v npx  >/dev/null || { error "Falta npx"; FAULT=1; }
command -v go   >/dev/null || { error "Falta Go"; FAULT=1; }
command -v node >/dev/null || { error "Falta node"; FAULT=1; }
command -v codesign >/dev/null || { warn "codesign no disponible"; }

# Xcode CLI Tools (necesario para CGO/sqlite en macOS)
if [[ "$(uname)" == "Darwin" ]]; then
    if ! xcode-select -p >/dev/null 2>&1; then
        warn "Xcode CLI Tools no instalados. Ejecuta: xcode-select --install"
        FAULT=1
    fi
fi

if [ $FAULT -ne 0 ]; then
    error "Faltan herramientas. Instálalas y vuelve a ejecutar."
    error "  macOS: xcode-select --install   +   https://go.dev/dl   +   https://nodejs.org"
    exit 1
fi

log "npm $(npm -v) / node $(node -v) / go $(go version | awk '{print $3}')"
log "Arquitectura: $HOST_ARCH   |   App: ${APP_NAME} v${APP_VERSION}"

# ─── 2. Dependencias npm ────────────────────────────────────────────────────
header "📦 Instalando dependencias npm"
if [ -d node_modules ] && [ "$QUICK" = true ]; then
    info "node_modules existe + --quick: omitiendo npm install"
else
    npm install
    log "npm install completado"
fi

# ─── 3. Compilar binarios Go (backend) ──────────────────────────────────────
header "🔧 Compilando backend Go"

mkdir -p dist/bin

# Determinar arch corto (para nombres de archivo) y arch Go (para compilación)
case "$HOST_ARCH" in
    x86_64) ARCH_SHORT="x64"; GO_ARCH="amd64" ;;
    arm64)  ARCH_SHORT="arm64"; GO_ARCH="arm64" ;;
    *)      ARCH_SHORT="$HOST_ARCH"; GO_ARCH="$HOST_ARCH" ;;
esac

if [ "$QUICK" = false ] || [ ! -f "dist/bin/gulinsrv.${ARCH_SHORT}" ]; then
    info "Compilando gulinsrv (darwin/${ARCH_SHORT})..."
    CGO_CFLAGS="-I${ROOT}/include -fno-sanitize=undefined" \
    CGO_ENABLED=1 GOOS=darwin GOARCH="$GO_ARCH" \
        go build -tags "osusergo,sqlite_omit_load_extension" \
        -ldflags "-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M') -X main.GulinVersion=${APP_VERSION}" \
        -o "dist/bin/gulinsrv.${ARCH_SHORT}" cmd/server/main-server.go
    log "gulinsrv.${ARCH_SHORT} compilado"
else
    info "gulinsrv.${ARCH_SHORT} ya existe (--quick)"
fi

if [ "$QUICK" = false ] || [ ! -f "dist/bin/wsh.${ARCH_SHORT}" ]; then
    info "Compilando wsh (darwin/${ARCH_SHORT})..."
    CGO_ENABLED=0 GOOS=darwin GOARCH="$GO_ARCH" \
        go build -ldflags "-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M') -X main.GulinVersion=${APP_VERSION}" \
        -o "dist/bin/wsh.${ARCH_SHORT}" cmd/wsh/main-wsh.go
    log "wsh.${ARCH_SHORT} compilado"
else
    info "wsh.${ARCH_SHORT} ya existe (--quick)"
fi

# ─── 4. Firmar ad-hoc los binarios ──────────────────────────────────────────
# CLAVE: macOS bloquea binarios sin firma. Firmar ad-hoc evita el bloqueo.
header "✍️  Firmando binarios (ad-hoc)"
for bin in "dist/bin/gulinsrv.${ARCH_SHORT}" "dist/bin/wsh.${ARCH_SHORT}"; do
    if [ -f "$bin" ]; then
        codesign --force -s - "$bin" 2>/dev/null && \
            log "Firmado: $bin" || \
            warn "No se pudo firmar $bin"
    fi
done

if [ "$ONLY_BUILD" = true ]; then
    header "✅ Binarios compilados (--only-build)"
    ls -lh dist/bin/gulinsrv.${ARCH_SHORT} dist/bin/wsh.${ARCH_SHORT}
    exit 0
fi

# ─── 5. Compilar frontend ───────────────────────────────────────────────────
header "🖥️  Compilando frontend (electron-vite)"
if [ "$QUICK" = false ]; then
    npm run build:prod
    log "Frontend compilado"
else
    info "Omitiendo build del frontend (--quick, usando dist/ existente)"
fi

# ─── 6. Empaquetar .app con electron-builder (modo --dir) ───────────────────
# Usamos --dir para generar el .app sin DMG, que es lo que vamos a instalar.
header "📀 Empaquetando app con electron-builder (--dir)"
if [ "$QUICK" = false ] || [ ! -d "make/mac/GuLiN.app" ]; then
    info "Generando .app (esto puede tomar varios minutos)..."
    npx electron-builder build --mac --dir --config electron-builder.config.cjs --publish never
    log "App empaquetada"
else
    info "Usando .app existente en make/mac/ (--quick)"
fi

APP_PATH="$(find "make" -name "GuLiN.app" -type d 2>/dev/null | head -1)"
if [ -z "$APP_PATH" ]; then
    error "No se encontró GuLiN.app tras el empaquetado"
    exit 1
fi
log "App bundle: $APP_PATH"

# ─── 7. Firmar ad-hoc el .app completo ──────────────────────────────────────
header "✍️  Firmando app completa (ad-hoc)"
codesign --force --deep --sign - "$APP_PATH"
log ".app firmado (ad-hoc)"

# Re-firmar binarios dentro (si codesign --deep no los dejó)
for bin in "$APP_PATH/Contents/Resources/bin/"*; do
    if [ -f "$bin" ]; then
        codesign --force -s - "$bin" 2>/dev/null || true
    fi
done
codesign --force --sign - "$APP_PATH"

# Verificar
if codesign --verify --deep --strict "$APP_PATH" 2>/dev/null; then
    log "Verificación de firma: OK"
else
    warn "La firma no pasó verificación estricta (los binarios estarán firmados igualmente)"
fi

if [ "$NO_INSTALL" = true ]; then
    header "✅ Empaquetado completado (--no-install)"
    info "App lista en: $APP_PATH"
    info "Síguela hasta /Applications manualmente o ejecuta sin --no-install"
    exit 0
fi

# ─── 8. Instalar en /Applications ────────────────────────────────────────────
header "📦 Instalando en /Applications"
if [ -d "/Applications/${APP_NAME}.app" ]; then
    warn "Eliminando versión anterior de /Applications/${APP_NAME}.app..."
    rm -rf "/Applications/${APP_NAME}.app"
fi
cp -R "$APP_PATH" /Applications/
log "${APP_NAME}.app instalado en /Applications/"

# ─── 9. Configurar CLI (gulinsrv, wsh) en el PATH ───────────────────────────
header "🔧 Configurando comandos CLI"

# Determinar shell config
SHELL_RC="$HOME/.zshrc"
if [ -n "${BASH_VERSION:-}" ]; then SHELL_RC="$HOME/.bash_profile"; fi

BIN_PATH="$ROOT/dist/bin"
PATH_LINE="export PATH=\"\$PATH:$BIN_PATH\""
if grep -qF "$BIN_PATH" "$SHELL_RC" 2>/dev/null; then
    info "PATH ya configurado en $SHELL_RC"
else
    printf "\n# GuLiN CLI tools\n%s\n" "$PATH_LINE" >> "$SHELL_RC"
    log "PATH configurado en $SHELL_RC"
fi

# Symlinks en /usr/local/bin
if [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
    for cmd_name in gulinsrv wsh; do
        CMD_SRC="$BIN_PATH/${cmd_name}.${ARCH_SHORT}"
        if [ -f "$CMD_SRC" ]; then
            ln -sf "$CMD_SRC" "/usr/local/bin/$cmd_name"
            log "Enlace: /usr/local/bin/$cmd_name"
        fi
    done
else
    warn "No hay escritura en /usr/local/bin - usa los binarios en dist/bin/"
fi

# ─── 10. Resumen final ──────────────────────────────────────────────────────
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

header "Instalación completada 🎉"
echo -e "${GREEN}  GuLiN Agent v${APP_VERSION}${NC}"
echo ""
echo -e "  📍 App:       ${CYAN}/Applications/${APP_NAME}.app${NC}"
echo -e "  📍 Código:    ${CYAN}${ROOT}${NC}"
echo -e "  📍 Binarios:  ${CYAN}${ROOT}/dist/bin${NC}"
echo ""
echo -e "  ${YELLOW}Comandos disponibles:${NC}"
echo -e "    ${GREEN}open /Applications/${APP_NAME}.app${NC}   → Iniciar GuLiN"
echo -e "    ${GREEN}source $SHELL_RC${NC}      → recargar CLI (gulinsrv / wsh)"
echo ""
echo -e "  ${YELLOW}Para desinstalar:${NC} remove /Applications/${APP_NAME}.app"

[[ $DURATION -gt 60 ]] && info "Tiempo total: $((DURATION / 60))m $((DURATION % 60))s" || info "Tiempo total: ${DURATION}s"
info "¿Quieres iniciar GuLiN ahora? (s/N)"
read -r resp
if [[ "$resp" =~ ^[sS]$ ]]; then
    open "/Applications/${APP_NAME}.app"
    log "GuLiN iniciado"
fi
