# Integración de Inteligencia Artificial y Agentes

GuLiN Agent no es solo un chat con un LLM; es un **Agente Autónomo** capaz de interactuar con su entorno mediante un conjunto de herramientas especializadas.

## GuLiN Agent vs. GuLiN Bridge

- **Agente (Local)**: Vive en tu máquina, conoce tus archivos y tiene acceso a tu terminal.
- **Bridge (Remoto/Local)**: Gestiona las credenciales de API y optimiza las llamadas a los modelos para reducir costos y latencia.

## Herramientas del Agente (Tools)

El agente tiene acceso a diversas herramientas definidas en Go (`pkg/aiusechat/tools*.go`). Las más importantes son:

| Herramienta | Descripción |
| :--- | :--- |
| `read_file` | Lee el contenido de un archivo local. |
| `write_file` | Crea o modifica archivos en el disco. |
| `ls` | Lista directorios para explorar la estructura del proyecto. |
| `terminal_run` | Ejecuta comandos en la terminal de GuLiN. |
| `web_search` | Realiza búsquedas en Google/Bing para obtener información actualizada. |
| `screenshot` | Captura la pantalla actual para análisis visual. |

## Flujo de Ejecución de una Tarea

1.  **Input del Usuario**: "Arregla el error de compilación en main.go".
2.  **Planificación**: La IA decide que primero debe leer el archivo. Envía una `tool_call: read_file`.
3.  **Ejecución Silenciosa**: El servidor Go detecta la solicitud, lee el archivo y envía el contenido de vuelta a la IA de forma invisible para el usuario.
4.  **Acción**: Tras analizar el código, la IA envía una `tool_call: write_file` con la corrección.
5.  **Verificación**: La IA puede decidir ejecutar `terminal_run: go build` para confirmar que el error desapareció.
6.  **Respuesta Final**: "He corregido el error en la línea 45 y verificado que el proyecto compila correctamente".

## Modelos de IA Soportados

Gracias a GuLiN Bridge, el agente puede alternar entre:
- **Anthropic Claude 3.5/3.7 Sonnet**: Recomendado para tareas de codificación complejas.
- **OpenAI GPT-4o / o1**: Excelente para razonamiento lógico y orquestación.
- **Google Gemini 1.5/2.0 Flash/Pro**: Ideal por su ventana de contexto masiva.
- **DeepSeek V3**: Una alternativa eficiente y de bajo costo.

> [!NOTE]
> **Límites de Tokens y Cuotas**: Aunque muchos modelos soportan contextos masivos (1M+ tokens), las respuestas (output) están limitadas frecuentemente a **4,096 tokens** por el proveedor. Opciones como 16k o 64k en el menú de GuLiN pueden fallar o estar restringidas según la cuota de la API (especialmente en modelos "Preview" o nivel gratuito).

## Jerarquía de Modelos y Optimización de Costos

GuLiN Agent implementa una estrategia de **Escalación Dinámica** dividida en 4 niveles para maximizar la eficiencia y reducir costos. Cuando el usuario selecciona **"Auto"** en el modelo, el sistema gestiona estos niveles automáticamente.

### Tabla de Niveles de Inteligencia

| Nivel | Rol en GuLiN | Modelo Principal | Disparador (Trigger) |
| :--- | :--- | :--- | :--- |
| **1 (Base)** | Orquestador / Inicial | **Gemini 3.1 Flash Lite** | Contacto inicial y pruebas de comandos básicas ($0.00). |
| **2 (Trouble)** | Escalación | **DeepSeek V3** | Se activa si el usuario comunica un error ("incorrecto", "falló"). |
| **3 (Potencia)** | Experto Técnico | **Claude 3.5 Sonnet** | Se activa para precisión técnica máxima o si el error persiste. |
| **4 (Reserva)** | Último Recurso | **GPT-4o** | Casos extremadamente específicos o fallos en niveles anteriores. |

---

## Modos de Operación (PLAN vs ACT)

GuLiN Agent permite alternar entre dos filosofías de trabajo mediante el selector de modo, manteniendo la eficiencia económica:

### 1. Modo PLAN (Planificación)
- **Objetivo**: Investigar el problema y proponer una solución estructurada.
- **Seguridad**: Todas las herramientas requieren **aprobación manual** del usuario.
- **Costo (Auto)**: Utiliza modelos de **Nivel 1** por defecto ($0.00).

### 2. Modo ACT (Acción)
- **Objetivo**: Resolver el problema de forma autónoma.
- **Autonomía**: Las herramientas se ejecutan con **auto-aprobación**.
- **Costo (Auto)**: También utiliza modelos de **Nivel 1** por defecto, asegurando que la autonomía no implique un gasto mayor.

---

## Seguridad y Control del Usuario (PLAN Mode)

Para garantizar la seguridad del sistema, el modo **PLAN** implementa una capa de intercepción técnica en el backend:

- **Aprobación Obligatoria**: Herramientas críticas como `term_run_command` (Terminal), `write_text_file` y `call_expert` (delegación) detectan el sufijo `@plan` en el modelo configurado.
- **Intercepción**: Si el agente intenta ejecutar una acción en este modo, el servidor Go bloquea la ejecución y envía un estado `needs_approval` al frontend.
- **Confirmación Visual**: El usuario debe presionar **"Aprobar"** para que el comando sea enviado realmente al sistema operativo o base de datos.

## Robustez de la Interfaz y Estabilidad

Se han implementado salvaguardas (null-guards) en toda la cadena de procesamiento para evitar interrupciones de la experiencia (Crashes):

1.  **Protección de Streaming**: Los componentes `AIMessage` y `AIToolUse` ahora validan la existencia de campos `.text`, `.content` y `.data` antes de renderizar, evitando el error `undefined (reading 'text')`.
2.  **Metadatos de Proveedor**: El conversor de mensajes (especialmente Anthropic/Claude) ahora verifica la existencia de `ProviderMetadata` para evitar fallos al procesar firmas de "Thinking".
3.  **Fallback de Modelos**: Si un modelo de nivel superior falla por cuota (429), el sistema está diseñado para intentar el fallback al nivel inferior disponible.

---

## Arquitectura de Agentes Expertos y Escalación

Cuando el **Orquestador** (siempre Nivel 1 en inicio) detecta que una tarea requiere intervención técnica o el usuario indica un fallo, el sistema realiza una transición transparente:

1.  **Detección de Intención**: Analiza palabras clave como "error", "falló", "incorrecto" o "potencia" en el último mensaje del usuario.
2.  **Ascenso de Nivel**: Si se detecta un error, el sistema escala automáticamente al **Nivel 2** (DeepSeek). Si la complejidad aumenta o el error persiste, escala al **Nivel 3** (Claude).
3.  **Memoria Unificada**: Todo el contexto se preserva durante la escalación para evitar repetir pasos innecesarios.

---

## Historial de Mejoras (Abril 2026)

- **Optimización de Costos**: Se desactivó el uso de GPT-4o por defecto en los Agentes Expertos, centralizando el ahorro en Gemini 3.1 Flash Lite.
- **Estabilización de UI**: Corrección masiva de errores de referencia nula en el renderizado de herramientas y streaming de IA.
- **Refuerzo de PLAN**: Implementación de `ToolApproval` faltante en la herramienta `term_run_command`.
