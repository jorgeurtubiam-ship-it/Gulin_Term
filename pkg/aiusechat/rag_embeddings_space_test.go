package aiusechat

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	sqlite_vec "github.com/asg017/sqlite-vec-go-bindings/cgo"
)

// TestSearchSemanticallyEspacioVectorial valida el fix completo:
//
// 1. La búsqueda NO mezcla vectores de distintos providers (espacios vectoriales).
// 2. La búsqueda NO devuelve 0 resultados por el orden k/filtro.
//
// Escenario: 30 chunks 'gemini' (vector lejano) + 3 chunks 'ollama' (vector
// igual al query). El query usa el provider 'ollama'.
//
// Con el bug: el KNN con k=5 (topK=5) selecciona 5 vectores, todos 'gemini'
// (si el vector gemini quedara mas cerca) y el filtro los elimina -> 0
// resultados. Con el fix: over-fetch + filtro por espacio -> 3 resultados
// 'ollama'.
func TestSearchSemanticallyEspacioVectorial(t *testing.T) {
	sqlite_vec.Auto()

	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "vec.db")

	db, err := InitVectorDB(dbPath)
	if err != nil {
		t.Fatalf("InitVectorDB: %v", err)
	}
	defer db.Close()

	ctx := context.Background()

	// Vectores deterministas y distintos por provider.
	vecOllama := make([]float32, 768)
	for i := range vecOllama {
		vecOllama[i] = 0.1
	}
	vecGemini := make([]float32, 768)
	for i := range vecGemini {
		vecGemini[i] = 0.9
	}

	insertChunk := func(path, prov string, v []float32) {
		_, err := db.ExecContext(ctx,
			"INSERT INTO knowledge (filepath, content, updated_at, embedding_provider) VALUES (?, ?, ?, ?)",
			path, "contenido de "+path, 1, prov)
		if err != nil {
			t.Fatalf("insert knowledge: %v", err)
		}
		var id int64
		if err := db.QueryRowContext(ctx, "SELECT id FROM knowledge WHERE filepath = ?", path).Scan(&id); err != nil {
			t.Fatalf("select id: %v", err)
		}
		b, _ := floatsToBytes(v)
		if _, err := db.ExecContext(ctx, "INSERT INTO knowledge_vec (knowledge_id, embedding) VALUES (?, ?)", id, b); err != nil {
			t.Fatalf("insert vec: %v", err)
		}
	}

	// 30 chunks de gemini (espacio ajeno)
	for i := 0; i < 30; i++ {
		insertChunk("gem"+itoa(i)+".md#0", EmbeddingProviderGemini, vecGemini)
	}
	// 3 chunks de ollama (espacio del query)
	for i := 0; i < 3; i++ {
		insertChunk("oll"+itoa(i)+".md#0", EmbeddingProviderOllama, vecOllama)
	}

	// Inyectamos el provider de test: siempre ollama, vector = vecOllama.
	old := embeddingProvider
	embeddingProvider = func(text string) ([]float32, error) { return vecOllama, nil }
	defer func() { embeddingProvider = old }()

	res, err := SearchSemantically(ctx, db, "consulta de prueba", 5)
	if err != nil {
		t.Fatalf("SearchSemantically: %v", err)
	}

	t.Logf("resultados: %d", len(res))
	for i, r := range res {
		t.Logf("  [%d] %s score=%.4f provider=%s", i+1, r.FilePath, r.Score, r.Provider)
	}

	if len(res) == 0 {
		t.Fatalf("BUG: la busqueda devolvio 0 resultados pese a existir 3 chunks del mismo espacio vectorial")
	}
	if len(res) != 3 {
		t.Errorf("se esperaban 3 resultados (solo los del espacio ollama), se obtuvieron %d", len(res))
	}
	for _, r := range res {
		if r.Provider != EmbeddingProviderOllama {
			t.Errorf("resultado de espacio vectorial incorrecto: %s (provider=%s)", r.FilePath, r.Provider)
		}
		if r.Score <= 0 {
			t.Errorf("score invalido en %s: %f", r.FilePath, r.Score)
		}
	}
}

// itoa convierte un entero a cadena sin depender de strconv (para no chocar
// con otros helpers del paquete).
func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	digits := ""
	for i > 0 {
		digits = string(rune('0'+i%10)) + digits
		i /= 10
	}
	return digits
}

// TestMigracionEmbeddingProvider comprueba que una DB antigua (sin la
// columna embedding_provider) se migra sin perder datos.
func TestMigracionEmbeddingProvider(t *testing.T) {
	sqlite_vec.Auto()

	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "legacy.db")

	// Creamos una DB "antigua" sin la columna.
	old, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	_, err = old.Exec(`CREATE TABLE knowledge (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		filepath TEXT UNIQUE NOT NULL,
		content TEXT NOT NULL,
		updated_at INTEGER NOT NULL,
		client_id TEXT)`)
	if err != nil {
		t.Fatalf("create legacy: %v", err)
	}
	_, err = old.Exec("INSERT INTO knowledge (filepath, content, updated_at, client_id) VALUES ('a.md#0', 'c', 1, 'c1')")
	if err != nil {
		t.Fatalf("insert legacy: %v", err)
	}
	old.Close()

	// InitVectorDB debe migrarla.
	db, err := InitVectorDB(dbPath)
	if err != nil {
		t.Fatalf("InitVectorDB (migracion): %v", err)
	}
	defer db.Close()

	var prov sql.NullString
	var cnt int
	if err := db.QueryRow("SELECT COUNT(*) FROM knowledge").Scan(&cnt); err != nil {
		t.Fatalf("count: %v", err)
	}
	if err := db.QueryRow("SELECT embedding_provider FROM knowledge WHERE filepath = 'a.md#0'").Scan(&prov); err != nil {
		t.Fatalf("select provider: %v", err)
	}
	t.Logf("filas tras migrar: %d, embedding_provider=%v", cnt, prov)

	if cnt != 1 {
		t.Errorf("la migracion perdio datos: %d filas (esperado 1)", cnt)
	}

	// La columna debe EXISTIR. Su valor en una fila legacy es NULL (espacio
	// desconocido), no un string vacio: ese es el estado correcto y es lo que
	// HasChunksWithoutProvider detecta para forzar la re-indexacion.
	if err := db.QueryRow("SELECT embedding_provider FROM knowledge WHERE filepath = 'a.md#0'").Scan(&prov); err != nil {
		t.Fatalf("select provider: %v", err)
	}
	if prov.Valid && prov.String != "" {
		t.Errorf("una fila legacy deberia tener provider NULL/vacio, se obtuvo %q", prov.String)
	}

	// HasChunksWithoutProvider debe detectar la fila legacy.
	legacy, err := HasChunksWithoutProvider(context.Background(), db, "a.md")
	if err != nil {
		t.Fatalf("HasChunksWithoutProvider: %v", err)
	}
	if !legacy {
		t.Errorf("HasChunksWithoutProvider deberia detectar la fila legacy sin provider")
	}

	// La DB debe tener tambien la tabla virtual y el indice de client_id.
	var hasVec int
	if err := db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='knowledge_vec'").Scan(&hasVec); err != nil {
		t.Fatalf("check vec table: %v", err)
	}
	if hasVec != 1 {
		t.Errorf("falta la tabla knowledge_vec tras la migracion")
	}

	// Verificar que la migracion es idempotente (segunda llamada).
	if err := ensureEmbeddingProviderColumn(db); err != nil {
		t.Errorf("ensureEmbeddingProviderColumn no es idempotente: %v", err)
	}

	_ = os.Remove(dbPath)
}
