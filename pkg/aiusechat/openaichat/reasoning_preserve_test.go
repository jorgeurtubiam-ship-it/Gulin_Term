package openaichat

import (
	"encoding/json"
	"strings"
	"testing"
)

// MiniMax-M3 exige que el reasoning_content del turno assistant vuelva intacto
// en el siguiente request. Si se pierde, su gateway responde 500 internal_error
// a mitad de la siguiente ronda de tool calls.
func TestChatRequestMessageMarshalReasoningContent(t *testing.T) {
	msg := ChatRequestMessage{
		Role:             "assistant",
		ReasoningContent: "pensando...",
		ToolCalls: []ToolCall{{
			ID:       "call_1",
			Type:     "function",
			Function: ToolFunctionCall{Name: "read_text_file", Arguments: `{"filename":"/tmp/x"}`},
		}},
	}
	b, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var raw map[string]any
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if raw["reasoning_content"] != "pensando..." {
		t.Fatalf("reasoning_content perdido: %s", string(b))
	}
	if _, ok := raw["toolusedata"]; ok {
		t.Fatalf("toolusedata no debe viajar al proveedor: %s", string(b))
	}
	tcs, ok := raw["tool_calls"].([]any)
	if !ok || len(tcs) != 1 {
		t.Fatalf("tool_calls mal serializadas: %s", string(b))
	}
	if strings.Contains(string(b), "\"desc\"") || strings.Contains(string(b), "\"status\"") {
		t.Fatalf("campos internos filtrados: %s", string(b))
	}
}

// Tool calls con argumentos truncados/vacios se normalizan a "{}" para no
// romper el parseo del proveedor en el turno siguiente.
func TestToolCallSanitizesArguments(t *testing.T) {
	for _, in := range []string{"", "   ", "{", `{"a":`} {
		b, err := json.Marshal(ToolCall{ID: "c", Type: "function", Function: ToolFunctionCall{Name: "x", Arguments: in}})
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		if !strings.Contains(string(b), `"arguments":"{}"`) {
			t.Fatalf("arguments no saneado para %q: %s", in, string(b))
		}
	}
	valid := `{"path":"/tmp"}`
	b, _ := json.Marshal(ToolCall{ID: "c", Type: "function", Function: ToolFunctionCall{Name: "x", Arguments: valid}})
	if !strings.Contains(string(b), `{\"path\":\"/tmp\"}`) {
		t.Fatalf("arguments valido alterado: %s", string(b))
	}
}

func TestReasoningContentRoundTrip(t *testing.T) {
	in := `{"role":"assistant","content":"","reasoning_content":"chain","tool_calls":[]}`
	var msg ChatRequestMessage
	if err := json.Unmarshal([]byte(in), &msg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if msg.ReasoningContent != "chain" {
		t.Fatalf("reasoning_content no deserializado: %+v", msg)
	}
}
