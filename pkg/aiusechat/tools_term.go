// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/gulinbase"
	"github.com/gulindev/gulin/pkg/gulinobj"
	"github.com/gulindev/gulin/pkg/wcore"
	"github.com/gulindev/gulin/pkg/wshrpc"
	"github.com/gulindev/gulin/pkg/wshrpc/wshclient"
	"github.com/gulindev/gulin/pkg/wshutil"
	"github.com/gulindev/gulin/pkg/wstore"
	"github.com/gulindev/gulin/pkg/util/shellutil"
	"github.com/gulindev/gulin/pkg/util/utilfn"
	"github.com/gulindev/gulin/pkg/web/sse"
)

type TermGetScrollbackToolInput struct {
	WidgetId  string `json:"widget_id"`
	LineStart int    `json:"line_start,omitempty"`
	Count     int    `json:"count,omitempty"`
}

type CommandInfo struct {
	Command  string `json:"command"`
	Status   string `json:"status"`
	ExitCode *int   `json:"exitcode,omitempty"`
}

type TermGetScrollbackToolOutput struct {
	TotalLines         int          `json:"totallines"`
	LineStart          int          `json:"linestart"`
	LineEnd            int          `json:"lineend"`
	ReturnedLines      int          `json:"returnedlines"`
	Content            string       `json:"content"`
	SinceLastOutputSec *int         `json:"sincelastoutputsec,omitempty"`
	HasMore            bool         `json:"hasmore"`
	NextStart          *int         `json:"nextstart"`
	LastCommand        *CommandInfo `json:"lastcommand,omitempty"`
}

func parseTermGetScrollbackInput(ctx context.Context, input any) (*TermGetScrollbackToolInput, error) {
	const (
		DefaultCount          = 20
		DefaultCountMini      = 10
		DefaultCountBalanced  = 30
		DefaultCountMax       = 100
		MaxCount              = 1000
	)

	result := &TermGetScrollbackToolInput{
		LineStart: 0,
		Count:     0,
	}

	tokenMode, _ := ctx.Value(uctypes.TokenModeContextKey).(string)

	if input == nil {
		if tokenMode == uctypes.TokenModeMini {
			result.Count = DefaultCountMini
		} else if tokenMode == uctypes.TokenModeBalanced {
			result.Count = DefaultCountBalanced
		} else if tokenMode == uctypes.TokenModeMax {
			result.Count = DefaultCountMax
		} else {
			result.Count = DefaultCount
		}
		return result, nil
	}

	inputBytes, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal input: %w", err)
	}

	if err := json.Unmarshal(inputBytes, result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal input: %w", err)
	}

	if result.Count == 0 {
		if tokenMode == uctypes.TokenModeMini {
			result.Count = DefaultCountMini
		} else if tokenMode == uctypes.TokenModeBalanced {
			result.Count = DefaultCountBalanced
		} else if tokenMode == uctypes.TokenModeMax {
			result.Count = DefaultCountMax
		} else {
			result.Count = DefaultCount
		}
	}

	if result.Count < 0 {
		return nil, fmt.Errorf("count must be positive")
	}

	result.Count = min(result.Count, MaxCount)

	return result, nil
}

