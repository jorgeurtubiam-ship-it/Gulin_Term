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
// degrade una configuracion superior ya declarada por el modo, salvo el techo
// duro de max_tokens que impone la API de MiniMax.
func TestApplyMiniMaxDefaultsRespetaValoresMayores(t *testing.T) {
	opts := uctypes.GulinChatOpts{}
	opts.Config.Model = "MiniMax-M3.1-Flash"
	opts.Config.ContextLimit = 1000000
	opts.Config.MaxTokens = 65536

	applyMiniMaxDefaults(&opts)

	if opts.Config.ContextLimit != 1000000 {
		t.Fatalf("ContextLimit fue degradado a %d", opts.Config.ContextLimit)
	}
	if opts.Config.MaxTokens != MaxReasoningTokens {
		t.Fatalf("MaxTokens = %d, esperado techo %d", opts.Config.MaxTokens, MaxReasoningTokens)
	}
}

// TestApplyMiniMaxDefaultsRecortaModeloLegacy verifica que los modelos previos
// a la familia M no reciban el piso de reasoning (32k), que su API rechaza con
// un 500 opaco.
func TestApplyMiniMaxDefaultsRecortaModeloLegacy(t *testing.T) {
	for _, model := range []string{"abab6.5s-chat", "text-01"} {
		opts := uctypes.GulinChatOpts{}
		opts.Config.Model = model
		opts.Config.MaxTokens = MinReasoningTokens

		applyMiniMaxDefaults(&opts)

		if opts.Config.MaxTokens != LegacyMaxTokens {
			t.Fatalf("%s: MaxTokens = %d, esperado %d", model, opts.Config.MaxTokens, LegacyMaxTokens)
		}
	}
}

// TestApplyMiniMaxDefaultsNoBajaPisoFamiliaM verifica que un valor pequeno
// declarado por el modo se eleve al piso de reasoning de la familia M.
func TestApplyMiniMaxDefaultsNoBajaPisoFamiliaM(t *testing.T) {
	opts := uctypes.GulinChatOpts{}
	opts.Config.Model = "MiniMax-M3.1-Flash"
	opts.Config.MaxTokens = 2048

	applyMiniMaxDefaults(&opts)

	if opts.Config.MaxTokens != MinReasoningTokens {
		t.Fatalf("MaxTokens = %d, esperado piso %d", opts.Config.MaxTokens, MinReasoningTokens)
	}
}

// TestMaxTokensCeiling garantiza que el techo nunca supere lo que la API de
// MiniMax acepta sin devolver 500 "internal_error".
func TestMaxTokensCeiling(t *testing.T) {
	// La API de MiniMax admite hasta 524288 (512K) para M3/M3.1-Flash y
	// recomienda 131072 (128K). El techo del codigo no debe superar el maximo
	// absoluto ni quedar por debajo del valor recomendado por el proveedor.
	if MaxReasoningTokens > 524288 {
		t.Fatalf("MaxReasoningTokens=%d excede el maximo conocido de la API", MaxReasoningTokens)
	}
	if MaxReasoningTokens < 131072 {
		t.Fatalf("MaxReasoningTokens=%d esta por debajo del valor recomendado (131072)", MaxReasoningTokens)
	}
	if LegacyMaxTokens >= MaxReasoningTokens {
		t.Fatalf("LegacyMaxTokens=%d deberia ser menor que MaxReasoningTokens=%d", LegacyMaxTokens, MaxReasoningTokens)
	}
	if got := maxTokensCeiling("MiniMax-M3.1-Flash"); got != MaxReasoningTokens {
		t.Fatalf("techo familia M = %d, esperado %d", got, MaxReasoningTokens)
	}
	if got := maxTokensCeiling("abab6.5s-chat"); got != LegacyMaxTokens {
		t.Fatalf("techo legacy = %d, esperado %d", got, LegacyMaxTokens)
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
