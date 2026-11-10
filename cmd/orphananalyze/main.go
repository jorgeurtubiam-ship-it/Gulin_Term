// orphananalyze.go
package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	sqlite_vec "github.com/asg017/sqlite-vec-go-bindings/cgo"
	_ "github.com/mattn/go-sqlite3"
)

func init() { sqlite_vec.Auto() }

// roots donde puede estar cada archivo indexado
var roots = []string{
	"/Users/lordzero1/Gulin_Workspace",
	"/Users/lordzero1/Gulin_Workspace/memory",
	"/Users/lordzero1/Gulin_Workspace/learned",
	"/Users/lordzero1/Gulin_Workspace/skills",
	"/Users/lordzero1/Gulin_Workspace/memoria",
	"/Users/lordzero1/IA_LoRdZeRo/Gulin_Agent/gulin-term",
	"/Users/lordzero1/Gulin_Workspace_v3",
}

type fileEntry struct {
	path   string
	chunks int
	bytes  int64
}

func main() {
	dbPath := os.Args[1]

	db, err := sql.Open("sqlite3", dbPath+"?_busy_timeout=5000")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// 1. Cargar todos los archivos indexados con su peso
	rows, err := db.Query(`SELECT substr(filepath,1,instr(filepath,'#')-1) f,
	                              COUNT(*) c, COALESCE(SUM(LENGTH(content)),0) l
	                       FROM knowledge GROUP BY f`)
	if err != nil {
		log.Fatal(err)
	}
	var entries []fileEntry
	totalChunks := 0
	var totalBytes int64
	for rows.Next() {
		var e fileEntry
		rows.Scan(&e.path, &e.chunks, &e.bytes)
		entries = append(entries, e)
		totalChunks += e.chunks
		totalBytes += e.bytes
	}
	rows.Close()

	fmt.Printf("archivos en DB: %d | chunks: %d | texto: %s\n\n",
		len(entries), totalChunks, human(totalBytes))

	// 2. Verificar existencia en disco (cache de directorios para velocidad)
	dirCache := map[string]bool{}
	exists := func(rel string) bool {
		for _, root := range roots {
			full := filepath.Join(root, rel)
			dir := filepath.Dir(full)
			if _, ok := dirCache[dir]; !ok {
				if st, err := os.Stat(dir); err == nil && st.IsDir() {
					dirCache[dir] = true
				} else {
					dirCache[dir] = false
				}
			}
			if dirCache[dir] {
				if _, err := os.Stat(full); err == nil {
					return true
				}
			}
		}
		return false
	}

	var orphans []fileEntry
	var live []fileEntry
	for _, e := range entries {
		if exists(e.path) {
			live = append(live, e)
		} else {
			orphans = append(orphans, e)
		}
	}

	orphanChunks := 0
	var orphanBytes int64
	for _, o := range orphans {
		orphanChunks += o.chunks
		orphanBytes += o.bytes
	}
	fmt.Println("=== ARCHIVOS HUÉRFANOS (en DB, no en disco) ===")
	fmt.Printf("archivos : %d de %d (%.1f%%)\n", len(orphans), len(entries), float64(len(orphans))*100/float64(len(entries)))
	fmt.Printf("chunks   : %d de %d (%.1f%%)\n", orphanChunks, totalChunks, float64(orphanChunks)*100/float64(totalChunks))
	fmt.Printf("texto    : %s de %s (%.1f%%)\n", human(orphanBytes), human(totalBytes), float64(orphanBytes)*100/float64(totalBytes))
	fmt.Printf("vectores : %.2f MB de %.2f MB (%.1f%%)\n",
		float64(orphanChunks)*3072/(1024*1024), float64(totalChunks)*3072/(1024*1024),
		float64(orphanChunks)*100/float64(totalChunks))

	// 3. Distribución de huérfanos por prefijo
	if len(orphans) > 0 {
		fmt.Println("\n--- HUÉRFANOS POR PREFIJO ---")
		agg := map[string]int{}
		aggChunks := map[string]int{}
		for _, o := range orphans {
			p := o.path
			if i := strings.Index(o.path, "/"); i > 0 {
				p = o.path[:i]
			}
			agg[p]++
			aggChunks[p] += o.chunks
		}
		type kv struct {
			k string
			v int
		}
		var list []kv
		for k, v := range agg {
			list = append(list, kv{k, v})
		}
		sort.Slice(list, func(i, j int) bool { return list[i].v > list[j].v })
		for _, x := range list {
			fmt.Printf("  %-25s archivos=%-6d chunks=%-6d vectores=%.2f MB\n",
				x.k, x.v, aggChunks[x.k], float64(aggChunks[x.k])*3072/(1024*1024))
		}

		fmt.Println("\n--- TOP 15 HUÉRFANOS (mayor impacto) ---")
		sort.Slice(orphans, func(i, j int) bool { return orphans[i].chunks > orphans[j].chunks })
		for i, o := range orphans {
			if i >= 15 {
				break
			}
			fmt.Printf("  %-70s chunks=%d\n", trunc(o.path, 68), o.chunks)
		}
	}

	// 4. Pesos de archivos VIVOS por prefijo (para decidir qué excluir)
	fmt.Println("\n=== ARCHIVOS VIVOS POR ORIGEN ===")
	aggLive := map[string]int{}
	aggLiveChunks := map[string]int{}
	for _, e := range live {
		p := e.path
		if i := strings.Index(e.path, "/"); i > 0 {
			p = e.path[:i]
		}
		aggLive[p]++
		aggLiveChunks[p] += e.chunks
	}
	type kv2 struct {
		k string
		v int
	}
	var list2 []kv2
	for k, v := range aggLive {
		list2 = append(list2, kv2{k, v})
	}
	sort.Slice(list2, func(i, j int) bool { return list2[i].v > list2[j].v })
	for _, x := range list2 {
		fmt.Printf("  %-25s archivos=%-6d chunks=%-6d vectores=%.2f MB\n",
			x.k, x.v, aggLiveChunks[x.k], float64(aggLiveChunks[x.k])*3072/(1024*1024))
	}
}

func human(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.2f %cB", float64(b)/float64(div), "KMGT"[exp])
}

func trunc(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-3] + "..."
}
