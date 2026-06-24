# Sistema de Auto-Actualización — Gulin Agent

> **Estado actual:** ⚠️ **DESACTIVADO TEMPORALMENTE** (por decisión del desarrollador)
> Fecha de desactivación: 2026-04-04

---

## ¿Qué es el sistema de actualización?

La aplicación **Gulin Agent** (basada en WaveTerm / Electron) utiliza la librería `electron-updater` para gestionar actualizaciones automáticas de la aplicación. Este sistema verifica periódicamente si hay nuevas versiones disponibles, las descarga en segundo plano y notifica al usuario para instalarlas.

---

## Arquitectura del Sistema

### Flujo de actualización

```
App inicia
   │
   ▼
configureAutoUpdater()  [updater.ts]
   │
   ├─► Lee configuración: GetFullConfigCommand()
   │
   ▼
new Updater(settings)
   │
   ├─► Lee canal de actualización (latest / beta) desde app-update.yml
   ├─► Configura autoUpdater de electron-updater
   └─► Suscribe eventos:
         • checking-for-update
         • update-available
         • update-not-available
         • update-downloaded
         • error
   │
   ▼
updater.start()
   │
   ├─► setInterval cada 10 minutos → checkForUpdates(false)
   └─► checkForUpdates(false) inmediato al inicio
```

### Estados posibles (`UpdaterStatus`)

| Estado         | Significado                                             |
|----------------|---------------------------------------------------------|
| `up-to-date`   | La app está en la última versión                        |
| `checking`     | Se está verificando si hay actualizaciones              |
| `downloading`  | Se encontró una actualización y está descargándose      |
| `ready`        | La actualización fue descargada y está lista para instalar |
| `installing`   | Se está instalando la actualización (quit & install)    |
| `error`        | Ocurrió un error durante el proceso                     |

---

## Archivos Clave

### `emain/updater.ts` — Núcleo del sistema

Contiene la clase principal `Updater` y las funciones de control.

**Funciones principales:**

| Función / Método            | Descripción                                                   |
|-----------------------------|---------------------------------------------------------------|
| `configureAutoUpdater()`    | Punto de entrada. Lee settings y crea la instancia `Updater`. |
| `Updater.start()`           | Inicia el intervalo de verificación automática.               |
| `Updater.stop()`            | Detiene el intervalo de verificación.                         |
| `Updater.checkForUpdates(userInput)` | Verifica si hay actualizaciones disponibles.         |
| `Updater.promptToInstallUpdate()` | Muestra un diálogo al usuario para instalar.           |
| `Updater.installUpdate()`   | Ejecuta `autoUpdater.quitAndInstall()` para reiniciar.        |
| `getUpdateChannel(settings)` | Lee el canal de actualización (latest/beta).                 |
| `getResolvedUpdateChannel()` | Retorna el canal resuelto actual.                            |

**Eventos IPC (Electron):**

| Canal IPC                | Dirección        | Descripción                                   |
|--------------------------|------------------|-----------------------------------------------|
| `install-app-update`     | Renderer → Main  | Solicita instalar la actualización disponible |
| `get-app-update-status`  | Renderer → Main  | Consulta el estado actual del updater         |
| `get-updater-channel`    | Renderer → Main  | Consulta el canal de actualización activo     |
| `app-update-status`      | Main → Renderer  | Notifica cambios de estado a todos los tabs   |

---

### `pkg/wconfig/defaultconfig/settings.json` — Configuración por defecto

Define los valores por defecto del sistema de actualización:

```json
{
    "autoupdate:enabled": false,        // ← Actualmente DESACTIVADO
    "autoupdate:installonquit": true,   // Instalar al cerrar la app
    "autoupdate:intervalms": 3600000    // Intervalo de verificación (1 hora)
}
```

### `schema/settings.json` — Esquema JSON de ajustes

Define los tipos y opciones válidas para los ajustes de actualización:

```json
"autoupdate:enabled": { "type": "boolean" },
"autoupdate:intervalms": { "type": "number" },
"autoupdate:installonquit": { "type": "boolean" },
"autoupdate:channel": { "type": "string" }
```

### `emain/emain-menu.ts` — Menú de la aplicación

Contiene la opción de menú **"Check for Updates..."** que ejecuta `updater.checkForUpdates(true)` cuando el usuario lo solicita manualmente.

### `emain/preload.ts` — Puente Renderer/Main

Expone al frontend las funciones del updater via `contextBridge`:

```typescript
onUpdaterStatusChange: (callback) => ipcRenderer.on("app-update-status", ...),
getUpdaterStatus: () => ipcRenderer.sendSync("get-app-update-status"),
getUpdaterChannel: () => ipcRenderer.sendSync("get-updater-channel"),
```

---

## Canales de Actualización

| Canal   | Descripción                                      |
|---------|--------------------------------------------------|
| `latest` | Versiones estables de producción (por defecto)  |
| `beta`  | Versiones beta con funciones en desarrollo       |
| `dev`   | Canal interno (solo en modo desarrollo)          |

El canal se lee desde `app-update.yml` (empaquetado en el binario) y puede ser sobrescrito por el ajuste `autoupdate:channel` del usuario.

---

## Desactivar / Activar el Updater

### Desactivación temporal (actual)

Se realizaron **dos cambios** para desactivar completamente el updater:

#### 1. En la configuración por defecto

**Archivo:** `pkg/wconfig/defaultconfig/settings.json`

```json
// ANTES
"autoupdate:enabled": true

// DESPUÉS (actual)
"autoupdate:enabled": false
```

#### 2. Hard-disable en el código

**Archivo:** `emain/updater.ts` — función `configureAutoUpdater()`

```typescript
export async function configureAutoUpdater() {
    // ← AÑADIDO: Retorno temprano para deshabilitar el updater temporalmente
    console.log("auto-updater is temporarily disabled by developer request");
    return;

    // Código original (inactivo mientras el return esté presente):
    if (isDev()) {
        console.log("skipping auto-updater in dev mode");
        return;
    }
    // ...
}
```

### Re-activación (cuando esté listo)

Para volver a habilitar el updater:

1. **Eliminar el `return` temprano** en `configureAutoUpdater()` en `emain/updater.ts`.
2. **Cambiar** `"autoupdate:enabled"` a `true` en `pkg/wconfig/defaultconfig/settings.json`.

---

## TODO — Trabajo Pendiente

- [ ] Implementar un sistema de actualización propio (sin depender de `electron-updater` y GitHub Releases de WaveTerm original).
- [ ] Configurar el servidor de actualizaciones con el dominio `gulin.dev`.
- [ ] Actualizar `app-update.yml` para apuntar al servidor de Gulin.
- [ ] Definir la estrategia de versioning para los canales `latest` y `beta` de Gulin.
- [ ] Implementar UI de actualización personalizada con el branding de Gulin.
- [ ] Re-activar el updater una vez configurada la infraestructura propia.

---

## Referencias

- **Librería usada:** [`electron-updater`](https://www.electron.build/auto-update) v6.8.x
- **Código fuente:** [`emain/updater.ts`](../emain/updater.ts)
- **Configuración:** [`pkg/wconfig/defaultconfig/settings.json`](../pkg/wconfig/defaultconfig/settings.json)
- **Esquema:** [`schema/settings.json`](../schema/settings.json)
- **Menú:** [`emain/emain-menu.ts`](../emain/emain-menu.ts)
- **Preload bridge:** [`emain/preload.ts`](../emain/preload.ts)
