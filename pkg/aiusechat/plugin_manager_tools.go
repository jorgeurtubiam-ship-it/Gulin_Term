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

func GetPluginRunToolDefinition(tabid string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "plugin_run",
		DisplayName: "Run Plugin",
		Description: "Executes a custom user plugin from ~/Gulin_Workspace/plugins by name or filename (e.g. 'aws_inventory' or 'aws_inventory.js').",
		ToolLogName: "plugin:run",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"plugin_name": map[string]any{
					"type":        "string",
					"description": "Name or filename of the plugin to execute (e.g. 'aws_inventory', 'o365_ahorro_inactivos', 'oracle19c_install_ol9', 'top_queries_monitor')",
				},
				"params": map[string]any{
					"type":        "object",
					"description": "Parameters to pass to the plugin execute function as key-value object (optional)",
				},
			},
			"required":             []string{"plugin_name"},
			"additionalProperties": false,
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			m, ok := input.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("invalid input format")
			}
			pluginName, _ := m["plugin_name"].(string)
			pluginName = strings.TrimSpace(pluginName)
			if pluginName == "" {
				return nil, fmt.Errorf("plugin_name is required")
			}

			params := m["params"]
			if params == nil {
				params = make(map[string]any)
			}

			pluginsDir := gulinbase.GetConfiguredPluginsDir()
			files, err := os.ReadDir(pluginsDir)
			if err != nil {
				return nil, fmt.Errorf("plugins directory not accessible: %w", err)
			}

			var targetPath string
			var targetContent string
			for _, file := range files {
				if !file.IsDir() && strings.HasSuffix(file.Name(), ".js") {
					path := filepath.Join(pluginsDir, file.Name())
					contentBytes, readErr := os.ReadFile(path)
					if readErr != nil {
						continue
					}
					contentStr := string(contentBytes)
					meta := extractMetadata(contentStr)

					cleanFile := strings.TrimSuffix(file.Name(), ".js")
					if strings.EqualFold(file.Name(), pluginName) ||
						strings.EqualFold(cleanFile, pluginName) ||
						strings.EqualFold(meta.Name, pluginName) {
						targetPath = path
						targetContent = contentStr
						break
					}
				}
			}

			if targetPath == "" {
				return nil, fmt.Errorf("plugin '%s' not found in %s. Use plugin_list to see available plugins", pluginName, pluginsDir)
			}

			return executePlugin(ctx, targetContent, params, tabid)
		},
	}
}

func GetPluginListToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "plugin_list",
		DisplayName: "List Plugins",
		Description: "Lists all available plugins in ~/Gulin_Workspace/plugins with their metadata and parameters, ready to be executed with plugin_run.",
		ToolLogName: "plugin:list",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"include_code": map[string]any{
					"type":        "boolean",
					"description": "If true, includes full source code of each plugin. Default is false.",
				},
			},
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			includeCode := false
			if m, ok := input.(map[string]any); ok {
				if ic, ok := m["include_code"].(bool); ok {
					includeCode = ic
				}
			}

			pluginsDir := gulinbase.GetConfiguredPluginsDir()
			files, err := os.ReadDir(pluginsDir)
			if err != nil {
				return "No plugins found or directory does not exist.", nil
			}

			var sb strings.Builder
			count := 0
			for _, f := range files {
				if !f.IsDir() && strings.HasSuffix(f.Name(), ".js") {
					path := filepath.Join(pluginsDir, f.Name())
					codeBytes, err := ioutil.ReadFile(path)
					if err == nil {
						count++
						contentStr := string(codeBytes)
						meta := extractMetadata(contentStr)
						name := meta.Name
						if name == "" {
							name = strings.TrimSuffix(f.Name(), ".js")
						}
						sb.WriteString(fmt.Sprintf("### Plugin: %s (file: %s)\n", name, f.Name()))
						if meta.Description != "" {
							sb.WriteString(fmt.Sprintf("- **Description:** %s\n", meta.Description))
						}
						if len(meta.Params) > 0 {
							sb.WriteString("- **Parameters:**\n")
							for _, p := range meta.Params {
								sb.WriteString(fmt.Sprintf("  * `%s` (%s): %s\n", p.Name, p.Type, p.Description))
							}
						}
						if includeCode {
							sb.WriteString("\n```javascript\n")
							sb.WriteString(contentStr)
							sb.WriteString("\n```\n")
						}
						sb.WriteString("\n")
					}
				}
			}

			if count == 0 {
				return fmt.Sprintf("No plugins found in %s.", pluginsDir), nil
			}
			return sb.String(), nil
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
