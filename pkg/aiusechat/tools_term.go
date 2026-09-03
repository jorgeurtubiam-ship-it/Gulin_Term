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
	if rpcData.LastCommand && len(lines) > 200 {
		lines = lines[len(lines)-200:]
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

			output, err := getTermScrollbackOutput(
				ctx,
				tabId,
				parsed.WidgetId,
				wshrpc.CommandTermGetScrollbackLinesData{
					LastCommand: true,
				},
			)
			if err != nil {
				// Fallback to reading the recent lines from terminal screen
				output, err = getTermScrollbackOutput(
					ctx,
					tabId,
					parsed.WidgetId,
					wshrpc.CommandTermGetScrollbackLinesData{
						LineStart:   0,
						LineEnd:     100,
						LastCommand: false,
					},
				)
				if err != nil {
					return nil, fmt.Errorf("failed to get command output: %w", err)
				}
			}

			sse.SendDebugLog(ctx, sse.LogCatTerminal, fmt.Sprintf("[TERM] Output captured from %s", parsed.WidgetId))
			if rtInfo == nil || !rtInfo.ShellIntegration {
				return map[string]any{
					"status":        "completed",
					"output":        output.Content,
					"returnedlines": output.ReturnedLines,
					"totallines":    output.TotalLines,
					"message":       "Output read directly from terminal buffer (shell integration not active).",
				}, nil
			}
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

// ParseSignalToBytes maps signal/key strings to raw ASCII control bytes.
func ParseSignalToBytes(signal string) ([]byte, string, error) {
	norm := strings.ToLower(strings.TrimSpace(signal))
	switch norm {
	case "ctrl+c", "ctrl-c", "ctrl c", "^c", "sigint", "interrupt":
		return []byte("\x03"), "SIGINT (Ctrl+C)", nil
	case "ctrl+z", "ctrl-z", "ctrl z", "^z", "sigtstp", "suspend":
		return []byte("\x1a"), "SIGTSTP (Ctrl+Z)", nil
	case "ctrl+d", "ctrl-d", "ctrl d", "^d", "eof", "eot":
		return []byte("\x04"), "EOF / EOT (Ctrl+D)", nil
	case "ctrl+\\", "ctrl-\\", "ctrl \\", "^\\", "sigquit", "quit":
		return []byte("\x1c"), "SIGQUIT (Ctrl+\\)", nil
	case "escape", "esc", "^[", "\x1b":
		return []byte("\x1b"), "ESCAPE (ESC)", nil
	case "enter", "cr", "return", "\r\n", "\n":
		return []byte("\r\n"), "ENTER / RETURN", nil
	case "ctrl+l", "ctrl-l", "ctrl l", "^l", "clear":
		return []byte("\x0c"), "FORM FEED (Ctrl+L)", nil
	case "ctrl+u", "ctrl-u", "ctrl u", "^u":
		return []byte("\x15"), "ERASE LINE (Ctrl+U)", nil
	default:
		if len(signal) == 1 && signal[0] < 32 {
			return []byte(signal), fmt.Sprintf("RAW_CONTROL (0x%02x)", signal[0]), nil
		}
		return nil, "", fmt.Errorf("unknown signal or control key '%s'. Supported: ctrl+c (SIGINT), ctrl+z (SIGTSTP), ctrl+d (EOF), escape, enter, ctrl+\\ (SIGQUIT), ctrl+l, ctrl+u", signal)
	}
}

// TryParseControlKey checks if a command string represents an ASCII control key or signal.
func TryParseControlKey(cmd string) ([]byte, string, bool) {
	trimmed := strings.TrimSpace(cmd)
	rawBytes, desc, err := ParseSignalToBytes(trimmed)
	if err == nil {
		return rawBytes, desc, true
	}
	return nil, "", false
}

func sanitizeAndValidateCommand(cmd string, block *gulinobj.Block) (string, error) {
	trimmed := strings.TrimSpace(cmd)
	if trimmed == "" {
		return "", fmt.Errorf("command is empty")
	}

	// 1. Guard contra 'exit' / 'logout' en la shell local
	hasConnection := false
	if block != nil && block.Meta != nil {
		conn, ok := block.Meta["connection"].(string)
		if ok && strings.TrimSpace(conn) != "" {
			hasConnection = true
		}
	}

	if !hasConnection {
		lower := strings.ToLower(trimmed)
		if lower == "exit" || lower == "logout" || strings.HasPrefix(lower, "exit ") || strings.HasPrefix(lower, "logout ") || strings.HasPrefix(lower, "exit;") || strings.HasPrefix(lower, "logout;") {
			return "", fmt.Errorf("SEGURIDAD: Queda terminantemente PROHIBIDO ejecutar 'exit' o 'logout' en la terminal local del usuario porque mataría su sesión y cerraría la ventana. Si deseas salir de un proceso o limpiar la línea, usa Ctrl+C")
		}
	}

	// 2. Validación de balanceo de comillas básicas para evitar prompt secundario (dquote> / quote>)
	doubleQuotes := 0
	singleQuotes := 0
	escaped := false
	for i := 0; i < len(trimmed); i++ {
		c := trimmed[i]
		if escaped {
			escaped = false
			continue
		}
		if c == '\\' {
			escaped = true
			continue
		}
		if c == '"' && singleQuotes%2 == 0 {
			doubleQuotes++
		} else if c == '\'' && doubleQuotes%2 == 0 {
			singleQuotes++
		}
	}

	result := trimmed
	// Auto-completar comilla faltante si quedó truncada al final
	if doubleQuotes%2 != 0 {
		result += "\""
	} else if singleQuotes%2 != 0 {
		result += "'"
	}

	return result, nil
}

func isTerminalInSecondaryPrompt(content string) bool {
	lines := strings.Split(strings.TrimSpace(content), "\n")
	if len(lines) == 0 {
		return false
	}
	lastLine := strings.TrimSpace(lines[len(lines)-1])
	secondaryPrompts := []string{
		"heredoc>", "quote>", "dquote>", "subst>", "bquote>", "pipe>", "cmdsubst>", "cursh>", "array>", "then>", "do>", "else>",
	}
	for _, sp := range secondaryPrompts {
		if strings.HasSuffix(lastLine, sp) || strings.Contains(lastLine, sp) {
			return true
		}
	}
	return false
}

func GetTermRunCommandToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "term_run_command",
		DisplayName: "Run Daemon/Background Command in Terminal",
		Description: "DEPRECATED / DAEMON ONLY: Execute a command asynchronously in background without waiting. WARNING: DO NOT USE THIS TOOL for normal commands, scripts, or diagnostics where you need the output or need to wait. USE 'term_run_and_wait' INSTEAD. Only use 'term_run_command' for long-running daemons or background servers that never exit.",
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
			return fmt.Sprintf("running daemon in %s: %s", parsed.WidgetId, parsed.Command)
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			if ctx.Err() != nil {
				return nil, fmt.Errorf("command execution cancelled")
			}
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

			// AUTO-INTERCEPCIÓN: Si el comando es una señal o tecla de control (ej: 'ctrl+c', '^c', 'ctrl+z'), enviar el byte binario directo
			if rawBytes, sigDesc, isControl := TryParseControlKey(parsed.Command); isControl {
				b64Data := base64.StdEncoding.EncodeToString(rawBytes)
				err = wshclient.ControllerInputCommand(
					rpcClient,
					wshrpc.CommandBlockInputData{
						BlockId:     fullBlockId,
						InputData64: b64Data,
					},
					&wshrpc.RpcOpts{},
				)
				if err != nil {
					return nil, fmt.Errorf("failed to send signal %s: %w", sigDesc, err)
				}
				sse.SendDebugLog(ctx, sse.LogCatTerminal, fmt.Sprintf("[TERM] Sent signal %s to %s", sigDesc, parsed.WidgetId))
				return fmt.Sprintf("Signal %s sent to terminal successfully.", sigDesc), nil
			}

			validatedCmd, err := sanitizeAndValidateCommand(parsed.Command, block)
			if err != nil {
				return nil, err
			}

			// DECODIFICACIÓN PROTOCOLO ANTI-FIREWALL (PLAI)
			decodedCmd := validatedCmd

			cleanCmd := strings.TrimRight(decodedCmd, "\r\n")
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
			// AUTO-LIBERACIÓN: Si la terminal está bloqueada en un prompt secundario (ej: heredoc>, quote>, dquote>),
			// enviar Ctrl+C (\x03) para liberar el prompt antes de escribir el nuevo comando
			if lastOutput, err := getTermScrollbackOutput(ctx, tabId, parsed.WidgetId, wshrpc.CommandTermGetScrollbackLinesData{LineStart: 0, LineEnd: 5, LastCommand: false}); err == nil && lastOutput != nil {
				if isTerminalInSecondaryPrompt(lastOutput.Content) {
					sse.SendDebugLog(ctx, sse.LogCatTerminal, fmt.Sprintf("[TERM] Secondary prompt detected in %s (heredoc/quote), sending Ctrl+C to recover prompt", parsed.WidgetId))
					ctrlC := base64.StdEncoding.EncodeToString([]byte("\x03"))
					_ = wshclient.ControllerInputCommand(
						rpcClient,
						wshrpc.CommandBlockInputData{
							BlockId:     fullBlockId,
							InputData64: ctrlC,
						},
						&wshrpc.RpcOpts{},
					)
					time.Sleep(150 * time.Millisecond)
				}
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

			sse.SendDebugLog(ctx, sse.LogCatTerminal, fmt.Sprintf("[TERM] Running daemon in %s: %s", parsed.WidgetId, cleanCmd))
			return "Daemon command sent to terminal successfully and is running in background.", nil
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
		DisplayName: "Run Command and Wait for Output",
		Description: "PRIMARY COMMAND TOOL: Execute a command in the specified terminal widget and WAIT for it to complete before returning. Returns the full command output, exit code, and status. ALWAYS use this tool for all commands, queries, scripts, and diagnostics.",
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
					"description": "Maximum time in seconds to wait for the command to complete (default 120, max 3600). Set to -1 for no timeout.",
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
			if ctx.Err() != nil {
				return nil, fmt.Errorf("command execution cancelled")
			}
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

			// AUTO-INTERCEPCIÓN: Si el comando es una señal o tecla de control (ej: 'ctrl+c', '^c', 'ctrl+z'), enviar el byte binario directo
			if rawBytes, sigDesc, isControl := TryParseControlKey(parsed.Command); isControl {
				b64Data := base64.StdEncoding.EncodeToString(rawBytes)
				err = wshclient.ControllerInputCommand(
					rpcClient,
					wshrpc.CommandBlockInputData{
						BlockId:     fullBlockId,
						InputData64: b64Data,
					},
					&wshrpc.RpcOpts{},
				)
				if err != nil {
					return nil, fmt.Errorf("failed to send signal %s: %w", sigDesc, err)
				}
				sse.SendDebugLog(ctx, sse.LogCatTerminal, fmt.Sprintf("[TERM] Sent signal %s to %s", sigDesc, parsed.WidgetId))
				return map[string]any{
					"status":  "done",
					"message": fmt.Sprintf("Signal %s sent to terminal successfully.", sigDesc),
				}, nil
			}

			validatedCmd, err := sanitizeAndValidateCommand(parsed.Command, block)
			if err != nil {
				return nil, err
			}

			// Build command with proper terminator
			cleanCmd := strings.TrimRight(validatedCmd, "\r\n")
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
			// AUTO-LIBERACIÓN: Si la terminal está bloqueada en un prompt secundario (ej: heredoc>, quote>, dquote>),
			// enviar Ctrl+C (\x03) para liberar el prompt antes de escribir el nuevo comando
			if lastOutput, err := getTermScrollbackOutput(ctx, tabId, parsed.WidgetId, wshrpc.CommandTermGetScrollbackLinesData{LineStart: 0, LineEnd: 5, LastCommand: false}); err == nil && lastOutput != nil {
				if isTerminalInSecondaryPrompt(lastOutput.Content) {
					sse.SendDebugLog(ctx, sse.LogCatTerminal, fmt.Sprintf("[TERM] Secondary prompt detected in %s (heredoc/quote), sending Ctrl+C to recover prompt", parsed.WidgetId))
					ctrlC := base64.StdEncoding.EncodeToString([]byte("\x03"))
					_ = wshclient.ControllerInputCommand(
						rpcClient,
						wshrpc.CommandBlockInputData{
							BlockId:     fullBlockId,
							InputData64: ctrlC,
						},
						&wshrpc.RpcOpts{},
					)
					time.Sleep(150 * time.Millisecond)
				}
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

			// Determine timeout (default 120s)
			maxWaitSec := 120
			if parsed.TimeoutSeconds > 0 && parsed.TimeoutSeconds <= 3600 {
				maxWaitSec = parsed.TimeoutSeconds
			}
			if parsed.TimeoutSeconds == -1 {
				maxWaitSec = 86400 // 24h
			}

			deadline := time.Now().Add(time.Duration(maxWaitSec) * time.Second)
			pollInterval := 100 * time.Millisecond

			// Check if shell integration is active
			hasShellIntegration := rtInfo != nil && rtInfo.ShellIntegration

			if !hasShellIntegration {
				// TERMINAL SIN SHELL INTEGRATION (ej. zsh estándar, ssh):
				// Obtenemos el snapshot inicial del scrollback
				initialOutput, _ := getTermScrollbackOutput(ctx, tabId, parsed.WidgetId, wshrpc.CommandTermGetScrollbackLinesData{LineStart: 0, LineEnd: 50, LastCommand: false})
				initialContent := ""
				if initialOutput != nil {
					initialContent = initialOutput.Content
				}

				// Esperamos a que el comando ejecute y estabilice su salida
				stabilizeDeadline := time.Now().Add(time.Duration(maxWaitSec) * time.Second)
				lastSeenContent := initialContent
				lastChangedTime := time.Now()
				hasChanged := false
				minWaitDeadline := time.Now().Add(1000 * time.Millisecond)

				for time.Now().Before(stabilizeDeadline) {
					if ctx.Err() != nil {
						ctrlC := base64.StdEncoding.EncodeToString([]byte("\x03"))
						_ = wshclient.ControllerInputCommand(
							rpcClient,
							wshrpc.CommandBlockInputData{
								BlockId:     fullBlockId,
								InputData64: ctrlC,
							},
							&wshrpc.RpcOpts{},
						)
						return map[string]any{
							"status":  "cancelled",
							"message": "command execution was cancelled by user",
						}, nil
					}

					time.Sleep(pollInterval)
					currentOutput, err := getTermScrollbackOutput(ctx, tabId, parsed.WidgetId, wshrpc.CommandTermGetScrollbackLinesData{LineStart: 0, LineEnd: 50, LastCommand: false})
					if err == nil && currentOutput != nil {
						if currentOutput.Content != lastSeenContent {
							lastSeenContent = currentOutput.Content
							lastChangedTime = time.Now()
							hasChanged = true
						} else if hasChanged && time.Now().After(minWaitDeadline) && time.Since(lastChangedTime) >= 800*time.Millisecond {
							// La salida cambió y se ha mantenido estable por 800ms -> comando finalizado
							break
						} else if !hasChanged && time.Now().After(minWaitDeadline) && time.Since(lastChangedTime) >= 2500*time.Millisecond {
							// No hubo cambio luego de 2.5s -> comando silencioso o finalizado
							break
						}
					}
				}

				finalOutput, _ := getTermScrollbackOutput(ctx, tabId, parsed.WidgetId, wshrpc.CommandTermGetScrollbackLinesData{LineStart: 0, LineEnd: 50, LastCommand: false})
				outputContent := ""
				returnedLines := 0
				totalLines := 0
				if finalOutput != nil {
					outputContent = finalOutput.Content
					returnedLines = finalOutput.ReturnedLines
					totalLines = finalOutput.TotalLines
				}

				sse.SendDebugLog(ctx, sse.LogCatTerminal, fmt.Sprintf("[TERM] Output captured in %s (%d lines, no shell integration)", parsed.WidgetId, returnedLines))
				return map[string]any{
					"status":        "done",
					"output":        outputContent,
					"returnedlines": returnedLines,
					"totallines":    totalLines,
					"note":          "Captured directly from terminal screen buffer.",
				}, nil
			}

			// TERMINAL CON SHELL INTEGRATION ACTIVA:
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

				if ctx.Err() != nil {
					// Enviar señal Ctrl+C (\x03) al terminal para matar el proceso activo
					ctrlC := base64.StdEncoding.EncodeToString([]byte("\x03"))
					_ = wshclient.ControllerInputCommand(
						rpcClient,
						wshrpc.CommandBlockInputData{
							BlockId:     fullBlockId,
							InputData64: ctrlC,
						},
						&wshrpc.RpcOpts{},
					)
					return map[string]any{
						"status":  "cancelled",
						"message": "command execution was cancelled by user (Ctrl+C sent to terminal)",
					}, nil
				}

				time.Sleep(pollInterval)
			}

			// Timeout - Enviar Ctrl+C para liberar el terminal
			ctrlC := base64.StdEncoding.EncodeToString([]byte("\x03"))
			_ = wshclient.ControllerInputCommand(
				rpcClient,
				wshrpc.CommandBlockInputData{
					BlockId:     fullBlockId,
					InputData64: ctrlC,
				},
				&wshrpc.RpcOpts{},
			)

			rtInfo = wstore.GetRTInfo(blockORef)
			currentStatus := "unknown"
			if rtInfo != nil {
				currentStatus = rtInfo.ShellState
			}
			return map[string]any{
				"status":  "timeout",
				"message": fmt.Sprintf("command did not complete within %d seconds (status: %s, Ctrl+C sent to recover prompt)", maxWaitSec, currentStatus),
			}, nil
		},
	}
}

