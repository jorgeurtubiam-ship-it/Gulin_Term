// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openaichat

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"slices"
	"strings"

	"github.com/gulindev/gulin/pkg/aiusechat/aiutil"
	"github.com/gulindev/gulin/pkg/aiusechat/chatstore"
	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/gulinbase"
)

func init() {
	uctypes.NativeMessageUnmarshalers[uctypes.APIType_OpenAIChat] = func(data []byte) (uctypes.GenAIMessage, error) {
		var msg StoredChatMessage
		err := json.Unmarshal(data, &msg)
		if err != nil {
			return nil, err
		}
		return &msg, nil
	}
}

const (
	OpenAIChatDefaultMaxTokens = 4096
)

// appendToLastUserMessage appends text to the last user message in the messages slice
func appendToLastUserMessage(messages []ChatRequestMessage, text string) {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			if len(messages[i].ContentParts) > 0 {
				messages[i].ContentParts = append(messages[i].ContentParts, ChatContentPart{
					Type: "text",
					Text: text,
				})
			} else {
				messages[i].Content += "\n\n" + text
			}
			break
		}
	}
}

// convertToolDefinitions converts Gulin ToolDefinitions to OpenAI format
// Only includes tools whose required capabilities are met
func convertToolDefinitions(gulinTools []uctypes.ToolDefinition, capabilities []string) []ToolDefinition {
	if len(gulinTools) == 0 {
		return nil
	}

	openaiTools := make([]ToolDefinition, 0, len(gulinTools))
	for _, gulinTool := range gulinTools {
		if !gulinTool.HasRequiredCapabilities(capabilities) {
			continue
		}
		openaiTool := ToolDefinition{
			Type: "function",
			Function: ToolFunctionDef{
				Name:        gulinTool.Name,
				Description: gulinTool.Description,
				Parameters:  gulinTool.InputSchema,
			},
		}
		openaiTools = append(openaiTools, openaiTool)
	}
	return openaiTools
}

func sanitizeToolDefinitionsForBridge(tools []ToolDefinition) {
	for i := range tools {
		if tools[i].Function.Parameters != nil {
			delete(tools[i].Function.Parameters, "additionalProperties")
			delete(tools[i].Function.Parameters, "strict")
		}
	}
}

// truncateLargeMessages restricts the byte massive messages (e.g terminal outputs) to prevent payload overload
func truncateLargeMessages(messages []ChatRequestMessage, maxTokens int) []ChatRequestMessage {
	if len(messages) == 0 {
		return messages
	}

	truncMsg := "\n\n... [truncated to prevent payload overload] ..."
	for i := range messages {
		// Truncate plain text content
		if aiutil.EstimateTokens(messages[i].Content) > maxTokens {
			maxCharLen := maxTokens * 4
			if len(messages[i].Content) > maxCharLen {
				messages[i].Content = messages[i].Content[:maxCharLen] + truncMsg
			}
		}
		// Truncate text inside content parts
		if len(messages[i].ContentParts) > 0 {
			for j := range messages[i].ContentParts {
				if messages[i].ContentParts[j].Type == "text" && aiutil.EstimateTokens(messages[i].ContentParts[j].Text) > maxTokens {
					maxCharLen := maxTokens * 4
					if len(messages[i].ContentParts[j].Text) > maxCharLen {
						messages[i].ContentParts[j].Text = messages[i].ContentParts[j].Text[:maxCharLen] + truncMsg
					}
				}
			}
		}
	}
	return messages
}

// getMessageEffectiveTokens calculates the approximate tokens of a message including tools and parts.
func getMessageEffectiveTokens(m ChatRequestMessage) int {
	tokens := aiutil.EstimateTokens(m.Content)
	for _, part := range m.ContentParts {
		tokens += aiutil.EstimateTokens(part.Text)
		if part.ImageUrl != nil {
			tokens += 100 // Estimate for image metadata
		}
	}
	for _, tc := range m.ToolCalls {
		tokens += 50 // Overhead per tool call
		tokens += aiutil.EstimateTokens(tc.Function.Arguments)
	}
	tokens += aiutil.EstimateTokens(m.Name)
	return tokens
}

