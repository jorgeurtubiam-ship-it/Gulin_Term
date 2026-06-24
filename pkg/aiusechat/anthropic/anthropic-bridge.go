// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package anthropic

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/gulindev/gulin/pkg/aiusechat/chatstore"
	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/web/sse"
)

// anthropicBridgeRequest matches the OpenAI format that the Gulin Bridge expects
type anthropicBridgeRequest struct {
	Model    string                  `json:"model"`
	Messages []anthropicBridgeMsg    `json:"messages"`
	System   string                  `json:"system,omitempty"`
	Stream   bool                    `json:"stream"`
	Tools    []uctypes.ToolDefinition `json:"tools,omitempty"`
}

type anthropicBridgeMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// anthropicBridgeChunk matches the OpenAI style streaming chunks from the Bridge
type anthropicBridgeChunk struct {
	Index   int `json:"index"`
	Choices []struct {
		Index int `json:"index"`
		Delta struct {
			Content   string              `json:"content,omitempty"`
			Text      string              `json:"text,omitempty"`
			ToolCalls []anthropicToolDelta `json:"tool_calls,omitempty"`
		} `json:"delta"`
		Message struct {
			Content   string              `json:"content,omitempty"`
			Text      string              `json:"text,omitempty"`
			ToolCalls []anthropicToolDelta `json:"tool_calls,omitempty"`
		} `json:"message"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
}

type anthropicToolDelta struct {
	Index    int    `json:"index"`
	ID       string `json:"id,omitempty"`
	Name     string `json:"name,omitempty"`
	Type     string `json:"type,omitempty"`
	Function struct {
		Name      string `json:"name,omitempty"`
		Arguments string `json:"arguments,omitempty"`
	} `json:"function"`
}

func runAnthropicStepViaBridge(
	ctx context.Context,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.GulinChatOpts,
	cont *uctypes.GulinContinueResponse,
) (*uctypes.GulinStopReason, *anthropicChatMessage, *uctypes.RateLimitInfo, error) {
	// 1. Convert native history to Bridge-compatible messages
	chat := chatstore.DefaultChatStore.Get(chatOpts.ChatId)
	if chat == nil {
		return nil, nil, nil, fmt.Errorf("chat not found: %s", chatOpts.ChatId)
	}

	var bridgeMsgs []anthropicBridgeMsg
	var systemText strings.Builder
	
	// Refuerzo de herramientas para el Cubo Claude Aislado
	systemText.WriteString("ERES GULIN AGENT. TIENES PERMISO TOTAL PARA USAR HERRAMIENTAS. ")
	systemText.WriteString("SI EL USUARIO PIDE AWS, USA 'local_exec' CON 'aws ...'. NO PIDAS PERMISO, ACTÚA. ")

	for _, genMsg := range chat.NativeMessages {
		if genMsg == nil {
			continue
		}
		role := strings.ToLower(genMsg.GetRole())
		content := genMsg.GetContent()

		if role == "system" {
			systemText.WriteString(content)
			systemText.WriteString(" ")
			continue
		}

		if role == "" || role != "assistant" {
			role = "user"
		}
		
		bridgeMsgs = append(bridgeMsgs, anthropicBridgeMsg{Role: role, Content: content})
	}

	// Insertar el System Prompt como primer mensaje (Formato OpenAI que el Bridge espera)
	fullBridgeMsgs := append([]anthropicBridgeMsg{{Role: "system", Content: systemText.String()}}, bridgeMsgs...)

	reqBody := anthropicBridgeRequest{
		Model:    chatOpts.Config.Model,
		Stream:   true,
		Messages: fullBridgeMsgs,
		Tools:    chatOpts.Tools,
	}

	jsonBytes, _ := json.Marshal(reqBody)
	req, err := http.NewRequestWithContext(ctx, "POST", chatOpts.Config.Endpoint, bytes.NewReader(jsonBytes))
	if err != nil {
		return nil, nil, nil, fmt.Errorf("error creando petición al bridge: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if chatOpts.Config.APIToken != "" {
		req.Header.Set("Authorization", "Bearer "+chatOpts.Config.APIToken)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("error conectando con el bridge: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slurp, _ := io.ReadAll(resp.Body)
		return nil, nil, nil, fmt.Errorf("bridge error (%d): %s", resp.StatusCode, string(slurp))
	}

	// 2. Preparar el canal de streaming (CRITICAL: Sin esto la UI no recibe nada)
	if cont == nil {
		if err := sseHandler.SetupSSE(); err != nil {
			return nil, nil, nil, fmt.Errorf("failed to setup SSE: %w", err)
		}
	}

	// 3. Procesamiento de SSE (OpenAI Style → Anthropic Cube)
	scanner := bufio.NewScanner(resp.Body)
	textBuilder := strings.Builder{}
	msgID := uuid.New().String()
	textID := uuid.New().String()
	textStarted := false
	
	// Herramientas en progreso (mapeadas por índice)
	type toolCallProgress struct {
		ID        string
		Name      string
		Arguments strings.Builder
		Started   bool
	}
	toolsInProgress := make(map[int]*toolCallProgress)
	var finishReason string

	if cont == nil {
		_ = sseHandler.AiMsgStart(msgID)
	}
	_ = sseHandler.AiMsgStartStep()

	log.Printf("Cubo Anthropic (Bridge): Iniciando stream para %s (URL: %s)\n", chatOpts.Config.Model, chatOpts.Config.Endpoint)

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		log.Printf("SSE RAW LINE: [%s]\n", line)
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			break
		}

		var chunk anthropicBridgeChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			log.Printf("Cubo Anthropic (Bridge): error parseando chunk: %v | DATA: %s\n", err, data)
			continue
		}

		if len(chunk.Choices) == 0 {
			continue
		}

		choice := chunk.Choices[0]
		
		// Texto (Delta o Message fallback)
		content := choice.Delta.Content
		if content == "" && choice.Delta.Text != "" {
			content = choice.Delta.Text
		}
		if content == "" && choice.Message.Content != "" {
			content = choice.Message.Content
		}
		if content == "" && choice.Message.Text != "" {
			content = choice.Message.Text
		}

		if content != "" {
			if !textStarted {
				_ = sseHandler.AiMsgTextStart(textID)
				textStarted = true
			}
			textBuilder.WriteString(content)
			_ = sseHandler.AiMsgTextDelta(textID, content)
		}

		// Herramientas (Delta o Message fallback)
		tcs := choice.Delta.ToolCalls
		if len(tcs) == 0 {
			tcs = choice.Message.ToolCalls
		}
		if len(tcs) > 0 {
			for _, tcDelta := range tcs {
				idx := tcDelta.Index
				if _, ok := toolsInProgress[idx]; !ok {
					toolsInProgress[idx] = &toolCallProgress{}
				}
				p := toolsInProgress[idx]
				
				if tcDelta.ID != "" {
					p.ID = tcDelta.ID
				}
				if tcDelta.Function.Name != "" {
					p.Name = tcDelta.Function.Name
				}
				if tcDelta.Function.Arguments != "" {
					p.Arguments.WriteString(tcDelta.Function.Arguments)
				}
				
				if p.ID != "" && p.Name != "" && !p.Started {
					_ = sseHandler.AiMsgToolInputAvailable(p.ID, p.Name, []byte("{}"))
					p.Started = true
				}
			}
		}

		if choice.FinishReason != nil {
			finishReason = *choice.FinishReason
		}
	}

	log.Printf("Cubo Anthropic (Bridge): Stream finalizado. Texto acumulado: %d caracteres, Herramientas: %d\n", textBuilder.Len(), len(toolsInProgress))

	if textStarted {
		_ = sseHandler.AiMsgTextEnd(textID)
	}

	// Finalizar herramientas
	var finalToolCalls []uctypes.GulinToolCall
	for _, p := range toolsInProgress {
		if p.ID != "" && p.Name != "" {
			args := p.Arguments.String()
			// Enviar argumentos finales al terminal
			_ = sseHandler.AiMsgToolInputAvailable(p.ID, p.Name, []byte(args))
			
			finalToolCalls = append(finalToolCalls, uctypes.GulinToolCall{
				ID:    p.ID,
				Name:  p.Name,
				Input: args, // El orquestador lo parseará como JSON si es necesario
			})
		}
	}

	_ = sseHandler.AiMsgFinishStep()

	// 3. Resultado Final
	rtnMsg := &anthropicChatMessage{
		MessageId: uuid.New().String(),
		Role:      "assistant",
		Content: []anthropicMessageContentBlock{
			{Type: "text", Text: textBuilder.String()},
		},
	}

	stopKind := uctypes.StopKindDone
	if finishReason == "tool_calls" || len(finalToolCalls) > 0 {
		stopKind = uctypes.StopKindToolUse
	}

	return &uctypes.GulinStopReason{
		Kind:      stopKind,
		ToolCalls: finalToolCalls,
	}, rtnMsg, nil, nil
}
