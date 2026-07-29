// Copyright 2026, GuLiN Terminal
// SPDX-License-Identifier: Apache-2.0

package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
)

// GetMCPAddServerToolDefinition returns a tool that lets the AI add a new MCP server.
func GetMCPAddServerToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "mcp_add_server",
		DisplayName: "Add MCP Server",
		Description: "Add a new MCP server configuration. Creates a .json file in ~/.gulin/mcp/. Example: name='github', command='npx', args=['-y','@modelcontextprotocol/server-github'], env={GITHUB_TOKEN:'...'}",
		ToolLogName: "mcp:add_server",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"name": map[string]any{
					"type":        "string",
					"description": "Unique name for the server (e.g. 'github', 'filesystem')",
				},
				"command": map[string]any{
					"type":        "string",
					"description": "Command to run the server (e.g. 'npx', 'python3', 'node')",
				},
				"args": map[string]any{
					"type":        "array",
					"items":       map[string]any{"type": "string"},
					"description": "Arguments for the command (e.g. ['-y', '@modelcontextprotocol/server-github'])",
				},
				"description": map[string]any{
					"type":        "string",
					"description": "Short description of what this server provides",
				},
				"env": map[string]any{
					"type":        "object",
					"description": "Environment variables for authentication (e.g. {\"GITHUB_TOKEN\": \"...\"})",
				},
			},
			"required":             []string{"name", "command"},
			"additionalProperties": false,
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			m, ok := input.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("invalid input")
			}

			cfg := MCPServerConfig{
				Name:        getString(m, "name"),
				Command:     getString(m, "command"),
				Description: getString(m, "description"),
			}

			if argsRaw, ok := m["args"].([]any); ok {
				for _, a := range argsRaw {
					if s, ok := a.(string); ok {
						cfg.Args = append(cfg.Args, s)
					}
				}
			}

			if envRaw, ok := m["env"].(map[string]any); ok {
				cfg.Env = make(map[string]string)
				for k, v := range envRaw {
					cfg.Env[k] = fmt.Sprintf("%v", v)
				}
			}

			if err := SaveMCPServer(cfg); err != nil {
				return nil, err
			}

			// Test the server right away
			tools, err := ConnectAndList(cfg)
			if err != nil {
				return fmt.Sprintf("MCP server '%s' saved but could not connect: %v\nCheck your command and args.", cfg.Name, err), nil
			}

			var toolNames []string
			for _, t := range tools {
				toolNames = append(toolNames, t.Name)
			}

			return fmt.Sprintf("MCP server '%s' added successfully.\nAvailable tools (%d): %s\nThese tools are now available in the next message.",
				cfg.Name, len(tools), strings.Join(toolNames, ", ")), nil
		},
	}
}

// GetMCPListServersToolDefinition returns a tool to list configured MCP servers.
func GetMCPListServersToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "mcp_list_servers",
		DisplayName: "List MCP Servers",
		Description: "List all configured MCP servers and their available tools.",
		ToolLogName: "mcp:list_servers",
		InputSchema: map[string]any{
			"type":                 "object",
			"properties":           map[string]any{},
			"additionalProperties": false,
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			servers, err := LoadMCPServers()
			if err != nil {
				return nil, err
			}
			if len(servers) == 0 {
				return "No MCP servers configured. Use mcp_add_server to add one.", nil
			}

			var sb strings.Builder
			sb.WriteString(fmt.Sprintf("Configured MCP servers (%d):\n\n", len(servers)))
			for _, srv := range servers {
				sb.WriteString(fmt.Sprintf("• %s\n", srv.Name))
				sb.WriteString(fmt.Sprintf("  Command: %s %s\n", srv.Command, strings.Join(srv.Args, " ")))
				if srv.Description != "" {
					sb.WriteString(fmt.Sprintf("  Description: %s\n", srv.Description))
				}
				sb.WriteString("\n")
			}
			return sb.String(), nil
		},
	}
}

// GetMCPDeleteServerToolDefinition returns a tool to delete an MCP server config.
func GetMCPDeleteServerToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "mcp_delete_server",
		DisplayName: "Delete MCP Server",
		Description: "Delete an MCP server configuration by name.",
		ToolLogName: "mcp:delete_server",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"name": map[string]any{
					"type":        "string",
					"description": "Name of the MCP server to delete",
				},
			},
			"required":             []string{"name"},
			"additionalProperties": false,
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			m, ok := input.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("invalid input")
			}
			name := getString(m, "name")
			if err := DeleteMCPServer(name); err != nil {
				return nil, err
			}
			return fmt.Sprintf("MCP server '%s' deleted successfully.", name), nil
		},
	}
}

// GetMCPTestServerToolDefinition returns a tool to test an MCP server connection.
func GetMCPTestServerToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "mcp_test_server",
		DisplayName: "Test MCP Server",
		Description: "Test connection to an MCP server and list its available tools.",
		ToolLogName: "mcp:test_server",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"name": map[string]any{
					"type":        "string",
					"description": "Name of the MCP server to test",
				},
			},
			"required":             []string{"name"},
			"additionalProperties": false,
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			m, ok := input.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("invalid input")
			}
			name := getString(m, "name")
			tools, err := TestMCPServer(name)
			if err != nil {
				return fmt.Sprintf("❌ Connection failed for '%s': %v", name, err), nil
			}

			var sb strings.Builder
			sb.WriteString(fmt.Sprintf("✅ Connected to MCP server '%s'\n", name))
			sb.WriteString(fmt.Sprintf("Available tools (%d):\n", len(tools)))
			for _, t := range tools {
				sb.WriteString(fmt.Sprintf("  • %s", t.Name))
				if t.Description != "" {
					sb.WriteString(fmt.Sprintf(": %s", t.Description))
				}
				sb.WriteString("\n")
			}

			// Show raw schema for debugging
			if len(tools) > 0 {
				schemaBytes, _ := json.MarshalIndent(tools[0].InputSchema, "  ", "  ")
				sb.WriteString(fmt.Sprintf("\nExample schema for '%s':\n  %s\n", tools[0].Name, string(schemaBytes)))
			}

			return sb.String(), nil
		},
	}
}

// getString safely extracts a string from a map
func getString(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}
