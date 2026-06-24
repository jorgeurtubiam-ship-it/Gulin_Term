# Documentación Técnica: Optimizaciones de IA y Terminal (v2.0.3)

Esta documentación detalla los cambios técnicos realizados para optimizar el rendimiento del agente de IA, la gestión de memoria de chat y el uso de tokens.

---

## 1. Gestión de Historial de Terminal (Contexto)
**Cambio**: Reducción del valor predeterminado de líneas de scrollback leídas del terminal.
- **Archivo**: [`pkg/aiusechat/tools_term.go`](file:///Users/lordzero1/IA_LoRdZeRo/Gulin_Agent/waveterm/pkg/aiusechat/tools_term.go)
- **Implementación**: Se cambió la constante `DefaultCount` de `200` a `20` dentro de la función `parseTermGetScrollbackInput`.
- **Impacto**: Reduce masivamente la inyección de texto irrelevante en el prompt cuando la IA solicita contexto visual del terminal.

## 2. Registro Automático de Comandos (AI History)
**Cambio**: Persistencia de comandos ejecutados por la IA en un archivo de log especializado.
- **Archivo**: [`pkg/aiusechat/tools_term.go`](file:///Users/lordzero1/IA_LoRdZeRo/Gulin_Agent/waveterm/pkg/aiusechat/tools_term.go) en la función `GetTermRunCommandToolDefinition`.
- **Implementación**: Se integró lógica de apertura de archivo (`os.OpenFile` con `O_APPEND`) antes de retornar el resultado de la herramienta `term_run_command`.
- **Ruta del log**: `~/.gulin/ai_history.sh` (utilizando `gulinbase.GetGulinConfigDir()`).
- **Propósito**: Facilitar la auditoría y permitir la visualización de comandos ejecutados en widgets de tipo Editor.

## 3. Ventana de Memoria de Chat (Sliding Window)
**Cambio**: Limitación del número de mensajes previos enviados a la API de la IA.
- **Archivo**: [`frontend/app/view/gulinai/gulinai.tsx`](file:///Users/lordzero1/IA_LoRdZeRo/Gulin_Agent/waveterm/frontend/app/view/gulinai/gulinai.tsx)
- **Implementación**: Se actualizó la constante `slidingWindowSize` de `30` a `8`.
- **Cálculo**: 8 mensajes equivalen aproximadamente a **4 interacciones completas** (4 preguntas del usuario + 4 respuestas de la IA).
- **Ventaja**: Previene el error de "Context window too large" y mantiene los costos operativos bajos.

## 4. Fortificación de Prompts de Sistema
**Cambio**: Modificación de instrucciones base para todos los Agentes Expertos.
- **Archivo**: [`pkg/aiusechat/usechat-prompts.go`](file:///Users/lordzero1/IA_LoRdZeRo/Gulin_Agent/waveterm/pkg/aiusechat/usechat-prompts.go)
- **Actualizaciones**:
    - **No Repetición**: Se añadió la regla `BREVEDAD EXTREMA: NO repitas el output de comandos de terminal en tu respuesta de texto.` a todos los perfiles (`CommandExpert`, `DBExpert`, `FileExpert`, `WebExpert`).
    - **Pragmatismo**: Se prohibieron frases de relleno conversacional (introducciones y conclusiones amigables).
- **Justificación**: Se observó redundancia cuando la IA ejecutaba un comando (el usuario veía el output en el widget del terminal) y luego la IA procedía a copiar el mismo output en el chat. Ahora, la IA se limita a confirmar o analizar brevemente.

---
> [!IMPORTANT]
> Estos cambios son atómicos y afectan a todos los modelos (GPT, Gemini, DeepSeek) ya que se gestionan desde el orquestador principal y los prompts de sistema unificados.
