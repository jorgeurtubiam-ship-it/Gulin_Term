// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package minimax

import (
	"testing"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
)

// TestDialectPersistenciaOpenAI verifica que, cuando el modo apunta al
// dialecto OpenAI Chat (endpoint /v1/chat/completions con apitype
// anthropic-messages mal declarado), los helpers que NO reciben endpoint en
// la firma usen OpenAI y no Anthropic.
//
// Este es el bug que provocaba el bucle infinito de tool calls: la tool call
// se emitia por OpenAI y el turno siguiente se reconvertia por Anthropic, el
// modelo no veia el resultado y volvia a pedir la misma tool.
func TestDialectPersistenciaOpenAI(t *testing.T) {
	setLastResolvedDialect("")
	setActiveDialect("test-openai-chat", "")

	setLastResolvedDialect(uctypes.APIType_OpenAIChat)
	setActiveDialect("test-openai-chat", uctypes.APIType_OpenAIChat)

	if got := resolveDialectForChat("test-openai-chat", ""); got != uctypes.APIType_OpenAIChat {
		t.Fatalf("resolveDialectForChat(chat registrado) = %q, esperado %q", got, uctypes.APIType_OpenAIChat)
	}
	if got := resolveDialectForChat("", ""); got != uctypes.APIType_OpenAIChat {
		t.Fatalf("resolveDialectForChat(sin chatid) = %q, esperado %q (fallback ultimo resuelto)", got, uctypes.APIType_OpenAIChat)
	}
}

// TestDialectPersistenciaAnthropic verifica el camino inverso.
func TestDialectPersistenciaAnthropic(t *testing.T) {
	setLastResolvedDialect(uctypes.APIType_AnthropicMessages)
	setActiveDialect("test-anthropic", uctypes.APIType_AnthropicMessages)

	if got := resolveDialectForChat("test-anthropic", ""); got != uctypes.APIType_AnthropicMessages {
		t.Fatalf("resolveDialectForChat = %q, esperado %q", got, uctypes.APIType_AnthropicMessages)
	}
}

// TestResolveDialectForChatRespetaAPIType verifica que aiChat.APIType mande
// cuando no hay registro previo para ese chat.
func TestResolveDialectForChatRespetaAPIType(t *testing.T) {
	setLastResolvedDialect(uctypes.APIType_AnthropicMessages)
	if got := resolveDialectForChat("chat-sin-registro", uctypes.APIType_OpenAIChat); got != uctypes.APIType_OpenAIChat {
		t.Fatalf("APIType explicito ignorado: %q", got)
	}
}

// TestResolveDialectForChatDefault verifica que sin ningun dato se use
// OpenAI Chat, el dialecto por defecto en Gulin para MiniMax.
func TestResolveDialectForChatDefault(t *testing.T) {
	setLastResolvedDialect("")
	if got := resolveDialectForChat("", ""); got != uctypes.APIType_OpenAIChat {
		t.Fatalf("default = %q, esperado %q", got, uctypes.APIType_OpenAIChat)
	}
}

// TestResolveDialectEndpointMandaSobreAPIType es el caso real de la config
// del usuario: endpoint OpenAI Chat con ai:apitype anthropic-messages.
// El endpoint DEBE ganar.
func TestResolveDialectEndpointMandaSobreAPIType(t *testing.T) {
	endpoint := "https://api.minimax.io/v1/chat/completions"
	got := resolveDialect(endpoint, uctypes.APIType_AnthropicMessages)
	if got != uctypes.APIType_OpenAIChat {
		t.Fatalf("resolveDialect = %q, esperado %q (el endpoint manda)", got, uctypes.APIType_OpenAIChat)
	}
}

// TestConvertToolResultsDialectNoNil verifica que el despacho OpenAI no
// devuelva entradas nil y que el Anthropic devuelva un unico mensaje.
func TestConvertToolResultsDialectNoNil(t *testing.T) {
	results := []uctypes.AIToolResult{
		{ToolName: "term_get_scrollback", ToolUseID: "call_1", Text: "ok"},
	}
	for _, dialect := range []string{uctypes.APIType_OpenAIChat, uctypes.APIType_AnthropicMessages} {
		msgs, err := convertToolResultsDialect(dialect, results)
		if err != nil {
			t.Fatalf("%s: error inesperado: %v", dialect, err)
		}
		if len(msgs) == 0 {
			t.Fatalf("%s: sin mensajes generados", dialect)
		}
		for i, m := range msgs {
			if m == nil {
				t.Fatalf("%s: mensaje nil en indice %d", dialect, i)
			}
		}
	}
}