type TermSendSignalToolInput struct {
	WidgetId string `json:"widget_id"`
	Signal   string `json:"signal"`
}

func parseTermSendSignalInput(input any) (*TermSendSignalToolInput, error) {
	result := &TermSendSignalToolInput{}
	if input == nil {
		return nil, fmt.Errorf("widget_id and signal are required")
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
	if result.Signal == "" {
		return nil, fmt.Errorf("signal is required (e.g. 'ctrl+c', 'ctrl+z', 'ctrl+d', 'escape')")
	}

	return result, nil
}

func GetTermSendSignalToolDefinition(tabId string) uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "term_send_signal",
		DisplayName: "Send Control Signal or Key to Terminal",
		Description: "Send raw ASCII control characters or POSIX signals directly to a terminal process. Use this tool to cancel stuck commands ('ctrl+c' / 'SIGINT'), suspend jobs ('ctrl+z' / 'SIGTSTP'), exit interactive prompts ('ctrl+d' / 'EOF'), or send Escape ('escape').",
		ToolLogName: "term:sendsignal",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"widget_id": map[string]any{
					"type":        "string",
					"description": "8-character widget ID of the terminal widget",
				},
				"signal": map[string]any{
					"type":        "string",
					"description": "The control signal or key combination to send (e.g. 'ctrl+c', 'ctrl+z', 'ctrl+d', 'escape', 'enter', 'ctrl+\\')",
				},
				"open_new_pane": map[string]any{
					"type":        "boolean",
					"description": "Historical field ignored by backend. Set to false.",
				},
			},
			"required":             []string{"widget_id", "signal"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			parsed, err := parseTermSendSignalInput(input)
			if err != nil {
				return "sending signal to terminal"
			}
			return fmt.Sprintf("sending signal %s to %s", parsed.Signal, parsed.WidgetId)
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			if ctx.Err() != nil {
				return nil, fmt.Errorf("signal execution cancelled")
			}
			parsed, err := parseTermSendSignalInput(input)
			if err != nil {
				return nil, err
			}

			rawBytes, sigDesc, err := ParseSignalToBytes(parsed.Signal)
			if err != nil {
				return nil, err
			}

			fullBlockId, err := wcore.ResolveBlockIdFromPrefix(ctx, tabId, parsed.WidgetId)
			if err != nil {
				return nil, err
			}

			rpcClient := wshclient.GetBareRpcClient()
			b64Data := base64.StdEncoding.EncodeToString(rawBytes)

			err = wshclient.ControllerInputCommand(
				rpcClient,
				wshrpc.CommandBlockInputData{
					BlockId:     fullBlockId,
					InputData64: b64Data,
				},
				&wshrpc.RpcOpts{},
			)
			if err != nil {
				return nil, fmt.Errorf("failed to send signal to terminal: %w", err)
			}

			sse.SendDebugLog(ctx, sse.LogCatTerminal, fmt.Sprintf("[TERM] Signal %s sent to %s", sigDesc, parsed.WidgetId))
			return fmt.Sprintf("Signal %s sent to terminal %s successfully.", sigDesc, parsed.WidgetId), nil
		},
		ToolApproval: func(input any, chatOpts uctypes.GulinChatOpts) string {
			return uctypes.ApprovalAutoApproved
		},
	}
}

