package aiusechat

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	sqlite_vec "github.com/asg017/sqlite-vec-go-bindings/cgo"
)

// TestEstadoRealProviders mide que providers de embeddings estan VIVOS y
// en que ESPACIO VECTORIAL estan los 1516 chunks almacenados.
//
// Esto decide si el plan de mejora de memoria (subir topK, quitar el
// fallback por nombre) tiene sentido sobre el estado actual.
func TestEstadoRealProviders(t *testing.T) {
	if os.Getenv("GULIN_DIAG") == "" {
		t.Skip("test de diagnostico manual: exporta GULIN_DIAG=1 para ejecutarlo")
	}
	sqlite_vec.Auto()
	ctx := context.Background()

	// 1. Que providers responden?
	for _, spec := range embeddingProviderOrder {
		emb, err := spec.fn(ctx, "prueba de estado")
		if err != nil {
			t.Logf("provider %-26s NO VIVO: %v", spec.name, err)
			continue
		}
		t.Logf("provider %-26s VIVO dims=%d", spec.name, len(emb))
	}

	// 2. Que provider usaria la busqueda real?
	_, prov, err := GetEmbeddingWithProvider(ctx, "conectate a fasa oracle")
	t.Logf("provider que usaria la busqueda: %s (err=%v)", prov, err)

	// 3. Que provider tienen los chunks almacenados? (vacio = legacy)
	home, _ := os.UserHomeDir()
	dbPath := filepath.Join(home, "Gulin_Workspace", "config", "gulin_global_memory.db")
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	var total, legacy int
	db.QueryRow("SELECT COUNT(*) FROM knowledge").Scan(&total)
	db.QueryRow("SELECT COUNT(*) FROM knowledge WHERE embedding_provider IS NULL OR embedding_provider=''").Scan(&legacy)
	t.Logf("chunks totales=%d legacy(sin provider)=%d", total, legacy)

	// 4. En que espacio esta el contenido realmente? Comparamos el vector
	//    de un chunk contra cada provider vivo.
	var content string
	db.QueryRow("SELECT content FROM knowledge WHERE content LIKE '%FASA%' LIMIT 1").Scan(&content)
	if content == "" {
		db.QueryRow("SELECT content FROM knowledge LIMIT 1").Scan(&content)
	}
	t.Logf("contenido de muestra: %d bytes", len(content))

	rows, err := db.Query("SELECT id FROM knowledge LIMIT 1")
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	var chunkID int64
	if rows.Next() {
		rows.Scan(&chunkID)
	}
	rows.Close()

	var storedBlob []byte
	if err := db.QueryRow("SELECT embedding FROM knowledge_vec WHERE knowledge_id = ?", chunkID).Scan(&storedBlob); err != nil {
		t.Logf("no se pudo leer el vector: %v", err)
		return
	}
	stored, err := floatsFromBytes(storedBlob)
	if err != nil {
		t.Fatalf("floatsFromBytes: %v", err)
	}

	for _, spec := range embeddingProviderOrder {
		emb, err := spec.fn(ctx, content)
		if err != nil {
			continue
		}
		cos := CosineSimilarity(stored, emb)
		verdict := "DISTINTO (espacio vectorial diferente)"
		if cos > 0.99 {
			verdict = "MISMO ESPACIO"
		}
		t.Logf("cos(vector almacenado, %s) = %.4f  -> %s", spec.name, cos, verdict)
	}
}
