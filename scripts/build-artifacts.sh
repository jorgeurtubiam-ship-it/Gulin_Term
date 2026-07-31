#!/usr/bin/env bash
# =============================================================================
# build-artifacts.sh - Solo compila y empaqueta, NO publica
# =============================================================================
# Util para probar el pipeline de build antes de publicar, o para distribuir
# los artefactos manualmente (sin GitHub Releases).
#
# Uso:
#   ./scripts/build-artifacts.sh [version]
# =============================================================================

set -euo pipefail

VERSION="${1:-$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "0.0.0")}"

if [ -t 1 ]; then
    GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
else
    GREEN=''; CYAN=''; YELLOW=''; RED=''; NC=''
fi

log()  { printf "${GREEN}[ok]${NC} %s\n" "$*"; }
info() { printf "${CYAN}[i]${NC} %s\n" "$*"; }
err()  { printf "${RED}[x]${NC} %s\n" "$*" >&2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
ROOT="$(pwd)"

log "Compilando GuLiN CLI v${VERSION} (solo build, sin publicar)"
log "Root: $ROOT"

# Verificar Go
command -v go >/dev/null || { err "Falta 'go'"; exit 1; }

OUT_DIR="${ROOT}/dist/releases/v${VERSION}"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
info "Output: $OUT_DIR"

# Build gulinsrv arm64
info "Building gulinsrv darwin/arm64..."
CGO_CFLAGS="-I${ROOT}/include -fno-sanitize=undefined" \
CGO_ENABLED=1 GOOS=darwin GOARCH=arm64 \
    go build -tags "osusergo,sqlite_omit_load_extension" \
    -ldflags "-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M') -X main.GulinVersion=${VERSION}" \
    -o "${OUT_DIR}/gulinsrv-arm64" cmd/server/main-server.go

# Build gulinsrv amd64
info "Building gulinsrv darwin/amd64..."
CGO_CFLAGS="-I${ROOT}/include -fno-sanitize=undefined" \
CGO_ENABLED=1 GOOS=darwin GOARCH=amd64 \
    go build -tags "osusergo,sqlite_omit_load_extension" \
    -ldflags "-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M') -X main.GulinVersion=${VERSION}" \
    -o "${OUT_DIR}/gulinsrv-x64" cmd/server/main-server.go

# Build wsh arm64
info "Building wsh darwin/arm64..."
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 \
    go build -ldflags "-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M') -X main.GulinVersion=${VERSION}" \
    -o "${OUT_DIR}/wsh-arm64" cmd/wsh/main-wsh.go

# Build wsh amd64
info "Building wsh darwin/amd64..."
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 \
    go build -ldflags "-s -w -X main.BuildTime=$(date +'%Y%m%d%H%M') -X main.GulinVersion=${VERSION}" \
    -o "${OUT_DIR}/wsh-x64" cmd/wsh/main-wsh.go

# Crear tarballs
make_tarball() {
    local arch="$1"
    local tarname="GuLiN-${VERSION}-darwin-${arch}.tar.gz"
    local tmp="${OUT_DIR}/.tmp-${arch}"
    mkdir -p "$tmp"
    cp "${OUT_DIR}/gulinsrv-${arch}" "$tmp/gulinsrv"
    cp "${OUT_DIR}/wsh-${arch}"      "$tmp/wsh"
    chmod +x "$tmp/gulinsrv" "$tmp/wsh"
    cat > "$tmp/README.txt" <<EOF
GuLiN CLI v${VERSION} - macOS ${arch}
Binarios: gulinsrv (server), wsh (shell)
EOF
    tar -czf "${OUT_DIR}/${tarname}" -C "$tmp" .
    rm -rf "$tmp"
    log "Tarball: ${tarname}"
}

make_tarball "arm64"
make_tarball "x64"

# Checksums
cd "$OUT_DIR"
if command -v sha256sum >/dev/null; then
    sha256sum GuLiN-*.tar.gz > checksums.txt
else
    shasum -a 256 GuLiN-*.tar.gz > checksums.txt
fi
cd - >/dev/null

echo ""
log "Build completo!"
info "Artefactos:"
ls -lh "$OUT_DIR" | grep -v '^total' | sed 's/^/    /'

echo ""
info "Para publicar a GitHub Releases:"
echo "    ./scripts/release.sh ${VERSION}"
echo ""
info "Para probar el install localmente:"
echo "    GULIN_GH_USER=test GULIN_GH_REPO=test GULIN_VERSION=${VERSION} bash scripts/install.sh"
echo ""

exit 0