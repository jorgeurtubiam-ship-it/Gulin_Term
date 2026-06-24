// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"fmt"
	"os/user"
	"strings"

	"github.com/google/uuid"
	"github.com/gulindev/gulin/pkg/aiusechat/aiutil"
	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/blockcontroller"
	"github.com/gulindev/gulin/pkg/util/utilfn"
	"github.com/gulindev/gulin/pkg/gulinbase"
	"github.com/gulindev/gulin/pkg/gulinobj"
	"github.com/gulindev/gulin/pkg/wstore"
)

func makeTerminalBlockDesc(block *gulinobj.Block) string {
	connection, hasConnection := block.Meta["connection"].(string)
	cwd, hasCwd := block.Meta["cmd:cwd"].(string)

	blockORef := gulinobj.MakeORef(gulinobj.OType_Block, block.OID)
	rtInfo := wstore.GetRTInfo(blockORef)
	hasCurCwd := rtInfo != nil && rtInfo.ShellHasCurCwd

	var desc string
	if hasConnection && connection != "" {
		desc = fmt.Sprintf("CLI terminal connected to %q", connection)
	} else {
		desc = "local CLI terminal"
	}

	if rtInfo != nil && rtInfo.ShellType != "" {
		desc += fmt.Sprintf(" (%s", rtInfo.ShellType)
		if rtInfo.ShellVersion != "" {
			desc += fmt.Sprintf(" %s", rtInfo.ShellVersion)
		}
		desc += ")"
	}

	if rtInfo != nil {
		if rtInfo.ShellIntegration {
			var stateStr string
			switch rtInfo.ShellState {
			case "ready":
				stateStr = "waiting for input"
			case "running-command":
				stateStr = "running command"
				if rtInfo.ShellLastCmd != "" {
					cmdStr := rtInfo.ShellLastCmd
					if len(cmdStr) > 30 {
						cmdStr = cmdStr[:27] + "..."
					}
					cmdJSON := utilfn.MarshalJSONString(cmdStr)
					stateStr = fmt.Sprintf("running command %s", cmdJSON)
				}
			default:
				stateStr = "state unknown"
			}
			desc += fmt.Sprintf(", %s", stateStr)
		} else {
			desc += ", no shell integration"
		}
	}

	if hasCurCwd && hasCwd && cwd != "" {
		desc += fmt.Sprintf(", in directory %q", cwd)
	}

	return desc
}

func MakeBlockShortDesc(block *gulinobj.Block) string {
	if block.Meta == nil {
		return ""
	}

	viewType, ok := block.Meta["view"].(string)
	if !ok {
		return ""
	}

	switch viewType {
	case "term":
		return makeTerminalBlockDesc(block)
	case "preview":
		file, hasFile := block.Meta["file"].(string)
		connection, hasConnection := block.Meta["connection"].(string)

		if hasConnection && connection != "" {
			if hasFile && file != "" {
				return fmt.Sprintf("preview widget viewing %q on %q", file, connection)
			}
			return fmt.Sprintf("preview widget viewing files on %q", connection)
		}
		if hasFile && file != "" {
			return fmt.Sprintf("preview widget viewing %q", file)
		}
		return "file and directory preview widget"
	case "web":
		if url, hasUrl := block.Meta["url"].(string); hasUrl && url != "" {
			return fmt.Sprintf("web browser widget pointing at %q", url)
		}
		return "web browser widget"
	case "gulinai":
		return "AI chat widget"
	case "cpuplot":
		if connection, hasConnection := block.Meta["connection"].(string); hasConnection && connection != "" {
			return fmt.Sprintf("cpu graph for %q", connection)
		}
		return "cpu graph"
	case "tips":
		return "Gulin quick tips widget"
	case "help":
		return "Gulin documentation widget"
	case "launcher":
		return "placeholder widget used to launch other widgets"
	case "tsunami":
		return handleTsunamiBlockDesc(block)
	case "aifilediff":
		return "" // AI doesn't need to see these
	case "gulinconfig":
		if file, hasFile := block.Meta["file"].(string); hasFile && file != "" {
			return fmt.Sprintf("gulin config editor for %q", file)
		}
		return "gulin config editor"
	default:
		return fmt.Sprintf("unknown widget with type %q", viewType)
	}
}

