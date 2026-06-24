---
id: ai-models
title: AI Models & Configuration
sidebar_position: 2
---

# AI Models & Configuration

GuLiN Terminal provides native support for multiple AI providers. It acts as a bridge between your local context and powerful language models.

## Supported Providers
- **Local Models (Ollama)**: Recommended for privacy-first operations. Handles embeddings and fast local queries.
- **Anthropic Claude**: For complex reasoning and coding tasks (e.g., `claude-3-5-sonnet`).
- **OpenAI**: Compatible with GPT-4 and GPT-3.5 APIs.
- **Google Gemini**: Native integration with Gemini models.

## Configuration & Fallbacks

Model configuration is handled via the `gulin.config.json` and the `connections.json` service map. GuLiN employs advanced fallback strategies to ensure uninterrupted service:
1. **JSON Parsing Fallbacks**: If an AI provider responds with malformed JSON, GuLiN will strip away the formatting and fall back to plain text parsing.
2. **Streaming Fallbacks**: If a proxy or bridge fails to stream Server-Sent Events (SSE), the engine falls back to a non-streaming monolithic response (`Message` fallback).
3. **Embedding Fallbacks**: If local `Ollama` embedding fails, GuLiN automatically attempts to use `Gemini` as a fallback for RAG indexing.
