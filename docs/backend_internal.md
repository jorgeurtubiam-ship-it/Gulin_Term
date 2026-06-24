# Funcionamiento Interno del Backend (Go)

El backend de GuLiN Agent está escrito en **Go** y se encuentra organizado en el directorio `pkg/`. Sigue una arquitectura modular donde cada paquete tiene una responsabilidad clara.

## Estructura de Paquetes Clave

| Paquete | Descripción |
| :--- | :--- |
| `pkg/web` | Punto de entrada del servidor HTTP/SSE y manejadores de widgets. |
| `pkg/aiusechat` | Lógica central del agente, procesamiento de respuestas de IA y orquestación de herramientas. |
| `pkg/shellexec` | Gestión de comandos de terminal, ejecución remota y local. |
| `pkg/filestore` | Capa de abstracción para el sistema de archivos y almacenamiento persistente. |
| `pkg/wconfig` | Gestión de configuraciones globales y del sistema. |
| `pkg/gulinapp` | Lógica de alto nivel de la aplicación, estado global y servicios internos. |

## El Ciclo de Vida del Agente (`aiusechat`)

El paquete `aiusechat` es el responsable de la "inteligencia" del backend.
1.  **Recepción de Mensajes**: El manejador de chat recibe una solicitud SSE inicial.
2.  **Consulta al Bridge**: El backend Go contacta al GuLiN Bridge con el contexto actual.
3.  **Procesamiento de Chunks**: Los backends específicos (OpenAI, Anthropic, Gemini) procesan el stream de vuelta.
4.  **Ejecución de Herramientas**: Si el chunk indica una `tool_call`, el sistema interrumpe el flujo de texto para ejecutar la herramienta localmente.
5.  **Cierre de Paso**: Una vez que la IA termina de hablar o solicita herramientas, se envía un mensaje `finish` que el frontend utiliza para cerrar el estado de "escribiendo".

## Almacenamiento y Persistencia

- **FileStore**: Ubicado en `pkg/baseds`, este componente centraliza todas las operaciones de disco para evitar conflictos de concurrencia y asegurar la integridad de los datos.
- **SQLite**: Utilizado para historiales de chat, metadatos de archivos y configuraciones dinámicas.

## Sistema de Terminal (`shellexec`)

El backend integra un emulador de terminal capaz de:
- Ejecutar comandos interactivos.
- Capturar la salida estándar (stdout) y de error (stderr) en tiempo real.
- Notificar al frontend sobre cambios en el estado de ejecución de procesos.
- Permitir al agente de IA ejecutar comandos en la terminal como si fuera un usuario.

## Gestión de Tokens y Límites de Salida

El backend controla la longitud de las respuestas mediante la configuración `gulinai:maxoutputtokens`. 

### Limitaciones de Modelos (Gemini)
- **Valores por Defecto**: La mayoría de los modelos tienen un límite de salida de **4,096 tokens**. Intentar forzar valores superiores (16k, 64k) puede causar errores de cuota o de la propia API si el modelo no los soporta (ej. Gemini 3 Flash Preview).
- **Implementación**: El parámetro `MaxTokens` se transmite al SDK del proveedor, pero está sujeto a los límites del nivel de suscripción y el modelo elegido.

## Registro de Auditoría y Telemetría

Cada interacción del agente es registrada para auditoría interna:
- **Metrics**: Se capturan tokens de entrada/salida, uso de herramientas y latencia.
- **Diagnostics**: Los errores de las APIs de proveedores (OpenAI, Anthropic, Google) son capturados y tipificados para facilitar el soporte al usuario.