func GenerateTabStateAndTools(ctx context.Context, tabid string, widgetAccess bool, chatOpts *uctypes.GulinChatOpts) (string, []uctypes.ToolDefinition, error) {
	if tabid == "" {
		return "", nil, nil
	}
	var blocks []*gulinobj.Block
	if widgetAccess {
		if _, err := uuid.Parse(tabid); err != nil {
			return "", nil, fmt.Errorf("tabid must be a valid UUID")
		}

		tabObj, err := wstore.DBMustGet[*gulinobj.Tab](ctx, tabid)
		if err != nil {
			return "", nil, fmt.Errorf("error getting tab: %v", err)
		}

		for _, blockId := range tabObj.BlockIds {
			block, err := wstore.DBGet[*gulinobj.Block](ctx, blockId)
			if err != nil {
				continue
			}
			blocks = append(blocks, block)
		}
	}
	tabState := GenerateCurrentTabStatePrompt(blocks, widgetAccess)
	// for debugging
	// log.Printf("TABPROMPT %s\n", tabState)
	var tools []uctypes.ToolDefinition
	if widgetAccess {
		// Only add call_expert if using Gulin AI or Gulin Bridge (Direct providers often don't support expert configurations)
		if chatOpts.Config.Provider == uctypes.AIProvider_Gulin || chatOpts.Config.Provider == uctypes.AIProvider_GulinBridge {
			tools = append(tools, GetCallExpertToolDefinition())
		}

		// Only add screenshot tool for:
		// - openai-responses API type
		// - google-gemini API type with Gemini 3+ models
		if chatOpts.Config.APIType == uctypes.APIType_OpenAIResponses ||
			(chatOpts.Config.APIType == uctypes.APIType_GoogleGemini && aiutil.GeminiSupportsImageToolResults(chatOpts.Config.Model)) {
			tools = append(tools, GetCaptureScreenshotToolDefinition(tabid))
		}
		tools = append(tools, GetReadTextFileToolDefinition())
		tools = append(tools, GetReadDirToolDefinition())
		tools = append(tools, GetWriteTextFileToolDefinition())
		tools = append(tools, GetEditTextFileToolDefinition())
		tools = append(tools, GetDeleteTextFileToolDefinition())
		tools = append(tools, GetGulinBrainUpdateToolDefinition())
		tools = append(tools, GetGulinBrainListToolDefinition())
		tools = append(tools, GetGulinBrainSearchToolDefinition())
		tools = append(tools, GetWorkspaceSearchToolDefinition())
		tools = append(tools, GetCreateDashboardToolDefinition(tabid))
		tools = append(tools, GetDBRegisterToolDefinition(tabid))
		tools = append(tools, GetDBListConnectionsToolDefinition())
		tools = append(tools, GetDBTestConnectionToolDefinition())
		tools = append(tools, GetDBDeleteConnectionToolDefinition())
		tools = append(tools, GetDBQueryToolDefinition(tabid))
		tools = append(tools, GetAPICallToolDefinition())
		tools = append(tools, GetAPIListToolDefinition())
		tools = append(tools, GetAPIDeleteToolDefinition())
		tools = append(tools, GetWebSearchToolDefinition(tabid))

		// Global Web Tools (always available if widgetAccess is true)
		tools = append(tools, GetWebNavigateToolDefinition(tabid))
		tools = append(tools, GetWebReadPageToolDefinition(tabid))
		tools = append(tools, GetWebClickToolDefinition(tabid))
		tools = append(tools, GetWebTypeToolDefinition(tabid))
		viewTypes := make(map[string]bool)
		for _, block := range blocks {
			if block.Meta == nil {
				continue
			}
			viewType, ok := block.Meta["view"].(string)
			if !ok {
				continue
			}
			viewTypes[viewType] = true
			if viewType == "tsunami" {
				blockTools := generateToolsForTsunamiBlock(block)
				tools = append(tools, blockTools...)
			}
		}
		if viewTypes["term"] {
			tools = append(tools, GetTermGetScrollbackToolDefinition(tabid))
			if !strings.HasSuffix(chatOpts.Config.AIMode, "@plan") {
				tools = append(tools, GetTermRunCommandToolDefinition(tabid))
				// tools = append(tools, GetTermRunAndWaitToolDefinition(tabid)) // Removed as per user request
			}
			tools = append(tools, GetTermSearchToolDefinition(tabid))
			tools = append(tools, GetTermCommandOutputToolDefinition(tabid))
		}
		if viewTypes["web"] {
			tools = append(tools, GetWebNavigateToolDefinition(tabid))
			tools = append(tools, GetWebReadPageToolDefinition(tabid))
			tools = append(tools, GetWebClickToolDefinition(tabid))
			tools = append(tools, GetWebTypeToolDefinition(tabid))
		}

		// --- CARGA DINÁMICA DE PLUGINS ---
		dynamicTools, err := LoadPlugins(ctx, tabid)
		if err == nil && len(dynamicTools) > 0 {
			tools = append(tools, dynamicTools...)
		}
		// ---------------------------------

		// Herramientas de Gestión de Plugins
		tools = append(tools, GetPluginSaveToolDefinition())
		tools = append(tools, GetPluginListToolDefinition())
		tools = append(tools, GetPluginDeleteToolDefinition())
		tools = append(tools, GetPluginDebugToolDefinition())
	}
	// Herramientas de Descubrimiento Dinámico (Cualquier proveedor puede usarlas si tiene muchas herramientas)
	tools = append(tools, GetListAvailableToolsToolDefinition())
	// Pasamos la lista completa de herramientas acumuladas para que el catálogo tenga todo
	tools = append(tools, GetGetToolSchemaToolDefinition(tools))

	return tabState, tools, nil
}

