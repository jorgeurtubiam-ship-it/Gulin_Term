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

	// Adjust backward to find a "clean" cut point: "user" or "system".
	// This ensures we always start a turn or a conversation from its origin.
	//
	// Reglas:
	//  1. Preferir "user" (inicio real de turno).
	//  2. "system" solo vale si esta en la posicion 0 del historial: los system
	//     van al principio del payload, no a mitad de la conversacion.
	//  3. Un mensaje "user" que solo contiene tool_result NO es un corte limpio:
	//     sus tool_calls viven en el assistant anterior, que quedaria cortado y
	//     el proveedor responde 400.
	for startIdx > 0 {
		role := messages[startIdx].GetRole()
		if role == "user" && !IsToolResultOnlyMessage(messages[startIdx]) {
			break
		}
		if role == "system" && startIdx == 0 {
			break
		}
		startIdx--
	}

	return messages[startIdx:]
}

// AIMessagePartTypeToolResult es el tipo de bloque que transporta el resultado
// de una tool en el historial (dialecto Anthropic / historial mixto).
const AIMessagePartTypeToolResult = "tool_result"

// IsToolResultOnlyMessage reporta si el mensaje es un "user" que en realidad
// transporta solo resultados de tools. Usado para no cortar el historial justo
// despues del assistant que emitio la tool call, lo que dejaria tool results
// huerfanos y romperia el pairing.
func IsToolResultOnlyMessage(msg GenAIMessage) bool {
	if msg == nil || msg.GetRole() != "user" {
		return false
	}
	generic := ConvertToGenericAIMessage(msg)
	if generic == nil || len(generic.Parts) == 0 {
		return false
	}
	for _, part := range generic.Parts {
		if part.Type != AIMessagePartTypeToolResult {
			return false
		}
	}
	return true
}
