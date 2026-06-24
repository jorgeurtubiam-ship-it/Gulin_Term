// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gemini

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/launchdarkly/eventsource"
	"github.com/gulindev/gulin/pkg/aiusechat/aiutil"
	"github.com/gulindev/gulin/pkg/aiusechat/chatstore"
	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/util/utilfn"
	"github.com/gulindev/gulin/pkg/gulinbase"
	"github.com/gulindev/gulin/pkg/web/sse"
)

// ensureAltSse ensures the ?alt=sse query parameter is set on the endpoint
func ensureAltSse(endpoint string) (string, error) {
	parsedURL, err := url.Parse(endpoint)
	if err != nil {
		return "", fmt.Errorf("invalid ai:endpoint URL: %w", err)
	}

	query := parsedURL.Query()
	if query.Get("alt") != "sse" {
		query.Set("alt", "sse")
		parsedURL.RawQuery = query.Encode()
		return parsedURL.String(), nil
	}

	return endpoint, nil
}

func containsFunctionResponse(c GeminiContent) bool {
	for _, part := range c.Parts {
		if part.FunctionResponse != nil {
			return true
		}
	}
	return false
}

func containsFunctionCall(c GeminiContent) bool {
	for _, part := range c.Parts {
		if part.FunctionCall != nil {
			return true
		}
	}
	return false
}

// appendPartToLastUserMessage appends a text part to the last user message in the contents slice
// it skips turns that are strictly tool responses
func appendPartToLastUserMessage(contents []GeminiContent, text string) {
	for i := len(contents) - 1; i >= 0; i-- {
		if contents[i].Role == "user" && !containsFunctionResponse(contents[i]) {
			contents[i].Parts = append(contents[i].Parts, GeminiMessagePart{
				Text: text,
			})
			return
		}
	}
	// If no suitable user turn found, we might need to add one?
	// But usually there is at least one. For safety, do nothing or append to the last one if we must.
}

func truncateGeminiLargeMessages(contents []GeminiContent, contextLimit int, isBridgeReq bool) {
	// Always truncate massive messages (e.g terminal outputs, large file attachments)
	// to prevent context overflow.
	maxTokens := 10000
	if contextLimit > 0 {
		maxTokens = contextLimit / 8 // Allow up to 12.5% for a single massive message
	}
	if isBridgeReq {
		maxTokens = min(maxTokens, 4000) // Stricter for bridge
	}

	for i := range contents {
		content := &contents[i]
		for j := range content.Parts {
			part := &content.Parts[j]
			partTokens := aiutil.EstimateTokens(part.Text)
			if partTokens > maxTokens {
				maxCharLen := maxTokens * 4 // Rough estimate for truncation point
				truncMsg := fmt.Sprintf("\n\n... [TRUNCATED: The content was %d tokens, showing approx first %d. Adjust your output to avoid this.]", partTokens, maxTokens)
				if len(part.Text) > maxCharLen {
					part.Text = part.Text[:maxCharLen] + truncMsg
				}
			}
			if part.FunctionResponse != nil && part.FunctionResponse.Response != nil {
				// Convert to JSON to check length
				bytes, err := json.Marshal(part.FunctionResponse.Response)
				if err == nil {
					respTokens := aiutil.EstimateTokens(string(bytes))
					if respTokens > maxTokens {
						maxCharLen := maxTokens * 4
						truncMsg := fmt.Sprintf("\n\n... [TRUNCATED tool output: %d tokens, showing approx first %d.]", respTokens, maxTokens)
						if len(bytes) > maxCharLen {
							part.FunctionResponse.Response = map[string]interface{}{
								"truncated_output": string(bytes[:maxCharLen]) + truncMsg,
							}
						}
					}
				}
			}
		}
	}
}

