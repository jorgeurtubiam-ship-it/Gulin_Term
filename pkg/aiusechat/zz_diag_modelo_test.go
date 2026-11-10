package aiusechat

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	sqlite_vec "github.com/asg017/sqlite-vec-go-bindings/cgo"
)

// TestDiagnoseModeloCambiado verifica si el MODELO de embeddings de Ollama
// cambio sin que el nombre del provider lo reflejare.
//
// Sintoma: el vector almacenado tiene max=0.232 y el embedding actual del
// MISMO texto tiene max=0.1197, con cos=0.0464. El texto es el mismo, el
// provider se llama igual, pero los vectores viven en espacios distintos.
//
// Si el modelo cambio (nomic-embed-text -> otro, u otro host/PUERTO), la
// columna embedding_provider NO sirve para detectarlo: ambos registros
// dicen "ollama-nomic-embed-text".
func TestDiagnoseModeloCambiado(t *testing.T) {
	if os.Getenv("GULIN_DIAG") == "" {
		t.Skip("test de diagnostico manual: exporta GULIN_DIAG=1 para ejecutarlo")
	}
	sqlite_vec.Auto()
	ctx := context.Background()

	// 1. Distribucion real de providers en la DB
	home, _ := os.UserHomeDir()
	dbPath := filepath.Join(home, "Gulin_Workspace", "config", "gulin_global_memory.db")
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	t.Log("=== 1. DISTRIBUCION REAL DE embedding_provider ===")
	rows, err := db.QueryContext(ctx, `SELECT COALESCE(embedding_provider,'<NULL>'), COUNT(*)
		FROM knowledge GROUP BY 1 ORDER BY 2 DESC`)
	if err != nil {
		t.Logf("error: %v", err)
	} else {
		for rows.Next() {
			var p string
			var c int
			rows.Scan(&p, &c)
			t.Logf("  %-30s %d", p, c)
		}
		rows.Close()
	}

	// 2. Configuracion efectiva del endpoint/modelo
	t.Logf("")
	t.Logf("=== 2. CONFIGURACION EFECTIVA ===")
	t.Logf("  endpoint: %s", GetOllamaEmbeddingEndpoint())
	t.Logf("  modelo:   %s", GetOllamaEmbeddingModel())

	// 3. Que modelos tiene disponibles el servidor Ollama?
	t.Logf("")
	t.Logf("=== 3. MODELOS DISPONIBLES EN EL SERVIDOR ===")
	endpoint := GetOllamaEmbeddingEndpoint()
	resp, err := http.Get(endpoint + "/api/tags")
	if err != nil {
		t.Logf("  no se pudo consultar /api/tags: %v", err)
	} else {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		var tags struct {
			Models []struct {
				Name   string `json:"name"`
				Size   int64  `json:"size"`
				Family string `json:"family"`
			} `json:"models"`
		}
		if err := json.Unmarshal(body, &tags); err != nil {
			t.Logf("  respuesta no parseable: %v (raw=%s)", err, truncate(string(body), 200))
		} else {
			for _, m := range tags.Models {
				t.Logf("  - %s (family=%s size=%d)", m.Name, m.Family, m.Size)
			}
			if len(tags.Models) == 0 {
				t.Logf("  (sin modelos)")
			}
		}
	}

	// 4. La dimension que devuelve REALMENTE el provider
	t.Logf("")
	t.Logf("=== 4. DIMENSIONES REALES ===")
	for _, spec := range embeddingProviderOrder {
		emb, err := spec.fn(ctx, "prueba")
		if err != nil {
			t.Logf("  %-26s ERROR %v", spec.name, err)
			continue
		}
		min, max := emb[0], emb[0]
		for _, v := range emb {
			if v < min {
				min = v
			}
			if v > max {
				max = v
			}
		}
		t.Logf("  %-26s dims=%d min=%.5f max=%.5f", spec.name, len(emb), min, max)
	}

	// 5. Comparacion chunk a chunk: algunos chunks Devarian del provider actual
	t.Logf("")
	t.Logf("=== 5. CONSISTENCIA DE CADA CHUNK CON EL PROVIDER ACTUAL ===")
	rows2, err := db.QueryContext(ctx, `SELECT k.filepath, k.content, COALESCE(k.embedding_provider,'')
		FROM knowledge k JOIN knowledge_vec kv ON k.id = kv.knowledge_id
		WHERE k.embedding_provider IS NOT NULL AND k.embedding_provider != ''
		ORDER BY RANDOM() LIMIT 25`)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows2.Close()
	for rows2.Next() {
		var fp, content, prov string
		rows2.Scan(&fp, &content, &prov)
		var blob []byte
		db.QueryRowContext(ctx, "SELECT embedding FROM knowledge_vec WHERE knowledge_id = (SELECT id FROM knowledge WHERE filepath=?)", fp).Scan(&blob)
		stored, err := floatsFromBytes(blob)
		if err != nil {
			continue
		}
		e, _, err := GetEmbeddingWithProvider(ctx, content)
		if err != nil {
			continue
		}
		cos := float64(CosineSimilarity(stored, e))
		flag := "OK"
		if cos < 0.9 {
			flag = "<<< INCONSISTENTE"
		}
		t.Logf("  cos=%.4f prov=%-26s %s %s", cos, prov, flag, fp)
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

var _ = fmt.Sprintf
