---
id: ai-models
title: Modelos de IA y Configuración
sidebar_position: 2
---

# Modelos de IA y Configuración

GuLiN Terminal proporciona soporte nativo para múltiples proveedores de IA. Actúa como un puente entre tu contexto local y potentes modelos de lenguaje.

## Proveedores Soportados
- **Modelos Locales (Ollama)**: Recomendado para operaciones centradas en la privacidad. Maneja embeddings y consultas locales rápidas.
- **Anthropic Claude**: Ideal para razonamiento complejo y tareas de código (ej. `claude-3-5-sonnet`).
- **OpenAI**: Compatible con las APIs de GPT-4 y GPT-3.5.
- **Google Gemini**: Integración nativa con los modelos de Gemini.

## Configuración y Fallbacks (Estrategias de Respaldo)

La configuración de modelos se maneja a través de `gulin.config.json` y el mapa de servicios `connections.json`. GuLiN emplea estrategias de fallback avanzadas para garantizar un servicio ininterrumpido:
1. **Fallbacks de Parseo JSON**: Si un proveedor de IA responde con JSON malformado (frecuente en modelos locales), GuLiN elimina el formato incorrecto y recurre al parseo de texto plano.
2. **Fallbacks de Streaming**: Si un proxy o puente falla al transmitir eventos (SSE), el motor recurre a una respuesta monolítica sin streaming (fallback `Message`).
3. **Fallbacks de Embeddings**: Si falla el generador de embeddings local de `Ollama`, GuLiN intenta automáticamente usar `Gemini` como respaldo para indexar la información en RAG.
