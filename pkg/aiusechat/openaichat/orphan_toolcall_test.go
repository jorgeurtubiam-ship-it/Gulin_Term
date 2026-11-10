package openaichat

import "testing"

// TestSanitizeRepairsOrphanToolCalls verifica la reparacion de tool_calls
// huerfanos: un assistant que declara tool_calls sin sus mensajes role:"tool"
// es la causa determinista del internal_error 500 de MiniMax a mitad de stream.
// El sanitizador debe INYECTAR un role:"tool" sintetico por cada call sin
// respuesta, inmediatamente despues del assistant, en vez de borrar las calls.
func TestSanitizeRepairsOrphanToolCalls(t *testing.T) {
	in := []ChatRequestMessage{
		{Role: "system", Content: "sys"},
		{Role: "user", Content: "explora el proyecto"},
		{Role: "assistant", ToolCalls: []ToolCall{
			{ID: "call_a", Type: "function", Function: ToolFunctionCall{Name: "tokenize", Arguments: `{"text":"Hola mundo, como estas"}`}},
			{ID: "call_b", Type: "function", Function: ToolFunctionCall{Name: "count_chars", Arguments: `{"text":"Hola mundo, como estas"}`}},
			{ID: "call_c", Type: "function", Function: ToolFunctionCall{Name: "reverse", Arguments: `{"text":"Hola mundo, como estas"}`}},
		}},
		// Respuesta SOLO para call_b: a y c quedan huerfanas (turno interrumpido)
		{Role: "tool", ToolCallID: "call_b", Name: "count_chars", Content: "25"},
	}

	got := sanitizeOpenAIMessages(in)

	// 1) Ningun assistant con tool_calls puede quedar sin sus role:"tool".
	for i, msg := range got {
		if msg.Role != "assistant" || len(msg.ToolCalls) == 0 {
			continue
		}
		// Los mensajes siguientes deben cubrir todos los tool_call_id declarados.
		want := map[string]bool{}
		for _, tc := range msg.ToolCalls {
			want[tc.ID] = true
		}
		for j := i + 1; j < len(got) && got[j].Role == "tool"; j++ {
			delete(want, got[j].ToolCallID)
		}
		for id := range want {
			t.Errorf("tool_call %q quedo huerfano tras el sanitizado", id)
		}
	}

	// 2) Las tool_calls NO deben borrarse (se preserva la intencion del turno).
	if len(got) < 3 || got[2].Role != "assistant" || len(got[2].ToolCalls) != 3 {
		t.Fatalf("las tool_calls fueron alteradas: %+v", got)
	}

	// 3) Debe haber 3 mensajes tool (1 real + 2 sinteticos) contiguos al assistant.
	toolCount, synthetic := 0, 0
	for _, msg := range got {
		if msg.Role == "tool" {
			toolCount++
			if msg.Content == "" || msg.ToolCallID == "" {
				t.Errorf("mensaje tool invalido generado: %+v", msg)
			}
			if msg.ToolCallID == "call_a" || msg.ToolCallID == "call_c" {
				synthetic++
			}
		}
	}
	if toolCount != 3 {
		t.Errorf("esperaba 3 mensajes tool (1 real + 2 sinteticos), obtuve %d", toolCount)
	}
	if synthetic != 2 {
		t.Errorf("esperaba 2 results sinteticos, obtuve %d", synthetic)
	}

	// 4) El tool result real no debe ser sobrescrito por uno sintetico.
	for _, msg := range got {
		if msg.Role == "tool" && msg.ToolCallID == "call_b" && msg.Content != "25" {
			t.Errorf("el tool result real fue alterado: %q", msg.Content)
		}
	}
}

// TestSanitizeKeepsValidToolHistory comprueba que un historial valido pasa
// intacto: no debe inyectarse nada cuando todas las calls tienen respuesta.
func TestSanitizeKeepsValidToolHistory(t *testing.T) {
	in := []ChatRequestMessage{
		{Role: "user", Content: "hola"},
		{Role: "assistant", ToolCalls: []ToolCall{
			{ID: "c1", Type: "function", Function: ToolFunctionCall{Name: "f", Arguments: "{}"}},
		}},
		{Role: "tool", ToolCallID: "c1", Name: "f", Content: "ok"},
		{Role: "assistant", Content: "listo"},
	}

	got := sanitizeOpenAIMessages(in)

	if len(got) != len(in) {
		t.Fatalf("historial valido alterado: %d -> %d mensajes", len(in), len(got))
	}
	for i := range in {
		if got[i].Role != in[i].Role || got[i].Content != in[i].Content {
			t.Errorf("mensaje %d alterado: %+v -> %+v", i, in[i], got[i])
		}
	}
}

// TestSanitizeDropsOrphanToolMessage asegura que un tool result sin assistant
// que lo declare se descarta (regla 4).
func TestSanitizeDropsOrphanToolMessage(t *testing.T) {
	in := []ChatRequestMessage{
		{Role: "user", Content: "hola"},
		{Role: "tool", ToolCallID: "fantasma", Content: "resultado sin duenio"},
		{Role: "assistant", Content: "respuesta"},
	}

	got := sanitizeOpenAIMessages(in)

	for _, msg := range got {
		if msg.Role == "tool" {
			t.Errorf("mensaje tool huerfano no fue descartado: %+v", msg)
		}
	}
	if len(got) != 2 {
		t.Errorf("esperaba 2 mensajes, obtuve %d", len(got))
	}
}
