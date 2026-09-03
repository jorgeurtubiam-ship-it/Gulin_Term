// Copyright 2026, GuLiN Terminal
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gulindev/gulin/pkg/aiusechat/chatstore"
	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/secretstore"
	"github.com/gulindev/gulin/pkg/web/sse"
)

func init() {
	uctypes.NativeMessageUnmarshalers[uctypes.APIType_PlaiAssistant] = func(data []byte) (uctypes.GenAIMessage, error) {
		var m uctypes.PlaiMessage
		if err := json.Unmarshal(data, &m); err != nil {
			return nil, err
		}
		return &m, nil
	}
}

type PlaiRequest struct {
	Input string `json:"input"`
}

type plaiBackend struct{}

func (b *plaiBackend) RunChatStep(
	ctx context.Context,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.GulinChatOpts,
	cont *uctypes.GulinContinueResponse,
) (*uctypes.GulinStopReason, []uctypes.GenAIMessage, *uctypes.RateLimitInfo, error) {
	if sseHandler == nil {
		return nil, nil, nil, fmt.Errorf("sse handler is nil")
	}
	ctx = context.WithValue(ctx, sse.SSEHandlerContextKey, sseHandler)

	// Obtener el chat
	chat := chatstore.DefaultChatStore.Get(chatOpts.ChatId)
	if chat == nil {
		return nil, nil, nil, fmt.Errorf("chat not found: %s", chatOpts.ChatId)
	}

	// SOPORTE DINÁMICO DE HERRAMIENTAS: 
	// Si chatOpts.Tools está vacío, intentamos usar el generador de la pestaña para obtener herramientas de terminal reales.
	if len(chatOpts.Tools) == 0 && chatOpts.TabStateGenerator != nil {
		_, tabTools, _, err := chatOpts.TabStateGenerator() // Ignoramos tabState aquí
		if err == nil {
			chatOpts.Tools = tabTools
		}
	}

	// Ensamble asincrónico para el escudo de contexto
	var sysPart, statePart, historyPart strings.Builder

	// 1. Instrucciones Críticas (System Prompt) - OPTIMIZADO PARA AHORRO DE ESPACIO
	if len(chatOpts.SystemPrompt) > 0 {
		for _, s := range chatOpts.SystemPrompt {
			sysPart.WriteString(s)
			sysPart.WriteString("\n")
		}
	}

	// 2. Estado de la Terminal (DESACTIVADO el estado completo por modelo Reactivo, pero enviamos el ID)
	if chatOpts.TabState != "" {
		widgetId := findPrimaryWidgetId(chatOpts.TabState)
		if widgetId != "" {
			statePart.WriteString(fmt.Sprintf("### CONTEXTO ACTIVO:\nEl ID de tu widget de terminal actual es: %s\nUsa este ID para el parámetro 'widget_id' en tus herramientas de terminal.\n\n", widgetId))
		}
	}

	// 3. Historial (Mantener los últimos mensajes con presupuesto estricto de 15KB)
	msgCount := len(chat.NativeMessages)
	if msgCount > 0 {
		historyPart.WriteString("### RECIENTE:\n")
		
		const TotalHistoryBudget = 15000
		currentBudget := TotalHistoryBudget
		
		// Reservar espacio para el Objetivo (Primer mensaje) - SANITIZADO
		firstMsg := chat.NativeMessages[0]
		goalContent := firstMsg.GetContent()
		if len(goalContent) > 1500 { goalContent = goalContent[:1500] + "..." }
		goalStr := fmt.Sprintf("GOAL: %s\n---\n", goalContent)
		historyPart.WriteString(goalStr)
		currentBudget -= len(goalStr)
		
		var messagesToInclude []string
		// Procesar de más nuevo a más viejo (excluyendo el primero que ya incluimos como GOAL)
		for i := msgCount - 1; i >= 1; i-- {
			msg := chat.NativeMessages[i]
			role := msg.GetRole()
			content := msg.GetContent()
			if role == "assistant" { role = "A" } else { role = "U" }
			if msg.GetRole() == "tool" {
				content = "[RESULTADO]: " + content
			}
			
			encoded := content
			const MaxMsgLen = 8000
			if len(encoded) > MaxMsgLen {
				encoded = encoded[:MaxMsgLen] + "..."
			}
			
			formatted := fmt.Sprintf("%s: %s\n", role, encoded)
			if len(formatted) < currentBudget {
				messagesToInclude = append([]string{formatted}, messagesToInclude...)
				currentBudget -= len(formatted)
			} else {
				break
			}
			
			if len(messagesToInclude) >= 10 { break }
		}
		
		for _, m := range messagesToInclude {
			historyPart.WriteString(m)
		}
		historyPart.WriteString("\n")
	}

	// 4. Herramientas y Acción (Restaurando Schemas técnicos)
	var baseTools []uctypes.ToolDefinition
	rawTools := chatOpts.Tools
	if chatOpts.TabStateGenerator != nil {
		_, tabTools, _, _ := chatOpts.TabStateGenerator()
		rawTools = tabTools
	}

	for _, t := range rawTools {
		// BLOQUEO TOTAL DE HERRAMIENTAS WEB Y BÚSQUEDA
		if strings.HasPrefix(t.Name, "web_") || strings.Contains(t.Name, "search") && t.Name != "workspace_search" && t.Name != "term_search" {
			continue
		}
		// Filtro: Solo excluimos herramientas que no sean de descubrimiento/sistema (ya que las añadimos explícitamente abajo)
		if t.Name != "get_tool_schema" && t.Name != "list_available_tools" {
			baseTools = append(baseTools, t)
		}
	}

	var toolsToUse []uctypes.ToolDefinition
	// Herramientas VITALES (Mantenemos solo lo esencial para ahorrar ~8KB)
	toolsToUse = append(toolsToUse, GetAPICallToolDefinition())
	
	// Añadir solo Dashboard y Terminal de las herramientas base
	for _, t := range baseTools {
		if t.Name == "term_create_dashboard" || t.Name == "term_run_command" || t.Name == "term_send_signal" || t.Name == "term_run_and_wait" {
			toolsToUse = append(toolsToUse, t)
		}
	}
	
	chatOpts.Tools = toolsToUse

	var toolsSection strings.Builder
	if len(toolsToUse) > 0 {
		toolsSection.WriteString("### REGLAS DE ORO (MÁXIMA PRIORIDAD):\n")
		toolsSection.WriteString("1. El agente debe actuar siempre de forma profesional. PROHIBIDO usar 'web_search' para temas internos de Dremio. Usa siempre curl o las herramientas de API.\n")
		toolsSection.WriteString("2. Para cualquier consulta de datos en Dremio, el primer paso es SIEMPRE realizar el login mediante un POST a /apiv2/login usando las credenciales {{username}} y {{password}} del API Manager.\n")
		toolsSection.WriteString("3. PROTOCOLO DREMIO (API MANAGER): Está estrictamente PROHIBIDO usar 'term_run_command' o 'curl' para hablar con Dremio. El agente debe usar EXCLUSIVAMENTE la herramienta 'apimanager_call' con api_name='dremio'. El API Manager ya tiene configurada la URL base http://127.0.0.1:9047. 1) Login: POST a /apiv2/login. 2) SQL: POST a /api/v3/sql. 3) Resultados: GET a /api/v3/job/{id}/results. Usa SIEMPRE estos nombres: Servidor = 'VM', Sistema Operativo = 'OS according to the VMware Tools'.\n")
		toolsSection.WriteString("4. ESTRATEGIA PARA GRANDES VOLÚMENES (BIG DATA): Antes de leer el contenido de cualquier tabla, el agente debe ejecutar una consulta 'SELECT COUNT(*)' para conocer el volumen total (el resultado estará en el campo 'EXPR$0'). Posteriormente, debe extraer los datos en bloques pequeños usando siempre 'LIMIT 10 OFFSET X'. El agente debe informar al usuario en todo momento de la 'marca de agua' o 'OFFSET' actual para que el usuario sepa por dónde va la extracción.\n")
		toolsSection.WriteString("5. MANEJO DE ERRORES: Si una herramienta de API o un comando de terminal falla, el agente no debe rendirse ni pedir permiso. Debe analizar el mensaje de error técnico, corregir el comando o la consulta SQL, y reintentar la acción en el siguiente paso de forma autónoma.\n")
		toolsSection.WriteString("6. HONESTIDAD Y VERACIDAD: Bajo ninguna circunstancia el agente debe inventar datos, nombres de hosts o valores de ejemplo. Si una consulta no devuelve resultados o Dremio falla, el agente debe informar del error real al usuario. Está PROHIBIDO generar Dashboards con datos falsos o de prueba si la fuente real ha fallado.\n")
		toolsSection.WriteString("7. LECTURA Y CONTROL DE TERMINAL: Si envías un comando con `term_run_command`, DEBES esperar pacientemente a que termine. Si un comando se queda atascado, en bucle o esperando input interactivo, USA `term_send_signal` con `signal: \"ctrl+c\"` para detenerlo o `signal: \"ctrl+z\"` para suspenderlo. Si usas `term_command_output` y el sistema te responde 'Shell integration is not enabled', ESTÁS OBLIGADO a usar la herramienta `term_get_scrollback` en tu siguiente paso para leer la pantalla de la terminal. NO alucines que un comando falló si no tienes la salida.\n")

		toolsSection.WriteString("### INSTRUCCIONES DE HERRAMIENTAS:\n")
		toolsSection.WriteString("1. Para ejecutar una herramienta, DEBES usar un bloque ```json con esta estructura exacta:\n")
		toolsSection.WriteString("```json\n{\n  \"name\": \"nombre_herramienta\",\n  \"parameters\": { ... }\n}\n```\n")
		toolsSection.WriteString("2. Si la herramienta que necesitas NO está en la lista de 'HERRAMIENTAS ACTIVAS', búscala en el 'CATÁLOGO' y usa `get_tool_schema` para obtener su manual.\n")
		toolsSection.WriteString("3. NUNCA inventes parámetros. Si no conoces el esquema, pídelo.\n\n")

		// SANITIZACIÓN DE HERRAMIENTAS PARA EL WAF (Incluyendo Schema para herramientas vitales)
		for _, tool := range toolsToUse {
			toolsSection.WriteString(fmt.Sprintf("#### %s\n", tool.Name))
			toolsSection.WriteString(fmt.Sprintf("Descripción: %s\n", tool.Description))
			
			// Si es una herramienta vital, incluimos el esquema directamente para evitar llamadas extra a get_tool_schema
			if strings.HasPrefix(tool.Name, "apimanager_") || tool.Name == "term_run_command" || tool.Name == "term_send_signal" || tool.Name == "term_run_and_wait" {
				schemaBytes, _ := json.Marshal(tool.InputSchema)
				toolsSection.WriteString(fmt.Sprintf("Esquema JSON: %s\n", string(schemaBytes)))
			}
			toolsSection.WriteString("\n")
		}
		toolsSection.WriteString("\nREGLA FINAL: Si en el RECIENTE ves un resultado de herramienta, DEBES leerlo y responder con un resumen.\n\n")
	}

	// Inyección de emergencia si se detecta intención de registro
	lastUserMsgText := ""
	if chat != nil && len(chat.NativeMessages) > 0 {
		for i := len(chat.NativeMessages) - 1; i >= 0; i-- {
			if chat.NativeMessages[i].GetRole() == "user" {
				lastUserMsgText = strings.ToLower(chat.NativeMessages[i].GetContent())
				break
			}
		}
	}
	if strings.Contains(lastUserMsgText, "registra") || strings.Contains(lastUserMsgText, "register") {
		toolsSection.WriteString("\n>>> INSTRUCCIÓN DE EMERGENCIA: El usuario ha pedido REGISTRAR. Tienes prohibido usar 'apimanager_call'. Debes usar 'apimanager_register' ahora con los datos proporcionados.\n")
	}

	// --- ENSAMBLAJE FINAL CON ESCUDO DE CONTEXTO ---
	const MaxSafeSize = 15500
	systemSection := sysPart.String()
	stateSection := statePart.String()
	historySection := historyPart.String()
	toolsText := toolsSection.String()

	totalSize := len(systemSection) + len(stateSection) + len(historySection) + len(toolsText)
	log.Printf("[PLAI-DEBUG] Tamaño final del prompt: %d bytes (%.2f KB)\n", totalSize, float64(totalSize)/1024.0)
	log.Printf("[PLAI-DEBUG] Desglose: System:%d, State:%d, History:%d, Tools:%d\n", 
		len(systemSection), len(stateSection), len(historySection), len(toolsText))

	finalInput := systemSection + stateSection + historySection + toolsText

	if totalSize > MaxSafeSize {
		diff := totalSize - MaxSafeSize
		log.Printf("[PLAI-DEBUG] ESCUDO ACTIVADO: Recortando %d bytes...\n", diff)
		// 1. Recortar Historial (si es necesario) - PRIORIZAR MANTENER EL FINAL
		if diff > 0 && len(historySection) > 500 {
			toCut := diff
			if toCut > len(historySection)-500 {
				toCut = len(historySection) - 500
			}
			// Cortamos de la parte superior del historial (pero después del GOAL si existe)
			historySection = historySection[:300] + "\n...[historia intermedia recortada por límite WAF]...\n" + historySection[300+toCut:]
			diff -= toCut
		}
		// 2. Recortar Sistema/Brain (si aún es necesario)
		if diff > 0 && len(systemSection) > 2000 {
			toCut := diff
			if toCut > len(systemSection)-2000 {
				toCut = len(systemSection) - 2000
			}
			systemSection = systemSection[:2000] + "...[instrucciones recortadas]\n\n"
			diff -= toCut
		}
		// 3. Recortar Herramientas (Último recurso)
		if diff > 0 && len(toolsText) > 5000 {
			toCut := diff
			if toCut > len(toolsText)-5000 {
				toCut = len(toolsText) - 5000
			}
			toolsText = toolsText[:len(toolsText)-toCut] + "...[tools recortadas]\n"
			diff -= toCut
		}
	}

	finalInput = systemSection + stateSection + historySection + toolsText
	
	log.Printf("[PLAI-DEBUG] Prompt Construido (%d bytes)\n", len(finalInput))
	log.Printf("[PLAI-DEBUG] URL: %s | AgentID: %s\n", chatOpts.Config.Endpoint, chatOpts.Config.AgentID)
	
	plaiReq := PlaiRequest{
		Input: finalInput,
	}
	reqBody, err := json.Marshal(plaiReq)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to marshal plai request: %w", err)
	}

	// Debug: Guardar el cuerpo de la petición en un archivo para análisis de WAF
	_ = os.WriteFile(filepath.Join(os.TempDir(), "plai_request_debug.json"), reqBody, 0644)

	req, err := http.NewRequestWithContext(ctx, "POST", chatOpts.Config.Endpoint, bytes.NewBuffer(reqBody))
	if err != nil {
		return nil, nil, nil, fmt.Errorf("failed to create http request: %w", err)
	}

	// Configurar cabeceras
	req.Header.Set("Content-Type", "application/json")
	
	// Obtener el token (puede estar en la config directamente o en el secret store)
	token := chatOpts.Config.APIToken
	if token == "" && chatOpts.Config.APITokenSecretName != "" {
		s, exists, _ := secretstore.GetSecret(chatOpts.Config.APITokenSecretName)
		if exists {
			token = s
		}
	}
	if token != "" {
		req.Header.Set("x-api-key", token)
	}

	// Configurar x-agent-id
	if chatOpts.Config.AgentID != "" {
		req.Header.Set("x-agent-id", chatOpts.Config.AgentID)
	}

	// Ejecutar la petición con reintentos
	client := &http.Client{Timeout: 90 * time.Second} // Aumentamos timeout a 90s por las lentitudes reportadas
	
	// Notificar inicio en la UI
	msgId := uuid.New().String()
	if cont == nil {
		sseHandler.SetupSSE()
		sseHandler.AiMsgStart(msgId)
	}
	sseHandler.AiMsgStartStep()

	var resp *http.Response
	var respBody []byte
	maxRetries := 3

	for attempt := 1; attempt <= maxRetries; attempt++ {
		// Necesitamos recrear el body reader en cada intento si falló en enviar
		req.Body = io.NopCloser(bytes.NewBuffer(reqBody))
		
		sse.SendDebugLog(ctx, sse.LogCatPLAI, fmt.Sprintf("Enviando prompt a PLAI (Intento %d/%d)...", attempt, maxRetries))
		resp, err = client.Do(req)
		
		if err != nil {
			sse.SendDebugLog(ctx, sse.LogCatPLAI, fmt.Sprintf("Fallo en intento %d: %v", attempt, err))
			log.Printf("[PLAI-DEBUG] Intento %d/%d fallido (error de conexión): %v\n", attempt, maxRetries, err)
			if attempt == maxRetries {
				sseHandler.AiMsgError(fmt.Sprintf("Error de conexión persistente tras %d intentos: %v", maxRetries, err))
				return nil, nil, nil, err
			}
			time.Sleep(time.Duration(attempt) * 2 * time.Second)
			continue
		}
		sse.SendDebugLog(ctx, sse.LogCatPLAI, "Respuesta de PLAI recibida.")

		respBody, err = io.ReadAll(resp.Body)
		resp.Body.Close()
		
		if err != nil {
			log.Printf("[PLAI-DEBUG] Intento %d/%d fallido (error al leer body): %v\n", attempt, maxRetries, err)
			if attempt == maxRetries {
				sseHandler.AiMsgError(fmt.Sprintf("Error al leer respuesta: %v", err))
				return nil, nil, nil, err
			}
			time.Sleep(time.Duration(attempt) * 2 * time.Second)
			continue
		}

		log.Printf("[PLAI-DEBUG] Intento %d/%d - Respuesta raw de API (Status %d):\n%s\n", attempt, maxRetries, resp.StatusCode, string(respBody))

		// Chequeamos errores transitorios que merecen reintento (5xx, 429, o el bug de Cencosud "socket hang up" que viene como 400)
		isTransientError := resp.StatusCode >= 500 || resp.StatusCode == 429 || (resp.StatusCode == 400 && strings.Contains(string(respBody), "socket hang up"))
		
		if isTransientError {
			log.Printf("[PLAI-DEBUG] Intento %d/%d fallido (error transitorio en API): %s\n", attempt, maxRetries, string(respBody))
			if attempt == maxRetries {
				errText := fmt.Sprintf("API error persistente (%d): %s", resp.StatusCode, string(respBody))
				sseHandler.AiMsgError(errText)
				return nil, nil, nil, fmt.Errorf(errText)
			}
			// Backoff exponencial simple: 2s, 4s, 6s...
			time.Sleep(time.Duration(attempt) * 2 * time.Second)
			continue
		}
		
		// Si es un error 4xx definitivo (no socket hang up), fallamos inmediatamente
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			errText := fmt.Sprintf("API error (%d): %s", resp.StatusCode, string(respBody))
			if resp.StatusCode == 403 {
				promptSizeKB := float64(len(reqBody)) / 1024.0
				cause := "CARÁCTER PROHIBIDO (Patrón detectado)"
				if promptSizeKB > 15.8 {
					cause = "EXCESO DE TAMAÑO (WAF Limit 16KB)"
				}
				
				errText = fmt.Sprintf("API error (403): El Firewall ha bloqueado la petición.\nDIAGNÓSTICO:\n- Causa probable: %s\n- Tamaño total enviado: %.2f KB\n\n", cause, promptSizeKB)
				
				// LIBERACIÓN AUTOMÁTICA DEL CHAT: Eliminar el ÚLTIMO mensaje absoluto (sea del usuario o de la IA)
				lastMsg := chatstore.DefaultChatStore.GetLastMessage(chatOpts.ChatId)
				if lastMsg != nil {
					chatstore.DefaultChatStore.RemoveMessage(chatOpts.ChatId, lastMsg.GetMessageId())
					log.Printf("[PLAI-DEBUG] Mensaje conflictivo removido del historial para liberar el chat: %s\n", lastMsg.GetMessageId())
					errText += "ACCIÓN: Se ha eliminado automáticamente el último mensaje del historial para evitar bloqueos persistentes. Por favor, intenta de nuevo."
				} else {
					errText += "ACCIÓN: El historial parece vacío. Si el error persiste, usa 'New Chat'."
				}
			}
			sseHandler.AiMsgError(errText)
			return nil, nil, nil, fmt.Errorf(errText)
		}
		
		// Éxito, salimos del bucle de reintentos
		break
	}

	// Intentar parsear la respuesta
	var result map[string]interface{}
	if err := json.Unmarshal(respBody, &result); err != nil {
		sseHandler.AiMsgError("Error al decodificar JSON de respuesta")
		return nil, nil, nil, err
	}

	// Buscar el contenido de texto en campos comunes
	content := ""
	for _, field := range []string{"output", "response", "text", "message", "result"} {
		if val, ok := result[field].(string); ok {
			content = val
			break
		}
	}

	// Si no se encuentra un campo de texto conocido, devolver todo el JSON formateado
	if content == "" {
		pretty, _ := json.MarshalIndent(result, "", "  ")
		content = string(pretty)
	}

	// Obtener el ID de mensaje real de la API si existe
	apiMsgId, _ := result["messageId"].(string)
	if apiMsgId == "" {
		apiMsgId = msgId // Usar el generado localmente como fallback
	}

	// --- DETECCIÓN DE HERRAMIENTAS (TOOL USE) ROBUSTA ---
	var toolCalls []uctypes.GulinToolCall
	cleanContent := strings.TrimSpace(content)

	// 1. Intentar detectar bloques JSON (con o sin triple comilla)
	// Primero probamos con el estándar de backticks
	reBlocks := regexp.MustCompile("(?s)```json\\s*(.*?)\\s*```")
	matches := reBlocks.FindAllStringSubmatch(content, -1)
	
	// Si no hay backticks, buscamos JSON "desnudo" que empiece por { "name":
	if len(matches) == 0 {
		reNaked := regexp.MustCompile(`(?s)(json\s*)?(\{[\s\n]*"name"[\s\n]*:.*?\})`)
		nakedMatches := reNaked.FindAllStringSubmatch(content, -1)
		for _, nm := range nakedMatches {
			matches = append(matches, []string{nm[0], nm[2]})
		}
	}

	if len(matches) > 0 {
		// FRENO DE MANO: Cortar el mensaje en el primer indicio de herramienta
		firstMatchIndex := strings.Index(content, matches[0][0])
		if firstMatchIndex != -1 {
			cleanContent = strings.TrimSpace(content[:firstMatchIndex])
		}
	}

	for _, m := range matches {
		jsonStr := strings.TrimSpace(m[1])
		
		// Tolerancia: buscar el primer '{' y el último '}' por si hay texto extra
		firstBrace := strings.Index(jsonStr, "{")
		lastBrace := strings.LastIndex(jsonStr, "}")
		if firstBrace != -1 && lastBrace != -1 && lastBrace > firstBrace {
			jsonStr = jsonStr[firstBrace : lastBrace+1]
		}

		var toolReq struct {
			Name       string                 `json:"name"`
			Parameters map[string]interface{} `json:"parameters"`
		}
		
		// Intento 1: Formato estándar {"name": "...", "parameters": {...}}
		if err := json.Unmarshal([]byte(jsonStr), &toolReq); err == nil && toolReq.Name != "" && toolReq.Parameters != nil {
			toolCalls = append(toolCalls, uctypes.GulinToolCall{
				ID:    uuid.New().String(),
				Name:  toolReq.Name,
				Input: toolReq.Parameters,
			})
			cleanContent = strings.Replace(cleanContent, m[0], "", 1)
			continue
		}

		// Intento 2: Fallback para JSON "desnudo" dentro de backticks
		var params map[string]interface{}
		if err := json.Unmarshal([]byte(jsonStr), &params); err == nil {
			toolName := ""
			if name, ok := params["name"].(string); ok && name != "" {
				toolName = name
				delete(params, "name")
			} else if _, hasCmd := params["command"]; hasCmd {
				toolName = "term_run_command"
			}
			
			if toolName != "" {
				finalParams := params
				if p, ok := params["parameters"].(map[string]interface{}); ok {
					finalParams = p
				}
				toolCalls = append(toolCalls, uctypes.GulinToolCall{
					ID:    uuid.New().String(),
					Name:  toolName,
					Input: finalParams,
				})
				cleanContent = strings.Replace(cleanContent, m[0], "", 1)
			}
		}
	}

	// 2. Intentar detectar bloques BASH: ```bash ... ```
	bashRegex := regexp.MustCompile("(?s)```bash\\s*(.*?)\\s*```")
	bashMatches := bashRegex.FindAllStringSubmatch(content, -1)

	if len(bashMatches) > 0 && len(matches) == 0 {
		// FRENO DE MANO para Bash
		firstMatchIndex := strings.Index(content, bashMatches[0][0])
		if firstMatchIndex != -1 {
			cleanContent = strings.TrimSpace(content[:firstMatchIndex])
		}
	}

	for _, m := range bashMatches {
		cmd := strings.TrimSpace(m[1])
		if cmd != "" {
			widgetId := findPrimaryWidgetId(chatOpts.TabState)
			params := map[string]interface{}{"command": cmd}
			if widgetId != "" {
				params["widget_id"] = widgetId
			}
			toolCalls = append(toolCalls, uctypes.GulinToolCall{
				ID:    uuid.New().String(),
				Name:  "term_run_command",
				Input: params,
			})
			cleanContent = strings.Replace(cleanContent, m[0], "", 1)
		}
	}

	// 3. Fallback final: buscar el primer { y el último } si no hay backticks
	if len(toolCalls) == 0 {
		firstBrace := strings.Index(content, "{")
		lastBrace := strings.LastIndex(content, "}")
		if firstBrace != -1 && lastBrace != -1 && lastBrace > firstBrace {
			jsonMatch := content[firstBrace : lastBrace+1]
			var toolReq struct {
				Name       string                 `json:"name"`
				Parameters map[string]interface{} `json:"parameters"`
			}
			if err := json.Unmarshal([]byte(jsonMatch), &toolReq); err == nil && toolReq.Name != "" {
				finalParams := toolReq.Parameters
				if finalParams == nil {
					var nakedParams map[string]interface{}
					if err := json.Unmarshal([]byte(jsonMatch), &nakedParams); err == nil {
						delete(nakedParams, "name")
						finalParams = nakedParams
					}
				}
				toolCalls = append(toolCalls, uctypes.GulinToolCall{
					ID:    uuid.New().String(),
					Name:  toolReq.Name,
					Input: finalParams,
				})
				cleanContent = strings.Replace(cleanContent, jsonMatch, "", 1)
			}
		}
	}

	// 4. DETECTOR DE BUCLES (Freno de mano)
	if len(toolCalls) > 0 {
		lastMsgIdx := len(chat.NativeMessages) - 1
		if lastMsgIdx >= 0 {
			lastMsg := chat.NativeMessages[lastMsgIdx]
			if lastMsg != nil && lastMsg.GetRole() == "tool" {
				// 5. DETECTOR AGRESIVO: Si es la misma herramienta con los MISMOS parámetros, bloquear.
				lastInput := ""
				lastToolName := ""
				if plaiMsg, ok := lastMsg.(*uctypes.PlaiMessage); ok && len(plaiMsg.ToolCalls) > 0 {
					lastInput = fmt.Sprintf("%v", plaiMsg.ToolCalls[0].Input)
					lastToolName = strings.ToLower(plaiMsg.ToolCalls[0].Name)
				}
				
				for _, tc := range toolCalls {
					currentInput := fmt.Sprintf("%v", tc.Input)
					currentToolName := strings.ToLower(tc.Name)

					if lastToolName == currentToolName && lastInput == currentInput {
						stopReason := &uctypes.GulinStopReason{Kind: uctypes.StopKindDone}
						errMsg := "\n\n⚠️ **Freno de Mano Activado:** He detectado una repetición infinita en '" + tc.Name + "'. Deteniendo ejecución para proteger el sistema. Jorge, por favor intenta usar un script para estos datos."
						
						sseHandler.AiMsgTextStart(apiMsgId)
						sseHandler.AiMsgTextDelta(apiMsgId, errMsg)
						sseHandler.AiMsgTextEnd(apiMsgId)
						sseHandler.AiMsgFinishStep()
						return stopReason, []uctypes.GenAIMessage{&uctypes.PlaiMessage{Role: "assistant", Content: errMsg}}, nil, nil
					}
				}
			}
		}
	}

	// Procesar herramientas detectadas
	if len(toolCalls) > 0 {
		cleanContent = strings.TrimSpace(cleanContent)
		if cleanContent == "" {
			cleanContent = "Ejecutando acciones automáticas..."
		}

		// 6. LIMITADOR DE RÁFAGAS: Máximo 3 herramientas por mensaje
		if len(toolCalls) > 3 {
			toolCalls = toolCalls[:3]
			cleanContent += "\n\n⚠️ **Limitador activado:** Solo se ejecutarán las primeras 3 acciones para evitar saturación."
		}

		assistantMsg := &uctypes.PlaiMessage{
			MessageId: apiMsgId,
			Role:      "assistant",
			Content:   cleanContent,
			ToolCalls: toolCalls,
		}

		stopReason := &uctypes.GulinStopReason{
			Kind:      uctypes.StopKindToolUse,
			ToolCalls: toolCalls,
		}

		// Preparar el pensamiento para el modal (limpio de bloques JSON/Bash)
		modalThought := strings.TrimSpace(content)
		reClean := regexp.MustCompile("(?s)```(json|bash).*?```")
		modalThought = strings.TrimSpace(reClean.ReplaceAllString(modalThought, ""))
		if modalThought == "" {
			modalThought = "Gulin ejecutó estas acciones para avanzar en la tarea."
		}

		// Notificar a la UI (Texto/Razonamiento + Herramientas)
		if len(cleanContent) > 0 {
			sseHandler.AiMsgReasoningStart(apiMsgId)
			sseHandler.AiMsgReasoningDelta(apiMsgId, cleanContent)
			sseHandler.AiMsgReasoningEnd(apiMsgId)
		}

		for _, tc := range toolCalls {
			sseHandler.AiMsgData("data-tooluse", tc.ID, uctypes.UIMessageDataToolUse{
				ToolCallId: tc.ID,
				ToolName:   tc.Name,
				Status:     uctypes.ToolUseStatusPending,
				Thought:    modalThought,
			})
		}
		sseHandler.AiMsgFinishStep()
		return stopReason, []uctypes.GenAIMessage{assistantMsg}, nil, nil
	}

	// Si no hay herramientas, es una respuesta de texto normal
	assistantMsg := &uctypes.PlaiMessage{
		MessageId: apiMsgId,
		Role:      "assistant",
		Content:   content,
	}
	sseHandler.AiMsgTextStart(apiMsgId)
	sseHandler.AiMsgTextDelta(apiMsgId, content)
	sseHandler.AiMsgTextEnd(apiMsgId)
	sseHandler.AiMsgFinishStep()

	stopReason := &uctypes.GulinStopReason{Kind: uctypes.StopKindDone}
	return stopReason, []uctypes.GenAIMessage{assistantMsg}, nil, nil
}

