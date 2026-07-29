#!/usr/bin/env bash
# =============================================================================
# install_gulin.sh - Instalador COMPLETO de GuLiN Agent
# =============================================================================
# Este script compila backend Go + frontend Electron, empaqueta un instalable
# (.dmg en macOS, .AppImage/.deb en Linux, .exe en Windows) y lo instala.
#
# Uso:
#   ./install_gulin.sh                    # Instalación completa (macOS)
#   ./install_gulin.sh --windows          # Genera instalador para Windows (desde macOS)
#   ./install_gulin.sh --linux            # Genera instalador para Linux (desde macOS)
#   ./install_gulin.sh --quick            # Solo empaqueta (asume build existente)
#   ./install_gulin.sh --no-backend       # Solo frontend + empaquetado
#   ./install_gulin.sh --only-build       # Solo compila, no empaqueta ni instala
#   ./install_gulin.sh --no-install       # Empaqueta pero no instala en el sistema
#   ./install_gulin.sh --dev              # Modo desarrollo (compila backend + dev server)
#   ./install_gulin.sh --help             # Muestra ayuda
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
NO_INSTALL=false
DEV_MODE=false
TARGET_PLATFORM=""  # "" = nativa, "windows", "linux"

# ─── Variables ───────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

APP_NAME="GuLiN"
APP_VERSION="$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "2.0.3")"
START_TIME=$(date +%s)
HOST_OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
HOST_ARCH="$(uname -m)"

# ─── Funciones ──────────────────────────────────────────────────────────────
log()     { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
info()    { echo -e "${CYAN}[i]${NC} $1"; }
error()   { echo -e "${RED}[✗]${NC} $1"; }
header()  { echo -e "\n${BOLD}${CYAN}$1${NC}"; }
section() { echo -e "\n${CYAN}══════════════════════════════════════════════${NC}"; echo -e "${CYAN}  $1${NC}"; echo -e "${CYAN}══════════════════════════════════════════════${NC}\n"; }

usage() {
    echo "Uso: $0 [opciones]"
    echo ""
    echo "Opciones de plataforma (por defecto: nativa):"
    echo "  --windows, --win  Genera instalador para Windows (cross-compile desde macOS)"
    echo "  --linux           Genera instalador para Linux (cross-compile desde macOS)"
    echo ""
    echo "Opciones generales:"
    echo "  --quick          Empaqueta usando builds existentes (más rápido)"
    echo "  --no-backend     Omite compilación del backend Go"
    echo "  --only-build     Solo compila, no empaqueta ni instala"
    echo "  --no-install     Empaqueta pero no instala en el sistema"
    echo "  --dev            Modo desarrollo (compila backend + inicia dev server)"
    echo "  --help           Muestra esta ayuda"
    exit 0
}

cleanup() {
    local exit_code=$?
    if [ $exit_code -ne 0 ]; then
        echo ""
        error "El instalador falló (código: $exit_code)"
        info "Revisa los mensajes de error arriba para más detalles."
        info "Puedes intentar: $0 --quick   (si ya tienes builds previas)"
    fi
    exit $exit_code
}

trap cleanup EXIT

# ─── Parsear argumentos ─────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --quick)      QUICK=true; shift ;;
        --no-backend) NO_BACKEND=true; shift ;;
        --only-build) ONLY_BUILD=true; shift ;;
        --no-install) NO_INSTALL=true; shift ;;
        --dev)        DEV_MODE=true; shift ;;
        --windows|--win) TARGET_PLATFORM="windows"; shift ;;
        --linux)      TARGET_PLATFORM="linux"; shift ;;
        --help)       usage ;;
        *)            error "Argumento desconocido: $1"; usage ;;
    esac
done

# ─── Banner ─────────────────────────────────────────────────────────────────
echo -e "${CYAN}"
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║         GuLiN - Instalador Profesional       ║"
echo "  ║         v$APP_VERSION                        ║"
echo "  ╚══════════════════════════════════════════════╝"
echo -e "${NC}"

# ─── 1. Verificar dependencias ──────────────────────────────────────────────
header "🔍 Verificando dependencias..."

