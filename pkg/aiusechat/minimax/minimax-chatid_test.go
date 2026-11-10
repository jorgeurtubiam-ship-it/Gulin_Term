// SPDX-License-Identifier: Apache-2.0

package minimax

import (
	"testing"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
)

// TestToolCallChatIsolation reproduce el bug de concurrencia: dos chats con
// dialectos distintos ejecutan RunChatStep a la vez. La conversion de tool
// results NO recibe chatId, asi que debe recuperar el chat dueño de cada tool
// call y no el dialecto global del ultimo turno.
func TestToolCallChatIsolation(t *testing.T) {
	setLastResolvedDialect("")
	forgetChatToolCalls("chat-openai")
	forgetChatToolCalls("chat-anthropic")

	openaiStop := &uctypes.GulinStopReason{
		ToolCalls: []uctypes.GulinToolCall{{ID: "call_oai_1", Name: "term_run_command"}},
	}
	anthropicStop := &uctypes.GulinStopReason{
		ToolCalls: []uctypes.GulinToolCall{{ID: "call_ant_1", Name: "term_run_command"}},
	}

	setActiveDialect("chat-openai", uctypes.APIType_OpenAIChat)
	setActiveDialect("chat-anthropic", uctypes.APIType_AnthropicMessages)
	registerToolCallsForChat("chat-openai", openaiStop)
	registerToolCallsForChat("chat-anthropic", anthropicStop)

	// El ultimo turno en correr fue el de Anthropic: el global queda en
	// Anthropic. Aun asi, los resultados del chat OpenAI deben resolverse por
	// OpenAI.
	setLastResolvedDialect(uctypes.APIType_AnthropicMessages)

	b := &MiniMaxBackend{}

	openaiResults := []uctypes.AIToolResult{
		{ToolName: "term_run_command", ToolUseID: "call_oai_1", Text: "ok"},
	}
	if got := lookupChatForToolResults(openaiResults); got != "chat-openai" {
		t.Fatalf("lookupChatForToolResults = %q, esperado chat-openai", got)
	}
	if _, err := b.ConvertToolResultsToNativeChatMessage(openaiResults); err != nil {
		t.Fatalf("conversion OpenAI fallo: %v", err)
	}

	anthropicResults := []uctypes.AIToolResult{
		{ToolName: "term_run_command", ToolUseID: "call_ant_1", Text: "ok"},
	}
	if got := lookupChatForToolResults(anthropicResults); got != "chat-anthropic" {
		t.Fatalf("lookupChatForToolResults = %q, esperado chat-anthropic", got)
	}
	if _, err := b.ConvertToolResultsToNativeChatMessage(anthropicResults); err != nil {
		t.Fatalf("conversion Anthropic fallo: %v", err)
	}
}

// TestToolCallChatFallback verifica que sin registro previo se use el ultimo
// dialecto resuelto y, si tampoco hay, OpenAI Chat (default en Gulin para MiniMax).
func TestToolCallChatFallback(t *testing.T) {
	setLastResolvedDialect("")
	forgetChatToolCalls("")
	results := []uctypes.AIToolResult{{ToolUseID: "call_desconocida", Text: "x"}}
	if got := lookupChatForToolResults(results); got != "" {
		t.Fatalf("lookupChatForToolResults = %q, esperado cadena vacia", got)
	}
	if got := resolveDialectForChat("", ""); got != uctypes.APIType_OpenAIChat {
		t.Fatalf("resolveDialectForChat default = %q, esperado %q", got, uctypes.APIType_OpenAIChat)
	}
}

// TestForgetChatToolCalls verifica la limpieza por chat.
func TestForgetChatToolCalls(t *testing.T) {
	forgetChatToolCalls("chat-limpieza")
	registerToolCallsForChat("chat-limpieza", &uctypes.GulinStopReason{
		ToolCalls: []uctypes.GulinToolCall{{ID: "call_limpieza_1"}},
	})
	if got := lookupChatForToolResults([]uctypes.AIToolResult{{ToolUseID: "call_limpieza_1"}}); got != "chat-limpieza" {
		t.Fatalf("registro previo ausente: %q", got)
	}
	forgetChatToolCalls("chat-limpieza")
	if got := lookupChatForToolResults([]uctypes.AIToolResult{{ToolUseID: "call_limpieza_1"}}); got != "" {
		t.Fatalf("forgetChatToolCalls no limpio: %q", got)
	}
}
