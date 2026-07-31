#!/usr/bin/env bash
# =============================================================================
# install.sh - Instalador CLI de GuLiN (gulinsrv + wsh) para macOS
# =============================================================================
# Uso (lo que ejecuta tu cliente):
#   curl -fsSL https://raw.githubusercontent.com/jorgeurtubiam-ship-it/Gulin_Term/main/scripts/install.sh | bash
#
# Variables opcionales:
#   GULIN_VERSION=2.0.4   # Instala una versión específica (default: latest)
#   GULIN_NO_PATH=1       # No modifica el PATH automáticamente
#   GULIN_INSTALL_DIR=... # Directorio de instalación custom (default: ~/.gulin/bin)
# =============================================================================

set -euo pipefail

# ─── Configuración ───────────────────────────────────────────────────────────
GITHUB_USER="${GULIN_GH_USER:-jorgeurtubiam-ship-it}"
GITHUB_REPO="${GULIN_GH_REPO:-Gulin_Term}"
APP_NAME="GuLiN"
DEFAULT_INSTALL_DIR="${HOME}/.gulin/bin"
INSTALL_DIR="${GULIN_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
VERSION="${GULIN_VERSION:-}"

# ─── Colores ────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
    GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
    RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
else
    GREEN=''; YELLOW=''; CYAN=''; RED=''; BOLD=''; NC=''
fi

log()  { printf "${GREEN}[ok]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[!]${NC} %s\n" "$*"; }
info() { printf "${CYAN}[i]${NC} %s\n" "$*"; }
err()  { printf "${RED}[x]${NC} %s\n" "$*" >&2; }
hr()   { printf "${CYAN}--------------------------------------------${NC}\n"; }

# ─── Banner ─────────────────────────────────────────────────────────────────
cat <<'EOF'

   ==============================================
       GuLiN CLI - Instalador 1-linea (curl)
   ==============================================

EOF

# ─── 1. Verificar macOS ────────────────────────────────────────────────────
if [ "$(uname -s)" != "Darwin" ]; then
    err "Este instalador es solo para macOS."
    err "Para Linux/Windows descarga los binarios desde GitHub Releases."
    exit 1
fi

# ─── 2. Detectar arquitectura ───────────────────────────────────────────────
detect_arch() {
    local hw
    hw="$(uname -m)"
    case "$hw" in
        x86_64)            echo "x64"   ;;
        arm64|aarch64)     echo "arm64" ;;
        *)
            err "Arquitectura no soportada: $hw"
            err "GuLiN soporta x86_64 (Intel) y arm64 (Apple Silicon)."
            exit 1
            ;;
    esac
}

ARCH="$(detect_arch)"
log "Arquitectura: ${BOLD}${ARCH}${NC}"

