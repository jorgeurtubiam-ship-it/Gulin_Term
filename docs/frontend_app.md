# Desarrollo del Frontend (React + Electron)

La interfaz de usuario de GuLiN Agent está construida con tecnologías web modernas, utilizando **React** para la lógica de componentes, **Vite** como empaquetador y **Electron** para la integración con el sistema operativo.

## Organización del DirectorIO `frontend/app`

| Carpeta | Propósito |
| :--- | :--- |
| `frontend/app/aipanel` | Todos los componentes relacionados con el panel de IA, chat y streaming. |
| `frontend/app/view` | Vistas principales de la aplicación (GulinAI, terminales, explorador). |
| `frontend/app/store` | Gestión de estado global mediante **Zustand**. |
| `frontend/app/hook` | Hooks personalizados para interactuar con la API de Go y eventos SSE. |
| `frontend/app/element` | Componentes atómicos reutilizables (botones, inputs, toggles). |
| `frontend/app/monaco` | Configuración del editor de código embebido (Monaco Editor). |

## Gestión de Estado

La aplicación utiliza un enfoque híbrido para el estado:
- **Zustand**: Para el estado global persistente (configuraciones, sesión actual, historial).
- **React Context**: Para estados locales de componentes complejos como el chat.
- **SSE Streams**: El estado de "streaming" se maneja mediante suscripciones que actualizan la UI conforme llegan los chunks del servidor.

## Componentes del Panel de IA (`aipanel`)

El núcleo de la experiencia reside en `aipanel`:
- **`AIPanelMessages`**: Renderiza la lista de mensajes, detectando tipos (texto, error, herramientas).
- **`AiMessage`**: Controla la visualización de un mensaje individual y sus estados de carga.
- **`ToolGroup`**: Agrupa y muestra las ejecuciones de herramientas (ej. bloques de código ejecutados o archivos leídos).
- **`AiInput`**: El campo de texto enriquecido con soporte para adjuntar archivos y menciones.
- **`ModeSelector`**: Permite al usuario alternar entre **PLAN** y **ACT**, enviando el sufijo correspondiente (`@plan` o `@act`) al backend para modificar el comportamiento del agente.
- **`AIContextMenu`**: Proporciona acceso rápido a configuraciones avanzadas como el modelo actual y el límite de **Max Output Tokens** (4k, 16k, 64k).

## Estados de Interacción

La UI refleja dinámicamente el estado del agente:
- **Planning (Modo Plan)**: Indica que la IA está analizando y esperando aprobación para el siguiente paso.
- **Acting (Modo Acción)**: Muestra una ejecución autónoma fluida sin interrupciones de permiso.
- **Waiting for Approval**: Estado crítico donde el frontend detiene el stream de la IA hasta que el usuario confirma o deniega una acción (`tool_call`).

## Comunicación con el Backend

El frontend no contacta directamente con servicios externos. Todo pasa por el servidor local de Go:
- **WSH (Waverterm Shell)**: Un puente RPC optimizado para enviar comandos al backend.
- **SSE Handler**: El frontend se suscribe a `/api/gulin/chat-stream` para recibir actualizaciones de la IA.

## EstilizaciÓN (CSS/SCSS)

Gulin Agent utiliza un sistema de temas basado en **SCSS Variables**:
- `theme.scss`: Define la paleta de colores corporativa, gradientes y animaciones.
- `reset.scss` y `app.scss`: Configuración base y fuentes (Inter).
- **Rich Aesthetics**: Se priorizan efectos modernos como *glassmorphism*, bordes suaves y micro-animaciones en las transiciones de estado de la IA.
