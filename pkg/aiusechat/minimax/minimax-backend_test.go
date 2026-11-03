// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package minimax

import (
	"testing"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
)

// TestApplyMiniMaxDefaultsRellenaHuecos verifica que los tres defaults propios
// de MiniMax se apliquen cuando la config llega vacia (provider forzado desde
// config o modo sin ai:contextlimit).
func TestApplyMiniMaxDefaultsRellenaHuecos(t *testing.T) {
	opts := uctypes.GulinChatOpts{}
	opts.Config.Model = "MiniMax-M3.1-Flash"

	applyMiniMaxDefaults(&opts)

	if opts.Config.ContextLimit != DefaultContextLimit {
		t.Fatalf("ContextLimit = %d, esperado %d", opts.Config.ContextLimit, DefaultContextLimit)
	}
	if opts.Config.MaxTokens != MinReasoningTokens {
		t.Fatalf("MaxTokens = %d, esperado %d", opts.Config.MaxTokens, MinReasoningTokens)
	}
}

// TestApplyMiniMaxDefaultsRespetaValoresMayores verifica que el wrapper NO
// degrade una configuracion superior ya declarada por el modo.
func TestApplyMiniMaxDefaultsRespetaValoresMayores(t *testing.T) {
	opts := uctypes.GulinChatOpts{}
	opts.Config.ContextLimit = 1000000
	opts.Config.MaxTokens = 65536

	applyMiniMaxDefaults(&opts)

	if opts.Config.ContextLimit != 1000000 {
		t.Fatalf("ContextLimit fue degradado a %d", opts.Config.ContextLimit)
	}
	if opts.Config.MaxTokens != 65536 {
		t.Fatalf("MaxTokens fue degradado a %d", opts.Config.MaxTokens)
	}
}

// TestDefaultContextLimitCabeEnElModelo asegura que el valor declarado no
// supere el contexto real de 1M de la familia M.
func TestDefaultContextLimitCabeEnElModelo(t *testing.T) {
	const limiteReal = 1000000
	if DefaultContextLimit >= limiteReal {
		t.Fatalf("DefaultContextLimit=%d no deja margen sobre el limite real %d",
			DefaultContextLimit, limiteReal)
	}
}
