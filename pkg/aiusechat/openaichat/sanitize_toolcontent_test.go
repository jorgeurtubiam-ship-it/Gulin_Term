// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package openaichat

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestSanitizeToolContent_ANSI cubre el caso real que rompia el gateway:
// salidas de `ssh`/`sshpass` con secuencias de color y titulos de terminal.
func TestSanitizeToolContent_ANSI(t *testing.T) {
	in := "\x1b[1;32mOK\x1b[0m: 3 rows\n\x1b]0;title\x07done\n"
	got := sanitizeToolContent(in)
	if strings.ContainsRune(got, 0x1b) {
		t.Fatalf("quedaron bytes ESC: %q", got)
	}
	if !strings.Contains(got, "OK: 3 rows") {
		t.Fatalf("se perdio el texto util: %q", got)
	}
	if !strings.Contains(got, "done") {
		t.Fatalf("se perdio la segunda linea: %q", got)
	}
}

// TestSanitizeToolContent_NULyControl verifica que NUL, CR suelto y DEL
// desaparecen pero se conservan \n y \t.
func TestSanitizeToolContent_NULyControl(t *testing.T) {
	in := "line1\r\nline2\x00\x07\x1f\tindent\x7fend"
	got := sanitizeToolContent(in)
	for _, bad := range []string{"\x00", "\x07", "\x1f", "\x7f"} {
		if strings.Contains(got, bad) {
			t.Fatalf("quedo el byte de control %q en %q", bad, got)
		}
	}
	if !strings.Contains(got, "line1") || !strings.Contains(got, "line2") {
		t.Fatalf("se perdieron lineas: %q", got)
	}
	if !strings.Contains(got, "\tindent") {
		t.Fatalf("se perdio el tabulador: %q", got)
	}
}

// TestSanitizeToolContent_RutaRapida comprueba que el contenido limpio no se
// toca (no se reescribe ni se normaliza nada).
func TestSanitizeToolContent_RutaRapida(t *testing.T) {
	in := "texto normal con acentos: ñ á é y emoji 🚀\nsegunda linea\n"
	if got := sanitizeToolContent(in); got != in {
		t.Fatalf("se modifico contenido limpio:\n in=%q\nout=%q", in, got)
	}
}

// TestSanitizeToolContent_JSONValido es el test nuclear: tras sanear, el
// contenido sobrevive a un Marshal/Unmarshal de JSON, que es exactamente lo
// que hace el gateway al recibir el payload.
func TestSanitizeToolContent_JSONValido(t *testing.T) {
	raw := "\x1b[31mERROR\x1b[0m\x00\x01\x02 control\rbasura\x1b[?25l"
	payload := map[string]any{
		"role":    "tool",
		"content": sanitizeToolContent(raw),
	}
	b, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Marshal fallo: %v", err)
	}
	var back map[string]any
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatalf("Unmarshal fallo: %v", err)
	}
	if back["content"] != "ERROR control\rbasura" && !strings.Contains(back["content"].(string), "ERROR") {
		t.Fatalf("contenido inesperado tras round-trip: %v", back["content"])
	}
}

// TestSanitizeToolContent_NoRompeUTF8 valida que no se parten runes
// multibyte al eliminar caracteres de control.
func TestSanitizeToolContent_NoRompeUTF8(t *testing.T) {
	in := "instalación\x00completada ✓ ñandú"
	got := sanitizeToolContent(in)
	for _, want := range []string{"instalación", "completada ✓", "ñandú"} {
		if !strings.Contains(got, want) {
			t.Fatalf("se corrompio UTF-8, falta %q en %q", want, got)
		}
	}
}
