# Protocolo de Comunicación API y SSE

Gulin Agent utiliza una comunicación asíncrona basada en **Server-Sent Events (SSE)** para el streaming de chat y **JSON-RPC** para comandos inmediatos. El frontend se suscribe a eventos del servidor para actualizar la UI en tiempo real.

## Eventos SSE (Chat Stream)

Ubicación del endpoint: `/api/gulin/chat-stream`

| Tipo de Evento (`type`) | Carga Útil (`payload`) | Descripción |
| :--- | :--- | :--- |
| `AiMsgStart` | `{ "id": "msg_123" }` | Indica el inicio de una nueva respuesta del asistente. |
| `AiMsgText` | `{ "id": "msg_123", "text": "Hola..." }` | Parciales de texto que se van añadiendo al componente de chat. |
| `AiMsgTextEnd` | `{ "id": "msg_123" }` | Notifica que el bloque de texto actual ha terminado. |
| `AiMsgToolCall` | `{ "id": "call_1", "tool": "ls", "args": "..." }` | La IA solicita ejecutar una herramienta. |
| `AiMsgToolResult` | `{ "id": "call_1", "result": "..." }` | El servidor envía el resultado de la herramienta al frontend. |
| `AiMsgFinish` | `{ "id": "msg_123" }` | Indica que la interacción completa para este mensaje ha finalizado. |
| `AiMsgError` | `{ "message": "Error..." }` | Envía un error fatal que interrumpe el flujo actual. |

## Estructura de Mensajes JSON (Bridge)

La comunicación con el GuLiN Bridge sigue el formato estándar de chat pero enriquecido:

### Envío al Bridge
```json
{
  "model": "auto/model",
  "messages": [
    { "role": "user", "content": "Hola" }
  ],
  "tools": [ ... ]
}
```

### Respuesta del Bridge (SSE Chunks)
```json
{
  "choices": [
    {
      "index": 0,
      "delta": { "content": "¡Hola!", "tool_calls": null },
      "finish_reason": null
    }
  ],
  "id": "chatcmpl-123"
}
```

## Protocolo de Finalización

Es **crítico** que cada flujo de streaming termine con un mensaje `AiMsgFinish`. 
- Si el agente solicita una herramienta, se envía el resultado de la herramienta y luego `AiMsgFinish`.
- Si el backend detecta una respuesta vacía o un error de quota, envía `AiMsgError` seguido de `AiMsgFinish` para liberar el bloqueo de la UI en el frontend.

## Verificación de Tipos (Zod)

El frontend utiliza **Zod** para validar cada mensaje recibido por el canal SSE. Cualquier campo adicional no definido en `aitypes.ts` provocará un error de validación (`Type validation failed`). El protocolo actual en `ssehandler.go` ha sido simplificado para garantizar esta compatibilidad.
