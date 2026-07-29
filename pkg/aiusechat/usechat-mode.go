// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gulindev/gulin/pkg/aiusechat/aiutil"
	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/secretstore"
	"github.com/gulindev/gulin/pkg/wconfig"
	"github.com/gulindev/gulin/pkg/wps"
)

var AzureResourceNameRegex = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`)

var (
	bridgeModesLock sync.Mutex
	bridgeModes     = make(map[string]wconfig.AIModeConfigType)
)

const (
	OpenAIResponsesEndpoint        = "https://api.openai.com/v1/responses"
	OpenAIChatEndpoint             = "https://api.openai.com/v1/chat/completions"
	OpenRouterChatEndpoint         = "https://openrouter.ai/api/v1/chat/completions"
	NanoGPTChatEndpoint            = "https://nano-gpt.com/api/v1/chat/completions"
	GroqChatEndpoint               = "https://api.groq.com/openai/v1/chat/completions"
	DeepSeekChatEndpoint           = "https://api.deepseek.com/chat/completions"
	AzureLegacyEndpointTemplate    = "https://%s.openai.azure.com/openai/deployments/%s/chat/completions?api-version=%s"
	AzureResponsesEndpointTemplate = "https://%s.openai.azure.com/openai/v1/responses"
	AzureChatEndpointTemplate      = "https://%s.openai.azure.com/openai/v1/chat/completions"
	GoogleGeminiEndpointTemplate   = "https://generativelanguage.googleapis.com/v1beta/models/%s:streamGenerateContent"

	AzureLegacyDefaultAPIVersion = "2025-04-01-preview"

	OpenAIAPITokenSecretName      = "OPENAI_KEY"
	OpenRouterAPITokenSecretName  = "OPENROUTER_KEY"
	NanoGPTAPITokenSecretName     = "NANOGPT_KEY"
	GroqAPITokenSecretName        = "GROQ_KEY"
	DeepSeekAPITokenSecretName    = "DEEPSEEK_KEY"
	AzureOpenAIAPITokenSecretName = "AZURE_OPENAI_KEY"
	GoogleAIAPITokenSecretName    = "GOOGLE_AI_KEY"
)

func resolveAIMode(requestedMode string, premium bool) (string, *wconfig.AIModeConfigType, error) {
	mode := requestedMode
	baseMode := mode
	if strings.HasSuffix(mode, "@plan") {
		baseMode = strings.TrimSuffix(mode, "@plan")
	} else if strings.HasSuffix(mode, "@act") {
		baseMode = strings.TrimSuffix(mode, "@act")
	} else if strings.HasSuffix(mode, "@orchestrate") {
		baseMode = strings.TrimSuffix(mode, "@orchestrate")
	}

	config, err := getAIModeConfig(baseMode)
	if err != nil {
		return "", nil, err
	}

	if config.GulinAICloud && !premium {
		mode = uctypes.AIModeQuick
		config, err = getAIModeConfig(mode)
		if err != nil {
			return "", nil, err
		}
	}

	log.Printf("DEBUG: resolveAIMode requestedMode=%q baseMode=%q\n", requestedMode, baseMode)
	return mode, config, nil
}

func applyProviderDefaults(config *wconfig.AIModeConfigType) {
	if config.Provider == uctypes.AIProvider_Gulin {
		config.GulinAICloud = true
		if config.Endpoint == "" {
			config.Endpoint = uctypes.DefaultAIEndpoint
			if os.Getenv(uctypes.GulinAIEndpointEnvName) != "" {
				config.Endpoint = os.Getenv(uctypes.GulinAIEndpointEnvName)
			}
		}
	}
	if config.Provider == uctypes.AIProvider_OpenAI {
		if config.APIType == "" {
			config.APIType = getOpenAIAPIType(config.Model)
		}
		if config.Endpoint == "" {
			switch config.APIType {
			case uctypes.APIType_OpenAIResponses:
				config.Endpoint = OpenAIResponsesEndpoint
			case uctypes.APIType_OpenAIChat:
				config.Endpoint = OpenAIChatEndpoint
			default:
				config.Endpoint = OpenAIChatEndpoint
			}
		}
		if config.APITokenSecretName == "" {
			config.APITokenSecretName = OpenAIAPITokenSecretName
		}
		if len(config.Capabilities) == 0 {
			if isO1Model(config.Model) {
				config.Capabilities = []string{}
			} else {
				config.Capabilities = []string{uctypes.AICapabilityTools, uctypes.AICapabilityImages, uctypes.AICapabilityPdfs}
			}
		}
	}
	if config.Provider == uctypes.AIProvider_OpenRouter {
		if config.APIType == "" {
			config.APIType = uctypes.APIType_OpenAIChat
		}
		if config.Endpoint == "" {
			config.Endpoint = OpenRouterChatEndpoint
		}
		if config.APITokenSecretName == "" {
			config.APITokenSecretName = OpenRouterAPITokenSecretName
		}
	}
	if config.Provider == uctypes.AIProvider_NanoGPT {
		if config.APIType == "" {
			config.APIType = uctypes.APIType_OpenAIChat
		}
		if config.Endpoint == "" {
			config.Endpoint = NanoGPTChatEndpoint
		}
		if config.APITokenSecretName == "" {
			config.APITokenSecretName = NanoGPTAPITokenSecretName
		}
	}
	if config.Provider == uctypes.AIProvider_Groq {
		if config.APIType == "" {
			config.APIType = uctypes.APIType_OpenAIChat
		}
		if config.Endpoint == "" {
			config.Endpoint = GroqChatEndpoint
		}
		if config.APITokenSecretName == "" {
			config.APITokenSecretName = GroqAPITokenSecretName
		}
	}
	if config.Provider == uctypes.AIProvider_AWSBedrock {
		if config.APIType == "" {
			config.APIType = uctypes.APIType_AWSBedrock
		}
		if config.Endpoint == "" {
			config.Endpoint = "aws-bedrock"
		}
	}
	if config.Provider == uctypes.AIProvider_DeepSeek {
		if config.APIType == "" {
			config.APIType = uctypes.APIType_OpenAIChat
		}
		if config.Endpoint == "" {
			config.Endpoint = DeepSeekChatEndpoint
		}
		if config.APITokenSecretName == "" {
			config.APITokenSecretName = DeepSeekAPITokenSecretName
		}
		if len(config.Capabilities) == 0 {
			config.Capabilities = []string{uctypes.AICapabilityTools, uctypes.AICapabilityImages, uctypes.AICapabilityPdfs}
		}
	}
	if config.Provider == uctypes.AIProvider_Groq {
		if config.APIType == "" {
			config.APIType = uctypes.APIType_OpenAIChat
		}
		if config.Endpoint == "" {
			config.Endpoint = GroqChatEndpoint
		}
		if config.APITokenSecretName == "" {
			config.APITokenSecretName = GroqAPITokenSecretName
		}
		if len(config.Capabilities) == 0 {
			config.Capabilities = []string{uctypes.AICapabilityTools}
		}
	}
	if config.Provider == uctypes.AIProvider_OpenRouter {
		if config.APIType == "" {
			config.APIType = uctypes.APIType_OpenAIChat
		}
		if config.Endpoint == "" {
			config.Endpoint = OpenRouterChatEndpoint
		}
		if config.APITokenSecretName == "" {
			config.APITokenSecretName = OpenRouterAPITokenSecretName
		}
		if len(config.Capabilities) == 0 {
			config.Capabilities = []string{uctypes.AICapabilityTools, uctypes.AICapabilityImages, uctypes.AICapabilityPdfs}
		}
	}
	if config.Provider == uctypes.AIProvider_AzureLegacy {
		if config.AzureAPIVersion == "" {
			config.AzureAPIVersion = AzureLegacyDefaultAPIVersion
		}
		if config.Endpoint == "" && isValidAzureResourceName(config.AzureResourceName) && config.AzureDeployment != "" {
			config.Endpoint = fmt.Sprintf(AzureLegacyEndpointTemplate,
				config.AzureResourceName, config.AzureDeployment, config.AzureAPIVersion)
		}
		if config.APIType == "" {
			config.APIType = uctypes.APIType_OpenAIChat
		}
		if config.APITokenSecretName == "" {
			config.APITokenSecretName = AzureOpenAIAPITokenSecretName
		}
	}
	if config.Provider == uctypes.AIProvider_Azure {
		if config.AzureAPIVersion == "" {
			config.AzureAPIVersion = "v1" // purely informational for now
		}
		if config.APIType == "" {
			config.APIType = getAzureAPIType(config.Model)
		}
		if config.Endpoint == "" && isValidAzureResourceName(config.AzureResourceName) && isAzureAPIType(config.APIType) {
			switch config.APIType {
			case uctypes.APIType_OpenAIResponses:
				config.Endpoint = fmt.Sprintf(AzureResponsesEndpointTemplate, config.AzureResourceName)
			case uctypes.APIType_OpenAIChat:
				config.Endpoint = fmt.Sprintf(AzureChatEndpointTemplate, config.AzureResourceName)
			}
		}
		if config.APITokenSecretName == "" {
			config.APITokenSecretName = AzureOpenAIAPITokenSecretName
		}
	}
	if config.Provider == uctypes.AIProvider_Google {
		if config.APIType == "" {
			config.APIType = uctypes.APIType_GoogleGemini
		}
		if config.Endpoint == "" && config.Model != "" {
			config.Endpoint = fmt.Sprintf(GoogleGeminiEndpointTemplate, config.Model)
		}
		if config.APITokenSecretName == "" {
			config.APITokenSecretName = GoogleAIAPITokenSecretName
		}
		if len(config.Capabilities) == 0 {
			config.Capabilities = []string{uctypes.AICapabilityTools, uctypes.AICapabilityImages, uctypes.AICapabilityPdfs}
		}
	}
	if config.Provider == uctypes.AIProvider_GulinBridge {
		if config.APIType == "" {
			config.APIType = uctypes.APIType_OpenAIChat
		}
		if len(config.Capabilities) == 0 {
			config.Capabilities = []string{uctypes.AICapabilityTools}
		}
	}
	if config.APIType == "" {
		config.APIType = uctypes.APIType_OpenAIChat
	}
}

func isAzureAPIType(apiType string) bool {
	return apiType == uctypes.APIType_OpenAIChat || apiType == uctypes.APIType_OpenAIResponses
}

func getOpenAIAPIType(model string) string {
	if isLegacyOpenAIModel(model) {
		return uctypes.APIType_OpenAIChat
	}
	// All newer OpenAI models support openai-responses API:
	// gpt-5*, gpt-4.1*, o1*, o3*, and any future models
	return uctypes.APIType_OpenAIResponses
}

func getAzureAPIType(model string) string {
	if isNewOpenAIModel(model) {
		return uctypes.APIType_OpenAIResponses
	}
	return uctypes.APIType_OpenAIChat
}

func isNewOpenAIModel(model string) bool {
	if model == "" {
		return false
	}
	newPrefixes := []string{"o1", "o3", "gpt-6", "gpt-5", "gpt-4.1"}
	for _, prefix := range newPrefixes {
		if aiutil.CheckModelPrefix(model, prefix) {
			return true
		}
	}
	if aiutil.CheckModelSubPrefix(model, "gpt-5.") || aiutil.CheckModelSubPrefix(model, "gpt-6.") {
		return true
	}
	return false
}

func isLegacyOpenAIModel(model string) bool {
	if model == "" {
		return false
	}
	legacyPrefixes := []string{"gpt-4o", "gpt-3.5", "gpt-oss"}
	for _, prefix := range legacyPrefixes {
		if aiutil.CheckModelPrefix(model, prefix) {
			return true
		}
	}
	return false
}

func isO1Model(model string) bool {
	if model == "" {
		return false
	}
	o1Prefixes := []string{"o1", "o1-mini"}
	for _, prefix := range o1Prefixes {
		if aiutil.CheckModelPrefix(model, prefix) {
			return true
		}
	}
	return false
}

func isValidAzureResourceName(name string) bool {
	if name == "" || len(name) > 63 {
		return false
	}
	return AzureResourceNameRegex.MatchString(name)
}

func getAIModeConfig(aiMode string) (*wconfig.AIModeConfigType, error) {
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	
	bridgeModesLock.Lock()
	config, ok := bridgeModes[aiMode]
	activeKeys := make([]string, 0, len(bridgeModes))
	for k := range bridgeModes {
		activeKeys = append(activeKeys, k)
	}
	bridgeModesLock.Unlock()
	
	f, _ := os.OpenFile("/tmp/bridge_sync.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if f != nil {
		fmt.Fprintf(f, "[%s] getAIModeConfig: aiMode=%q ok=%v bridgeModesKeys=%v\n", time.Now().Format(time.RFC3339), aiMode, ok, activeKeys)
		f.Close()
	}
	
	if !ok {
		config, ok = fullConfig.GulinAIModes[aiMode]
	}
	
	if !ok {
		return nil, fmt.Errorf("invalid AI mode: %s", aiMode)
	}

	applyProviderDefaults(&config)
	return &config, nil
}

func InitAIModeConfigWatcher() {
	watcher := wconfig.GetWatcher()
	watcher.RegisterUpdateHandler(handleConfigUpdate)
	log.Printf("AI mode config watcher initialized\n")
	
	// Sincronización inicial asíncrona
	go func() {
		time.Sleep(2 * time.Second) // Breve espera para asegurar que los servicios base estén listos
		SyncGulinBridgeModels()
	}()
}

func handleConfigUpdate(fullConfig wconfig.FullConfigType) {
	resolvedConfigs := ComputeResolvedAIModeConfigs(fullConfig)
	broadcastAIModeConfigs(resolvedConfigs)
}

func ComputeResolvedAIModeConfigs(fullConfig wconfig.FullConfigType) map[string]wconfig.AIModeConfigType {
	resolvedConfigs := make(map[string]wconfig.AIModeConfigType)

	for modeName, modeConfig := range fullConfig.GulinAIModes {
		resolved := modeConfig
		applyProviderDefaults(&resolved)
		resolvedConfigs[modeName] = resolved
	}

	bridgeModesLock.Lock()
	for modeName, modeConfig := range bridgeModes {
		resolved := modeConfig
		applyProviderDefaults(&resolved)
		resolvedConfigs[modeName] = resolved
	}
	bridgeModesLock.Unlock()

	return resolvedConfigs
}

func broadcastAIModeConfigs(configs map[string]wconfig.AIModeConfigType) {
	keys := make([]string, 0, len(configs))
	for k := range configs {
		keys = append(keys, k)
	}
	log.Printf("BROADCAST: Enviando %d modos de IA. Claves: %v\n", len(keys), keys)
	update := wconfig.AIModeConfigUpdate{
		Configs: configs,
	}

	wps.Broker.Publish(wps.GulinEvent{
		Event: wps.Event_AIModeConfig,
		Data:  update,
	})
}
func getProviderFromModelID(modelID string, originalProvider string) string {
	m := strings.ToLower(modelID)
	if strings.HasPrefix(m, "gpt-") || strings.HasPrefix(m, "o1-") || strings.HasPrefix(m, "o3-") || strings.Contains(m, "text-embedding-3") {
		return "openai"
	}
	if strings.Contains(m, "claude-") || strings.HasPrefix(m, "anthropic.") {
		return "anthropic"
	}
	if strings.Contains(m, "gemini-") || strings.HasPrefix(m, "models/gemini") || strings.HasPrefix(m, "google.") {
		return "google"
	}
	if strings.Contains(m, "deepseek-") {
		return "deepseek"
	}
	if strings.Contains(m, "llama-") || strings.Contains(m, "meta-") {
		return "meta"
	}
	if strings.Contains(m, "mistral-") || strings.Contains(m, "pixtral-") {
		return "mistral"
	}
	if strings.HasPrefix(m, "amazon.") {
		return "amazon"
	}
	if strings.Contains(m, "auto/") {
		return "auto"
	}
	if originalProvider != "" && originalProvider != "openai" {
		return originalProvider
	}
	// Fallback to "other" if we can't determine it, rather than just "openai"
	return "other"
}

var googleModelOverrides = map[string]string{
	"models/gemini-2.5-flash-lite": "gemini-2.5-flash-lite",
	"gemini-2.5-flash-lite":        "gemini-2.5-flash-lite",
	"models/gemini-3.1-flash-lite": "gemini-3.1-flash-lite",
	"gemini-3.1-flash-lite":        "gemini-3.1-flash-lite",
	"models/gemini-3-flash":        "gemini-3-flash",
	"gemini-3-flash":               "gemini-3-flash",
	"models/gemini-2.5-flash":      "gemini-2.5-flash",
	"gemini-2.5-flash":             "gemini-2.5-flash",
	"models/gemini-3.1-pro":        "gemini-3.1-pro",
	"models/gemini-3-pro":          "gemini-3-pro",
}

func SyncGulinBridgeModels() error {
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	settings := fullConfig.Settings

	if !settings.GulinBridgeEnabled || settings.GulinBridgeURL == "" || settings.GulinBridgeEmail == "" {
		return nil
	}

	// Logging to file for debugging
	logFile, _ := os.OpenFile("/tmp/bridge_sync_debug.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if logFile != nil {
		defer logFile.Close()
	}
	logToAll := func(s string) {
		fmt.Printf(s + "\n")
		if logFile != nil {
			logFile.WriteString(time.Now().Format("15:04:05") + " " + s + "\n")
		}
	}

	logToAll(fmt.Sprintf("Gulin Bridge: Iniciando sincronización para %s", settings.GulinBridgeEmail))
	tokenSecretName := settings.GulinBridgeTokenSecretName
	if tokenSecretName == "" {
		tokenSecretName = "gulinbridge:token"
	}

	client := NewGulinBridgeClient(settings.GulinBridgeURL)
	var rawModels []GulinBridgeModel

	// 1. Intentar usar Gulin Token directamente si existe
	gulinToken, tokenExists, _ := secretstore.GetSecret(tokenSecretName)
	if tokenExists && gulinToken != "" {
		logToAll("Gulin Bridge: Intentando sincronizar modelos usando Gulin Token...")
		var err error
		rawModels, err = client.DiscoverModelsByProxy(gulinToken)
		if err == nil {
			logToAll(fmt.Sprintf("Gulin Bridge: Sincronización exitosa vía Proxy Token (%d modelos)", len(rawModels)))
		} else {
			logToAll(fmt.Sprintf("Gulin Bridge: Fallo sincronización vía Proxy Token: %v", err))
		}
	}

	// 2. Si falló el Proxy Token o no existe, intentar Login administrativo
	if len(rawModels) == 0 && settings.GulinBridgeEmail != "" {
		passwordSecretName := settings.GulinBridgePasswordSecretName
		if passwordSecretName == "" {
			passwordSecretName = "gulinbridge:password"
		}
		password, exists, err := secretstore.GetSecret(passwordSecretName)
		if err == nil && exists && password != "" {
			logToAll("Gulin Bridge: Intentando login administrativo...")
			token, err := client.Login(settings.GulinBridgeEmail, password)
			if err == nil {
				logToAll("Gulin Bridge: Login exitoso")
				// Obtener el dashboard para buscar el Gulin Token si no lo tenemos
				if gulinToken == "" {
					dashboard, errD := client.GetDashboardData(token)
					if errD == nil {
						for _, k := range dashboard.ApiKeys {
							if k.Name == "Gulin Term" {
								gulinToken = k.Key
								_ = secretstore.SetSecret(tokenSecretName, gulinToken)
								logToAll("Gulin Bridge: Gulin Token guardado desde el dashboard")
								break
							}
						}
					}
				}
				rawModels, err = client.DiscoverModels(token)
				if err != nil || len(rawModels) == 0 {
					logToAll(fmt.Sprintf("Gulin Bridge: Descubrimiento Admin falló (%v), intentando vía Proxy con Gulin Token...", err))
					if gulinToken != "" {
						rawModels, err = client.DiscoverModelsByProxy(gulinToken)
					}
				}

				if err == nil {
					logToAll(fmt.Sprintf("Gulin Bridge: Sincronización exitosa (%d modelos)", len(rawModels)))
				} else {
					logToAll(fmt.Sprintf("Gulin Bridge: Fallo total al descubrir modelos: %v", err))
				}
			} else {
				logToAll(fmt.Sprintf("Gulin Bridge: Fallo login administrativo: %v", err))
			}
		} else {
			logToAll("Gulin Bridge: No se encontró contraseña para login administrativo")
		}
	}

	if len(rawModels) == 0 {
		return fmt.Errorf("no se pudieron descubrir modelos (ni por token ni por login)")
	}

	f, _ := os.OpenFile("/tmp/bridge_sync.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if f != nil {
		fmt.Fprintf(f, "[%s] Gulin Bridge Sync: URL=%s Recibidos=%d modelos\n", time.Now().Format(time.RFC3339), settings.GulinBridgeURL, len(rawModels))
		f.Close()
	}

	// Post-procesar modelos para detectar el proveedor real
	var models []GulinBridgeModel
	foundAuto := false
	for _, m := range rawModels {
		if m.ID == "auto/model" {
			foundAuto = true
		}
		m.Provider = getProviderFromModelID(m.ID, m.Provider)
		logToAll(fmt.Sprintf("Gulin Bridge: Modelo descubierto ID=%s Provider=%s", m.ID, m.Provider))
		models = append(models, m)
	}

	// Forzar la inclusión del modelo Auto si no fue descubierto (el Bridge siempre lo tiene)
	if !foundAuto {
		logToAll("Gulin Bridge: Forzando inclusión de modelo Auto (auto/model)")
		models = append(models, GulinBridgeModel{
			ID:        "auto/model",
			Provider:  "auto",
			Name:      "Auto",
			Available: true,
		})
	}

	// Lista de modelos que fallaron en las pruebas de conectividad recentes (Status 500/etc.)
	// Modelos que reportaron errores persistentes o cuota agotada (429) en el último test de saneamiento.
	inactiveModels := map[string]bool{
		"models/gemini-2.5-pro":                               true,
		"models/gemini-2.0-flash":                             true,
		"models/gemini-2.0-flash-lite":                        true,
		"models/deepseek-chat":                                true,
		"models/gemini-2.5-computer-use-preview-10-2025":      true,
		"models/deep-research-pro-preview-12-2025":            true,
	}

	// Ordenar modelos: Primero por proveedor (alfabético), luego por relevancia
	sort.Slice(models, func(i, j int) bool {
		mi, mj := models[i], models[j]
		if mi.Provider != mj.Provider {
			return mi.Provider < mj.Provider
		}
		
		// Heurística de "baratos": Haiku, Mini, Flash al principio
		isCheap := func(name string) bool {
			n := strings.ToLower(name)
			return strings.Contains(n, "haiku") || strings.Contains(n, "mini") || strings.Contains(n, "flash")
		}
		
		ci, cj := isCheap(mi.ID), isCheap(mj.ID)
		if ci != cj {
			return ci // Si i es barato y j no, i va primero
		}
		
		return mi.ID < mj.ID
	})

	// Actualizar los modos de IA en la configuración
	bridgeModesLock.Lock()
	clear(bridgeModes)
	for _, m := range models {
		if !m.Available {
			continue
		}

		displayName := m.Name
		displayDescription := fmt.Sprintf("Modelo %s vía Gulin Bridge", m.Name)

		// LOGGING PARA DEPURACIÓN (se escribe en el Home del usuario para visibilidad)
		homeDir, _ := os.UserHomeDir()
		if homeDir != "" {
			f, _ := os.OpenFile(filepath.Join(homeDir, "GulinBridgeModels.txt"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
			if f != nil {
				fmt.Fprintf(f, "[%s] ID: %s, Provider: %s, Name: %s\n", time.Now().Format("15:04:05"), m.ID, m.Provider, m.Name)
				f.Close()
			}
		}

		// Desactivar el filtro restrictivo de Google: aceptar todos
		displayName = m.Name
		
		// Desactivar el filtro de modelos inactivos: permitir todos los que el Bridge envíe como activos
		_ = inactiveModels
		_ = googleModelOverrides


		caps := []string{"base"}
		// Asignar herramientas de forma dinámica desde los metadatos del bridge
		if m.Capabilities != nil && m.Capabilities["tools"] {
			caps = append(caps, uctypes.AICapabilityTools)
		} else if m.Provider == "openai" || m.Provider == "anthropic" || m.Provider == "google" || m.Provider == "deepseek" || m.Provider == "auto" || m.Provider == "Auto" {
			// Fallback: Habilitar herramientas para proveedores conocidos en caso de no tener el metadato
			caps = append(caps, uctypes.AICapabilityTools)
		}
		modeID := fmt.Sprintf("bridge:%s:%s", m.Provider, m.ID)

		// Para el modo "auto/model", redirigir a claude-haiku-4-5 como modelo efectivo.
		// gemini-2.5-flash-lite falla silenciosamente o por cuota (429).
		effectiveModel := m.ID
		effectiveProvider := m.Provider
		effectiveDisplayName := displayName
		effectiveDisplayDesc := displayDescription

		if m.ID == "auto/model" {
			effectiveDisplayName = "Auto"
			effectiveDisplayDesc = "Selección automática de modelo optimizada por Gulin Bridge"
		}

		bridgeModes[modeID] = wconfig.AIModeConfigType{
			DisplayName:        effectiveDisplayName,
			DisplayDescription: effectiveDisplayDesc,
			DisplayIcon:        "bridge",
			Provider:           uctypes.AIProvider_GulinBridge,
			BridgeProvider:     effectiveProvider,
			Model:              effectiveModel,
			Endpoint:           settings.GulinBridgeURL + "/v1/chat/completions",
			APIType:            uctypes.APIType_OpenAIChat,
			APIToken:           gulinToken,
			Capabilities:       caps,
			GulinAICloud:       true,
			GulinAIPremium:     m.Capabilities["premium"],
		}
	}
	bridgeModesLock.Unlock()

	// Notificar actualización de configuración
	handleConfigUpdate(fullConfig)

	log.Printf("Gulin Bridge: Sincronizados %d modelos\n", len(models))
	return nil
}

func ClearGulinBridgeModels() {
	bridgeModesLock.Lock()
	clear(bridgeModes)
	bridgeModesLock.Unlock()
	
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	handleConfigUpdate(fullConfig)
}
