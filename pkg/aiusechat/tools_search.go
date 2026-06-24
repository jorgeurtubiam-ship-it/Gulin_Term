// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/wcore"
	"github.com/gulindev/gulin/pkg/wshrpc"
	"github.com/gulindev/gulin/pkg/wshrpc/wshclient"
)

type TermSearchToolInput struct {
	WidgetId string `json:"widget_id"`
	Pattern  string `json:"pattern"`
	IsFile   bool   `json:"is_file,omitempty"` // If true, search for filenames. If false (default), search for text content.
}

func GetTermSearchToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "term_search",
		DisplayName: "Search Project",
		Description: "Recursively search for text patterns or filenames in the current project directory using the terminal. This is highly efficient for finding where specific features, configs, or variables are defined.",
		ToolLogName: "term:search",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"widget_id": map[string]any{
					"type":        "string",
					"description": "8-character widget ID of the terminal widget to use for execution",
				},
				"pattern": map[string]any{
					"type":        "string",
					"description": "The text pattern or filename to search for",
				},
				"is_file": map[string]any{
					"type":        "boolean",
					"description": "True to search for a filename (uses 'find'), false to search for text inside files (uses 'grep -r')",
				},
				"open_new_pane": map[string]any{
					"type":        "boolean",
					"description": "Historical field ignored by backend. Set to false.",
				},
			},
			"required":             []string{"widget_id", "pattern"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			var parsed TermSearchToolInput
			b, _ := json.Marshal(input)
			json.Unmarshal(b, &parsed)
			if parsed.IsFile {
				return fmt.Sprintf("Search file: %s", parsed.Pattern)
			}
			return fmt.Sprintf("Search text: %s", parsed.Pattern)
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			inputMap, ok := input.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("invalid input")
			}

			widgetId := inputMap["widget_id"].(string)
			pattern := inputMap["pattern"].(string)
			isFile, _ := inputMap["is_file"].(bool)

			var command string
			if isFile {
				command = fmt.Sprintf("find . -maxdepth 4 -name '*%s*' | head -n 20", pattern)
			} else {
				// We use a safe grep that avoids binary files and common giant dirs
				command = fmt.Sprintf("grep -rIl --exclude-dir={.git,node_modules,dist,bin} '%s' . | head -n 20", pattern)
			}

			fullBlockId, err := wcore.ResolveBlockIdFromPrefix(ctx, tabId, widgetId)
			if err != nil {
				return nil, err
			}

			rpcClient := wshclient.GetBareRpcClient()
			b64Data := base64.StdEncoding.EncodeToString([]byte(command + "\n"))

			err = wshclient.ControllerInputCommand(
				rpcClient,
				wshrpc.CommandBlockInputData{
					BlockId:     fullBlockId,
					InputData64: b64Data,
				},
				&wshrpc.RpcOpts{},
			)
			if err != nil {
				return nil, err
			}

			// We wait a moment for the command to produce output
			select {
			case <-time.After(2 * time.Second):
			case <-ctx.Done():
				return nil, ctx.Err()
			}

			// Then we fetch the scrollback to see the result
			scrollback, err := getTermScrollbackOutput(ctx, tabId, widgetId, wshrpc.CommandTermGetScrollbackLinesData{
				LineStart: 0,
				LineEnd:   50,
			})
			if err != nil {
				return nil, fmt.Errorf("command sent but failed to read result: %w", err)
			}

			return scrollback.Content, nil
		},
	}
}
