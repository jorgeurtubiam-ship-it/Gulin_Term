// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openaichat

import (
	"bytes"
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
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/gulindev/gulin/pkg/aiusechat/aiutil"
	"github.com/gulindev/gulin/pkg/aiusechat/chatstore"
	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/gulinbase"
	"github.com/gulindev/gulin/pkg/web/sse"
	"github.com/launchdarkly/eventsource"
)

// MaxRequestRetries is the number of extra attempts performed when the
// provider returns a transient error (5xx or 429).
const MaxRequestRetries = 2

// doWithRetry performs the HTTP request and retries transient failures with
// exponential backoff. The request body is re-created for each attempt because
// http.Request bodies are consumed on the first read.
//
// Retryable statuses: 408, 429, 500, 502, 503, 504.
func doWithRetry(ctx context.Context, client *http.Client, req *http.Request) (*http.Response, error) {
	bodyBytes := []byte(nil)
	if req.Body != nil {
		var err error
		bodyBytes, err = io.ReadAll(req.Body)
		req.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("failed to buffer request body: %w", err)
		}
	}

	var lastErr error
	for attempt := 0; attempt <= MaxRequestRetries; attempt++ {
		if attempt > 0 {
			// Exponential backoff: 1s, 2s, 4s...
			backoff := time.Duration(1<<uint(attempt-1)) * time.Second
			log.Printf("openaichat: retrying request (attempt %d/%d) after %s (last error: %v)", attempt+1, MaxRequestRetries+1, backoff, lastErr)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(backoff):
			}
		}

		attemptReq := req.Clone(ctx)
		if bodyBytes != nil {
			attemptReq.Body = io.NopCloser(bytes.NewReader(bodyBytes))
			attemptReq.ContentLength = int64(len(bodyBytes))
			attemptReq.GetBody = func() (io.ReadCloser, error) {
				return io.NopCloser(bytes.NewReader(bodyBytes)), nil
			}
		}

		resp, err := client.Do(attemptReq)
		if err != nil {
			lastErr = err
			continue
		}
		if !isRetryableStatus(resp.StatusCode) {
			return resp, nil
		}

		// Drain and close so the connection can be reused.
		errBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		lastErr = fmt.Errorf("API returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(errBody)))
	}

	return nil, fmt.Errorf("request failed after %d attempts: %w", MaxRequestRetries+1, lastErr)
}

// isRetryableStatus reports whether the status code represents a transient
// upstream condition worth retrying.
func isRetryableStatus(code int) bool {
	switch code {
	case http.StatusRequestTimeout, http.StatusTooManyRequests,
		http.StatusInternalServerError, http.StatusBadGateway,
		http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	}
	return false
}

// RunChatStep executes a chat step using the chat completions API
// formatStreamError renders a provider error payload into a readable message.
// MiniMax returns {"type":"error","error":{"type":..,"message":..,"code":..,"http_code":..}}
// which, when printed with %v, shows a raw Go map. This extracts the useful fields.
func formatStreamError(errPayload interface{}) string {
	switch e := errPayload.(type) {
	case string:
		return e
	case map[string]interface{}:
		// Some providers nest the details one level deeper.
		if inner, ok := e["error"].(map[string]interface{}); ok {
			return formatStreamError(inner)
		}
		msg, _ := e["message"].(string)
		code, _ := e["code"].(string)
		etype, _ := e["type"].(string)
		parts := []string{}
		if msg != "" {
			parts = append(parts, msg)
		}
		label := code
		if label == "" {
			label = etype
		}
		if label != "" {
			parts = append(parts, fmt.Sprintf("(%s)", label))
		}
		if len(parts) == 0 {
			return fmt.Sprintf("%v", e)
		}
		return strings.Join(parts, " ")
	default:
		return fmt.Sprintf("%v", errPayload)
	}
}

// isTransientStreamError reporta si un error embebido en el SSE es un fallo
// transitorio del upstream (MiniMax devuelve este payload cuando su nodo de
// inferencia esta frio o el gateway aborta antes del primer token).
func isTransientStreamError(errText string) bool {
	e := strings.ToLower(errText)
	return strings.Contains(e, "internal_error") ||
		strings.Contains(e, "internal server error") ||
		strings.Contains(e, "temporarily unavailable") ||
		strings.Contains(e, "overloaded")
}

