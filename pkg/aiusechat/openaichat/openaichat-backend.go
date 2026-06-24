// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openaichat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/launchdarkly/eventsource"
	"github.com/gulindev/gulin/pkg/aiusechat/chatstore"
	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/web/sse"
)

// RunChatStep executes a chat step using the chat completions API
func RunChatStep(
	ctx context.Context,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.GulinChatOpts,
	cont *uctypes.GulinContinueResponse,
) (*uctypes.GulinStopReason, []*StoredChatMessage, *uctypes.RateLimitInfo, error) {
	if sseHandler == nil {
		return nil, nil, nil, errors.New("sse handler is nil")
	}

	chat := chatstore.DefaultChatStore.Get(chatOpts.ChatId)
	if chat == nil {
		return nil, nil, nil, fmt.Errorf("chat not found: %s", chatOpts.ChatId)
	}

	if chatOpts.Config.TimeoutMs > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(chatOpts.Config.TimeoutMs)*time.Millisecond)
		defer cancel()
	}

	// Convert stored messages to chat completions format
	var messages []ChatRequestMessage

	// For Bridge requests, limit history to avoid large payloads that cause "unexpected EOF"
	nativeMessages := chat.NativeMessages
	isBridge := chatOpts.Config.BridgeProvider != "" ||
		strings.Contains(chatOpts.Config.Endpoint, ":8090") ||
		strings.Contains(chatOpts.Config.Endpoint, "gulinbridge") ||
		strings.Contains(chatOpts.Config.Endpoint, "proxy.gulin.cl")
	
	limit := 100
	if chatOpts.TokenMode == uctypes.TokenModeMini {
		limit = 15
	} else if chatOpts.TokenMode == uctypes.TokenModeBalanced {
		limit = 40
	} else if chatOpts.TokenMode == uctypes.TokenModeMax {
		limit = 1000
	} else if strings.Contains(chatOpts.Config.Model, "@orchestrate") {
		// Orchestator only needs minimal recent context to decide which expert to call.
		// Heavily limiting history prevents "max tokens exceeded" caused by large terminal/file outputs.
		limit = 20
	}

	if (isBridge || chatOpts.TokenMode != "") {
		nativeMessages = uctypes.TruncateMessagesSafe(nativeMessages, limit)
	}

	// Convert native messages
	for _, genMsg := range nativeMessages {
		var chatMsg *StoredChatMessage
		var ok bool
		if chatMsg, ok = genMsg.(*StoredChatMessage); !ok {
			if aiMsg, ok := genMsg.(*uctypes.AIMessage); ok {
				var err error
				chatMsg, err = ConvertAIMessageToStoredChatMessage(*aiMsg)
				if err != nil {
					return nil, nil, nil, fmt.Errorf("failed to convert fallback AIMessage: %w", err)
				}
			} else {
				return nil, nil, nil, fmt.Errorf("expected StoredChatMessage or *uctypes.AIMessage, got %T", genMsg)
			}
		}
		messages = append(messages, *chatMsg.Message.clean())
	}

	req, err := buildChatHTTPRequest(ctx, messages, chatOpts)
	if err != nil {
		return nil, nil, nil, err
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	log.Printf("openaichat TRACE 1: client.Do returned err=%v", err)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, nil, nil, fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	contentType := resp.Header.Get("Content-Type")
	log.Printf("openaichat TRACE 2: Bridge response Content-Type: %s (isBridge: %v)\n", contentType, isBridge)
	var bodyReader io.Reader = resp.Body
	if isBridge || strings.Contains(contentType, "application/json") {
		bodyBytes, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			if len(bodyBytes) > 0 && (errors.Is(readErr, io.ErrUnexpectedEOF) || strings.Contains(readErr.Error(), "unexpected EOF")) {
				log.Printf("openaichat TRACE 3: Bridge returned unexpected EOF, but retrieved %d bytes. Attempting recovery...\n", len(bodyBytes))
			} else {
				return nil, nil, nil, fmt.Errorf("failed to read non-streaming response: %w", readErr)
			}
		} else {
			log.Printf("openaichat TRACE 3: Bridge non-streaming JSON response (len=%d), converting to SSE chunks\n", len(bodyBytes))
			log.Printf("openaichat non-streaming JSON DEBUG: %s", string(bodyBytes))
		}
		originalBodyBytes := bodyBytes

		// Clean any leading SSE heartbeats (e.g. data: {"heartbeat": true}) that the Bridge might have prepended before yielding the full JSON payload
		bodyStr := string(bodyBytes)
		
		// Improved cleaning: strip all "data:" or "event:" prefixes from the start of every line
		// to handle cases where multiple SSE chunks are concatenated.
		lines := strings.Split(bodyStr, "\n")
		var cleanedLines []string
		for _, line := range lines {
			trimmedLine := strings.TrimSpace(line)
			if strings.HasPrefix(trimmedLine, "data:") {
				cleanedLines = append(cleanedLines, strings.TrimSpace(strings.TrimPrefix(trimmedLine, "data:")))
			} else if strings.HasPrefix(trimmedLine, "event:") {
				// skip events
				continue
			} else if trimmedLine != "" && trimmedLine != "[DONE]" {
				cleanedLines = append(cleanedLines, trimmedLine)
			}
		}
		
		// If we found multiple data lines, they are likely separate JSON objects (heartbeats) 
		// if they represent a real stream, we should NOT process them as a single JSON object.
		canProcessAsSingleJSON := false
		bodyStr = ""
		if len(cleanedLines) == 1 {
			bodyStr = cleanedLines[0]
			canProcessAsSingleJSON = true
		} else {
			// Find if there's only ONE line that isn't a heartbeat/empty
			choicesCount := 0
			for _, line := range cleanedLines {
				if strings.Contains(line, "\"choices\"") {
					choicesCount++
					bodyStr = line
				}
			}
			if choicesCount == 1 {
				canProcessAsSingleJSON = true
			}
		}

		cleanedBytes := []byte(bodyStr)
		
		// Parse full non-streaming response
		var fullResp struct {
			ID      string `json:"id"`
			Model   string `json:"model"`
			Created int64  `json:"created"`
			Error   *struct {
				Message interface{} `json:"message"`
				Code    interface{} `json:"code"`
			} `json:"error"`
			Choices []struct {
				Message struct {
					Role      string     `json:"role"`
					Content   *string    `json:"content"`
					Text      *string    `json:"text"`
					ToolCalls []ToolCall `json:"tool_calls"`
				} `json:"message"`
				FinishReason string `json:"finish_reason"`
			} `json:"choices"`
		}
		
		if canProcessAsSingleJSON && json.Unmarshal(cleanedBytes, &fullResp) == nil && fullResp.Error != nil {
			var errMsg string
			if s, ok := fullResp.Error.Message.(string); ok {
				errMsg = s
			} else {
				errMsg = fmt.Sprintf("%v", fullResp.Error.Message)
			}
			return nil, nil, nil, fmt.Errorf("AI Provider Error: %s", errMsg)
		}
		
		if !canProcessAsSingleJSON || (json.Unmarshal(cleanedBytes, &fullResp) != nil || len(fullResp.Choices) == 0) {
			// If it doesn't even contain "data:" anywhere, it is strictly IMPOSSIBLE that this is an SSE stream.
			// It must be a raw text/HTML error from the proxy (e.g. 502 Bad Gateway or 413 Payload Too Large).
			if len(originalBodyBytes) > 0 && !strings.Contains(string(originalBodyBytes), "data:") {
				var errMsg = strings.TrimSpace(string(cleanedBytes))
				if errMsg == "" {
					errMsg = strings.TrimSpace(string(originalBodyBytes))
				}
				if len(errMsg) > 500 {
					errMsg = errMsg[:500] + "..."
				}
				return nil, nil, nil, fmt.Errorf("Gateway Error: %s", errMsg)
			}
			
			log.Printf("openaichat TRACE 4: failed to parse Bridge JSON properly (err: %v, choices: %d). Must be SSE chunks, falling back to stream decoder. Raw data: %s\n", err, len(fullResp.Choices), string(cleanedBytes))
			
			if len(originalBodyBytes) == 0 {
			    return nil, nil, nil, fmt.Errorf("failed to read bridge response body (0 bytes returned)")
			}
			
			// Fallback: it's actually an SSE stream. Wrap the ORIGINAL body bytes (which contain the `data: ` chunks) so the decoder can read them!
			// If it's missing the [DONE] terminator because of unexpected EOF cut, append it safely.
			bodyReader = strings.NewReader(string(originalBodyBytes) + "\n\ndata: [DONE]\n\n")
		} else {
			log.Printf("openaichat TRACE 5: parsed successfully. Finish reason: %s\n", fullResp.Choices[0].FinishReason)
			msg := fullResp.Choices[0].Message
			finishReason := fullResp.Choices[0].FinishReason
			var sseBuf strings.Builder

			content := ""
			if msg.Content != nil {
				content = *msg.Content
			} else if msg.Text != nil {
				content = *msg.Text
			}

			// Chunk 1: role delta
			roleChunk := StreamChunk{
				ID: fullResp.ID, Model: fullResp.Model, Created: fullResp.Created,
				Choices: []StreamChoice{{Delta: ContentDelta{Role: msg.Role}}},
			}
			if b, err := json.Marshal(roleChunk); err == nil {
				sseBuf.WriteString("data: " + string(b) + "\n\n")
			}

			// Chunk 2a: text content
			if content != "" {
				textChunk := StreamChunk{
					ID: fullResp.ID, Model: fullResp.Model, Created: fullResp.Created,
					Choices: []StreamChoice{{Delta: ContentDelta{Content: content}}},
				}
				if b, err := json.Marshal(textChunk); err == nil {
					sseBuf.WriteString("data: " + string(b) + "\n\n")
				}
			}

			// Chunk 2b: tool_calls
			if len(msg.ToolCalls) > 0 {
				var toolDeltas []ToolCallDelta
				for i, tc := range msg.ToolCalls {
					toolDeltas = append(toolDeltas, ToolCallDelta{
						Index: i,
						ID:    tc.ID,
						Type:  tc.Type,
						Function: &ToolFunctionDelta{
							Name:      tc.Function.Name,
							Arguments: tc.Function.Arguments,
						},
					})
				}
				toolChunk := StreamChunk{
					ID: fullResp.ID, Model: fullResp.Model, Created: fullResp.Created,
					Choices: []StreamChoice{{Delta: ContentDelta{ToolCalls: toolDeltas}}},
				}
				if b, err := json.Marshal(toolChunk); err == nil {
					sseBuf.WriteString("data: " + string(b) + "\n\n")
				}
			}

			// Chunk 3: finish_reason
			fr := finishReason
			finishChunk := StreamChunk{
				ID: fullResp.ID, Model: fullResp.Model, Created: fullResp.Created,
				Choices: []StreamChoice{{Delta: ContentDelta{}, FinishReason: &fr}},
			}
			if b, err := json.Marshal(finishChunk); err == nil {
				sseBuf.WriteString("data: " + string(b) + "\n\n")
			}
			sseBuf.WriteString("data: [DONE]\n\n")
			bodyReader = strings.NewReader(sseBuf.String())
		}
	}

	// Setup SSE now that we have the final bodyReader ready
	if cont == nil {
		if err := sseHandler.SetupSSE(); err != nil {
			return nil, nil, nil, fmt.Errorf("failed to setup SSE: %w", err)
		}
	}

	// Stream processing
	stopReason, assistantMsg, err := processChatStream(ctx, bodyReader, sseHandler, chatOpts, cont)
	if err != nil {
		return nil, nil, nil, err
	}

	var msgs []*StoredChatMessage
	if assistantMsg != nil {
		msgs = []*StoredChatMessage{assistantMsg}
	}
	return stopReason, msgs, nil, nil
}

