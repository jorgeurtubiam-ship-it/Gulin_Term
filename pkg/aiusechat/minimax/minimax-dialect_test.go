// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package minimax

import (
	"testing"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
)

// MiniMax publica el mismo modelo por dos dialectos. Un desajuste entre
// endpoint y transporte no falla ruidosamente: pierde tool calls o produce
// errores 400 opacos. Estos tests fijan la tabla de decision.

func TestResolveDialect(t *testing.T) {
	tests := []struct {
		name     string
		endpoint string
		apiType  string
		want     string
	}{
		{
			name:     "anthropic endpoint canonico",
			endpoint: "https://api.minimax.io/anthropic/v1/messages",
			want:     uctypes.APIType_AnthropicMessages,
		},
		{
			name:     "openai endpoint canonico",
			endpoint: "https://api.minimax.io/v1/chat/completions",
			want:     uctypes.APIType_OpenAIChat,
		},
		{
			name:     "openai gana aunque el apitype diga anthropic",
			endpoint: "https://api.minimax.io/v1/chat/completions",
			apiType:  uctypes.APIType_AnthropicMessages,
			want:     uctypes.APIType_OpenAIChat,
		},
		{
			name:     "anthropic gana aunque el apitype diga openai",
			endpoint: "https://api.minimax.io/anthropic/v1/messages",
			apiType:  uctypes.APIType_OpenAIChat,
			want:     uctypes.APIType_AnthropicMessages,
		},
		{
			name:     "endpoint custom respeta apitype anthropic",
			endpoint: "https://gateway.interno/minimax",
			apiType:  uctypes.APIType_AnthropicMessages,
			want:     uctypes.APIType_AnthropicMessages,
		},
		{
			name:     "endpoint custom respeta apitype openai",
			endpoint: "https://gateway.interno/minimax",
			apiType:  uctypes.APIType_OpenAIChat,
			want:     uctypes.APIType_OpenAIChat,
		},
		{
			name: "sin datos usa default openai",
			want: uctypes.APIType_OpenAIChat,
		},
		{
			name:     "sufijo chat/completion singular tambien cuenta",
			endpoint: "https://api.minimax.io/v1/chat/completion",
			want:     uctypes.APIType_OpenAIChat,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveDialect(tc.endpoint, tc.apiType); got != tc.want {
				t.Fatalf("resolveDialect(%q, %q) = %q, want %q", tc.endpoint, tc.apiType, got, tc.want)
			}
		})
	}
}

func TestIsOpenAIDialectEndpoint(t *testing.T) {
	yes := []string{
		"https://api.minimax.io/v1/chat/completions",
		"HTTPS://API.MINIMAX.IO/V1/CHAT/COMPLETIONS",
		"https://proxy.local/openai/v1/chat/completions?x=1",
	}
	for _, e := range yes {
		if !isOpenAIDialectEndpoint(e) {
			t.Fatalf("esperaba dialecto OpenAI para %q", e)
		}
	}
	no := []string{
		"",
		"https://api.minimax.io/anthropic/v1/messages",
		"https://api.minimax.io/anthropic/v1/chat/completions", // /anthropic manda
	}
	for _, e := range no {
		if isOpenAIDialectEndpoint(e) {
			t.Fatalf("NO esperaba dialecto OpenAI para %q", e)
		}
	}
}
