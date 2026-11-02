package aiusechat

import (
	"testing"
)

func TestInferContextLimit(t *testing.T) {
	cases := []struct {
		model    string
		expected int
	}{
		{"claude-3-5-sonnet-20241022", 200000},
		{"claude-sonnet-4-20250514", 200000},
		{"claude-3-7-sonnet-20250219", 200000},
		{"claude-3-opus-20240229", 200000},
		{"claude-2.1", 100000},
		{"gpt-4o", 128000},
		{"gpt-4o-mini", 128000},
		{"gpt-4.1", 128000},
		{"gpt-5", 128000},
		{"o3-mini", 128000},
		{"gpt-4-turbo", 32000},
		{"gpt-4", 8192},
		{"o1-preview", 200000},
		{"gemini-1.5-pro", 1000000},
		{"gemini-2.5-flash", 1000000},
		{"gemini-1.0-pro", 32000},
		{"llama-3.3-70b", 128000},
		{"llama-3.1-8b", 128000},
		{"deepseek-chat", 64000},
		{"mistral-large", 32000},
		{"", 0},
		{"model-desconocido-xyz", 0},
	}

	for _, tc := range cases {
		got := inferContextLimit(tc.model)
		if got != tc.expected {
			t.Errorf("inferContextLimit(%q) = %d, expected %d", tc.model, got, tc.expected)
		}
	}
}

func TestInferContextLimitIsCaseInsensitive(t *testing.T) {
	if inferContextLimit("CLAUDE-3-5-SONNET-20241022") != 200000 {
		t.Error("expected case-insensitive model matching")
	}
}
