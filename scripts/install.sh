#!/usr/bin/env bash
# =============================================================================
# install.sh - Instalador CLI de GuLiN (gulinsrv + wsh) para macOS
# =============================================================================
# Estrategia: build-from-source desde el repo público.
#   - El cliente baja el código fuente (sin auth, repo público)
#   - Compila localmente (binario nativo para SU Mac: arm64 o x86_64)
#   - No requiere Releases publicados, ni tokens, ni cross-compile
#
# Uso (lo que ejecuta tu cliente):
#   curl -fsSL https://raw.githubusercontent.com/jorgeurtubiam-ship-it/Gulin_Term/main/scripts/install.sh | bash
#
# Variables opcionales:
#   GULIN_REF=main                    # Rama/ref a bajar (default: main)
#   GULIN_INSTALL_DIR=...             # Directorio de instalación (default: ~/.gulin/bin)
#   GULIN_NO_PATH=1                   # No modifica el PATH automáticamente
#   GULIN_GH_USER=...                 # Owner del repo (default: jorgeurtubiam-ship-it)
#   GULIN_GH_REPO=...                 # Nombre del repo (default: Gulin_Term)
# =============================================================================

set -euo pipefail

# ─── Configuración ───────────────────────────────────────────────────────────
GITHUB_USER="${GULIN_GH_USER:-jorgeurtubiam-ship-it}"
GITHUB_REPO="${GULIN_GH_REPO:-Gulin_Term}"
REF="${GULIN_REF:-main}"
APP_NAME="GuLiN"
DEFAULT_INSTALL_DIR="${HOME}/.gulin/bin"
INSTALL_DIR="${GULIN_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
MIN_GO_VERSION="1.21"

# ─── Colores ────────────────────────────────────────────────────────────────
# Detecta si AMBOS stdout y stderr son TTY para activar color.
# Cuando se ejecuta via 'curl ... | bash', stdout = pipe => sin color,
# evitando que salgan secuencias '\033' literales en el log del cliente.
if [ -t 1 ] && [ -t 2 ] && [ "${NO_COLOR:-0}" != "1" ]; then
    GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
    RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
    # printf '%b' interpreta los escapes \033 cuando vienen de variables
    log()  { printf '%b[ok]%b %s\n' "$GREEN" "$NC" "$*"; }
    warn() { printf '%b[!]%b %s\n'  "$YELLOW" "$NC" "$*"; }
    info() { printf '%b[i]%b %s\n'  "$CYAN" "$NC" "$*"; }
    err()  { printf '%b[x]%b %s\n'  "$RED" "$NC" "$*" >&2; }
else
    GREEN=''; YELLOW=''; CYAN=''; RED=''; BOLD=''; NC=''
    log()  { printf '%s\n' "[ok] $*"; }
    warn() { printf '%s\n' "[!]  $*"; }
    info() { printf '%s\n' "[i]  $*"; }
    err()  { printf '%s\n' "[x]  $*" >&2; }
fi
hr()   { printf -- "--------------------------------------------\n"; }

# ─── Banner ─────────────────────────────────────────────────────────────────
cat <<'EOF'

   ==============================================
       GuLiN CLI - Instalador 1-linea (curl)
       Estrategia: build-from-source
   ==============================================

EOF

# ─── 1. Verificar macOS ────────────────────────────────────────────────────
if [ "$(uname -s)" != "Darwin" ]; then
    err "Este instalador es solo para macOS."
    err "Para Linux/Windows: clona el repo y compila manualmente."
    exit 1
fi
log "macOS detectado"

# ─── 2. Detectar arquitectura ───────────────────────────────────────────────
detect_arch() {
    local hw
    hw="$(uname -m)"
    case "$hw" in
        x86_64)            echo "amd64" ;;
        arm64|aarch64)     echo "arm64" ;;
        *)
            err "Arquitectura no soportada: $hw"
            err "GuLiN soporta x86_64 (Intel) y arm64 (Apple Silicon)."
            exit 1
            ;;
    esac
}
ARCH="$(detect_arch)"
log "Arquitectura: ${ARCH}"

