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

type WebReadPageToolInput struct {
	WidgetId string `json:"widget_id"`
}

func parseWebReadPageInput(input any) (*WebReadPageToolInput, error) {
	result := &WebReadPageToolInput{}

	if input == nil {
		return nil, fmt.Errorf("widget_id is required")
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

	return result, nil
}

// GetWebReadPageToolDefinition returns the tool definition for extracting text content from a web page.
// This tool allows the AI to "read" the visible text of the current web browser widget.
func GetWebReadPageToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "web_read_page",
		DisplayName: "Read Web Page",
		Description: "Extract the text content of a web browser widget. Useful for analyzing page content, finding information, or summarizing articles.",
		ToolLogName: "web:read",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"widget_id": map[string]any{
					"type":        "string",
					"description": "8-character widget ID of the web browser widget",
				},
			},
			"required":             []string{"widget_id"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseWebReadPageInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("reading web page content from %s", parsed.WidgetId)
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			parsed, err := parseWebReadPageInput(input)
			if err != nil {
				return nil, err
			}

			ctx, cancelFn := context.WithTimeout(context.Background(), 15*time.Second)
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
			text, err := wshclient.WebGetTextCommand(
				rpcClient,
				wshrpc.CommandWebGetTextData{
					WorkspaceId: workspaceId,
					TabId:       tabId,
					BlockId:     fullBlockId,
				},
				&wshrpc.RpcOpts{Route: "electron"},
			)
			if err != nil {
				return nil, fmt.Errorf("failed to extract web text: %w", err)
			}
			return text, nil
		},
	}
}