DEPS_OK=true
WARN_GO=false

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

# Verificar Task (opcional)
if command -v task &>/dev/null; then
    log "Task: $(task --version 2>/dev/null || echo 'disponible')"
else
    warn "Task no encontrado (opcional). Se usará compilación directa."
fi

# Verificar Xcode CLI Tools (macOS)
if [[ "$(uname)" == "Darwin" ]]; then
    if xcode-select -p &>/dev/null; then
        log "Xcode Command Line Tools instalados"
    else
        warn "Xcode CLI Tools no instalados. Ejecuta: xcode-select --install"
        warn "  La compilación podría fallar sin esto."
    fi
fi

$DEPS_OK || exit 1

# ─── 2. Verificar estructura del proyecto ────────────────────────────────────
header "📁 Verificando estructura del proyecto"

PROJECT_OK=true
for file in "package.json" "go.mod" "electron-builder.config.cjs" "electron.vite.config.ts"; do
    if [ ! -f "$SCRIPT_DIR/$file" ]; then
        error "Falta archivo requerido: $file"
        PROJECT_OK=false
    fi
done

if [ ! -d "$SCRIPT_DIR/cmd/server" ]; then
    warn "Directorio cmd/server no encontrado. Verifica la estructura."
fi

if [ ! -d "$SCRIPT_DIR/cmd/wsh" ]; then
    warn "Directorio cmd/wsh no encontrado."
fi

$PROJECT_OK || { error "Estructura del proyecto inválida. Ejecuta este script desde el directorio raíz de GuLiN."; exit 1; }
log "Estructura del proyecto verificada correctamente"

# ─── 3. npm install ─────────────────────────────────────────────────────────
header "📦 Instalando dependencias npm..."

if [ ! -d "node_modules" ] || [ "$QUICK" = false ]; then
    info "Ejecutando npm install..."
    npm install 2>&1 | tail -5
    log "npm install completado"
else
    log "node_modules existe, omitiendo (usa --quick)"
fi

# ─── 4. Instalar sharp si no existe ──────────────────────────────────────────
if ! node -e "require('sharp')" 2>/dev/null; then
    info "Instalando sharp (necesario para optimización de imágenes)..."
    npm install sharp 2>&1 | tail -3
    log "sharp instalado"
fi