// getGeminiMessageEffectiveTokens calculates the approximate tokens of a Gemini message including tools.
func getGeminiMessageEffectiveTokens(c GeminiContent) int {
	tokens := 0
	for _, part := range c.Parts {
		tokens += aiutil.EstimateTokens(part.Text)
		if part.FunctionCall != nil {
			tokens += 50 // Overhead for tool call
			// Estimate args tokens (JSON)
			bytes, _ := json.Marshal(part.FunctionCall.Args)
			tokens += aiutil.EstimateTokens(string(bytes))
		}
		if part.FunctionResponse != nil {
			tokens += 50 // Overhead for tool response
			bytes, _ := json.Marshal(part.FunctionResponse.Response)
			tokens += aiutil.EstimateTokens(string(bytes))
		}
	}
	return tokens
}

// limitGeminiTotalMessages implements a sliding window for Gemini conversations.
func limitGeminiTotalMessages(contents []GeminiContent, maxTotalTokens int, userMsgsLimit int) []GeminiContent {
	if len(contents) <= 2 {
		return contents
	}

	// Si ambos límites son 0, devolver todo sin filtrar
	if maxTotalTokens <= 0 && userMsgsLimit <= 0 {
		return contents
	}

	var kept []GeminiContent
	totalTokens := 0
	numUserMsgs := 0

	// Step 1: Identify and include all pinned messages first to ensure they are never rotated out
	for _, msg := range contents {
		if msg.Pinned {
			totalTokens += getGeminiMessageEffectiveTokens(msg)
		}
	}

	// Step 2: Process from newest to oldest for the sliding window
	for i := len(contents) - 1; i >= 0; i-- {
		msg := contents[i]
		
		// If already pinned, we will include it anyway, but we still need to process it
		// to maintain chronological order and handle pairs.
		if msg.Pinned {
			kept = append(kept, msg)
			continue
		}

		if msg.Role == "user" && !containsFunctionResponse(msg) {
			numUserMsgs++
		}

		// Limit to N user questions (0 = sin límite)
		if userMsgsLimit > 0 && numUserMsgs > userMsgsLimit && !containsFunctionResponse(msg) {
			continue
		}

		msgTokens := getGeminiMessageEffectiveTokens(msg)
		if maxTotalTokens > 0 && totalTokens+msgTokens > maxTotalTokens && len(kept) > 0 && !containsFunctionResponse(msg) {
			continue
		}

		kept = append(kept, msg)
		totalTokens += msgTokens

		// MANDATORY PAIR: if this is a function response, we MUST also include the preceding turn (the model call)
		if containsFunctionResponse(msg) && i > 0 {
			i--
			callMsg := contents[i]
			kept = append(kept, callMsg)
			totalTokens += getGeminiMessageEffectiveTokens(callMsg)
		}
	}

	// Restore chronological order
	slices.Reverse(kept)

	// SAFE HEAD LOGIC: Gemini/OpenAI models generally expect to start with a 'user' message.
	firstUserIdx := -1
	for i := 0; i < len(kept); i++ {
		msg := kept[i]
		if msg.Role == "user" && !containsFunctionResponse(msg) {
			firstUserIdx = i
			break
		}
	}

	if firstUserIdx != -1 {
		kept = kept[firstUserIdx:]
	} else if len(kept) > 0 {
		kept = nil
	}

	return kept
}

