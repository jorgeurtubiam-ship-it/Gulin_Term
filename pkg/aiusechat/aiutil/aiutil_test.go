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
