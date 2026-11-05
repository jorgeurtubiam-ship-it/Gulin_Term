// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package minimax implementa el backend de MiniMax.
//
// MiniMax expone DOS dialectos sobre el mismo modelo:
//
//   - Anthropic Messages : <base>/anthropic/v1/messages  (tool_use / reasoning nativo)
//   - OpenAI Chat        : <base>/v1/chat/completions     (function calling)
//
// El transporte, streaming y la conversion de mensajes se resuelven segun el
// APIType ya resuelto por usechat-mode (que lo deriva del endpoint configurado):
//
//   - Dialecto OpenAI     -> se delega a pkg/aiusechat/openaichat
//     (mismo patron que deepseek/ y groq/).
//   - Dialecto Anthropic  -> se delega a pkg/aiusechat/anthropic, que ya maneja
//     bloques thinking, tool_use/tool_result y el pairing estricto.
//
// La razon de tener un backend propio y no caer en el default compartido es que
// MiniMax necesita tres ajustes de configuracion antes de delegar:
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
	"log"
	"strings"

	"github.com/gulindev/gulin/pkg/aiusechat/anthropic"
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

	// MaxReasoningTokens es el techo duro de max_tokens aceptado por la API
	// de MiniMax. Pedir mas provoca un 500 opaco "internal_error" desde su
	// gateway en lugar de un 400 explicativo, asi que nunca se envia mas.
	MaxReasoningTokens = 32768

	// LegacyMaxTokens es el techo de max_tokens de los modelos MiniMax
	// anteriores a la familia M (abab*, text-*). Esos modelos no emiten
	// reasoning trace y su API rechaza valores de 32k con el mismo 500 opaco.
	LegacyMaxTokens = 16384
)

// isLegacyMiniMaxModel reporta si el modelo pertenece a la generacion previa a
// la familia M (abab5.5, abab6, text-01...). Esos modelos tienen un techo de
// max_tokens mucho menor y no soportan reasoning trace.
func isLegacyMiniMaxModel(model string) bool {
	m := strings.ToLower(model)
	if strings.HasPrefix(m, "abab") {
		return true
	}
	return strings.HasPrefix(m, "text-")
}

// maxTokensCeiling devuelve el techo de max_tokens admitido por el modelo.
func maxTokensCeiling(model string) int {
	if isLegacyMiniMaxModel(model) {
		return LegacyMaxTokens
	}
	return MaxReasoningTokens
}

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

	ceiling := maxTokensCeiling(chatOpts.Config.Model)

	// Piso: asegura espacio para el reasoning trace de la familia M.
	floor := MinReasoningTokens
	if isLegacyMiniMaxModel(chatOpts.Config.Model) {
		floor = 0
	}
	if chatOpts.Config.MaxTokens < floor {
		chatOpts.Config.MaxTokens = floor
	}

	// Techo: MiniMax devuelve 500 "internal_error" (sin detalle) cuando
	// max_tokens excede el limite del modelo. Recortamos en lugar de dejar
	// que el turno muera con un error opaco.
	if chatOpts.Config.MaxTokens > ceiling {
		log.Printf("minimax: max_tokens %d excede el techo de %s (%d), recortando\n",
			chatOpts.Config.MaxTokens, chatOpts.Config.Model, ceiling)
		chatOpts.Config.MaxTokens = ceiling
	}
}