// buildGeminiHTTPRequest creates an HTTP request for the Gemini API
func buildGeminiHTTPRequest(ctx context.Context, contents []GeminiContent, chatOpts uctypes.GulinChatOpts) (*http.Request, error) {
	opts := chatOpts.Config

	if opts.Model == "" {
		return nil, errors.New("ai:model is required")
	}
	if opts.APIToken == "" {
		return nil, errors.New("ai:apitoken is required")
	}
	if opts.Endpoint == "" {
		return nil, errors.New("ai:endpoint is required")
	}

	maxTokens := opts.MaxTokens
	if maxTokens <= 0 {
		maxTokens = GeminiDefaultMaxTokens
	}

	// Build request body
	reqBody := &GeminiRequest{
		Contents: contents,
		GenerationConfig: &GeminiGenerationConfig{
			MaxOutputTokens: int32(maxTokens),
			Temperature:     0.7, // Default temperature
		},
	}

	// Map thinking level for Gemini 3+ models
	if opts.ThinkingLevel != "" && strings.Contains(opts.Model, "gemini-3") {
		geminiThinkingLevel := "high"
		if opts.ThinkingLevel == uctypes.ThinkingLevelLow {
			geminiThinkingLevel = "low"
		}
		reqBody.GenerationConfig.ThinkingConfig = &GeminiThinkingConfig{
			ThinkingLevel: geminiThinkingLevel,
		}
	}

	// Add system instruction if provided
	if len(chatOpts.SystemPrompt) > 0 {
		systemText := strings.Join(chatOpts.SystemPrompt, "\n\n")
		reqBody.SystemInstruction = &GeminiContent{
			Parts: []GeminiMessagePart{
				{Text: systemText},
			},
		}
	}

	if len(chatOpts.Tools) > 0 || len(chatOpts.TabTools) > 0 {
		var functionDeclarations []GeminiFunctionDeclaration
		toolNames := make(map[string]bool)

		processTool := func(tool uctypes.ToolDefinition) {
			if toolNames[tool.Name] {
				return
			}
			// Only include tools whose capabilities are met
			if !tool.HasRequiredCapabilities(opts.Capabilities) {
				return
			}
			functionDeclarations = append(functionDeclarations, ConvertToolDefinitionToGemini(tool))
			toolNames[tool.Name] = true
		}

		for _, tool := range chatOpts.Tools {
			processTool(tool)
		}
		for _, tool := range chatOpts.TabTools {
			processTool(tool)
		}

		if len(functionDeclarations) > 0 {
			reqBody.Tools = []GeminiTool{
				{FunctionDeclarations: functionDeclarations},
			}
			reqBody.ToolConfig = &GeminiToolConfig{
				FunctionCallingConfig: &GeminiFunctionCallingConfig{
					Mode: "AUTO",
				},
			}
		}
	}

	// Injected data - append to last user message as separate parts
	if chatOpts.TabState != "" {
		appendPartToLastUserMessage(reqBody.Contents, chatOpts.TabState)
	}
	if chatOpts.PlatformInfo != "" {
		appendPartToLastUserMessage(reqBody.Contents, "<PlatformInfo>\n"+chatOpts.PlatformInfo+"\n</PlatformInfo>")
	}
	if chatOpts.AppStaticFiles != "" {
		appendPartToLastUserMessage(reqBody.Contents, "<CurrentAppStaticFiles>\n"+chatOpts.AppStaticFiles+"\n</CurrentAppStaticFiles>")
	}
	if gulinbase.IsDevMode() {
		var toolNames []string
		if len(reqBody.Tools) > 0 && len(reqBody.Tools[0].FunctionDeclarations) > 0 {
			for _, tool := range reqBody.Tools[0].FunctionDeclarations {
				toolNames = append(toolNames, tool.Name)
			}
		}
		log.Printf("gemini: model %s, messages: %d, tools: %s\n", opts.Model, len(contents), strings.Join(toolNames, ","))
	}

	// Encode request body
	buf, err := aiutil.JsonEncodeRequestBody(reqBody)
	if err != nil {
		return nil, err
	}

	// Build URL
	endpoint, err := ensureAltSse(opts.Endpoint)
	if err != nil {
		return nil, err
	}

	// Create HTTP request
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &buf)
	if err != nil {
		return nil, err
	}

	// Set headers
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", opts.APIToken)

	return req, nil
}

