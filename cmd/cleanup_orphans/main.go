// cleanup_orphans.go
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
	dbPath := os.Args[1]
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// 1. Report current state
	var total, orphans int
	db.QueryRow("SELECT COUNT(*) FROM knowledge").Scan(&total)
	db.QueryRow("SELECT COUNT(*) FROM knowledge WHERE filepath LIKE 'memoria/conversacion-completa-2026-10-28-dataguard-hypep10.md#%'").Scan(&orphans)
	fmt.Printf("BEFORE: knowledge=%d orphans=%d\n", total, orphans)

	// 2. Count orphans in vec table
	var vecOrphans int
	err = db.QueryRow("SELECT COUNT(*) FROM knowledge_vec WHERE knowledge_id IN (SELECT id FROM knowledge WHERE filepath LIKE 'memoria/conversacion-completa-2026-10-28-dataguard-hypep10.md#%')").Scan(&vecOrphans)
	if err != nil {
		fmt.Println("vec count err (may be ok):", err)
	} else {
		fmt.Printf("vec orphan rows: %d\n", vecOrphans)
	}

	// 3. Delete orphans (trigger removes vec rows)
	res, err := db.Exec("DELETE FROM knowledge WHERE filepath LIKE 'memoria/conversacion-completa-2026-10-28-dataguard-hypep10.md#%'")
	if err != nil {
		log.Fatal("delete failed: ", err)
	}
	n, _ := res.RowsAffected()
	fmt.Printf("DELETED knowledge rows: %d\n", n)

	// 4. Also delete any vec rows with no matching knowledge (true orphans)
	res2, err := db.Exec("DELETE FROM knowledge_vec WHERE knowledge_id NOT IN (SELECT id FROM knowledge)")
	if err != nil {
		fmt.Println("vec orphan cleanup skipped:", err)
	} else {
		n2, _ := res2.RowsAffected()
		fmt.Printf("DELETED vec orphan rows: %d\n", n2)
	}

	// 5. Report after + VACUUM
	var total2 int
	db.QueryRow("SELECT COUNT(*) FROM knowledge").Scan(&total2)
	fmt.Printf("AFTER: knowledge=%d\n", total2)

	if _, err := db.Exec("VACUUM"); err != nil {
		fmt.Println("vacuum err:", err)
	}
	var vc int
	db.QueryRow("SELECT COUNT(*) FROM knowledge_vec").Scan(&vc)
	fmt.Printf("AFTER: knowledge_vec=%d\n", vc)
}
