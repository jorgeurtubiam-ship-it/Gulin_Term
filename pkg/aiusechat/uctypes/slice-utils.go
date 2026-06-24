// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package uctypes

// TruncateMessagesSafe truncates a message history to approximately the given limit,
// but ensuring the history starts with a "clean" message (User or System).
// This prevents breaking tool call sequences and resulting API errors like
// "insufficient tool messages following tool_calls message".
func TruncateMessagesSafe(messages []GenAIMessage, limit int) []GenAIMessage {
	if len(messages) <= limit {
		return messages
	}

	// Tentative start index
	startIdx := len(messages) - limit

	// Adjust backward to find a "user" or "system" message.
	// This ensures we always start a turn or a conversation from its origin.
	for startIdx > 0 {
		role := messages[startIdx].GetRole()
		if role == "user" || role == "system" {
			break
		}
		startIdx--
	}

	return messages[startIdx:]
}
