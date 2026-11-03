// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package minimax implementa el backend de MiniMax.
//
// MiniMax habla el dialecto OpenAI Chat Completions, por lo que todo el
// transporte, streaming y conversion de mensajes se delega a
// pkg/aiusechat/openaichat (mismo patron que deepseek/ y groq/).
//
// La razon de tener un backend propio y no caer en el default de
// openaiCompletionsBackend es que MiniMax necesita tres ajustes de
// configuracion antes de delegar:
//
//  1. ContextLimit: si el modo no declara ai:contextlimit, inferContextLimit
//     resuelve 800000 para la familia minimax. Aqui solo se rellena el hueco
//     cuando llega 0 (por ejemplo, provider forzado desde config).
//  2. MaxTokens: MiniMax emite un reasoning trace largo antes de la respuesta
//     visible. Con el default compartido el turno se corta a mitad del
//     razonamiento. Se aplica un piso propio de 32768.
//  3. Errores mid-stream: cuando el upstream aborta sin emitir texto, el turno
//     queda vacio y el usuario no ve causa. Se traduce a un error legible.
//
// NINGUNO de estos ajustes toca openaichat/ ni afecta a otros providers.
package minimax

import (
	"context"
	"fmt"

	"github.com/gulindev/gulin/pkg/aiusechat/openaichat"
	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/web/sse"
)

const (
	// DefaultContextLimit es el contexto declarado para la familia MiniMax.
	// El limite real del modelo es 1M; se declara 800k para dejar margen al
	// completion budget y no rechazar el payload por exceso.
	DefaultContextLimit = 800000

	// MinReasoningTokens es el piso de max_tokens necesario para que el
	// reasoning trace de MiniMax quepa completo antes de la respuesta visible.
	MinReasoningTokens = 32768
)

// MiniMaxBackend implementa UseChatBackend para la API de MiniMax.
type MiniMaxBackend struct{}

var _ UseChatBackendShape = (*MiniMaxBackend)(nil)

// UseChatBackendShape replica la interfaz de usechat-backend.go para hacer el
// chequeo de compilacion local sin crear un import circular.
type UseChatBackendShape interface {
	RunChatStep(
		ctx context.Context,
		sseHandler *sse.SSEHandlerCh,
		chatOpts uctypes.GulinChatOpts,
		cont *uctypes.GulinContinueResponse,
	) (*uctypes.GulinStopReason, []uctypes.GenAIMessage, *uctypes.RateLimitInfo, error)
}

// applyMiniMaxDefaults rellena los valores que MiniMax necesita y que el
// switch compartido de openaichat no puede conocer.
func applyMiniMaxDefaults(chatOpts *uctypes.GulinChatOpts) {
	if chatOpts.Config.ContextLimit <= 0 {
		chatOpts.Config.ContextLimit = DefaultContextLimit
	}
	if chatOpts.Config.MaxTokens < MinReasoningTokens {
		chatOpts.Config.MaxTokens = MinReasoningTokens
	}
}

func (b *MiniMaxBackend) RunChatStep(
	ctx context.Context,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.GulinChatOpts,
	cont *uctypes.GulinContinueResponse,
) (*uctypes.GulinStopReason, []uctypes.GenAIMessage, *uctypes.RateLimitInfo, error) {
	applyMiniMaxDefaults(&chatOpts)

	stopReason, msgs, rateLimitInfo, err := openaichat.RunChatStep(ctx, sseHandler, chatOpts, cont)

	genMsgs := make([]uctypes.GenAIMessage, 0, len(msgs))
	for _, msg := range msgs {
		genMsgs = append(genMsgs, msg)
	}

	// Turno abortado sin ningun contenido emitido: el usuario veria un chat
	// congelado sin causa. Se devuelve un error explicable.
	if err != nil && len(genMsgs) == 0 {
		return stopReason, genMsgs, rateLimitInfo, fmt.Errorf(
			"minimax: el proveedor aborto el stream antes de emitir contenido "+
				"(contextlimit=%d, maxtokens=%d): %w",
			chatOpts.Config.ContextLimit, chatOpts.Config.MaxTokens, err,
		)
	}

	return stopReason, genMsgs, rateLimitInfo, err
}

func (b *MiniMaxBackend) UpdateToolUseData(chatId string, toolCallId string, toolUseData uctypes.UIMessageDataToolUse) error {
	return openaichat.UpdateToolUseData(chatId, toolCallId, toolUseData)
}

func (b *MiniMaxBackend) RemoveToolUseCall(chatId string, toolCallId string) error {
	return openaichat.RemoveToolUseCall(chatId, toolCallId)
}

func (b *MiniMaxBackend) ConvertToolResultsToNativeChatMessage(toolResults []uctypes.AIToolResult) ([]uctypes.GenAIMessage, error) {
	return openaichat.ConvertToolResultsToNativeChatMessage(toolResults)
}

func (b *MiniMaxBackend) ConvertAIMessageToNativeChatMessage(message uctypes.AIMessage) (uctypes.GenAIMessage, error) {
	return openaichat.ConvertAIMessageToStoredChatMessage(message)
}

func (b *MiniMaxBackend) GetFunctionCallInputByToolCallId(aiChat uctypes.AIChat, toolCallId string) *uctypes.AIFunctionCallInput {
	return openaichat.GetFunctionCallInputByToolCallId(aiChat, toolCallId)
}

func (b *MiniMaxBackend) ConvertAIChatToUIChat(aiChat uctypes.AIChat) (*uctypes.UIChat, error) {
	return openaichat.ConvertAIChatToUIChat(aiChat)
}