// limitTotalMessages implements a sliding window to keep the total conversation within token limits.
// It prioritizes the system prompt and the most recent messages.
func limitTotalMessages(messages []ChatRequestMessage, maxTotalTokens int) []ChatRequestMessage {
	if len(messages) <= 1 {
		return messages
	}

	// Preserve system message if it's at the beginning
	var systemMsg *ChatRequestMessage
	startIdx := 0
	if messages[0].Role == "system" {
		systemMsg = &ChatRequestMessage{
			Role:    messages[0].Role,
			Content: messages[0].Content,
		}
		startIdx = 1
	}

	var keptMessages []ChatRequestMessage
	totalTokens := 0
	if systemMsg != nil {
		totalTokens += aiutil.EstimateTokens(systemMsg.Content)
	}

	numUserMsgs := 0
	// Process from newest to oldest
	for i := len(messages) - 1; i >= startIdx; i-- {
		if messages[i].Role == "user" {
			numUserMsgs++
		}

		// Limit to last 1000 user questions (scaled up for large context)
		if numUserMsgs > 1000 {
			break
		}

		msgTokens := getMessageEffectiveTokens(messages[i])
		if totalTokens+msgTokens > maxTotalTokens {
			if len(keptMessages) > 0 {
				break
			}
		}

		keptMessages = append(keptMessages, messages[i])
		totalTokens += msgTokens
	}

	// Reverse keptMessages because we collected from end to start
	slices.Reverse(keptMessages)

	// SAFE HEAD LOGIC: Ensure we don't start with a 'tool' message or an 'assistant' message.
	// We must start with a 'user' message (after the system prompt) to satisfy OpenAI's strict ordering.
	firstUserIdx := -1
	for i, msg := range keptMessages {
		if msg.Role == "user" {
			firstUserIdx = i
			break
		}
	}

	if firstUserIdx != -1 {
		keptMessages = keptMessages[firstUserIdx:]
	} else if len(keptMessages) > 0 {
		// If no user message was found in the truncated window, we shouldn't send anything
		// other than the system prompt to avoid invalid starting roles.
		keptMessages = nil
	}

	var result []ChatRequestMessage
	if systemMsg != nil {
		result = append(result, *systemMsg)
	}
	result = append(result, keptMessages...)
	return result
}