# ─── 5. Compilar backend Go ─────────────────────────────────────────────────
if [ "$NO_BACKEND" = false ] && [ "$WARN_GO" = false ]; then
    header "🔧 Compilando backend Go..."

    mkdir -p dist/bin

    # ── Determinar plataforma destino ──────────────────────────────────────
    if [ -n "$TARGET_PLATFORM" ]; then
        # Cross-compilation: desde macOS a Windows o Linux
        GOOS="$TARGET_PLATFORM"
        case "$GOOS" in
            windows) GOARCH="amd64"; ARCH_SHORT="x64"; BIN_EXT=".exe" ;;
            linux)   GOARCH="amd64"; ARCH_SHORT="x64"; BIN_EXT="" ;;
        esac
        info "Cross-compilación: $HOST_OS → $GOOS/$GOARCH"

        # Verificar Zig (necesario para CGO cross-compile)
        if command -v zig &>/dev/null; then
            ZIG_VER=$(zig version 2>/dev/null || echo "desconocida")
            log "Zig $ZIG_VER encontrado (para CGO cross-compile)"
        else
            warn "Zig no encontrado. Es necesario para cross-compile CGO."
            warn "  Instálalo con: brew install zig"
            warn "  O puedes continuar sin backend con --no-backend"
            warn "  Intentando compilación sin CGO..."
        fi
    else
        # Compilación nativa
        case "$HOST_ARCH" in
            x86_64)  GOARCH="amd64"; ARCH_SHORT="x64" ;;
            arm64)   GOARCH="arm64"; ARCH_SHORT="arm64" ;;
            aarch64) GOARCH="arm64"; ARCH_SHORT="arm64" ;;
            *)       GOARCH="$HOST_ARCH"; ARCH_SHORT="$HOST_ARCH" ;;
        esac
        case "$HOST_OS" in
            darwin)  GOOS="darwin" ;;
            linux)   GOOS="linux" ;;
            mingw*)  GOOS="windows" ;;
            *)       GOOS="$HOST_OS" ;;
        esac
        BIN_EXT=""
        info "Compilación nativa para: $GOOS/$GOARCH"
    fi

    # ── Compilar gulinsrv (servidor principal) ─────────────────────────────
    if [ -f "$SCRIPT_DIR/cmd/server/main-server.go" ]; then
        info "Compilando gulinsrv..."
        cd "$SCRIPT_DIR/cmd/server"

        # Configurar CGO para cross-compile
        if [ -n "$TARGET_PLATFORM" ]; then
            if [ "$TARGET_PLATFORM" = "windows" ]; then
                if command -v zig &>/dev/null; then
                    export CC="zig cc -target x86_64-windows-gnu"
                fi
            elif [ "$TARGET_PLATFORM" = "linux" ]; then
                if command -v zig &>/dev/null; then
                    export CC="zig cc -target x86_64-linux-gnu.2.28"
                fi
            fi
        fi

        CGO_ENABLED=1 GOOS=$GOOS GOARCH=$GOARCH \
            go build -tags "osusergo,sqlite_omit_load_extension" \
            -ldflags="-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M') -X main.GulinVersion=$APP_VERSION" \
            -o "$SCRIPT_DIR/dist/bin/gulinsrv.$ARCH_SHORT$BIN_EXT" . 2>&1 && \
            log "gulinsrv compilado (dist/bin/gulinsrv.$ARCH_SHORT$BIN_EXT)" || \
            warn "gulinsrv falló (puedes continuar sin backend)"
    else
        warn "main-server.go no encontrado en cmd/server/. Buscando en cmd/gulinsrv/..."
        if [ -d "$SCRIPT_DIR/cmd/gulinsrv" ]; then
            cd "$SCRIPT_DIR/cmd/gulinsrv"
            go build -ldflags="-s -w" -o "$SCRIPT_DIR/dist/bin/gulinsrv$BIN_EXT" . 2>&1 && \
                log "gulinsrv compilado" || warn "gulinsrv falló"
        fi
    fi

    # ── Compilar wsh (shell helper) ────────────────────────────────────────
    if [ -f "$SCRIPT_DIR/cmd/wsh/main-wsh.go" ]; then
        info "Compilando wsh..."
        cd "$SCRIPT_DIR/cmd/wsh"
        CGO_ENABLED=0 GOOS=$GOOS GOARCH=$GOARCH \
            go build -ldflags="-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M') -X main.GulinVersion=$APP_VERSION" \
            -o "$SCRIPT_DIR/dist/bin/wsh-$APP_VERSION-$GOOS.$ARCH_SHORT$BIN_EXT" . 2>&1 && \
            log "wsh compilado (dist/bin/wsh-$APP_VERSION-$GOOS.$ARCH_SHORT$BIN_EXT)" || \
            warn "wsh falló"
    fi

    cd "$SCRIPT_DIR"
elif [ "$NO_BACKEND" = true ]; then
    info "Backend omitido (--no-backend)"
else
    warn "Go no disponible, backend no compilado"
fi

# ─── 6. Build frontend + main + preload (Electron + Vite) ───────────────────
header "🏗️  Compilando frontend Electron..."

if [ "$QUICK" = false ]; then
    info "Ejecutando: npm run build:prod"
    NODE_OPTIONS="--max-old-space-size=8192" npm run build:prod 2>&1 | tee /tmp/gulin-build.log | tail -20 || {
        error "Build falló. Log completo: /tmp/gulin-build.log"
        tail -50 /tmp/gulin-build.log
        exit 1
    }
    log "Build completada"
else
    if [ -d "dist/main" ] && [ -d "dist/frontend" ]; then
        log "Build existente en dist/, omitiendo (--quick)"
    else
        info "Build no encontrada en dist/, compilando..."
        NODE_OPTIONS="--max-old-space-size=8192" npm run build:prod 2>&1 | tee /tmp/gulin-build.log | tail -20 || {
            error "Build falló. Log completo: /tmp/gulin-build.log"
            tail -50 /tmp/gulin-build.log
            exit 1
        }
        log "Build completada"
    fi
