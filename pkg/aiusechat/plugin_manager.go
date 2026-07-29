// Copyright 2026, GuLiN Terminal
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/dop251/goja"
	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/gulinbase"
)

const PluginsDirName = "plugins"

type PluginMetadata struct {
	Name        string
	Description string
	Params      []PluginParam
}

type PluginParam struct {
	Name        string
	Type        string
	Description string
}

// LoadPlugins reads all .js files from the plugins directory and returns a list of ToolDefinitions.
func LoadPlugins(ctx context.Context, tabid string) ([]uctypes.ToolDefinition, error) {
	pluginsDir := gulinbase.GetConfiguredPluginsDir()
	if _, err := os.Stat(pluginsDir); os.IsNotExist(err) {
		os.MkdirAll(pluginsDir, 0755)
		return nil, nil
	}

	files, err := os.ReadDir(pluginsDir)
	if err != nil {
		return nil, err
	}

	log.Printf("[PLUGINS] Found %d files in %s\n", len(files), pluginsDir)

	var tools []uctypes.ToolDefinition
	for _, file := range files {
		if !file.IsDir() && strings.HasSuffix(file.Name(), ".js") {
			path := filepath.Join(pluginsDir, file.Name())
			tool, err := parsePluginFile(path, tabid)
			if err != nil {
				log.Printf("[PLUGIN ERROR] Failed to parse %s: %v\n", file.Name(), err)
				continue
			}
			log.Printf("[PLUGINS] Loaded tool: %s\n", tool.Name)
			tools = append(tools, tool)
		}
	}

	return tools, nil
}

func parsePluginFile(path string, tabid string) (uctypes.ToolDefinition, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return uctypes.ToolDefinition{}, err
	}

	meta := extractMetadata(string(content))
	if meta.Name == "" {
		return uctypes.ToolDefinition{}, fmt.Errorf("plugin missing @name")
	}

	// Sanitize name to prevent API 400 errors (OpenAI requires ^[a-zA-Z0-9_-]+$)
	sanitizeRe := regexp.MustCompile(`[^a-zA-Z0-9_-]`)
	meta.Name = sanitizeRe.ReplaceAllString(meta.Name, "_")

	// Build InputSchema
	properties := make(map[string]any)
	required := []string{}
	for _, p := range meta.Params {
		properties[p.Name] = map[string]any{
			"type":        p.Type,
			"description": p.Description,
		}
		required = append(required, p.Name)
	}

	inputSchema := map[string]any{
		"type":                 "object",
		"properties":           properties,
		"required":             required,
		"additionalProperties": false,
	}

	return uctypes.ToolDefinition{
		Name:        meta.Name,
		DisplayName: meta.Name, // Could be more fancy
		Description: meta.Description,
		ToolLogName: "plugin:" + meta.Name,
		InputSchema: inputSchema,
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			return executePlugin(ctx, string(content), input, tabid)
		},
	}, nil
}

func extractMetadata(content string) PluginMetadata {
	meta := PluginMetadata{}
	lines := strings.Split(content, "\n")

	nameRegex := regexp.MustCompile(`//\s*@name:\s*(.*)`)
	descRegex := regexp.MustCompile(`//\s*@description:\s*(.*)`)
	paramRegex := regexp.MustCompile(`//\s*@param:\s*(\w+)\s*\((\w+)\)\s*-\s*(.*)`)

	for _, line := range lines {
		if m := nameRegex.FindStringSubmatch(line); len(m) > 1 {
			meta.Name = strings.TrimSpace(m[1])
		} else if m := descRegex.FindStringSubmatch(line); len(m) > 1 {
			meta.Description = strings.TrimSpace(m[1])
		} else if m := paramRegex.FindStringSubmatch(line); len(m) > 3 {
			meta.Params = append(meta.Params, PluginParam{
				Name:        strings.TrimSpace(m[1]),
				Type:        strings.TrimSpace(m[2]),
				Description: strings.TrimSpace(m[3]),
			})
		}
	}
	return meta
}

func executePlugin(ctx context.Context, script string, input any, tabid string) (any, error) {
	vm := goja.New()

	// Export Gulin Bridge functions to JS
	gulinBridge := map[string]interface{}{
		"api_call": func(apiName string, method string, path string, body any) (any, error) {
			// This is a simplified bridge. We should call the existing apimanager logic.
			// For now, let's just use the current tool logic if possible or re-implement.
			// Actually, let's use the actual GetAPICallToolDefinition logic.
			apiTool := GetAPICallToolDefinition()
			input := map[string]any{
				"api_name": apiName,
				"method":   method,
				"path":     path,
				"body":     body,
			}
			return apiTool.ToolAnyCallback(ctx, input, nil)
		},
		"db_query": func(connName string, query string) (any, error) {
			dbTool := GetDBQueryToolDefinition(tabid)
			input := map[string]any{
				"connection_name": connName,
				"sql":             query,
			}
			return dbTool.ToolAnyCallback(ctx, input, nil)
		},
		"run_command": func(args ...interface{}) (any, error) {
			if len(args) == 0 {
				return nil, fmt.Errorf("command is required")
			}
			var command, widgetId string
			if len(args) == 1 {
				if m, ok := args[0].(map[string]interface{}); ok {
					if cmd, _ := m["command"].(string); cmd != "" {
						command = cmd
					}
					if wid, _ := m["widget_id"].(string); wid != "" {
						widgetId = wid
					}
				} else if str, ok := args[0].(string); ok {
					command = str
				}
			} else if len(args) >= 2 {
				if str, ok := args[0].(string); ok {
					command = str
				}
				if wid, ok := args[1].(string); ok {
					widgetId = wid
				}
			}
			if command == "" {
				return nil, fmt.Errorf("command is required")
			}
			if widgetId == "" {
				if inputMap, ok := input.(map[string]any); ok {
					if wid, ok := inputMap["widget_id"].(string); ok {
						widgetId = wid
					}
				}
			}
			termTool := GetTermRunCommandToolDefinition(tabid)
			toolInput := map[string]any{
				"command": command,
			}
			if widgetId != "" {
				toolInput["widget_id"] = widgetId
			}
			return termTool.ToolAnyCallback(ctx, toolInput, nil)
		},
		"brain_register_node": func(nodeData any) (any, error) {
			brainTool := GetBrainRegisterNodeToolDefinition()
			return brainTool.ToolAnyCallback(ctx, nodeData, nil)
		},
		"brain_connect_nodes": func(source string, target string, traffic string) (any, error) {
			connectTool := GetBrainConnectNodesToolDefinition()
			input := map[string]any{
				"source":  source,
				"target":  target,
				"traffic": traffic,
			}
			return connectTool.ToolAnyCallback(ctx, input, nil)
		},
		"log": func(args ...interface{}) {
			fmt.Println("[PLUGIN LOG]", args)
		},
	}
	vm.Set("gulin", gulinBridge)
	vm.Set("console", map[string]interface{}{
		"log": func(args ...interface{}) {
			fmt.Println("[PLUGIN CONSOLE]", args)
		},
	})

	// Set input as a global 'args' variable
	vm.Set("args", input)

	// Execute the script
	v, err := vm.RunString(script + "\nexecute(args);")
	if err != nil {
		return nil, fmt.Errorf("JS Execution Error: %w", err)
	}

	return v.Export(), nil
}