// Fin de utilidades

func createToolCall(name string, params map[string]interface{}, sseHandler *sse.SSEHandlerCh, assistantMsg uctypes.GenAIMessage, thought string) (*uctypes.GulinStopReason, []uctypes.GenAIMessage, *uctypes.RateLimitInfo, error) {
	toolCall := uctypes.GulinToolCall{
		ID:    uuid.New().String(),
		Name:  name,
		Input: params,
	}

	// Notificar en UI que se está llamando a una herramienta con su pensamiento
	sseHandler.AiMsgData("data-tooluse", toolCall.ID, uctypes.UIMessageDataToolUse{
		ToolCallId: toolCall.ID,
		ToolName:   toolCall.Name,
		Status:     uctypes.ToolUseStatusPending,
		Thought:    thought,
	})
	sseHandler.AiMsgFinishStep()

	stopReason := &uctypes.GulinStopReason{
		Kind:      uctypes.StopKindToolUse,
		ToolCalls: []uctypes.GulinToolCall{toolCall},
	}

	// Devolvemos el mensaje del asistente para que Gulin lo guarde en el historial
	return stopReason, []uctypes.GenAIMessage{assistantMsg}, nil, nil
}

// findPrimaryWidgetId intenta extraer el primer ID de terminal (8 hex chars) de la descripción de la pestaña
func findPrimaryWidgetId(tabState string) string {
	if tabState == "" {
		return ""
	}
	// Gulin formatea los widgets como: * (8chexid) local CLI terminal...
	re := regexp.MustCompile(`\* \(([a-f0-9]{8})\)`)
	match := re.FindStringSubmatch(tabState)
	if len(match) > 1 {
		return match[1]
	}
	return ""
}

