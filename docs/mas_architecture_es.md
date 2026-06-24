# Arquitectura Multi-Agente (MAS) de Gulin

Este documento resume la implementación y las decisiones de diseño del Sistema Multi-Agente (MAS) en Gulin Agent, así como la configuración del modelo automático para el ahorro de tokens.

## 1. Arquitectura Orquestador - Experto

El núcleo de Gulin opera bajo un patrón de **Orquestador y Especialistas**:
- **Orquestador (Cerebro Principal):** Es el modelo con el que el usuario interactúa (por ejemplo, DeepSeek o Gemini). Su objetivo es entender el requerimiento, charlar con el usuario, y delegar tareas puramente técnicas. No ejecuta comandos directamente.
- **Agentes Expertos:** Son sesiones efímeras y especializadas (`command_expert`, `web_expert`, `file_expert`, `db_expert`). 

### Beneficios del Aislamiento
El uso de expertos ahorra tokens dramáticamente porque la sesión del experto arranca con un **historial en blanco** (solo conoce la instrucción específica). Esto evita que el modelo procese repetidamente miles de tokens del historial principal de la conversación en cada paso técnico.

## 2. Aislamiento de Historial (SubChatId) y Prevención del Error 400

Para cumplir estrictamente con los protocolos de las APIs (como DeepSeek y OpenAI) y evitar el error `400 Bad Request` ("insufficient tool messages"), el sistema aplica las siguientes reglas de aislamiento:

- **SubChat Efímero:** Cuando se invoca `call_expert`, el experto se ejecuta en un `ChatId` diferente (`expertSubChatId`). Esto impide que los mensajes técnicos de ida y vuelta de las herramientas se filtren al historial principal y rompan el orden esperado por la API (Usuario -> Asistente -> Tool).
- **Inmunidad a Recortes:** Se ha ampliado el límite de retención del historial a 100 mensajes cuando se usan proveedores de tipo *bridge* para asegurar que las llamadas a herramientas y sus resultados nunca queden "cortados" en el envío a la API.

## 3. Visibilidad: Transmisión de Pensamientos (Reasoning)

Dado que los expertos operan de forma aislada e invisible para el historial del Orquestador, se implementó un "puente" de UI mediante eventos SSE:
- A través de los canales `AiMsgReasoningStart` y `AiMsgReasoningDelta`, los "pensamientos" y comandos ejecutados por el experto se retransmiten en tiempo real a la interfaz del usuario.
- El usuario ve un bloque colapsable (tipo "Pensando...") en el chat principal que indica: *"Delegando a Administrador de Sistemas..."*, garantizando visibilidad sin corromper el protocolo del proveedor de IA.

## 4. Modo "Auto" y Optimización de Costos

Para asegurar que Gulin sea lo más económico posible sin sacrificar capacidad:
- **Delegación al Bridge:** Se ha introducido el modelo `"auto"` (`gulinai@auto` en la configuración `gulinai.json`). Al seleccionar esto, Gulin Agent simplemente solicita el modelo "auto" al servidor backend (Gulin Bridge).
- **Inteligencia en el Backend:** Es el Gulin Bridge quien aplica las reglas condicionales para enrutar el tráfico al modelo más barato que pueda resolver la tarea (ej. enviando tareas complejas a DeepSeek-V3 y tareas de terminal a `gpt-4o-mini`).
- **Expertos Automatizados:** Los Agentes Expertos ahora están configurados para usar el modelo `"auto"` por defecto. Esto permite que el Bridge decida qué modelo backend es el idóneo para ejecutar un comando de terminal frente a una búsqueda web, sin tener configuraciones fijadas en código (hardcodeadas) en el cliente.
