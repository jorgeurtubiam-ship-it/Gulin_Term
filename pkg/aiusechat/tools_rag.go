package aiusechat

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/util/utilfn"
)

type workspaceSearchInput struct {
	Query string `json:"query"`
}

func parseWorkspaceSearchInput(input any) (*workspaceSearchInput, error) {
	result := &workspaceSearchInput{}
	if input == nil {
		return nil, fmt.Errorf("input is required")
	}
	if err := utilfn.ReUnmarshal(result, input); err != nil {
		return nil, fmt.Errorf("invalid input format: %w", err)
	}
	if result.Query == "" {
		return nil, fmt.Errorf("missing query parameter")
	}
	return result, nil
}

func workspaceSearchCallback(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
	parsed, err := parseWorkspaceSearchInput(input)
	if err != nil {
		return nil, err
	}

	cwd, _ := os.Getwd()
	var allResults []SearchResult

	// 1. Search Local Workspace DB if we are in a workspace
	if IsWorkspace(cwd) {
		if dbWorkspace, err := GetWorkspaceVectorDB(cwd); err == nil {
			res1, err := SearchSemantically(ctx, dbWorkspace, parsed.Query, 5)
			if err == nil {
				allResults = append(allResults, res1...)
			}
		}
	}

	// 2. Search Global DB
	if dbGlobal, err := GetGlobalVectorDB(); err == nil {
		res2, err := SearchSemantically(ctx, dbGlobal, parsed.Query, 5)
		if err == nil {
			allResults = append(allResults, res2...)
		}
	}

	if len(allResults) == 0 {
		return nil, fmt.Errorf("both vector databases are empty. tell the user to run 'wsh gulin index' first")
	}

	// 3. Merge and Sort
	sort.Slice(allResults, func(i, j int) bool {
		return allResults[i].Score > allResults[j].Score
	})

	if len(allResults) > 5 {
		allResults = allResults[:5]
	}

	if len(allResults) == 0 {
		return "No relevant code fragments found for this query.", nil
	}

	var output string
	output += fmt.Sprintf("Semantic Search Results for: '%s'\n\n", parsed.Query)
	for i, res := range allResults {
		output += fmt.Sprintf("--- Result %d (Score: %.2f) ---\n", i+1, res.Score)
		output += fmt.Sprintf("File: %s\n", res.FilePath)
		output += fmt.Sprintf("Content Fragment:\n```\n%s\n```\n\n", res.Content)
	}

	return output, nil
}

func GetWorkspaceSearchToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "workspace_search",
		DisplayName: "Workspace Semantic Search",
		Description: `Search the user's project codebase semantically using natural language. 
Use this when you need to understand how something works, where a concept is implemented, or to find specific context.
Returns up to the 5 most relevant code fragments. 
Requires the user to have previously indexed the workspace via 'wsh gulin index'.`,
		ToolLogName: "gen:workspace_search",
		Strict:      false,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{
					"type":        "string",
					"description": "A natural language query or technical question (e.g. 'how does authentication token expiration work?')",
				},
			},
			"required":             []string{"query"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseWorkspaceSearchInput(input)
			if err != nil {
				return "running semantic search"
			}
			return fmt.Sprintf("searching workspace for %q", parsed.Query)
		},
		ToolAnyCallback: workspaceSearchCallback,
		ToolApproval: func(input any, chatOpts uctypes.GulinChatOpts) string {
			// Read-only tool, auto-approve in ACT mode
			if strings.HasSuffix(chatOpts.Config.AIMode, "@act") {
				return uctypes.ApprovalAutoApproved
			}
			return uctypes.ApprovalNeedsApproval
		},
	}
}
