// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openaichat

import (
	"testing"
)

// MiniMax responde 400 "invalid params, invalid role:  (2013)" si algun mensaje
// del payload lleva un role desconocido. Ningun role emitido puede quedar fuera
// del set cerrado de OpenAI.
func TestSanitizeOpenAIMessages_NingunRoleInvalidoSobrevive(t *testing.T) {
	messages := []ChatRequestMessage{
		{Role: "thinking", Content: "razonamiento con rol inventado"},
		{Role: "  User  ", Content: "Hola"},
		{Role: "ai", Content: "respuesta"},
		{Role: "human", Content: "otra pregunta"},
		{Role: "", ToolCallID: "call_1", Content: "resultado"},
		{Role: "assistant", Content: "ok"},
		{Role: "tool", ToolCallID: "call_1", Content: "tool orphan"},
	}

	sanitized := sanitizeOpenAIMessages(messages)
	for i, m := range sanitized {
		if !validOpenAIChatRoles[m.Role] {
			t.Fatalf("mensaje %d sobrevivio con role invalido %q", i, m.Role)
		}
	}
	if len(sanitized) == 0 {
		t.Fatal("no deberia descartar todo el historial")
	}
}

// Un assistant solo-reasoning debe conservarse: MiniMax exige devolver el
// thinking intacto o responde 500 internal_error en el siguiente turno.
func TestSanitizeOpenAIMessages_ConservaReasoningSinTexto(t *testing.T) {
	messages := []ChatRequestMessage{
		{Role: "user", Content: "hola"},
		{Role: "assistant", ReasoningContent: "pense mucho"},
		{Role: "user", Content: "sigue"},
	}

	sanitized := sanitizeOpenAIMessages(messages)
	if len(sanitized) != 3 {
		t.Fatalf("se esperaban 3 mensajes, got %d: %+v", len(sanitized), sanitized)
	}
	if sanitized[1].ReasoningContent != "pense mucho" {
		t.Errorf("se perdio el reasoning_content del assistant")
	}
}

func TestIsTransientStreamError(t *testing.T) {
	casos := map[string]bool{
		"Internal server error. Please retry your request. (internal_error)": true,
		"internal_error":                        true,
		"The server is overloaded":              true,
		"invalid params, invalid role:  (2013)": false,
		"insufficient balance":                  false,
	}
	for texto, esperado := range casos {
		if got := isTransientStreamError(texto); got != esperado {
			t.Errorf("isTransientStreamError(%q) = %v, esperado %v", texto, got, esperado)
		}
	}
}