// buildChatHTTPRequest creates an HTTP request for the OpenAI chat completions API
func buildChatHTTPRequest(ctx context.Context, messages []ChatRequestMessage, chatOpts uctypes.GulinChatOpts) (*http.Request, error) {
	opts := chatOpts.Config

	// ... [omitted check for model and endpoint] 
	// Model is required for all providers except azure-legacy (which uses deployment name in URL)
	if opts.Model == "" && opts.Provider != uctypes.AIProvider_AzureLegacy {
		return nil, errors.New("ai:model is required")
	}
	if opts.Endpoint == "" {
		return nil, errors.New("ai:endpoint is required")
	}

	maxTokens := opts.MaxTokens
	if maxTokens <= 0 {
		maxTokens = OpenAIChatDefaultMaxTokens
	}

	finalMessages := messages
	if len(chatOpts.SystemPrompt) > 0 {
		// Optimization for @orchestrate: remove any existing system messages to prevent payload overload
		// and ensure only the minimalist prompt is used.
		if strings.Contains(opts.Model, "@orchestrate") {
			var nonSystemMessages []ChatRequestMessage
			for _, m := range messages {
				if m.Role != "system" {
					nonSystemMessages = append(nonSystemMessages, m)
				}
			}
			messages = nonSystemMessages
		}

		systemMessage := ChatRequestMessage{
			Role:    "system",
			Content: strings.Join(chatOpts.SystemPrompt, "\n\n"),
		}
		finalMessages = append([]ChatRequestMessage{systemMessage}, messages...)
	}

	// injected data
	if chatOpts.TabState != "" {
		appendToLastUserMessage(finalMessages, chatOpts.TabState)
	}
	if chatOpts.PlatformInfo != "" {
		appendToLastUserMessage(finalMessages, "<PlatformInfo>\n"+chatOpts.PlatformInfo+"\n</PlatformInfo>")
	}

	sanitizedMessages := sanitizeOpenAIMessages(finalMessages)

	// For Bridge requests, disable streaming: the Bridge mixes SSE heartbeat with
	// plain JSON final response, which the SSE decoder cannot handle. Without stream=true
	// the Bridge returns clean JSON that our non-streaming fallback handles correctly.
	isBridgeReq := opts.Provider == uctypes.AIProvider_GulinBridge ||
		opts.BridgeProvider != "" ||
		strings.Contains(opts.Endpoint, ":3000") ||
		strings.Contains(opts.Endpoint, ":8090") ||
		strings.Contains(opts.Endpoint, "gulinbridge") ||
		strings.Contains(opts.Endpoint, "localhost:8090")
		
	// Truncate massive messages (e.g terminal outputs, large file attachments)
	// to prevent individual message explosion.
	contextLimit := opts.ContextLimit
	if contextLimit <= 0 {
		contextLimit = 512000 / 4 // 128K tokens
	}
	sanitizedMessages = truncateLargeMessages(sanitizedMessages, contextLimit/8)

	// Apply sliding window to keep the TOTAL context within model limits.
	sanitizedMessages = limitTotalMessages(sanitizedMessages, contextLimit)

	// Re-sanitize after truncation to repair any broken assistant-tool pairing
	// caused by limitTotalMessages cutting messages mid-pair.
	sanitizedMessages = sanitizeOpenAIMessages(sanitizedMessages)

	reqBody := &ChatRequest{
		Messages: sanitizedMessages,
		Stream:   !isBridgeReq, // We only force stream if it's NOT a bridge request. Bridge handles SSE wrapping.
	}
	if !isBridgeReq {
		reqBody.StreamOptions = &ChatStreamOptions{
			IncludeUsage: true,
		}
	}

	// Model is only added to request for non-azure-legacy providers
	if opts.Provider != uctypes.AIProvider_AzureLegacy {
		reqBody.Model = opts.Model
	}

	if aiutil.IsOpenAIReasoningModel(opts.Model) {
		reqBody.MaxCompletionTokens = maxTokens
	} else {
		reqBody.MaxTokens = maxTokens
	}

	// Add tool definitions if tools capability is available and tools exist
	if opts.HasCapability(uctypes.AICapabilityTools) {
		var finalTools []uctypes.ToolDefinition
		toolNames := make(map[string]bool)

		processTool := func(tool uctypes.ToolDefinition) {
			if toolNames[tool.Name] {
				return
			}
			finalTools = append(finalTools, tool)
			toolNames[tool.Name] = true
		}

		for _, tool := range chatOpts.Tools {
			processTool(tool)
		}
		for _, tool := range chatOpts.TabTools {
			processTool(tool)
		}

		if len(finalTools) > 0 {
			reqBody.Tools = convertToolDefinitions(finalTools, opts.Capabilities)
			if isBridgeReq {
				sanitizeToolDefinitionsForBridge(reqBody.Tools)
			}
			reqBody.ToolChoice = "auto"
		}
	}

	if gulinbase.IsDevMode() {
		log.Printf("openaichat: model %s, messages: %d, tools: %d\n", opts.Model, len(messages), len(reqBody.Tools))
	}

	reqBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("error marshaling request: %w", err)
	}

	// Payload guard: if > 5MB, we are likely to fail or be rejected by the provider
	if len(reqBytes) > 5*1024*1024 {
		return nil, fmt.Errorf("request payload too large (%d bytes). please reduce the amount of data or clear chat history.", len(reqBytes))
	}

	// ALWAYS dump the full payload to disk so I can inspect exactly which tools are passed!
	_ = os.WriteFile("bridge_payload.json", reqBytes, 0644)

	if gulinbase.IsDevMode() && (isBridgeReq) {
		bodyStr := string(reqBytes)
		if len(bodyStr) > 2000 {
			bodyStr = bodyStr[:2000] + "...[truncated]"
		}
		log.Printf("openaichat BRIDGE body: %s\n", bodyStr)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, opts.Endpoint, bytes.NewReader(reqBytes))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")

	// Azure OpenAI uses "api-key" header instead of "Authorization: Bearer"
	if opts.Provider == uctypes.AIProvider_Azure || opts.Provider == uctypes.AIProvider_AzureLegacy {
		req.Header.Set("api-key", opts.APIToken)
	} else {
		req.Header.Set("Authorization", "Bearer "+opts.APIToken)
	}

	req.Header.Set("Accept", "text/event-stream")

	// Detect if this is a Gulin Bridge request by URL or provider
	isBridge := opts.Provider == uctypes.AIProvider_Gulin ||
		opts.Provider == uctypes.AIProvider_GulinBridge ||
		strings.Contains(opts.Endpoint, ":8090") ||
		strings.Contains(opts.Endpoint, "gulinbridge")

	if isBridge {
		if chatOpts.ClientId != "" {
			req.Header.Set("X-Gulin-ClientId", chatOpts.ClientId)
		}
		if chatOpts.ChatId != "" {
			req.Header.Set("X-Gulin-ChatId", chatOpts.ChatId)
		}
		req.Header.Set("X-Gulin-Version", gulinbase.GulinVersion)
		req.Header.Set("X-Gulin-APIType", uctypes.APIType_OpenAIChat)
		req.Header.Set("X-Gulin-RequestType", chatOpts.GetGulinRequestType())
		req.Header.Set("X-Gulin-Model", opts.Model)

		// If BridgeProvider is not set, use the current Provider
		bridgeProv := opts.BridgeProvider
		if bridgeProv == "" {
			bridgeProv = opts.Provider
		}
		if bridgeProv != "" {
			req.Header.Set("X-Gulin-BridgeProvider", bridgeProv)
		}
	}

	return req, nil
}

