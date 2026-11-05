// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package minimax

import (
	"strings"
	"sync"
	"sync/atomic"

	"github.com/gulindev/gulin/pkg/aiusechat/anthropic"
	"github.com/gulindev/gulin/pkg/aiusechat/openaichat"
	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
)

// activeDialects recuerda el dialecto realmente usado por cada chat.
//
// Los helpers ConvertAIMessageToNativeChatMessage /
// ConvertToolResultsToNativeChatMessage NO reciben el endpoint en la firma, asi
// que no pueden resolver el dialecto por si mismos. Antes se asumia siempre
// Anthropic, lo que rompia el pairing cuando el modo apuntaba al dialecto
// OpenAI Chat: la tool call se emitia por OpenAI y el turno siguiente se
// reconvertia por Anthropic, el modelo no veia el resultado y volvia a pedir
// la misma tool indefinidamente (bucle infinito de tool calls).
//
// RunChatStep registra aqui el dialecto efectivo y los helpers lo consultan.
var (
	activeDialectsMu sync.RWMutex
	activeDialects   = map[string]string{}
)

// setActiveDialect registra el dialecto efectivo de un chat.
func setActiveDialect(chatId string, dialect string) {
	if chatId == "" {
		return
	}
	activeDialectsMu.Lock()
	defer activeDialectsMu.Unlock()
	activeDialects[chatId] = dialect
}

// getActiveDialect devuelve el dialecto registrado para el chat, o "" si no hay.
func getActiveDialect(chatId string) string {
	activeDialectsMu.RLock()
	defer activeDialectsMu.RUnlock()
	return activeDialects[chatId]
}

// Deteccion de dialecto MiniMax.
//
// MiniMax expone el MISMO modelo por dos APIs distintas:
//
//	Anthropic Messages : <base>/anthropic/v1/messages  -> APIType_AnthropicMessages
//	OpenAI Chat        : <base>/v1/chat/completions     -> APIType_OpenAIChat
//
// Un desajuste entre endpoint y transporte no falla ruidosamente: el request
// sale, el upstream responde 400/404 opaco o devuelve bloques que el backend
// equivocado no sabe convertir (tool calls perdidas, thinking descartado).
// Por eso el dialecto se decide SIEMPRE por el endpoint real, y solo se usa el
// APIType como refuerzo cuando el endpoint no es concluyente.

// isOpenAIDialectEndpoint reporta si el endpoint apunta a OpenAI Chat Completions.
func isOpenAIDialectEndpoint(endpoint string) bool {
	e := strings.ToLower(strings.TrimSpace(endpoint))
	if e == "" {
		return false
	}
	if strings.Contains(e, "/anthropic") {
		return false
	}
	return strings.Contains(e, "/chat/completions") || strings.Contains(e, "/chat/completion")
}

// isAnthropicDialectEndpoint reporta si el endpoint apunta a Anthropic Messages.
func isAnthropicDialectEndpoint(endpoint string) bool {
	e := strings.ToLower(strings.TrimSpace(endpoint))
	return strings.Contains(e, "/anthropic") || strings.Contains(e, "/v1/messages")
}

// resolveDialect decide el transporte a partir del endpoint y, como desempate,
// del APIType ya resuelto.
func resolveDialect(endpoint string, apiType string) string {
	if isOpenAIDialectEndpoint(endpoint) {
		return uctypes.APIType_OpenAIChat
	}
	if isAnthropicDialectEndpoint(endpoint) {
		return uctypes.APIType_AnthropicMessages
	}
	// Endpoint custom (proxy/gateway): manda el APIType explicito.
	if apiType == uctypes.APIType_AnthropicMessages {
		return uctypes.APIType_AnthropicMessages
	}
	if apiType != "" {
		return apiType
	}
	// Sin endpoint ni APIType: MiniMax en Gulin usa por defecto OpenAI Chat.
	return uctypes.APIType_OpenAIChat
}

