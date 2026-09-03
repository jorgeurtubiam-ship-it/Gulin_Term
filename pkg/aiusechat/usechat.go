// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/user"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gulindev/gulin/pkg/aiusechat/aiutil"
	"github.com/gulindev/gulin/pkg/aiusechat/chatstore"
	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/secretstore"
	"github.com/gulindev/gulin/pkg/telemetry"
	"github.com/gulindev/gulin/pkg/telemetry/telemetrydata"
	"github.com/gulindev/gulin/pkg/util/ds"
	"github.com/gulindev/gulin/pkg/util/logutil"
	"github.com/gulindev/gulin/pkg/util/utilfn"
	"github.com/gulindev/gulin/pkg/gulinapp"
	"github.com/gulindev/gulin/pkg/gulinappstore"
	"github.com/gulindev/gulin/pkg/gulinbase"
	"github.com/gulindev/gulin/pkg/gulinobj"
	"github.com/gulindev/gulin/pkg/web/sse"
	"github.com/gulindev/gulin/pkg/wps"
	"github.com/gulindev/gulin/pkg/wshrpc"
	"github.com/gulindev/gulin/pkg/wshrpc/wshclient"
	"github.com/gulindev/gulin/pkg/wstore"
)

const DefaultAPI = uctypes.APIType_OpenAIResponses
const DefaultMaxTokens = 4 * 1024
const BuilderMaxTokens = 24 * 1024

var (
	globalRateLimitInfo = &uctypes.RateLimitInfo{Unknown: true}
	rateLimitLock       sync.Mutex

	activeChats = ds.MakeSyncMap[context.CancelFunc]() // key is chatid
)

func CancelActiveChat(chatId string) {
	if cancel, ok := activeChats.GetEx(chatId); ok {
		log.Printf("canceling active chat %s\n", chatId)
		cancel()
		activeChats.Delete(chatId)
	}
}

type CancelChatRequest struct {
	ChatID string `json:"chatid"`
}

func GulinAICancelChatHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req CancelChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	if req.ChatID == "" {
		http.Error(w, "chatid is required in request body", http.StatusBadRequest)
		return
	}

	CancelActiveChat(req.ChatID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func getSystemPrompt(apiType string, model string, isBuilder bool, hasToolsCapability bool, widgetAccess bool, aiMode string) []string {
	if isBuilder {
		return []string{}
	}

	var prompts []string
	useNoToolsPrompt := !hasToolsCapability || !widgetAccess

	modelLower := strings.ToLower(model)
	isLiteModel := (strings.Contains(modelLower, "lite") || strings.Contains(modelLower, "flash") || (strings.Contains(modelLower, "mini") && !strings.Contains(modelLower, "minimax")))

	// Verificar si es un modo de Agente Experto específico
	for expertID, expert := range Experts {
		if strings.Contains(aiMode, string(expertID)) {
			prompts = append(prompts, expert.SystemPromptFunc())
			goto finalize
		}
	}

	// Si es el Orquestador y NO es un modelo Lite, usamos el prompt de Comandante
	if strings.Contains(aiMode, "@orchestrate") && !isLiteModel {
		prompts = append(prompts, GetSystemPrompt_Orchestrator())
	} else {
		basePrompt := GetSystemPromptText_OpenAI()
		if useNoToolsPrompt {
			basePrompt = GetSystemPromptText_NoTools()
		}

		prompts = append(prompts, basePrompt)

		if !useNoToolsPrompt {
			if strings.HasSuffix(aiMode, "@plan") {
				prompts = append(prompts, GetSystemPrompt_Plan())
			} else if strings.HasSuffix(aiMode, "@act") {
				prompts = append(prompts, GetSystemPrompt_Act())
			}
		}
	}

finalize:
	// Los modelos Lite (Gemini Flash, GPT-4o-mini) en el Bridge se confunden con el Strict AddOn.
	// Solo lo usaremos para modelos locales o proveedores que requieran ejecución estricta.
	needsStrictToolAddOn, _ := regexp.MatchString(`(?i)\b(mistral|o?llama|qwen|mixtral|yi|phi|deepseek|minimax)\b`, modelLower)
	if needsStrictToolAddOn && !useNoToolsPrompt {
		prompts = append(prompts, GetSystemPromptText_StrictToolAddOn())
	}

	// INYECCIÓN GLOBAL: Mapa de Infraestructura (Senior Grade)
	if !isBuilder && widgetAccess {
		prompts = append(prompts, GetSystemPrompt_NeuralBrain())
	}

	return prompts
}

func isLocalEndpoint(endpoint string) bool {
	if endpoint == "" {
		return false
	}
	endpointLower := strings.ToLower(endpoint)
	return strings.Contains(endpointLower, "localhost") || strings.Contains(endpointLower, "127.0.0.1")
}

func getGulinAISettings(premium bool, builderMode bool, rtInfo gulinobj.ObjRTInfo, aiModeName string) (*uctypes.AIOptsType, error) {
	maxTokens := DefaultMaxTokens
	if builderMode {
		maxTokens = BuilderMaxTokens
	}
	if rtInfo.GulinAIMaxOutputTokens > 0 {
		maxTokens = rtInfo.GulinAIMaxOutputTokens
	}
	aiMode, config, err := resolveAIMode(aiModeName, premium)
	if err != nil {
		return nil, err
	}
	if config.GulinAICloud && !telemetry.IsTelemetryEnabled() {
		return nil, fmt.Errorf("Gulin AI cloud modes require telemetry to be enabled")
	}
	apiToken := config.APIToken
	if apiToken == "" && config.APITokenSecretName != "" {
		secret, exists, err := secretstore.GetSecret(config.APITokenSecretName)
		if err != nil {
			return nil, fmt.Errorf("failed to retrieve secret %s: %w", config.APITokenSecretName, err)
		}
		secret = strings.TrimSpace(secret)
		if !exists || secret == "" {
			return nil, fmt.Errorf("secret %s not found or empty", config.APITokenSecretName)
		}
		apiToken = secret
	}

	var baseUrl string
	if config.Endpoint != "" {
		baseUrl = config.Endpoint
	} else {
		return nil, fmt.Errorf("no ai:endpoint configured for AI mode %s", aiMode)
	}

	thinkingLevel := config.ThinkingLevel
	if thinkingLevel == "" {
		thinkingLevel = uctypes.ThinkingLevelMedium
	}
	verbosity := config.Verbosity
	if verbosity == "" {
		verbosity = uctypes.VerbosityLevelMedium // default to medium
	}
	opts := &uctypes.AIOptsType{
		Provider:      config.Provider,
		APIType:       config.APIType,
		Model:         config.Model,
		MaxTokens:     maxTokens,
		ThinkingLevel: thinkingLevel,
		Verbosity:     verbosity,
		AIMode:        aiMode,
		Endpoint:      baseUrl,
		Capabilities:  config.Capabilities,
		GulinAIPremium: config.GulinAIPremium,
		BridgeProvider: config.BridgeProvider,
		AgentID:        config.AgentID,
		APITokenSecretName: config.APITokenSecretName,
	}
	if apiToken != "" {
		opts.APIToken = apiToken
	}
	return opts, nil
}

func shouldUseChatCompletionsAPI(model string) bool {
	m := strings.ToLower(model)
	// Chat Completions API is required for older models: gpt-3.5-*, gpt-4, gpt-4-turbo, o1-*
	return strings.HasPrefix(m, "gpt-3.5") ||
		strings.HasPrefix(m, "gpt-4-") ||
		m == "gpt-4" ||
		strings.HasPrefix(m, "o1-")
}

func shouldUsePremium() bool {
	info := GetGlobalRateLimit()
	if info == nil || info.Unknown {
		return true
	}
	if info.PReq > 0 {
		return true
	}
	nowEpoch := time.Now().Unix()
	if nowEpoch >= info.ResetEpoch {
		return true
	}
	return false
}

func updateRateLimit(info *uctypes.RateLimitInfo) {
	if info == nil {
		return
	}
	rateLimitLock.Lock()
	defer rateLimitLock.Unlock()
	globalRateLimitInfo = info
	go func() {
		wps.Broker.Publish(wps.GulinEvent{
			Event: wps.Event_GulinAIRateLimit,
			Data:  info,
		})
	}()
}

func GetGlobalRateLimit() *uctypes.RateLimitInfo {
	rateLimitLock.Lock()
	defer rateLimitLock.Unlock()
	return globalRateLimitInfo
}

func runAIChatStep(ctx context.Context, sseHandler *sse.SSEHandlerCh, backend UseChatBackend, chatOpts uctypes.GulinChatOpts, cont *uctypes.GulinContinueResponse) (*uctypes.GulinStopReason, []uctypes.GenAIMessage, error) {
	if chatOpts.Config.APIType == uctypes.APIType_OpenAIResponses && shouldUseChatCompletionsAPI(chatOpts.Config.Model) {
		return nil, nil, fmt.Errorf("Chat completions API not available (must use newer OpenAI models)")
	}
	stopReason, messages, rateLimitInfo, err := backend.RunChatStep(ctx, sseHandler, chatOpts, cont)
	updateRateLimit(rateLimitInfo)
	return stopReason, messages, err
}

func getUsage(msgs []uctypes.GenAIMessage) uctypes.AIUsage {
	var rtn uctypes.AIUsage
	var found bool
	for _, msg := range msgs {
		if msg == nil {
			continue
		}
		if usage := msg.GetUsage(); usage != nil {
			if !found {
				rtn = *usage
				found = true
			} else {
				rtn.InputTokens += usage.InputTokens
				rtn.OutputTokens += usage.OutputTokens
				rtn.NativeWebSearchCount += usage.NativeWebSearchCount
			}
		}
	}
	return rtn
}

func GetChatUsage(chat *uctypes.AIChat) uctypes.AIUsage {
	usage := getUsage(chat.NativeMessages)
	usage.APIType = chat.APIType
	usage.Model = chat.Model
	return usage
}

func updateToolUseDataInChat(backend UseChatBackend, chatOpts uctypes.GulinChatOpts, toolCallID string, toolUseData uctypes.UIMessageDataToolUse) {
	if err := backend.UpdateToolUseData(chatOpts.ChatId, toolCallID, toolUseData); err != nil {
		log.Printf("failed to update tool use data in chat: %v\n", err)
	}
}

func processToolCall(ctx context.Context, backend UseChatBackend, toolCall uctypes.GulinToolCall, chatOpts uctypes.GulinChatOpts, sseHandler *sse.SSEHandlerCh, metrics *uctypes.AIMetrics, expertID string) uctypes.AIToolResult {
	log.Printf("AI tool %s id=%s input=%v\n", toolCall.Name, toolCall.ID, toolCall.Input)
	
	toolDef := chatOpts.GetToolDefinition(toolCall.Name)
	
	// ResolveToolCall maneja validación, esperas de aprobación (PLAN) y keep-alive SSE
	result := ResolveToolCall(ctx, toolDef, toolCall, chatOpts, sseHandler)

	// Interceptor para 'call_expert': Ejecución secuencial delegada
	if toolCall.Name == "call_expert" && result.ErrorText == "" {
		expertID, _ := toolCall.Input.(map[string]any)["expert_id"].(string)
		task, _ := toolCall.Input.(map[string]any)["task"].(string)
		log.Printf("ORCHESTRATOR delegando tarea a %s: %s\n", expertID, task)
		
		resultText, err := runExpertSubChat(ctx, backend, chatOpts, sseHandler, expertID, task)
		if err != nil {
			result.ErrorText = fmt.Sprintf("error delegando al experto %s: %v", expertID, err)
			if toolCall.ToolUseData != nil {
				toolCall.ToolUseData.Status = uctypes.ToolUseStatusError
				toolCall.ToolUseData.ErrorMessage = result.ErrorText
			}
		} else {
			result.Text = resultText
			if toolCall.ToolUseData != nil {
				toolCall.ToolUseData.Status = uctypes.ToolUseStatusCompleted
			}
		}
	}

	if result.ErrorText != "" {
		log.Printf("  error=%s\n", result.ErrorText)
		metrics.ToolUseErrorCount++
		// 🧠 Reflection Engine: analizar el fallo y guardar insight en el proyecto activo
		if chatOpts.TabState != "" {
			go ReflectOnToolFailure(toolCall.Name, result.ErrorText, chatOpts.TabState)
		}
	} else {
		log.Printf("  result=%s\n", utilfn.TruncateString(result.Text, 40))
	}

	if toolDef != nil && toolDef.ToolLogName != "" {
		if metrics.ToolDetail == nil {
			metrics.ToolDetail = make(map[string]int)
		}
		metrics.ToolDetail[toolDef.ToolLogName]++
	}

	if toolCall.ToolUseData != nil {
		// Update generic tool status if not already set by expert interceptor
		if toolCall.ToolUseData.Status == uctypes.ToolUseStatusPending {
			if result.ErrorText != "" {
				toolCall.ToolUseData.Status = uctypes.ToolUseStatusError
				toolCall.ToolUseData.ErrorMessage = result.ErrorText
			} else {
				toolCall.ToolUseData.Status = uctypes.ToolUseStatusCompleted
			}
		}

		if expertID != "" {
			toolCall.ToolUseData.ExpertID = expertID
		}
		_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, *toolCall.ToolUseData)
		updateToolUseDataInChat(backend, chatOpts, toolCall.ID, *toolCall.ToolUseData)
	}

	return result
}

