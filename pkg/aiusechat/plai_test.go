package aiusechat

import (
	"testing"
	"strings"
)

func TestSanitizeForWAF(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		contains []string
		excludes []string
	}{
		{
			name:     "Simple Pipe",
			input:    "ls | grep test",
			contains: []string{"│"},
			excludes: []string{"|"},
		},
		{
			name:     "Restricted Words",
			input:    "sudo rm -rf /",
			contains: []string{"s-udo", "r-m -rf"},
			excludes: []string{"sudo ", "rm -rf"},
		},
		{
			name:     "Complex Chain",
			input:    "cat file | awk '{print $1}' | sort | uniq",
			contains: []string{"│"},
			excludes: []string{"|"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := sanitizeForWAF(tt.input)
			for _, c := range tt.contains {
				if !strings.Contains(got, c) {
					t.Errorf("sanitizeForWAF() = %v, want to contain %v", got, c)
				}
			}
			for _, e := range tt.excludes {
				if strings.Contains(got, e) {
					t.Errorf("sanitizeForWAF() = %v, want to exclude %v", got, e)
				}
			}
		})
	}
}