func getTermScrollbackOutput(ctx context.Context, tabId string, widgetId string, rpcData wshrpc.CommandTermGetScrollbackLinesData) (*TermGetScrollbackToolOutput, error) {
	ctx, cancelFn := context.WithTimeout(ctx, 5*time.Second)
	defer cancelFn()

	fullBlockId, err := wcore.ResolveBlockIdFromPrefix(ctx, tabId, widgetId)
	if err != nil {
		return nil, err
	}

	rpcClient := wshclient.GetBareRpcClient()
	result, err := wshclient.TermGetScrollbackLinesCommand(
		rpcClient,
		rpcData,
		&wshrpc.RpcOpts{Route: wshutil.MakeFeBlockRouteId(fullBlockId)},
	)
	if err != nil {
		return nil, err
	}

	lines := result.Lines
	if rpcData.LastCommand && len(lines) > 30 {
		lines = lines[len(lines)-30:]
	}
	content := strings.Join(lines, "\n")
	content = utilfn.StripANSI(content)
	var effectiveLineEnd int
	if rpcData.LastCommand {
		effectiveLineEnd = result.LineStart + len(result.Lines)
	} else {
		effectiveLineEnd = min(rpcData.LineEnd, result.TotalLines)
	}
	hasMore := effectiveLineEnd < result.TotalLines

	// OPTIMIZACIÓN: Si todas las líneas devueltas están vacías, detenemos el 'hasMore' 
	// para evitar que la IA siga pidiendo bloques de historia vacía innecesariamente.
	if len(lines) > 0 {
		allEmpty := true
		for _, line := range lines {
			if strings.TrimSpace(line) != "" {
				allEmpty = false
				break
			}
		}
		if allEmpty {
			hasMore = false
		}
	}

	var sinceLastOutputSec *int
	if result.LastUpdated > 0 {
		sec := max(0, int((time.Now().UnixMilli()-result.LastUpdated)/1000))
		sinceLastOutputSec = &sec
	}

	var nextStart *int
	if hasMore {
		nextStart = &effectiveLineEnd
	}

	blockORef := gulinobj.MakeORef(gulinobj.OType_Block, fullBlockId)
	rtInfo := wstore.GetRTInfo(blockORef)

	var lastCommand *CommandInfo
	if rtInfo != nil && rtInfo.ShellIntegration && rtInfo.ShellLastCmd != "" {
		cmdInfo := &CommandInfo{
			Command: rtInfo.ShellLastCmd,
		}
		if rtInfo.ShellState == "running-command" {
			cmdInfo.Status = "running"
		} else if rtInfo.ShellState == "ready" {
			cmdInfo.Status = "completed"
			exitCode := rtInfo.ShellLastCmdExitCode
			cmdInfo.ExitCode = &exitCode
		}
		lastCommand = cmdInfo
	}

	return &TermGetScrollbackToolOutput{
		TotalLines:         result.TotalLines,
		LineStart:          result.LineStart,
		LineEnd:            effectiveLineEnd,
		ReturnedLines:      len(result.Lines),
		Content:            content,
		SinceLastOutputSec: sinceLastOutputSec,
		HasMore:            hasMore,
		NextStart:          nextStart,
		LastCommand:        lastCommand,
	}, nil
}

func GetTermGetScrollbackToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "term_get_scrollback",
		DisplayName: "Get Terminal Scrollback",
		Description: "Fetch terminal scrollback from a widget as plain text. Index 0 is the most recent line; indices increase going upward (older lines). WARNING: Do NOT use this to read the output of commands you just ran. Use term_command_output instead. If you see HasMore=true, it means there is OLDER history from the past. Do not loop reading next_start unless you specifically want to read the user's historical terminal history.",
		ToolLogName: "term:getscrollback",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"widget_id": map[string]any{
					"type":        "string",
					"description": "8-character widget ID of the terminal widget",
				},
				"line_start": map[string]any{
					"type":        "integer",
					"minimum":     0,
					"description": "Logical start index where 0 = most recent line (default: 0).",
				},
				"count": map[string]any{
					"type":        "integer",
					"minimum":     1,
					"description": "Number of lines to return from line_start (default: 200).",
				},
				"open_new_pane": map[string]any{
					"type":        "boolean",
					"description": "Historical field ignored by backend. Set to false.",
				},
			},
			"required":             []string{"widget_id"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseTermGetScrollbackInput(context.Background(), input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}

			if parsed.LineStart == 0 && parsed.Count == 200 {
				return fmt.Sprintf("reading terminal output from %s (most recent %d lines)", parsed.WidgetId, parsed.Count)
			}
			lineEnd := parsed.LineStart + parsed.Count
			return fmt.Sprintf("reading terminal output from %s (lines %d-%d)", parsed.WidgetId, parsed.LineStart, lineEnd)
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			parsed, err := parseTermGetScrollbackInput(ctx, input)
			if err != nil {
				return nil, err
			}

			lineEnd := parsed.LineStart + parsed.Count
			output, err := getTermScrollbackOutput(
				ctx,
				tabId,
				parsed.WidgetId,
				wshrpc.CommandTermGetScrollbackLinesData{
					LineStart:   parsed.LineStart,
					LineEnd:     lineEnd,
					LastCommand: false,
				},
			)
			if err != nil {
				return nil, fmt.Errorf("failed to get terminal scrollback: %w", err)
			}
			return output, nil
		},
	}
}

type TermCommandOutputToolInput struct {
	WidgetId string `json:"widget_id"`
}

