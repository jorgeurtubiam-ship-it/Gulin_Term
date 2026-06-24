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

type WebTypeToolInput struct {
	WidgetId string `json:"widget_id"`
	Selector string `json:"selector"`
	Text     string `json:"text"`
}

func parseWebTypeInput(input any) (*WebTypeToolInput, error) {
	result := &WebTypeToolInput{}

	if input == nil {
		return nil, fmt.Errorf("widget_id, selector and text are required")
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
	if result.Text == "" {
		return nil, fmt.Errorf("text is required")
	}

	return result, nil
}

// GetWebTypeToolDefinition returns the tool definition for typing text into a web element.
// This tool requires user approval before execution for security reasons.
func GetWebTypeToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "web_type",
		DisplayName: "Type Text in Web Element",
		Description: "Type text into a specific input or textarea element identified by a CSS selector in the web browser widget.",
		ToolLogName: "web:type",
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
					"description": "CSS selector of the element to type into (e.g., 'input.username', '#search-input')",
				},
				"text": map[string]any{
					"type":        "string",
					"description": "The text to type into the element",
				},
			},
			"required":             []string{"widget_id", "selector", "text"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseWebTypeInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("typing text in element '%s' in %s", parsed.Selector, parsed.WidgetId)
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			parsed, err := parseWebTypeInput(input)
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
			err = wshclient.WebTypeCommand(
				rpcClient,
				wshrpc.CommandWebTypeData{
					WorkspaceId: workspaceId,
					TabId:       tabId,
					BlockId:     fullBlockId,
					Selector:    parsed.Selector,
					Text:        parsed.Text,
				},
				&wshrpc.RpcOpts{Route: "electron"},
			)
			if err != nil {
				return nil, fmt.Errorf("failed to type in web element: %w", err)
			}
			return "Text entered successfully", nil
		},
		ToolApproval: func(input any, chatOpts uctypes.GulinChatOpts) string {
			return uctypes.ApprovalNeedsApproval
		},
	}
}