// RunGeminiChatStep executes a chat step using the Gemini API
func RunGeminiChatStep(
	ctx context.Context,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.GulinChatOpts,
	cont *uctypes.GulinContinueResponse,
) (*uctypes.GulinStopReason, *GeminiChatMessage, *uctypes.RateLimitInfo, error) {
	if sseHandler == nil {
		return nil, nil, nil, errors.New("sse handler is nil")
	}

	// Get chat from store
	chat := chatstore.DefaultChatStore.Get(chatOpts.ChatId)
	if chat == nil {
		return nil, nil, nil, fmt.Errorf("chat not found: %s", chatOpts.ChatId)
	}

	// Validate that chatOpts.Config match the chat's stored configuration
	if chat.APIType != chatOpts.Config.APIType {
		return nil, nil, nil, fmt.Errorf("API type mismatch: chat has %s, chatOpts has %s", chat.APIType, chatOpts.Config.APIType)
	}
	if chat.Model != chatOpts.Config.Model {
		return nil, nil, nil, fmt.Errorf("model mismatch: chat has %s, chatOpts has %s", chat.Model, chatOpts.Config.Model)
	}

	// Context with timeout if provided
	if chatOpts.Config.TimeoutMs > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(chatOpts.Config.TimeoutMs)*time.Millisecond)
		defer cancel()
	}

	// Convert native messages to Gemini format
	var contents []GeminiContent
	for _, genMsg := range chat.NativeMessages {
		var chatMsg *GeminiChatMessage
		var ok bool
		if chatMsg, ok = genMsg.(*GeminiChatMessage); !ok {
			if aiMsg, ok := genMsg.(*uctypes.AIMessage); ok {
				var err error
				chatMsg, err = ConvertAIMessageToGeminiChatMessage(*aiMsg)
				if err != nil {
					return nil, nil, nil, fmt.Errorf("failed to convert fallback AIMessage: %w", err)
				}
			} else {
				return nil, nil, nil, fmt.Errorf("expected GeminiChatMessage or *uctypes.AIMessage, got %T", genMsg)
			}
		}

		content := GeminiContent{
			Role:   chatMsg.Role,
			Pinned: chatMsg.Pinned,
			Parts:  make([]GeminiMessagePart, len(chatMsg.Parts)),
		}
		for i, part := range chatMsg.Parts {
			content.Parts[i] = *part.Clean()
		}
		contents = append(contents, content)
	}

	isBridgeReq := chatOpts.Config.Provider == uctypes.AIProvider_GulinBridge || chatOpts.Config.BridgeProvider != ""
	
	// Apply individual message truncation
	contextLimit := chatOpts.Config.ContextLimit
	if contextLimit <= 0 {
		contextLimit = 150000 / 4 // Fallback (approx 37.5k tokens)
	}
	truncateGeminiLargeMessages(contents, contextLimit, isBridgeReq)

	// Apply sliding window for total context based on TokenMode
	historyLimit := 3
	contextMaxTokens := contextLimit
	if chatOpts.TokenMode == uctypes.TokenModeMini {
		historyLimit = 1
	} else if chatOpts.TokenMode == uctypes.TokenModeBalanced {
		historyLimit = 10
	} else if chatOpts.TokenMode == uctypes.TokenModeMax {
		historyLimit = 0 // 0 = sin límite de mensajes
		contextMaxTokens = 0 // 0 = sin límite de tokens (que el modelo decida)
	}
	contents = limitGeminiTotalMessages(contents, contextMaxTokens, historyLimit)


	httpClient := &http.Client{
		Timeout: 0, // rely on ctx; streaming can be long
	}

	var resp *http.Response
	maxRetries := 3
	for attempt := 1; attempt <= maxRetries; attempt++ {
		req, err := buildGeminiHTTPRequest(ctx, contents, chatOpts)
		if err != nil {
			return nil, nil, nil, err
		}

		resp, err = httpClient.Do(req)
		if err != nil {
			if attempt == maxRetries {
				return nil, nil, nil, fmt.Errorf("HTTP request failed after %d attempts: %w", maxRetries, err)
			}
			log.Printf("gemini: HTTP request attempt %d failed: %v, retrying...\n", attempt, err)
			select {
			case <-time.After(time.Duration(attempt) * 2 * time.Second):
			case <-ctx.Done():
				return nil, nil, nil, ctx.Err()
			}
			continue
		}

		// Check for transient status codes (5xx or 429)
		if resp.StatusCode >= 500 || resp.StatusCode == 429 {
			bodyBytes, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			if attempt == maxRetries {
				return nil, nil, nil, fmt.Errorf("API returned status %d after %d attempts: %s", resp.StatusCode, maxRetries, utilfn.TruncateString(string(bodyBytes), 120))
			}
			log.Printf("gemini: API returned transient status %d, retrying...\n", resp.StatusCode)
			select {
			case <-time.After(time.Duration(attempt) * 2 * time.Second):
			case <-ctx.Done():
				return nil, nil, nil, ctx.Err()
			}
			continue
		}

		// Success or permanent error
		break
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)

		// Try to parse as Gemini error
		var geminiErr GeminiErrorResponse
		if err := json.Unmarshal(bodyBytes, &geminiErr); err == nil && geminiErr.Error != nil {
			return nil, nil, nil, fmt.Errorf("Gemini API error (%d): %s", geminiErr.Error.Code, geminiErr.Error.Message)
		}

		return nil, nil, nil, fmt.Errorf("API returned status %d: %s", resp.StatusCode, utilfn.TruncateString(string(bodyBytes), 120))
	}

	// Setup SSE if this is a new request (not a continuation)
	if cont == nil {
		if err := sseHandler.SetupSSE(); err != nil {
			return nil, nil, nil, fmt.Errorf("failed to setup SSE: %w", err)
		}
	}

	// Stream processing
	stopReason, assistantMsg, err := processGeminiStream(ctx, resp.Body, sseHandler, chatOpts, cont)
	if err != nil {
		return nil, nil, nil, err
	}

	return stopReason, assistantMsg, nil, nil
}

