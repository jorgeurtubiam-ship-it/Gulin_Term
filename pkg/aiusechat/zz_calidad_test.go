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

// TestCalidadRecuperacionReal mide la calidad REAL de la recuperacion
// sobre la DB de produccion, para poner a prueba el diagnostico del plan
// (D1: topK=3 es cieguo, D2: los 4 corpus compiten).
//
// Para cada query realista muestra:
//   - el top-3 ACTUAL (lo que se inyecta hoy)
//   - el top-10 (para ver que hay por debajo)
//   - de que corpus viene cada resultado
func TestCalidadRecuperacionReal(t *testing.T) {
	sqlite_vec.Auto()
	ctx := context.Background()

	home, _ := os.UserHomeDir()
	dbPath := filepath.Join(home, "Gulin_Workspace", "config", "gulin_global_memory.db")
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	// Composicion del corpus
	var nMem, nLearned, nClients, nAgents int
	db.QueryRow("SELECT COUNT(*) FROM knowledge WHERE filepath LIKE 'memoria/%'").Scan(&nMem)
	db.QueryRow("SELECT COUNT(*) FROM knowledge WHERE filepath LIKE 'learned/%'").Scan(&nLearned)
	db.QueryRow("SELECT COUNT(*) FROM knowledge WHERE filepath LIKE 'clientes/%'").Scan(&nClients)
	db.QueryRow("SELECT COUNT(*) FROM knowledge WHERE filepath LIKE '.agents/%'").Scan(&nAgents)
	t.Logf("=== COMPOSICION DEL CORPUS (chunks) ===")
	t.Logf("  memoria/   %d", nMem)
	t.Logf("  learned/   %d", nLearned)
	t.Logf("  clientes/  %d", nClients)
	t.Logf("  .agents/   %d", nAgents)

	queries := []string{
		"conectate a fasa oracle",
		"dataguard standby broker",
		"ssh al servidor con usuario oracle",
		"como optimizo una query lenta en postgres",
		"analisis pentest seguridad anasac",
	}

	for _, q := range queries {
		t.Logf("")
		t.Logf("=== QUERY: %q ===", q)
		rows, err := db.QueryContext(ctx, `
			SELECT k.filepath, (1.0 - vec_distance_cosine(kv.embedding, ?)) as score
			FROM knowledge_vec kv JOIN knowledge k ON k.id = kv.knowledge_id
			WHERE kv.embedding MATCH ? AND k = ? ORDER BY score DESC LIMIT 10`,
			mustBytes(t, q), mustBytes(t, q), 10)
		if err != nil {
			t.Logf("  ERROR: %v", err)
			continue
		}
		i := 0
		for rows.Next() {
			var fp string
			var score float64
			rows.Scan(&fp, &score)
			i++
			mark := "   "
			if i <= 3 {
				mark = "-> "
			}
			t.Logf("%s%2d. [%-9s] %.4f  %s", mark, i, corpusOf(fp), score, fp)
		}
		rows.Close()
	}
}

// corpusOf clasifica un filepath en su corpus.
func corpusOf(fp string) string {
	switch {
	case strings.HasPrefix(fp, "memoria/playbooks/"):
		return "playbooks"
	case strings.HasPrefix(fp, "memoria/"):
		return "memoria"
	case strings.HasPrefix(fp, "learned/"):
		return "learned"
	case strings.HasPrefix(fp, "clientes/"):
		return "clientes"
	case strings.HasPrefix(fp, ".agents/"):
		return ".agents"
	}
	return "?"
}

// mustBytes embebe un texto con el provider real y lo devuelve como blob.
func mustBytes(t *testing.T, text string) []byte {
	t.Helper()
	emb, _, err := GetEmbeddingWithProvider(context.Background(), text)
	if err != nil {
		t.Fatalf("embedding: %v", err)
	}
	b, err := floatsToBytes(emb)
	if err != nil {
		t.Fatalf("floatsToBytes: %v", err)
	}
	return b
}
