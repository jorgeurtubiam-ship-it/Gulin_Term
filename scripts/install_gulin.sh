#!/usr/bin/env bash
# =============================================================================
# install_gulin.sh - Instalador local de GuLiN Agent para macOS
# Versión: 2.0.3
# Autor: LoRdZeRo
# =============================================================================
# Este script compila e instala GuLiN desde el código fuente local.
# No necesita clonar el repo, usa el código en el directorio actual.
# =============================================================================

set -euo pipefail

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GULIN_DIR="$SCRIPT_DIR"
BUILD_DIR="$GULIN_DIR/build_output"
APP_NAME="GuLiN"
APP_VERSION="2.0.3"

log()     { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✗]${NC} $1"; }
info()    { echo -e "${CYAN}[i]${NC} $1"; }
section() { echo -e "\n${CYAN}══════════════════════════════════════════════${NC}"; echo -e "${CYAN}  $1${NC}"; echo -e "${CYAN}══════════════════════════════════════════════${NC}\n"; }

# ──────────────────────────────────────────────
# 1. Verificar dependencias del sistema
# ──────────────────────────────────────────────
check_deps() {
    section "Verificando dependencias del sistema"

    local missing=false

    # Go
    if command -v go &>/dev/null; then
        GO_VER=$(go version | sed 's/.*go\([0-9]*\.[0-9]*\).*/\1/')
        log "Go $GO_VER encontrado"
    else
        error "Go no encontrado. Instálalo con: brew install go"
        missing=true
    fi

    # Node
    if command -v node &>/dev/null; then
        NODE_VER=$(node -v | sed 's/v//')
        log "Node.js $NODE_VER encontrado"
    else
        error "Node.js no encontrado. Instálalo con: brew install node"
        missing=true
    fi

    # npm
    if command -v npm &>/dev/null; then
        NPM_VER=$(npm -v)
        log "npm $NPM_VER encontrado"
    else
        error "npm no encontrado"
        missing=true
    fi

    # Task
    if command -v task &>/dev/null; then
        TASK_VER=$(task --version 2>/dev/null || echo "desconocida")
        log "Task $TASK_VER encontrado"
    else
        warn "Task no encontrado. Instálalo con: brew install go-task"
        warn "  Se usará npm run dev como alternativa."
    fi

    # zig (para CGO en macOS, opcional pero recomendado)
    if command -v zig &>/dev/null; then
        ZIG_VER=$(zig version 2>/dev/null || echo "desconocida")
        log "Zig $ZIG_VER encontrado (para CGO estático)"
    else
        warn "Zig no encontrado (opcional, para compilación estática CGO)"
        warn "  Instálalo con: brew install zig"
    fi

    # Xcode Command Line Tools
    if xcode-select -p &>/dev/null; then
        log "Xcode Command Line Tools instalados"
    else
        error "Xcode Command Line Tools no instalados. Ejecuta: xcode-select --install"
        missing=true
    fi

    if [ "$missing" = true ]; then
        error "Faltan dependencias. Instálalas y vuelve a ejecutar este script."
        exit 1
    fi
}

# ──────────────────────────────────────────────
# 2. Verificar estructura del proyecto
# ──────────────────────────────────────────────
check_project() {
    section "Verificando estructura del proyecto"

    local required_files=(
        "package.json"
        "go.mod"
        "Taskfile.yml"
        "electron-builder.config.cjs"
        "electron.vite.config.ts"
    )

    for file in "${required_files[@]}"; do
        if [ -f "$GULIN_DIR/$file" ]; then
            log "Encontrado: $file"
        else
            error "Falta archivo requerido: $file"
            warn "Asegúrate de ejecutar este script desde el directorio raíz de GuLiN (waveterm/)"
            exit 1
        fi
    done

    log "Estructura del proyecto verificada correctamente"
}

# ──────────────────────────────────────────────
# 3. Instalar dependencias de Node
# ──────────────────────────────────────────────
install_node_deps() {
    section "Instalando dependencias de Node.js (npm install)"

    cd "$GULIN_DIR"

    if [ -d "node_modules" ]; then
        warn "node_modules ya existe. ¿Reinstalar? (s/N)"
        read -r response
        if [[ "$response" =~ ^[sS]$ ]]; then
            info "Reinstalando dependencias npm..."
            npm install
        else
            info "Omitiendo npm install"
        fi
    else
        info "Instalando dependencias npm..."
        npm install
    fi

    log "Dependencias npm instaladas"
}

# ──────────────────────────────────────────────
# 4. Descargar dependencias de Go
# ──────────────────────────────────────────────
install_go_deps() {
    section "Descargando dependencias de Go"

    cd "$GULIN_DIR"

    info "Ejecutando go mod download..."
    go mod download

    log "Dependencias Go descargadas"
}

