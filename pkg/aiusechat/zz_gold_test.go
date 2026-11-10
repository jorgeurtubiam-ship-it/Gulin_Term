package aiusechat

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	sqlite_vec "github.com/asg017/sqlite-vec-go-bindings/cgo"
)

// TestGoldStandardRecuperacion comprueba si el pipeline de recuperacion
// funciona con un caso CONTROLADO: se indexa un texto con una frase
// distinta y se busca con la frase EXACTA.
//
// Si el texto buscado no aparece en el top-5, el problema NO es topK=3 ni
// la falta de diversidad por corpus: es que el embedding/ranking no
// funciona. En ese caso, subir topK solo inyecta mas ruido.
func TestGoldStandardRecuperacion(t *testing.T) {
	sqlite_vec.Auto()
	ctx := context.Background()

	home, _ := os.UserHomeDir()
	dbPath := filepath.Join(home, "Gulin_Workspace", "config", "gulin_global_memory.db")
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	// --- CASO A: frase EXACTA de un chunk real (gold standard) ---
	var targetFP, targetContent string
	if err := db.QueryRowContext(ctx,
		"SELECT filepath, content FROM knowledge WHERE filepath LIKE 'clientes/fasa/%' LIMIT 1").
		Scan(&targetFP, &targetContent); err != nil {
		t.Fatalf("no hay chunks de fasa: %v", err)
	}
	t.Logf("=== CASO A: query = contenido EXACTO del chunk %s ===", targetFP)

	emb, prov, err := GetEmbeddingWithProvider(ctx, targetContent)
	if err != nil {
		t.Fatalf("embedding: %v", err)
	}
	t.Logf("provider del query: %s", prov)
	b, _ := floatsToBytes(emb)

	rows, err := db.QueryContext(ctx, `
		SELECT k.filepath, (1.0 - vec_distance_cosine(kv.embedding, ?)) as score
		FROM knowledge_vec kv JOIN knowledge k ON k.id = kv.knowledge_id
		WHERE kv.embedding MATCH ? AND k = ? ORDER BY score DESC LIMIT 5`, b, b, 5)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	rank := 0
	for rows.Next() {
		var fp string
		var score float64
		rows.Scan(&fp, &score)
		rank++
		hit := ""
		if fp == targetFP {
			hit = "  <-- OBJETIVO"
		}
		t.Logf("  %d. %.4f  %s%s", rank, score, fp, hit)
		if fp == targetFP {
			break
		}
	}
	rows.Close()

	// --- CASO B: fragmento SIGNIFICATIVO del chunk ---
	frag := significantFragment(targetContent)
	t.Logf("")
	t.Logf("=== CASO B: query = fragmento %q ===", frag)
	emb2, _, _ := GetEmbeddingWithProvider(ctx, frag)
	b2, _ := floatsToBytes(emb2)
	rows2, err := db.QueryContext(ctx, `
		SELECT k.filepath, (1.0 - vec_distance_cosine(kv.embedding, ?)) as score
		FROM knowledge_vec kv JOIN knowledge k ON k.id = kv.knowledge_id
		WHERE kv.embedding MATCH ? AND k = ? ORDER BY score DESC LIMIT 5`, b2, b2, 5)
	if err != nil {
		t.Fatalf("query2: %v", err)
	}
	for rows2.Next() {
		var fp string
		var score float64
		rows2.Scan(&fp, &score)
		hit := ""
		if fp == targetFP {
			hit = "  <-- OBJETIVO"
		}
		t.Logf("  %.4f  %s%s", score, fp, hit)
	}
	rows2.Close()

	// --- CASO C: un chunk de clientes/fasa vs el resto del corpus ---
	t.Logf("")
	t.Logf("=== CASO C: donde caen los 32 chunks de clientes/fasa para queries tipicas? ===")
	for _, q := range []string{"oracle fasa", "conectame a fasa", "broker standby dataguard"} {
		eq, _, err := GetEmbeddingWithProvider(ctx, q)
		if err != nil {
			continue
		}
		bq, _ := floatsToBytes(eq)
		r3, err := db.QueryContext(ctx, `
			SELECT k.filepath, (1.0 - vec_distance_cosine(kv.embedding, ?)) as score
			FROM knowledge_vec kv JOIN knowledge k ON k.id = kv.knowledge_id
			WHERE kv.embedding MATCH ? AND k = ? ORDER BY score DESC LIMIT 20`, bq, bq, 20)
		if err != nil {
			continue
		}
		posFasa := -1
		i := 0
		for r3.Next() {
			var fp string
			var score float64
			r3.Scan(&fp, &score)
			i++
			if strings.HasPrefix(fp, "clientes/fasa/") && posFasa < 0 {
				posFasa = i
				break
			}
		}
		r3.Close()
		t.Logf("  %-32q -> primer chunk de clientes/fasa en posicion %d (de 20)", q, posFasa)
	}
}

// significantFragment devuelve un fragmento representativo del texto.
func significantFragment(content string) string {
	lines := strings.Split(content, "\n")
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if len(l) > 40 && !strings.HasPrefix(l, "#") {
			return l
		}
	}
	if len(content) > 200 {
		return content[:200]
	}
	return content
}