fi

# ─── 7. Verificar binarios ──────────────────────────────────────────────────
header "🔍 Verificando artefactos de build"

if [ -d "dist/main" ]; then
    log "✓ dist/main/ encontrado"
else
    warn "✗ dist/main/ no encontrado"
fi

if [ -d "dist/frontend" ]; then
    log "✓ dist/frontend/ encontrado"
else
    warn "✗ dist/frontend/ no encontrado"
fi

BACKEND_FOUND=false
for f in dist/bin/gulinsrv*; do
    if [ -f "$f" ]; then
        log "✓ $(basename "$f") encontrado ($(du -h "$f" | cut -f1))"
        BACKEND_FOUND=true
    fi
done

if [ "$BACKEND_FOUND" = false ]; then
    warn "No se encontraron binarios gulinsrv en dist/bin/. El paquete final podría no funcionar correctamente."
fi

# ─── 8. Si es solo build, salir ─────────────────────────────────────────────
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

# ─── 9. Modo desarrollo ─────────────────────────────────────────────────────
if [ "$DEV_MODE" = true ]; then
    header "🚀 Modo desarrollo"

    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  ✅  Backend compilado                          ║${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║  Iniciando servidor de desarrollo...            ║${NC}"
    echo -e "${GREEN}║                                                  ║${NC}"
    echo -e "${GREEN}║  npm run dev (hot-reload activado)              ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
    echo ""

    npm run dev
    exit 0
fi

# ─── 10. Empaquetar con electron-builder ────────────────────────────────────
header "📀 Empaquetando instalador con electron-builder..."

# Determinar plataforma para empaquetado
if [ -n "$TARGET_PLATFORM" ]; then
    # Cross-compilation package target
    case "$TARGET_PLATFORM" in
        windows) PACKAGE_TARGET="--win"; PACKAGE_LABEL="Windows" ;;
        linux)   PACKAGE_TARGET="--linux"; PACKAGE_LABEL="Linux" ;;
    esac
    ARCH_SHORT="x64"
    info "Empaquetando para: $PACKAGE_LABEL (cross-compile desde $HOST_OS)"
else
    # Native package target
    case "$HOST_ARCH" in
        x86_64)  ARCH_SHORT="x64" ;;
        arm64)   ARCH_SHORT="arm64" ;;
        *)       ARCH_SHORT="$HOST_ARCH" ;;
    esac
    case "$HOST_OS" in
        darwin)  PACKAGE_TARGET="--mac"; PACKAGE_LABEL="macOS" ;;
        linux)   PACKAGE_TARGET="--linux"; PACKAGE_LABEL="Linux" ;;
        mingw*)  PACKAGE_TARGET="--win"; PACKAGE_LABEL="Windows" ;;
        *)       error "Plataforma no soportada: $HOST_OS"; exit 1 ;;
    esac
    info "Empaquetando para: $PACKAGE_LABEL ($ARCH_SHORT)"
fi

info "Target electron-builder: $PACKAGE_TARGET"
info "Esto puede tomar varios minutos..."

npx electron-builder build $PACKAGE_TARGET --config electron-builder.config.cjs --publish never 2>&1

BUILD_EXIT=$?