func processAllToolCalls(ctx context.Context, backend UseChatBackend, stopReason *uctypes.GulinStopReason, chatOpts uctypes.GulinChatOpts, sseHandler *sse.SSEHandlerCh, metrics *uctypes.AIMetrics, expertID string) {
	// Create and send all data-tooluse packets at the beginning
	for i := range stopReason.ToolCalls {
		toolCall := &stopReason.ToolCalls[i]
		// Create toolUseData from the tool call input
		var argsJSON string
		if toolCall.Input != nil {
			argsBytes, err := json.Marshal(toolCall.Input)
			if err == nil {
				argsJSON = string(argsBytes)
			}
		}
		toolUseData := aiutil.CreateToolUseData(toolCall.ID, toolCall.Name, argsJSON, chatOpts)
		stopReason.ToolCalls[i].ToolUseData = &toolUseData
		if expertID != "" {
			toolUseData.ExpertID = expertID
		}
		log.Printf("AI data-tooluse %s (expert=%s)\n", toolCall.ID, expertID)
		_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, toolUseData)
		updateToolUseDataInChat(backend, chatOpts, toolCall.ID, toolUseData)
		if toolUseData.Approval == uctypes.ApprovalNeedsApproval {
			RegisterToolApproval(toolCall.ID, sseHandler)
		}
	}
	// At this point, all ToolCalls are guaranteed to have non-nil ToolUseData

	var toolResults []uctypes.AIToolResult
	for _, toolCall := range stopReason.ToolCalls {
		if sseHandler.Err() != nil || ctx.Err() != nil {
			log.Printf("AI tool processing stopped (sseErr=%v, ctxErr=%v)\n", sseHandler.Err(), ctx.Err())
			break
		}
		result := processToolCall(ctx, backend, toolCall, chatOpts, sseHandler, metrics, expertID)
		toolResults = append(toolResults, result)
	}

	// Cleanup: unregister approvals, remove incomplete/canceled tool calls, and filter results
	var filteredResults []uctypes.AIToolResult
	for i, toolCall := range stopReason.ToolCalls {
		UnregisterToolApproval(toolCall.ID)
		hasResult := i < len(toolResults)
		shouldRemove := !hasResult || (toolCall.ToolUseData != nil && toolCall.ToolUseData.Approval == uctypes.ApprovalCanceled)
		if shouldRemove {
			backend.RemoveToolUseCall(chatOpts.ChatId, toolCall.ID)
		} else if hasResult {
			filteredResults = append(filteredResults, toolResults[i])
		}
	}

	if len(filteredResults) > 0 {
		toolResultMsgs, err := backend.ConvertToolResultsToNativeChatMessage(filteredResults)
		if err != nil {
			log.Printf("Failed to convert tool results to native chat messages: %v", err)
		} else {
			for _, msg := range toolResultMsgs {
				if err := chatstore.DefaultChatStore.PostMessage(chatOpts.ChatId, &chatOpts.Config, msg); err != nil {
					log.Printf("Failed to post tool result message: %v", err)
				}
			}
		}
	}
}

