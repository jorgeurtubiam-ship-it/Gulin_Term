// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package minimax

import (
	"strings"
	"sync"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
)

// Problema que resuelve este archivo
//
// La interfaz UseChatBackend (pkg/aiusechat/usechat-backend.go) declara
//
//	ConvertToolResultsToNativeChatMessage(toolResults []uctypes.AIToolResult)
//	ConvertAIMessageToNativeChatMessage(message uctypes.AIMessage)
//
// sin chatId. Sin embargo, MiniMax necesita el dialecto (OpenAI Chat vs
// Anthropic Messages) para convertir correctamente. Si la conversion usa el
// dialecto equivocado, la tool call se emite por un transporte y el turno
// siguiente se reconvierte por el otro: el modelo nunca ve el resultado y
// vuelve a pedir la misma tool -> bucle infinito de tool calls.
//
// La version anterior resolvia esto con un unico `lastResolvedDialect` global.
// Eso funciona con UN chat, pero se rompe con dos sesiones concurrentes: el
// chat A (Anthropic) y el chat B (OpenAI) se pisan el valor global y el
// ultimo que corre RunChatStep gana para todos.
//
// Aqui se mantiene un mapeo toolUseId -> chatId, sembrado en el momento en que
// RunChatStep publica las tool calls. Asi la conversion de tool results puede
// recuperar el chat exacto al que pertenecen los resultados y usar SU dialecto,
// sin cambiar la interfaz compartida (lo que obligaria a tocar openai,
// anthropic, gemini, bedrock, deepseek, groq y openrouter).

var (
	toolCallChatMu sync.RWMutex
	toolCallChat   = map[string]string{}
)

// registerToolCallsForChat asocia cada tool call de un stopReason con el chat
// que las emitio. Se llama desde RunChatStep justo despues de recibir la
// respuesta del proveedor.
func registerToolCallsForChat(chatId string, stopReason *uctypes.GulinStopReason) {
	if chatId == "" || stopReason == nil || len(stopReason.ToolCalls) == 0 {
		return
	}
	toolCallChatMu.Lock()
	defer toolCallChatMu.Unlock()
	for _, tc := range stopReason.ToolCalls {
		id := strings.TrimSpace(tc.ID)
		if id == "" {
			continue
		}
		toolCallChat[id] = chatId
	}
}

// lookupChatForToolResults devuelve el chatId de la primera tool call conocida
// dentro de los resultados. "" si ninguno esta registrado.
func lookupChatForToolResults(toolResults []uctypes.AIToolResult) string {
	if len(toolResults) == 0 {
		return ""
	}
	toolCallChatMu.RLock()
	defer toolCallChatMu.RUnlock()
	for _, tr := range toolResults {
		id := strings.TrimSpace(tr.ToolUseID)
		if id == "" {
			continue
		}
		if chatId, ok := toolCallChat[id]; ok && chatId != "" {
			return chatId
		}
	}
	return ""
}

// forgetChatToolCalls limpia las asociaciones de un chat (fin de turno o
// error). Evita que el mapa crezca sin limite durante sesiones largas.
func forgetChatToolCalls(chatId string) {
	if chatId == "" {
		return
	}
	toolCallChatMu.Lock()
	defer toolCallChatMu.Unlock()
	for id, cid := range toolCallChat {
		if cid == chatId {
			delete(toolCallChat, id)
		}
	}
}
