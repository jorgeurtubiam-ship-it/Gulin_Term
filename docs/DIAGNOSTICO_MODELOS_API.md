# Diagnóstico de Modelos y APIs de Gulin Bridge

**Fecha de elaboración:** 2 de abril de 2026  
**Conversación de referencia:** `ffba0e3b-6c75-4b2b-83c0-ab61a59c2238`

---

## Objetivo

Verificar la conectividad real de todos los modelos de lenguaje (LLM) configurados en Gulin Bridge,
utilizando las llaves de API del archivo `.env`, mediante peticiones directas (`curl`) a cada proveedor.

---

## Proveedores y Modelos Configurados

Los modelos se agrupan en los siguientes proveedores:

| Proveedor | Identificador en `.env` | Web Dashboard para Tokens |
|:----------|:------------------------|:--------------------------|
| **Google** (Gemini, Gemma, Imagen, Veo) | `GOOGLE_MASTER_KEY` | [aistudio.google.com](https://aistudio.google.com/) |
| **OpenAI** (GPT-4o, o1, GPT-5.x) | `OPENAI_MASTER_KEY` | [platform.openai.com](https://platform.openai.com/) |
| **Anthropic** (Claude) | `ANTHROPIC_MASTER_KEY` | [console.anthropic.com](https://console.anthropic.com/) |
| **DeepSeek** | `DEEPSEEK_MASTER_KEY` | [platform.deepseek.com](https://platform.deepseek.com/) |

---

## Metodología del Diagnóstico

Se creó el script `test_all_models_verbose.sh` ubicado en:

```
/Users/lordzero1/IA_LoRdZeRo/Gulin_Agent/waveterm/test_all_models_verbose.sh
```

### Funcionamiento del Script

1. Lee las llaves de API desde `/Users/lordzero1/IA_LoRdZeRo/Gulin_Bridge/.env`
2. Lee la lista de modelos de `/Users/lordzero1/IA_LoRdZeRo/Gulin_Bridge/models.json`
3. Para cada modelo detecta el proveedor y usa el endpoint correcto
4. Ejecuta un `curl` enviando el mensaje: **"hola como estas?"**
5. Guarda la respuesta JSON completa en `verbose_models_report.log`

### Endpoints por Proveedor

```bash
# OpenAI
POST https://api.openai.com/v1/chat/completions
Authorization: Bearer $OPENAI_KEY

# DeepSeek
POST https://api.deepseek.com/v1/chat/completions
Authorization: Bearer $DEEPSEEK_KEY

# Anthropic
POST https://api.anthropic.com/v1/messages
x-api-key: $ANTHROPIC_KEY
anthropic-version: 2023-06-01

# Google Gemini
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=$GOOGLE_KEY
```

---

## Resultados del Diagnóstico (2 de Abril 2026)

Se probaron **153 modelos** en total:

| Estado | Cantidad | Descripción |
|:-------|:--------:|:------------|
| ✅ **Operativos** (HTTP 200) | **70** | El modelo respondió correctamente |
| ⚠️ **Sin Cuota** (HTTP 429) | **14** | Límite de tokens o saldo agotado |
| ❌ **Error/No encontrado** (HTTP 404/400/500) | **66** | Modelo no disponible o nombre obsoleto |
| ⏭️ **Saltados** | **3** | Tipo AUTO o proveedor sin configurar |

### Modelos Destacados con HTTP 200

#### DeepSeek ✅
- `deepseek-chat` — **OPERATIVO** ($9.65 USD de saldo disponible)
- `deepseek-reasoner` — **OPERATIVO**

#### OpenAI ✅
- `gpt-4o`, `gpt-4o-mini`, `gpt-4o-2024-11-20`
- `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`
- `gpt-5`, `gpt-5-mini`, `gpt-5-mini-2025-08-07`
- `gpt-5.1`, `gpt-5.2`, `gpt-5.3-chat-latest`, `gpt-5.4`
- `o1-2024-12-17`
- `gpt-3.5-turbo`, `gpt-3.5-turbo-16k`

#### Google ✅ (Capa Gratuita)
- `models/gemma-3-1b-it`, `models/gemma-3-4b-it`, `models/gemma-3-12b-it`, `models/gemma-3-27b-it`
- `models/gemma-3n-e4b-it`, `models/gemma-3n-e2b-it`
- `models/gemini-2.5-flash` (HTTP 200)
- `models/gemini-flash-latest`, `models/gemini-flash-lite-latest`
- `models/gemini-2.5-flash-lite`
- `models/gemini-3.1-flash-lite-preview`
- `models/gemini-3-flash-preview`

#### Google ⚠️ (429 - Cuota Pro agotada)
- `models/gemini-2.5-pro`, `models/gemini-2.0-flash`, `models/gemini-3-pro-preview`
- `models/gemini-3.1-pro-preview`, etc.
- **Solución**: Habilitar pago por uso en [Google AI Studio](https://aistudio.google.com/)

---

## Archivos Generados

| Archivo | Descripción |
|:--------|:------------|
| `verbose_models_report.log` | Respuestas JSON crudas de todos los modelos probados |
| `test_all_models_verbose.sh` | Script de diagnóstico reutilizable |

---

## Cómo Re-ejecutar el Diagnóstico

```bash
cd /Users/lordzero1/IA_LoRdZeRo/Gulin_Agent/waveterm
chmod +x test_all_models_verbose.sh
./test_all_models_verbose.sh
```

Los resultados se actualizarán automáticamente en `verbose_models_report.log`.
