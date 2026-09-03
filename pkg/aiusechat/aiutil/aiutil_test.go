package aiutil

import (
	"testing"
)

func TestEstimateTokens(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		minTokens int
		maxTokens int
	}{
		{"Empty", "", 0, 0},
		{"Short Text", "Hello world", 2, 4},
		{"Long Text", "This is a much longer sentence that should have more tokens clearly.", 10, 20},
		{"Simple Code", "func main() { fmt.Println(\"hi\") }", 10, 15},
		{"Heavy Symbols", "!@#$%^&*()_+{}:\"<>?|", 5, 10},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := EstimateTokens(tc.input)
			if got < tc.minTokens || got > tc.maxTokens {
				t.Errorf("EstimateTokens(%q) = %d; want between %d and %d", tc.input, got, tc.minTokens, tc.maxTokens)
			}
		})
	}
}

func TestStripThinkingTags(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"Empty", "", ""},
		{"No thinking", "Hello world! Here is the solution.", "Hello world! Here is the solution."},
		{"Simple think tag", "<think>Let me calculate 2+2=4</think>The answer is 4.", "The answer is 4."},
		{"Simple thought tag", "<thought>\nStep 1: check files\nStep 2: read line\n</thought>\n\nFound 1 match.", "Found 1 match."},
		{"Case insensitive", "<THINK>Thinking deeply...</THINK>Result here.", "Result here."},
		{"Multiline and whitespace", "<think>\nLine 1\nLine 2\n</think>\n\nCode:\n```go\nfmt.Println()\n```", "Code:\n```go\nfmt.Println()\n```"},
		{"Unclosed tag at end", "Some text <think>Unfinished thoughts", "Some text"},
		{"Multiple think blocks", "<think>One</think> Part 1 <think>Two</think> Part 2", "Part 1  Part 2"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := StripThinkingTags(tc.input)
			if got != tc.expected {
				t.Errorf("StripThinkingTags(%q) = %q; want %q", tc.input, got, tc.expected)
			}
		})
	}
}