func (b *plaiBackend) UpdateToolUseData(chatId string, toolCallId string, toolUseData uctypes.UIMessageDataToolUse) error {
	return nil // No soportado por PLAI actualmente
}

func (b *plaiBackend) RemoveToolUseCall(chatId string, toolCallId string) error {
	return nil // No soportado por PLAI actualmente
}

func (b *plaiBackend) ConvertToolResultsToNativeChatMessage(toolResults []uctypes.AIToolResult) ([]uctypes.GenAIMessage, error) {
	if len(toolResults) == 0 {
		return nil, nil
	}
	var rtn []uctypes.GenAIMessage
	for _, res := range toolResults {
		content := res.Text
		if res.ErrorText != "" {
			content = fmt.Sprintf("Error: %s", res.ErrorText)
		}
		msg := &uctypes.PlaiMessage{
			MessageId: uuid.New().String(),
			Role:      "tool",
			Content:   content,
			ToolName:  res.ToolName,
		}
		rtn = append(rtn, msg)
	}
	return rtn, nil
}

func (b *plaiBackend) ConvertAIMessageToNativeChatMessage(message uctypes.AIMessage) (uctypes.GenAIMessage, error) {
	// En el caso de PLAI, los mensajes que vienen de RunChatStep ya son uctypes.PlaiMessage
	// Pero si Gulin pasa un uctypes.AIMessage genérico, lo convertimos preservando lo posible.
	return &uctypes.PlaiMessage{
		MessageId: message.MessageId,
		Role:      message.Role,
		Content:   message.GetContent(),
	}, nil
}