if [ $BUILD_EXIT -eq 0 ]; then
    header "✅ Instalador generado con éxito"

    # Mostrar artefactos generados
    echo ""
    echo -e "${GREEN}Artefactos generados en make/:${NC}"
    ls -lh "$SCRIPT_DIR/make/" 2>/dev/null | grep -v "^total" | grep -v "^d" | head -10

    # Encontrar el instalador más reciente según plataforma destino
    case "$PACKAGE_LABEL" in
        macOS)
            LATEST_DMG=$(ls -t "$SCRIPT_DIR/make/"*".dmg" 2>/dev/null | head -1)
            if [ -n "$LATEST_DMG" ]; then
                DMG_SIZE=$(du -h "$LATEST_DMG" | cut -f1)
                log "DMG: $(basename "$LATEST_DMG") (${DMG_SIZE})"
            fi
            ;;
        Linux)
            LATEST_APPIMAGE=$(ls -t "$SCRIPT_DIR/make/"*".AppImage" 2>/dev/null | head -1)
            if [ -n "$LATEST_APPIMAGE" ]; then
                APPIMAGE_SIZE=$(du -h "$LATEST_APPIMAGE" | cut -f1)
                log "AppImage: $(basename "$LATEST_APPIMAGE") (${APPIMAGE_SIZE})"
            fi
            LATEST_DEB=$(ls -t "$SCRIPT_DIR/make/"*".deb" 2>/dev/null | head -1)
            if [ -n "$LATEST_DEB" ]; then
                DEB_SIZE=$(du -h "$LATEST_DEB" | cut -f1)
                log "DEB: $(basename "$LATEST_DEB") (${DEB_SIZE})"
            fi
            ;;
        Windows)
            LATEST_EXE=$(ls -t "$SCRIPT_DIR/make/"*".exe" 2>/dev/null | head -1)
            if [ -n "$LATEST_EXE" ]; then
                EXE_SIZE=$(du -h "$LATEST_EXE" | cut -f1)
                log "Instalador NSIS: $(basename "$LATEST_EXE") (${EXE_SIZE})"
            fi
            LATEST_ZIP=$(ls -t "$SCRIPT_DIR/make/"*".zip" 2>/dev/null | head -1)
            if [ -n "$LATEST_ZIP" ]; then
                ZIP_SIZE=$(du -h "$LATEST_ZIP" | cut -f1)
                log "ZIP: $(basename "$LATEST_ZIP") (${ZIP_SIZE})"
            fi
            ;;
    esac
else
    error "electron-builder falló con código $BUILD_EXIT"
    info "Revisa los logs arriba para más detalles."
    info "Intenta: $0 --quick   (si ya tienes builds previas)"
    exit $BUILD_EXIT
fi

# ─── 11. Instalar en el sistema (solo para plataforma nativa) ───────────────
if [ -n "$TARGET_PLATFORM" ]; then
    # Cross-compilation: no instalar en el sistema local
    header "✅ Cross-compilación completada"
    info "Los instaladores para $PACKAGE_LABEL están en: $SCRIPT_DIR/make/"
    info "Copia estos archivos a una máquina $PACKAGE_LABEL para instalar."
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))
    [[ $DURATION -gt 60 ]] && info "Tiempo total: $((DURATION / 60))m $((DURATION % 60))s" || info "Tiempo total: ${DURATION}s"
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}  GuLiN v$APP_VERSION - Instalador para $PACKAGE_LABEL generado${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 0
fi

if [ "$NO_INSTALL" = true ]; then
    header "✅ Empaquetado completado (--no-install)"
    info "Los instaladores están en: $SCRIPT_DIR/make/"
    info "Puedes instalarlos manualmente."
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))
    [[ $DURATION -gt 60 ]] && info "Tiempo total: $((DURATION / 60))m $((DURATION % 60))s" || info "Tiempo total: ${DURATION}s"
    exit 0
fi

header "📦 Instalando GuLiN en el sistema"