const (
	// maxStreamRestarts acota cuantos reinicios silenciosos se hacen por turno.
	// 8 intentos cubren rafagas de cold start del gateway de MiniMax-M3, donde
	// varios nodos consecutivos pueden devolver internal_error antes de que uno
	// responda completo. Cada intento reproduce bodyBytes ya bufferizado, asi que
	// el coste extra es solo latencia (backoff exponencial acotado).
	maxStreamRestarts = 8
	// streamRestartBaseBackoff es la pausa antes del primer reintento del turno.
	// Con cold start del gateway de MiniMax-M3 el primer token puede tardar
	// decenas de segundos: un backoff fijo de 500ms cae dentro de la misma
	// ventana fria y garantiza un segundo fallo.
	streamRestartBaseBackoff = 1500 * time.Millisecond
	// firstTokenStallTimeout aborta el intento si el nodo no emitio NINGUN
	// chunk en este plazo. Conviert e un cold start colgado en un reintento
	// inmediato en lugar de dejar al usuario mirando un spinner.
	firstTokenStallTimeout = 90 * time.Second
	// streamRestartMaxBackoff es el techo del backoff entre reinicios silenciosos.
	streamRestartMaxBackoff = 8 * time.Second
)

// streamRestartBackoffFor devuelve el backoff exponencial (1.5s, 3s, 6s...)
// del reintento n-esimo (0-based).
func streamRestartBackoffFor(restart int) time.Duration {
	if restart <= 0 {
		return streamRestartBaseBackoff
	}
	d := streamRestartBaseBackoff << uint(restart)
	// Tope: sin cap el backoff se dispara a minutos (1.5s<<7 = 3m12s) y el
	// usuario cree que el turno se colgo.
	if d > streamRestartMaxBackoff {
		return streamRestartMaxBackoff
	}
	return d
}

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

	if isBridge || chatOpts.TokenMode != "" {
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
				genericMsg := uctypes.ConvertToGenericAIMessage(genMsg)
				if genericMsg != nil {
					var err error
					chatMsg, err = ConvertAIMessageToStoredChatMessage(*genericMsg)
					if err != nil {
						return nil, nil, nil, fmt.Errorf("failed to convert generic AIMessage: %w", err)
					}
				} else {
					return nil, nil, nil, fmt.Errorf("expected StoredChatMessage or *uctypes.AIMessage, got %T", genMsg)
				}
			}
		}
		messages = append(messages, *chatMsg.Message.clean())
	}

	req, err := buildChatHTTPRequest(ctx, messages, chatOpts)
	if err != nil {
		return nil, nil, nil, err
	}

	client := &http.Client{}

	// Retry transient upstream failures (5xx / 429). Providers like MiniMax
	// intermittently return 500 "internal_error" even on valid payloads; without
	// a retry the whole chat turn dies and the user has to re-send it.
	resp, err := doWithRetry(ctx, client, req)
	if err != nil {
		// El turno muere antes de abrir el stream. Sin notificar por SSE el
		// cliente solo ve un 500 del handler, sin modelo, provider ni la causa
		// real que devolvio el upstream. Emitimos el error por el canal para
		// que el mensaje sea accionable.
		if setupErr := sseHandler.SetupSSE(); setupErr == nil {
			_ = sseHandler.WriteError(fmt.Sprintf("Proveedor %s respondio con error (modelo: %s): %v", chatOpts.Config.Provider, chatOpts.Config.Model, err))
			return nil, nil, nil, fmt.Errorf("request failed: %w", err)
		}
		return nil, nil, nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		if setupErr := sseHandler.SetupSSE(); setupErr == nil {
			_ = sseHandler.WriteError(fmt.Sprintf("Proveedor %s devolvio HTTP %d (modelo: %s): %s", chatOpts.Config.Provider, resp.StatusCode, chatOpts.Config.Model, strings.TrimSpace(string(bodyBytes))))
		}
		return nil, nil, nil, fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	contentType := resp.Header.Get("Content-Type")
	log.Printf("openaichat TRACE 2: Bridge response Content-Type: %s (isBridge: %v)\n", contentType, isBridge)
	// El cuerpo del stream se bufferiza UNA sola vez para que los reintentos
	// silenciosos puedan rebobinarlo. resp.Body es read-once: al reusarlo, el
	// eventsource.Decoder siguiente recibe un reader vacio, devuelve io.EOF al
	// instante y el watchdog de primer token gasta 90s esperando un token de un
	// request que nunca se envio. Ese era el motivo real de restart=0.
	var streamBodyBytes []byte
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

	// Cuerpo a memoria: resp.Body es read-once y los reintentos necesitan
	// rebobinarlo. Aqui ya esta resuelto el reader definitivo del stream.
	if streamBodyBytes == nil {
		if raw, rErr := io.ReadAll(bodyReader); rErr == nil {
			streamBodyBytes = raw
		} else {
			log.Printf("openaichat: no se pudo bufferizar el cuerpo del stream (retries deshabilitados): %v\n", rErr)
		}
	}

	// Setup SSE now that we have the final bodyReader ready
	if cont == nil {
		if err := sseHandler.SetupSSE(); err != nil {
			return nil, nil, nil, fmt.Errorf("failed to setup SSE: %w", err)
		}
	}

	// Stream processing
	stopReason, assistantMsg, err := processChatStream(ctx, bodyReader, streamBodyBytes, sseHandler, chatOpts, cont)
	if err != nil {
		return nil, nil, nil, err
	}

	var msgs []*StoredChatMessage
	if assistantMsg != nil {
		if assistantMsg.Usage == nil || (assistantMsg.Usage.InputTokens == 0 && assistantMsg.Usage.OutputTokens == 0) {
			inputTok := 0
			for _, m := range messages {
				inputTok += getMessageEffectiveTokens(m)
			}
			outputTok := aiutil.EstimateTokens(assistantMsg.Message.Content)
			for _, tc := range assistantMsg.Message.ToolCalls {
				outputTok += 50 + aiutil.EstimateTokens(tc.Function.Arguments)
			}
			if outputTok == 0 {
				outputTok = 1
			}
			assistantMsg.Usage = &ChatUsage{
				InputTokens:  inputTok,
				OutputTokens: outputTok,
				TotalTokens:  inputTok + outputTok,
			}
		}
		msgs = []*StoredChatMessage{assistantMsg}
	}
	return stopReason, msgs, nil, nil
}

