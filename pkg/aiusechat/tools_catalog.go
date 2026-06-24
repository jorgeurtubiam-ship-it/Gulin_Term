// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
)

type GetToolSchemaInput struct {
	ToolName string `json:"tool_name"`
}

func GetListAvailableToolsToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "list_available_tools",
		DisplayName: "List Available Tools",
		Description: "Returns a list of all available tools in the system with their names and short descriptions.",
		ToolLogName: "catalog:list",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{},
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			return "List available tools"
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			// Nota: Esta herramienta será manejada de forma especial o recibirá la lista de herramientas por contexto.
			// Por ahora, devolvemos un mensaje genérico. En plai-backend.go interceptaremos esto si es necesario.
			return "Usa esta herramienta para ver qué más puedo hacer. Consulta el catálogo en el prompt del sistema.", nil
		},
	}
}

func GetGetToolSchemaToolDefinition(allTools []uctypes.ToolDefinition) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "get_tool_schema",
		DisplayName: "Get Tool Schema",
		Description: "Returns the detailed JSON schema for a specific tool. Use this before calling a tool if you don't know its parameters.",
		ToolLogName: "catalog:schema",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"tool_name": map[string]any{
					"type":        "string",
					"description": "The name of the tool to get the schema for (e.g., 'db_query')",
				},
			},
			"required": []string{"tool_name"},
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			var parsed GetToolSchemaInput
			inputBytes, _ := json.Marshal(input)
			json.Unmarshal(inputBytes, &parsed)
			return fmt.Sprintf("Get schema for tool: %s", parsed.ToolName)
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			var parsed GetToolSchemaInput
			inputBytes, _ := json.Marshal(input)
			json.Unmarshal(inputBytes, &parsed)

			for _, t := range allTools {
				if t.Name == parsed.ToolName {
					schema, _ := json.MarshalIndent(t.InputSchema, "", "  ")
					return fmt.Sprintf("Esquema para '%s':\n%s", t.Name, string(schema)), nil
				}
			}
			return nil, fmt.Errorf("tool '%s' not found", parsed.ToolName)
		},
	}
}