// convertToolResults despacha la conversion de tool results al dialecto.
func convertToolResults(dialect string, toolResults []uctypes.AIToolResult) (uctypes.GenAIMessage, error) {
	if dialect == uctypes.APIType_AnthropicMessages {
		msg, err := anthropic.ConvertToolResultsToAnthropicChatMessage(toolResults)
		if err != nil {
			return nil, err
		}
		return msg, nil
	}
	msgs, err := openaichat.ConvertToolResultsToNativeChatMessage(toolResults)
	if err != nil {
		return nil, err
	}
	if len(msgs) == 0 {
		return nil, nil
	}
	return msgs[0], nil
}

// lastResolvedDialect guarda el dialecto del ultimo RunChatStep. Sirve de
// fallback para los helpers que no reciben ni chatId ni APIType en la firma
// (ConvertAIMessageToNativeChatMessage / ConvertToolResultsToNativeChatMessage).
var lastResolvedDialect atomic.Value // string

// setLastResolvedDialect registra el dialecto del turno en curso.
func setLastResolvedDialect(dialect string) {
	lastResolvedDialect.Store(dialect)
}

// getLastResolvedDialect devuelve el ultimo dialecto resuelto, o OpenAI Chat si
// aun no se ha ejecutado ningun turno (default en Gulin para MiniMax).
func getLastResolvedDialect() string {
	if v, ok := lastResolvedDialect.Load().(string); ok && v != "" {
		return v
	}
	return uctypes.APIType_OpenAIChat
}

// resolveDialectForChat decide el dialecto para operaciones que no reciben el
// endpoint en la firma (conversion de mensajes almacenados, tool results).
//
// Orden de precedencia:
//  1. dialecto ya registrado por RunChatStep para ese chatId (verdad efectiva)
//  2. aiChat.APIType si viene informado
//  3. ultimo dialecto resuelto por el backend
//  4. Anthropic, dialecto documentado por defecto de MiniMax
//
// El paso 1/3 es el que evita el desajuste OpenAI/Anthropic que rompia el
// pairing de tool calls.
func resolveDialectForChat(chatId string, apiType string) string {
	if d := getActiveDialect(chatId); d != "" {
		return d
	}
	if apiType == uctypes.APIType_OpenAIChat || apiType == uctypes.APIType_AnthropicMessages {
		return apiType
	}
	return getLastResolvedDialect()
}

// convertToolResultsDialect convierte tool results devolviendo todos los
// mensajes generados (openaichat puede emitir varios, anthropic siempre uno).
func convertToolResultsDialect(dialect string, toolResults []uctypes.AIToolResult) ([]uctypes.GenAIMessage, error) {
	if dialect == uctypes.APIType_AnthropicMessages {
		msg, err := anthropic.ConvertToolResultsToAnthropicChatMessage(toolResults)
		if err != nil || msg == nil {
			return nil, err
		}
		return []uctypes.GenAIMessage{msg}, nil
	}
	msgs, err := openaichat.ConvertToolResultsToNativeChatMessage(toolResults)
	if err != nil {
		return nil, err
	}
	out := make([]uctypes.GenAIMessage, 0, len(msgs))
	for _, m := range msgs {
		if m != nil {
			out = append(out, m)
		}
	}
	return out, nil
}

// convertAIMessage despacha la conversion de un AIMessage almacenado al dialecto.
func convertAIMessage(dialect string, message uctypes.AIMessage) (uctypes.GenAIMessage, error) {
	if dialect == uctypes.APIType_AnthropicMessages {
		return anthropic.ConvertAIMessageToAnthropicChatMessage(message)
	}
	return openaichat.ConvertAIMessageToStoredChatMessage(message)
}

// convertAIChatToUIChat despacha la conversion del chat completo al dialecto.
func convertAIChatToUIChat(dialect string, aiChat uctypes.AIChat) (*uctypes.UIChat, error) {
	if dialect == uctypes.APIType_AnthropicMessages {
		return anthropic.ConvertAIChatToUIChat(aiChat)
	}
	return openaichat.ConvertAIChatToUIChat(aiChat)
}