func RunAIChat(ctx context.Context, sseHandler *sse.SSEHandlerCh, backend UseChatBackend, chatOpts uctypes.GulinChatOpts) (*uctypes.AIMetrics, error) {
	chatCtx, cancelFn := context.WithCancel(ctx)
	defer cancelFn()

	if !activeChats.SetUnless(chatOpts.ChatId, cancelFn) {
		return nil, fmt.Errorf("chat %s is already running", chatOpts.ChatId)
	}
	defer activeChats.Delete(chatOpts.ChatId)
	ctx = context.WithValue(chatCtx, sse.SSEHandlerContextKey, sseHandler)

	stepNum := chatstore.DefaultChatStore.CountUserMessages(chatOpts.ChatId)
	aiProvider := chatOpts.Config.Provider
	if aiProvider == "" {
		aiProvider = uctypes.AIProvider_Custom
	}
	isLocal := isLocalEndpoint(chatOpts.Config.Endpoint)
	metrics := &uctypes.AIMetrics{
		ChatId:  chatOpts.ChatId,
		StepNum: stepNum,
		Usage: uctypes.AIUsage{
			APIType: chatOpts.Config.APIType,
			Model:   chatOpts.Config.Model,
		},
		WidgetAccess:  chatOpts.WidgetAccess,
		ToolDetail:    make(map[string]int),
		ThinkingLevel: chatOpts.Config.ThinkingLevel,
		AIMode:        chatOpts.Config.AIMode,
		AIProvider:    aiProvider,
		IsLocal:       isLocal,
	}
	firstStep := true
	var cont *uctypes.GulinContinueResponse
	
	// Preserve original tools/prompt to allow switching between Orchestrator and Experts in the loop
	originalTools := chatOpts.Tools
	// Inyectar herramientas globales de Gulin (Brain, API Manager, etc.) para todos los proveedores
	originalTools = append(originalTools, GetAPIRegisterToolDefinition())
	originalTools = append(originalTools, GetBrainRegisterNodeToolDefinition())
	originalTools = append(originalTools, GetBrainConnectNodesToolDefinition())
	originalTools = append(originalTools, GetAPICallToolDefinition())
	originalTools = append(originalTools, GetAPIListToolDefinition())
	originalTools = append(originalTools, GetAPIDeleteToolDefinition())
	originalTools = append(originalTools, GetGulinBrainUpdateToolDefinition())
	originalTools = append(originalTools, GetGulinBrainListToolDefinition())
	originalTools = append(originalTools, GetGulinBrainSearchToolDefinition())
	originalTools = append(originalTools, GetWebSearchToolDefinition(chatOpts.TabId))
	
	// Inject DB Tools so agents like Lukas DBA can see connections
	originalTools = append(originalTools, GetDBListConnectionsToolDefinition())
	originalTools = append(originalTools, GetDBQueryToolDefinition(chatOpts.TabId))
	
	// Inject Terminal Tools
	originalTools = append(originalTools, GetTermRunCommandToolDefinition(chatOpts.TabId))
	originalTools = append(originalTools, GetTermRunAndWaitToolDefinition(chatOpts.TabId))
	originalTools = append(originalTools, GetTermCommandOutputToolDefinition(chatOpts.TabId))
	originalTools = append(originalTools, GetTermGetScrollbackToolDefinition(chatOpts.TabId))

	// Inject Web Tools
	originalTools = append(originalTools, GetWebReadPageToolDefinition(chatOpts.TabId))
	originalTools = append(originalTools, GetWebNavigateToolDefinition(chatOpts.TabId))
	originalTools = append(originalTools, GetWebClickToolDefinition(chatOpts.TabId))
	originalTools = append(originalTools, GetWebTypeToolDefinition(chatOpts.TabId))
	originalTools = append(originalTools, GetCaptureScreenshotToolDefinition(chatOpts.TabId))

	// Inject RAG and Advanced File Tools
	originalTools = append(originalTools, GetWorkspaceSearchToolDefinition())
	originalTools = append(originalTools, GetDeleteTextFileToolDefinition())
	
	// Inject Plugins and Catalog Tools
	originalTools = append(originalTools, GetPluginListToolDefinition())
	originalTools = append(originalTools, GetListAvailableToolsToolDefinition())
	
	originalSystemPrompt := chatOpts.SystemPrompt
	for {
		if ctx.Err() != nil {
			log.Printf("RunAIChat: context cancelled for chat %s\n", chatOpts.ChatId)
			break
		}
		// RESTORE original tools/prompt before each step so experts work correctly
		chatOpts.Tools = originalTools
		chatOpts.SystemPrompt = originalSystemPrompt

		if strings.Contains(chatOpts.Config.Model, "@orchestrate") {
			// Orchestrator optimization: only provide the delegation tool
			var filteredTools []uctypes.ToolDefinition
			for _, tool := range chatOpts.Tools {
				if tool.Name == "call_expert" {
					filteredTools = append(filteredTools, tool)
				}
			}
			if len(filteredTools) > 0 {
				chatOpts.Tools = filteredTools
				chatOpts.TabTools = nil
			}
			
			// Si estamos en orquestador, el prompt base ya fue configurado por getSystemPrompt,
			// pero aquí aseguramos que se mantenga enfocado si el bucle continúa.
			chatOpts.SystemPrompt = getSystemPrompt(chatOpts.Config.APIType, chatOpts.Config.Model, false, true, chatOpts.WidgetAccess, chatOpts.Config.AIMode)
		} else if strings.Contains(chatOpts.Config.Model, "@") {
			// Manejo de Expertos (e.g. gemini@db_expert)
			modelParts := strings.Split(chatOpts.Config.Model, "@")
			expertIDStr := modelParts[1]
			// Limpiar sufijos extras si existen (ej: db_expert@plan -> db_expert)
			if strings.Contains(expertIDStr, "@") {
				expertIDStr = strings.Split(expertIDStr, "@")[0]
			}
			
			expertID := AgentExpertType(expertIDStr)
			if expert, ok := Experts[expertID]; ok {
				// Aplicar Prompt del Experto
				chatOpts.SystemPrompt = []string{expert.SystemPromptFunc()}
				// Añadir prompts de modo si existen
				if strings.HasSuffix(chatOpts.Config.AIMode, "@plan") {
					chatOpts.SystemPrompt = append(chatOpts.SystemPrompt, GetSystemPrompt_Plan())
				} else if strings.HasSuffix(chatOpts.Config.AIMode, "@act") {
					chatOpts.SystemPrompt = append(chatOpts.SystemPrompt, GetSystemPrompt_Act())
				}

				// Filtrar herramientas del experto incorporando las de la pestaña (TabTools)
				allAvailableTools := append([]uctypes.ToolDefinition{}, originalTools...)
				allAvailableTools = append(allAvailableTools, chatOpts.TabTools...)
				chatOpts.Tools = expert.GetAgentTools(allAvailableTools)
				log.Printf("RunAIChat: Activando Experto %s (%s) con %d herramientas. Model=%s\n", expert.Name, expertID, len(chatOpts.Tools), chatOpts.Config.Model)
			}
		}

		if chatOpts.TabStateGenerator != nil {
			tabState, tabTools, tabId, tabErr := chatOpts.TabStateGenerator()
			if tabErr == nil {
				chatOpts.TabState = tabState
				chatOpts.TabTools = tabTools
				chatOpts.TabId = tabId
			}
		}
		if chatOpts.BuilderAppGenerator != nil {
			appGoFile, appStaticFiles, platformInfo, appErr := chatOpts.BuilderAppGenerator()
			if appErr == nil {
				chatOpts.AppGoFile = appGoFile
				chatOpts.AppStaticFiles = appStaticFiles
				chatOpts.PlatformInfo = platformInfo
			}
		}

		if strings.HasSuffix(chatOpts.Config.AIMode, "@plan") {
			chatOpts.Tools = nil
			chatOpts.TabTools = nil
		}

		sse.SendDebugLog(ctx, sse.LogCatAI, fmt.Sprintf("Iniciando solicitud a %s (Modelo: %s)...", chatOpts.Config.APIType, chatOpts.Config.Model))
		stopReason, rtnMessages, err := runAIChatStep(ctx, sseHandler, backend, chatOpts, cont)
		if err == nil {
			sse.SendDebugLog(ctx, sse.LogCatAI, "Respuesta del AI recibida.")
		}
		metrics.RequestCount++
		if chatOpts.Config.IsGulinProxy() {
			metrics.ProxyReqCount++
			if chatOpts.Config.IsPremiumModel() {
				metrics.PremiumReqCount++
			}
		}
		if stopReason != nil {
			logutil.DevPrintf("stopreason: %s (%s) (%s) (%s)\n", stopReason.Kind, stopReason.ErrorText, stopReason.ErrorType, stopReason.RawReason)
		}
		if len(rtnMessages) > 0 {
			usage := getUsage(rtnMessages)
			log.Printf("usage: input=%d output=%d websearch=%d\n", usage.InputTokens, usage.OutputTokens, usage.NativeWebSearchCount)
			metrics.Usage.InputTokens += usage.InputTokens
			metrics.Usage.OutputTokens += usage.OutputTokens
			metrics.Usage.NativeWebSearchCount += usage.NativeWebSearchCount
			if usage.Model != "" && metrics.Usage.Model != usage.Model {
				metrics.Usage.Model = "mixed"
			}
		}
		if firstStep && err != nil {
			metrics.HadError = true
			return metrics, fmt.Errorf("failed to stream %s chat: %w", chatOpts.Config.APIType, err)
		}
		if err != nil {
			metrics.HadError = true
			_ = sseHandler.WriteError(err.Error())
			break
		}
		for _, msg := range rtnMessages {
			if msg != nil {
				if err := chatstore.DefaultChatStore.PostMessage(chatOpts.ChatId, &chatOpts.Config, msg); err != nil {
					log.Printf("Failed to post message: %v", err)
				}
			}
		}
		firstStep = false
		if stopReason != nil && stopReason.Kind == uctypes.StopKindPremiumRateLimit && chatOpts.Config.APIType == uctypes.APIType_OpenAIResponses && chatOpts.Config.Model == uctypes.PremiumOpenAIModel {
			log.Printf("Premium rate limit hit with %s, switching to %s\n", uctypes.PremiumOpenAIModel, uctypes.DefaultOpenAIModel)
			cont = &uctypes.GulinContinueResponse{
				Model:            uctypes.DefaultOpenAIModel,
				ContinueFromKind: uctypes.StopKindPremiumRateLimit,
			}
			continue
		}
		if stopReason != nil && stopReason.Kind == uctypes.StopKindToolUse {
			metrics.ToolUseCount += len(stopReason.ToolCalls)
			log.Printf("RunAIChat: processing %d tool calls...\n", len(stopReason.ToolCalls))
			var currentExpertID string
			if strings.Contains(chatOpts.Config.Model, "@") {
				modelParts := strings.Split(chatOpts.Config.Model, "@")
				currentExpertID = modelParts[1]
			}
			processAllToolCalls(ctx, backend, stopReason, chatOpts, sseHandler, metrics, currentExpertID)

			// SYNC FIX: Ensure the chat store has a moment to flush and that we are continuing from the right state
			log.Printf("RunAIChat: tool calls processed, continuing to next turn.\n")
			time.Sleep(100 * time.Millisecond)

			cont = &uctypes.GulinContinueResponse{
				Model:            chatOpts.Config.Model,
				ContinueFromKind: uctypes.StopKindToolUse,
			}
			continue
		}
		break
	}
	return metrics, nil
}

func ResolveToolCall(ctx context.Context, toolDef *uctypes.ToolDefinition, toolCall uctypes.GulinToolCall, chatOpts uctypes.GulinChatOpts, sseHandler *sse.SSEHandlerCh) (result uctypes.AIToolResult) {
	sse.SendDebugLog(ctx, sse.LogCatAI, fmt.Sprintf("Ejecutando herramienta: %s...", toolCall.Name))
	result = uctypes.AIToolResult{
		ToolName:  toolCall.Name,
		ToolUseID: toolCall.ID,
	}

	if ctx.Err() != nil {
		result.ErrorText = "context cancelled by user"
		return
	}

	defer func() {
		if r := recover(); r != nil {
			result.ErrorText = fmt.Sprintf("panic in tool execution: %v", r)
			result.Text = ""
		}
	}()

	if toolDef == nil {
		result.ErrorText = fmt.Sprintf("tool '%s' not found", toolCall.Name)
		return
	}

	if chatOpts.TokenMode != "" {
		ctx = context.WithValue(ctx, uctypes.TokenModeContextKey, chatOpts.TokenMode)
	}

	// WAIT FOR APPROVAL: If the tool requires approval (PLAN Mode), wait until approved or denied
	if toolCall.ToolUseData != nil && toolCall.ToolUseData.Approval == uctypes.ApprovalNeedsApproval {
		log.Printf("ResolveToolCall: Tool %s (%s) needs approval, waiting...\n", toolCall.Name, toolCall.ID)

		// SSE KEEP-ALIVE: Start a goroutine to send comments while waiting
		// this prevents the browser/LoadBalancer from closing the connection for inactivity
		stopChan := make(chan struct{})
		go func() {
			ticker := time.NewTicker(10 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					log.Printf("SSE Keep-alive: Sending comment while waiting for approval of %s\n", toolCall.ID)
					_ = sseHandler.WriteComment("")
				case <-stopChan:
					return
				case <-ctx.Done():
					return
				}
			}
		}()

		approval, err := WaitForToolApproval(ctx, toolCall.ID)
		close(stopChan) // Stop keep-alive goroutine

		if err != nil {
			if err == context.Canceled {
				result.ErrorText = "context cancelled while waiting for tool approval"
			} else {
				result.ErrorText = fmt.Sprintf("error waiting for approval: %v", err)
			}
			return
		}

		// Update in-memory approval for actual execution decisions
		toolCall.ToolUseData.Approval = approval

		if approval == uctypes.ApprovalUserApproved {
			log.Printf("ResolveToolCall: Tool %s (%s) APPROVED by user.\n", toolCall.Name, toolCall.ID)
			// Trigger a UI update to show it's progressing
			_ = sseHandler.AiMsgData("data-tooluse", toolCall.ID, *toolCall.ToolUseData)
		} else if approval == uctypes.ApprovalUserDenied {
			log.Printf("ResolveToolCall: Tool %s (%s) DENIED by user.\n", toolCall.Name, toolCall.ID)
			result.ErrorText = "tool execution denied by user"
			return
		} else if approval == uctypes.ApprovalCanceled {
			result.ErrorText = "tool execution canceled"
			return
		} else {
			result.ErrorText = fmt.Sprintf("unexpected approval status: %s", approval)
			return
		}
	}

	// Try ToolTextCallback first, then ToolAnyCallback
	if toolDef.ToolTextCallback != nil {
		text, err := toolDef.ToolTextCallback(ctx, toolCall.Input)
		if err != nil {
			result.ErrorText = err.Error()
		} else {
			result.Text = text
			// Recompute tool description with the result
			if toolDef.ToolCallDesc != nil && toolCall.ToolUseData != nil {
				toolCall.ToolUseData.ToolDesc = toolDef.ToolCallDesc(toolCall.Input, text, toolCall.ToolUseData)
			}
		}
	} else if toolDef.ToolAnyCallback != nil {
		output, err := toolDef.ToolAnyCallback(ctx, toolCall.Input, toolCall.ToolUseData)
		if err != nil {
			result.ErrorText = err.Error()
		} else {
			// Marshal the result to JSON
			jsonBytes, marshalErr := json.Marshal(output)
			if marshalErr != nil {
				result.ErrorText = fmt.Sprintf("failed to marshal tool output: %v", marshalErr)
			} else {
				result.Text = string(jsonBytes)
				// Recompute tool description with the result
				if toolDef.ToolCallDesc != nil && toolCall.ToolUseData != nil {
					toolCall.ToolUseData.ToolDesc = toolDef.ToolCallDesc(toolCall.Input, output, toolCall.ToolUseData)
				}
			}
		}
	} else {
		result.ErrorText = fmt.Sprintf("tool '%s' has no callback functions", toolCall.Name)
	}

	if result.ErrorText != "" {
		sse.SendDebugLog(ctx, sse.LogCatAI, fmt.Sprintf("Error en herramienta %s: %s", toolCall.Name, result.ErrorText))
	} else {
		sse.SendDebugLog(ctx, sse.LogCatAI, fmt.Sprintf("Herramienta %s ejecutada con éxito.", toolCall.Name))
		// Registro automático de XP para el Brain Map
		go gulinapp.RecordXPAuto(toolCall.Name, "ai-agent")
	}
	return
}