func processChatStream(
	ctx context.Context,
	body io.Reader,
	bodyBytes []byte,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.GulinChatOpts,
	cont *uctypes.GulinContinueResponse,
) (*uctypes.GulinStopReason, *StoredChatMessage, error) {
	return processChatStreamAttempt(ctx, body, bodyBytes, sseHandler, chatOpts, cont, 0)
}

// processChatStreamAttempt implementa el streaming. restart cuenta los
// reinicios silenciosos ya consumidos en este turno.
func processChatStreamAttempt(
	ctx context.Context,
	body io.Reader,
	bodyBytes []byte,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.GulinChatOpts,
	cont *uctypes.GulinContinueResponse,
	restart int,
) (*uctypes.GulinStopReason, *StoredChatMessage, error) {
	return processChatStreamAttemptPrefix(ctx, body, bodyBytes, sseHandler, chatOpts, cont, restart, "")
}

// processChatStreamAttemptPrefix es processChatStreamAttempt con soporte para
// reanudar un turno que murio a mitad del texto. partialPrefix contiene el texto
// ya emitido al cliente: se usa para descartar el eco del reintento (el nuevo
// stream repite desde el principio) y para reconstruir el mensaje persistido
// completo.
func processChatStreamAttemptPrefix(
	ctx context.Context,
	body io.Reader,
	bodyBytes []byte,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.GulinChatOpts,
	cont *uctypes.GulinContinueResponse,
	restart int,
	partialPrefix string,
) (*uctypes.GulinStopReason, *StoredChatMessage, error) {
	// Watchdog de primer token: si el upstream no entrega NADA en
	// firstTokenStallTimeout se trata como fallo transitorio y se reintenta.
	// Sin esto un cold start del gateway de MiniMax deja el turno colgado sin
	// que el auto-retry llegue a dispararse nunca.
	attemptCtx, cancelAttempt := context.WithCancel(ctx)
	defer cancelAttempt()
	// firstChunk se escribe en la goroutine del decoder y se lee en la del
	// watchdog: DEBE ser atomico. Un bool plano es un data race que -race marca.
	var firstChunk atomic.Bool
	var stallErr atomic.Value
	go func() {
		timer := time.NewTimer(firstTokenStallTimeout)
		defer timer.Stop()
		select {
		case <-attemptCtx.Done():
			return
		case <-timer.C:
			if !firstChunk.Load() {
				stallErr.Store("internal_error: upstream no emitio el primer token en " + firstTokenStallTimeout.String())
				cancelAttempt()
			}
		}
	}()
	// El decoder consume una copia: el body original queda intacto y sirve para
	// rebobinar en los reintentos (resp.Body es read-once).
	decoderBody := body
	if bodyBytes != nil {
		decoderBody = bytes.NewReader(bodyBytes)
	}
	decoder := eventsource.NewDecoder(decoderBody)

	// rebobinar reconstruye el reader del stream desde el buffer para el proximo
	// intento. Sin esto cualquier retry se hace sobre un body ya consumido.
	rebobinar := func() io.Reader {
		if bodyBytes != nil {
			return bytes.NewReader(bodyBytes)
		}
		return body
	}
	var textBuilder strings.Builder
	// Reanudacion mid-stream: el texto ya emitido al cliente se usa como prefijo.
	// Asi el mensaje persistido queda completo y todo el contenido se escribe un
	// solo texto en el chat.
	if partialPrefix != "" {
		textBuilder.WriteString(partialPrefix)
	}
	msgID := uuid.New().String()
	textID := uuid.New().String()
	reasoningID := uuid.New().String()
	// reasoningBuilder acumula el thinking del turno: MiniMax-M3 exige que se
	// devuelva intacto en el siguiente request o su gateway responde 500
	// "internal_error" a mitad de la siguiente ronda de tool calls.
	var reasoningBuilder strings.Builder
	var finalUsage *ChatUsage
	var finishReason string
	// reanudando: en intentos con partialPrefix, el upstream re-emite el texto
	// desde el principio. Solapamos con el prefijo y descartamos la parte ya
	// visible en el cliente para no duplicarla.
	reanudando := partialPrefix != ""
	ecoConsumido := false
	textStarted := false
	reasoningStarted := false
	var toolCallsInProgress []ToolCall
	// guardarFallback cierra los bloques abiertos y persiste el texto ya
	// streameado cuando el upstream muere a mitad del turno, para no perder
	// la respuesta parcial en el chat.
	guardarFallback := func() *StoredChatMessage {
		if textStarted {
			_ = sseHandler.AiMsgTextEnd(textID)
		}
		if reasoningStarted {
			_ = sseHandler.AiMsgReasoningEnd(reasoningID)
		}
		_ = sseHandler.AiMsgFinishStep()
		return extractPartialTextMessage(msgID, textBuilder.String())
	}

	// guardarFallbackConTools persiste lo recibido cuando el upstream muere a
	// mitad de una ronda de TOOL CALLS. Sin esto el assistantMsg se perdia y el
	// historial quedaba sin las tool_calls que el runtime ya habia ejecutado:
	// el proveedor no veia el pairing, volvia a pedir la misma herramienta y el
	// turno entraba en bucle infinito hasta que su gateway respondia 500
	// "internal_error" (observado en MiniMax con herramientas pesadas como
	// git log, read_text_file, git diff...).
	guardarFallbackConTools := func() *StoredChatMessage {
		if textStarted {
			_ = sseHandler.AiMsgTextEnd(textID)
		}
		if reasoningStarted {
			_ = sseHandler.AiMsgReasoningEnd(reasoningID)
		}
		_ = sseHandler.AiMsgFinishStep()

		msg := extractPartialTextMessage(msgID, textBuilder.String())
		if msg == nil {
			msg = &StoredChatMessage{
				MessageId: msgID,
				Message:   ChatRequestMessage{Role: "assistant"},
			}
		}
		// Sin el reasoning el siguiente request rompe el interleaved thinking.
		if reasoningBuilder.Len() > 0 {
			msg.Message.ReasoningContent = reasoningBuilder.String()
		}

		var salvadas []ToolCall
		for _, tc := range toolCallsInProgress {
			if tc.Function.Name == "" {
				continue
			}
			// Argumentos truncados a medias no se pueden reconstruir:
			// emitirlos haria fallar el parseo del siguiente turno.
			if tc.Function.Arguments != "" && !json.Valid([]byte(tc.Function.Arguments)) {
				log.Printf("openaichat: descartando tool call %q con argumentos truncados\n", tc.Function.Name)
				continue
			}
			if tc.ID == "" {
				tc.ID = "call_" + tc.Function.Name
			}
			salvadas = append(salvadas, tc)
		}
		if len(salvadas) > 0 {
			msg.Message.ToolCalls = salvadas
			log.Printf("openaichat: preservando %d tool call(s) tras corte del upstream para mantener el pairing\n", len(salvadas))
		}
		return msg
	}

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
			// El watchdog cancelo el intento por falta de primer token: se
			// trata como fallo transitorio y se reintenta en vez de propagar
			// un "context canceled" incomprensible al usuario.
			if stall, _ := stallErr.Load().(string); stall != "" {
				log.Printf("openaichat: intento abortado por stall de primer token (restart=%d)\n", restart)
				if restart < maxStreamRestarts {
							// El turno puede reanudarse aunque ya se haya emitido texto:
							// ese texto viaja como partialPrefix. Antes esta guarda lo
							// convertia en aborto silencioso.
					select {
					case <-ctx.Done():
						return &uctypes.GulinStopReason{Kind: uctypes.StopKindCanceled, ErrorType: "cancelled", ErrorText: "request cancelled"}, nil, ctx.Err()
					case <-time.After(streamRestartBackoffFor(restart)):
					}
					return processChatStreamAttemptPrefix(ctx, rebobinar(), bodyBytes, sseHandler, chatOpts, cont, restart+1, textBuilder.String())
				}
				_ = sseHandler.AiMsgError(stall)
				return &uctypes.GulinStopReason{Kind: uctypes.StopKindError, ErrorType: "stream_api", ErrorText: stall}, nil, nil
			}
			if errors.Is(err, io.EOF) {
				break
			}
			if sseHandler.Err() != nil {
				partialMsg := guardarFallback()
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

		firstChunk.Store(true)
		data := event.Data()
		if data == "[DONE]" {
			break
		}
		// Log every chunk for deep investigation of Bridge/Provider differences.
		// Gated behind dev mode: this fires once per SSE chunk and was writing
		// ~5MB per session (200MB+ rotated logs), which is pure noise in prod.
		if gulinbase.IsDevMode() {
			log.Printf("openaichat chunk DEBUG: %s", data)
		}

		// Detect embedded errors in the SSE stream
		var rawChunk struct {
			Error interface{} `json:"error"`
		}
		if err := json.Unmarshal([]byte(data), &rawChunk); err == nil && rawChunk.Error != nil {
			errText := formatStreamError(rawChunk.Error)
			log.Printf("openaichat: upstream stream error mid-turn (partial_text_len=%d, tool_calls=%d, restart=%d): %s\n", textBuilder.Len(), len(toolCallsInProgress), restart, errText)

			// Auto-retry transparente: MiniMax devuelve internal_error intermitente
			// (cold start de su gateway). Antes solo se reintentaba si el corte
			// llegaba ANTES de emitir nada; en la practica el 500 cae a mitad del
			// texto ("...y lo ejecuto en ambos nodos") y el turno moria dejando al
			// usuario con media frase. Ahora tambien se reintenta con texto ya
			// emitido: el reintento usa cont != nil, lo que evita reabrir el
			// mensaje (AiMsgStart) y re-emitir el texto ya visible (se pasa como
			// prefijo y solo se descarta). Las tool calls parciales se conservan
			// igual que en guardarFallbackConTools.
			if isTransientStreamError(errText) && restart < maxStreamRestarts &&
				len(toolCallsInProgress) == 0 {
				redoCont := cont
				if redoCont == nil {
					redoCont = &uctypes.GulinContinueResponse{Model: chatOpts.Config.Model, ContinueFromKind: uctypes.StopKindError}
				}
				// El texto ya emitido se manda como prefijo para que el reintento
				// no lo duplique (partialPrefix se descarta al reconstruir el msg).
				partialPrefix := textBuilder.String()
				log.Printf("openaichat: reintentando turno en silencio tras error transitorio (intento %d/%d, prefijo=%d chars)\n", restart+1, maxStreamRestarts, len(partialPrefix))
				select {
				case <-ctx.Done():
					return &uctypes.GulinStopReason{Kind: uctypes.StopKindCanceled, ErrorType: "cancelled", ErrorText: "request cancelled"}, nil, ctx.Err()
				case <-time.After(streamRestartBackoffFor(restart)):
				}
				return processChatStreamAttemptPrefix(ctx, rebobinar(), bodyBytes, sseHandler, chatOpts, redoCont, restart+1, partialPrefix)
			}

			// El upstream falló a mitad del stream (típico de MiniMax y proxies:
			// un 500 después de haber emitido texto). Conservamos lo recibido y
			// NO abortamos el turno: así el cliente no pierde la respuesta ya
			// streameada ni se dispara el superfluous WriteHeader del handler.
			_ = sseHandler.AiMsgError(errText)
			// Corte con tool calls ya emitidas: se persisten junto al texto parcial
			// para que el siguiente turno cierre el pairing. Si se descartan, el
			// modelo repite las mismas herramientas en bucle hasta el 500.
			if len(toolCallsInProgress) > 0 {
				partialMsg := guardarFallbackConTools()
				return &uctypes.GulinStopReason{
					Kind:      uctypes.StopKindError,
					ErrorType: "stream_api",
					ErrorText: errText,
				}, partialMsg, nil
			}
			if textBuilder.Len() > 0 {
				partialMsg := guardarFallback()
				return &uctypes.GulinStopReason{
					Kind:      uctypes.StopKindError,
					ErrorType: "stream_api",
					ErrorText: errText,
				}, partialMsg, nil
			}
			return &uctypes.GulinStopReason{
				Kind:      uctypes.StopKindError,
				ErrorType: "stream_api",
				ErrorText: errText,
			}, nil, fmt.Errorf("AI stream error: %s", errText)
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
		// Detect data-tokenusage format embedded in the SSE stream
		if strings.Contains(data, "data-tokenusage") {
			var tokenData struct {
				Type string `json:"type"`
				Data struct {
					Input  int `json:"input"`
					Output int `json:"output"`
					Total  int `json:"total"`
				} `json:"data"`
			}
			if err := json.Unmarshal([]byte(data), &tokenData); err == nil && tokenData.Type == "data-tokenusage" {
				finalUsage = &ChatUsage{
					InputTokens:  tokenData.Data.Input,
					OutputTokens: tokenData.Data.Output,
					TotalTokens:  tokenData.Data.Total,
				}
				log.Printf("openaichat: Detected token usage from Bridge stream: %v", finalUsage)
			}
			continue
		}

		var chunk StreamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			log.Printf("openaichat: failed to parse chunk: %v (raw data: %s)", err, data)
			continue
		}

		if chunk.Usage != nil {
			finalUsage = &ChatUsage{
				InputTokens:  chunk.Usage.InputTokens,
				OutputTokens: chunk.Usage.OutputTokens,
				TotalTokens:  chunk.Usage.TotalTokens,
			}
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

		// Reasoning trace: MiniMax/DeepSeek emit it as `reasoning_content` in
		// the delta. It used to be dropped entirely because ContentDelta had no
		// such field. Stream it as a separate reasoning block so the UI can show
		// it (the frontend already renders reasoning parts).
		if reasoning := delta.GetReasoning(); reasoning != "" {
			if !reasoningStarted {
				_ = sseHandler.AiMsgReasoningStart(reasoningID)
				reasoningStarted = true
			}
			reasoningBuilder.WriteString(reasoning)
			_ = sseHandler.AiMsgReasoningDelta(reasoningID, reasoning)
		}

		if content != "" {
			if reanudando {
				var emit string
				emit, ecoConsumido = recortarEco(partialPrefix, content, ecoConsumido)
				content = emit
			}
			if content != "" {
				if !textStarted {
					_ = sseHandler.AiMsgTextStart(textID)
					textStarted = true
				}
				textBuilder.WriteString(content)
				_ = sseHandler.AiMsgTextDelta(textID, content)
			}
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
	// Interleaved thinking (MiniMax-M3, DeepSeek-R1): el reasoning del turno
	// debe volver al proveedor en el siguiente request. Si se omite, MiniMax
	// responde 500 "internal_error" en cuanto la conversacion sigue.
	if reasoningBuilder.Len() > 0 {
		assistantMsg.Message.ReasoningContent = reasoningBuilder.String()
	}
	if finalUsage != nil {
		assistantMsg.Usage = finalUsage
	}

	if textStarted {
		_ = sseHandler.AiMsgTextEnd(textID)
	}
	if reasoningStarted {
		_ = sseHandler.AiMsgReasoningEnd(reasoningID)
	}
	_ = sseHandler.AiMsgFinishStep()

	if gulinbase.IsDevMode() {
		if textBuilder.Len() > 0 {
			log.Printf("openaichat: raw response text (len=%d): %q\n", textBuilder.Len(), textBuilder.String())
		}
		if len(toolCallsInProgress) > 0 {
			log.Printf("openaichat: tool calls detected: %d\n", len(toolCallsInProgress))
		}
	}

	return stopReason, assistantMsg, nil
}

// recortarEco descarta del delta el tramo de texto que el upstream re-emite y
// que YA fue enviado al cliente antes del corte (partialPrefix). Se usa al
// reanudar un turno abortado por un internal_error mid-stream: el reintento
// repite la respuesta desde el principio y, sin este filtro, el usuario veria
// el mismo parrafo dos veces.
//
// ecoConsumido marca que el solapamiento con el prefijo ya termino; a partir de
// ahi el delta se emite integro y se puede concatenar con seguridad.
//
// El filtro compara el SUFIJO del prefijo con el PREFIJO del delta (el tramo
// donde el reintento se solapa con lo ya emitido). Como el stream llega
// troceado en deltas arbitrarios, el solape puede partirse: un delta puede
// contener solo la mitad del solape pendiente y consumirlo completo (devuelve
// "" y sigue sin consumir), o contener el resto del solape mas texto nuevo
// (devuelve el excedente y marca consumido).
func recortarEco(prefix, delta string, hecho bool) (string, bool) {
	if hecho || prefix == "" || delta == "" {
		return delta, hecho
	}

	// minSolapeEco evita que una coincidencia de pocos caracteres (probable por
	// azar) haga descartar texto nuevo creyendo que es eco.
	const minSolapeEco = 4

	// 1) El delta cubre el prefijo completo: es eco y agota todo lo visible, el
	//    eco termino; lo que sobre del delta es texto nuevo.
	if strings.HasPrefix(delta, prefix) {
		if len(delta) == len(prefix) {
			return "", true
		}
		return delta[len(prefix):], true
	}

	// 2) El delta entero cae dentro del prefijo (eco puro en cualquier posicion:
	//    el reintento a veces repite desde el inicio de la respuesta).
	if strings.Contains(prefix, delta) && len(delta) >= minSolapeEco {
		return "", false
	}

	// 3) Solape en el borde: sufijo[prefix] == prefijo[delta]. Cubre el eco
	//    troceado, donde el trozo actual solo contiene parte del solape.
	maxSolape := len(delta)
	if len(prefix) < maxSolape {
		maxSolape = len(prefix)
	}
	for n := maxSolape; n >= minSolapeEco; n-- {
		if prefix[len(prefix)-n:] != delta[:n] {
			continue
		}
		if n == len(delta) {
			return "", false // trozo de eco sin excedente todavia
		}
		return delta[n:], true
	}

	// 4) Sin solape significativo: el reintento aporto texto nuevo, se emite integro.
	return delta, true
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
