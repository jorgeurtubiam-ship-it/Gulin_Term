# GuLiN: Manual Técnico

## 1. Arquitectura del Sistema
GuLiN es una aplicación híbrida de escritorio:
- **Frontend**: Desarrollado con Electron, React, TypeScript y Vite. Gestiona la interfaz de usuario, renderizado de componentes, terminales (xterm.js) y la interacción con el usuario.
- **Backend**: Implementado en Go. Actúa como el motor principal: orquestador de comandos, gestor de infraestructura, servidor API para la comunicación con el frontend y gestión de la persistencia (SQLite).

## 2. Dependencias Principales

### Frontend (package.json)
- **Framework**: Electron, React.
- **Terminal**: `xterm.js` y addons (fit, search, webgl).
- **IA**: `@ai-sdk/react`, `ai` (SDK de Vercel).
- **UI**: `tailwindcss`, `floating-ui`, `tanstack-react-table`.

### Backend (go.mod)
- **Framework API**: `gorilla/mux`, `gorilla/websocket`.
- **Bases de Datos**: `mattn/go-sqlite3` (principal), `go-sql-driver/mysql`, `microsoft/go-mssqldb`, `go.mongodb.org/mongo-driver`.
- **IA**: `sashabaranov/go-openai`, `google/generative-ai-go`.
- **Utilidades**: `spf13/cobra` (CLI), `fsnotify` (observador de archivos).

## 3. Estructura del Proyecto (Árbol de Directorios)
```text
/waveterm
├── cmd/             # Puntos de entrada del backend
├── frontend/        # Código fuente de la UI (React/TS)
├── pkg/             # Lógica central del backend (Go)
├── docs/            # Documentación oficial
├── dist/            # Artefactos de build
├── db/              # Esquemas y migraciones de BD
├── scripts/         # Scripts de instalación/sync
└── ...
```

## 4. Instalación
La aplicación se empaqueta mediante `electron-builder`. Al instalarse:
- **Binario**: Instalado en `/Applications/GuLiN.app` (macOS).
- **Configuración**: Se crea `~/.config/gulin/` o `~/Library/Application Support/gulin/` para configuraciones, plugins y la base de datos local `gulin.db`.
- **Plugins**: Se cargan dinámicamente desde el directorio configurado en el `gulin.config.json`.
