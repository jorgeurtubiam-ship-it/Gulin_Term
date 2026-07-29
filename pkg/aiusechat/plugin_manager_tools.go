// Copyright 2026, GuLiN Terminal
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"io/ioutil"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/gulinbase"
)

func GetPluginSaveToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "plugin_save",
		DisplayName: "Save Plugin",
		Description: "Save a new dynamic plugin or update an existing one. Use .js extension.",
		ToolLogName: "plugin:save",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"filename": map[string]any{
					"type":        "string",
					"description": "Name of the plugin file (e.g., 'oci_helper.js')",
				},
				"content": map[string]any{
					"type":        "string",
					"description": "The Javascript code for the plugin, including @name, @description and @param tags.",
				},
			},
			"required":             []string{"filename", "content"},
			"additionalProperties": false,
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			m, _ := input.(map[string]any)
			filename := m["filename"].(string)
			content := m["content"].(string)

			if !strings.HasSuffix(filename, ".js") {
				filename += ".js"
			}

			pluginsDir := gulinbase.GetConfiguredPluginsDir()
			os.MkdirAll(pluginsDir, 0755)

			path := filepath.Join(pluginsDir, filename)
			err := os.WriteFile(path, []byte(content), 0644)
			if err != nil {
				return nil, err
			}

			return fmt.Sprintf("Plugin %s guardado exitosamente. Estará disponible en el próximo turno o al refrescar.", filename), nil
		},
	}
}

func GetPluginListToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "plugin_list",
		DisplayName: "List Plugins",
		Description: "Lists all currently saved dynamic plugins and their code so you can read them before modifying them.",
		ToolLogName: "plugin:list",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{},
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			pluginsDir := gulinbase.GetConfiguredPluginsDir()
			files, err := os.ReadDir(pluginsDir)
			if err != nil {
				return "No plugins found or directory does not exist.", nil
			}

			var sb strings.Builder
			for _, f := range files {
				if !f.IsDir() && strings.HasSuffix(f.Name(), ".js") {
					path := filepath.Join(pluginsDir, f.Name())
					codeBytes, err := ioutil.ReadFile(path)
					if err == nil {
						sb.WriteString(fmt.Sprintf("--- Plugin: %s ---\n", f.Name()))
						sb.WriteString(string(codeBytes))
						sb.WriteString("\n\n")
					}
				}
			}

			res := sb.String()
			if res == "" {
				return "No plugins found.", nil
			}
			return res, nil
		},
	}
}

func GetPluginDeleteToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "plugin_delete",
		DisplayName: "Delete Plugin",
		Description: "Deletes a dynamic plugin by filename.",
		ToolLogName: "plugin:delete",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"filename": map[string]any{
					"type":        "string",
					"description": "Name of the plugin file to delete (e.g., 'oci_helper.js')",
				},
			},
			"required":             []string{"filename"},
			"additionalProperties": false,
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			m, _ := input.(map[string]any)
			filename := m["filename"].(string)

			if !strings.HasSuffix(filename, ".js") {
				filename += ".js"
			}

			pluginsDir := gulinbase.GetConfiguredPluginsDir()
			path := filepath.Join(pluginsDir, filename)

			err := os.Remove(path)
			if err != nil {
				return nil, fmt.Errorf("error deleting plugin: %v", err)
			}

			return fmt.Sprintf("Plugin %s deleted successfully.", filename), nil
		},
	}
}

func GetPluginDebugToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "plugin_debug",
		DisplayName: "Debug Plugin",
		Description: "A tool to help test plugin logic. Unused internally.",
		ToolLogName: "plugin:debug",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{},
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			return "Debug tool response.", nil
		},
	}
}
