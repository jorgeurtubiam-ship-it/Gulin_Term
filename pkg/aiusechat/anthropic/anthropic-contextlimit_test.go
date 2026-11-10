package anthropic

import (
	"strings"
	"testing"
)

func textBlock(text string) anthropicMessageContentBlock {
	return anthropicMessageContentBlock{Type: "text", Text: text}
}

func toolUseBlock(id, name string) anthropicMessageContentBlock {
	return anthropicMessageContentBlock{Type: "tool_use", ID: id, Name: name, Input: map[string]string{"k": "v"}}
}

func toolResultBlock(toolUseID, content string) anthropicMessageContentBlock {
	return anthropicMessageContentBlock{Type: "tool_result", ToolUseID: toolUseID, Content: content}
}

func TestLimitAnthropicTotalMessagesKeepsBudget(t *testing.T) {
	msgs := []anthropicInputMessage{
		{Role: "user", Content: []anthropicMessageContentBlock{textBlock("hola")}},
		{Role: "assistant", Content: []anthropicMessageContentBlock{textBlock("respuesta larga " + strings.Repeat("a", 2000))}},
		{Role: "user", Content: []anthropicMessageContentBlock{textBlock("pregunta " + strings.Repeat("b", 2000))}},
	}

	// Budget large enough to keep everything.
	got := limitAnthropicTotalMessages(msgs, 100000)
	if len(got) != len(msgs) {
		t.Fatalf("expected all %d messages to be kept, got %d", len(msgs), len(got))
	}

	// Budget that only fits the newest message.
	got = limitAnthropicTotalMessages(msgs, 10)
	if len(got) == 0 {
		t.Fatal("expected at least the newest message to be kept")
	}
	last := got[len(got)-1]
	if !strings.Contains(last.Content[0].Text, "pregunta") {
		t.Fatalf("expected the newest message to be retained, got %q", last.Content[0].Text)
	}
}

func TestLimitAnthropicTotalMessagesDropsOrphanToolResult(t *testing.T) {
	msgs := []anthropicInputMessage{
		// Old assistant turn with a tool_use whose tool_result is in the NEXT message.
		{Role: "assistant", Content: []anthropicMessageContentBlock{toolUseBlock("toolu_1", "run")}},
		{Role: "user", Content: []anthropicMessageContentBlock{toolResultBlock("toolu_1", "resultado " + strings.Repeat("c", 4000))}},
		{Role: "user", Content: []anthropicMessageContentBlock{textBlock("mensaje final")}},
	}

	// Budget fits only the newest message -> the tool_result survives but its
	// tool_use does not. The orphan must be dropped, otherwise Anthropic rejects
	// the request with "unexpected tool_use_id".
	got := limitAnthropicTotalMessages(msgs, 10)
	for _, msg := range got {
		for _, block := range msg.Content {
			if block.Type == "tool_result" {
				t.Fatalf("orphan tool_result was not dropped: %+v", block)
			}
		}
	}
}

func TestLimitAnthropicTotalMessagesDropsOrphanToolUse(t *testing.T) {
	msgs := []anthropicInputMessage{
		{Role: "assistant", Content: []anthropicMessageContentBlock{toolUseBlock("toolu_1", "run")}},
		{Role: "user", Content: []anthropicMessageContentBlock{toolResultBlock("toolu_1", "resultado " + strings.Repeat("c", 4000))}},
		{Role: "user", Content: []anthropicMessageContentBlock{textBlock("mensaje final")}},
	}

	// Budget fits the assistant turn with the tool_use but not the tool_result.
	got := limitAnthropicTotalMessages(msgs, 100)
	for _, msg := range got {
		for _, block := range msg.Content {
			if block.Type == "tool_use" {
				t.Fatalf("orphan tool_use was not dropped: %+v", block)
			}
		}
	}
}

func TestLimitAnthropicTotalMessagesKeepsToolPair(t *testing.T) {
	msgs := []anthropicInputMessage{
		{Role: "user", Content: []anthropicMessageContentBlock{textBlock("hola")}},
		{Role: "assistant", Content: []anthropicMessageContentBlock{toolUseBlock("toolu_1", "run")}},
		{Role: "user", Content: []anthropicMessageContentBlock{toolResultBlock("toolu_1", "ok")}},
	}

	got := limitAnthropicTotalMessages(msgs, 100000)
	foundUse, foundResult := false, false
	for _, msg := range got {
		for _, block := range msg.Content {
			switch block.Type {
			case "tool_use":
				foundUse = true
			case "tool_result":
				foundResult = true
			}
		}
	}
	if !foundUse || !foundResult {
		t.Fatalf("expected the tool_use/tool_result pair to be preserved, got use=%v result=%v", foundUse, foundResult)
	}
}

func TestLimitAnthropicTotalMessagesStartsWithUser(t *testing.T) {
	// Anthropic requires the first message to have role "user".
	msgs := []anthropicInputMessage{
		{Role: "assistant", Content: []anthropicMessageContentBlock{textBlock("soy asistente primero")}},
		{Role: "user", Content: []anthropicMessageContentBlock{textBlock("hola")}},
	}

	got := limitAnthropicTotalMessages(msgs, 100000)
	if len(got) == 0 {
		t.Fatal("expected messages to be kept")
	}
	if got[0].Role != "user" {
		t.Fatalf("expected first message to be user, got %q", got[0].Role)
	}
}

func TestTruncateAnthropicLargeMessagesCapsTextBlock(t *testing.T) {
	big := strings.Repeat("x", 100000)
	msgs := []anthropicInputMessage{
		{Role: "user", Content: []anthropicMessageContentBlock{textBlock(big)}},
	}

	// 1000 tokens * 4 chars = 4000 chars cap.
	truncateAnthropicLargeMessages(msgs, false, 1000)
	got := msgs[0].Content[0].Text
	if len(got) > 4000+200 {
		t.Fatalf("text block was not truncated: len=%d", len(got))
	}
	if !strings.Contains(got, "TRUNCATED") {
		t.Fatal("expected a TRUNCATED marker in the truncated text")
	}
}

func TestTruncateAnthropicLargeMessagesCapsToolResult(t *testing.T) {
	big := strings.Repeat("y", 100000)
	msgs := []anthropicInputMessage{
		{Role: "user", Content: []anthropicMessageContentBlock{toolResultBlock("toolu_1", big)}},
	}

	truncateAnthropicLargeMessages(msgs, false, 500)
	content, ok := msgs[0].Content[0].Content.(string)
	if !ok {
		t.Fatal("expected tool_result content to stay a string")
	}
	if len(content) > 2000+200 {
		t.Fatalf("tool_result was not truncated: len=%d", len(content))
	}
	if !strings.Contains(content, "TRUNCATED") {
		t.Fatal("expected a TRUNCATED marker in the truncated tool result")
	}
}

func TestTruncateAnthropicLargeMessagesBridgeKeepsByteCap(t *testing.T) {
	big := strings.Repeat("z", 40000)
	msgs := []anthropicInputMessage{
		{Role: "user", Content: []anthropicMessageContentBlock{textBlock(big)}},
	}

	// Bridge path keeps the historical 15000 byte cap regardless of maxBlockTokens.
	truncateAnthropicLargeMessages(msgs, true, 100000)
	got := msgs[0].Content[0].Text
	if len(got) > 15000+200 {
		t.Fatalf("bridge truncation did not apply the 15000 byte cap: len=%d", len(got))
	}
}
