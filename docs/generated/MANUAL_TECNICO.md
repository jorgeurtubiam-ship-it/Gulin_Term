# MANUAL TÉCNICO - GuLiN

## 1. Arquitectura
GuLiN es una aplicación híbrida de escritorio:
- **Backend**: Go (gestión de terminal, procesos, APIs, DBs).
- **Frontend**: Electron + Vite (UI, Chat, Visualización de Brain Map).

## 2. Estructura del Proyecto
- `cmd/`: Código fuente del servidor backend (`gulinsrv`).
- `frontend/`: Código fuente de la interfaz de usuario.
- `pkg/`: Librerías compartidas y lógica de negocio.
- `Taskfile.yml`: Automatización de tareas de desarrollo y build.

## 3. Compilación y Despliegue
- **Modo Desarrollo**: `npm run dev` (requiere `WCLOUD_` variables).
- **Modo Producción**: `npm run build:prod`.
- **Dependencias**: Requiere `sharp` para optimización de imágenes.
