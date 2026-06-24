// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/wcore"
	"github.com/gulindev/gulin/pkg/wshrpc"
	"github.com/gulindev/gulin/pkg/wshrpc/wshclient"
	"github.com/gulindev/gulin/pkg/wstore"
)

type WebClickToolInput struct {
	WidgetId string `json:"widget_id"`
	Selector string `json:"selector"`
}

func parseWebClickInput(input any) (*WebClickToolInput, error) {
	result := &WebClickToolInput{}

	if input == nil {
		return nil, fmt.Errorf("widget_id and selector are required")
	}

	inputBytes, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal input: %w", err)
	}

	if err := json.Unmarshal(inputBytes, result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal input: %w", err)
	}

	if result.WidgetId == "" {
		return nil, fmt.Errorf("widget_id is required")
	}
	if result.Selector == "" {
		return nil, fmt.Errorf("selector is required")
	}

	return result, nil
}

// GetWebClickToolDefinition returns the tool definition for simulating a click on a web element.
// This tool requires user approval before execution for security reasons.
func GetWebClickToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "web_click",
		DisplayName: "Click Web Element",
		Description: "Simulate a click on a specific element identified by a CSS selector in the web browser widget.",
		ToolLogName: "web:click",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"widget_id": map[string]any{
					"type":        "string",
					"description": "8-character widget ID of the web browser widget",
				},
				"selector": map[string]any{
					"type":        "string",
					"description": "CSS selector of the element to click (e.g., 'button.submit', '#search-input')",
				},
			},
			"required":             []string{"widget_id", "selector"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseWebClickInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("clicking element '%s' in %s", parsed.Selector, parsed.WidgetId)
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			parsed, err := parseWebClickInput(input)
			if err != nil {
				return nil, err
			}

			ctx, cancelFn := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancelFn()

			fullBlockId, err := wcore.ResolveBlockIdFromPrefix(ctx, tabId, parsed.WidgetId)
			if err != nil {
				return nil, err
			}

			workspaceId, err := wstore.DBFindWorkspaceForTabId(ctx, tabId)
			if err != nil {
				return nil, fmt.Errorf("failed to find workspace for tab: %w", err)
			}

			rpcClient := wshclient.GetBareRpcClient()
			err = wshclient.WebClickCommand(
				rpcClient,
				wshrpc.CommandWebClickData{
					WorkspaceId: workspaceId,
					TabId:       tabId,
					BlockId:     fullBlockId,
					Selector:    parsed.Selector,
				},
				&wshrpc.RpcOpts{Route: "electron"},
			)
			if err != nil {
				return nil, fmt.Errorf("failed to click web element: %w", err)
			}
			return "Click successful", nil
		},
		ToolApproval: func(input any, chatOpts uctypes.GulinChatOpts) string {
			return uctypes.ApprovalNeedsApproval
		},
	}
}