# ─── 3. Verificar prerrequisitos (fail-fast con instrucciones claras) ────────
hr
info "Verificando prerrequisitos..."

OS="$(uname -s)"
MISSING=0
NEED_HOMEBREW=0

# 3a. Xcode Command Line Tools (necesario para CGO + sqlite3.h)
if ! command -v clang >/dev/null 2>&1 || ! [ -f "$(xcrun --sdk macosx --show-sdk-path 2>/dev/null)/usr/include/sqlite3.h" ]; then
    err "Falta: Xcode Command Line Tools"
    err "  Instalar con:"
    err "      xcode-select --install"
    err "  (Apple abrira una ventana emergente. Pulsa 'Instalar' y acepta licencia.)"
    if [ "$OS" = "Darwin" ]; then
        err "  Necesario para compilar la dependencia CGO sqlite3."
    fi
    MISSING=1
    NEED_HOMEBREW=1
fi

# 3b. Go
if ! command -v go >/dev/null 2>&1; then
    err "Falta: Go"
    err "  Instalar con:"
    err "      brew install go"
    err "  (Si no tienes Homebrew, primero: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\")"
    err "  Version requerida: >= $MIN_GO_VERSION"
    MISSING=1
    NEED_HOMEBREW=1
else
    GO_VERSION_RAW="$(go version | awk '{print $3}')"
    GO_VERSION_NUM="${GO_VERSION_RAW#go}"
    GO_MAJOR="$(echo "$GO_VERSION_NUM" | cut -d. -f1)"
    GO_MINOR="$(echo "$GO_VERSION_NUM" | cut -d. -f2)"
    NEED_MAJOR="$(echo "$MIN_GO_VERSION" | cut -d. -f1)"
    NEED_MINOR="$(echo "$MIN_GO_VERSION" | cut -d. -f2)"
    if [ "$GO_MAJOR" -lt "$NEED_MAJOR" ] || { [ "$GO_MAJOR" -eq "$NEED_MAJOR" ] && [ "$GO_MINOR" -lt "$NEED_MINOR" ]; }; then
        err "Go $GO_VERSION_RAW detectado, se requiere >= $MIN_GO_VERSION"
        err "  Actualizar con:"
        err "      brew upgrade go"
        MISSING=1
    else
        log "Go $GO_VERSION_RAW (cumple >= $MIN_GO_VERSION)"
    fi
fi

# 3c. Node (necesario para `npm install` de gulinsrv/web extension)
if ! command -v node >/dev/null 2>&1; then
    err "Falta: Node.js"
    err "  Instalar con:"
    err "      brew install node@18"
    err "  (o con nvm: https://github.com/nvm-sh/nvm)"
    err "  Version requerida: >= 18"
    MISSING=1
    NEED_HOMEBREW=1
else
    NODE_VERSION_RAW="$(node --version)"
    NODE_MAJOR="$(echo "$NODE_VERSION_RAW" | sed 's/^v//' | cut -d. -f1)"
    if [ "$NODE_MAJOR" -lt 18 ]; then
        err "Node $NODE_VERSION_RAW detectado, se requiere >= 18"
        err "  Actualizar con:"
        err "      brew upgrade node@18"
        MISSING=1
    else
        log "Node $NODE_VERSION_RAW (cumple >= 18)"
    fi
fi

# Si faltan cosas, abortar con instrucciones claras
if [ "$MISSING" = "1" ]; then
    echo
    err "═══════════════════════════════════════════════════════════════"
    err "  Faltan prerrequisitos. Instala lo de arriba y vuelve a correr:"
    err "      curl -fsSL https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/main/scripts/install.sh | bash"
    err "═══════════════════════════════════════════════════════════════"
    if [ "$NEED_HOMEBREW" = "1" ] && ! command -v brew >/dev/null 2>&1; then
        echo
        err "  RECORDATORIO: Si no tienes Homebrew, primero:"
        err "      /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        err "  Si brew install <pkg> dice 'already installed', ignoralo: significa que ya estaba."
    fi
    exit 1
