// renamematch.go
package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	sqlite_vec "github.com/asg017/sqlite-vec-go-bindings/cgo"
	_ "github.com/mattn/go-sqlite3"
)

func init() { sqlite_vec.Auto() }

var roots = []string{
	"/Users/lordzero1/Gulin_Workspace",
	"/Users/lordzero1/Gulin_Workspace_v3",
	"/Users/lordzero1/IA_LoRdZeRo/Gulin_Agent/gulin-term",
}

// numPrefix matches leading "NNN-" / "NNNb-" numbering
var numPrefix = regexp.MustCompile(`^\d+[a-z]?[-_]`)

// stripNum removes the numeric prefix so renames can be detected
func stripNum(s string) string {
	return numPrefix.ReplaceAllString(s, "")
}

type fentry struct {
	path   string
	chunks int
}

func main() {
	dbPath := os.Args[1]
	db, err := sql.Open("sqlite3", dbPath+"?_busy_timeout=5000")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	rows, err := db.Query(`SELECT substr(filepath,1,instr(filepath,'#')-1) f, COUNT(*) c
	                       FROM knowledge GROUP BY f`)
	if err != nil {
		log.Fatal(err)
	}
	var entries []fentry
	for rows.Next() {
		var e fentry
		rows.Scan(&e.path, &e.chunks)
		entries = append(entries, e)
	}
	rows.Close()

	// Build index of every .md on disk: by (dir, strippedBase) -> path
	diskIndex := map[string][]string{}
	diskAll := 0
	for _, root := range roots {
		filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
			if err != nil || info == nil || info.IsDir() {
				return nil
			}
			if !strings.HasSuffix(strings.ToLower(p), ".md") {
				return nil
			}
			diskAll++
			rel, rerr := filepath.Rel(root, p)
			if rerr != nil {
				return nil
			}
			key := filepath.Dir(rel) + "|" + stripNum(filepath.Base(rel))
			diskIndex[key] = append(diskIndex[key], rel)
			return nil
		})
	}
	fmt.Printf("archivos .md en disco (raices escaneadas): %d\n\n", diskAll)

	// Classify each DB entry
	var exact, renamed, trulyGone int
	var renameChunks, goneChunks int
	var examples []string
	var goneExamples []string

	for _, e := range entries {
		if existsAny(e.path) {
			exact++
			continue
		}
		// try rename match: same dir + same base without numeric prefix
		dir := filepath.Dir(e.path)
		base := filepath.Base(e.path)
		key := dir + "|" + stripNum(base)
		if cands, ok := diskIndex[key]; ok && len(cands) > 0 {
			renamed++
			renameChunks += e.chunks
			if len(examples) < 12 {
				examples = append(examples, fmt.Sprintf("  DB: %-62s -> disco: %s", e.path, cands[0]))
			}
			continue
		}
		trulyGone++
		goneChunks += e.chunks
		if len(goneExamples) < 12 {
			goneExamples = append(goneExamples, fmt.Sprintf("  %s (chunks=%d)", e.path, e.chunks))
		}
	}

	total := len(entries)
	fmt.Println("=== CLASIFICACION DE LOS 2680 ARCHIVOS INDEXADOS ===")
	fmt.Printf("VIVOS (path existe)      : %d (%.1f%%)\n", exact, float64(exact)*100/float64(total))
	fmt.Printf("RENOMBRADOS (existe otro): %d (%.1f%%)  chunks=%d\n", renamed, float64(renamed)*100/float64(total), renameChunks)
	fmt.Printf("DESAPARECIDOS (basura)   : %d (%.1f%%)  chunks=%d\n", trulyGone, float64(trulyGone)*100/float64(total), goneChunks)

	fmt.Println("\n--- EJEMPLOS DE RENOMBRADOS (contenido recuperable, se reindexa) ---")
	for _, x := range examples {
		fmt.Println(x)
	}
	fmt.Println("\n--- EJEMPLOS DE DESAPARECIDOS (contenido perdido) ---")
	for _, x := range goneExamples {
		fmt.Println(x)
	}

	// How much space is recoverable
	fmt.Printf("\n=== ESPACIO RECUPERABLE ===\n")
	fmt.Printf("chunks en huérfanos: %d = %.2f MB de vectores\n",
		renameChunks+goneChunks, float64(renameChunks+goneChunks)*3072/(1024*1024))
	fmt.Printf("  renombrados (se reindexan): %.2f MB\n", float64(renameChunks)*3072/(1024*1024))
	fmt.Printf("  basura (se pierde)       : %.2f MB\n", float64(goneChunks)*3072/(1024*1024))
}

func existsAny(rel string) bool {
	for _, root := range roots {
		if _, err := os.Stat(filepath.Join(root, rel)); err == nil {
			return true
		}
	}
	return false
}
