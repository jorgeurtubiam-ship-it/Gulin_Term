package aiusechat

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// ============================================================================
// Recuperación de memoria — Fase 1 del plan de mejora de memoria.
//
// Problema medido: la búsqueda semántica devolvía 3 chunks y la inyección
// volcaba el ARCHIVO COMPLETO de cada uno (hasta 32 KB por archivo) contra un
// presupuesto global de 24 KB. Resultado: un solo archivo agotaba el
// presupuesto y los siguientes nunca entraban, sin garantía de que el
// procedimiento correcto estuviera entre ellos.
//
// Aquí se implementa:
//   - búsqueda con N candidatos + reparto garantizado por corpus (D1/D2)
//   - boost por nombre de archivo en lugar de selección directa por nombre (D3)
//   - inyección por chunks (lo que se rankea es lo que se inyecta) (D4)
// ============================================================================

const (
	// Candidatos semánticos recuperados antes del reparto por corpus.
	MemorySemanticCandidates = 30
	// Boost aplicado al score cuando una palabra del query aparece en el
	// NOMBRE del archivo. Solo reordena candidatos: nunca selecciona un archivo
	// por su nombre (el fallback directo por nombre queda eliminado).
	MemoryFilenameBoost = 0.15
	// Chunks (de ~1000 bytes) inyectados por archivo.
	MemoryMaxChunksPerFile = 3
)

// Corpus de memoria. Cada uno tiene cupos garantizados en el reparto.
const (
	CorpusPlaybooks = "playbooks"
	CorpusLearned   = "learned"
	CorpusClientes  = "clientes"
	CorpusMemoria   = "memoria"
	CorpusOtros     = "otros"
)

// Cupos por corpus en el reparto de resultados.
var memoryCorpusQuotas = map[string]int{
	CorpusPlaybooks: 2,
	CorpusLearned:   3,
	CorpusClientes:  2,
	CorpusMemoria:   2,
	CorpusOtros:     1,
}

// Palabras vacías que generaban ruido en el matching por nombre.
var memoryStopWords = map[string]bool{
	"revisa": true, "revisar": true, "revision": true, "revise": true,
	"los": true, "las": true, "el": true, "la": true, "un": true, "una": true,
	"unos": true, "unas": true, "de": true, "del": true, "para": true, "por": true,
	"con": true, "que": true, "como": true, "este": true, "esta": true,
	"estos": true, "estas": true, "ese": true, "esa": true, "eso": true,
	"necesito": true, "quiero": true, "dame": true, "muestra": true,
	"ver": true, "verifica": true, "verificar": true,
	"archivo": true, "archivos": true, "info": true, "informacion": true,
	"sobre": true, "cuando": true, "donde": true, "hay": true,
	"son": true, "mis": true, "todo": true, "todos": true, "todas": true,
	"datos": true, "data": true, "cosa": true, "cosas": true,
	"tambien": true, "ahora": true, "aqui": true, "alli": true,
	"solo": true, "sin": true, "pero": true, "porque": true, "muy": true,
	"paso": true, "pasos": true, "forma": true, "hacer": true, "hace": true,
	"puedes": true, "puede": true, "tienes": true, "tenemos": true,
}

// Un hit de memoria: un chunk concreto de un archivo concreto.
type MemoryHit struct {
	File    string
	ChunkID string
	Index   int
	Content string
	Score   float64
	Corpus  string
}

// classifyMemoryCorpus decide a qué corpus pertenece un archivo (por su path
// relativo al workspace).
func classifyMemoryCorpus(filePath string) string {
	p := filepath.ToSlash(filePath)
	switch {
	case strings.HasPrefix(p, "memoria/playbooks/"):
		return CorpusPlaybooks
	case strings.HasPrefix(p, "learned/"):
		return CorpusLearned
	case strings.HasPrefix(p, "clientes/"):
		return CorpusClientes
	case strings.HasPrefix(p, "memoria/"):
		return CorpusMemoria
	default:
		return CorpusOtros
	}
}

// splitChunkPath separa "memoria/x.md#3" -> ("memoria/x.md", 3).
func splitChunkPath(chunkPath string) (string, int) {
	idx := strings.LastIndex(chunkPath, "#")
	if idx < 0 {
		return chunkPath, 0
	}
	n, err := strconv.Atoi(chunkPath[idx+1:])
	if err != nil {
		return chunkPath[:idx], 0
	}
	return chunkPath[:idx], n
}

