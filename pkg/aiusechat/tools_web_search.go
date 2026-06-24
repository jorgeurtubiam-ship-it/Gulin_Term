package aiusechat

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"time"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/wcore"
	"github.com/gulindev/gulin/pkg/wstore"
	"github.com/gulindev/gulin/pkg/gulinobj"
)

type WebSearchToolInput struct {
	WidgetId string `json:"widget_id"`
	Query    string `json:"query"`
}

func GetWebSearchToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "web_search",
		DisplayName: "Web Search",
		Description: "Perform a web search using Google in a web browser widget. Useful for finding documentation or solving technical problems.",
		ToolLogName: "web:search",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"widget_id": map[string]any{
					"type":        "string",
					"description": "8-character widget ID of the web browser widget to use",
				},
				"query": map[string]any{
					"type":        "string",
					"description": "The search query",
				},
			},
			"required":             []string{"widget_id", "query"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			var parsed WebSearchToolInput
			b, _ := json.Marshal(input)
			json.Unmarshal(b, &parsed)
			return fmt.Sprintf("Web search: %s", parsed.Query)
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			inputBytes, _ := json.Marshal(input)
			var parsed WebSearchToolInput
			json.Unmarshal(inputBytes, &parsed)

			if parsed.WidgetId == "" || parsed.Query == "" {
				return nil, fmt.Errorf("widget_id and query are required")
			}

			searchURL := fmt.Sprintf("https://www.google.com/search?q=%s", url.QueryEscape(parsed.Query))

			ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancelFn()

			fullBlockId, err := wcore.ResolveBlockIdFromPrefix(ctx, tabId, parsed.WidgetId)
			if err != nil {
				return nil, err
			}

			blockORef := gulinobj.MakeORef(gulinobj.OType_Block, fullBlockId)
			meta := map[string]any{
				"url": searchURL,
			}

			err = wstore.UpdateObjectMeta(ctx, blockORef, meta, false)
			if err != nil {
				return nil, fmt.Errorf("failed to update web block URL: %w", err)
			}

			wcore.SendGulinObjUpdate(blockORef)
			return fmt.Sprintf("Searching for '%s' in web widget %s", parsed.Query, parsed.WidgetId), nil
		},
	}
}
