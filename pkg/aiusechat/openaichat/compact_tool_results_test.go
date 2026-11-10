// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openaichat

import (
	"strings"
	"testing"
)

// truncateOversizedToolResults debe recortar un unico tool result gigante y
// dejar intactos los mensajes que no son de herramienta.
func TestTruncateOversizedToolResults(t *testing.T) {
	grande := strings.Repeat("x", 200000)
	msgs := []ChatRequestMessage{
		{Role: "system", Content: grande},
		{Role: "tool", ToolCallID: "call_1", Content: grande},
		{Role: "user", Content: "ok"},
	}
	out := truncateOversizedToolResults(msgs, 1000) // 1000 tokens -> 4000 chars
	if len(out[1].Content) > 4200 {
		t.Fatalf("tool result no truncado: %d chars", len(out[1].Content))
	}
	if !strings.Contains(out[1].Content, "truncado por tamaño") {
		t.Fatalf("falta marcador de truncado")
	}
	if out[2].Content != "ok" {
		t.Fatalf("mensaje no-tool alterado")
	}
}

// compactOldToolResults debe degradar los tool results antiguos y preservar los
// ultimos `hold`, manteniendo el role:"tool" (pairing exigido por MiniMax).
func TestCompactOldToolResultsPreservaPairing(t *testing.T) {
	var msgs []ChatRequestMessage
	for i := 0; i < 10; i++ {
		id := "call_" + string(rune('a'+i))
		msgs = append(msgs, ChatRequestMessage{
			Role: "assistant",
			ToolCalls: []ToolCall{{
				ID:       id,
				Type:     "function",
				Function: ToolFunctionCall{Name: "term_run_and_wait"},
			}},
		})
		msgs = append(msgs, ChatRequestMessage{
			Role:       "tool",
			ToolCallID: id,
			Content:    strings.Repeat("salida", 2000),
		})
	}

	out := compactOldToolResults(msgs, 4)

	toolSeen := 0
	compactados, intactos := 0, 0
	for _, m := range out {
		if m.Role != "tool" {
			continue
		}
		toolSeen++
		if m.ToolCallID == "" {
			t.Fatalf("tool result sin ToolCallID: pairing roto")
		}
		if strings.Contains(m.Content, "salida historica omitida") {
			compactados++
		} else {
			intactos++
		}
	}
	if toolSeen != 10 {
		t.Fatalf("se perdieron tool results: %d", toolSeen)
	}
	if compactados != 6 || intactos != 4 {
		t.Fatalf("compactados=%d intactos=%d, esperado 6/4", compactados, intactos)
	}
}

// El contenido corto no debe tocarse aunque sea antiguo.
func TestCompactOldToolResultsRespetaCortos(t *testing.T) {
	msgs := []ChatRequestMessage{
		{Role: "tool", ToolCallID: "a", Content: "ok"},
		{Role: "tool", ToolCallID: "b", Content: "ok"},
	}
	out := compactOldToolResults(msgs, 1)
	if out[0].Content != "ok" {
		t.Fatalf("contenido corto alterado: %q", out[0].Content)
	}
}
