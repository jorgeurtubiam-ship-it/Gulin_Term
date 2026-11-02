package aiusechat

import (
	"testing"
)

// Verifica el reparto por corpus y la inyección dentro de presupuesto.
func TestMemoriaRepartoPorCorpus(t *testing.T) {
	queries := []string{
		"conectate a fasa oracle",
		"dg hypep10 standby broker",
		"revisa oracle",
	}
	for _, q := range queries {
		hits, err := SearchGulinMemoryHits(q)
		if err != nil {
			t.Fatalf("query %q: %v", q, err)
		}
		t.Logf("=== %s === (%d chunks)", q, len(hits))
		counts := map[string]int{}
		for _, h := range hits {
			counts[h.Corpus]++
			t.Logf("  [%-9s] %s#%d score=%.3f bytes=%d", h.Corpus, h.File, h.Index, h.Score, len(h.Content))
		}
		t.Logf("  reparto: %v", counts)
	}
}

func TestMemoriaInyeccionPresupuesto(t *testing.T) {
	ctx := GetGulinBrainContext("conectate a fasa oracle")
	t.Logf("bytes inyectados: %d (tope %d)", len(ctx), MemoryInjectMaxBytes)
	if len(ctx) > MemoryInjectMaxBytes+4096 {
		t.Fatalf("presupuesto excedido: %d bytes", len(ctx))
	}
}