fi

log "Todos los prerrequisitos OK"

# ─── 4. Preparar directorio temporal ────────────────────────────────────────
TMP_DIR="$(mktemp -d -t gulin-install.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT
SRC_DIR="${TMP_DIR}/src"
mkdir -p "$SRC_DIR"

# ─── 5. Descargar código fuente ─────────────────────────────────────────────
hr
SOURCE_URL="https://github.com/${GITHUB_USER}/${GITHUB_REPO}/archive/refs/heads/${REF}.tar.gz"
info "Descargando codigo fuente (rama: ${REF})..."
info "  desde: ${SOURCE_URL}"

if ! curl -fSL --connect-timeout 15 --max-time 300 \
        -o "${TMP_DIR}/src.tar.gz" "$SOURCE_URL"; then
    err "No pude descargar el codigo fuente."
    err "Verifica tu conexion o que el repo sea publico."
    exit 1
fi

SRC_SIZE="$(du -h "${TMP_DIR}/src.tar.gz" | cut -f1 | tr -d ' ')"
log "Descarga completa: ${SRC_SIZE}"

# ─── 6. Extraer código fuente ───────────────────────────────────────────────
info "Extrayendo codigo fuente..."
tar -xzf "${TMP_DIR}/src.tar.gz" -C "$SRC_DIR" --strip-components=1

if [ ! -d "${SRC_DIR}/cmd" ]; then
    err "El codigo fuente extraido no parece ser valido (no hay carpeta cmd/)."
    err "Contenido:"
    ls -la "$SRC_DIR" | sed 's/^/    /'
    exit 1
fi
log "Codigo fuente extraido"

# Detectar versión desde package.json si existe
if [ -f "${SRC_DIR}/package.json" ]; then
    PKG_VERSION="$(python3 -c "import json,sys; print(json.load(open('${SRC_DIR}/package.json')).get('version','unknown'))" 2>/dev/null || echo unknown)"
    log "Version (package.json): ${PKG_VERSION}"
fi

# ─── 7. Compilar ────────────────────────────────────────────────────────────
hr
info "Compilando binarios nativos para ${ARCH}..."
echo

cd "$SRC_DIR"

# Compilar gulinsrv
info "  -> go build gulinsrv (puede tardar 1-3 min la primera vez)"
SRV_OUT="${TMP_DIR}/gulinsrv"
if ! CGO_CFLAGS="-I${SRC_DIR}/include -fno-sanitize=undefined" \
     CGO_ENABLED=1 GOOS=darwin GOARCH="$ARCH" \
     go build \
        -tags "osusergo,sqlite_omit_load_extension" \
        -ldflags="-s -w" \
        -o "$SRV_OUT" \
        ./cmd/server/main-server.go; then
    err "Fallo la compilacion de gulinsrv."
    err "Revisa que tu Mac tenga Xcode CLI Tools actualizados."
    exit 1
fi
chmod +x "$SRV_OUT"
log "gulinsrv compilado"

# Compilar wsh
info "  -> go build wsh"
WSH_OUT="${TMP_DIR}/wsh"
if ! CGO_CFLAGS="-I${SRC_DIR}/include -fno-sanitize=undefined" \
     CGO_ENABLED=1 GOOS=darwin GOARCH="$ARCH" \
     go build \
        -tags "osusergo,sqlite_omit_load_extension" \
        -ldflags="-s -w" \
        -o "$WSH_OUT" \
        ./cmd/wsh/main-wsh.go; then
    err "Fallo la compilacion de wsh."
    exit 1
fi
chmod +x "$WSH_OUT"
log "wsh compilado"