// ConvertAIMessageToStoredChatMessage converts an AIMessage to StoredChatMessage
// These messages are ALWAYS role "user"
func ConvertAIMessageToStoredChatMessage(aiMsg uctypes.AIMessage) (*StoredChatMessage, error) {
	if err := aiMsg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid AIMessage: %w", err)
	}

	hasImages := false
	for _, part := range aiMsg.Parts {
		if strings.HasPrefix(part.MimeType, "image/") {
			hasImages = true
			break
		}
	}

	if hasImages {
		return convertAIMessageMultimodal(aiMsg)
	}
	return convertAIMessageTextOnly(aiMsg)
}

func convertAIMessageTextOnly(aiMsg uctypes.AIMessage) (*StoredChatMessage, error) {
	var textBuilder strings.Builder
	firstText := true
	for _, part := range aiMsg.Parts {
		var partText string

		switch {
		case part.Type == uctypes.AIMessagePartTypeText:
			partText = part.Text

		case part.MimeType == "text/plain":
			textData, err := aiutil.ExtractTextData(part.Data, part.URL)
			if err != nil {
				log.Printf("openaichat: error extracting text data for %s: %v\n", part.FileName, err)
				continue
			}
			partText = aiutil.FormatAttachedTextFile(part.FileName, textData)

		case part.MimeType == "directory":
			if len(part.Data) == 0 {
				log.Printf("openaichat: directory listing part missing data for %s\n", part.FileName)
				continue
			}
			partText = aiutil.FormatAttachedDirectoryListing(part.FileName, string(part.Data))

		default:
			continue
		}

		if partText != "" {
			if !firstText {
				textBuilder.WriteString("\n\n")
			}
			textBuilder.WriteString(partText)
			firstText = false
		}
	}

	return &StoredChatMessage{
		MessageId: aiMsg.MessageId,
		Message: ChatRequestMessage{
			Role:    aiMsg.Role,
			Content: textBuilder.String(),
		},
	}, nil
}

func convertAIMessageMultimodal(aiMsg uctypes.AIMessage) (*StoredChatMessage, error) {
	var contentParts []ChatContentPart
	imageCount := 0
	imageFailCount := 0

	for _, part := range aiMsg.Parts {
		switch {
		case part.Type == uctypes.AIMessagePartTypeText:
			if part.Text != "" {
				contentParts = append(contentParts, ChatContentPart{
					Type: "text",
					Text: part.Text,
				})
			}

		case strings.HasPrefix(part.MimeType, "image/"):
			imageCount++
			imageUrl, err := aiutil.ExtractImageUrl(part.Data, part.URL, part.MimeType)
			if err != nil {
				imageFailCount++
				log.Printf("openaichat: error extracting image URL for %s: %v\n", part.FileName, err)
				continue
			}
			contentParts = append(contentParts, ChatContentPart{
				Type:       "image_url",
				ImageUrl:   &ChatImageUrl{Url: imageUrl},
				FileName:   part.FileName,
				PreviewUrl: part.PreviewUrl,
				MimeType:   part.MimeType,
			})

		case part.MimeType == "text/plain":
			textData, err := aiutil.ExtractTextData(part.Data, part.URL)
			if err != nil {
				log.Printf("openaichat: error extracting text data for %s: %v\n", part.FileName, err)
				continue
			}
			formattedText := aiutil.FormatAttachedTextFile(part.FileName, textData)
			if formattedText != "" {
				contentParts = append(contentParts, ChatContentPart{
					Type: "text",
					Text: formattedText,
				})
			}

		case part.MimeType == "directory":
			if len(part.Data) == 0 {
				log.Printf("openaichat: directory listing part missing data for %s\n", part.FileName)
				continue
			}
			formattedText := aiutil.FormatAttachedDirectoryListing(part.FileName, string(part.Data))
			if formattedText != "" {
				contentParts = append(contentParts, ChatContentPart{
					Type: "text",
					Text: formattedText,
				})
			}

		case part.MimeType == "application/pdf":
			log.Printf("openaichat: PDF attachments are not supported by Chat Completions API, skipping %s\n", part.FileName)
			continue

		default:
			continue
		}
	}

	if len(contentParts) == 0 {
		if imageCount > 0 && imageFailCount == imageCount {
			return nil, fmt.Errorf("all %d image conversions failed", imageCount)
		}
		return nil, errors.New("message has no valid content after processing all parts")
	}

	return &StoredChatMessage{
		MessageId: aiMsg.MessageId,
		Message: ChatRequestMessage{
			Role:         aiMsg.Role,
			ContentParts: contentParts,
		},
	}, nil
}

