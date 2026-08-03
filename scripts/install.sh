#!/usr/bin/env bash
# =============================================================================
# install.sh - Instalador de GuLiN para macOS (estrategia DMG, sin compilar)
# =============================================================================
# Descarga el DMG oficial ya empaquetado (con la app + los binarios CLI
# multiarquitectura dentro), lo monta y copia GuLiN.app. NO compila nada,
# por lo que funciona en procesadores M (arm64) e Intel (x64) sin Xcode/Go.
#
# Uso (una sola url):
#   curl -fsSL https://raw.githubusercontent.com/jorgeurtubiam-ship-it/Gulin_Term/main/scripts/install.sh | bash
#
# Variables opcionales:
#   GULIN_VERSION=2.0.4      Version a instalar (default: 2.0.4)
#   GULIN_DMG_BASE=URL       Base URL del directorio con los dmg (default: S3 releases)
#   GULIN_GH_USER=...        Owner del repo GitHub (default: jorgeurtubiam-ship-it)
#   GULIN_GH_REPO=...        Repo GitHub (default: Gulin_Term)
#   GULIN_NO_PATH=1          No modifica el PATH / no crea symlinks en /usr/local/bin
#   GULIN_APP_DIR=/Applications   Carpeta destino de la app (default: /Applications)
# =============================================================================

set -euo pipefail

# ─── Configuración ───────────────────────────────────────────────────────────
GITHUB_USER="${GULIN_GH_USER:-jorgeurtubiam-ship-it}"
GITHUB_REPO="${GULIN_GH_REPO:-Gulin_Term}"
VERSION="${GULIN_VERSION:-2.0.4}"
APP_NAME="GuLiN"
APP_BUNDLE="${APP_NAME}.app"
APP_DIR="${GULIN_APP_DIR:-/Applications}"

# Directores del CLI (symlinks)
CLI_LINK_DIR="/usr/local/bin"
FALLBACK_CLI_DIR="${HOME}/.gulin/bin"

# URL base para los DMG. Por defecto el S3 de releases que ya usa electron-builder.
# Si GULIN_DMG_BASE se deja vacio, se intentan dos origenes en orden:
#   1) S3 releases:  https://www.ecogulin.cl/downloads/
#   2) GitHub releases: https://github.com/USER/REPO/releases/download/vVER/
DMG_BASE="${GULIN_DMG_BASE:-}"

# ─── Colores (sin TTY => sin color) ──────────────────────────────────────────
if [ -t 1 ] && [ -t 2 ] && [ "${NO_COLOR:-0}" != "1" ]; then
    GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
    RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
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
hr()  { printf -- "--------------------------------------------\n"; }

# ─── Banner ─────────────────────────────────────────────────────────────────
cat <<'EOF'

   ==============================================
       GuLiN - Instalador 1-linea para macOS
       Estrategia: DMG precompilado (sin compilar)
   ==============================================

EOF

# ─── Sanity: macOS ───────────────────────────────────────────────────────────
if [ "$(uname -s)" != "Darwin" ]; then
    err "Este instalador es solo para macOS."
    err "Para Linux/Windows usa el instalador correspondiente."
    exit 1
fi
log "macOS detectado"

# ─── Detectar arquitectura ───────────────────────────────────────────────────
detect_arch() {
    local hw
    hw="$(uname -m)"
    case "$hw" in
        x86_64)            echo "x64" ;;
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

# Mapear a nombres de binarios que vienen dentro de la app
[ "$ARCH" = "x64" ] && BIN_SUFFIX="x64" || BIN_SUFFIX="arm64"
WSH_BIN="wsh-${VERSION}-darwin.${BIN_SUFFIX}"
GULINSRV_BIN="gulinsrv.${BIN_SUFFIX}"

# ─── Construir lista de URLs candidatas ──────────────────────────────────────
DMG_NAME="GuLiN-darwin-${ARCH}-${VERSION}.dmg"
S3_URL="https://www.ecogulin.cl/downloads/${DMG_NAME}"
GH_URL="https://github.com/${GITHUB_USER}/${GITHUB_REPO}/releases/download/v${VERSION}/${DMG_NAME}"

CANDIDATES=()
if [ -n "$DMG_BASE" ]; then
    CANDIDATES+=("${DMG_BASE%/}/${DMG_NAME}")
else
    CANDIDATES+=("$S3_URL")
    CANDIDATES+=("$GH_URL")
