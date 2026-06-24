# Diagnóstico: Pantalla Negra en Gulin App

## Síntoma
La ventana de Gulin se abre pero se queda completamente en negro (no renderiza la UI). El servidor `gulinsrv` puede arrancar o fallar.

---

## Causas y Soluciones

### 1. Falta `index.html` en la raíz del proyecto

**Causa:** La configuración de `electron-vite` (`electron.vite.config.ts`) espera `index.html` en la raíz del proyecto (`root: "."`). Si se elimina o mueve este archivo, la build de producción falla y en modo dev la ventana no renderiza nada.

**Solución:**
```bash
# Restaurar index.html desde el historial de git (commit anterior a la limpieza)
git show cfa0501ae^:index.html > index.html
```

### 2. Variables de entorno WCLOUD faltantes

**Causa:** El binario `gulinsrv.x64` valida las variables `WCLOUD_ENDPOINT` y `WCLOUD_WS_ENDPOINT` al arrancar. Si no están definidas, el servidor se cierra con errores como:

- `invalid wcloud endpoint, WCLOUD_ENDPOINT not set or invalid`
- `invalid wcloud ws endpoint, WCLOUD_WS_ENDPOINT not set or invalid`

**Solución:** Setear las variables de entorno o usar el `.env` del proyecto que ya contiene los endpoints de desarrollo:

```bash
# Opción 1: Usar task dev (lee .env automáticamente)
task dev

# Opción 2: Setear variables manualmente
WCLOUD_ENDPOINT="https://api.gulin.dev/central" \
WCLOUD_WS_ENDPOINT="wss://wsapi.gulin.dev/" \
WCLOUD_PING_ENDPOINT="https://ping.gulin.dev/central" \
npm run dev
```

### 3. Falta el paquete `sharp`

**Causa:** El plugin `vite-plugin-image-optimizer` requiere `sharp` para optimizar imágenes durante el build. Sin él, el build de producción falla.

**Solución:**
```bash
npm install sharp
```

---

## Comandos Útiles

### Desarrollo (modo dev con hot reload)
```bash
cd ~/IA_LoRdZeRo/Gulin_Agent/waveterm
npm run dev
```
Esto levanta:
- Servidor Vite en `http://localhost:5173/` (frontend con hot reload)
- Servidor `gulinsrv` en `127.0.0.1` (backend)
- Ventana de Electron

### Build de producción
```bash
cd ~/IA_LoRdZeRo/Gulin_Agent/waveterm
npm run build:prod
```
Genera los archivos en `dist/`.

---

## Archivos Clave

| Archivo | Propósito |
|---------|-----------|
| `index.html` (raíz) | Punto de entrada para electron-vite renderer |
| `electron.vite.config.ts` | Configuración de Vite para Electron |
| `.env` | Variables de entorno (WCLOUD endpoints) |
| `pkg/wcloud/wcloud.go` | Constantes WCLOUD en Go (valores por defecto) |

---

## Histórico

- El `index.html` fue movido a `docs/index.html` durante una reorganización del repo (commit `cfa0501ae`).
- El binario `gulinsrv.x64` compilado valida estrictamente las variables `WCLOUD_*` a diferencia del código fuente que tiene defaults.
