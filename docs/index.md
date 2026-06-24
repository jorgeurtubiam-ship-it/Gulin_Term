# Documentación de GuLiN Agent

Bienvenido a la documentación oficial de **GuLiN Agent**, un entorno de ingeniería de software de élite potenciado por IA. Este sistema combina la potencia de un backend en Go con una interfaz moderna en Electron/React para proporcionar una experiencia de desarrollo aumentada.

## Guías de Navegación

| Documento | Descripción |
| :--- | :--- |
| [🚀 Arquitectura del Sistema](architecture.md) | Visión general de cómo interactúan los componentes (Electron, Go, AI Bridge). |
| [⚙️ Backend Internals](backend_internal.md) | Detalles técnicos sobre los paquetes de Go, gestión de procesos y archivos. |
| [💻 Frontend App](frontend_app.md) | Guía sobre la estructura de React, componentes UI y gestión de estados. |
| [🤖 Integración de IA](ai_integration.md) | Funcionamiento del Agente, herramientas (tools) y protocolo de comunicación. |
| [🛠️ Guía de Desarrollo](development_flow.md) | Requisitos, construcción y flujo de trabajo para desarrolladores. |
| [📜 Protocolo API](api_protocol.md) | Referencia de eventos SSE y estructuras JSON de comunicación. |

## Conceptos Clave

- **GuLiN Agent**: La interfaz de usuario y el orquestador local.
- **GuLiN Bridge**: El servicio encargado de la comunicación con los LLMs y la gestión de modelos.
- **Tools**: Capacidades extendidas del agente (terminal, lectura de archivos, búsqueda web).
- **SSE (Server-Sent Events)**: El protocolo utilizado para el streaming de respuestas en tiempo real.

---
*Documentación generada automáticamente para GuLiN Agent.*