func GulinAIPostMessageWrap(ctx context.Context, sseHandler *sse.SSEHandlerCh, message *uctypes.AIMessage, chatOpts uctypes.GulinChatOpts) error {
	startTime := time.Now()

	// Convert AIMessage to native chat message using backend
	backend, err := GetBackend(chatOpts.Config.APIType, chatOpts.Config.Provider)
	if err != nil {
		return err
	}
	convertedMessage, err := backend.ConvertAIMessageToNativeChatMessage(*message)
	if err != nil {
		return fmt.Errorf("message conversion failed: %w", err)
	}

	// Post message to chat store
	if err := chatstore.DefaultChatStore.PostMessage(chatOpts.ChatId, &chatOpts.Config, convertedMessage); err != nil {
		return fmt.Errorf("failed to store message: %w", err)
	}

	metrics, err := RunAIChat(ctx, sseHandler, backend, chatOpts)
	if metrics != nil {
		metrics.RequestDuration = int(time.Since(startTime).Milliseconds())
		for _, part := range message.Parts {
			if part.Type == uctypes.AIMessagePartTypeText {
				metrics.TextLen += len(part.Text)
			} else if part.Type == uctypes.AIMessagePartTypeFile {
				mimeType := strings.ToLower(part.MimeType)
				if strings.HasPrefix(mimeType, "image/") {
					metrics.ImageCount++
				} else if mimeType == "application/pdf" {
					metrics.PDFCount++
				} else {
					metrics.TextDocCount++
				}
			}
		}
		log.Printf("GulinAI call metrics: requests=%d tools=%d premium=%d proxy=%d images=%d pdfs=%d textdocs=%d textlen=%d duration=%dms error=%v\n",
			metrics.RequestCount, metrics.ToolUseCount, metrics.PremiumReqCount, metrics.ProxyReqCount,
			metrics.ImageCount, metrics.PDFCount, metrics.TextDocCount, metrics.TextLen, metrics.RequestDuration, metrics.HadError)
		sendAIMetricsTelemetry(ctx, metrics)
		sseHandler.AiMsgTokenUsage(metrics.Usage.InputTokens, metrics.Usage.OutputTokens, metrics.Usage.InputTokens+metrics.Usage.OutputTokens)
	}
	return err
}

func sendAIMetricsTelemetry(ctx context.Context, metrics *uctypes.AIMetrics) {
	// Log tokens to database
	if metrics.Usage.InputTokens > 0 || metrics.Usage.OutputTokens > 0 {
		go func() {
			err := chatstore.SaveTokenUsage(chatstore.TokenUsageLog{
				Timestamp:    time.Now().UnixMilli(),
				ChatID:       metrics.ChatId,
				Provider:     metrics.AIProvider,
				Model:        metrics.Usage.Model,
				InputTokens:  metrics.Usage.InputTokens,
				OutputTokens: metrics.Usage.OutputTokens,
				TotalTokens:  metrics.Usage.InputTokens + metrics.Usage.OutputTokens,
			})
			if err != nil {
				log.Printf("error saving token usage to DB: %v\n", err)
			}
		}()
	}

	event := telemetrydata.MakeTEvent("gulinai:post", telemetrydata.TEventProps{
		GulinAIAPIType:              metrics.Usage.APIType,
		GulinAIModel:                metrics.Usage.Model,
		GulinAIChatId:               metrics.ChatId,
		GulinAIStepNum:              metrics.StepNum,
		GulinAIInputTokens:          metrics.Usage.InputTokens,
		GulinAIOutputTokens:         metrics.Usage.OutputTokens,
		GulinAINativeWebSearchCount: metrics.Usage.NativeWebSearchCount,
		GulinAIRequestCount:         metrics.RequestCount,
		GulinAIToolUseCount:         metrics.ToolUseCount,
		GulinAIToolUseErrorCount:    metrics.ToolUseErrorCount,
		GulinAIToolDetail:           metrics.ToolDetail,
		GulinAIPremiumReq:           metrics.PremiumReqCount,
		GulinAIProxyReq:             metrics.ProxyReqCount,
		GulinAIHadError:             metrics.HadError,
		GulinAIImageCount:           metrics.ImageCount,
		GulinAIPDFCount:             metrics.PDFCount,
		GulinAITextDocCount:         metrics.TextDocCount,
		GulinAITextLen:              metrics.TextLen,
		GulinAIFirstByteMs:          metrics.FirstByteLatency,
		GulinAIRequestDurMs:         metrics.RequestDuration,
		GulinAIWidgetAccess:         metrics.WidgetAccess,
		GulinAIThinkingLevel:        metrics.ThinkingLevel,
		GulinAIMode:                 metrics.AIMode,
		GulinAIProvider:             metrics.AIProvider,
		GulinAIIsLocal:              metrics.IsLocal,
	})
	_ = telemetry.RecordTEvent(ctx, event)
}

// PostMessageRequest represents the request body for posting a message
type PostMessageRequest struct {
	TabId        string            `json:"tabid,omitempty"`
	BuilderId    string            `json:"builderid,omitempty"`
	BuilderAppId string            `json:"builderappid,omitempty"`
	ChatID       string            `json:"chatid"`
	Msg          uctypes.AIMessage `json:"msg"`
	WidgetAccess bool              `json:"widgetaccess,omitempty"`
	AIMode       string            `json:"aimode"`
	TokenMode    string            `json:"tokenmode,omitempty"`
	Skill        string            `json:"skill,omitempty"`
}

type BrainSummary struct {
	Filename   string `json:"filename"`
	Title      string `json:"title"`
	LastUpdate int64  `json:"lastupdate"`
	Snippet    string `json:"snippet"`
}

func GulinAIBrainListHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	memoryFiles, _ := ListGulinMemoryFiles()
	skillFiles, _ := ListGulinSkillFiles()
	files := append(memoryFiles, skillFiles...)

	dataDir := gulinbase.GetGulinDataDir()
	workspaceDir := filepath.Dir(dataDir)

	summaries := make([]BrainSummary, 0)
	for _, file := range files {
		var path string
		if strings.HasPrefix(file, "skills/") {
			skillsDir := gulinbase.GetConfiguredSkillsDir()
			path = filepath.Join(skillsDir, strings.TrimPrefix(filepath.FromSlash(file), "skills/"))
		} else {
			path = filepath.Join(workspaceDir, filepath.FromSlash(file))
		}

		info, err := os.Stat(path)
		if err != nil {
			continue
		}
		content, err := ReadGulinMemoryFile(file)
		if err != nil {
			continue
		}
		snippet := content
		if len(snippet) > 200 {
			snippet = snippet[:200]
		}
		title := strings.TrimSuffix(file, ".md")
		title = strings.TrimPrefix(title, "skills/")

		summaries = append(summaries, BrainSummary{
			Filename:   file,
			Title:      title,
			LastUpdate: info.ModTime().UnixMilli(),
			Snippet:    snippet,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(summaries)
}

func GulinAIBrainReadHandler(w http.ResponseWriter, r *http.Request) {
	filename := r.URL.Query().Get("filename")
	if filename == "" {
		http.Error(w, "filename is required", http.StatusBadRequest)
		return
	}
	content, err := ReadGulinMemoryFile(filename)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to read brain file: %v", err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/markdown")
	w.Write([]byte(content))
}

func GulinAIBrainUpdateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var data struct {
		Filename string `json:"filename"`
		Content  string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if data.Filename == "" {
		http.Error(w, "filename is required", http.StatusBadRequest)
		return
	}
	err := UpdateGulinMemoryFile(data.Filename, data.Content)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to update brain file: %v", err), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func GulinAIBrainDeleteHandler(w http.ResponseWriter, r *http.Request) {
	filename := r.URL.Query().Get("filename")
	if filename == "" {
		http.Error(w, "filename is required", http.StatusBadRequest)
		return
	}
	var absPath string
	if strings.HasPrefix(filename, "skills/") {
		skillsDir := gulinbase.GetConfiguredSkillsDir()
		absPath = filepath.Join(skillsDir, strings.TrimPrefix(filepath.FromSlash(filename), "skills/"))
	} else if strings.Contains(filename, "/") || strings.Contains(filename, "\\") {
		dataDir := gulinbase.GetGulinDataDir()
		workspaceDir := filepath.Dir(dataDir)
		absPath = filepath.Join(workspaceDir, filepath.FromSlash(filename))
	} else {
		filename = filepath.Base(filename)
		absPath = filepath.Join(GetGulinMemoryDir(), filename)
	}
	err := os.Remove(absPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to delete brain file: %v", err), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func GulinAIDBSchemaHandler(w http.ResponseWriter, r *http.Request) {
	connName := r.URL.Query().Get("connection")
	if connName == "" {
		http.Error(w, "connection parameter is required", http.StatusBadRequest)
		return
	}

	connections, err := loadDBConnections()
	if err != nil || len(connections) == 0 {
		http.Error(w, "no connections registered", http.StatusNotFound)
		return
	}

	connInfo, ok := connections[connName]
	if !ok {
		http.Error(w, fmt.Sprintf("connection '%s' not found", connName), http.StatusNotFound)
		return
	}

	db, err := openSQLDB(connInfo.Type, connInfo.URL)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to open db: %v", err), http.StatusInternalServerError)
		return
	}
	defer db.Close()

	mode := r.URL.Query().Get("mode")
	if mode == "list-users" {
		var userQuery string
		switch connInfo.Type {
		case "oracle":
			userQuery = "SELECT username FROM all_users ORDER BY username"
		case "postgres":
			userQuery = "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname != 'information_schema' ORDER BY nspname"
		case "mysql", "mariadb":
			userQuery = "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name"
		default:
			json.NewEncoder(w).Encode([]string{})
			return
		}
		rows, err := db.Query(userQuery)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		var users []string
		for rows.Next() {
			var u string
			if err := rows.Scan(&u); err == nil {
				users = append(users, u)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(users)
		return
	}

	filterType := r.URL.Query().Get("type")
	owner := r.URL.Query().Get("owner")
	var query string
	switch connInfo.Type {
	case "postgres":
		if filterType == "" {
			query = `
				SELECT 'TABLE' as type, count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
				UNION ALL
				SELECT 'VIEW' as type, count(*) FROM pg_catalog.pg_views WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
				UNION ALL
				SELECT 'INDEX' as type, count(*) FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
				GROUP BY type`
		} else {
			if filterType == "TABLE" {
				query = "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY tablename"
			} else if filterType == "VIEW" {
				query = "SELECT viewname FROM pg_catalog.pg_views WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY viewname"
			} else if filterType == "INDEX" {
				query = "SELECT indexname FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY indexname"
			}
		}
	case "mysql", "mariadb", "aurora-mysql":
		if filterType == "" {
			query = "SELECT 'TABLE' as type, count(*) FROM information_schema.tables WHERE table_schema = DATABASE()"
		} else {
			query = "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name"
		}
	case "mssql", "sqlserver", "azure-sql":
		if filterType == "" {
			query = `
				SELECT 'DATABASE' as type, count(*) FROM sys.databases
				UNION ALL
				SELECT 'TABLE' as type, count(*) FROM sys.tables
				UNION ALL
				SELECT 'VIEW' as type, count(*) FROM sys.views
				UNION ALL
				SELECT 'PROCEDURE' as type, count(*) FROM sys.procedures
				UNION ALL
				SELECT 'FUNCTION' as type, count(*) FROM sys.objects WHERE type IN ('FN', 'IF', 'TF')
				UNION ALL
				SELECT 'TRIGGER' as type, count(*) FROM sys.triggers
				UNION ALL
				SELECT 'INDEX' as type, count(*) FROM sys.indexes WHERE type > 0 AND name IS NOT NULL
				UNION ALL
				SELECT 'SYNONYM' as type, count(*) FROM sys.synonyms
				UNION ALL
				SELECT 'SEQUENCE' as type, count(*) FROM sys.sequences
				UNION ALL
				SELECT 'USER' as type, count(*) FROM sys.database_principals WHERE type IN ('S', 'U', 'G')
				UNION ALL
				SELECT 'ROLE' as type, count(*) FROM sys.database_principals WHERE type = 'R'
				UNION ALL
				SELECT 'SCHEMA' as type, count(*) FROM sys.schemas
				UNION ALL
				SELECT 'TYPE' as type, count(*) FROM sys.types WHERE is_user_defined = 1
				UNION ALL
				SELECT 'ASSEMBLY' as type, count(*) FROM sys.assemblies
				UNION ALL
				SELECT 'ENDPOINT' as type, count(*) FROM sys.endpoints
				UNION ALL
				SELECT 'LINKED_SERVER' as type, count(*) FROM sys.servers WHERE is_linked = 1`
		} else {
			if filterType == "DATABASE" {
				query = "SELECT name FROM sys.databases ORDER BY name"
			} else if filterType == "TABLE" {
				query = "SELECT name FROM sys.tables ORDER BY name"
			} else if filterType == "VIEW" {
				query = "SELECT name FROM sys.views ORDER BY name"
			} else if filterType == "PROCEDURE" {
				query = "SELECT name FROM sys.procedures ORDER BY name"
			} else if filterType == "FUNCTION" {
				query = "SELECT name FROM sys.objects WHERE type IN ('FN', 'IF', 'TF') ORDER BY name"
			} else if filterType == "TRIGGER" {
				query = "SELECT name FROM sys.triggers ORDER BY name"
			} else if filterType == "INDEX" {
				query = "SELECT name FROM sys.indexes WHERE type > 0 AND name IS NOT NULL ORDER BY name"
			} else if filterType == "SYNONYM" {
				query = "SELECT name FROM sys.synonyms ORDER BY name"
			} else if filterType == "SEQUENCE" {
				query = "SELECT name FROM sys.sequences ORDER BY name"
			} else if filterType == "USER" {
				query = "SELECT name FROM sys.database_principals WHERE type IN ('S', 'U', 'G') ORDER BY name"
			} else if filterType == "ROLE" {
				query = "SELECT name FROM sys.database_principals WHERE type = 'R' ORDER BY name"
			} else if filterType == "SCHEMA" {
				query = "SELECT name FROM sys.schemas ORDER BY name"
			} else if filterType == "TYPE" {
				query = "SELECT name FROM sys.types WHERE is_user_defined = 1 ORDER BY name"
			} else if filterType == "ASSEMBLY" {
				query = "SELECT name FROM sys.assemblies ORDER BY name"
			} else if filterType == "ENDPOINT" {
				query = "SELECT name FROM sys.endpoints ORDER BY name"
			} else if filterType == "LINKED_SERVER" {
				query = "SELECT name FROM sys.servers WHERE is_linked = 1 ORDER BY name"
			}
		}
	case "oracle":
		if owner == "" {
			owner = "sys_context('userenv', 'current_schema')"
		} else {
			owner = fmt.Sprintf("'%s'", owner)
		}

		if filterType == "" {
			query = fmt.Sprintf(`
				SELECT object_type as type, count(*) as count FROM all_objects WHERE owner = %s GROUP BY object_type
				UNION ALL
				SELECT 'TABLESPACE' as type, count(*) as count FROM user_tablespaces
				UNION ALL
				SELECT 'CONSTRAINT' as type, count(*) as count FROM all_constraints WHERE owner = %s
				ORDER BY type`, owner, owner)
		} else {
			if filterType == "TABLESPACE" {
				query = "SELECT tablespace_name FROM user_tablespaces ORDER BY tablespace_name"
			} else if filterType == "CONSTRAINT" {
				query = fmt.Sprintf("SELECT constraint_name FROM all_constraints WHERE owner = %s AND rownum <= 5000 ORDER BY constraint_name", owner)
			} else {
				query = fmt.Sprintf("SELECT object_name FROM all_objects WHERE object_type = '%s' AND owner = %s ORDER BY object_name", filterType, owner)
			}
		}
	case "sqlite":
		if filterType == "" {
			query = "SELECT upper(type), count(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' GROUP BY type"
		} else {
			query = fmt.Sprintf("SELECT name FROM sqlite_master WHERE upper(type) = '%s' AND name NOT LIKE 'sqlite_%%' ORDER BY name", filterType)
		}
	default:
		http.Error(w, fmt.Sprintf("schema listing not supported for type %q", connInfo.Type), http.StatusBadRequest)
		return
	}

	log.Printf("[GULIN] Executing schema query for %s (type=%s): %s\n", connInfo.Type, filterType, query)
	rows, err := db.Query(query)
	if err != nil {
		log.Printf("[GULIN] Error querying schema for %s: %v\n", connName, err)
		http.Error(w, fmt.Sprintf("failed to query schema: %v", err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	if filterType == "" {
		// Return summary: map[string]int
		summary := make(map[string]int)
		for rows.Next() {
			var objType string
			var count int
			if err := rows.Scan(&objType, &count); err == nil {
				summary[objType] = count
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(summary)
	} else {
		// Return list: []string
		var list []string
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err == nil {
				list = append(list, name)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(list)
	}
	return
}

func GulinAIDBQueryHandler(w http.ResponseWriter, r *http.Request) {
	connName := r.URL.Query().Get("connection")
	sqlStr := r.URL.Query().Get("sql")
	tabId := r.URL.Query().Get("tabid")

	if connName == "" || sqlStr == "" || tabId == "" {
		http.Error(w, "connection, sql, and tabid parameters are required", http.StatusBadRequest)
		return
	}

	connections, err := loadDBConnections()
	if err != nil || len(connections) == 0 {
		http.Error(w, "no connections registered", http.StatusNotFound)
		return
	}

	connInfo, ok := connections[connName]
	if !ok {
		http.Error(w, fmt.Sprintf("connection '%s' not found", connName), http.StatusNotFound)
		return
	}

	db, err := openSQLDB(connInfo.Type, connInfo.URL)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to open db: %v", err), http.StatusInternalServerError)
		return
	}
	defer db.Close()

	rows, err := db.QueryContext(r.Context(), sqlStr)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to execute query: %v", err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	cols, _ := rows.Columns()
	var results []map[string]any

	for rows.Next() {
		columns := make([]any, len(cols))
		columnPointers := make([]any, len(cols))
		for i := range columns {
			columnPointers[i] = &columns[i]
		}

		if err := rows.Scan(columnPointers...); err != nil {
			http.Error(w, fmt.Sprintf("failed to scan row: %v", err), http.StatusInternalServerError)
			return
		}

		m := make(map[string]any)
		for i, colName := range cols {
			val := columns[i]
			if b, ok := val.([]byte); ok {
				m[colName] = string(b)
			} else {
				m[colName] = val
			}
		}
		results = append(results, m)
	}

	if tabId == "studio" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"columns": cols,
			"rows":    results,
		})
		return
	}

	if tabId == "studio-script" {
		// Special handler for DBMS_METADATA
		var ddl string
		row := db.QueryRowContext(r.Context(), sqlStr)
		if err := row.Scan(&ddl); err != nil {
			http.Error(w, fmt.Sprintf("failed to get DDL: %v", err), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte(ddl))
		return
	}

	// Create the block in the UI (standard behavior)
	rpcClient := wshclient.GetBareRpcClient()
	dataJson, _ := json.Marshal(results)
	_, err = wshclient.CreateBlockCommand(rpcClient, wshrpc.CommandCreateBlockData{
		TabId: tabId,
		BlockDef: &gulinobj.BlockDef{
			Meta: map[string]any{
				"view":          "db-explorer",
				"db:title":      fmt.Sprintf("Table: %s", connName),
				"db:connection": connName,
				"db:data":       string(dataJson),
			},
		},
	}, nil)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to create block: %v", err), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

func GulinAIDBListHandler(w http.ResponseWriter, r *http.Request) {
	connections, _ := loadDBConnections()

	if len(connections) == 0 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]any{})
		return
	}

	var result []DBConnectionInfo
	for name, conn := range connections {
		result = append(result, DBConnectionInfo{
			Name: name,
			Type: conn.Type,
			URL:  conn.URL,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func GulinAIGetChatListHandler(w http.ResponseWriter, r *http.Request) {
	// Only allow GET method
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	summaries, err := chatstore.GetChatListFromDB()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get chat list: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(summaries)
}

func GulinAIDeleteChatHandler(w http.ResponseWriter, r *http.Request) {
	// Get chatid from URL parameters
	chatID := r.URL.Query().Get("chatid")
	if chatID == "" {
		http.Error(w, "chatid parameter is required", http.StatusBadRequest)
		return
	}

	// Validate chatid is a UUID
	if _, err := uuid.Parse(chatID); err != nil {
		http.Error(w, "chatid must be a valid UUID", http.StatusBadRequest)
		return
	}

	chatstore.DefaultChatStore.Delete(chatID)

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

type BulkDeleteChatRequest struct {
	ChatIds []string `json:"chatids"`
}

func GulinAIBulkDeleteChatHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req BulkDeleteChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("[GULIN] Error decoding bulk delete request: %v\n", err)
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	if len(req.ChatIds) == 0 {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
		return
	}

	log.Printf("[GULIN] Handling bulk delete request for %d chats\n", len(req.ChatIds))

	err := chatstore.DefaultChatStore.BulkDelete(req.ChatIds)
	if err != nil {
		log.Printf("[GULIN] Error performing bulk delete: %v\n", err)
		http.Error(w, fmt.Sprintf("Failed to perform bulk delete: %v", err), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}




func GulinAIPostMessageHandler(w http.ResponseWriter, r *http.Request) {
	// Only allow POST method
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request body
	var req PostMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	// Validate chatid is present and is a UUID
	if req.ChatID == "" {
		http.Error(w, "chatid is required in request body", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(req.ChatID); err != nil {
		http.Error(w, "chatid must be a valid UUID", http.StatusBadRequest)
		return
	}

	// Get RTInfo from TabId or BuilderId
	var rtInfo *gulinobj.ObjRTInfo
	if req.TabId != "" {
		oref := gulinobj.MakeORef(gulinobj.OType_Tab, req.TabId)
		rtInfo = wstore.GetRTInfo(oref)
	} else if req.BuilderId != "" {
		oref := gulinobj.MakeORef(gulinobj.OType_Builder, req.BuilderId)
		rtInfo = wstore.GetRTInfo(oref)
	}
	if rtInfo == nil {
		rtInfo = &gulinobj.ObjRTInfo{}
	}

	// Get GulinAI settings
	premium := shouldUsePremium()
	builderMode := req.BuilderId != ""
	if req.AIMode == "" {
		http.Error(w, "aimode is required in request body", http.StatusBadRequest)
		return
	}
	aiOpts, err := getGulinAISettings(premium, builderMode, *rtInfo, req.AIMode)
	if err != nil {
		http.Error(w, fmt.Sprintf("GulinAI configuration error: %v", err), http.StatusInternalServerError)
		return
	}

	// Call the core GulinAIPostMessage function
	chatOpts := uctypes.GulinChatOpts{
		ChatId:               req.ChatID,
		ClientId:             wstore.GetClientId(),
		Config:               *aiOpts,
		WidgetAccess:         req.WidgetAccess,
		AllowNativeWebSearch: true,
		TokenMode:            req.TokenMode,
		BuilderId:            req.BuilderId,
		BuilderAppId:         req.BuilderAppId,
		TabId:                req.TabId,
	}

	chatOpts.SystemPrompt = getSystemPrompt(chatOpts.Config.APIType, chatOpts.Config.Model, chatOpts.BuilderId != "", chatOpts.Config.HasCapability(uctypes.AICapabilityTools), chatOpts.WidgetAccess, chatOpts.Config.AIMode)
	brainContext := GetGulinBrainContext(req.Msg.GetContent())
	if brainContext != "" {
		chatOpts.SystemPrompt = append(chatOpts.SystemPrompt, brainContext)
	}
	// 🧠 Reflection Engine: inyectar lecciones aprendidas del proyecto activo
	if req.TabId != "" {
		// Generamos el TabState de forma temprana para leer los insights del proyecto
		if tabState, _, err := GenerateTabStateAndTools(r.Context(), req.TabId, req.WidgetAccess, &chatOpts); err == nil && tabState != "" {
			if projectInsights := ReadProjectInsights(tabState); projectInsights != "" {
				chatOpts.SystemPrompt = append(chatOpts.SystemPrompt, projectInsights)
				log.Printf("[ReflectionEngine] Insights del proyecto inyectados en el System Prompt.\n")
			}
		}
	}

	if req.Skill != "" {
		skillContext := GetGulinSkillContext(req.Skill)
		if skillContext != "" {
			chatOpts.SystemPrompt = append(chatOpts.SystemPrompt, skillContext)
		}
	}

	if req.TabId != "" {
		chatOpts.TabStateGenerator = func() (string, []uctypes.ToolDefinition, string, error) {
			tabState, tabTools, err := GenerateTabStateAndTools(r.Context(), req.TabId, req.WidgetAccess, &chatOpts)
			return tabState, tabTools, req.TabId, err
		}
	}

	if req.BuilderAppId != "" {
		chatOpts.BuilderAppGenerator = func() (string, string, string, error) {
			return generateBuilderAppData(req.BuilderAppId)
		}
	}

	if req.BuilderAppId != "" {
		chatOpts.Tools = append(chatOpts.Tools,
			GetBuilderWriteAppFileToolDefinition(req.BuilderAppId, req.BuilderId),
			GetBuilderEditAppFileToolDefinition(req.BuilderAppId, req.BuilderId),
			GetBuilderListFilesToolDefinition(req.BuilderAppId),
		)
	}

	// Validate the message
	if err := req.Msg.Validate(); err != nil {
		http.Error(w, fmt.Sprintf("Message validation failed: %v", err), http.StatusInternalServerError)
		return
	}

	// Handle Interruption
	lastUserMsg := chatstore.DefaultChatStore.GetLastUserMessage(req.ChatID)
	// Check if the chat is already active
	activeCancel, ok := activeChats.GetEx(req.ChatID)
	isInterruption := false
	if ok && activeCancel != nil {
		log.Printf("Interrupting active chat %s to merge context\n", req.ChatID)
		CancelActiveChat(req.ChatID)
		isInterruption = true

		if lastUserMsg != nil {
			// Merge the new message into the last user message
			// We assume req.Msg has text content
			newContent := req.Msg.GetContent()
			if newContent != "" {
				// Cast GenAIMessage to *uctypes.AIMessage to access its parts
				aiMsg, ok := lastUserMsg.(*uctypes.AIMessage)
				if ok {
					currentParts := aiMsg.Parts
					// Find first text part and append or add new part
					merged := false
					for i := range currentParts {
						if currentParts[i].Type == uctypes.AIMessagePartTypeText {
							currentParts[i].Text += "\n(Contexto adicional: " + newContent + ")"
							merged = true
							break
						}
					}
					if !merged {
						currentParts = append(currentParts, uctypes.AIMessagePart{
							Type: uctypes.AIMessagePartTypeText,
							Text: "\n(Contexto adicional: " + newContent + ")",
						})
					}
					aiMsg.Parts = currentParts

					// Save the updated message and trim everything after it
					_ = chatstore.DefaultChatStore.PostMessage(req.ChatID, aiOpts, aiMsg)
					chatstore.DefaultChatStore.TrimMessagesAfter(req.ChatID, aiMsg.GetMessageId())
				}
			}
		}
	}

	// Create SSE handler and set up streaming
	sseHandler := sse.MakeSSEHandlerCh(w, r.Context())
	defer sseHandler.Close()

	if isInterruption && lastUserMsg != nil {
		// Restart with merged message
		if err := RunAIChatWrap(r.Context(), sseHandler, chatOpts); err != nil {
			http.Error(w, fmt.Sprintf("Failed to restart chat: %v", err), http.StatusInternalServerError)
			return
		}
	} else {
		// Normal post
		if err := GulinAIPostMessageWrap(r.Context(), sseHandler, &req.Msg, chatOpts); err != nil {
			log.Printf("GulinAIPostMessageWrap failed with error: %v", err)
			http.Error(w, fmt.Sprintf("Failed to post message: %v", err), http.StatusInternalServerError)
			return
		}
	}
}

func RunAIChatWrap(ctx context.Context, sseHandler *sse.SSEHandlerCh, chatOpts uctypes.GulinChatOpts) error {
	backend, err := GetBackend(chatOpts.Config.APIType, chatOpts.Config.Provider)
	if err != nil {
		return err
	}
	metrics, err := RunAIChat(ctx, sseHandler, backend, chatOpts)
	if metrics != nil {
		sendAIMetricsTelemetry(ctx, metrics)
		sseHandler.AiMsgTokenUsage(metrics.Usage.InputTokens, metrics.Usage.OutputTokens, metrics.Usage.InputTokens+metrics.Usage.OutputTokens)
	}
	return err
}

func GulinAIGetChatHandler(w http.ResponseWriter, r *http.Request) {
	// Only allow GET method
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get chatid from URL parameters
	chatID := r.URL.Query().Get("chatid")
	if chatID == "" {
		http.Error(w, "chatid parameter is required", http.StatusBadRequest)
		return
	}

	// Validate chatid is a UUID
	if _, err := uuid.Parse(chatID); err != nil {
		http.Error(w, "chatid must be a valid UUID", http.StatusBadRequest)
		return
	}

	// Get chat from store
	chat := chatstore.DefaultChatStore.Get(chatID)
	if chat == nil {
		http.Error(w, "chat not found", http.StatusNotFound)
		return
	}

	// Set response headers for JSON
	w.Header().Set("Content-Type", "application/json")

	// Encode and return the chat
	if err := json.NewEncoder(w).Encode(chat); err != nil {
		http.Error(w, fmt.Sprintf("Failed to encode response: %v", err), http.StatusInternalServerError)
		return
	}
}

// CreateWriteTextFileDiff generates a diff for write_text_file or edit_text_file tool calls.
// Returns the original content, modified content, and any error.
// For Anthropic, this returns an unimplemented error.
func CreateWriteTextFileDiff(ctx context.Context, chatId string, toolCallId string) ([]byte, []byte, error) {
	aiChat := chatstore.DefaultChatStore.Get(chatId)
	if aiChat == nil {
		return nil, nil, fmt.Errorf("chat not found: %s", chatId)
	}

	backend, err := GetBackendByAPIType(aiChat.APIType)
	if err != nil {
		return nil, nil, err
	}

	funcCallInput := backend.GetFunctionCallInputByToolCallId(*aiChat, toolCallId)
	if funcCallInput == nil {
		return nil, nil, fmt.Errorf("tool call not found: %s", toolCallId)
	}

	toolName := funcCallInput.Name
	if toolName != "write_text_file" && toolName != "edit_text_file" {
		return nil, nil, fmt.Errorf("tool call %s is not a write_text_file or edit_text_file (got: %s)", toolCallId, toolName)
	}

	var backupFileName string
	if funcCallInput.ToolUseData != nil {
		backupFileName = funcCallInput.ToolUseData.WriteBackupFileName
	}

	var parsedArguments any
	if err := json.Unmarshal([]byte(funcCallInput.Arguments), &parsedArguments); err != nil {
		return nil, nil, fmt.Errorf("failed to unmarshal arguments: %w", err)
	}

	if toolName == "edit_text_file" {
		originalContent, modifiedContent, err := EditTextFileDryRun(parsedArguments, backupFileName)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to generate diff: %w", err)
		}
		return originalContent, modifiedContent, nil
	}

	params, err := parseWriteTextFileInput(parsedArguments)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to parse write_text_file input: %w", err)
	}

	var originalContent []byte
	if backupFileName != "" {
		originalContent, err = os.ReadFile(backupFileName)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to read backup file: %w", err)
		}
	} else {
		expandedPath, err := gulinbase.ExpandHomeDir(params.Filename)
		if err != nil {
			return nil, nil, fmt.Errorf("failed to expand path: %w", err)
		}
		originalContent, err = os.ReadFile(expandedPath)
		if err != nil && !os.IsNotExist(err) {
			return nil, nil, fmt.Errorf("failed to read original file: %w", err)
		}
	}

	modifiedContent := []byte(params.Contents)
	return originalContent, modifiedContent, nil
}

type StaticFileInfo struct {
	Name         string `json:"name"`
	Size         int64  `json:"size"`
	Modified     string `json:"modified"`
	ModifiedTime string `json:"modified_time"`
}

func generateBuilderAppData(appId string) (string, string, string, error) {
	appGoFile := ""
	fileData, err := gulinappstore.ReadAppFile(appId, "app.go")
	if err == nil {
		appGoFile = string(fileData.Contents)
	}

	staticFilesJSON := ""
	allFiles, err := gulinappstore.ListAllAppFiles(appId)
	if err == nil {
		var staticFiles []StaticFileInfo
		for _, entry := range allFiles.Entries {
			if strings.HasPrefix(entry.Name, "static/") {
				staticFiles = append(staticFiles, StaticFileInfo{
					Name:         entry.Name,
					Size:         entry.Size,
					Modified:     entry.Modified,
					ModifiedTime: entry.ModifiedTime,
				})
			}
		}

		if len(staticFiles) > 0 {
			staticFilesBytes, marshalErr := json.Marshal(staticFiles)
			if marshalErr == nil {
				staticFilesJSON = string(staticFilesBytes)
			}
		}
	}

	platformInfo := gulinbase.GetSystemSummary()
	if currentUser, userErr := user.Current(); userErr == nil && currentUser.Username != "" {
		platformInfo = fmt.Sprintf("Local Machine: %s, User: %s", platformInfo, currentUser.Username)
	} else {
		platformInfo = fmt.Sprintf("Local Machine: %s", platformInfo)
	}

	return appGoFile, staticFilesJSON, platformInfo, nil
}

func runExpertSubChat(ctx context.Context, backend UseChatBackend, chatOpts uctypes.GulinChatOpts, sseHandler *sse.SSEHandlerCh, expertID string, task string) (string, error) {
	expert, ok := Experts[AgentExpertType(expertID)]
	if !ok {
		return "", fmt.Errorf("experto desconocido: %s", expertID)
	}

	// 1. Configurar el contexto del experto usando un SubChatId efímero para aislamiento total
	expertSubChatId := "expert-" + uuid.New().String()
	expertOpts := chatOpts
	expertOpts.ChatId = expertSubChatId
	expertOpts.Config.AIMode = string(expert.ID)
	// Heredar el modelo seleccionado por el usuario en el chat principal si está disponible
	if chatOpts.Config.Model != "" {
		expertOpts.Config.Model = chatOpts.Config.Model
	} else if expert.DefaultModel != "" {
		expertOpts.Config.Model = expert.DefaultModel
	} else {
		expertOpts.Config.Model = "gpt-4o-mini"
	}

	// 2. Obtener herramientas filtradas para el experto y su prompt específico
	tabState, tabTools, err := GenerateTabStateAndTools(ctx, chatOpts.TabId, chatOpts.WidgetAccess, &expertOpts)
	if err != nil {
		return "", fmt.Errorf("error generando herramientas para experto: %v", err)
	}
	expertOpts.TabTools = tabTools
	expertOpts.TabState = tabState
	expertOpts.SystemPrompt = getSystemPrompt(expertOpts.Config.APIType, expertOpts.Config.Model, false, true, chatOpts.WidgetAccess, expertOpts.Config.AIMode)

	// 3. Crear y guardar el mensaje para el experto en la base aislada
	expertTaskMsg := fmt.Sprintf("TAREA ESPECÍFICA (REGLA CRÍTICA: NO EMULAR RESULTADOS, OBTIENELOS USANDO TUS HERRAMIENTAS): %s\n\nResponde solo con el resultado técnico final.", task)
	aiMessage := uctypes.AIMessage{
		MessageId: uuid.New().String(),
		Role:      "user",
		Parts: []uctypes.AIMessagePart{
			{
				Type: uctypes.AIMessagePartTypeText,
				Text: expertTaskMsg,
			},
		},
	}
	nativeMsg, err := backend.ConvertAIMessageToNativeChatMessage(aiMessage)
	if err != nil {
		return "", fmt.Errorf("error convirtiendo mensaje de experto: %v", err)
	}
	if err := chatstore.DefaultChatStore.PostMessage(expertOpts.ChatId, &expertOpts.Config, nativeMsg); err != nil {
		return "", fmt.Errorf("falló al guardar mensaje del experto: %v", err)
	}

	// 4. Bucle de Ejecución del Experto (Tool Execution Loop)
	log.Printf("[MAS] Delegando a %s (Modelo: %s, SubChat: %s) la tarea: %s\n", expert.ID, expertOpts.Config.Model, expertSubChatId, task)

	_ = sseHandler.AiMsgData("data-expert-status", expertID, map[string]string{
		"status": "running",
		"task":   task,
	})

	// Informar al usuario en el chat principal mediante un bloque de pensamiento (Reasoning)
	reasoningID := "expert-reasoning-" + uuid.New().String()[:8]
	_ = sseHandler.AiMsgReasoningStart(reasoningID)
	_ = sseHandler.AiMsgReasoningDelta(reasoningID, fmt.Sprintf("Delegando a %s...\n", expert.Name))

	metrics := &uctypes.AIMetrics{
		ChatId:  expertSubChatId,
		AIMode:  expertOpts.Config.AIMode,
		Usage: uctypes.AIUsage{
			APIType: expertOpts.Config.APIType,
			Model:   expertOpts.Config.Model,
		},
	}

	var resultText string
	var cont *uctypes.GulinContinueResponse

	for {
		if ctx.Err() != nil {
			resultText = "Tarea cancelada por el usuario."
			break
		}
		subSSEHandler := sse.MakeSilentSSEHandlerCh(ctx)
		stopReason, nativeMsgs, rateLimitInfo, err := backend.RunChatStep(ctx, subSSEHandler, expertOpts, cont)
		updateRateLimit(rateLimitInfo)
		metrics.RequestCount++
		
		if len(nativeMsgs) > 0 {
			usage := getUsage(nativeMsgs)
			metrics.Usage.InputTokens += usage.InputTokens
			metrics.Usage.OutputTokens += usage.OutputTokens
			metrics.Usage.NativeWebSearchCount += usage.NativeWebSearchCount
		}

		if ctx.Err() != nil {
			resultText = "Tarea cancelada por el usuario."
			break
		}

		if err != nil {
			resultText = fmt.Sprintf("Error en experto: %v", err)
			break
		}

		// Enviar mensajes resultantes al sub-chat log y retransmitir pensamientos al chat principal
		for _, msg := range nativeMsgs {
			if msg != nil {
				if err := chatstore.DefaultChatStore.PostMessage(expertOpts.ChatId, &expertOpts.Config, msg); err != nil {
					log.Printf("Error guardando respuesta del experto: %v\n", err)
				}
				content := msg.GetContent()
				if content != "" {
					log.Printf("[PENSAMIENTO DE %s]: %s\n", expert.Name, content)
					// Retransmitir al bloque de razonamiento en la UI
					_ = sseHandler.AiMsgReasoningDelta(reasoningID, content+"\n")
				}
			}
		}

		// Si el experto decidió usar herramientas, procesarlas iterativamente
		if stopReason != nil && stopReason.Kind == uctypes.StopKindToolUse {
			if ctx.Err() != nil {
				resultText = "Tarea cancelada por el usuario."
				break
			}
			var toolNames []string
			for _, tc := range stopReason.ToolCalls {
				toolNames = append(toolNames, tc.Name)
			}
			_ = sseHandler.AiMsgData("data-expert-status", expertID, map[string]any{
				"status": "tool_use",
				"tools":  toolNames,
			})
			metrics.ToolUseCount += len(stopReason.ToolCalls)
			processAllToolCalls(ctx, backend, stopReason, expertOpts, sseHandler, metrics, expertID)
			if ctx.Err() != nil {
				resultText = "Tarea cancelada por el usuario."
				break
			}
			cont = &uctypes.GulinContinueResponse{
				Model:            expertOpts.Config.Model,
				ContinueFromKind: uctypes.StopKindToolUse,
			}
			continue
		}

		// Si el flujo terminó limpiamente o por otro motivo final
		if len(nativeMsgs) > 0 {
			resultText = nativeMsgs[0].GetContent()
		} else if stopReason != nil && stopReason.Kind != uctypes.StopKindDone {
			resultText = fmt.Sprintf("Experto se detuvo con motivo: %s", stopReason.Kind)
		} else {
			resultText = "Experto completó la tarea sin respuesta textual."
		}
		break
	}

	// Cerrar el bloque de pensamiento en la UI
	_ = sseHandler.AiMsgReasoningEnd(reasoningID)

	// Notificar conclusión y reportar la telemetría del experto
	_ = sseHandler.AiMsgData("data-expert-status", expertID, map[string]string{
		"status": "completed",
	})
	
	sendAIMetricsTelemetry(ctx, metrics)

	return resultText, nil
}

// AgentChatRequest represents the request body for posting a message from Auto Agents
type AgentChatRequest struct {
	ChatID       string            `json:"chatid"`
	Msg          uctypes.AIMessage `json:"msg"`
	Endpoint     string            `json:"endpoint"`
	APIKey       string            `json:"apikey"`
	Model        string            `json:"model"`
	Provider     string            `json:"provider"`
	APIType      string            `json:"apitype,omitempty"`
	SystemPrompt string            `json:"systemprompt"`
	TabId        string            `json:"tabid,omitempty"`
	Tools        []string          `json:"tools,omitempty"`
	Skills       []string          `json:"skills,omitempty"`
	LogFile      string            `json:"log_file,omitempty"`
}

type AgentLogRequest struct {
	AgentID   string `json:"agentid"`
	AgentName string `json:"agentname"`
	Log       string `json:"log"`
}

func GulinAIAgentLogHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req AgentLogRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	if req.AgentID == "" || req.Log == "" {
		http.Error(w, "agentid and log are required", http.StatusBadRequest)
		return
	}

	logEntry := fmt.Sprintf("[%s] [%s] %s\n", time.Now().Format("2006-01-02 15:04:05"), req.AgentName, req.Log)
	logDir := filepath.Join(gulinbase.GetWorkspacePath(""), "log")
	logFile := filepath.Join(logDir, fmt.Sprintf("%s.log", req.AgentID))

	if err := os.MkdirAll(logDir, 0755); err != nil {
		http.Error(w, fmt.Sprintf("Failed to create log directory: %v", err), http.StatusInternalServerError)
		return
	}

	f, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to open log file: %v", err), http.StatusInternalServerError)
		return
	}
	defer f.Close()

	if _, err := f.WriteString(logEntry); err != nil {
		http.Error(w, fmt.Sprintf("Failed to write to log file: %v", err), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func GulinAIAgentChatHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req AgentChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	if req.ChatID == "" {
		http.Error(w, "chatid is required", http.StatusBadRequest)
		return
	}

	apiType := req.APIType
	provLower := strings.ToLower(req.Provider)
	if apiType == "" || apiType == "custom" {
		if strings.Contains(provLower, "gemini") || strings.Contains(provLower, "google") {
			apiType = uctypes.APIType_GoogleGemini
		} else if strings.Contains(provLower, "anthropic") || strings.Contains(provLower, "claude") {
			apiType = uctypes.APIType_AnthropicMessages
		} else if strings.Contains(provLower, "bedrock") {
			apiType = uctypes.APIType_AWSBedrock
		} else if strings.Contains(provLower, "plai") {
			apiType = uctypes.APIType_PlaiAssistant
		} else {
			apiType = uctypes.APIType_OpenAIChat
		}
	}

	if apiType == uctypes.APIType_GoogleGemini && req.Endpoint == "https://generativelanguage.googleapis.com/v1beta/models/" {
		req.Endpoint = ""
	}

	// Create custom AI Opts
	aiOpts := &uctypes.AIOptsType{
		Endpoint: req.Endpoint,
		APIToken: req.APIKey,
		Model:    req.Model,
		Provider: req.Provider,
		APIType:  apiType,
	}

	chatOpts := uctypes.GulinChatOpts{
		ChatId:               req.ChatID,
		ClientId:             wstore.GetClientId(),
		Config:               *aiOpts,
		WidgetAccess:         true,
		AllowNativeWebSearch: true,
		TabId:                req.TabId,
	}

	// Inyectar Skills especializadas del agente
	for _, skillName := range req.Skills {
		skillCtx := GetGulinSkillContext(skillName)
		if skillCtx != "" {
			chatOpts.SystemPrompt = append(chatOpts.SystemPrompt, skillCtx)
		}
	}

	// Inyectar el Brain Context (memoria e infraestructura real)
	userText := ""
	for _, p := range req.Msg.Parts {
		if p.Type == "text" {
			userText += p.Text + " "
		}
	}
	brainCtx := GetGulinBrainContext(userText)
	if brainCtx != "" {
		chatOpts.SystemPrompt = append(chatOpts.SystemPrompt, 
			fmt.Sprintf("INFORMACIÓN REAL DE LA INFRAESTRUCTURA (GULIN BRAIN):\n%s\n\nREGLA ESTRICTA ANTI-ALUCINACIÓN: Basa tu análisis exclusivamente en los datos reales mostrados arriba. Si un recurso (ej: bases RDS, buckets S3) NO existe en los datos, debes declarar explícitamente que no existe. NUNCA inventes recursos, métricas ni configuraciones ficticias.", brainCtx),
		)
	}

	if req.TabId != "" {
		tabState, tabTools, err := GenerateTabStateAndTools(r.Context(), req.TabId, true, &chatOpts)
		if err == nil {
			if tabState != "" {
				chatOpts.SystemPrompt = append(chatOpts.SystemPrompt, tabState)
			}
			chatOpts.Tools = append(chatOpts.Tools, tabTools...)
		}
	} else {
		// Full tools suite if no TabId is provided
		chatOpts.Tools = append(chatOpts.Tools,
			GetReadTextFileToolDefinition(),
			GetReadDirToolDefinition(),
			GetWriteTextFileToolDefinition(),
			GetEditTextFileToolDefinition(),
			GetDeleteTextFileToolDefinition(),
			GetGulinBrainUpdateToolDefinition(),
			GetGulinBrainListToolDefinition(),
			GetGulinBrainSearchToolDefinition(),
			GetWorkspaceSearchToolDefinition(),
			GetDBListConnectionsToolDefinition(),
			GetDBTestConnectionToolDefinition(),
			GetDBQueryToolDefinition(req.TabId),
			GetAPICallToolDefinition(),
			GetAPIListToolDefinition(),
			GetAPIDeleteToolDefinition(),
			GetWebSearchToolDefinition(req.TabId),
			GetListAvailableToolsToolDefinition(),
		)
	}

	// Filtrar herramientas específicas del agente si se parametrizaron
	if len(req.Tools) > 0 {
		toolMap := make(map[string]bool)
		for _, t := range req.Tools {
			toolMap[t] = true
		}
		var filteredTools []uctypes.ToolDefinition
		for _, t := range chatOpts.Tools {
			if toolMap[t.Name] {
				filteredTools = append(filteredTools, t)
			}
		}
		chatOpts.Tools = filteredTools
	}

	sseHandler := sse.MakeSSEHandlerCh(w, r.Context())
	defer sseHandler.Close()

	// Audit log to workspace log folder
	agentID := req.ChatID
	if strings.HasPrefix(agentID, "agent-") {
		parts := strings.Split(agentID, "-")
		if len(parts) >= 2 {
			agentID = parts[1]
		}
	}
	logFile := req.LogFile
	if logFile == "" {
		logDir := filepath.Join(gulinbase.GetWorkspacePath(""), "log")
		_ = os.MkdirAll(logDir, 0755)
		logFile = filepath.Join(logDir, fmt.Sprintf("%s.log", agentID))
	} else {
		_ = os.MkdirAll(filepath.Dir(logFile), 0755)
	}

	logEntry := fmt.Sprintf("[%s] Interacción: %s\n", time.Now().Format("2006-01-02 15:04:05"), userText)
	if f, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644); err == nil {
		_, _ = f.WriteString(logEntry)
		f.Close()
	}

	if err := GulinAIPostMessageWrap(r.Context(), sseHandler, &req.Msg, chatOpts); err != nil {
		log.Printf("GulinAIPostMessageWrap failed: %v", err)
		http.Error(w, fmt.Sprintf("Failed to post message: %v", err), http.StatusInternalServerError)
		return
	}
}