func (b *MiniMaxBackend) RunChatStep(
	ctx context.Context,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.GulinChatOpts,
	cont *uctypes.GulinContinueResponse,
) (*uctypes.GulinStopReason, []uctypes.GenAIMessage, *uctypes.RateLimitInfo, error) {
	applyMiniMaxDefaults(&chatOpts)

	// Despacho por dialecto. MiniMax expone el mismo modelo por Anthropic
	// Messages y por OpenAI Chat; usar el transporte equivocado pierde tool
	// calls (el dialecto Anthropic devuelve bloques tool_use que openaichat
	// no entiende, y viceversa).
	useAnthropic := resolveDialect(chatOpts.Config.Endpoint, chatOpts.Config.APIType) == uctypes.APIType_AnthropicMessages

	// Registrar el dialecto efectivo para que los helpers sin endpoint en la
	// firma (conversion de tool results y de mensajes almacenados) usen el
	// mismo transporte. Sin esto, un modo OpenAI Chat convertia las tool calls
	// por Anthropic y el modelo nunca veia el resultado: bucle infinito.
	effectiveDialect := uctypes.APIType_OpenAIChat
	if useAnthropic {
		effectiveDialect = uctypes.APIType_AnthropicMessages
	}
	setActiveDialect(chatOpts.ChatId, effectiveDialect)
	setLastResolvedDialect(effectiveDialect)

	var (
		stopReason    *uctypes.GulinStopReason
		rateLimitInfo *uctypes.RateLimitInfo
		err           error
	)
	genMsgs := []uctypes.GenAIMessage{}

	if useAnthropic {
		var msg uctypes.GenAIMessage
		stopReason, msg, rateLimitInfo, err = anthropic.RunAnthropicChatStep(ctx, sseHandler, chatOpts, cont)
		if msg != nil {
			genMsgs = append(genMsgs, msg)
		}
	} else {
		var msgs []*openaichat.StoredChatMessage
		stopReason, msgs, rateLimitInfo, err = openaichat.RunChatStep(ctx, sseHandler, chatOpts, cont)
		for _, msg := range msgs {
			genMsgs = append(genMsgs, msg)
		}
	}

	// Asociar cada tool call emitida con este chat. La conversion de tool
	// results no recibe chatId en la firma: sin este registro se usaria el
	// dialecto global y dos sesiones concurrentes (una Anthropic y otra
	// OpenAI) se pisarian mutuamente.
	registerToolCallsForChat(chatOpts.ChatId, stopReason)

	// Turno abortado sin ningun contenido emitido: el usuario veria un chat
	// congelado sin causa. Se devuelve un error explicable.
	if err != nil && len(genMsgs) == 0 {
		forgetChatToolCalls(chatOpts.ChatId)
		dialect := "openai-chat"
		if useAnthropic {
			dialect = "anthropic-messages"
		}
		return stopReason, genMsgs, rateLimitInfo, fmt.Errorf(
			"minimax (%s): el proveedor aborto el stream antes de emitir contenido "+
				"(endpoint=%s, contextlimit=%d, maxtokens=%d): %w",
			dialect, chatOpts.Config.Endpoint, chatOpts.Config.ContextLimit, chatOpts.Config.MaxTokens, err,
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
	// Sin chatId en la firma: se recupera el chat dueño de las tool calls
	// (sembrado por registerToolCallsForChat). Si no se conoce, se cae al
	// ultimo dialecto resuelto y, en ultimo termino, a Anthropic.
	chatId := lookupChatForToolResults(toolResults)
	dialect := resolveDialectForChat(chatId, "")
	msgs, err := convertToolResultsDialect(dialect, toolResults)
	if err != nil {
		return nil, err
	}
	return msgs, nil
}

func (b *MiniMaxBackend) ConvertAIMessageToNativeChatMessage(message uctypes.AIMessage) (uctypes.GenAIMessage, error) {
	// AIMessage no transporta APIType: se consulta el dialecto registrado para
	// el chat. Si no hay registro se usa Anthropic, el default documentado.
	dialect := resolveDialectForChat("", "")
	return convertAIMessage(dialect, message)
}

func (b *MiniMaxBackend) GetFunctionCallInputByToolCallId(aiChat uctypes.AIChat, toolCallId string) *uctypes.AIFunctionCallInput {
	dialect := resolveDialectForChat("", aiChat.APIType)
	if dialect == uctypes.APIType_AnthropicMessages {
		return nil
	}
	return openaichat.GetFunctionCallInputByToolCallId(aiChat, toolCallId)
}

func (b *MiniMaxBackend) ConvertAIChatToUIChat(aiChat uctypes.AIChat) (*uctypes.UIChat, error) {
	return convertAIChatToUIChat(resolveDialectForChat("", aiChat.APIType), aiChat)
}