func processChatStream(
	ctx context.Context,
	body io.Reader,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.GulinChatOpts,
	cont *uctypes.GulinContinueResponse,
) (*uctypes.GulinStopReason, *StoredChatMessage, error) {
	decoder := eventsource.NewDecoder(body)
	var textBuilder strings.Builder
	msgID := uuid.New().String()
	textID := uuid.New().String()
	var finishReason string
	textStarted := false
	var toolCallsInProgress []ToolCall

	if cont == nil {
		_ = sseHandler.AiMsgStart(msgID)
	}
	_ = sseHandler.AiMsgStartStep()

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
				partialMsg := extractPartialTextMessage(msgID, textBuilder.String())
				return &uctypes.GulinStopReason{
					Kind:      uctypes.StopKindCanceled,
					ErrorType: "client_disconnect",
					ErrorText: "client disconnected",
				}, partialMsg, nil
			}
			_ = sseHandler.AiMsgError(err.Error())
			return &uctypes.GulinStopReason{
				Kind:      uctypes.StopKindError,
				ErrorType: "stream",
				ErrorText: err.Error(),
			}, nil, fmt.Errorf("stream decode error: %w", err)
		}

		data := event.Data()
		if data == "[DONE]" {
			break
		}
		// Log every chunk for deep investigation of Bridge/Provider differences
		log.Printf("openaichat chunk DEBUG: %s", data)

		// Detect embedded errors in the SSE stream
		var rawChunk struct {
			Error interface{} `json:"error"`
		}
		if err := json.Unmarshal([]byte(data), &rawChunk); err == nil && rawChunk.Error != nil {
			_ = sseHandler.AiMsgError(fmt.Sprintf("%v", rawChunk.Error))
			return &uctypes.GulinStopReason{
				Kind:      uctypes.StopKindError,
				ErrorType: "stream_api",
				ErrorText: fmt.Sprintf("%v", rawChunk.Error),
			}, nil, fmt.Errorf("AI stream error: %v", rawChunk.Error)
		}

		data = strings.TrimSpace(data)
		if data == "" {
			continue
		}
		if !strings.HasPrefix(data, "{") {
			if !strings.HasPrefix(data, "[DONE]") {
				log.Printf("openaichat: skipping non-JSON chunk: %s", data)
			}
			continue
		}
		var chunk StreamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			log.Printf("openaichat: failed to parse chunk: %v (raw data: %s)", err, data)
			continue
		}

		if len(chunk.Choices) == 0 {
			continue
		}

		choice := chunk.Choices[0]
		// FALLBACK: If Delta is empty but Message is present, use Message (non-streaming Bridge fallback)
		delta := choice.Delta
		messageHasContent := choice.Message.Content != "" || choice.Message.Text != "" || len(choice.Message.ToolCalls) > 0
		if delta.Content == "" && delta.Text == "" && len(delta.ToolCalls) == 0 && messageHasContent {
			delta = choice.Message
		}

		content := delta.Content
		if content == "" && delta.Text != "" {
			content = delta.Text
		}
		if content != "" {
			if !textStarted {
				_ = sseHandler.AiMsgTextStart(textID)
				textStarted = true
			}
			textBuilder.WriteString(content)
			_ = sseHandler.AiMsgTextDelta(textID, content)
		}

		if len(delta.ToolCalls) > 0 {
			for _, tcDelta := range delta.ToolCalls {
				idx := tcDelta.Index
				for len(toolCallsInProgress) <= idx {
					toolCallsInProgress = append(toolCallsInProgress, ToolCall{Type: "function"})
				}

				tc := &toolCallsInProgress[idx]
				if tcDelta.ID != "" {
					tc.ID = tcDelta.ID
				}
				if tcDelta.Type != "" {
					tc.Type = tcDelta.Type
				}
				if tcDelta.Function != nil {
					if tcDelta.Function.Name != "" {
						tc.Function.Name = tcDelta.Function.Name
					}
					if tcDelta.Function.Arguments != "" {
						tc.Function.Arguments += tcDelta.Function.Arguments
					}
				}
			}
		}

		if choice.FinishReason != nil && *choice.FinishReason != "" {
			finishReason = *choice.FinishReason
		}
	}

	stopKind := uctypes.StopKindDone
	if finishReason == "length" {
		stopKind = uctypes.StopKindMaxTokens
	} else if finishReason == "tool_calls" || len(toolCallsInProgress) > 0 {
		stopKind = uctypes.StopKindToolUse
	}

	if len(toolCallsInProgress) == 0 {
		extractedCalls, cleanText := extractToolCallsFromText(textBuilder.String())
		if len(extractedCalls) > 0 {
			toolCallsInProgress = extractedCalls
			stopKind = uctypes.StopKindToolUse
			finishReason = "tool_calls"
			// Replace the builder content with the clean text
			textBuilder.Reset()
			textBuilder.WriteString(cleanText)
		}
	}

	var validToolCalls []ToolCall
	for _, tc := range toolCallsInProgress {
		// Relaxed check: as long as there is a function name, we consider it valid.
		// If ID is missing, we'll assign one.
		if tc.Function.Name != "" {
			if tc.ID == "" {
				tc.ID = "call_" + tc.Function.Name
			}
			validToolCalls = append(validToolCalls, tc)
		}
	}

	var gulinToolCalls []uctypes.GulinToolCall
	if len(validToolCalls) > 0 {
		for _, tc := range validToolCalls {
			var inputJSON any
			if tc.Function.Arguments != "" {
				if err := json.Unmarshal([]byte(tc.Function.Arguments), &inputJSON); err != nil {
					log.Printf("openaichat: failed to parse tool call arguments: %v\n", err)
					continue
				}
			}
			gulinToolCalls = append(gulinToolCalls, uctypes.GulinToolCall{
				ID:    tc.ID,
				Name:  tc.Function.Name,
				Input: inputJSON,
			})
		}
	}

	// Detect silent empty responses: Bridge returned finish_reason:stop but no content and no tool_calls.
	// This usually means the Lite model (e.g. gemini-2.5-flash-lite) was overwhelmed by too many tools or the Bridge
	// silently rejected the request. Return an actionable error instead of an empty message.
	isBridgeRequest := chatOpts.Config.BridgeProvider != "" ||
		strings.Contains(chatOpts.Config.Endpoint, ":8090") ||
		strings.Contains(chatOpts.Config.Endpoint, "gulinbridge") ||
		strings.Contains(chatOpts.Config.Endpoint, "proxy.gulin.cl")
	if stopKind == uctypes.StopKindDone && textBuilder.Len() == 0 && len(gulinToolCalls) == 0 && finishReason != "" {
		log.Printf("openaichat: WARNING - modelo devolvió respuesta vacía (finish_reason=%q, isBridge=%v, model=%s). Posible sobrecarga de herramientas o fallo silencioso del Bridge.\n",
			finishReason, isBridgeRequest, chatOpts.Config.Model)
		_ = sseHandler.AiMsgFinishStep()
		errMsg := fmt.Sprintf("El modelo '%s' devolvió una respuesta vacía (finish_reason: %s). Intente con un modelo más capaz o reduzca el número de herramientas activas.",
			chatOpts.Config.Model, finishReason)
		// No enviamos el error SSE inmediatamente si es un posible reintento silencioso
		log.Printf("openaichat: DETECTED EMPTY RESPONSE (finish_reason=%s). Signaling for potential retry.\n", finishReason)
		return &uctypes.GulinStopReason{
			Kind:      uctypes.StopKindError,
			ErrorType: "empty_response",
			ErrorText: errMsg,
			RawReason: finishReason,
		}, nil, nil
	}

	stopReason := &uctypes.GulinStopReason{
		Kind:      stopKind,
		RawReason: finishReason,
		ToolCalls: gulinToolCalls,
	}

	assistantMsg := &StoredChatMessage{
		MessageId: msgID,
		Message: ChatRequestMessage{
			Role: "assistant",
		},
	}

	assistantMsg.Message.Content = textBuilder.String()
	if len(validToolCalls) > 0 {
		assistantMsg.Message.ToolCalls = validToolCalls
	}

	if textStarted {
		_ = sseHandler.AiMsgTextEnd(textID)
	}
	_ = sseHandler.AiMsgFinishStep()

	if textBuilder.Len() > 0 {
		log.Printf("openaichat: raw response text (len=%d): %q\n", textBuilder.Len(), textBuilder.String())
	}
	if len(toolCallsInProgress) > 0 {
		log.Printf("openaichat: tool calls detected: %d\n", len(toolCallsInProgress))
	}

	return stopReason, assistantMsg, nil
}

