package aiusechat

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	sqlite_vec "github.com/asg017/sqlite-vec-go-bindings/cgo"
)

// TestDiagnoseEmbeddingNomicInvestiga por que los vectores almacenados no
// se parecen al embedding del MISMO texto.
//
// Sospechas:
//   A) El modelo de Ollama cambio (nomic-embed-text -> otro) y los vectores
//      viejos quedaron huerfanos.
//   B) El texto indexado no es el texto embebido (truncado o con prefijos).
//   C) Los vectores NO son float32 (endianness/formato incorrecto).
//   D) El embedding actual es de otro provider que el usado al indexar.
func TestDiagnoseEmbeddingNomic(t *testing.T) {
	sqlite_vec.Auto()
	ctx := context.Background()

	home, _ := os.UserHomeDir()
	dbPath := filepath.Join(home, "Gulin_Workspace", "config", "gulin_global_memory.db")
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	var content string
	var fp string
	db.QueryRowContext(ctx, "SELECT filepath, content FROM knowledge WHERE filepath LIKE 'clientes/fasa/%' LIMIT 1").Scan(&fp, &content)
	t.Logf("chunk: %s (%d bytes)", fp, len(content))

	var blob []byte
	db.QueryRowContext(ctx, "SELECT embedding FROM knowledge_vec kv JOIN knowledge k ON k.id=kv.knowledge_id WHERE k.filepath = ?", fp).Scan(&blob)
	t.Logf("blob: %d bytes (esperado %d para 768 float32)", len(blob), 768*4)

	stored, err := floatsFromBytes(blob)
	if err != nil {
		t.Fatalf("floatsFromBytes: %v", err)
	}

	// Estadisticas del vector almacenado
	min, max, norm := stored[0], stored[0], 0.0
	for _, v := range stored {
		if v < min {
			min = v
		}
		if v > max {
			max = v
		}
		norm += float64(v) * float64(v)
	}
	t.Logf("vector almacenado: min=%.5f max=%.5f norma=%.4f", min, max, sqrtf(norm))

	// Estadisticas del embedding ACTUAL
	emb, prov, err := GetEmbeddingWithProvider(ctx, content)
	if err != nil {
		t.Fatalf("embedding: %v", err)
	}
	min2, max2, norm2 := emb[0], emb[0], 0.0
	for _, v := range emb {
		if v < min2 {
			min2 = v
		}
		if v > max2 {
			max2 = v
		}
		norm2 += float64(v) * float64(v)
	}
	t.Logf("vector actual (%s): min=%.5f max=%.5f norma=%.4f", prov, min2, max2, sqrtf(norm2))

	t.Logf("cos = %.4f", CosineSimilarity(stored, emb))

	// Comparacion componente a componente: son el mismo vector reordenado?
	same := 0
	for i := range stored {
		if i < len(emb) && stored[i] == emb[i] {
			same++
		}
	}
	t.Logf("componentes identicas: %d/%d", same, len(stored))

	// Es el vector almacenado el embedding de otro texto? Probamos con el
	// texto del chunk y vemos el maximo de similitud.
	t.Logf("")
	t.Logf("--- ¿con que texto coincide el vector almacenado? ---")
	rows, err := db.QueryContext(ctx, "SELECT filepath, content FROM knowledge LIMIT 300")
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()
	best := -2.0
	var bestFP string
	for rows.Next() {
		var f, c string
		rows.Scan(&f, &c)
		e, _, err := GetEmbeddingWithProvider(ctx, c)
		if err != nil {
			continue
		}
		cs := float64(CosineSimilarity(stored, e))
		if cs > best {
			best = cs
			bestFP = f
		}
	}
	t.Logf("maximo cos contra 300 chunks: %.4f (%s)", best, bestFP)

	// ¿Y contra el texto con prefijo search_document?
	e, _, _ := GetEmbeddingWithProvider(ctx, "search_document: "+content)
	t.Logf("cos con 'search_document: <contenido>' = %.4f", CosineSimilarity(stored, e))

	// ¿Y contra el texto truncado a 1000 bytes?
	if len(content) > 1000 {
		e2, _, _ := GetEmbeddingWithProvider(ctx, content[:1000])
		t.Logf("cos con contenido[:1000] = %.4f", CosineSimilarity(stored, e2))
	}
}

func sqrtf(f float64) float64 {
	if f <= 0 {
		return 0
	}
	x := f
	for i := 0; i < 20; i++ {
		x = 0.5 * (x + f/x)
	}
	return x
}