fi

# ─── Descargar DMG (primer URL que responda) ─────────────────────────────────
TMP_DIR="$(mktemp -d -t gulin-install.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

DMG_PATH=""
for url in "${CANDIDATES[@]}"; do
    info "Probando descarga desde:"
    info "  $url"
    # HEAD check (solo para elegir el origen)
    if curl -fsSI --connect-timeout 10 --max-time 20 "$url" >/dev/null 2>&1; then
        log "Origen disponible: $url"
        DMG_PATH="$url"
        break
    fi
    warn "No disponible (se prueba el siguiente origen)..."
done

if [ -z "$DMG_PATH" ]; then
    err "No se pudo localizar el DMG ${DMG_NAME} en ninguno de los origenes."
    err "Verifica la version (GULIN_VERSION=${VERSION}) o la conexion."
    err "  S3:      $S3_URL"
    err "  GitHub:  $GH_URL"
    exit 1
fi

hr
info "Descargando ${DMG_NAME} (${VERSION})..."
info "  ${DMG_PATH}"
LOCAL_DMG="${TMP_DIR}/${DMG_NAME}"
if ! curl -fSL --connect-timeout 15 --max-time 1800 -o "$LOCAL_DMG" "$DMG_PATH"; then
    err "Fallo la descarga del DMG."
    exit 1
fi
SIZE="$(du -h "$LOCAL_DMG" | cut -f1 | tr -d ' ')"
log "Descarga completa: ${SIZE} (${DMG_NAME})"

# ─── Montar DMG ──────────────────────────────────────────────────────────────
hr
MOUNT_PT="$(mktemp -d -t gulin-mount.XXXXXX)"
cleanup_mount() {
    hdiutil detach "$MOUNT_PT" >/dev/null 2>&1 || true
    rm -rf "$MOUNT_PT"
}
trap 'cleanup_mount; rm -rf "$TMP_DIR"' EXIT

info "Montando DMG..."
if ! hdiutil attach "$LOCAL_DMG" -nobrowse -readonly -mountpoint "$MOUNT_PT" >/dev/null 2>&1; then
    err "Fallo al montar el DMG."
    exit 1
fi
log "DMG montado en $MOUNT_PT"

# ─── Copiar app a /Applications ──────────────────────────────────────────────
SRC_APP="${MOUNT_PT}/${APP_BUNDLE}"
if [ ! -d "$SRC_APP" ]; then
    # algunos DMG lo ponen bajo "GuLiN Installer" / subcarpeta
    SRC_APP="$(find "$MOUNT_PT" -maxdepth 2 -type d -name "${APP_BUNDLE}" -print -quit 2>/dev/null)"
fi
if [ -z "$SRC_APP" ] || [ ! -d "$SRC_APP" ]; then
    err "No se encontro ${APP_BUNDLE} dentro del DMG."
    exit 1
fi

mkdir -p "$APP_DIR"
DEST_APP="${APP_DIR}/${APP_BUNDLE}"

if [ -d "$DEST_APP" ]; then
    warn "Ya existe ${DEST_APP}. Reemplazando..."
    rm -rf "$DEST_APP"
fi
info "Copiando ${APP_BUNDLE} a ${APP_DIR}..."
if ! cp -R "$SRC_APP" "$DEST_APP" 2>/dev/null; then
    warn "No tuve permiso para escribir en ${APP_DIR}, usando ~/Applications."
    APP_DIR="${HOME}/Applications"
    mkdir -p "$APP_DIR"
    DEST_APP="${APP_DIR}/${APP_BUNDLE}"
    [ -d "$DEST_APP" ] && rm -rf "$DEST_APP"
    cp -R "$SRC_APP" "$DEST_APP"
fi
log "${APP_BUNDLE} instalado en ${APP_DIR}"

# Eliminar atributo de cuarentena (si el DMG no esta firmado/notarizado)
xattr -dr com.apple.quarantine "$DEST_APP" >/dev/null 2>&1 || true

