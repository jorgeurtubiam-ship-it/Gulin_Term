package aiusechat

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	sqlite_vec "github.com/asg017/sqlite-vec-go-bindings/cgo"
)

// TestPrefijosNomicEmbedText comprueba si nomic-embed-text (el provider por
// defecto de Ollama) MEJORA su ranking cuando los textos se prefijan con
// la tarea correspondiente.
//
// nomic-embed-text fue entrenado con prefijos de tarea:
//   search_document: <texto>   -> al indexar
//   search_query:   <texto>   -> al buscar
//
// Sin ellos, el modelo no sabe si esta indexando o consultando, y el
// embedding resultante es de mala calidad: las similitudes se deprimen y
// el ranking se vuelve casi aleatorio.
func TestPrefijosNomicEmbedText(t *testing.T) {
	sqlite_vec.Auto()
	ctx := context.Background()

	home, _ := os.UserHomeDir()
	dbPath := filepath.Join(home, "Gulin_Workspace", "config", "gulin_global_memory.db")
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	queries := []string{
		"conectate a fasa oracle",
		"dataguard standby broker",
		"ssh al servidor con usuario oracle",
		"analisis pentest seguridad anasac",
	}

	// Ranking con el embedding CRUDO (sin prefijo de query)
	rank := func(q string, prefixed bool) []string {
		text := q
		if prefixed {
			text = "search_query: " + q
		}
		emb, _, err := GetEmbeddingWithProvider(ctx, text)
		if err != nil {
			t.Fatalf("embedding: %v", err)
		}
		b, _ := floatsToBytes(emb)
		rows, err := db.QueryContext(ctx, `
			SELECT k.filepath, (1.0 - vec_distance_cosine(kv.embedding, ?)) as score
			FROM knowledge_vec kv JOIN knowledge k ON k.id = kv.knowledge_id
			WHERE kv.embedding MATCH ? AND k = ? ORDER BY score DESC LIMIT 5`, b, b, 5)
		if err != nil {
			t.Fatalf("query: %v", err)
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var fp string
			var score float64
			rows.Scan(&fp, &score)
			out = append(out, fp)
		}
		return out
	}

	for _, q := range queries {
		t.Logf("")
		t.Logf("=== QUERY: %q ===", q)
		raw := rank(q, false)
		pre := rank(q, true)
		t.Logf("  SIN prefijo (top5):")
		for i, f := range raw {
			t.Logf("    %d. %s", i+1, f)
		}
		t.Logf("  CON 'search_query:' (top5):")
		for i, f := range pre {
			t.Logf("    %d. %s", i+1, f)
		}
		same := 0
		for _, a := range raw {
			for _, b := range pre {
				if a == b {
					same++
					break
				}
			}
		}
		t.Logf("  overlap top5: %d/5", same)
	}
}