func parseTermCommandOutputInput(input any) (*TermCommandOutputToolInput, error) {
	result := &TermCommandOutputToolInput{}

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

func GetTermCommandOutputToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "term_command_output",
		DisplayName: "Get Last Command Output",
		Description: "Retrieve output from the most recent command in a terminal widget. Requires shell integration to be enabled. Returns the command text, exit code, and up to 1000 lines of output.",
		ToolLogName: "term:commandoutput",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"widget_id": map[string]any{
					"type":        "string",
					"description": "8-character widget ID of the terminal widget to read output from.",
				},
				"open_new_pane": map[string]any{
					"type":        "boolean",
					"description": "Historical field ignored by backend. Set to false.",
				},
			},
			"required":             []string{"widget_id"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseTermCommandOutputInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("reading last command output from %s", parsed.WidgetId)
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			parsed, err := parseTermCommandOutputInput(input)
			if err != nil {
				return nil, err
			}

			fullBlockId, err := wcore.ResolveBlockIdFromPrefix(ctx, tabId, parsed.WidgetId)
			if err != nil {
				return nil, err
			}

			blockORef := gulinobj.MakeORef(gulinobj.OType_Block, fullBlockId)
			rtInfo := wstore.GetRTInfo(blockORef)
			if rtInfo == nil || !rtInfo.ShellIntegration {
				// NOTE: Return a helpful message instead of an error to avoid "red" cards in the UI
				// when shell integration is missing but the command may have actually run.
				return map[string]any{
					"status": "warning",
					"message": "Note: Shell integration is not enabled for this terminal. The command was sent but its exact exit code and structured output could not be captured. You may check the terminal scrollback using term_get_scrollback if needed.",
				}, nil
			}

			output, err := getTermScrollbackOutput(
				ctx,
				tabId,
				parsed.WidgetId,
				wshrpc.CommandTermGetScrollbackLinesData{
					LastCommand: true,
				},
			)
			if err != nil {
				return nil, fmt.Errorf("failed to get command output: %w", err)
			}
			sse.SendDebugLog(ctx, sse.LogCatTerminal, fmt.Sprintf("[TERM] Output captured from %s", parsed.WidgetId))
			return output, nil
		},
	}
}

type TermRunCommandToolInput struct {
	WidgetId    string `json:"widget_id"`
	Command     string `json:"command"`
}

