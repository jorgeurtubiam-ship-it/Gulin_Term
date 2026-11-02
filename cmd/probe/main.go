// probe.go
package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"

	sqlite_vec "github.com/asg017/sqlite-vec-go-bindings/cgo"
	_ "github.com/mattn/go-sqlite3"
)

func init() { sqlite_vec.Auto() }

func main() {
	db, err := sql.Open("sqlite3", os.Args[1])
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	fmt.Println("--- sqlite_vec version ---")
	var v string
	if err := db.QueryRow("SELECT vec_version()").Scan(&v); err != nil {
		fmt.Println("vec_version err:", err)
	} else {
		fmt.Println("vec_version:", v)
	}

	fmt.Println("\n--- TODAS las tablas (sqlite_master) ---")
	rows, _ := db.Query(`SELECT type, name FROM sqlite_master ORDER BY type, name`)
	for rows.Next() {
		var t, n string
		rows.Scan(&t, &n)
		fmt.Printf("%-8s %s\n", t, n)
	}
	rows.Close()

	fmt.Println("\n--- schema de knowledge ---")
	rows2, _ := db.Query(`SELECT sql FROM sqlite_master WHERE name='knowledge'`)
	for rows2.Next() {
		var s sql.NullString
		rows2.Scan(&s)
		fmt.Println(s.String)
	}
	rows2.Close()

	fmt.Println("\n--- columnas de knowledge ---")
	rows3, _ := db.Query(`SELECT name FROM pragma_table_info('knowledge')`)
	for rows3.Next() {
		var n string
		rows3.Scan(&n)
		fmt.Println(" col:", n)
	}
	rows3.Close()

	fmt.Println("\n--- shadow tables de vec0 con conteo ---")
	rows4, _ := db.Query(`SELECT name FROM sqlite_master WHERE name LIKE 'knowledge_vec%'`)
	var names []string
	for rows4.Next() {
		var n string
		rows4.Scan(&n)
		names = append(names, n)
	}
	rows4.Close()
	for _, n := range names {
		var c int
		if err := db.QueryRow(fmt.Sprintf("SELECT COUNT(*) FROM %s", n)).Scan(&c); err != nil {
			fmt.Printf("  %-40s ERR %v\n", n, err)
			continue
		}
		fmt.Printf("  %-40s rows=%d\n", n, c)
	}

	fmt.Println("\n--- PRAGMA ---")
	for _, p := range []string{"page_size", "page_count", "freelist_count", "journal_mode", "auto_vacuum", "encoding", "user_version"} {
		var x any
		if err := db.QueryRow("PRAGMA " + p).Scan(&x); err != nil {
			fmt.Printf("  %-15s ERR %v\n", p, err)
			continue
		}
		fmt.Printf("  %-15s %v\n", p, x)
	}

	fmt.Println("\n--- vector blob sizes reales ---")
	var minLen, maxLen, sumLen int64
	var cnt int
	if err := db.QueryRow(`SELECT COUNT(*), COALESCE(MIN(LENGTH(embedding)),0), COALESCE(MAX(LENGTH(embedding)),0), COALESCE(SUM(LENGTH(embedding)),0) FROM knowledge_vec`).Scan(&cnt, &minLen, &maxLen, &sumLen); err != nil {
		fmt.Println("err:", err)
	} else {
		fmt.Printf("  filas=%d min=%d max=%d suma=%d bytes (%.2f MB)\n", cnt, minLen, maxLen, sumLen, float64(sumLen)/(1024*1024))
	}

	fmt.Println("\n--- knowledge: tamaño de filas ---")
	var minC, maxC, sumC int64
	var nk int
	db.QueryRow(`SELECT COUNT(*), COALESCE(MIN(LENGTH(content)),0), COALESCE(MAX(LENGTH(content)),0), COALESCE(SUM(LENGTH(content)),0) FROM knowledge`).Scan(&nk, &minC, &maxC, &sumC)
	fmt.Printf("  filas=%d min=%d max=%d suma=%d bytes (%.2f MB)\n", nk, minC, maxC, sumC, float64(sumC)/(1024*1024))
}