// ConvertToolResultsToNativeChatMessage converts tool results to OpenAI tool messages
func ConvertToolResultsToNativeChatMessage(toolResults []uctypes.AIToolResult) ([]uctypes.GenAIMessage, error) {
	if len(toolResults) == 0 {
		return nil, nil
	}

	messages := make([]uctypes.GenAIMessage, 0, len(toolResults))
	for _, toolResult := range toolResults {
		var content string
		if toolResult.ErrorText != "" {
			content = fmt.Sprintf("Error: %s", toolResult.ErrorText)
		} else {
			content = toolResult.Text
			// Safety truncation for individual tool results: 256KB
			if len(content) > 256*1024 {
				content = content[:256*1024] + "\n\n... [tool result truncated for length] ..."
			}
		}

		msg := &StoredChatMessage{
			MessageId: toolResult.ToolUseID,
			Message: ChatRequestMessage{
				Role:       "tool",
				ToolCallID: toolResult.ToolUseID,
				Name:       toolResult.ToolName,
				Content:    content,
			},
		}
		messages = append(messages, msg)
	}

	return messages, nil
}

// ConvertAIChatToUIChat converts stored chat to UI format
func ConvertAIChatToUIChat(aiChat uctypes.AIChat) (*uctypes.UIChat, error) {
	uiChat := &uctypes.UIChat{
		ChatId:     aiChat.ChatId,
		APIType:    aiChat.APIType,
		Model:      aiChat.Model,
		APIVersion: aiChat.APIVersion,
		Messages:   make([]uctypes.UIMessage, 0, len(aiChat.NativeMessages)),
	}

	for i, genMsg := range aiChat.NativeMessages {
		if chatMsg, ok := genMsg.(*StoredChatMessage); ok {
			var parts []uctypes.UIMessagePart

			if len(chatMsg.Message.ContentParts) > 0 {
				for _, cp := range chatMsg.Message.ContentParts {
					switch cp.Type {
					case "text":
						if found, part := aiutil.ConvertDataUserFile(cp.Text); found {
							if part != nil {
								parts = append(parts, *part)
							}
						} else {
							parts = append(parts, uctypes.UIMessagePart{
								Type: "text",
								Text: cp.Text,
							})
						}
					case "image_url":
						mimeType := cp.MimeType
						if mimeType == "" {
							mimeType = "image/*"
						}
						parts = append(parts, uctypes.UIMessagePart{
							Type: "data-userfile",
							Data: uctypes.UIMessageDataUserFile{
								FileName:   cp.FileName,
								MimeType:   mimeType,
								PreviewUrl: cp.PreviewUrl,
							},
						})
					}
				}
			} else if chatMsg.Message.Content != "" {
				parts = append(parts, uctypes.UIMessagePart{
					Type: "text",
					Text: chatMsg.Message.Content,
				})
			}
			// ... (tool call logic continues)

			// Add tool calls if present (assistant requesting tool use)
			if len(chatMsg.Message.ToolCalls) > 0 {
				for _, toolCall := range chatMsg.Message.ToolCalls {
					if toolCall.Type != "function" {
						continue
					}

					// Always add tool-use part if we have tool calls, even for UI display
					toolUsePart := uctypes.UIMessagePart{
						Type: "data-tooluse",
						ID:   toolCall.ID,
					}
					if toolCall.ToolUseData != nil {
						toolUsePart.Data = *toolCall.ToolUseData
					} else {
						// Fallback data if ToolUseData is missing
						toolUsePart.Data = uctypes.UIMessageDataToolUse{
							ToolCallId: toolCall.ID,
							ToolName:   toolCall.Function.Name,
							ToolDesc:   "Ejecutando " + toolCall.Function.Name + "...",
							Status:     uctypes.ToolUseStatusPending,
						}
					}
					parts = append(parts, toolUsePart)
				}
			}

			// Tool result messages (role "tool") are not converted to UIMessage
			if chatMsg.Message.Role == "tool" && chatMsg.Message.ToolCallID != "" {
				continue
			}

			// Skip messages with no parts
			if len(parts) == 0 {
				continue
			}

			uiMsg := uctypes.UIMessage{
				ID:    chatMsg.MessageId,
				Role:  chatMsg.Message.Role,
				Parts: parts,
			}

			uiChat.Messages = append(uiChat.Messages, uiMsg)
		} else if aiMsg, ok := genMsg.(*uctypes.AIMessage); ok {
			// Fallback for generic AI messages
			var fallbackParts []uctypes.UIMessagePart
			for _, part := range aiMsg.Parts {
				if part.Type == uctypes.AIMessagePartTypeText {
					fallbackParts = append(fallbackParts, uctypes.UIMessagePart{
						Type: "text",
						Text: part.Text,
					})
				} else if part.Type == uctypes.AIMessagePartTypeFile {
					fallbackParts = append(fallbackParts, uctypes.UIMessagePart{
						Type:      "file",
						URL:       part.URL,
						MediaType: part.MimeType,
						Filename:  part.FileName,
					})
				}
			}
			uiChat.Messages = append(uiChat.Messages, uctypes.UIMessage{
				ID:    aiMsg.MessageId,
				Role:  aiMsg.Role,
				Parts: fallbackParts,
			})
		} else {
			genericMsg := uctypes.ConvertToGenericAIMessage(genMsg)
			if genericMsg != nil {
				uiChat.Messages = append(uiChat.Messages, uctypes.UIMessage{
					ID:    genericMsg.MessageId,
					Role:  genericMsg.Role,
					Parts: []uctypes.UIMessagePart{{Type: "text", Text: genericMsg.GetContent()}},
				})
			} else {
				return nil, fmt.Errorf("message %d: expected *StoredChatMessage or *uctypes.AIMessage, got %T", i, genMsg)
			}
		}
	}

	return uiChat, nil
}

