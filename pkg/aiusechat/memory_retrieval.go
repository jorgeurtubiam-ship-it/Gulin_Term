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

// memoryTotalSlots es el numero maximo de ficheros de memoria que se
// seleccionan por consulta (suma de los cupos por corpus).
var memoryTotalSlots = func() int {
	total := 0
	for _, q := range memoryCorpusQuotas {
		total += q
	}
	return total
}()

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
//
// REGLA: un token de 2 caracteres NO se descarta si parece una clave de
// host/infraestructura ("p8", "db", "dg", "awr"). El caso real que lo
// motivation: el usuario escribe "las p8 oraprod" y "p8" era descartado
// por len < 3, dejando la query sin ningun token que enlazase con
// `oraprod_p8` / `basepro_p8` de memoria/cliente-fasa.md.
func memoryQueryTokens(query string) []string {
	fields := strings.Fields(strings.ToLower(query))
	out := []string{}
	for _, w := range fields {
		w = strings.Trim(w, "@,.?!:;\"'()[]{}")
		if w == "" {
			continue
		}
		if len(w) < 3 {
			// Solo se mantienen tokens cortos que son claves de infra conocidas.
			if !memoryShortTokens[w] {
				continue
			}
			out = append(out, w)
			continue
		}
		if memoryStopWords[w] {
			continue
		}
		out = append(out, w)
	}
	return out
}

// memoryShortTokens: tokens de 2-3 chars que son identificadores de
// infraestructura y NO deben filtrarse por longitud.
var memoryShortTokens = map[string]bool{
	"p8": true, "db": true, "dg": true, "awr": true, "ash": true,
	"addm": true, "srl": true, "rta": true, "os": true, "vm": true,
	"ip": true, "cpu": true, "sql": true, "tns": true, "asm": true,
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
//
// Ademas se aceptan ALIAS de host: el usuario dice "las p8" y no "fasa",
// pero las p8 (oraprod_p8 / basepro_p8) SON el cliente FASA. Sin esto, el
// corpus clientes/ quedaba bloqueado y sus 32 rutas eran inalcanzables.
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
	// Tambien por token exacto (evita que "fasa" matchee "fascinante").
	for _, t := range memoryQueryTokens(query) {
		if t == client {
			return true
		}
	}
	// Alias de host -> cliente: "p8" pertenece a FASA.
	for alias, target := range memoryClientAliases {
		if alias == target {
			continue
		}
		if !memoryQueryMentionsAlias(query, alias) {
			continue
		}
		if target == client {
			return true
		}
	}
	return false
}

// memoryClientAliases mapea alias de host a cliente. "p8" -> "fasa".
var memoryClientAliases = map[string]string{
	"p8": "fasa",
}

// memoryQueryMentionsAlias indica si el query menciona un alias concreto.
// Para "p8" exige que sea un token propio (no dentro de otra palabra).
func memoryQueryMentionsAlias(query, alias string) bool {
	for _, t := range memoryQueryTokens(query) {
		if t == alias {
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

	// Reparto por corpus: los cupos son un MINIMO garantizado, NO un techo.
	//
	// BUG ORIGINAL (medido con el gold set A/B): se iteraba por corpus en
	// orden fijo (playbooks -> learned -> clientes -> memoria) y cada corpus
	// se comia su cupo con sus MEJORES ficheros, aunque su score fuera
	// mediocre. Resultado: 3 ficheros "learned" de Data Guard (irrelevantes
	// para la pregunta) expulsaban al fichero "memoria" semanticamente
	// correcto, y el top-3 empeoraba en 5 de 8 consultas.
	//
	// FIX: se ordena todo por score global y se recorre en ese orden. Solo
	// seSaltan ficheros que exceden su cuota si ya se ha cubierto el MINIMO
	// de ese corpus con ficheros de score igual o mejor. Asi la cuota aporta
	// diversidad sin pisar al mejor candidato.
	selected := []string{}
	used := map[string]bool{}
	corpusCount := map[string]int{}

	// Candidatos globales ordenados por score ajustado (descendente).
	type cand struct {
		file string
		adj  float64
	}
	cands := make([]cand, 0, len(fileOrder))
	for _, f := range fileOrder {
		cands = append(cands, cand{file: f, adj: byFile[f][0].adj})
	}
	sort.SliceStable(cands, func(i, j int) bool { return cands[i].adj > cands[j].adj })

	for _, c := range cands {
		if len(selected) >= memoryTotalSlots {
			break
		}
		corpus := classifyMemoryCorpus(c.file)
		quota := memoryCorpusQuotas[corpus]
		if quota <= 0 {
			continue
		}
		// Los datos de cliente solo entran si el cliente esta en el query.
		if corpus == CorpusClientes && !queryMentionsClient(query, c.file) {
			continue
		}
		// Techo por corpus: evita que un corpus domine el prompt.
		if corpusCount[corpus] >= quota {
			continue
		}
		used[c.file] = true
		selected = append(selected, c.file)
		corpusCount[corpus]++
	}

	// Segunda pasada: se garantiza el minimo por corpus. Si un corpus no
	// llego al minimo (porque sus ficheros estaban por debajo del corte),
	// se rellena con los siguientes de ese corpus por score.
	const corpusMinGuaranteed = 1
	for _, corpus := range []string{CorpusPlaybooks, CorpusLearned, CorpusClientes, CorpusMemoria, CorpusOtros} {
		if corpusCount[corpus] >= corpusMinGuaranteed {
			continue
		}
		quota := memoryCorpusQuotas[corpus]
		if quota <= 0 {
			continue
		}
		group := []cand{}
		for _, c := range cands {
			if classifyMemoryCorpus(c.file) == corpus && !used[c.file] {
				group = append(group, c)
			}
		}
		for _, c := range group {
			if corpusCount[corpus] >= corpusMinGuaranteed {
				break
			}
			if corpus == CorpusClientes && !queryMentionsClient(query, c.file) {
				continue
			}
			used[c.file] = true
			selected = append(selected, c.file)
			corpusCount[corpus]++
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
