// Copyright 2026, GuLiN Terminal
// SPDX-License-Identifier: Apache-2.0

package mcp

// MCPDirName is the directory inside ~/.gulin where MCP server configs live.
// One .json file per server — same pattern as plugins/*.js
const MCPDirName = "mcp"

// MCPServerConfig is what gets written to ~/.gulin/mcp/<name>.json
type MCPServerConfig struct {
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	Command     string            `json:"command"`
	Args        []string          `json:"args,omitempty"`
	Env         map[string]string `json:"env,omitempty"`
}

// --- JSON-RPC 2.0 protocol structs (used internally by mcp_client.go) ---

type jsonRPCRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int    `json:"id"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type jsonRPCResponse struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      int            `json:"id"`
	Result  any            `json:"result,omitempty"`
	Error   *jsonRPCError  `json:"error,omitempty"`
}

type jsonRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// --- MCP protocol types ---

type mcpInitializeParams struct {
	ProtocolVersion string          `json:"protocolVersion"`
	ClientInfo      mcpClientInfo   `json:"clientInfo"`
	Capabilities    map[string]any  `json:"capabilities"`
}

type mcpClientInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// MCPTool represents a tool exposed by an MCP server
type MCPTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	InputSchema map[string]any `json:"inputSchema,omitempty"`
}

type mcpToolsListResult struct {
	Tools []MCPTool `json:"tools"`
}

type mcpToolsCallParams struct {
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments,omitempty"`
}

type mcpToolsCallResult struct {
	Content []mcpContent `json:"content"`
	IsError bool         `json:"isError,omitempty"`
}

type mcpContent struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}