# ─── 3. Obtener última versión ──────────────────────────────────────────────
get_latest_version() {
    local api_url="https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/releases/latest"
    local tag
    tag="$(curl -fsSL -A 'gulin-install' "$api_url" 2>/dev/null \
        | grep '"tag_name"' | head -1 | sed -E 's/.*"v?([^"]+)".*/\1/')"
    if [ -z "$tag" ]; then
        err "No pude obtener la ultima version desde GitHub API."
        err "Verifica tu conexion o especifica una version:"
        err "    GULIN_VERSION=2.0.4 curl -fsSL ... | bash"
        exit 1
    fi
    echo "$tag"
}

if [ -z "$VERSION" ]; then
    info "Buscando ultima version en GitHub Releases..."
    VERSION="$(get_latest_version)"
fi
log "Version: ${BOLD}v${VERSION}${NC}"

# ─── 4. Preparar directorio temporal ────────────────────────────────────────
TMP_DIR="$(mktemp -d -t gulin-install.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

BASE_URL="https://github.com/${GITHUB_USER}/${GITHUB_REPO}/releases/download/v${VERSION}"
TARBALL="GuLiN-${VERSION}-darwin-${ARCH}.tar.gz"

# ─── 5. Descargar tarball ───────────────────────────────────────────────────
hr
info "Descargando ${CYAN}${TARBALL}${NC}..."
if ! curl -fSL --connect-timeout 15 --max-time 120 -o "${TMP_DIR}/${TARBALL}" \
        "${BASE_URL}/${TARBALL}"; then
    err "Fallo la descarga desde:"
    err "    ${BASE_URL}/${TARBALL}"
    err ""
    err "Posibles causas:"
    err "  - La version v${VERSION} no tiene binarios para macOS-${ARCH}"
    err "  - No existe un release publicado (pide al autor que suba uno)"
    err "  - Tu red bloquea GitHub"
    exit 1
fi

DOWNLOAD_SIZE="$(du -h "${TMP_DIR}/${TARBALL}" | cut -f1 | tr -d ' ')"
log "Descarga completa: ${DOWNLOAD_SIZE}"

# ─── 6. Verificar SHA256 ────────────────────────────────────────────────────
SKIP_VERIFY=0
info "Descargando checksums.txt..."
if ! curl -fsSL --connect-timeout 10 --max-time 30 -o "${TMP_DIR}/checksums.txt" \
        "${BASE_URL}/checksums.txt" 2>/dev/null; then
    warn "No se pudo descargar checksums.txt - continuando SIN verificacion."
    SKIP_VERIFY=1
fi

if [ "$SKIP_VERIFY" -eq 0 ]; then
    info "Verificando SHA256..."
    EXPECTED="$(grep -E "[[:space:]]${TARBALL}\$" "${TMP_DIR}/checksums.txt" 2>/dev/null | awk '{print $1}' | head -1)"
    if [ -z "$EXPECTED" ]; then
        err "No encontre checksum para ${TARBALL} en checksums.txt."
        err "El release puede estar corrupto o mal publicado."
        exit 1
    fi

    ACTUAL=""
    if command -v sha256sum >/dev/null 2>&1; then
        ACTUAL="$(sha256sum "${TMP_DIR}/${TARBALL}" | awk '{print $1}')"
    elif command -v shasum >/dev/null 2>&1; then
        ACTUAL="$(shasum -a 256 "${TMP_DIR}/${TARBALL}" | awk '{print $1}')"
    fi

    if [ -z "$ACTUAL" ]; then
        err "No tengo sha256sum ni shasum disponibles."
        exit 1
    fi

    if [ "$EXPECTED" != "$ACTUAL" ]; then
        err "Checksum NO coincide."
        err "  Esperado: ${EXPECTED}"
        err "  Obtenido: ${ACTUAL}"
        exit 1
    fi
    log "SHA256 verificado correctamente."
fi

# ─── 7. Extraer ──────────────────────────────────────────────────────────────
hr
info "Extrayendo binarios..."
tar -xzf "${TMP_DIR}/${TARBALL}" -C "$TMP_DIR"

# Detectar binarios (acepta cualquier naming razonable)
SRV_BIN="$(find "$TMP_DIR" -maxdepth 3 -type f \( -name 'gulinsrv*' -o -name 'gulinsrv' \) 2>/dev/null | grep -v '\.exe$' | head -1)"
WSH_BIN="$(find "$TMP_DIR" -maxdepth 3 -type f \( -name 'wsh*' -o -name 'wsh' \) 2>/dev/null | grep -v '\.exe$' | head -1)"

if [ -z "$SRV_BIN" ] && [ -z "$WSH_BIN" ]; then
    err "El tarball no contiene binarios esperados (gulinsrv o wsh)."
    err "Contenido del tarball:"
    tar -tzf "${TMP_DIR}/${TARBALL}" | sed 's/^/    /'
    exit 1
fi

# ─── 8. Instalar ─────────────────────────────────────────────────────────────
hr
info "Instalando en ${BOLD}${INSTALL_DIR}${NC}..."
mkdir -p "$INSTALL_DIR"

INSTALLED_ANY=0
if [ -n "$SRV_BIN" ]; then
    cp "$SRV_BIN" "${INSTALL_DIR}/gulinsrv"
    chmod +x "${INSTALL_DIR}/gulinsrv"
    log "gulinsrv -> ${INSTALL_DIR}/gulinsrv"
    INSTALLED_ANY=1
fi
if [ -n "$WSH_BIN" ]; then
    cp "$WSH_BIN" "${INSTALL_DIR}/wsh"
    chmod +x "${INSTALL_DIR}/wsh"
    log "wsh -> ${INSTALL_DIR}/wsh"
    INSTALLED_ANY=1
fi

if [ "$INSTALLED_ANY" -eq 0 ]; then
    err "No se instalo ningun binario."
    exit 1
fi

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
VERIFY_OK=1
if [ -x "${INSTALL_DIR}/gulinsrv" ]; then
    if "${INSTALL_DIR}/gulinsrv" --version >/dev/null 2>&1; then
        VERSION_OUT="$("${INSTALL_DIR}/gulinsrv" --version 2>&1 | head -1)"
        log "gulinsrv OK (${VERSION_OUT:-version OK})"
    else
        warn "gulinsrv instalado pero no responde a --version (puede ser normal)"
    fi
else
    err "gulinsrv no es ejecutable"
    VERIFY_OK=0
fi
if [ -x "${INSTALL_DIR}/wsh" ]; then
    log "wsh OK"
else
    warn "wsh no es ejecutable (puede que el release no lo incluya)"
fi

# ─── Resultado final ────────────────────────────────────────────────────────
hr
cat <<EOF

${GREEN}${BOLD}Instalacion completada!${NC}

Binarios en: ${BOLD}${INSTALL_DIR}${NC}

Para empezar a usar GuLiN CLI ahora mismo:
    export PATH="${INSTALL_DIR}:\$PATH"
    gulinsrv --help
    wsh --help

O reinicia tu terminal y los binarios estaran disponibles.

Para desinstalar:
    rm -rf ${INSTALL_DIR}
    # y elimina la linea de PATH en tu rc file

EOF

if [ "$VERIFY_OK" -eq 0 ]; then
    exit 1
fi

exit 0