// processGeminiStream handles the streaming response from Gemini
func processGeminiStream(
	ctx context.Context,
	body io.Reader,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.GulinChatOpts,
	cont *uctypes.GulinContinueResponse,
) (*uctypes.GulinStopReason, *GeminiChatMessage, error) {
	msgID := uuid.New().String()
	textID := uuid.New().String()
	textStarted := false
	var textBuilder strings.Builder
	var textThoughtSignature string
	var finishReason string
	var functionCalls []GeminiMessagePart
	var usageMetadata *GeminiUsageMetadata

	if cont == nil {
		_ = sseHandler.AiMsgStart(msgID)
	}
	_ = sseHandler.AiMsgStartStep()

	decoder := eventsource.NewDecoder(body)

	for {
		if err := ctx.Err(); err != nil {
			_ = sseHandler.AiMsgError("request cancelled")
			return &uctypes.GulinStopReason{
				Kind:      uctypes.StopKindCanceled,
				ErrorType: "cancelled",
				ErrorText: "request cancelled",
			}, nil, err
		}

		event, err := decoder.Decode()
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			if sseHandler.Err() != nil {
				partialMsg := extractPartialGeminiMessage(msgID, textBuilder.String())
				return &uctypes.GulinStopReason{
					Kind:      uctypes.StopKindCanceled,
					ErrorType: "client_disconnect",
					ErrorText: "client disconnected",
				}, partialMsg, nil
			}
			_ = sseHandler.AiMsgError(fmt.Sprintf("stream decode error: %v", err))
			return &uctypes.GulinStopReason{
				Kind:      uctypes.StopKindError,
				ErrorType: "stream",
				ErrorText: err.Error(),
			}, nil, fmt.Errorf("stream decode error: %w", err)
		}

		data := event.Data()
		if data == "" {
			continue
		}

		// Parse the JSON response
		var chunk GeminiStreamResponse
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			log.Printf("gemini: failed to parse chunk: %v\n", err)
			continue
		}

		// Check for prompt feedback (blocking)
		if chunk.PromptFeedback != nil && chunk.PromptFeedback.BlockReason != "" {
			errorMsg := fmt.Sprintf("Content blocked: %s", chunk.PromptFeedback.BlockReason)
			_ = sseHandler.AiMsgError(errorMsg)
			return &uctypes.GulinStopReason{
				Kind:      uctypes.StopKindContent,
				ErrorType: "blocked",
				ErrorText: errorMsg,
			}, nil, fmt.Errorf("%s", errorMsg)
		}

		// Store usage metadata if present
		if chunk.UsageMetadata != nil {
			usageMetadata = chunk.UsageMetadata
		}

		// Log grounding metadata (web search queries)
		if chunk.GroundingMetadata != nil && len(chunk.GroundingMetadata.WebSearchQueries) > 0 {
			if gulinbase.IsDevMode() {
				log.Printf("gemini: web search queries executed: %v\n", chunk.GroundingMetadata.WebSearchQueries)
			}
		}

		// Process candidates
		if len(chunk.Candidates) == 0 {
			continue
		}

		candidate := chunk.Candidates[0]

		// Log candidate grounding metadata if present
		if candidate.GroundingMetadata != nil && len(candidate.GroundingMetadata.WebSearchQueries) > 0 {
			if gulinbase.IsDevMode() {
				log.Printf("gemini: candidate web search queries: %v\n", candidate.GroundingMetadata.WebSearchQueries)
			}
		}

		// Store finish reason
		if candidate.FinishReason != "" {
			finishReason = candidate.FinishReason
		}

		if candidate.Content == nil {
			continue
		}

		// Process content parts
		for _, part := range candidate.Content.Parts {
			if part.Text != "" {
				if !textStarted {
					_ = sseHandler.AiMsgTextStart(textID)
					textStarted = true
				}
				textBuilder.WriteString(part.Text)
				_ = sseHandler.AiMsgTextDelta(textID, part.Text)
				if part.ThoughtSignature != "" {
					textThoughtSignature = part.ThoughtSignature
				}
			}

			if part.FunctionCall != nil {
				toolCallId := uuid.New().String()

				argsBytes, _ := json.Marshal(part.FunctionCall.Args)
				aiutil.SendToolProgress(toolCallId, part.FunctionCall.Name, argsBytes, chatOpts, sseHandler, false)

				// Preserve thought_signature exactly as received from API
				// It can be at part level, FunctionCall level, or both
				functionCalls = append(functionCalls, GeminiMessagePart{
					FunctionCall:     part.FunctionCall,
					ThoughtSignature: part.ThoughtSignature,
					ToolUseData: &uctypes.UIMessageDataToolUse{
						ToolCallId: toolCallId,
						ToolName:   part.FunctionCall.Name,
					},
				})
			}
		}
	}

	// Determine stop reason
	stopKind := uctypes.StopKindDone
	switch finishReason {
	case "MAX_TOKENS":
		stopKind = uctypes.StopKindMaxTokens
	case "SAFETY":
		stopKind = uctypes.StopKindContent
	case "RECITATION":
		stopKind = uctypes.StopKindContent
	}

	// Build assistant message
	var parts []GeminiMessagePart
	if textBuilder.Len() > 0 {
		parts = append(parts, GeminiMessagePart{
			Text:             textBuilder.String(),
			ThoughtSignature: textThoughtSignature,
		})
	}
	parts = append(parts, functionCalls...)

	// Set usage metadata model
	if usageMetadata != nil {
		usageMetadata.Model = chatOpts.Config.Model
	}

	assistantMsg := &GeminiChatMessage{
		MessageId: msgID,
		Role:      "model",
		Parts:     parts,
		Usage:     usageMetadata,
	}

	// Build tool calls for stop reason
	var gulinToolCalls []uctypes.GulinToolCall
	if len(functionCalls) > 0 {
		stopKind = uctypes.StopKindToolUse
		for _, fcPart := range functionCalls {
			if fcPart.FunctionCall != nil && fcPart.ToolUseData != nil {
				gulinToolCalls = append(gulinToolCalls, uctypes.GulinToolCall{
					ID:          fcPart.ToolUseData.ToolCallId,
					Name:        fcPart.FunctionCall.Name,
					Input:       fcPart.FunctionCall.Args,
					ToolUseData: fcPart.ToolUseData,
				})
			}
		}
	}

	stopReason := &uctypes.GulinStopReason{
		Kind:      stopKind,
		RawReason: finishReason,
		ToolCalls: gulinToolCalls,
	}

	if textStarted {
		_ = sseHandler.AiMsgTextEnd(textID)
	}
	_ = sseHandler.AiMsgFinishStep()

	return stopReason, assistantMsg, nil
}

func extractPartialGeminiMessage(msgID string, text string) *GeminiChatMessage {
	if text == "" {
		return nil
	}

	return &GeminiChatMessage{
		MessageId: msgID,
		Role:      "model",
		Parts: []GeminiMessagePart{
			{
				Text: text,
			},
		},
	}
}
