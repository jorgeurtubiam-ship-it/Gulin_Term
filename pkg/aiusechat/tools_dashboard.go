// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/gulinobj"
	"github.com/gulindev/gulin/pkg/wshrpc"
	"github.com/gulindev/gulin/pkg/wshrpc/wshclient"
)

type TermCreateDashboardInput struct {
	Title string `json:"title"`
	Type  string `json:"type"` // "bar", "line", etc.
	Data  any    `json:"data"` // Can be JSON array string or raw array/map
}

func parseCreateDashboardInput(input any) (*TermCreateDashboardInput, error) {
	result := &TermCreateDashboardInput{}

	if input == nil {
		return nil, fmt.Errorf("title, type and data are required")
	}

	inputBytes, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal input: %w", err)
	}

	if err := json.Unmarshal(inputBytes, result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal input: %w", err)
	}

	if result.Title == "" {
		result.Title = "AI Generated Dashboard"
	}
	if result.Type == "" {
		result.Type = "bar"
	}

	return result, nil
}

func GetCreateDashboardToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "term_create_dashboard",
		DisplayName: "Create Interactive Dashboard",
		Description: "Generate an interactive dashboard or table. Use 'grid' type for tabular data. IMPORTANT: Data must be a list of records. If providing Dremio source info, use the 'children' array to show multiple items in the table. Avoid nested objects if possible.",
		ToolLogName: "widget:createdashboard",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"title": map[string]any{
					"type":        "string",
					"description": "The title of the dashboard widget (e.g. 'Server Load Analysis')",
				},
				"type": map[string]any{
					"type":        "string",
					"enum":        []string{"bar", "line", "grid"},
					"description": "Chart type. Default is 'bar'. Use 'grid' for tabular data like database results or excel-like spreadsheets.",
				},
				"data": map[string]any{
					"description": "The data set for the dashboard. Can be a JSON array string OR a direct JSON array/object. For 'grid' type, providing an array of objects is recommended.",
				},
			},
			"required":             []string{"data"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseCreateDashboardInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("creating %s dashboard: %s", parsed.Type, parsed.Title)
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			parsed, err := parseCreateDashboardInput(input)
			if err != nil {
				return nil, err
			}

			// Normalize data to JSON string for the frontend
			var finalDataStr string
			switch v := parsed.Data.(type) {
			case string:
				finalDataStr = v
			default:
				bytes, err := json.Marshal(v)
				if err != nil {
					return nil, fmt.Errorf("failed to marshal dashboard data: %w", err)
				}
				finalDataStr = string(bytes)
			}

			// Validate JSON array format basically
			var dummy []any
			if err := json.Unmarshal([]byte(finalDataStr), &dummy); err != nil {
				// If it's not an array, wrap it in one to allow single object display
				var singleObj map[string]any
				if err2 := json.Unmarshal([]byte(finalDataStr), &singleObj); err2 == nil {
					// AUTO-DETECTION: If the object has a 'children' array, use that as the data
					// This is common with Dremio/Cloud source outputs
					if children, ok := singleObj["children"]; ok {
						if childrenArray, ok := children.([]any); ok && len(childrenArray) > 0 {
							bytes, _ := json.Marshal(childrenArray)
							finalDataStr = string(bytes)
						} else {
							finalDataStr = "[" + finalDataStr + "]"
						}
					} else {
						finalDataStr = "[" + finalDataStr + "]"
					}
				} else {
					return nil, fmt.Errorf("data must be a valid JSON array or object: %v", err)
				}
			}

			rpcClient := wshclient.GetBareRpcClient()
			_, err = wshclient.CreateBlockCommand(rpcClient, wshrpc.CommandCreateBlockData{
				TabId: tabId,
				BlockDef: &gulinobj.BlockDef{
					Meta: map[string]any{
						"view":            "dashboard",
						"dashboard:title": parsed.Title,
						"dashboard:type":  parsed.Type,
						"dashboard:data":  finalDataStr,
					},
				},
			}, nil)
			if err != nil {
				return nil, fmt.Errorf("failed to create dashboard block: %w", err)
			}

			return "Dashboard created successfully in the user's current workspace.", nil
		},
	}
}
