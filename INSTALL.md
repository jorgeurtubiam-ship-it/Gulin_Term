# 🚀 Instalador de GuLiN Agent

## 📋 Requisitos del Sistema

- **macOS** 10.15+ (Catalina o superior)
- **Linux** (Ubuntu 20.04+, Fedora 36+, Arch)
- **Windows** 10/11 (soporte experimental)

### Dependencias necesarias

| Herramienta     | Versión Mínima | Instalación                           |
| --------------- | -------------- | ------------------------------------- |
| Node.js         | 22 LTS         | `brew install node`                   |
| Go              | 1.25+          | `brew install go`                     |
| npm             | 10+            | (viene con Node.js)                   |
| Xcode CLI Tools | -              | `xcode-select --install` (solo macOS) |

### Dependencias opcionales

| Herramienta | Propósito    | Instalación            |
| ----------- | ------------ | ---------------------- |
| Task        | Build runner | `brew install go-task` |
| Zig         | CGO estático | `brew install zig`     |

---

## 📁 Archivos del Instalador

| Archivo              | Descripción                                                                  |
| -------------------- | ---------------------------------------------------------------------------- |
| `install_gulin.sh`   | **Instalador completo**: compila backend + frontend, empaqueta e instala     |
| `uninstall_gulin.sh` | **Desinstalador**: elimina app, CLI, cachés y config                         |
| `install_quick.sh`   | **Instalación rápida** (desarrollo): solo compila backend + dev server       |
| `install.sh`         | **Instalador alternativo**: compila y empaqueta (sin instalación automática) |

---

## ⚡ Instalación Completa (Producción)

```bash
# 1. Ir al directorio del proyecto
cd /Users/lordzero1/IA_LoRdZeRo/Gulin_Agent/waveterm

# 2. Hacer ejecutable el instalador
chmod +x install_gulin.sh

# 3. Ejecutar instalación completa
./install_gulin.sh
```

### Lo que hace el instalador:

1. ✅ **Verifica dependencias** (Node.js, Go, npm, Xcode CLI Tools)
2. ✅ **Verifica estructura del proyecto**
3. ✅ **Instala dependencias npm** (`npm install`)
4. ✅ **Compila backend Go** (`gulinsrv` + `wsh`)
5. ✅ **Compila frontend Electron** (`npm run build:prod`)
6. ✅ **Empaqueta instalador** (`.dmg` en macOS, `.AppImage`/`.deb` en Linux)
7. ✅ **Instala en el sistema** (`/Applications/` en macOS)
8. ✅ **Configura CLI tools** en PATH (`wsh`, `gulinsrv`)
9. ✅ **Crea acceso directo** (Dock en macOS, opcional)

### Opciones del instalador:

```bash
./install_gulin.sh                    # Instalación completa (plataforma nativa)
./install_gulin.sh --windows          # Genera instalador .exe para Windows (desde macOS)
./install_gulin.sh --linux            # Genera instalador .AppImage/.deb para Linux (desde macOS)
./install_gulin.sh --quick            # Solo empaqueta (asume build existente)
./install_gulin.sh --no-backend       # Solo frontend + empaquetado
./install_gulin.sh --only-build       # Solo compila, no empaqueta
./install_gulin.sh --no-install       # Empaqueta pero no instala
./install_gulin.sh --dev              # Modo desarrollo (backend + dev server)
./install_gulin.sh --help             # Muestra ayuda
```

### Cross-Compilación (desde macOS)

Puedes generar instaladores para **Windows** y **Linux** directamente desde tu Mac:

```bash
# Requisito: Zig para CGO cross-compile
brew install zig

# Generar instalador para Windows (.exe)
./install_gulin.sh --windows

# Generar instalador para Linux (.AppImage + .deb)
./install_gulin.sh --linux
```

> **Nota:** La cross-compilación requiere [Zig](https://ziglang.org/) para compilar el backend Go con CGO. Sin Zig, puedes usar `--no-backend` para generar un paquete sin el backend nativo.
>
> Los instaladores generados se guardan en `make/` y puedes copiarlos a una máquina Windows/Linux para instalar.

---

## � Instalación Rápida (Desarrollo)

Para desarrollo diario con hot-reload:

```bash
chmod +x install_quick.sh
./install_quick.sh
```

Esto compila el backend Go e inicia el servidor de desarrollo Vite con hot-reload.

---

## 🗑️ Desinstalar

```bash
# Desinstalación interactiva
./uninstall_gulin.sh

# Desinstalación forzada (sin confirmación)
./uninstall_gulin.sh --force

# Desinstalar pero conservar cachés
./uninstall_gulin.sh --keep-cache
```

### Lo que elimina el desinstalador:

- `/Applications/GuLiN.app`
- Enlaces simbólicos en `/usr/local/bin`
- Configuración de PATH en `~/.zshrc`, `~/.bashrc`, etc.
- Cachés y datos de la aplicación
- Preferencias del sistema
- Entradas del Dock (macOS)

> **Nota:** El código fuente NO se elimina. Para eliminarlo: `rm -rf /Users/lordzero1/IA_LoRdZeRo/Gulin_Agent/waveterm`

---

## 🏗️ Build Manual (sin instalación)

Si solo quieres compilar y empaquetar sin instalar automáticamente:

```bash
# Usando el instalador
./install_gulin.sh --no-install

# O usando el script original
./install.sh

# O usando Task (si está instalado)
task package
```

Los artefactos se generarán en el directorio `make/`.

---

## 🚀 Comandos Post-Instalación

```bash
# Iniciar GuLiN
open /Applications/GuLiN.app

# Modo desarrollo (hot-reload)
task electron:dev

# Modo desarrollo rápido
task electron:quickdev

# CLI tools (después de recargar terminal)
wsh --help
gulinsrv --help
```

---

## 🐛 Solución de Problemas

### Error: "Go no encontrado"

```bash
brew install go
```

### Error: "Xcode CLI Tools no instalados"

```bash
xcode-select --install
```

### Error: "npm install falla"

```bash
# Limpiar caché de npm
npm cache clean --force
# Reintentar
./install_gulin.sh
```

### Error: "electron-builder falla"

```bash
# Intentar con build existente
./install_gulin.sh --quick
```

### Error de permisos al instalar en /Applications

```bash
# El instalador pedirá sudo automáticamente
# O puedes instalar manualmente:
sudo cp -R make/GuLiN*.app /Applications/
```

---

## 📝 Notas

- **Tiempo estimado de instalación completa:** 15-20 minutos (depende de velocidad de descarga y compilación)
- **Espacio en disco requerido:** ~2 GB para dependencias + build
- El instalador detecta automáticamente tu arquitectura (Intel/Apple Silicon)
- Compatible con macOS Intel (x64) y Apple Silicon (arm64)
