// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openaichat

import (
	"testing"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
)

func TestSanitizeOpenAIMessages_NormalizesDeveloperRole(t *testing.T) {
	messages := []ChatRequestMessage{
		{Role: "developer", Content: "Instrucciones de sistema"},
		{Role: "user", Content: "Hola"},
	}

	sanitized := sanitizeOpenAIMessages(messages)
	if len(sanitized) != 2 {
		t.Fatalf("se esperaban 2 mensajes, got %d", len(sanitized))
	}
	if sanitized[0].Role != "system" {
		t.Errorf("role developer debio ser mapeado a system, got %q", sanitized[0].Role)
	}
}

func TestSanitizeOpenAIMessages_DescartesYReparacionRoleVacio(t *testing.T) {
	messages := []ChatRequestMessage{
		{Role: "", Content: ""},                               // vacio total -> descartar
		{Role: "", Content: "Mensaje de usuario recuperado"}, // vacio con contenido -> user
		{Role: "user", Content: "Hola"},
	}

	sanitized := sanitizeOpenAIMessages(messages)
	if len(sanitized) != 2 {
		t.Fatalf("se esperaban 2 mensajes despues de descartar el vacio, got %d", len(sanitized))
	}
	if sanitized[0].Role != "user" || sanitized[0].Content != "Mensaje de usuario recuperado" {
		t.Errorf("mensaje con role vacio pero con contenido debio repararse como user: %+v", sanitized[0])
	}
}

func TestOpenAIChatUnmarshaler_FallbackAnthropicPayload(t *testing.T) {
	unmarshaler, ok := uctypes.NativeMessageUnmarshalers[uctypes.APIType_OpenAIChat]
	if !ok {
		t.Fatal("unmarshaler openai-chat no registrado")
	}

	// Payload en formato Anthropic (sin objeto wrapper "message")
	anthropicJSON := `{"messageid":"msg-123","role":"user","content":[{"type":"text","text":"LISTENER_DG config"}]}`
	msg, err := unmarshaler([]byte(anthropicJSON))
	if err != nil {
		t.Fatalf("error unmarshaling Anthropic payload: %v", err)
	}

	storedMsg, ok := msg.(*StoredChatMessage)
	if !ok {
		t.Fatalf("esperado *StoredChatMessage, got %T", msg)
	}
	if storedMsg.Message.Role != "user" {
		t.Errorf("role esperado user, got %q", storedMsg.Message.Role)
	}
	if storedMsg.Message.Content != "LISTENER_DG config" {
		t.Errorf("content esperado 'LISTENER_DG config', got %q", storedMsg.Message.Content)
	}

	// Payload Anthropic con tool_result
	toolResultJSON := `{"messageid":"tool-456","role":"user","content":[{"type":"tool_result","tool_use_id":"call_abc","content":"salida del comando"}]}`
	toolMsg, err := unmarshaler([]byte(toolResultJSON))
	if err != nil {
		t.Fatalf("error unmarshaling tool_result payload: %v", err)
	}
	storedToolMsg, ok := toolMsg.(*StoredChatMessage)
	if !ok {
		t.Fatalf("esperado *StoredChatMessage, got %T", toolMsg)
	}
	if storedToolMsg.Message.Role != "tool" {
		t.Errorf("role esperado tool, got %q", storedToolMsg.Message.Role)
	}
	if storedToolMsg.Message.ToolCallID != "call_abc" {
		t.Errorf("ToolCallID esperado call_abc, got %q", storedToolMsg.Message.ToolCallID)
	}
	if storedToolMsg.Message.Content != "salida del comando" {
		t.Errorf("content esperado 'salida del comando', got %q", storedToolMsg.Message.Content)
	}
}
