// sizeanalyze.go
package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	sqlite_vec "github.com/asg017/sqlite-vec-go-bindings/cgo"
	_ "github.com/mattn/go-sqlite3"
)

func init() { sqlite_vec.Auto() }

func main() {
	dbPath := os.Args[1]
	workspace := os.Args[2]

	// ---- 1. Copy + VACUUM to measure reclaimable overhead ----
	tmp := "/tmp/vacuum_test.db"
	os.Remove(tmp)
	if out, err := exec.Command("cp", dbPath, tmp).CombinedOutput(); err != nil {
		log.Fatalf("cp failed: %v %s", err, out)
	}
	origInfo, _ := os.Stat(dbPath)
	fmt.Printf("ORIGINAL: %s\n", human(origInfo.Size()))

	db, err := sql.Open("sqlite3", tmp)
	if err != nil {
		log.Fatal(err)
	}
	start := nowSeconds()
	if _, err := db.Exec("VACUUM"); err != nil {
		fmt.Println("VACUUM err:", err)
	} else {
		fmt.Printf("VACUUM completado en %ds\n", nowSeconds()-start)
	}
	db.Close()

	vacInfo, _ := os.Stat(tmp)
	fmt.Printf("POST-VACUUM: %s\n", human(vacInfo.Size()))
	fmt.Printf("ESPACIO RECUPERABLE: %s (%.1f%%)\n\n",
		human(origInfo.Size()-vacInfo.Size()),
		float64(origInfo.Size()-vacInfo.Size())*100/float64(origInfo.Size()))

	// ---- 2. Reopen original and analyze orphans ----
	db2, err := sql.Open("sqlite3", dbPath+"?_busy_timeout=5000")
	if err != nil {
		log.Fatal(err)
	}
	defer db2.Close()

	// Distinct files and whether they still exist on disk
	fmt.Println("--- ARCHIVOS EN DB vs DISCO ---")
	rows, err := db2.Query(`SELECT DISTINCT substr(filepath,1,instr(filepath,'#')-1) FROM knowledge`)
	if err != nil {
		log.Fatal(err)
	}
	var files []string
	for rows.Next() {
		var f string
		rows.Scan(&f)
		files = append(files, f)
	}
	rows.Close()

	var orphans, missing []string
	for _, f := range files {
		// try several roots
		found := false
		for _, root := range []string{workspace, filepath.Join(workspace, "memory"), filepath.Join(workspace, "learned"), filepath.Join(workspace, "skills"), "/Users/lordzero1/Gulin_Workspace"} {
			cand := filepath.Join(root, f)
			if _, err := os.Stat(cand); err == nil {
				found = true
				break
			}
		}
		if !found {
			missing = append(missing, f)
		}
	}
	orphans = missing
	fmt.Printf("archivos distintos en DB : %d\n", len(files))
	fmt.Printf("NO EXISTEN en disco       : %d (%.1f%%)\n", len(orphans), float64(len(orphans))*100/float64(len(files)))

	// chunks belonging to missing files
	var orphanChunks int
	if len(orphans) > 0 {
		placeholders := make([]string, len(orphans))
		args := make([]any, len(orphans))
		for i, o := range orphans {
			placeholders[i] = "substr(filepath,1,instr(filepath,'#')-1) = ?"
			args[i] = o
		}
		q := "SELECT COUNT(*) FROM knowledge WHERE " + strings.Join(placeholders, " OR ")
		db2.QueryRow(q, args...).Scan(&orphanChunks)
	}
	fmt.Printf("chunks huérfanos          : %d (%.1f%% de %d)\n\n",
		orphanChunks, float64(orphanChunks)*100/5902, 5902)

	if len(orphans) > 0 {
		fmt.Println("--- TOP 20 HUÉRFANOS (por prefijo) ---")
		prefix := map[string]int{}
		for _, o := range orphans {
			p := o
			if i := strings.Index(o, "/"); i > 0 {
				p = o[:i]
			}
			prefix[p]++
		}
		for p, c := range prefix {
			fmt.Printf("  %-40s %d\n", p, c)
		}
		fmt.Println()
	}

	// ---- 3. Duplicate analysis (same content stored N times) ----
	fmt.Println("--- DUPLICADOS EXACTOS ---")
	var dupFiles, dupTotal int64
	db2.QueryRow(`SELECT COUNT(*), COALESCE(SUM(c),0) FROM (
	                SELECT COUNT(*) c FROM knowledge GROUP BY content HAVING COUNT(*)>1)`).Scan(&dupFiles, &dupTotal)
	fmt.Printf("grupos duplicados: %d, filas: %d (%.1f%%)\n", dupFiles, dupTotal, float64(dupTotal)*100/5902)

	// How many are cross-file duplicates (same content in different files)?
	var crossDup int64
	db2.QueryRow(`SELECT COUNT(*) FROM (
	                SELECT content FROM knowledge GROUP BY content
	                HAVING COUNT(*)>1 AND COUNT(DISTINCT substr(filepath,1,instr(filepath,'#')-1))>1)`).Scan(&crossDup)
	fmt.Printf("duplicados entre archivos distintos: %d grupos\n\n", crossDup)

	// ---- 4. Chunk overlap waste ----
	fmt.Println("--- OVERLAP DE CHUNKS ---")
	var totalChars, chunkChars int64
	db2.QueryRow(`SELECT SUM(LENGTH(content)), SUM(LENGTH(content))*100/90 FROM knowledge`).Scan(&totalChars, &chunkChars)
	fmt.Printf("chars de contenido: %d | con overlap 10%%: %d | desperdicio: %d (%.1f%%)\n",
		totalChars, chunkChars, chunkChars-totalChars, float64(chunkChars-totalChars)*100/float64(chunkChars))

	// ---- 5. Which prefixes consume the most ----
	fmt.Println("--- CONSUMO POR ORIGEN ---")
	rows2, _ := db2.Query(`SELECT substr(filepath,1,instr(filepath,'/')) d, COUNT(*) c, SUM(LENGTH(content)) l
	                       FROM knowledge GROUP BY d ORDER BY c DESC`)
	for rows2.Next() {
		var d string
		var c int
		var l int64
		rows2.Scan(&d, &c, &l)
		fmt.Printf("  %-30s chunks=%-6d texto=%s  vectores=%.2f MB\n", d, c, human(l), float64(c)*3072/(1024*1024))
	}
	rows2.Close()

	os.Remove(tmp)
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

func nowSeconds() int64 {
	return time.Now().Unix()
}
