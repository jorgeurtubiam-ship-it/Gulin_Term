# Documentación Técnica de GuLiN Terminal

## 1. Introducción
GuLiN Terminal es un ecosistema de inteligencia agéntica diseñado para ingenieros que operan en la frontera de la IA, el Big Data y la infraestructura a gran escala.

## 2. Arquitectura
*   **Frontend**: Basado en Electron/Vite.
*   **Backend**: Desarrollado en Go (`go.mod`).
*   **Framework de UI**: Tsunami (Go + VDom) para micro-apps de terminal.

## 3. Características Principales
*   **Multi-IA**: Orquestador agnóstico de modelos (Ollama, DeepSeek, Claude, etc.).
*   **Memoria (Brain)**: Sistema de memoria persistente con Auto-RAG.
*   **Herramientas**: DB Maestro, Navegador Agéntico, API Manager, Gestión de Infraestructura.
*   **Visualización**: Dashboards dinámicos y mapas de infraestructura.

## 4. Guía para Desarrolladores
*   **Plugins**: Ubicados en `~/.config/gulin-dev/plugins/` (desarrollo) y sincronizados a `~/Library/Application Support/gulin/plugins/` (app).
*   **Framework Tsunami**: Usado para crear herramientas visuales personalizadas.

## 5. Manual de Usuario
*   **Instalación**: `npm install && task build`.
*   **Ejecución**: `task dev`.
*   **AI Shortcuts**: `# + TAB` para predicción de comandos.

---
*Documentación generada automáticamente por GuLiN Agent.*
