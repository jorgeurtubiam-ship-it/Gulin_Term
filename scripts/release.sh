#!/usr/bin/env bash
# =============================================================================
# release.sh - Compila + empaqueta + publica GuLiN CLI en GitHub Releases
# =============================================================================
# Uso:
#   ./scripts/release.sh <version> [github_token]
#   GULIN_GH_USER=foo GULIN_GH_REPO=bar ./scripts/release.sh 2.0.4
#
# Ejemplos:
#   ./scripts/release.sh 2.0.4                              # usa GITHUB_TOKEN env
#   ./scripts/release.sh 2.0.4 ghp_xxxxxxxxxxxxxxxxxxxx     # pasa token directo
#   ./scripts/release.sh 2.0.4 --dry-run                    # solo build, no sube
#
# Variables opcionales:
#   GULIN_GH_USER       (default: jorgeurtubiam-ship-it)
#   GULIN_GH_REPO       (default: Gulin_Term)
#   GULIN_NO_UPLOAD=1   # solo build, no publica
# =============================================================================

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────
GITHUB_USER="${GULIN_GH_USER:-jorgeurtubiam-ship-it}"
GITHUB_REPO="${GULIN_GH_REPO:-Gulin_Term}"

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

usage() {
    cat <<EOF
Uso: $0 <version> [github_token] [--dry-run]

Argumentos:
  <version>       Version a publicar (ej: 2.0.4, sin 'v')
  [github_token]  Token de GitHub con scope 'repo' (o usa GITHUB_TOKEN env)
  --dry-run       Solo compila y empaqueta, NO publica

Variables de entorno:
  GITHUB_TOKEN    Token alternativo a pasar como argumento
  GULIN_GH_USER   Override del usuario/org de GitHub
  GULIN_GH_REPO   Override del nombre del repo
  GULIN_NO_UPLOAD Si es '1', no publica (equivalente a --dry-run)
EOF
    exit 0
}

# ─── Parsear args ────────────────────────────────────────────────────────────
VERSION="${1:-}"
TOKEN="${2:-${GITHUB_TOKEN:-}}"
DRY_RUN=0
for arg in "$@"; do
    case "$arg" in
        --help|-h)    usage ;;
        --dry-run)    DRY_RUN=1 ;;
    esac
done
[ "${GULIN_NO_UPLOAD:-0}" = "1" ] && DRY_RUN=1

if [ -z "$VERSION" ]; then
    err "Falta la version."
    usage
fi

# ─── Banner ──────────────────────────────────────────────────────────────────
cat <<EOF

${CYAN}${BOLD}==============================================
   GuLiN Release Builder v${VERSION}
   Repo: ${GITHUB_USER}/${GITHUB_REPO}
   Modo: $([ $DRY_RUN -eq 1 ] && echo "DRY-RUN (no publica)" || echo "PUBLICAR")
==============================================${NC}

EOF

# ─── Ir al root del repo ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
ROOT="$(pwd)"
log "Directorio de trabajo: $ROOT"

# ─── Verificar herramientas ─────────────────────────────────────────────────
info "Verificando herramientas..."
command -v go >/dev/null      || { err "Falta 'go'. Instala Go >= 1.22"; exit 1; }
command -v curl >/dev/null    || { err "Falta 'curl'"; exit 1; }
command -v tar >/dev/null     || { err "Falta 'tar'"; exit 1; }
command -v sha256sum >/dev/null || command -v shasum >/dev/null \
    || { err "Falta 'sha256sum' o 'shasum'"; exit 1; }
log "go:      $(go version | head -c 40)"
log "curl:    $(curl --version | head -1)"

# ─── Detectar VERSION del proyecto (para comparar) ──────────────────────────
PKG_VERSION="$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo '?')"
if [ "$PKG_VERSION" != "$VERSION" ]; then
    warn "La version del package.json ($PKG_VERSION) no coincide con la que publicas ($VERSION)."
    warn "Recomendacion: actualiza package.json antes de publicar."
    if [ -t 0 ]; then
        read -p "Continuar de todos modos? [s/N] " resp
        case "$resp" in [sS]|[sS][iI]) ;; *) err "Abortado."; exit 1 ;; esac
    fi
fi

# ─── Crear directorio de output ──────────────────────────────────────────────
OUT_DIR="${ROOT}/dist/releases/v${VERSION}"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
info "Output dir: $OUT_DIR"

# ─── Build: gulinsrv para arm64 y amd64 ─────────────────────────────────────
info "Compilando gulinsrv para darwin/arm64..."
CGO_CFLAGS="-I${ROOT}/include -fno-sanitize=undefined" \
CGO_ENABLED=1 GOOS=darwin GOARCH=arm64 \
    go build -tags "osusergo,sqlite_omit_load_extension" \
    -ldflags "-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M') -X main.GulinVersion=${VERSION}" \
    -o "${OUT_DIR}/gulinsrv-arm64" cmd/server/main-server.go

info "Compilando gulinsrv para darwin/amd64..."
CGO_CFLAGS="-I${ROOT}/include -fno-sanitize=undefined" \
CGO_ENABLED=1 GOOS=darwin GOARCH=amd64 \
    go build -tags "osusergo,sqlite_omit_load_extension" \
    -ldflags "-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M') -X main.GulinVersion=${VERSION}" \
    -o "${OUT_DIR}/gulinsrv-x64" cmd/server/main-server.go

log "gulinsrv compilado para arm64 y x64"