func parseTermRunCommandInput(input any) (*TermRunCommandToolInput, error) {
	result := &TermRunCommandToolInput{}

	if input == nil {
		return nil, fmt.Errorf("widget_id and command are required")
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
	if result.Command == "" {
		return nil, fmt.Errorf("command is required")
	}

	return result, nil
}

func GetTermRunCommandToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "term_run_command",
		DisplayName: "Run Command in Terminal",
		Description: "Execute a command in the specified terminal widget by sending the command string. Always use this instead of asking the user to copy-paste. IMPORTANT: After running a command, you MUST wait for it to finish and use the `term_command_output` tool to read the result. Do NOT use `term_get_scrollback` to read command output.",
		ToolLogName: "term:runcommand",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"widget_id": map[string]any{
					"type":        "string",
					"description": "8-character widget ID of the terminal widget",
				},
				"command": map[string]any{
					"type":        "string",
					"description": "The command string to execute",
				},
				"open_new_pane": map[string]any{
					"type":        "boolean",
					"description": "Historical field ignored by backend. Set to false.",
				},
			},
			"required":             []string{"widget_id", "command"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseTermRunCommandInput(input)
			if err != nil {
				return fmt.Sprintf("error parsing input: %v", err)
			}
			return fmt.Sprintf("running command in %s: %s", parsed.WidgetId, parsed.Command)
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			parsed, err := parseTermRunCommandInput(input)
			if err != nil {
				return nil, err
			}

			fullBlockId, err := wcore.ResolveBlockIdFromPrefix(ctx, tabId, parsed.WidgetId)
			if err != nil {
				return nil, err
			}

			rpcClient := wshclient.GetBareRpcClient()

			blockORef := gulinobj.MakeORef(gulinobj.OType_Block, fullBlockId)
			rtInfo := wstore.GetRTInfo(blockORef)
			block, _ := wstore.DBGet[*gulinobj.Block](ctx, fullBlockId)

			// DECODIFICACIÓN PROTOCOLO ANTI-FIREWALL (PLAI)
			decodedCmd := parsed.Command

			// Determine the correct terminator and normalize newlines
			// Use \r\n as the default universal terminator as it is more likely to trigger execution
			// in interactive shells (like PowerShell) and nested sessions, even if shell detection fails.
			// Most Unix shells translate \r to \n internally (ICRNL), making this safe for bash/zsh as well.
			// We trim any existing terminator from the AI command first.
			cleanCmd := strings.TrimRight(decodedCmd, "\r\n")
			terminator := "\r\n"
			isPowerShell := false
			if rtInfo != nil {
				isPowerShell = (rtInfo.ShellType == "pwsh" || rtInfo.ShellType == "powershell" || rtInfo.ShellType == "cmd")
			} else if block != nil {
				// Fallback: Check block metadata for shell path
				shellPath := block.Meta.GetString(gulinobj.MetaKey_TermLocalShellPath, "")
				if shellPath == "" {
					shellPath = block.Meta.GetString(gulinobj.MetaKey_CmdShell, "")
				}
				if shellPath != "" {
					st := shellutil.GetShellTypeFromShellPath(shellPath)
					isPowerShell = (st == shellutil.ShellType_pwsh || st == shellutil.ShellType_cmd)
				} else if runtime.GOOS == "windows" {
					// Local terminal on Windows without specific shell usually defaults to PowerShell/Cmd
					isPowerShell = (block.Meta.GetString(gulinobj.MetaKey_Connection, "") == "")
				}
			}

			finalCmd := cleanCmd
			if isPowerShell {
				finalCmd = strings.ReplaceAll(finalCmd, "\n", "\r\n")
			}
			cmdWithTerminator := finalCmd + terminator
			b64Data := base64.StdEncoding.EncodeToString([]byte(cmdWithTerminator))

			err = wshclient.ControllerInputCommand(
				rpcClient,
				wshrpc.CommandBlockInputData{
					BlockId:     fullBlockId,
					InputData64: b64Data,
				},
				&wshrpc.RpcOpts{},
			)
			if err != nil {
				return nil, fmt.Errorf("failed to run command in terminal: %w", err)
			}

			// Log the command to ai_history.sh
			historyPath := filepath.Join(gulinbase.GetGulinConfigDir(), "ai_history.sh")
			f, err := os.OpenFile(historyPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
			if err == nil {
				f.WriteString(cleanCmd + "\n")
				f.Close()
			}

			sse.SendDebugLog(ctx, sse.LogCatTerminal, fmt.Sprintf("[TERM] Running command in %s: %s", parsed.WidgetId, cleanCmd))
			return "Command sent to terminal successfully and is running/ran (logged to history).", nil
		},
		ToolApproval: func(input any, chatOpts uctypes.GulinChatOpts) string {
			if strings.Contains(chatOpts.Config.Model, "@plan") {
				return uctypes.ApprovalNeedsApproval
			}
			return uctypes.ApprovalAutoApproved
		},
	}
}

type TermRunAndWaitToolInput struct {
	WidgetId        string `json:"widget_id"`
	Command         string `json:"command"`
	TimeoutSeconds  int    `json:"timeout_seconds,omitempty"`
}

func GetTermRunAndWaitToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "term_run_and_wait",
		DisplayName: "Run Command and Wait",
		Description: "Execute a command in the specified terminal widget and wait for it to complete before returning. Uses shell integration to detect command completion. Returns the full command output, exit code, and status. Use this instead of term_run_command when you need the result immediately without polling.",
		ToolLogName: "term:runandwait",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"widget_id": map[string]any{
					"type":        "string",
					"description": "8-character widget ID of the terminal widget",
				},
				"command": map[string]any{
					"type":        "string",
					"description": "The command string to execute",
				},
				"timeout_seconds": map[string]any{
					"type":        "integer",
					"description": "Maximum time in seconds to wait for the command to complete (default 60, max 3600). Set to -1 for no timeout.",
				},
				"open_new_pane": map[string]any{
					"type":        "boolean",
					"description": "Historical field ignored by backend. Set to false.",
				},
			},
			"required":             []string{"widget_id", "command"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			return "running command and waiting for completion"
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			inputBytes, err := json.Marshal(input)
			if err != nil {
				return nil, fmt.Errorf("failed to marshal input: %w", err)
			}
			parsed := &TermRunAndWaitToolInput{}
			if err := json.Unmarshal(inputBytes, parsed); err != nil {
				return nil, fmt.Errorf("failed to unmarshal input: %w", err)
			}
			if parsed.WidgetId == "" || parsed.Command == "" {
				return nil, fmt.Errorf("widget_id and command are required")
			}

			fullBlockId, err := wcore.ResolveBlockIdFromPrefix(ctx, tabId, parsed.WidgetId)
			if err != nil {
				return nil, err
			}

			rpcClient := wshclient.GetBareRpcClient()
			blockORef := gulinobj.MakeORef(gulinobj.OType_Block, fullBlockId)
			rtInfo := wstore.GetRTInfo(blockORef)
			block, _ := wstore.DBGet[*gulinobj.Block](ctx, fullBlockId)

			// Build command with proper terminator
			cleanCmd := strings.TrimRight(parsed.Command, "\r\n")
			terminator := "\r\n"
			isPowerShell := false
			if rtInfo != nil {
				isPowerShell = (rtInfo.ShellType == "pwsh" || rtInfo.ShellType == "powershell" || rtInfo.ShellType == "cmd")
			} else if block != nil {
				shellPath := block.Meta.GetString(gulinobj.MetaKey_TermLocalShellPath, "")
				if shellPath == "" {
					shellPath = block.Meta.GetString(gulinobj.MetaKey_CmdShell, "")
				}
				if shellPath != "" {
					st := shellutil.GetShellTypeFromShellPath(shellPath)
					isPowerShell = (st == shellutil.ShellType_pwsh || st == shellutil.ShellType_cmd)
				} else if runtime.GOOS == "windows" {
					isPowerShell = (block.Meta.GetString(gulinobj.MetaKey_Connection, "") == "")
				}
			}

			finalCmd := cleanCmd
			if isPowerShell {
				finalCmd = strings.ReplaceAll(finalCmd, "\n", "\r\n")
			}
			cmdWithTerminator := finalCmd + terminator
			b64Data := base64.StdEncoding.EncodeToString([]byte(cmdWithTerminator))

			err = wshclient.ControllerInputCommand(
				rpcClient,
				wshrpc.CommandBlockInputData{
					BlockId:     fullBlockId,
					InputData64: b64Data,
				},
				&wshrpc.RpcOpts{},
			)
			if err != nil {
				return nil, fmt.Errorf("failed to run command: %w", err)
			}

			// Log command
			historyPath := filepath.Join(gulinbase.GetGulinConfigDir(), "ai_history.sh")
			f, err := os.OpenFile(historyPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
			if err == nil {
				defer f.Close()
				f.WriteString(cleanCmd + "\n")
			}

			sse.SendDebugLog(ctx, sse.LogCatTerminal, fmt.Sprintf("[TERM] Running command in %s (wait): %s", parsed.WidgetId, cleanCmd))

			// Determine timeout (default 60s)
			maxWaitSec := 60
			if parsed.TimeoutSeconds > 0 && parsed.TimeoutSeconds <= 3600 {
				maxWaitSec = parsed.TimeoutSeconds
			}
			if parsed.TimeoutSeconds == -1 {
				maxWaitSec = 86400 // 24h
			}

			deadline := time.Now().Add(time.Duration(maxWaitSec) * time.Second)
			pollInterval := 500 * time.Millisecond

			for time.Now().Before(deadline) {
				rtInfo = wstore.GetRTInfo(blockORef)
				if rtInfo != nil && rtInfo.ShellState != "running-command" && rtInfo.ShellLastCmd != "" {
					// Command finished, get output
					output, err := getTermScrollbackOutput(
						ctx,
						tabId,
						parsed.WidgetId,
						wshrpc.CommandTermGetScrollbackLinesData{
							LastCommand: true,
						},
					)
					if err != nil {
						return map[string]any{
							"status":   "done",
							"exitcode": rtInfo.ShellLastCmdExitCode,
							"output":   "",
							"error":    fmt.Sprintf("command completed but failed to get output: %v", err),
						}, nil
					}

					sse.SendDebugLog(ctx, sse.LogCatTerminal, fmt.Sprintf("[TERM] Command completed in %s (exit=%d, %d lines)", parsed.WidgetId, rtInfo.ShellLastCmdExitCode, output.ReturnedLines))

					return map[string]any{
						"status":        "done",
						"exitcode":      rtInfo.ShellLastCmdExitCode,
						"output":        output.Content,
						"returnedlines": output.ReturnedLines,
						"totallines":    output.TotalLines,
					}, nil
				}

				time.Sleep(pollInterval)

				if ctx.Err() != nil {
					return map[string]any{
						"status":  "cancelled",
						"message": "request was cancelled",
					}, nil
				}
			}

			// Timeout
			rtInfo = wstore.GetRTInfo(blockORef)
			currentStatus := "unknown"
			if rtInfo != nil {
				currentStatus = rtInfo.ShellState
			}
			return map[string]any{
				"status":  "timeout",
				"message": fmt.Sprintf("command did not complete within %d seconds (status: %s)", maxWaitSec, currentStatus),
			}, nil
		},
	}
}

