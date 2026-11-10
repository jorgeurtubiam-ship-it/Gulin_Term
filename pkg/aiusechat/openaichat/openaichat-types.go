// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openaichat

import (
	"bytes"
	"encoding/json"
	"strings"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
)

// OpenAI Chat Completions API types (simplified)

type ChatStreamOptions struct {
	IncludeUsage bool `json:"include_usage,omitempty"`
}

type ChatRequest struct {
	Model               string               `json:"model"`
	Messages            []ChatRequestMessage `json:"messages"`
	Stream              bool                 `json:"stream"`
	StreamOptions       *ChatStreamOptions   `json:"stream_options,omitempty"`
	MaxTokens           int                  `json:"max_tokens,omitempty"`            // legacy
	MaxCompletionTokens int                  `json:"max_completion_tokens,omitempty"` // newer
	Temperature         float64              `json:"temperature,omitempty"`
	Tools               []ToolDefinition     `json:"tools,omitempty"`       // if you use tools
	ToolChoice          any                  `json:"tool_choice,omitempty"` // "auto", "none", or struct

	// Extensiones de proveedor (MiniMax M3/M3.1 y compatibles). Solo se
	// serializan si el caller las rellena; para OpenAI puro quedan en cero
	// y omitempty las elimina del payload.
	ReasoningEffort string          `json:"reasoning_effort,omitempty"` // low|medium|high|xhigh|max (MiniMax M3.1-Flash)
	ReasoningSplit  *bool           `json:"reasoning_split,omitempty"`  // true => thinking va a reasoning_content
	Thinking        *ThinkingConfig `json:"thinking,omitempty"`         // {"type":"enabled"|"disabled"|"adaptive"}
}

// ThinkingConfig es el objeto `thinking` de MiniMax (y de Anthropic-compat).
type ThinkingConfig struct {
	Type string `json:"type"` // "enabled" | "disabled" | "adaptive"
}

type ChatContentPart struct {
	Type     string        `json:"type"`                // "text" or "image_url"
	Text     string        `json:"text,omitempty"`      // for type "text"
	ImageUrl *ChatImageUrl `json:"image_url,omitempty"` // for type "image_url"

	FileName   string `json:"filename,omitempty"`   // internal: original filename
	PreviewUrl string `json:"previewurl,omitempty"` // internal: 128x128 webp preview
	MimeType   string `json:"mimetype,omitempty"`   // internal: original mimetype
}

func (cp *ChatContentPart) clean() *ChatContentPart {
	if cp.FileName == "" && cp.PreviewUrl == "" && cp.MimeType == "" {
		return cp
	}
	rtn := *cp
	rtn.FileName = ""
	rtn.PreviewUrl = ""
	rtn.MimeType = ""
	return &rtn
}

type ChatImageUrl struct {
	Url    string `json:"url"`
	Detail string `json:"detail,omitempty"` // "auto", "low", "high"
}

type ChatRequestMessage struct {
	Role         string            `json:"role"`                   // "system","user","assistant","tool"
	Content      string            `json:"-"`                      // plain text (used when ContentParts is nil)
	ContentParts []ChatContentPart `json:"-"`                      // multimodal parts (used when images present)
	ToolCalls    []ToolCall        `json:"tool_calls,omitempty"`   // assistant tool-call message
	ToolCallID   string            `json:"tool_call_id,omitempty"` // for role:"tool"
	Name         string            `json:"name,omitempty"`         // tool name on role:"tool"

	// ReasoningContent: reasoning trace del turno assistant.
	//
	// Se reenvia al proveedor para preservar el interleaved thinking de MiniMax
	// M-series / DeepSeek-R1. NOTA (verificado 2026-08 empíricamente contra
	// MiniMax-M3.1-Flash): omitirlo NO provoca 500 internal_error. El comentario
	// anterior afirmaba lo contrario y era falso, lo que desvio un diagnostico
	// completo del bug de internal_error hacia una causa inexistente. Se sigue
	// enviando porque mantener el trace mejora la coherencia multi-turno, no
	// porque el proveedor lo exija.
	ReasoningContent string `json:"-"` // se serializa via MarshalJSON
}

// chatRequestMessageJSON is the wire format for ChatRequestMessage
type chatRequestMessageJSON struct {
	Role             string          `json:"role"`
	Content          json.RawMessage `json:"content"`
	ToolCalls        []ToolCall      `json:"tool_calls,omitempty"`
	ToolCallID       string          `json:"tool_call_id,omitempty"`
	Name             string          `json:"name,omitempty"`
	ReasoningContent string          `json:"reasoning_content,omitempty"`
}

