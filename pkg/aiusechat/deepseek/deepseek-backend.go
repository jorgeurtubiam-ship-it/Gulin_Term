// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package deepseek

import (
	"context"

	"github.com/gulindev/gulin/pkg/aiusechat/openaichat"
	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/web/sse"
)

// DeepSeekBackend implements UseChatBackend for DeepSeek API
type DeepSeekBackend struct{}

func (b *DeepSeekBackend) RunChatStep(
	ctx context.Context,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.GulinChatOpts,
	cont *uctypes.GulinContinueResponse,
) (*uctypes.GulinStopReason, []uctypes.GenAIMessage, *uctypes.RateLimitInfo, error) {
	// Aplicar límites de tokens dinámicos para DeepSeek
	// Los límites se aplican dentro de openaichat.RunChatStep si detecta el modo,
	// pero aquí podemos forzar o personalizar si es necesario en el futuro.
	
	stopReason, msgs, rateLimitInfo, err := openaichat.RunChatStep(ctx, sseHandler, chatOpts, cont)
	var genMsgs []uctypes.GenAIMessage
	for _, msg := range msgs {
		genMsgs = append(genMsgs, msg)
	}
	return stopReason, genMsgs, rateLimitInfo, err
}

func (b *DeepSeekBackend) UpdateToolUseData(chatId string, toolCallId string, toolUseData uctypes.UIMessageDataToolUse) error {
	return openaichat.UpdateToolUseData(chatId, toolCallId, toolUseData)
}

func (b *DeepSeekBackend) RemoveToolUseCall(chatId string, toolCallId string) error {
	return openaichat.RemoveToolUseCall(chatId, toolCallId)
}

func (b *DeepSeekBackend) ConvertToolResultsToNativeChatMessage(toolResults []uctypes.AIToolResult) ([]uctypes.GenAIMessage, error) {
	return openaichat.ConvertToolResultsToNativeChatMessage(toolResults)
}

func (b *DeepSeekBackend) ConvertAIMessageToNativeChatMessage(message uctypes.AIMessage) (uctypes.GenAIMessage, error) {
	return openaichat.ConvertAIMessageToStoredChatMessage(message)
}

func (b *DeepSeekBackend) GetFunctionCallInputByToolCallId(aiChat uctypes.AIChat, toolCallId string) *uctypes.AIFunctionCallInput {
	return openaichat.GetFunctionCallInputByToolCallId(aiChat, toolCallId)
}

func (b *DeepSeekBackend) ConvertAIChatToUIChat(aiChat uctypes.AIChat) (*uctypes.UIChat, error) {
	return openaichat.ConvertAIChatToUIChat(aiChat)
}