// GetFunctionCallInputByToolCallId searches for a tool call by ID in the chat history
func GetFunctionCallInputByToolCallId(aiChat uctypes.AIChat, toolCallId string) *uctypes.AIFunctionCallInput {
	for _, genMsg := range aiChat.NativeMessages {
		chatMsg, ok := genMsg.(*StoredChatMessage)
		if !ok {
			continue
		}
		idx := chatMsg.Message.FindToolCallIndex(toolCallId)
		if idx == -1 {
			continue
		}
		toolCall := chatMsg.Message.ToolCalls[idx]
		return &uctypes.AIFunctionCallInput{
			CallId:      toolCall.ID,
			Name:        toolCall.Function.Name,
			Arguments:   toolCall.Function.Arguments,
			ToolUseData: toolCall.ToolUseData,
		}
	}
	return nil
}

// UpdateToolUseData updates the ToolUseData for a specific tool call in the chat history
func UpdateToolUseData(chatId string, callId string, newToolUseData uctypes.UIMessageDataToolUse) error {
	chat := chatstore.DefaultChatStore.Get(chatId)
	if chat == nil {
		return fmt.Errorf("chat not found: %s", chatId)
	}

	for _, genMsg := range chat.NativeMessages {
		chatMsg, ok := genMsg.(*StoredChatMessage)
		if !ok {
			continue
		}
		idx := chatMsg.Message.FindToolCallIndex(callId)
		if idx == -1 {
			continue
		}
		updatedMsg := chatMsg.Copy()
		updatedMsg.Message.ToolCalls[idx].ToolUseData = &newToolUseData
		aiOpts := &uctypes.AIOptsType{
			APIType:    chat.APIType,
			Model:      chat.Model,
			APIVersion: chat.APIVersion,
		}
		return chatstore.DefaultChatStore.PostMessage(chatId, aiOpts, updatedMsg)
	}

	return fmt.Errorf("tool call with callId %s not found in chat %s", callId, chatId)
}