func GenerateCurrentTabStatePrompt(blocks []*gulinobj.Block, widgetAccess bool) string {
	if !widgetAccess {
		return `<current_tab_state>The user has chosen not to share widget context with you</current_tab_state>`
	}
	var widgetDescriptions []string
	for _, block := range blocks {
		desc := MakeBlockShortDesc(block)
		if desc == "" {
			continue
		}
		blockIdPrefix := block.OID[:8]
		fullDesc := fmt.Sprintf("(%s) %s", blockIdPrefix, desc)
		widgetDescriptions = append(widgetDescriptions, fullDesc)
	}

	var prompt strings.Builder
	prompt.WriteString("<current_tab_state>\n")
	systemInfo := gulinbase.GetSystemSummary()
	if currentUser, err := user.Current(); err == nil && currentUser.Username != "" {
		prompt.WriteString(fmt.Sprintf("Local Machine: %s, User: %s\n", systemInfo, currentUser.Username))
	} else {
		prompt.WriteString(fmt.Sprintf("Local Machine: %s\n", systemInfo))
	}
	if len(widgetDescriptions) == 0 {
		prompt.WriteString("No widgets open\n")
	} else {
		prompt.WriteString("Open Widgets:\n")
		for _, desc := range widgetDescriptions {
			prompt.WriteString("* ")
			prompt.WriteString(desc)
			prompt.WriteString("\n")
		}
	}
	prompt.WriteString("</current_tab_state>")
	rtn := prompt.String()
	return rtn
}

func generateToolsForTsunamiBlock(block *gulinobj.Block) []uctypes.ToolDefinition {
	var tools []uctypes.ToolDefinition

	status := blockcontroller.GetBlockControllerRuntimeStatus(block.OID)
	if status == nil || status.ShellProcStatus != blockcontroller.Status_Running || status.TsunamiPort <= 0 {
		return nil
	}

	blockORef := gulinobj.MakeORef(gulinobj.OType_Block, block.OID)
	rtInfo := wstore.GetRTInfo(blockORef)

	if tool := GetTsunamiGetDataToolDefinition(block, rtInfo, status); tool != nil {
		tools = append(tools, *tool)
	}
	if tool := GetTsunamiGetConfigToolDefinition(block, rtInfo, status); tool != nil {
		tools = append(tools, *tool)
	}
	if tool := GetTsunamiSetConfigToolDefinition(block, rtInfo, status); tool != nil {
		tools = append(tools, *tool)
	}

	return tools
}

func GetGulinBrainUpdateToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "brain_update",
		DisplayName: "Update Gulin Brain",
		Description: "Save important knowledge, habits, or project context to Gulin's long-term memory. Use .md extension for files.",
		ToolLogName: "brain:update",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"filename": map[string]any{
					"type":        "string",
					"description": "Name of the memory file (e.g., 'habits.md', 'project_x.md')",
				},
				"content": map[string]any{
					"type":        "string",
					"description": "The information to save in Markdown format",
				},
			},
			"required":             []string{"filename", "content"},
			"additionalProperties": false,
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			m, ok := input.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("invalid input format: expected object")
			}
			filename, _ := m["filename"].(string)
			content, _ := m["content"].(string)
			if filename == "" || content == "" {
				return nil, fmt.Errorf("missing required parameters: 'filename' and 'content' are required")
			}
			err := UpdateGulinMemoryFile(filename, content)
			if err != nil {
				return nil, err
			}
			return fmt.Sprintf("Conocimiento guardado exitosamente en %s", filename), nil
		},
	}
}

func GetGulinBrainListToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "brain_list",
		DisplayName: "List Gulin Brain Files",
		Description: "List all files in Gulin's long-term memory brain.",
		ToolLogName: "brain:list",
		InputSchema: map[string]any{
			"type":                 "object",
			"properties":           map[string]any{},
			"additionalProperties": false,
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			files, err := ListGulinMemoryFiles()
			if err != nil {
				return nil, err
			}
			return files, nil
		},
	}
}

func GetGulinBrainSearchToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "brain_search",
		DisplayName: "Search Gulin Brain",
		Description: "Search for relevant knowledge in Gulin's long-term memory using semantic search.",
		ToolLogName: "brain:search",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{
					"type":        "string",
					"description": "The search query (e.g., 'prefencias de puerto', 'lecciones sobre kubernetes')",
				},
			},
			"required":             []string{"query"},
			"additionalProperties": false,
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			m, ok := input.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("invalid input format: expected object")
			}
			query, _ := m["query"].(string)
			if query == "" {
				// Fallback: if the model sent 'filename' instead of 'query' (common Ollama mistake)
				if fn, ok := m["filename"].(string); ok && fn != "" {
					query = fn
				} else {
					return nil, fmt.Errorf("missing required parameter: 'query' is required")
				}
			}
			files, err := SearchGulinMemory(query)
			if err != nil {
				return nil, err
			}
			if len(files) == 0 {
				return "No se encontró información relevante en la memoria para la consulta: " + query, nil
			}

			var sb strings.Builder
			sb.WriteString(fmt.Sprintf("Resultados encontrados para '%s':\n", query))
			for _, file := range files {
				content, err := ReadGulinMemoryFile(file)
				if err == nil {
					sb.WriteString(fmt.Sprintf("\n--- Archivo: %s ---\n", file))
					sb.WriteString(content)
					sb.WriteString("\n")
				}
			}
			return sb.String(), nil
		},
	}
}

// Used for internal testing of tool loops
func GetAdderToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "adder",
		DisplayName: "Adder",
		Description: "Add an array of numbers together and return their sum",
		ToolLogName: "gen:adder",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"values": map[string]any{
					"type": "array",
					"items": map[string]any{
						"type": "integer",
					},
					"description": "Array of numbers to add together",
				},
			},
			"required":             []string{"values"},
			"additionalProperties": false,
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			inputMap, ok := input.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("invalid input format")
			}

			valuesInterface, ok := inputMap["values"]
			if !ok {
				return nil, fmt.Errorf("missing values parameter")
			}

			valuesSlice, ok := valuesInterface.([]any)
			if !ok {
				return nil, fmt.Errorf("values must be an array")
			}

			if len(valuesSlice) == 0 {
				return 0, nil
			}

			sum := 0
			for i, val := range valuesSlice {
				floatVal, ok := val.(float64)
				if !ok {
					return nil, fmt.Errorf("value at index %d is not a number", i)
				}
				sum += int(floatVal)
			}

			return sum, nil
		},
	}
}


