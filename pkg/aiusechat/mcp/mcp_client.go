// Copyright 2026, GuLiN Terminal
// SPDX-License-Identifier: Apache-2.0

package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// MCPClient handles stdio communication with a single MCP server process.
// Implements JSON-RPC 2.0 over stdin/stdout.
type MCPClient struct {
	config  MCPServerConfig
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	stdout  *bufio.Reader
	mu      sync.Mutex
	nextID  int
}

// newMCPClient creates and starts an MCP server process.
func newMCPClient(ctx context.Context, config MCPServerConfig) (*MCPClient, error) {
	cmd := exec.CommandContext(ctx, config.Command, config.Args...)

	// Inject env vars from config
	if len(config.Env) > 0 {
		for k, v := range config.Env {
			cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
		}
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("mcp[%s]: failed to get stdin pipe: %w", config.Name, err)
	}

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("mcp[%s]: failed to get stdout pipe: %w", config.Name, err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("mcp[%s]: failed to start process '%s': %w", config.Name, config.Command, err)
	}

	client := &MCPClient{
		config: config,
		cmd:    cmd,
		stdin:  stdin,
		stdout: bufio.NewReader(stdoutPipe),
		nextID: 1,
	}

	return client, nil
}

// Close terminates the MCP server process.
func (c *MCPClient) Close() {
	c.stdin.Close()
	if c.cmd != nil && c.cmd.Process != nil {
		c.cmd.Process.Kill()
		c.cmd.Wait()
	}
}

// call sends a JSON-RPC request and returns the raw result.
func (c *MCPClient) call(method string, params any) (json.RawMessage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	id := c.nextID
	c.nextID++

	req := jsonRPCRequest{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
		Params:  params,
	}

	reqBytes, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("mcp[%s]: marshal error: %w", c.config.Name, err)
	}

	// Write request terminated by newline
	if _, err := fmt.Fprintf(c.stdin, "%s\n", reqBytes); err != nil {
		return nil, fmt.Errorf("mcp[%s]: write error: %w", c.config.Name, err)
	}

	// Read response line
	line, err := c.stdout.ReadString('\n')
	if err != nil {
		return nil, fmt.Errorf("mcp[%s]: read error: %w", c.config.Name, err)
	}

	var resp struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      int             `json:"id"`
		Result  json.RawMessage `json:"result,omitempty"`
		Error   *jsonRPCError   `json:"error,omitempty"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(line)), &resp); err != nil {
		return nil, fmt.Errorf("mcp[%s]: unmarshal error: %w", c.config.Name, err)
	}

	if resp.Error != nil {
		return nil, fmt.Errorf("mcp[%s]: server error %d: %s", c.config.Name, resp.Error.Code, resp.Error.Message)
	}

	return resp.Result, nil
}

// initialize performs the MCP handshake.
func (c *MCPClient) initialize(ctx context.Context) error {
	params := mcpInitializeParams{
		ProtocolVersion: "2024-11-05",
		ClientInfo: mcpClientInfo{
			Name:    "gulin",
			Version: "1.0.0",
		},
		Capabilities: map[string]any{},
	}

	_, err := c.call("initialize", params)
	if err != nil {
		return err
	}

	// Send initialized notification (no response expected)
	notif := map[string]any{
		"jsonrpc": "2.0",
		"method":  "notifications/initialized",
	}
	notifBytes, _ := json.Marshal(notif)
	fmt.Fprintf(c.stdin, "%s\n", notifBytes)

	return nil
}

// ListTools calls tools/list and returns the available tools.
func (c *MCPClient) ListTools(ctx context.Context) ([]MCPTool, error) {
	result, err := c.call("tools/list", nil)
	if err != nil {
		return nil, err
	}

	var listResult mcpToolsListResult
	if err := json.Unmarshal(result, &listResult); err != nil {
		return nil, fmt.Errorf("mcp[%s]: failed to parse tools/list: %w", c.config.Name, err)
	}

	return listResult.Tools, nil
}

// CallTool calls tools/call on the server.
func (c *MCPClient) CallTool(ctx context.Context, toolName string, args map[string]any) (string, error) {
	params := mcpToolsCallParams{
		Name:      toolName,
		Arguments: args,
	}

	result, err := c.call("tools/call", params)
	if err != nil {
		return "", err
	}

	var callResult mcpToolsCallResult
	if err := json.Unmarshal(result, &callResult); err != nil {
		return "", fmt.Errorf("mcp[%s]: failed to parse tools/call: %w", c.config.Name, err)
	}

	if callResult.IsError {
		var msgs []string
		for _, c := range callResult.Content {
			if c.Text != "" {
				msgs = append(msgs, c.Text)
			}
		}
		return "", fmt.Errorf("mcp tool error: %s", strings.Join(msgs, "\n"))
	}

	var parts []string
	for _, content := range callResult.Content {
		if content.Text != "" {
			parts = append(parts, content.Text)
		}
	}
	return strings.Join(parts, "\n"), nil
}

// ConnectAndList is a convenience function: starts the server, initializes,
// lists tools, and closes the process. Used for testing.
func ConnectAndList(config MCPServerConfig) ([]MCPTool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	client, err := newMCPClient(ctx, config)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	if err := client.initialize(ctx); err != nil {
		return nil, err
	}

	return client.ListTools(ctx)
}
