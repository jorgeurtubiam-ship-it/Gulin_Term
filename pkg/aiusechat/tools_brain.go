// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/gulinapp"
)

type BrainRegisterNodeInput struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Type        string `json:"type"`
	Status      string `json:"status"`
	Icon        string `json:"icon"`
	Description string `json:"description"`
	ParentID    string `json:"parent_id"`
	StatusColor string `json:"status_color"`
	Metadata    any    `json:"metadata"`
}

func GetBrainRegisterNodeToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "brain_register_node",
		DisplayName: "Register Brain Node",
		Description: "Registers or updates a node in the 3D Neural Brain Map. Use this to represent infrastructure entities like DBs, Servers, or AWS instances found during exploration.",
		ToolLogName: "brain:register",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"id":          map[string]any{"type": "string", "description": "Unique ID for the node (e.g. 'aws-ec2-1')"},
				"label":       map[string]any{"type": "string", "description": "Display label (e.g. 'Production Server')"},
				"type":        map[string]any{"type": "string", "description": "Node type (e.g. 'core', 'skill', 'memory', 'server', 'db', 'aws-ec2')"},
				"status":      map[string]any{"type": "string", "description": "Current status (online, offline, idle, warning)"},
				"icon":        map[string]any{"type": "string", "description": "Emoji icon for the node"},
				"description": map[string]any{"type": "string", "description": "Brief description of what this node represents"},
				"parent_id":   map[string]any{"type": "string", "description": "Optional parent node ID for hierarchy"},
				"status_color": map[string]any{"type": "string", "description": "Optional hex color for status (e.g. '#22c55e' for green)"},
				"metadata":     map[string]any{"type": "object", "description": "Generic object for any additional technical metadata (AWS, O365, RVTools, etc.)"},
			},
			"required": []string{"id", "label", "type"},
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			var parsed BrainRegisterNodeInput
			inputBytes, _ := json.Marshal(input)
			json.Unmarshal(inputBytes, &parsed)
			return fmt.Sprintf("Register node: %s (%s)", parsed.Label, parsed.ID)
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			var parsed BrainRegisterNodeInput
			inputBytes, _ := json.Marshal(input)
			json.Unmarshal(inputBytes, &parsed)

			// Fallback for color
			if parsed.StatusColor == "" {
				if parsed.Status == "online" || parsed.Status == "ready" {
					parsed.StatusColor = "#22c55e"
				} else if parsed.Status == "offline" || parsed.Status == "error" {
					parsed.StatusColor = "#ef4444"
				} else if parsed.Status == "warning" {
					parsed.StatusColor = "#f59e0b"
				} else {
					parsed.StatusColor = "#334155"
				}
			}

			db, err := gulinapp.OpenBrainDBInternal() // Need to export this or use shared logic
			if err != nil {
				return nil, err
			}
			defer db.Close()

			metadataJSON, _ := json.Marshal(parsed.Metadata)
			if string(metadataJSON) == "null" {
				metadataJSON = []byte("{}")
			}

			_, err = db.Exec(`INSERT INTO infra_nodes (id, label, type, status, icon, description, parent_id, status_color, metadata) 
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) 
				ON CONFLICT(id) DO UPDATE SET label=excluded.label, type=excluded.type, status=excluded.status, icon=excluded.icon, description=excluded.description, parent_id=excluded.parent_id, status_color=excluded.status_color, metadata=excluded.metadata`,
				parsed.ID, parsed.Label, parsed.Type, parsed.Status, parsed.Icon, parsed.Description, parsed.ParentID, parsed.StatusColor, string(metadataJSON))
			
			if err != nil {
				return nil, fmt.Errorf("failed to register node: %v", err)
			}

			// Pulse on map
			gulinapp.RecordXPAuto("register_infra", "ai-agent")
			
			return fmt.Sprintf("Node '%s' registered successfully in the Brain Map.", parsed.Label), nil
		},
	}
}

func GetBrainConnectNodesToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "brain_connect_nodes",
		DisplayName: "Connect Brain Nodes",
		Description: "Creates a relationship (edge) between two nodes in the 3D Neural Brain Map.",
		ToolLogName: "brain:connect",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"source":  map[string]any{"type": "string", "description": "Source node ID"},
				"target":  map[string]any{"type": "string", "description": "Target node ID"},
				"traffic": map[string]any{"type": "string", "description": "Optional label for the traffic/connection (e.g. 'TCP/80', 'pulse', 'sync')"},
			},
			"required": []string{"source", "target"},
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			var parsed struct {
				Source  string `json:"source"`
				Target  string `json:"target"`
				Traffic string `json:"traffic"`
			}
			inputBytes, _ := json.Marshal(input)
			json.Unmarshal(inputBytes, &parsed)
			if parsed.Traffic != "" {
				return fmt.Sprintf("Connect %s -> %s (%s)", parsed.Source, parsed.Target, parsed.Traffic)
			}
			return fmt.Sprintf("Connect %s -> %s", parsed.Source, parsed.Target)
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			var parsed struct {
				Source  string `json:"source"`
				Target  string `json:"target"`
				Traffic string `json:"traffic"`
			}
			inputBytes, _ := json.Marshal(input)
			json.Unmarshal(inputBytes, &parsed)

			db, err := gulinapp.OpenBrainDBInternal()
			if err != nil {
				return nil, err
			}
			defer db.Close()

			_, err = db.Exec("INSERT INTO infra_edges (source, target, traffic) VALUES (?, ?, ?)", parsed.Source, parsed.Target, parsed.Traffic)
			if err != nil {
				return nil, fmt.Errorf("failed to connect nodes: %v", err)
			}

			gulinapp.RecordXPAuto("db_query", "ai-agent")
			return fmt.Sprintf("Connection from '%s' to '%s' established.", parsed.Source, parsed.Target), nil
		},
	}
}