# ──────────────────────────────────────────────
# 5. Compilar backend Go
# ──────────────────────────────────────────────
build_backend() {
    section "Compilando backend Go (gulinsrv + wsh)"

    cd "$GULIN_DIR"

    info "Compilando backend para macOS amd64..."

    if command -v task &>/dev/null; then
        task build:backend 2>&1 | tail -20 || {
            warn "task build:backend falló, intentando compilación directa..."
            build_backend_direct
        }
    else
        build_backend_direct
    fi

    log "Backend compilado"
}

build_backend_direct() {
    info "Compilación directa con go build..."

    mkdir -p "$GULIN_DIR/dist/bin"

    # Compilar gulinsrv
    cd "$GULIN_DIR/cmd/gulinsrv"
    go build -o "$GULIN_DIR/dist/bin/gulinsrv-amd64-darwin" . 2>&1 || {
        warn "Error compilando gulinsrv"
    }

    # Compilar wsh
    cd "$GULIN_DIR/cmd/wsh"
    go build -o "$GULIN_DIR/dist/bin/wsh-amd64-darwin" . 2>&1 || {
        warn "Error compilando wsh"
    }

    cd "$GULIN_DIR"
}

# ──────────────────────────────────────────────
# 6. Build frontend Electron (modo producción)
# ──────────────────────────────────────────────
build_frontend() {
    section "Compilando frontend Electron (producción)"

    cd "$GULIN_DIR"

    info "Ejecutando build de producción..."
    npm run build:prod 2>&1 || {
        error "Falló el build del frontend"
        warn "Revisa los errores arriba. Puede ser un problema de tipos o dependencias."
        exit 1
    }

    log "Frontend compilado en dist/"
}

# ──────────────────────────────────────────────
# 7. Empaquetar app macOS
# ──────────────────────────────────────────────
package_app() {
    section "Empaquetando aplicación macOS (.app / .dmg)"

    cd "$GULIN_DIR"

    # Verificar si electron-builder está disponible
    if ! npx --yes electron-builder --version &>/dev/null; then
        error "electron-builder no disponible"
        exit 1
    fi

    info "Generando bundle macOS (esto puede tomar varios minutos)..."

    mkdir -p "$BUILD_DIR"

    npx electron-builder --mac --x64 \
        --config electron-builder.config.cjs \
        --publish never 2>&1 | tail -30

    log "Empaquetado completado"
}

# ──────────────────────────────────────────────
# 8. Instalar en /Applications
# ──────────────────────────────────────────────
install_app() {
    section "Instalando GuLiN en el sistema"

    cd "$GULIN_DIR"

    # Buscar el DMG generado
    local dmg_path
    dmg_path=$(ls -t "$GULIN_DIR/make/"*".dmg" 2>/dev/null | head -1)

    if [ -n "$dmg_path" ] && [ -f "$dmg_path" ]; then
        info "DMG encontrado: $(basename "$dmg_path")"

        # Montar DMG
        local mount_point="/Volumes/GuLiN"
        if [ -d "$mount_point" ]; then
            hdiutil detach "$mount_point" -quiet 2>/dev/null || true
        fi

        info "Montando DMG..."
        hdiutil attach "$dmg_path" -nobrowse -quiet

        if [ -d "$mount_point" ]; then
            # Si ya existe, eliminar versión anterior
            if [ -d "/Applications/GuLiN.app" ]; then
                warn "Eliminando versión anterior de /Applications..."
                rm -rf "/Applications/GuLiN.app"
            fi

            info "Copiando a /Applications..."
            cp -R "$mount_point/GuLiN.app" /Applications/

            # Desmontar
            hdiutil detach "$mount_point" -quiet
            log "GuLiN.app instalado en /Applications/"
        else
            error "No se pudo montar el DMG"
            warn "Puedes instalar manualmente desde: $dmg_path"
        fi
    else
        # Buscar .app directamente en make/
        local app_path
        app_path=$(find "$GULIN_DIR/make" -name "GuLiN.app" -type d 2>/dev/null | head -1)

        if [ -n "$app_path" ]; then
            info "App bundle encontrado en: $app_path"

            if [ -d "/Applications/GuLiN.app" ]; then
                warn "Eliminando versión anterior..."
                rm -rf "/Applications/GuLiN.app"
            fi

            cp -R "$app_path" /Applications/
            log "GuLiN.app instalado en /Applications/"
        else
            warn "No se encontró el DMG ni el .app generado."
            warn "Puedes encontrarlo manualmente en: $GULIN_DIR/make/"
        fi
    fi
}