// normalizeMemoryName normaliza un nombre de archivo para comparar tokens
// (minúsculas, sin guiones/guiones bajos).
func normalizeMemoryName(s string) string {
	s = strings.ToLower(s)
	s = strings.ReplaceAll(s, "-", "_")
	s = strings.ReplaceAll(s, " ", "_")
	s = strings.ReplaceAll(s, ".md", "")
	return s
}

// memoryQueryTokens devuelve los tokens significativos del query.
func memoryQueryTokens(query string) []string {
	fields := strings.Fields(strings.ToLower(query))
	out := []string{}
	for _, w := range fields {
		w = strings.Trim(w, "@,.?!:;\"'()[]{}")
		if len(w) < 3 || memoryStopWords[w] {
			continue
		}
		out = append(out, w)
	}
	return out
}

// memoryFilenameBoost devuelve el boost de score si una palabra del query
// aparece en el nombre del archivo. Antes esto era una SELECCIÓN directa que
// metía ruido ("revisa oracle" matcheaba dg-hypep10-oracle... por el nombre).
func memoryFilenameBoost(query, filePath string) float64 {
	tokens := memoryQueryTokens(query)
	if len(tokens) == 0 {
		return 0
	}
	name := normalizeMemoryName(filepath.Base(filePath))
	for _, t := range tokens {
		if strings.Contains(name, t) {
			return MemoryFilenameBoost
		}
	}
	return 0
}

// queryMentionsClient indica si el query menciona el cliente de la ruta
// "clientes/<cliente>/...". Solo entonces se usan los cupos de clientes/.
func queryMentionsClient(query, filePath string) bool {
	p := filepath.ToSlash(filePath)
	if !strings.HasPrefix(p, "clientes/") {
		return false
	}
	parts := strings.Split(p, "/")
	if len(parts) < 2 || parts[1] == "" {
		return false
	}
	client := strings.ToLower(parts[1])
	if len(client) < 3 {
		return false
	}
	q := strings.ToLower(query)
	if strings.Contains(q, client) {
		return true
	}
	// También por token exacto (evita que "fasa" matchee "fascinante").
	for _, t := range memoryQueryTokens(query) {
		if t == client {
			return true
		}
	}
	return false
}

