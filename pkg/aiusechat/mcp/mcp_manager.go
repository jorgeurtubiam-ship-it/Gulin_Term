// Copyright 2026, GuLiN Terminal
// SPDX-License-Identifier: Apache-2.0

package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/gulinbase"
)

// GetMCPDir returns the path to ~/.gulin/mcp/
func GetMCPDir() string {
	return filepath.Join(gulinbase.GetGulinConfigDir(), MCPDirName)
}

// LoadMCPServers reads all *.json files from ~/.gulin/mcp/ and returns configs.
// Same pattern as plugin_manager.go LoadPlugins().
func LoadMCPServers() ([]MCPServerConfig, error) {
	mcpDir := GetMCPDir()
	if _, err := os.Stat(mcpDir); os.IsNotExist(err) {
		os.MkdirAll(mcpDir, 0755)
		return nil, nil
	}

	files, err := os.ReadDir(mcpDir)
	if err != nil {
		return nil, err
	}

	var servers []MCPServerConfig
	for _, file := range files {
		if file.IsDir() || !strings.HasSuffix(file.Name(), ".json") {
			continue
		}
		path := filepath.Join(mcpDir, file.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			log.Printf("[MCP] Failed to read %s: %v\n", file.Name(), err)
			continue
		}
		var cfg MCPServerConfig
		if err := json.Unmarshal(data, &cfg); err != nil {
			log.Printf("[MCP] Failed to parse %s: %v\n", file.Name(), err)
			continue
		}
		// If name is missing, use filename without .json
		if cfg.Name == "" {
			cfg.Name = strings.TrimSuffix(file.Name(), ".json")
		}
		servers = append(servers, cfg)
	}

	log.Printf("[MCP] Loaded %d server configs from %s\n", len(servers), mcpDir)
	return servers, nil
}

// SaveMCPServer writes a server config to ~/.gulin/mcp/<name>.json
func SaveMCPServer(cfg MCPServerConfig) error {
	if cfg.Name == "" {
		return fmt.Errorf("mcp server name is required")
	}
	if cfg.Command == "" {
		return fmt.Errorf("mcp server command is required")
	}
	mcpDir := GetMCPDir()
	os.MkdirAll(mcpDir, 0755)

	filename := cfg.Name + ".json"
	path := filepath.Join(mcpDir, filename)

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("mcp: failed to marshal config: %w", err)
	}
	return os.WriteFile(path, data, 0644)
}

// DeleteMCPServer removes ~/.gulin/mcp/<name>.json
func DeleteMCPServer(name string) error {
	if name == "" {
		return fmt.Errorf("mcp server name is required")
	}
	path := filepath.Join(GetMCPDir(), name+".json")
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return fmt.Errorf("mcp server '%s' not found", name)
	}
	return os.Remove(path)
}

// TestMCPServer starts the server, lists its tools, and returns them.
func TestMCPServer(name string) ([]MCPTool, error) {
	servers, err := LoadMCPServers()
	if err != nil {
		return nil, err
	}
	for _, srv := range servers {
		if srv.Name == name {
			return ConnectAndList(srv)
		}
	}
	return nil, fmt.Errorf("mcp server '%s' not found", name)
}

// sanitizeName ensures tool names are valid for AI APIs (^[a-zA-Z0-9_-]+$)
var sanitizeRe = regexp.MustCompile(`[^a-zA-Z0-9_-]`)

func sanitizeName(name string) string {
	return sanitizeRe.ReplaceAllString(name, "_")
}

// GetMCPTools launches all configured MCP servers, collects their tools,
// and returns them as ToolDefinitions ready for the AI chat.
// Each server is launched fresh per chat turn (stateless, simple).
func GetMCPTools(ctx context.Context, tabid string) ([]uctypes.ToolDefinition, error) {
	servers, err := LoadMCPServers()
	if err != nil {
		return nil, err
	}
	if len(servers) == 0 {
		return nil, nil
	}

	var allTools []uctypes.ToolDefinition

	for _, srv := range servers {
		srvCopy := srv // capture for closure
		tools, err := collectToolsFromServer(ctx, srvCopy)
		if err != nil {
			log.Printf("[MCP] Server '%s' failed: %v\n", srv.Name, err)
			continue
		}
		allTools = append(allTools, tools...)
	}

	return allTools, nil
}

// collectToolsFromServer starts one MCP server, initializes it, lists tools,
// and builds ToolDefinitions with callbacks that re-spawn the process on call.
func collectToolsFromServer(ctx context.Context, cfg MCPServerConfig) ([]uctypes.ToolDefinition, error) {
	timeout := 15 * time.Second
	listCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	client, err := newMCPClient(listCtx, cfg)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	if err := client.initialize(listCtx); err != nil {
		return nil, err
	}

	mcpTools, err := client.ListTools(listCtx)
	if err != nil {
		return nil, err
	}

	log.Printf("[MCP] Server '%s' exposed %d tools\n", cfg.Name, len(mcpTools))

	var defs []uctypes.ToolDefinition
	for _, tool := range mcpTools {
		toolCopy := tool // capture for closure
		cfgCopy := cfg  // capture for closure

		// Prefix tool name with server name to avoid collisions: "github__create_issue"
		fullName := sanitizeName(cfgCopy.Name + "__" + toolCopy.Name)

		inputSchema := toolCopy.InputSchema
		if inputSchema == nil {
			inputSchema = map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			}
		}

		def := uctypes.ToolDefinition{
			Name:        fullName,
			DisplayName: fmt.Sprintf("[MCP:%s] %s", cfgCopy.Name, toolCopy.Name),
			Description: fmt.Sprintf("[MCP Server: %s] %s", cfgCopy.Name, toolCopy.Description),
			ToolLogName: "mcp:" + cfgCopy.Name + ":" + toolCopy.Name,
			InputSchema: inputSchema,
			ToolAnyCallback: func(callCtx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
				return callMCPTool(callCtx, cfgCopy, toolCopy.Name, input)
			},
		}
		defs = append(defs, def)
	}

	return defs, nil
}

// callMCPTool spawns the server, initializes, calls the tool, and closes.
func callMCPTool(ctx context.Context, cfg MCPServerConfig, toolName string, input any) (any, error) {
	callCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	client, err := newMCPClient(callCtx, cfg)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	if err := client.initialize(callCtx); err != nil {
		return nil, err
	}

	// Convert input to map[string]any
	var args map[string]any
	if input != nil {
		if m, ok := input.(map[string]any); ok {
			args = m
		} else {
			data, err := json.Marshal(input)
			if err != nil {
				return nil, fmt.Errorf("mcp: failed to marshal input: %w", err)
			}
			json.Unmarshal(data, &args)
		}
	}

	result, err := client.CallTool(callCtx, toolName, args)
	if err != nil {
		return nil, err
	}

	return result, nil
}