# ──────────────────────────────────────────────
# 9. Configurar CLI (wsh, gulinsrv) en PATH
# ──────────────────────────────────────────────
setup_cli() {
    section "Configurando comandos CLI (wsh, gulinsrv)"

    local shell_rc="$HOME/.zshrc"
    local path_line='export PATH="$PATH:'"$GULIN_DIR/dist/bin"'"'

    # Verificar si ya está en PATH
    if grep -qF "$GULIN_DIR/dist/bin" "$shell_rc" 2>/dev/null; then
        info "PATH ya configurado en $shell_rc"
    else
        echo "" >> "$shell_rc"
        echo "# GuLiN CLI tools" >> "$shell_rc"
        echo "$path_line" >> "$shell_rc"
        log "PATH configurado en $shell_rc"
    fi

    # Crear enlace simbólico en /usr/local/bin como alternativa
    if [ -d "/usr/local/bin" ]; then
        for cmd in gulinsrv wsh; do
            local src="$GULIN_DIR/dist/bin/${cmd}"*
            for f in $src; do
                if [ -f "$f" ]; then
                    local target="/usr/local/bin/$cmd"
                    if [ -L "$target" ] || [ -f "$target" ]; then
                        sudo rm -f "$target"
                    fi
                    sudo ln -sf "$f" "/usr/local/bin/$cmd" 2>/dev/null && \
                        log "Enlace creado: /usr/local/bin/$cmd -> $f"
                fi
            done
        done
    fi
}

# ──────────────────────────────────────────────
# 10. Crear acceso directo en Launchpad
# ──────────────────────────────────────────────
create_shortcut() {
    section "Creando acceso directo"

    if [ -d "/Applications/GuLiN.app" ]; then
        # Abrir por primera vez para registrar en Launchpad
        info "Abriendo GuLiN por primera vez..."
        open "/Applications/GuLiN.app" &
        sleep 2
        log "GuLiN abierto. Puedes encontrarlo en Launchpad."

        # Crear alias en el Dock opcional
        warn "¿Deseas fijar GuLiN al Dock? (s/N)"
        read -r response
        if [[ "$response" =~ ^[sS]$ ]]; then
            defaults write com.apple.dock persistent-apps -array-add \
                "<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>/Applications/GuLiN.app</string><key>_CFURLStringType</key><integer>0</integer></dict></dict></dict>"
            killall Dock
            log "GuLiN fijado al Dock"
        fi
    else
        warn "GuLiN.app no encontrado en /Applications. No se pudo crear acceso directo."
    fi
}

# ──────────────────────────────────────────────
# 11. Resumen final
# ──────────────────────────────────────────────
show_summary() {
    section "Instalación completada 🎉"

    echo -e "${GREEN}  GuLiN Agent v$APP_VERSION${NC}"
    echo ""
    echo -e "  📍 App:     ${CYAN}/Applications/GuLiN.app${NC}"
    echo -e "  📍 Código:  ${CYAN}$GULIN_DIR${NC}"
    echo -e "  📍 Builds:  ${CYAN}$GULIN_DIR/make/${NC}"
    echo -e "  📍 Binarios:${CYAN}$GULIN_DIR/dist/bin/${NC}"
    echo ""
    echo -e "  ${YELLOW}Comandos disponibles:${NC}"
    echo -e "    ${GREEN}open /Applications/GuLiN.app${NC}       → Iniciar GuLiN"
    echo -e "    ${GREEN}task electron:dev${NC}                  → Modo desarrollo con hot-reload"
    echo -e "    ${GREEN}task electron:quickdev${NC}             → Modo desarrollo rápido"
    echo -e "    ${GREEN}wsh${NC} / ${GREEN}gulinsrv${NC}           → CLI tools (recarga terminal)"
    echo ""
    echo -e "  ${YELLOW}Para desinstalar:${NC}"
    echo -e "    ${GREEN}rm -rf /Applications/GuLiN.app${NC}"
    echo -e "    ${GREEN}$GULIN_DIR/uninstall_gulin.sh${NC}"
    echo ""
}

# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────
main() {
    echo -e "${CYAN}"
    echo "  ╔══════════════════════════════════════════╗"
    echo "  ║       GuLiN Agent - Instalador local      ║"
    echo "  ║       Versión $APP_VERSION                   ║"
    echo "  ╚══════════════════════════════════════════╝"
    echo -e "${NC}"

    check_deps
    check_project

    echo ""
    info "Este script compilará e instalará GuLiN en tu sistema."
    info "¿Deseas continuar? (s/N)"
    read -r response
    if [[ ! "$response" =~ ^[sS]$ ]]; then
        info "Instalación cancelada."
        exit 0
    fi

    install_node_deps
    install_go_deps
    build_backend
    build_frontend
    package_app
    install_app
    setup_cli
    create_shortcut

    show_summary

    echo -e "${GREEN}¿Quieres iniciar GuLiN ahora? (s/N)${NC}"
    read -r response
    if [[ "$response" =~ ^[sS]$ ]]; then
        open "/Applications/GuLiN.app"
        log "GuLiN iniciado"
    fi

    info "Recarga tu terminal con: source ~/.zshrc"
    info "¡Disfruta GuLiN!"
}

main
