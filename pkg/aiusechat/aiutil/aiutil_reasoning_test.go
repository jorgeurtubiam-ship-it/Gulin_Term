package aiutil

import "testing"

func TestIsReasoningModel(t *testing.T) {
	reasoning := []string{
		"o1",
		"o1-preview",
		"o3-mini",
		"o4-mini",
		"gpt-5",
		"gpt-5.1",
		"gpt-6",
		"deepseek-reasoner",
		"deepseek-chat",
		"deepseek-v4-flash",
		"MiniMax-M3",
		"minimax-m3.1-flash",
		"minimax-M2.1",
		"qwen3-32b",
		"qwq-32b",
	}
	for _, m := range reasoning {
		if !IsReasoningModel(m) {
			t.Errorf("IsReasoningModel(%q) = false, want true", m)
		}
	}

	nonReasoning := []string{
		"gpt-4o",
		"gpt-4.1",
		"claude-sonnet-4",
		"claude-haiku-4-5-20251001",
		"gemini-2.5-flash",
		"gemini-3.1-flash-lite",
		"llama-3.3-70b",
		"mistral-large",
	}
	for _, m := range nonReasoning {
		if IsReasoningModel(m) {
			t.Errorf("IsReasoningModel(%q) = true, want false", m)
		}
	}
}

func TestIsOpenAIReasoningModelDoesNotMatchNonOpenAI(t *testing.T) {
	// gpt-4o must not be treated as a reasoning model.
	if IsOpenAIReasoningModel("gpt-4o") {
		t.Error("IsOpenAIReasoningModel(gpt-4o) = true, want false")
	}
	// gpt-5 must be.
	if !IsOpenAIReasoningModel("gpt-5") {
		t.Error("IsOpenAIReasoningModel(gpt-5) = false, want true")
	}
}

func TestReasoningModelMinMaxTokens(t *testing.T) {
	// The floor must be large enough to hold a reasoning trace plus a real
	// answer; 4096 caused finish_reason="length" truncations.
	if ReasoningModelMinMaxTokens <= 4096 {
		t.Errorf("ReasoningModelMinMaxTokens = %d, want > 4096", ReasoningModelMinMaxTokens)
	}
}