# Verificar binarios
if [ ! -x "$SRV_OUT" ] || [ ! -s "$SRV_OUT" ]; then
    err "gulinsrv no se genero correctamente."
    exit 1
fi
if [ ! -x "$WSH_OUT" ] || [ ! -s "$WSH_OUT" ]; then
    err "wsh no se genero correctamente."
    exit 1
fi

# ─── 8. Instalar ─────────────────────────────────────────────────────────────
hr
info "Instalando en ${INSTALL_DIR}..."
mkdir -p "$INSTALL_DIR"

cp "$SRV_OUT" "${INSTALL_DIR}/gulinsrv"
chmod +x "${INSTALL_DIR}/gulinsrv"
log "gulinsrv -> ${INSTALL_DIR}/gulinsrv"

cp "$WSH_OUT" "${INSTALL_DIR}/wsh"
chmod +x "${INSTALL_DIR}/wsh"
log "wsh     -> ${INSTALL_DIR}/wsh"

# ─── 9. Configurar PATH ─────────────────────────────────────────────────────
if [ "${GULIN_NO_PATH:-0}" = "1" ]; then
    warn "GULIN_NO_PATH=1: saltando configuracion de PATH"
else
    setup_path() {
        local rc_file=""
        case "${SHELL:-/bin/zsh}" in
            */zsh)  rc_file="${HOME}/.zshrc" ;;
            */bash)
                if [ -f "${HOME}/.bashrc" ]; then
                    rc_file="${HOME}/.bashrc"
                else
                    rc_file="${HOME}/.bash_profile"
                fi
                ;;
        esac

        if [ -z "$rc_file" ]; then
            warn "No detecte shell conocido (zsh/bash). Configura el PATH manualmente:"
            echo "    export PATH=\"${INSTALL_DIR}:\$PATH\""
            return
        fi

        if [ ! -w "$rc_file" ] && [ ! -w "$(dirname "$rc_file")" ]; then
            warn "No puedo escribir en ${rc_file}. Agrega manualmente:"
            echo "    export PATH=\"${INSTALL_DIR}:\$PATH\""
            return
        fi

        if grep -Fq "$INSTALL_DIR" "$rc_file" 2>/dev/null; then
            info "PATH ya configurado en ${rc_file}"
            return
        fi

        {
            echo ""
            echo "# GuLiN CLI"
            echo "export PATH=\"${INSTALL_DIR}:\$PATH\""
        } >> "$rc_file"
        log "PATH agregado a ${rc_file}"
    }
    setup_path
fi

# ─── 10. Verificar ──────────────────────────────────────────────────────────
hr
log "Verificando instalacion..."

if [ -x "${INSTALL_DIR}/gulinsrv" ]; then
    if "${INSTALL_DIR}/gulinsrv" --version >/dev/null 2>&1; then
        VERSION_OUT="$("${INSTALL_DIR}/gulinsrv" --version 2>/dev/null | head -1)"
        log "gulinsrv OK (${VERSION_OUT:-version OK})"
    else
        warn "gulinsrv instalado (puede no soportar --version)"
    fi
else
    err "gulinsrv no es ejecutable"
    exit 1
fi

if [ -x "${INSTALL_DIR}/wsh" ]; then
    log "wsh OK"
else
    err "wsh no es ejecutable"
    exit 1
fi

# ─── Resultado final ────────────────────────────────────────────────────────
hr
cat <<EOF

${GREEN}${BOLD}Instalacion completada!${NC}

  Binarios en:    ${INSTALL_DIR}
  Arquitectura:   ${ARCH}
  Fuente:         ${GITHUB_USER}/${GITHUB_REPO}@${REF}

Para empezar a usar GuLiN CLI ahora mismo:
    export PATH="\${INSTALL_DIR}:\$PATH"
    gulinsrv --help
    wsh --help

O reinicia tu terminal y los binarios estaran disponibles.

Para desinstalar:
    rm -rf ${INSTALL_DIR}
    # y elimina la linea de PATH en tu rc file

EOF

exit 0