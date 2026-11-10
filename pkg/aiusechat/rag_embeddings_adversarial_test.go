package aiusechat

import (
	"database/sql"
	"testing"

	sqlite_vec "github.com/asg017/sqlite-vec-go-bindings/cgo"
)

// TestEspacioAjanoNoRobaResultados es el caso adversarial del filtro por
// espacio vectorial.
//
// Hay 500 chunks 'gemini' MUY CERCANOS al query y solo 3 'ollama' LEJANOS.
// El top-k global estaria dominado por los 'gemini'. Si el filtro por
// provider se aplicara DESPUES del corte del KNN, la busqueria devolveria 0
// resultados (o solo los mas cercanos del espacio equivocado).
//
// Verifica que el filtro se empuja hacia abajo (pushdown) y que la busqueda
// devuelve los chunks del espacio correcto.
func TestEspacioAjanoNoRobaResultados(t *testing.T) {
	sqlite_vec.Auto()

	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	db.Exec(`CREATE TABLE knowledge (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		filepath TEXT UNIQUE NOT NULL,
		content TEXT NOT NULL,
		updated_at INTEGER NOT NULL,
		client_id TEXT,
		embedding_provider TEXT)`)
	db.Exec(`CREATE VIRTUAL TABLE knowledge_vec USING vec0(
		knowledge_id INTEGER PRIMARY KEY,
		embedding FLOAT[768])`)

	query := make([]float32, 768)
	for i := range query {
		query[i] = 0.5
	}
	vecGem := make([]float32, 768)
	for i := range vecGem {
		vecGem[i] = 0.9 // MAS cercano al query
	}
	vecOll := make([]float32, 768)
	for i := range vecOll {
		vecOll[i] = 0.1 // MAS lejano
	}

	ins := func(path, prov string, v []float32) {
		res, _ := db.Exec("INSERT INTO knowledge (filepath, content, updated_at, embedding_provider) VALUES (?,?,?,?)",
			path, "x", 1, prov)
		id, _ := res.LastInsertId()
		b, _ := floatsToBytes(v)
		db.Exec("INSERT INTO knowledge_vec (knowledge_id, embedding) VALUES (?,?)", id, b)
	}
	for i := 0; i < 500; i++ {
		ins("g"+itoa(i)+".md#0", EmbeddingProviderGemini, vecGem)
	}
	for i := 0; i < 3; i++ {
		ins("o"+itoa(i)+".md#0", EmbeddingProviderOllama, vecOll)
	}

	qb, _ := floatsToBytes(query)

	// El ranking GLOBAL (sin filtro) estaria dominado por los gemini.
	rowsGlobal, err := db.Query(`SELECT k.embedding_provider FROM knowledge_vec kv
		JOIN knowledge k ON k.id = kv.knowledge_id
		WHERE kv.embedding MATCH ? AND k = ? ORDER BY (1.0 - vec_distance_cosine(kv.embedding, ?)) DESC`,
		qb, 5, qb)
	if err != nil {
		t.Fatalf("query global: %v", err)
	}
	globalTop := ""
	for rowsGlobal.Next() {
		var p string
		rowsGlobal.Scan(&p)
		globalTop = p
		break
	}
	rowsGlobal.Close()
	t.Logf("provider del #1 global (sin filtro): %s", globalTop)

	// Con filtro por provider deben salir los 3 'ollama'.
	rows, err := db.Query(`SELECT k.filepath, k.embedding_provider FROM knowledge_vec kv
		JOIN knowledge k ON k.id = kv.knowledge_id
		WHERE kv.embedding MATCH ? AND k = ? AND k.embedding_provider = ?
		ORDER BY (1.0 - vec_distance_cosine(kv.embedding, ?)) DESC`,
		qb, 5, EmbeddingProviderOllama, qb)
	if err != nil {
		t.Fatalf("query con filtro: %v", err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var fp, p string
		rows.Scan(&fp, &p)
		t.Logf("  [%d] %s provider=%s", n+1, fp, p)
		n++
	}
	t.Logf("resultados con filtro por provider: %d (esperado 3)", n)

	if globalTop != EmbeddingProviderGemini {
		t.Logf("NOTA: el #1 global fue %s (el escenario no se dio como se esperaba)", globalTop)
	}
	if n != 3 {
		t.Errorf("se esperaban 3 resultados del espacio ollama, se obtuvieron %d", n)
	}
}
