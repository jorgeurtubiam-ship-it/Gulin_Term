package aiusechat

import (
	"context"
	"fmt"
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

	db := GetVectorDB()

	// Quick sanity check: if DB is empty, tell the user to index first.
	db.mu.RLock()
	chunkCount := len(db.Chunks)
	db.mu.RUnlock()

	if chunkCount == 0 {
		return nil, fmt.Errorf("the workspace vector database is empty. tell the user to run 'wsh gulin index' in their terminal to scan their project first")
	}

	// Search for top 5 relevant chunks
	results, err := db.Search(ctx, parsed.Query, 5)
	if err != nil {
		return nil, fmt.Errorf("failed to perform semantic search: %w", err)
	}

	if len(results) == 0 {
		return "No relevant code fragments found for this query.", nil
	}

	var output string
	output += fmt.Sprintf("Semantic Search Results for: '%s'\n\n", parsed.Query)
	for i, res := range results {
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
