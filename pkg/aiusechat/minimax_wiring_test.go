// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"testing"

	"github.com/gulindev/gulin/pkg/aiusechat/minimax"
	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
)

// TestInferContextLimitMiniMax verifica que la familia MiniMax reciba el
// contexto propio y no caiga en el return 0 del default.
func TestInferContextLimitMiniMax(t *testing.T) {
	casos := []string{
		"MiniMax-M3.1-Flash",
		"minimax-m3",
		"MiniMax-Text-01",
		"minimax-M2.1",
	}
	for _, modelo := range casos {
		if got := inferContextLimit(modelo); got != minimax.DefaultContextLimit {
			t.Errorf("inferContextLimit(%q) = %d, esperado %d", modelo, got, minimax.DefaultContextLimit)
		}
	}
}

// TestInferContextLimitNoRegresion confirma que los providers existentes
// conservan exactamente su valor tras agregar el case de MiniMax.
func TestInferContextLimitNoRegresion(t *testing.T) {
	casos := map[string]int{
		"claude-sonnet-4-20250514": 200000,
		"gpt-4o":                   128000,
		"gemini-2.5-pro":           1000000,
		"deepseek-chat":            64000,
		"llama-3.3-70b-versatile":  128000,
		"qwen-2.5-coder":           32000,
	}
	for modelo, esperado := range casos {
		if got := inferContextLimit(modelo); got != esperado {
			t.Errorf("REGRESION: inferContextLimit(%q) = %d, esperado %d", modelo, got, esperado)
		}
	}
}

// TestGetProviderFromModelIDMiniMax verifica la deteccion del provider.
func TestGetProviderFromModelIDMiniMax(t *testing.T) {
	if got := getProviderFromModelID("MiniMax-M3.1-Flash", ""); got != uctypes.AIProvider_MiniMax {
		t.Fatalf("provider = %q, esperado %q", got, uctypes.AIProvider_MiniMax)
	}
}

// TestGetProviderFromModelIDNoRegresion confirma que la deteccion existente
// sigue intacta.
func TestGetProviderFromModelIDNoRegresion(t *testing.T) {
	casos := map[string]string{
		"gpt-4o":            "openai",
		"claude-sonnet-4":   "anthropic",
		"gemini-2.5-pro":    "google",
		"deepseek-chat":     "deepseek",
		"llama-3.3-70b":     "meta",
		"mistral-large":     "mistral",
	}
	for modelo, esperado := range casos {
		if got := getProviderFromModelID(modelo, ""); got != esperado {
			t.Errorf("REGRESION: getProviderFromModelID(%q) = %q, esperado %q", modelo, got, esperado)
		}
	}
}

// TestGetBackendMiniMax verifica que el dispatcher devuelva el backend propio
// en lugar del openaiCompletionsBackend generico del default.
func TestGetBackendMiniMax(t *testing.T) {
	backend, err := GetBackend(uctypes.APIType_OpenAIChat, uctypes.AIProvider_MiniMax)
	if err != nil {
		t.Fatalf("GetBackend devolvio error: %v", err)
	}
	if _, ok := backend.(*minimax.MiniMaxBackend); !ok {
		t.Fatalf("backend = %T, esperado *minimax.MiniMaxBackend", backend)
	}
}

// TestGetBackendNoRegresion confirma que el resto de providers no cambian.
func TestGetBackendNoRegresion(t *testing.T) {
	casos := []string{
		uctypes.AIProvider_DeepSeek,
		uctypes.AIProvider_Groq,
		uctypes.AIProvider_OpenRouter,
		"otro-provider", // debe seguir cayendo en el default
	}
	for _, provider := range casos {
		backend, err := GetBackend(uctypes.APIType_OpenAIChat, provider)
		if err != nil {
			t.Errorf("GetBackend(%q) devolvio error: %v", provider, err)
			continue
		}
		if backend == nil {
			t.Errorf("GetBackend(%q) devolvio nil", provider)
		}
	}
}
