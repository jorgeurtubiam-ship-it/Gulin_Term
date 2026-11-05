// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openaichat

import (
	"context"
	"strings"
	"testing"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/web/sse"
)

// TestProcessChatStream_PreservaToolCallsAnteErrorMidStream reproduce el corte
// de MiniMax: el upstream emite la tool call completa y DESPUES manda un chunk
// {"type":"error",...}. Antes del fix, processChatStream devolvia (nil, err) y
// el assistantMsg se perdia: el historial quedaba sin las tool_calls que el
// runtime ya habia ejecutado, el proveedor no veia el pairing y volvia a pedir
// la misma herramienta en bucle hasta el 500 final.
func TestProcessChatStream_PreservaToolCallsAnteErrorMidStream(t *testing.T) {
	const stream = `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"term_run_and_wait","arguments":"{\"command\":\"git log\"}"}}]},"finish_reason":null}]}

data: {"type":"error","error":{"type":"internal_error","message":"Internal server error. Please retry your request.","code":"internal_error","http_code":500}}

`

	ctx := context.Background()
	h := sse.MakeSilentSSEHandlerCh(ctx)
	opts := uctypes.GulinChatOpts{
		ChatId: "test-chat-pairing",
		Config: uctypes.AIOptsType{Model: "MiniMax-M2"},
	}

	stopReason, msg, _ := processChatStream(ctx, strings.NewReader(stream), h, opts, nil)

	if stopReason == nil || stopReason.ErrorType != "stream_api" {
		t.Fatalf("stopReason inesperado: %+v", stopReason)
	}
	if msg == nil {
		t.Fatalf("el assistantMsg se perdio: las tool calls ya ejecutadas no quedaron en el historial")
	}
	if len(msg.Message.ToolCalls) != 1 {
		t.Fatalf("se esperaba 1 tool call preservada, got %d", len(msg.Message.ToolCalls))
	}
	tc := msg.Message.ToolCalls[0]
	if tc.Function.Name != "term_run_and_wait" {
		t.Errorf("nombre de tool call incorrecto: %q", tc.Function.Name)
	}
	if tc.ID != "call_abc" {
		t.Errorf("ID de tool call perdido: %q", tc.ID)
	}
	if tc.Function.Arguments != "{\"command\":\"git log\"}" {
		t.Errorf("argumentos truncados: %q", tc.Function.Arguments)
	}
}

// TestProcessChatStream_DescartaToolCallConArgumentosTruncados verifica que un
// tool_call cortado a mitad de sus argumentos NO se emite (romperia el parseo
// del siguiente turno), pero el texto parcial si se conserva.
func TestProcessChatStream_DescartaToolCallConArgumentosTruncados(t *testing.T) {
	const stream = `data: {"choices":[{"delta":{"content":"Revisando..."}}]}

data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_x","type":"function","function":{"name":"read_text_file","arguments":"{\"filename\":\"/Users/lord"}}]},"finish_reason":null}]}

data: {"type":"error","error":{"type":"internal_error","message":"Internal server error.","code":"internal_error","http_code":500}}

`

	ctx := context.Background()
	h := sse.MakeSilentSSEHandlerCh(ctx)
	opts := uctypes.GulinChatOpts{
		ChatId: "test-chat-truncado",
		Config: uctypes.AIOptsType{Model: "MiniMax-M2"},
	}

	_, msg, err := processChatStream(ctx, strings.NewReader(stream), h, opts, nil)
	if err != nil {
		t.Fatalf("no se debe abortar: hay texto parcial recuperable: %v", err)
	}
	if msg == nil {
		t.Fatalf("se perdio el texto parcial emitido antes del corte")
	}
	if msg.Message.Content != "Revisando..." {
		t.Errorf("texto parcial perdido: %q", msg.Message.Content)
	}
	if len(msg.Message.ToolCalls) != 0 {
		t.Errorf("no se debe emitir una tool call con argumentos invalidos, got %d", len(msg.Message.ToolCalls))
	}
}
