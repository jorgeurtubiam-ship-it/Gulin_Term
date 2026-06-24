// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiutil

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/util/utilfn"
	"github.com/gulindev/gulin/pkg/wcore"
	"github.com/gulindev/gulin/pkg/web/sse"
)

// ExtractXmlAttribute extracts an attribute value from an XML-like tag.
// Expects double-quoted strings where internal quotes are encoded as &quot;.
// Returns the unquoted value and true if found, or empty string and false if not found or invalid.
func ExtractXmlAttribute(tag, attrName string) (string, bool) {
	attrStart := strings.Index(tag, attrName+"=")
	if attrStart == -1 {
		return "", false
	}

	pos := attrStart + len(attrName+"=")
	start := strings.Index(tag[pos:], `"`)
	if start == -1 {
		return "", false
	}
	start += pos

	end := strings.Index(tag[start+1:], `"`)
	if end == -1 {
		return "", false
	}
	end += start + 1

	quotedValue := tag[start : end+1]
	value, err := strconv.Unquote(quotedValue)
	if err != nil {
		return "", false
	}

	value = strings.ReplaceAll(value, "&quot;", `"`)
	return value, true
}

// GenerateDeterministicSuffix creates an 8-character hash from input strings
func GenerateDeterministicSuffix(inputs ...string) string {
	hasher := sha256.New()
	for _, input := range inputs {
		hasher.Write([]byte(input))
	}
	hash := hasher.Sum(nil)
	return hex.EncodeToString(hash)[:8]
}

// ExtractImageUrl extracts an image URL from either URL field (http/https/data) or raw Data
func ExtractImageUrl(data []byte, url, mimeType string) (string, error) {
	if url != "" {
		if !strings.HasPrefix(url, "data:") &&
			!strings.HasPrefix(url, "http://") &&
			!strings.HasPrefix(url, "https://") {
			return "", fmt.Errorf("unsupported URL protocol in file part: %s", url)
		}
		return url, nil
	}
	if len(data) > 0 {
		base64Data := base64.StdEncoding.EncodeToString(data)
		return fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data), nil
	}
	return "", fmt.Errorf("file part missing both url and data")
}

// ExtractTextData extracts text data from either Data field or URL field (data: URLs only)
func ExtractTextData(data []byte, url string) ([]byte, error) {
	if len(data) > 0 {
		return data, nil
	}
	if url != "" {
		if strings.HasPrefix(url, "data:") {
			_, decodedData, err := utilfn.DecodeDataURL(url)
			if err != nil {
				return nil, fmt.Errorf("failed to decode data URL for text/plain file: %w", err)
			}
			return decodedData, nil
		}
		return nil, fmt.Errorf("dropping text/plain file with URL (must be fetched and converted to data)")
	}
	return nil, fmt.Errorf("text/plain file part missing data")
}

// FormatAttachedTextFile formats a text file attachment with proper encoding and deterministic suffix
func FormatAttachedTextFile(fileName string, textContent []byte) string {
	if fileName == "" {
		fileName = "untitled.txt"
	}

	encodedFileName := strings.ReplaceAll(fileName, `"`, "&quot;")
	quotedFileName := strconv.Quote(encodedFileName)

	textStr := string(textContent)
	deterministicSuffix := GenerateDeterministicSuffix(textStr, fileName)
	return fmt.Sprintf("<AttachedTextFile_%s file_name=%s>\n%s\n</AttachedTextFile_%s>", deterministicSuffix, quotedFileName, textStr, deterministicSuffix)
}

// FormatAttachedDirectoryListing formats a directory listing attachment with proper encoding and deterministic suffix
func FormatAttachedDirectoryListing(directoryName, jsonContent string) string {
	if directoryName == "" {
		directoryName = "unnamed-directory"
	}

	encodedDirName := strings.ReplaceAll(directoryName, `"`, "&quot;")
	quotedDirName := strconv.Quote(encodedDirName)

	deterministicSuffix := GenerateDeterministicSuffix(jsonContent, directoryName)
	return fmt.Sprintf("<AttachedDirectoryListing_%s directory_name=%s>\n%s\n</AttachedDirectoryListing_%s>", deterministicSuffix, quotedDirName, jsonContent, deterministicSuffix)
}

// ConvertDataUserFile converts OpenAI attached file/directory blocks to UIMessagePart
// Returns (found, part) where found indicates if the prefix was matched,
// and part is the converted UIMessagePart (can be nil if parsing failed)
func ConvertDataUserFile(blockText string) (bool, *uctypes.UIMessagePart) {
	if strings.HasPrefix(blockText, "<AttachedTextFile_") {
		openTagEnd := strings.Index(blockText, "\n")
		if openTagEnd == -1 || blockText[openTagEnd-1] != '>' {
			return true, nil
		}

		openTag := blockText[:openTagEnd]
		fileName, ok := ExtractXmlAttribute(openTag, "file_name")
		if !ok {
			return true, nil
		}

		return true, &uctypes.UIMessagePart{
			Type: "data-userfile",
			Data: uctypes.UIMessageDataUserFile{
				FileName: fileName,
				MimeType: "text/plain",
			},
		}
	}

	if strings.HasPrefix(blockText, "<AttachedDirectoryListing_") {
		openTagEnd := strings.Index(blockText, "\n")
		if openTagEnd == -1 || blockText[openTagEnd-1] != '>' {
			return true, nil
		}

		openTag := blockText[:openTagEnd]
		directoryName, ok := ExtractXmlAttribute(openTag, "directory_name")
		if !ok {
			return true, nil
		}

		return true, &uctypes.UIMessagePart{
			Type: "data-userfile",
			Data: uctypes.UIMessageDataUserFile{
				FileName: directoryName,
				MimeType: "directory",
			},
		}
	}

	return false, nil
}