// SearchGulinMemoryHits devuelve los chunks de memoria relevantes para un query,
// con reparto garantizado por corpus.
//
// Flujo:
//  1. KNN vectorial sobre el corpus completo (30 candidatos).
//  2. Boost de score (+0.15) si una palabra del query está en el nombre del archivo.
//  3. Reparto por corpus con cupos fijos (playbooks/learned/clientes/memoria),
//     de modo que un corpus ruidoso no se coma todos los slots.
//  4. Por archivo se seleccionan hasta 3 chunks contiguos alrededor del mejor,
//     para que el fragmento inyectado tenga contexto.
func SearchGulinMemoryHits(query string) ([]MemoryHit, error) {
	if strings.TrimSpace(query) == "" {
		return nil, nil
	}

	db, err := GetGlobalVectorDB()
	if err != nil {
		return nil, err
	}

	results, err := SearchSemantically(context.Background(), db, query, MemorySemanticCandidates)
	if err != nil {
		return nil, err
	}

	type scored struct {
		hit MemoryHit
		adj float64
	}

	byFile := map[string][]scored{}
	var fileOrder []string

	for _, r := range results {
		base, idx := splitChunkPath(r.FilePath)
		if base == "" {
			continue
		}
		adj := float64(r.Score) + memoryFilenameBoost(query, base)
		if _, ok := byFile[base]; !ok {
			fileOrder = append(fileOrder, base)
		}
		byFile[base] = append(byFile[base], scored{
			hit: MemoryHit{
				File:    base,
				ChunkID: r.FilePath,
				Index:   idx,
				Content: r.Content,
				Score:   float64(r.Score),
				Corpus:  classifyMemoryCorpus(base),
			},
			adj: adj,
		})
	}

	for k := range byFile {
		list := byFile[k]
		sort.SliceStable(list, func(i, j int) bool { return list[i].adj > list[j].adj })
		byFile[k] = list
	}

	// Reparto por corpus: cupos fijos, independientes del ranking global.
	selected := []string{}
	used := map[string]bool{}
	for _, corpus := range []string{CorpusPlaybooks, CorpusLearned, CorpusClientes, CorpusMemoria, CorpusOtros} {
		quota := memoryCorpusQuotas[corpus]
		if quota <= 0 {
			continue
		}
		group := []string{}
		for _, f := range fileOrder {
			if classifyMemoryCorpus(f) == corpus {
				group = append(group, f)
			}
		}
		sort.SliceStable(group, func(i, j int) bool {
			return byFile[group[i]][0].adj > byFile[group[j]][0].adj
		})
		taken := 0
		for _, f := range group {
			if taken >= quota {
				break
			}
			if used[f] {
				continue
			}
			// Los datos de cliente solo entran si el cliente está en el query.
			if corpus == CorpusClientes && !queryMentionsClient(query, f) {
				continue
			}
			used[f] = true
			selected = append(selected, f)
			taken++
		}
	}

	var hits []MemoryHit
	for _, f := range selected {
		byIdx := map[int]scored{}
		for _, c := range byFile[f] {
			byIdx[c.hit.Index] = c
		}
		best := byFile[f][0].hit.Index

		// Ventana contigua alrededor del mejor chunk: da contexto sin gastar
		// más de MemoryMaxChunksPerFile por archivo.
		chosen := []int{}
		for i := 0; i < MemoryMaxChunksPerFile; i++ {
			idx := best - 1 + i
			if _, ok := byIdx[idx]; ok {
				chosen = append(chosen, idx)
			}
		}
		if len(chosen) == 0 {
			chosen = []int{best}
		}
		sort.Ints(chosen)

		for _, idx := range chosen {
			c, ok := byIdx[idx]
			if !ok {
				// El vecino no estaba entre los candidatos: lo recuperamos de la DB.
				content, err := loadMemoryChunkContent(db, f, idx)
				if err != nil || content == "" {
					continue
				}
				c = scored{hit: MemoryHit{
					File:    f,
					ChunkID: fmt.Sprintf("%s#%d", f, idx),
					Index:   idx,
					Content: content,
					Score:   byFile[f][0].hit.Score,
					Corpus:  classifyMemoryCorpus(f),
				}, adj: byFile[f][0].adj}
			}
			hits = append(hits, c.hit)
		}
	}

	return hits, nil
}

// loadMemoryChunkContent lee el contenido de un chunk concreto por su ruta.
func loadMemoryChunkContent(db interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, filePath string, index int) (string, error) {
	var content string
	err := db.QueryRowContext(context.Background(),
		"SELECT content FROM knowledge WHERE filepath = ?", fmt.Sprintf("%s#%d", filePath, index)).Scan(&content)
	if err != nil {
		return "", err
	}
	return content, nil
}

// fallbackMemoryFiles devuelve los archivos a inyectar cuando la búsqueda
// semántica no devuelve nada (sesion-actual primero).
func fallbackMemoryFiles(files []string) []string {
	out := []string{}
	sessionFound := false
	for _, f := range files {
		if filepath.Base(f) == "sesion-actual.md" {
			out = append(out, f)
			sessionFound = true
			break
		}
	}
	for _, f := range files {
		if len(out) >= 3 {
			break
		}
		if filepath.Base(f) == "sesion-actual.md" {
			continue
		}
		out = append(out, f)
	}
	if !sessionFound && len(out) == 0 {
		for i, f := range files {
			if i >= 3 {
				break
			}
			out = append(out, f)
		}
	}
	return out
}

// truncateMemoryForIndex recorta el contenido que se indexa, conservando la
// cabecera (título y contexto) y el final (donde suelen estar las conclusiones
// y las lecciones). Antes los .md de más de 500 KB se descartaban y los de
// 20-500 KB se indexaban enteros, consumiendo la mayor parte del ranking con
// ruido de un único archivo.
func truncateMemoryForIndex(content string) string {
	const maxIndexBytes = 20 * 1024
	if len(content) <= maxIndexBytes {
		return content
	}
	head := 14 * 1024
	tail := 6 * 1024
	return content[:head] +
		"\n\n[...contenido intermedio omitido en la indexación...]\n\n" +
		content[len(content)-tail:]
}
