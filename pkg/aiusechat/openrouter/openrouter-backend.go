// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openrouter

import (
	"context"

	"github.com/gulindev/gulin/pkg/aiusechat/openaichat"
	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/web/sse"
)

// OpenRouterBackend implements UseChatBackend for OpenRouter API
type OpenRouterBackend struct{}

func (b *OpenRouterBackend) RunChatStep(
	ctx context.Context,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.GulinChatOpts,
	cont *uctypes.GulinContinueResponse,
) (*uctypes.GulinStopReason, []uctypes.GenAIMessage, *uctypes.RateLimitInfo, error) {
	stopReason, msgs, rateLimitInfo, err := openaichat.RunChatStep(ctx, sseHandler, chatOpts, cont)
	var genMsgs []uctypes.GenAIMessage
	for _, msg := range msgs {
		genMsgs = append(genMsgs, msg)
	}
	return stopReason, genMsgs, rateLimitInfo, err
}

func (b *OpenRouterBackend) UpdateToolUseData(chatId string, toolCallId string, toolUseData uctypes.UIMessageDataToolUse) error {
	return openaichat.UpdateToolUseData(chatId, toolCallId, toolUseData)
}

func (b *OpenRouterBackend) RemoveToolUseCall(chatId string, toolCallId string) error {
	return openaichat.RemoveToolUseCall(chatId, toolCallId)
}

func (b *OpenRouterBackend) ConvertToolResultsToNativeChatMessage(toolResults []uctypes.AIToolResult) ([]uctypes.GenAIMessage, error) {
	return openaichat.ConvertToolResultsToNativeChatMessage(toolResults)
}

func (b *OpenRouterBackend) ConvertAIMessageToNativeChatMessage(message uctypes.AIMessage) (uctypes.GenAIMessage, error) {
	return openaichat.ConvertAIMessageToStoredChatMessage(message)
}

func (b *OpenRouterBackend) GetFunctionCallInputByToolCallId(aiChat uctypes.AIChat, toolCallId string) *uctypes.AIFunctionCallInput {
	return openaichat.GetFunctionCallInputByToolCallId(aiChat, toolCallId)
}

func (b *OpenRouterBackend) ConvertAIChatToUIChat(aiChat uctypes.AIChat) (*uctypes.UIChat, error) {
	return openaichat.ConvertAIChatToUIChat(aiChat)
}