// toolCallJSON es el formato de cable de ToolCall. Existe porque el struct
// ToolCall tiene campos internos de UI (toolusedata, desc, estado...) que NO
// deben viajar nunca al proveedor: MiniMax los ignora, pero algunos gateways
// OpenAI-compatibles rechazan el payload con un opaco 500 "internal_error".
type toolCallJSON struct {
	ID       string           `json:"id"`
	Type     string           `json:"type"`
	Function ToolFunctionCall `json:"function"`
}

func (tc ToolCall) MarshalJSON() ([]byte, error) {
	clean := toolCallJSON{
		ID:   tc.ID,
		Type: tc.Type,
		Function: ToolFunctionCall{
			Name:      tc.Function.Name,
			Arguments: sanitizeArguments(tc.Function.Arguments),
		},
	}
	if clean.Type == "" {
		clean.Type = "function"
	}
	return json.Marshal(clean)
}

// sanitizeArguments garantiza que `arguments` sea un objeto JSON serializado
// como string. Un arguments vacío (tool call cortada a mitad de stream) se
// reescribe a "{}"; un arguments inválido también, para que el proveedor no
// devuelva 500/400 al parsear el historial.
func sanitizeArguments(args string) string {
	if args == "" {
		return "{}"
	}
	trimmed := strings.TrimSpace(args)
	if !json.Valid([]byte(trimmed)) || !strings.HasPrefix(trimmed, "{") {
		return "{}"
	}
	return trimmed
}

func (cm ChatRequestMessage) MarshalJSON() ([]byte, error) {
	raw := chatRequestMessageJSON{
		Role:             cm.Role,
		ToolCalls:        cm.ToolCalls,
		ToolCallID:       cm.ToolCallID,
		Name:             cm.Name,
		ReasoningContent: cm.ReasoningContent,
	}
	if len(cm.ContentParts) > 0 {
		b, err := json.Marshal(cm.ContentParts)
		if err != nil {
			return nil, err
		}
		raw.Content = b
	} else {
		// OpenAI and Bridge/Gemini prefer "" over null for content when tool_calls are present
		b, err := json.Marshal(cm.Content)
		if err != nil {
			return nil, err
		}
		raw.Content = b
	}
	return json.Marshal(raw)
}

func (cm *ChatRequestMessage) UnmarshalJSON(data []byte) error {
	var raw chatRequestMessageJSON
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	cm.Role = raw.Role
	cm.ToolCalls = raw.ToolCalls
	cm.ToolCallID = raw.ToolCallID
	cm.Name = raw.Name
	cm.ReasoningContent = raw.ReasoningContent
	cm.Content = ""
	cm.ContentParts = nil
	if len(raw.Content) == 0 || bytes.Equal(raw.Content, []byte("null")) {
		return nil
	}
	// try array first
	var parts []ChatContentPart
	if err := json.Unmarshal(raw.Content, &parts); err == nil {
		cm.ContentParts = parts
		return nil
	}
	// fall back to string
	var s string
	if err := json.Unmarshal(raw.Content, &s); err != nil {
		return err
	}
	cm.Content = s
	return nil
}

func (cm *ChatRequestMessage) clean() *ChatRequestMessage {
	rtn := *cm
	if len(cm.ToolCalls) > 0 {
		rtn.ToolCalls = make([]ToolCall, len(cm.ToolCalls))
		for i, tc := range cm.ToolCalls {
			rtn.ToolCalls[i] = *tc.clean()
		}
	}
	if len(cm.ContentParts) > 0 {
		rtn.ContentParts = make([]ChatContentPart, len(cm.ContentParts))
		for i, cp := range cm.ContentParts {
			rtn.ContentParts[i] = *cp.clean()
		}
	}
	return &rtn
}

func (cm *ChatRequestMessage) FindToolCallIndex(toolCallId string) int {
	for i, tc := range cm.ToolCalls {
		if tc.ID == toolCallId {
			return i
		}
	}
	return -1
}

type ToolDefinition struct {
	Type     string          `json:"type"` // "function"
	Function ToolFunctionDef `json:"function"`
}

type ToolFunctionDef struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Parameters  map[string]any `json:"parameters,omitempty"` // or jsonschema struct
}

type ToolCall struct {
	ID          string                        `json:"id"`
	Type        string                        `json:"type"` // "function"
	Function    ToolFunctionCall              `json:"function"`
	ToolUseData *uctypes.UIMessageDataToolUse `json:"toolusedata,omitempty"` // Internal field (must be cleaned before sending to API)
}

func (tc *ToolCall) clean() *ToolCall {
	if tc.ToolUseData == nil {
		return tc
	}
	rtn := *tc
	rtn.ToolUseData = nil
	return &rtn
}

type ToolFunctionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"` // raw JSON string
}

type StreamChunk struct {
	ID      string         `json:"id"`
	Object  string         `json:"object"`
	Created int64          `json:"created"`
	Model   string         `json:"model"`
	Choices []StreamChoice `json:"choices"`
	Usage   *ChatUsage     `json:"usage,omitempty"`
}

type StreamChoice struct {
	Index        int          `json:"index"`
	Delta        ContentDelta `json:"delta"`
	Message      ContentDelta `json:"message"`       // Non-streaming fallback (sometimes provided by Bridge/Proxy)
	FinishReason *string      `json:"finish_reason"` // "stop", "length" | "tool_calls" | "content_filter"
}

// This is the important part:
type ContentDelta struct {
	Role      string          `json:"role,omitempty"`
	Content   string          `json:"content,omitempty"`
	Text      string          `json:"text,omitempty"` // Fallback for Bridge/Anthropic/Google
	ToolCalls []ToolCallDelta `json:"tool_calls,omitempty"`

	// ReasoningContent carries the model's internal reasoning ("thinking").
	// MiniMax (MiniMax-M3.1-Flash) and DeepSeek-R1 style providers emit it as
	// `reasoning_content` in the streaming delta. Without this field the whole
	// reasoning trace is silently dropped by encoding/json.
	ReasoningContent string `json:"reasoning_content,omitempty"`
	// Reasoning is an alias used by some gateways for the same payload.
	Reasoning string `json:"reasoning,omitempty"`
}

// GetReasoning returns the reasoning trace carried by the delta, checking
// both the canonical field and the alias used by some gateways.
func (d ContentDelta) GetReasoning() string {
	if d.ReasoningContent != "" {
		return d.ReasoningContent
	}
	return d.Reasoning
}

type ToolCallDelta struct {
	Index    int                `json:"index"`
	ID       string             `json:"id,omitempty"`   // only on first chunk
	Type     string             `json:"type,omitempty"` // "function"
	Function *ToolFunctionDelta `json:"function,omitempty"`
}

type ToolFunctionDelta struct {
	Name      string `json:"name,omitempty"`      // only on first chunk
	Arguments string `json:"arguments,omitempty"` // streamed, append across chunks
}

// StoredChatMessage is the stored message type
type StoredChatMessage struct {
	MessageId string             `json:"messageid"`
	Message   ChatRequestMessage `json:"message"`
	Pinned    bool               `json:"pinned,omitempty"`
	Usage     *ChatUsage         `json:"usage,omitempty"`
}

type ChatUsage struct {
	Model        string `json:"model,omitempty"`
	InputTokens  int    `json:"prompt_tokens,omitempty"`
	OutputTokens int    `json:"completion_tokens,omitempty"`
	TotalTokens  int    `json:"total_tokens,omitempty"`
}

func (m *StoredChatMessage) GetMessageId() string {
	return m.MessageId
}

func (m *StoredChatMessage) IsPinned() bool {
	return m.Pinned
}

func (m *StoredChatMessage) GetContent() string {
	if m.Message.Content != "" {
		return m.Message.Content
	}
	for _, part := range m.Message.ContentParts {
		if part.Type == "text" {
			return part.Text
		}
	}
	return ""
}

func (m *StoredChatMessage) GetRole() string {
	return m.Message.Role
}

func (m *StoredChatMessage) GetUsage() *uctypes.AIUsage {
	if m == nil || m.Usage == nil {
		return nil
	}
	return &uctypes.AIUsage{
		APIType:      uctypes.APIType_OpenAIChat,
		Model:        m.Usage.Model,
		InputTokens:  m.Usage.InputTokens,
		OutputTokens: m.Usage.OutputTokens,
	}
}

func (m *StoredChatMessage) Copy() *StoredChatMessage {
	if m == nil {
		return nil
	}
	copied := *m
	if len(m.Message.ToolCalls) > 0 {
		copied.Message.ToolCalls = make([]ToolCall, len(m.Message.ToolCalls))
		for i, tc := range m.Message.ToolCalls {
			copied.Message.ToolCalls[i] = tc
			if tc.ToolUseData != nil {
				toolUseDataCopy := *tc.ToolUseData
				copied.Message.ToolCalls[i].ToolUseData = &toolUseDataCopy
			}
		}
	}
	if len(m.Message.ContentParts) > 0 {
		copied.Message.ContentParts = make([]ChatContentPart, len(m.Message.ContentParts))
		copy(copied.Message.ContentParts, m.Message.ContentParts)
	}
	if m.Usage != nil {
		usageCopy := *m.Usage
		copied.Usage = &usageCopy
	}
	return &copied
}