# ─── Build: wsh para arm64 y amd64 ──────────────────────────────────────────
info "Compilando wsh para darwin/arm64..."
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 \
    go build -ldflags "-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M') -X main.GulinVersion=${VERSION}" \
    -o "${OUT_DIR}/wsh-arm64" cmd/wsh/main-wsh.go

info "Compilando wsh para darwin/amd64..."
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 \
    go build -ldflags "-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M') -X main.GulinVersion=${VERSION}" \
    -o "${OUT_DIR}/wsh-x64" cmd/wsh/main-wsh.go

log "wsh compilado para arm64 y x64"

# ─── Crear tarballs ──────────────────────────────────────────────────────────
make_tarball() {
    local arch="$1"
    local tarname="GuLiN-${VERSION}-darwin-${arch}.tar.gz"
    local tmp="${OUT_DIR}/.tmp-${arch}"
    mkdir -p "$tmp"
    cp "${OUT_DIR}/gulinsrv-${arch}" "$tmp/gulinsrv"
    cp "${OUT_DIR}/wsh-${arch}"      "$tmp/wsh"
    chmod +x "$tmp/gulinsrv" "$tmp/wsh"

    cat > "$tmp/README.txt" <<EOF
GuLiN CLI v${VERSION} para macOS (${arch})
============================================

Binarios incluidos:
  - gulinsrv   Servidor principal
  - wsh        WaveScript Shell

Uso:
  ./gulinsrv --help
  ./wsh --help

Instalado via: scripts/install.sh
EOF

    tar -czf "${OUT_DIR}/${tarname}" -C "$tmp" .
    rm -rf "$tmp"
    log "Tarball creado: ${tarname}"
}

make_tarball "arm64"
make_tarball "x64"

# ─── Calcular checksums ──────────────────────────────────────────────────────
cd "$OUT_DIR"
if command -v sha256sum >/dev/null; then
    sha256sum GuLiN-*.tar.gz > checksums.txt
else
    shasum -a 256 GuLiN-*.tar.gz > checksums.txt
fi
cd - >/dev/null
log "checksums.txt generado"

# ─── Mostrar resumen ─────────────────────────────────────────────────────────
hr() { printf "${CYAN}--------------------------------------------${NC}\n"; }
hr
info "Artefactos generados:"
ls -lh "$OUT_DIR" | sed 's/^/    /'
hr

# ─── Si es dry-run, terminar aquí ────────────────────────────────────────────
if [ "$DRY_RUN" -eq 1 ]; then
    log "DRY-RUN: build completo. No se publico nada."
    log "Para publicar: ./scripts/release.sh ${VERSION} <github_token>"
    exit 0
fi

# ─── Verificar token ─────────────────────────────────────────────────────────
if [ -z "$TOKEN" ]; then
    err "Necesitas un GitHub token con scope 'repo'."
    err "Opciones:"
    err "  1. export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx"
    err "  2. $0 ${VERSION} ghp_xxxxxxxxxxxxxxxxxxxx"
    err "  3. --dry-run para solo build"
    exit 1
fi

# ─── Publicar en GitHub Releases ─────────────────────────────────────────────
info "Publicando release en GitHub..."

RELEASE_NOTES="## GuLiN CLI v${VERSION}

Binarios CLI para macOS (gulinsrv + wsh).

### Instalacion 1-linea (en el Mac del cliente)

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/main/scripts/install.sh | bash
\`\`\`

### Descarga manual

| Archivo | Arquitectura |
|---|---|
| GuLiN-${VERSION}-darwin-arm64.tar.gz | Apple Silicon (M1/M2/M3/M4) |
| GuLiN-${VERSION}-darwin-x64.tar.gz   | Intel (x86_64) |

El script \`install.sh\` detecta la arquitectura automaticamente.
"

# 1. Crear el release (sin assets primero)
CREATE_PAYLOAD=$(cat <<EOF
{
  "tag_name": "v${VERSION}",
  "target_commitish": "main",
  "name": "GuLiN CLI v${VERSION}",
  "body": $(printf '%s' "$RELEASE_NOTES" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))'),
  "draft": false,
  "prerelease": false
}
EOF
)

API_BASE="https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}"
RELEASE_RESP="$(curl -fsSL -H "Authorization: token ${TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "Content-Type: application/json" \
    -X POST -d "$CREATE_PAYLOAD" \
    "${API_BASE}/releases")"

RELEASE_ID="$(echo "$RELEASE_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')"
UPLOAD_URL="$(echo "$RELEASE_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["upload_url"])')"

log "Release creado (id=${RELEASE_ID})"

# 2. Subir cada asset
upload_asset() {
    local file="$1"
    local name="$(basename "$file")"
    info "Subiendo ${name}..."
    curl -fsSL \
        -H "Authorization: token ${TOKEN}" \
        -H "Accept: application/vnd.github+json" \
        -H "Content-Type: application/gzip" \
        --data-binary "@${file}" \
        "${UPLOAD_URL%\{?name,label\}}?name=${name}" > /dev/null
    log "Subido: ${name}"
}

upload_asset "${OUT_DIR}/GuLiN-${VERSION}-darwin-arm64.tar.gz"
upload_asset "${OUT_DIR}/GuLiN-${VERSION}-darwin-x64.tar.gz"
upload_asset "${OUT_DIR}/checksums.txt"

RELEASE_URL="https://github.com/${GITHUB_USER}/${GITHUB_REPO}/releases/tag/v${VERSION}"

hr
cat <<EOF

${GREEN}${BOLD}Release publicado!${NC}

URL: ${CYAN}${RELEASE_URL}${NC}

Tu cliente (Mac M4) ahora puede instalar con:
    curl -fsSL https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/main/scripts/install.sh | bash

EOF

exit 0