func extractPartialTextMessage(msgID string, text string) *StoredChatMessage {
	if text == "" {
		return nil
	}

	return &StoredChatMessage{
		MessageId: msgID,
		Message: ChatRequestMessage{
			Role:    "assistant",
			Content: text,
		},
	}
}

func extractToolCallsFromText(text string) ([]ToolCall, string) {
	var toolCalls []ToolCall
	cleanText := text
	extractedIndices := [][]int{}

	// 1. Try to find content inside ```json ... ``` blocks
	reMarkdown := regexp.MustCompile("(?s)```(?:json)?\n?(.*?)\n?```")
	markdownMatches := reMarkdown.FindAllStringSubmatchIndex(text, -1)
	for _, m := range markdownMatches {
		candidate := strings.TrimSpace(text[m[2]:m[3]])
		if tc := parseSingleToolCall(candidate); tc != nil {
			toolCalls = append(toolCalls, *tc)
			extractedIndices = append(extractedIndices, []int{m[0], m[1]})
		}
	}

	// 2. Look for raw JSON objects outside of markdown blocks if we haven't found everything
	// Use regex to find { "name": "...", "parameters": { ... } }
	reRaw := regexp.MustCompile(`(?s)\{\s*"name":\s*"([^"]+)"\s*,\s*"parameters":\s*(\{.*?\})\s*\}`)
	rawMatches := reRaw.FindAllStringSubmatchIndex(text, -1)
	for _, m := range rawMatches {
		// Check if this match overlaps with any already extracted markdown block
		overlaps := false
		for _, existing := range extractedIndices {
			if (m[0] >= existing[0] && m[0] < existing[1]) || (m[1] > existing[0] && m[1] <= existing[1]) {
				overlaps = true
				break
			}
		}
		if overlaps {
			continue
		}

		name := text[m[2]:m[3]]
		args := text[m[4]:m[5]]
		toolCalls = append(toolCalls, ToolCall{
			ID:   "call_" + uuid.New().String()[:8],
			Type: "function",
			Function: ToolFunctionCall{
				Name:      name,
				Arguments: args,
			},
		})
		extractedIndices = append(extractedIndices, []int{m[0], m[1]})
	}

	// Clean up the text by removing all extracted parts
	if len(extractedIndices) > 0 {
		// Sort indices from end to start to remove correctly
		slices.SortFunc(extractedIndices, func(a, b []int) int {
			return b[0] - a[0]
		})
		for _, idxPair := range extractedIndices {
			cleanText = cleanText[:idxPair[0]] + cleanText[idxPair[1]:]
		}
	}

	return toolCalls, strings.TrimSpace(cleanText)
}

func parseSingleToolCall(candidate string) *ToolCall {
	var simple struct {
		Name       string         `json:"name"`
		Parameters map[string]any `json:"parameters"`
	}
	if err := json.Unmarshal([]byte(candidate), &simple); err == nil && simple.Name != "" {
		args, _ := json.Marshal(simple.Parameters)
		return &ToolCall{
			ID:   "call_" + uuid.New().String()[:8],
			Type: "function",
			Function: ToolFunctionCall{
				Name:      simple.Name,
				Arguments: string(args),
			},
		}
	}
	return nil
}