func RemoveToolUseCall(chatId string, callId string) error {
	chat := chatstore.DefaultChatStore.Get(chatId)
	if chat == nil {
		return fmt.Errorf("chat not found: %s", chatId)
	}

	for _, genMsg := range chat.NativeMessages {
		chatMsg, ok := genMsg.(*StoredChatMessage)
		if !ok {
			continue
		}
		idx := chatMsg.Message.FindToolCallIndex(callId)
		if idx == -1 {
			continue
		}
		updatedMsg := chatMsg.Copy()
		updatedMsg.Message.ToolCalls = slices.Delete(updatedMsg.Message.ToolCalls, idx, idx+1)
		if len(updatedMsg.Message.ToolCalls) == 0 {
			chatstore.DefaultChatStore.RemoveMessage(chatId, chatMsg.MessageId)
		} else {
			aiOpts := &uctypes.AIOptsType{
				APIType:    chat.APIType,
				Model:      chat.Model,
				APIVersion: chat.APIVersion,
			}
			if err := chatstore.DefaultChatStore.PostMessage(chatId, aiOpts, updatedMsg); err != nil {
				return err
			}
		}
		return nil
	}

	return nil
}

func sanitizeOpenAIMessages(messages []ChatRequestMessage) []ChatRequestMessage {
	if len(messages) == 0 {
		return messages
	}

	// First, map all tool responses in the history
	toolResponses := make(map[string]bool)
	for _, msg := range messages {
		if msg.Role == "tool" && msg.ToolCallID != "" {
			toolResponses[msg.ToolCallID] = true
		}
	}

	var sanitized []ChatRequestMessage
	for i, msg := range messages {
		if msg.Role == "assistant" {
			// Strip thinking/reasoning tags (<think>...</think>, <thought>...</thought>)
			// so that historical CoT is never resent in subsequent turns.
			if msg.Content != "" {
				msg.Content = aiutil.StripThinkingTags(msg.Content)
			}
			for k := range msg.ContentParts {
				if msg.ContentParts[k].Type == "text" && msg.ContentParts[k].Text != "" {
					msg.ContentParts[k].Text = aiutil.StripThinkingTags(msg.ContentParts[k].Text)
				}
			}

			if len(msg.ToolCalls) > 0 {
				// STRICT: Ensure all tool calls in this assistant message have a corresponding tool response later in the list.
				// If not, we STRIP the tool calls from the assistant message to prevent 400 errors.
				allToolResponsesPresent := true
				for _, tc := range msg.ToolCalls {
					if !toolResponses[tc.ID] {
						allToolResponsesPresent = false
						break
					}
				}

				if !allToolResponsesPresent {
					// We don't delete the whole message, just the tool_calls to keep the history flow.
					msg.ToolCalls = nil
				}
			}

			// Skip ANY assistant messages that are completely empty (no text, no tools)
			if msg.Content == "" && len(msg.ContentParts) == 0 && len(msg.ToolCalls) == 0 {
				continue
			}

			sanitized = append(sanitized, msg)
			continue
		}

		// If this is a tool message, ensure its ID was actually called in an assistant message before it
		// (OpenAI is strict about this too, though less common to fail here)
		if msg.Role == "tool" {
			foundCall := false
			for j := 0; j < i; j++ {
				prevMsg := messages[j]
				if prevMsg.Role == "assistant" {
					for _, tc := range prevMsg.ToolCalls {
						if tc.ID == msg.ToolCallID {
							foundCall = true
							break
						}
					}
				}
				if foundCall {
					break
				}
			}
			if !foundCall {
				continue // Skip orphaned tool response
			}
		}

		// Skip ANY assistant messages that are completely empty (no text, no tools)
		if msg.Role == "assistant" && msg.Content == "" && len(msg.ContentParts) == 0 && len(msg.ToolCalls) == 0 {
			continue
		}

		sanitized = append(sanitized, msg)
	}

	return sanitized
}