func (b *plaiBackend) GetFunctionCallInputByToolCallId(aiChat uctypes.AIChat, toolCallId string) *uctypes.AIFunctionCallInput {
	return nil
}

func (b *plaiBackend) ConvertAIChatToUIChat(aiChat uctypes.AIChat) (*uctypes.UIChat, error) {
	uiChat := &uctypes.UIChat{
		ChatId:     aiChat.ChatId,
		APIType:    aiChat.APIType,
		Model:      aiChat.Model,
		APIVersion: aiChat.APIVersion,
		Messages:   make([]uctypes.UIMessage, 0),
	}

	for i, genMsg := range aiChat.NativeMessages {
		if genMsg.GetRole() == "tool" {
			continue // Ocultar los resultados raw de las herramientas en la interfaz UI
		}
		
		role := genMsg.GetRole()
		if role == "" {
			role = "user"
		}

		content := genMsg.GetContent()
		thought := ""
		
		// Verificamos si es un mensaje de la IA con herramientas
		var toolCalls []uctypes.GulinToolCall
		if caller, ok := genMsg.(interface{ GetToolCalls() []uctypes.GulinToolCall }); ok {
			toolCalls = caller.GetToolCalls()
			if len(toolCalls) > 0 {
				// EXTRACCIÓN DE PENSAMIENTO
				thought = strings.TrimSpace(content)
				reBlocks := regexp.MustCompile("(?s)```.*?```")
				thought = strings.TrimSpace(reBlocks.ReplaceAllString(thought, ""))
				if thought == "" || (strings.HasPrefix(thought, "{") && strings.HasSuffix(thought, "}")) {
					thought = "Gulin realizó una acción técnica directa."
				}
				// MANTENEMOS content para que sea visible en el chat
			}
		}
		
		uiMsg := uctypes.UIMessage{
			ID:   genMsg.GetMessageId(),
			Role: role,
			Parts: []uctypes.UIMessagePart{
				{
					Type:  func() string { if len(toolCalls) > 0 { return "reasoning" }; return "text" }(),
					Text:  func() string { if len(toolCalls) > 0 { return "" }; return content }(),
					State: "done",
				},
			},
		}

		// Añadir las llamadas a herramientas como partes de la interfaz
		for _, tc := range toolCalls {
			status := uctypes.ToolUseStatusCompleted
			errMessage := ""
			
			// BUSCAR EL RESULTADO EN LOS SIGUIENTES MENSAJES PARA SABER SI FALLÓ
			for j := i + 1; j < len(aiChat.NativeMessages); j++ {
				nextMsg := aiChat.NativeMessages[j]
				if nextMsg.GetRole() == "tool" {
					resContent := strings.ToLower(nextMsg.GetContent())
					if strings.Contains(resContent, "error") || 
					   strings.Contains(resContent, "failed") || 
					   strings.Contains(resContent, "invalid") ||
					   strings.Contains(resContent, "exit code 1") {
						status = uctypes.ToolUseStatusError
						errMessage = "La acción encontró un problema o devolvió un error. Revisa el terminal para más detalles."
					}
					break // Encontramos la respuesta a esta herramienta
				}
			}

			uiMsg.Parts = append(uiMsg.Parts, uctypes.UIMessagePart{
				Type: "data-tooluse",
				Data: uctypes.UIMessageDataToolUse{
					ToolCallId:   tc.ID,
					ToolName:     tc.Name,
					Status:       status,
					ErrorMessage: errMessage,
					Thought:      thought, // Pasamos el pensamiento al modal de la herramienta
				},
			})
		}
		uiChat.Messages = append(uiChat.Messages, uiMsg)
	}

	return uiChat, nil
}