# ─── Instalar CLI (symlinks a los binarios dentro de la app) ─────────────────
setup_path() {
    local install_dir="$1"
    local rc_file=""
    case "${SHELL:-/bin/zsh}" in
        */zsh)  rc_file="${HOME}/.zshrc" ;;
        */bash)
            if [ -f "${HOME}/.bashrc" ]; then rc_file="${HOME}/.bashrc"
            else rc_file="${HOME}/.bash_profile"; fi ;;
    esac
    [ -z "$rc_file" ] && return

    if grep -Fq "$install_dir" "$rc_file" 2>/dev/null; then
        info "PATH ya configurado en ${rc_file}"
        return
    fi
    {
        echo ""
        echo "# GuLiN CLI"
        echo "export PATH=\"${install_dir}:\$PATH\""
    } >> "$rc_file"
    log "PATH agregado a ${rc_file} (${install_dir})"
}

hr
APP_BIN="${DEST_APP}/Contents/Resources/bin"
info "Configurando CLI (binarios dentro de la app)..."
info "  ${APP_BIN}"

instalar_cli_links() {
    local dest_dir="$1"
    mkdir -p "$dest_dir"
    local maker=""

    # gulinsrv
    if [ -f "${APP_BIN}/${GULINSRV_BIN}" ]; then
        ln -sf "${APP_BIN}/${GULINSRV_BIN}" "${dest_dir}/gulinsrv"
        log "gulinsrv  -> ${dest_dir}/gulinsrv"
        maker=1
    else
        warn "No se encontro ${GULINSRV_BIN} dentro de la app"
    fi

    # wsh
    if [ -f "${APP_BIN}/${WSH_BIN}" ]; then
        ln -sf "${APP_BIN}/${WSH_BIN}" "${dest_dir}/wsh"
        log "wsh       -> ${dest_dir}/wsh"
        maker=1
    else
        warn "No se encontro ${WSH_BIN} dentro de la app"
    fi
    return 0
}

if [ "${GULIN_NO_PATH:-0}" = "1" ]; then
    warn "GULIN_NO_PATH=1: omitiendo symlinks de CLI"
else
    CLI_OK=0
    # Intenta /usr/local/bin (mayor intente); si no hay permiso, ~/.gulin/bin
    if [ -w /usr/local/bin ]; then
        instalar_cli_links "${CLI_LINK_DIR}" && CLI_OK=1
    else
        warn "/usr/local/bin no es escribible, usando ${FALLBACK_CLI_DIR}"
        mkdir -p "$FALLBACK_CLI_DIR"
        instalar_cli_links "$FALLBACK_CLI_DIR" && CLI_OK=1
    fi

    # Si el directorio final de CLI no es /usr/local/bin, asegurar PATH
    local final_dir="$CLI_LINK_DIR"
    if [ "$CLI_OK" = "1" ] && [ ! -w /usr/local/bin ]; then
        final_dir="$FALLBACK_CLI_DIR"
        setup_path "$final_dir"
    fi
fi

# ─── Verificación ────────────────────────────────────────────────────────────
hr
log "Verificando instalacion..."
CLI_UNSET="${CLI_LINK_DIR}"
[ -d "$FALLBACK_CLI_DIR" ] && [ -w "$FALLBACK_CLI_DIR" ] && CLI_UNSET="$FALLBACK_CLI_DIR"

if [ -x "$DEST_APP/Contents/MacOS/GuLiN" ] || [ -x "$DEST_APP/Contents/MacOS/gulin" ]; then
    log "${APP_BUNDLE} OK en ${APP_DIR}"
else
    warn "${APP_BUNDLE} instalado pero no se verifico el binario de Electron."
fi

for b in gulinsrv wsh; do
    if command -v "$b" >/dev/null 2>&1 || [ -x "${CLI_UNSET}/${b}" ]; then
        log "$b OK"
    else
        warn "$b no visible en el PATH (puede requerir reabrir la terminal)"
    fi
done

info "Abriendo ${APP_BUNDLE}..."
open "$DEST_APP" >/dev/null 2>&1 || true

# ─── Resultado final ─────────────────────────────────────────────────────────
hr
cat <<EOF

${GREEN}${BOLD}Instalacion completada!${NC}

  App:      ${DEST_APP}
  Arquitectura: ${ARCH} (DMG ${VERSION})
  Origen:   ${DMG_PATH}

CLI disponibles (despues de reabrir la terminal):
    gulinsrv --help
    wsh --help

Para desinstalar:
    rm -rf ${DEST_APP}
    rm -f ${CLI_LINK_DIR}/gulinsrv ${CLI_LINK_DIR}/wsh
    # y elimina la linea 'GuLiN CLI' de tu rc file

EOF
exit 0
