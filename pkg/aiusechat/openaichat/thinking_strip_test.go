// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openaichat

import (
	"strings"
	"testing"
)

func TestSanitizeOpenAIMessages_StripThinking(t *testing.T) {
	// Simular una conversación de 2 turnos con pensamiento largo en la respuesta 1
	messages := []ChatRequestMessage{
		{
			Role:    "user",
			Content: "¿Cómo calculo el factorial en Go?",
		},
		{
			Role: "assistant",
			Content: `<think>
El usuario quiere una función factorial en Go.
Debo considerar:
1. Caso base n <= 1
2. Manejo de enteros grandes o int estándar
3. Explicación breve
</think>
Para calcular el factorial en Go puedes usar esta función:

func Factorial(n int) int {
    if n <= 1 {
        return 1
    }
    return n * Factorial(n-1)
}`,
		},
		{
			Role:    "user",
			Content: "Genial, ¿cómo lo hago de forma iterativa?",
		},
	}

	sanitized := sanitizeOpenAIMessages(messages)

	if len(sanitized) != 3 {
		t.Fatalf("se esperaban 3 mensajes, se obtuvieron %d", len(sanitized))
	}

	assistantMsg := sanitized[1]
	if assistantMsg.Role != "assistant" {
		t.Fatalf("se esperaba rol assistant, se obtuvo %s", assistantMsg.Role)
	}

	// Verificar que <think> y su contenido interno NO existan en el mensaje preparado
	if strings.Contains(assistantMsg.Content, "<think>") || strings.Contains(assistantMsg.Content, "</think>") {
		t.Errorf("el mensaje aún contiene etiquetas <think>")
	}
	if strings.Contains(assistantMsg.Content, "El usuario quiere una función factorial") {
		t.Errorf("el mensaje aún contiene el texto del pensamiento interno")
	}

	// Verificar que la respuesta útil y el código SI se conserven intactos
	if !strings.Contains(assistantMsg.Content, "func Factorial(n int) int") {
		t.Errorf("el código final fue eliminado incorrectamente")
	}
	if !strings.Contains(assistantMsg.Content, "Para calcular el factorial en Go") {
		t.Errorf("la respuesta útil fue eliminada incorrectamente")
	}
}