case "$HOST_OS" in
    darwin)
        # Buscar el DMG generado
        DMG_PATH=$(ls -t "$SCRIPT_DIR/make/"*".dmg" 2>/dev/null | head -1)

        if [ -n "$DMG_PATH" ] && [ -f "$DMG_PATH" ]; then
            info "DMG encontrado: $(basename "$DMG_PATH")"

            # Montar DMG
            MOUNT_POINT="/Volumes/$APP_NAME"
            if [ -d "$MOUNT_POINT" ]; then
                hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
            fi

            info "Montando DMG..."
            hdiutil attach "$DMG_PATH" -nobrowse -quiet

            if [ -d "$MOUNT_POINT" ]; then
                # Si ya existe, eliminar versión anterior
                if [ -d "/Applications/$APP_NAME.app" ]; then
                    warn "Eliminando versión anterior de /Applications..."
                    rm -rf "/Applications/$APP_NAME.app"
                fi

                info "Copiando a /Applications..."
                cp -R "$MOUNT_POINT/$APP_NAME.app" /Applications/

                # Desmontar
                hdiutil detach "$MOUNT_POINT" -quiet
                log "$APP_NAME.app instalado en /Applications/"
            else
                error "No se pudo montar el DMG"
                warn "Puedes instalar manualmente desde: $DMG_PATH"
            fi
        else
            # Buscar .app directamente en make/
            APP_PATH=$(find "$SCRIPT_DIR/make" -name "$APP_NAME.app" -type d 2>/dev/null | head -1)

            if [ -n "$APP_PATH" ]; then
                info "App bundle encontrado en: $APP_PATH"

                if [ -d "/Applications/$APP_NAME.app" ]; then
                    warn "Eliminando versión anterior..."
                    rm -rf "/Applications/$APP_NAME.app"
                fi

                cp -R "$APP_PATH" /Applications/
                log "$APP_NAME.app instalado en /Applications/"
            else
                warn "No se encontró el instalador generado."
                warn "Puedes encontrarlo manualmente en: $SCRIPT_DIR/make/"
            fi
        fi
        ;;

    linux)
        # Buscar AppImage o .deb
        APPIMAGE_PATH=$(ls -t "$SCRIPT_DIR/make/"*".AppImage" 2>/dev/null | head -1)
        DEB_PATH=$(ls -t "$SCRIPT_DIR/make/"*".deb" 2>/dev/null | head -1)

        if [ -n "$DEB_PATH" ]; then
            info "Instalando .deb..."
            sudo dpkg -i "$DEB_PATH" && log "GuLiN instalado via .deb" || warn "Falló instalación .deb"
        elif [ -n "$APPIMAGE_PATH" ]; then
            info "AppImage encontrado: $(basename "$APPIMAGE_PATH")"
            chmod +x "$APPIMAGE_PATH"
            mkdir -p "$HOME/Applications"
            cp "$APPIMAGE_PATH" "$HOME/Applications/"
            log "AppImage copiado a $HOME/Applications/"
            warn "Para usar el AppImage, ejecuta: $HOME/Applications/$(basename "$APPIMAGE_PATH")"
        else
            warn "No se encontró instalador para Linux en make/"
        fi
        ;;

    mingw*)
        EXE_PATH=$(ls -t "$SCRIPT_DIR/make/"*".exe" 2>/dev/null | head -1)
        if [ -n "$EXE_PATH" ]; then
            info "Instalador NSIS encontrado: $(basename "$EXE_PATH")"
            warn "Ejecuta el instalador manualmente: start $EXE_PATH"
        else
            warn "No se encontró instalador para Windows en make/"
        fi
        ;;
esac

# ─── 12. Configurar CLI tools en PATH ───────────────────────────────────────
header "🔧 Configurando comandos CLI"

# Determinar shell config file
SHELL_RC=""
if [[ "$SHELL" == */zsh ]]; then
    SHELL_RC="$HOME/.zshrc"
elif [[ "$SHELL" == */bash ]]; then
    if [[ "$(uname)" == "Darwin" ]]; then
        SHELL_RC="$HOME/.bash_profile"
    else
        SHELL_RC="$HOME/.bashrc"
    fi
else
    SHELL_RC="$HOME/.zshrc"
fi

# Agregar dist/bin al PATH
BIN_PATH="$SCRIPT_DIR/dist/bin"
PATH_LINE='export PATH="$PATH:'"$BIN_PATH"'"'

if grep -qF "$BIN_PATH" "$SHELL_RC" 2>/dev/null; then
    info "PATH ya configurado en $SHELL_RC"
else
    echo "" >> "$SHELL_RC"
    echo "# GuLiN CLI tools" >> "$SHELL_RC"
    echo "$PATH_LINE" >> "$SHELL_RC"
    log "PATH configurado en $SHELL_RC"
fi