func JsonEncodeRequestBody(reqBody any) (bytes.Buffer, error) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	err := encoder.Encode(reqBody)
	if err != nil {
		return buf, err
	}
	return buf, nil
}

func IsOpenAIReasoningModel(model string) bool {
	m := strings.ToLower(model)
	return CheckModelPrefix(m, "o1") ||
		CheckModelPrefix(m, "o3") ||
		CheckModelPrefix(m, "o4") ||
		CheckModelPrefix(m, "gpt-5") ||
		CheckModelSubPrefix(m, "gpt-5.") ||
		CheckModelPrefix(m, "gpt-6") ||
		CheckModelSubPrefix(m, "gpt-6.")
}

func CheckModelPrefix(model string, prefix string) bool {
	return model == prefix || strings.HasPrefix(model, prefix+"-")
}

func CheckModelSubPrefix(model string, prefix string) bool {
	if strings.HasPrefix(model, prefix) && len(model) > len(prefix) {
		if model[len(prefix)] >= '0' && model[len(prefix)] <= '9' {
			return true
		}
	}
	return false
}

// GeminiSupportsImageToolResults returns true if the model supports multimodal function responses (images in tool results)
// This is only supported by Gemini 3 Pro and later models
func GeminiSupportsImageToolResults(model string) bool {
	m := strings.ToLower(model)
	return strings.Contains(m, "gemini-3") || strings.Contains(m, "gemini-4")
}

// CreateToolUseData creates a UIMessageDataToolUse from tool call information
func CreateToolUseData(toolCallID, toolName string, arguments string, chatOpts uctypes.GulinChatOpts) uctypes.UIMessageDataToolUse {
	toolUseData := uctypes.UIMessageDataToolUse{
		ToolCallId: toolCallID,
		ToolName:   toolName,
		Status:     uctypes.ToolUseStatusPending,
	}

	toolDef := chatOpts.GetToolDefinition(toolName)
	if toolDef == nil {
		toolUseData.Status = uctypes.ToolUseStatusError
		toolUseData.ErrorMessage = "tool not found"
		return toolUseData
	}

	var parsedArgs any
	if err := json.Unmarshal([]byte(arguments), &parsedArgs); err != nil {
		toolUseData.Status = uctypes.ToolUseStatusError
		toolUseData.ErrorMessage = fmt.Sprintf("failed to parse tool arguments: %v", err)
		return toolUseData
	}

	if toolDef.ToolCallDesc != nil {
		toolUseData.ToolDesc = toolDef.ToolCallDesc(parsedArgs, nil, nil)
	}

	if toolDef.ToolApproval != nil {
		toolUseData.Approval = toolDef.ToolApproval(parsedArgs, chatOpts)
	}
	
	// Si estamos en modo @act, forzar la auto-aprobación de todas las herramientas
	if strings.HasSuffix(chatOpts.Config.AIMode, "@act") {
		toolUseData.Approval = uctypes.ApprovalAutoApproved
	}

	// Si estamos en modo @plan, forzar que todas las herramientas requieran aprobación
	if strings.HasSuffix(chatOpts.Config.AIMode, "@plan") {
		toolUseData.Approval = uctypes.ApprovalNeedsApproval
	}

	if chatOpts.TabId != "" {
		if argsMap, ok := parsedArgs.(map[string]any); ok {
			if widgetId, ok := argsMap["widget_id"].(string); ok && widgetId != "" {
				ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancelFn()
				fullBlockId, err := wcore.ResolveBlockIdFromPrefix(ctx, chatOpts.TabId, widgetId)
				if err == nil {
					toolUseData.BlockId = fullBlockId
				}
			}
		}
	}

	return toolUseData
}

// SendToolProgress sends tool progress updates via SSE if the tool has a progress descriptor
func SendToolProgress(toolCallID, toolName string, jsonData []byte, chatOpts uctypes.GulinChatOpts, sseHandler *sse.SSEHandlerCh, usePartialParse bool) {
	toolDef := chatOpts.GetToolDefinition(toolName)
	if toolDef == nil || toolDef.ToolProgressDesc == nil {
		return
	}

	var parsedJSON any
	var err error
	if usePartialParse {
		parsedJSON, err = utilfn.ParsePartialJson(jsonData)
	} else {
		err = json.Unmarshal(jsonData, &parsedJSON)
	}
	if err != nil {
		return
	}

	statusLines, err := toolDef.ToolProgressDesc(parsedJSON)
	if err != nil {
		return
	}

	progressData := &uctypes.UIMessageDataToolProgress{
		ToolCallId:  toolCallID,
		ToolName:    toolName,
		StatusLines: statusLines,
	}
	_ = sseHandler.AiMsgData("data-toolprogress", "progress-"+toolCallID, progressData)
}

// EstimateTokens provides a weighted estimation of the number of tokens in a string.
// It uses heuristics for text vs code to be more accurate than simple character counting.
func EstimateTokens(s string) int {
	if s == "" {
		return 0
	}

	// Count whitespace and special characters
	var numSpaces, numSpecials int
	for _, r := range s {
		if r == ' ' || r == '\n' || r == '\t' {
			numSpaces++
		} else if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') {
			numSpecials++
		}
	}

	// Heuristic: If special characters are > 15% of the total, it's likely code/structured data.
	// Code usually has a higher token-to-character ratio.
	charLen := len(s)
	specialRatio := float64(numSpecials) / float64(charLen)

	if specialRatio > 0.15 {
		// Code-like: ~3 characters per token
		return charLen / 3
	}

	// Standard text: ~4 characters per token
	return charLen / 4
}
