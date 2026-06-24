// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"fmt"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/wcore"
	"github.com/gulindev/gulin/pkg/wshrpc"
	"github.com/gulindev/gulin/pkg/wshrpc/wshclient"
	"github.com/gulindev/gulin/pkg/wshutil"
)

func makeTabCaptureBlockScreenshot(tabId string) func(context.Context, any) (string, error) {
	return func(ctx context.Context, input any) (string, error) {
		inputMap, ok := input.(map[string]any)
		if !ok {
			return "", fmt.Errorf("invalid input format")
		}

		blockIdPrefix, ok := inputMap["widget_id"].(string)
		if !ok {
			return "", fmt.Errorf("missing or invalid widget_id parameter")
		}

		fullBlockId, err := wcore.ResolveBlockIdFromPrefix(ctx, tabId, blockIdPrefix)
		if err != nil {
			return "", err
		}

		rpcClient := wshclient.GetBareRpcClient()
		screenshotData, err := wshclient.CaptureBlockScreenshotCommand(
			rpcClient,
			wshrpc.CommandCaptureBlockScreenshotData{BlockId: fullBlockId},
			&wshrpc.RpcOpts{Route: wshutil.MakeTabRouteId(tabId)},
		)
		if err != nil {
			return "", fmt.Errorf("failed to capture screenshot: %w", err)
		}

		return screenshotData, nil
	}
}

func GetCaptureScreenshotToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "capture_screenshot",
		DisplayName: "Capture Screenshot",
		Description: "Capture a screenshot of a widget and return it as an image",
		ToolLogName: "gen:screenshot",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"widget_id": map[string]any{
					"type":        "string",
					"description": "8-character widget ID of the widget to screenshot",
				},
			},
			"required":             []string{"widget_id"},
			"additionalProperties": false,
		},
		RequiredCapabilities: []string{uctypes.AICapabilityImages},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			inputMap, ok := input.(map[string]any)
			if !ok {
				return "error parsing input: invalid format"
			}
			widgetId, ok := inputMap["widget_id"].(string)
			if !ok {
				return "error parsing input: missing widget_id"
			}
			return fmt.Sprintf("capturing screenshot of widget %s", widgetId)
		},
		ToolTextCallback: makeTabCaptureBlockScreenshot(tabId),
	}
}