# Crear enlaces simbólicos en /usr/local/bin (si es posible)
if [ -d "/usr/local/bin" ] && [ -w "/usr/local/bin" ] || command -v sudo &>/dev/null; then
    for cmd_name in gulinsrv wsh; do
        CMD_SRC=$(find "$BIN_PATH" -name "${cmd_name}*" -type f 2>/dev/null | head -1)
        if [ -n "$CMD_SRC" ] && [ -f "$CMD_SRC" ]; then
            TARGET="/usr/local/bin/$cmd_name"
            if [ -L "$TARGET" ] || [ -f "$TARGET" ]; then
                sudo rm -f "$TARGET" 2>/dev/null || rm -f "$TARGET"
            fi
            sudo ln -sf "$CMD_SRC" "/usr/local/bin/$cmd_name" 2>/dev/null && \
                log "Enlace creado: /usr/local/bin/$cmd_name" || \
                warn "No se pudo crear enlace para $cmd_name"
        fi
    done
fi

# ─── 13. Acceso directo (solo macOS) ────────────────────────────────────────
if [[ "$PLATFORM" == "darwin" ]] && [ -d "/Applications/$APP_NAME.app" ]; then
    header "🎯 Creando acceso directo"

    info "Abriendo GuLiN por primera vez para registrar en Launchpad..."
    open "/Applications/$APP_NAME.app" &
    sleep 1

    warn "¿Deseas fijar GuLiN al Dock? (s/N)"
    read -r response
    if [[ "$response" =~ ^[sS]$ ]]; then
        defaults write com.apple.dock persistent-apps -array-add \
            "<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>/Applications/$APP_NAME.app</string><key>_CFURLStringType</key><integer>0</integer></dict></dict></dict>"
        killall Dock 2>/dev/null || true
        log "GuLiN fijado al Dock"
    fi
fi

# ─── 14. Resumen final ──────────────────────────────────────────────────────
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

section "Instalación completada 🎉"

echo -e "${GREEN}  GuLiN Agent v$APP_VERSION${NC}"
echo ""
echo -e "  📍 App:     ${CYAN}/Applications/$APP_NAME.app${NC}"
echo -e "  📍 Código:  ${CYAN}$SCRIPT_DIR${NC}"
echo -e "  📍 Builds:  ${CYAN}$SCRIPT_DIR/make/${NC}"
echo -e "  📍 Binarios:${CYAN}$SCRIPT_DIR/dist/bin/${NC}"
echo ""
echo -e "  ${YELLOW}Comandos disponibles:${NC}"
echo -e "    ${GREEN}open /Applications/$APP_NAME.app${NC}       → Iniciar GuLiN"
echo -e "    ${GREEN}task electron:dev${NC}                  → Modo desarrollo con hot-reload"
echo -e "    ${GREEN}task electron:quickdev${NC}             → Modo desarrollo rápido"
echo -e "    ${GREEN}wsh${NC} / ${GREEN}gulinsrv${NC}           → CLI tools (recarga terminal)"
echo ""
echo -e "  ${YELLOW}Para desinstalar:${NC}"
echo -e "    ${GREEN}./uninstall_gulin.sh${NC}"
echo ""

if [ $DURATION -gt 60 ]; then
    MINS=$((DURATION / 60))
    SECS=$((DURATION % 60))
    info "Tiempo total: ${MINS}m ${SECS}s"
else
    info "Tiempo total: ${DURATION}s"
fi

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  GuLiN v$APP_VERSION - AI-Native Terminal     ${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Preguntar si iniciar
echo ""
warn "¿Quieres iniciar GuLiN ahora? (s/N)"
read -r response
if [[ "$response" =~ ^[sS]$ ]]; then
    if [[ "$PLATFORM" == "darwin" ]]; then
        open "/Applications/$APP_NAME.app"
    elif [[ "$PLATFORM" == "linux" ]]; then
        "$HOME/Applications/"*".AppImage" 2>/dev/null &
    fi
    log "GuLiN iniciado"
fi

info "Recarga tu terminal con: source $SHELL_RC"
info "¡Disfruta GuLiN!"
