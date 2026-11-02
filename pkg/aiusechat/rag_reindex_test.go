//go:build cgo

package aiusechat

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// TestReindexReplacesChunks verifies the root-cause fix: re-indexing a file must
// REPLACE its chunks instead of failing with "UNIQUE constraint failed".
//
// Before the fix, InsertFileChunks ran:
//     DELETE FROM knowledge WHERE filepath = ?      <- matched ZERO rows
// while chunks are stored as "<filePath>#<chunkIndex>". The old rows therefore
// survived and the re-insert hit the UNIQUE constraint on knowledge.filepath.
func TestReindexReplacesChunks(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test_vector.db")

	db, err := InitVectorDB(dbPath)
	if err != nil {
		t.Fatalf("InitVectorDB failed: %v", err)
	}
	defer db.Close()

	ctx := context.Background()

	// Deterministic embeddings so the test never touches the network.
	restore := stubEmbeddings(func(text string) ([]float32, error) {
		emb := make([]float32, 768)
		for i := range emb {
			emb[i] = float32((i + len(text)) % 97) / 97.0
		}
		return emb, nil
	})
	defer restore()

	// A file path containing '_' and '*' would break LIKE/GLOB based matching.
	filePath := "memoria/004-insight-read_text_file.md"

	// --- First index ---
	if err := InsertFileChunks(ctx, db, filePath, "primera version del contenido", ""); err != nil {
		t.Fatalf("first InsertFileChunks failed: %v", err)
	}

	count1 := countRows(t, db, filePath)
	if count1 != 1 {
		t.Fatalf("expected 1 chunk after first index, got %d", count1)
	}

	// --- Second index of the SAME file: this used to fail with UNIQUE constraint ---
	if err := InsertFileChunks(ctx, db, filePath, "segunda version del contenido", ""); err != nil {
		t.Fatalf("REINDEX FAILED (this is the bug being fixed): %v", err)
	}

	count2 := countRows(t, db, filePath)
	if count2 != 1 {
		t.Fatalf("expected exactly 1 chunk after re-index (old chunk not replaced), got %d", count2)
	}

	// The content must be the NEW one, not a mix.
	var content string
	if err := db.QueryRow("SELECT content FROM knowledge WHERE substr(filepath, 1, ?) = ?", len(filePath)+1, filePath+"#").Scan(&content); err != nil {
		t.Fatalf("failed to read chunk content: %v", err)
	}
	if content != "segunda version del contenido" {
		t.Errorf("stale chunk kept: got %q, want %q", content, "segunda version del contenido")
	}

	// The vector rows must stay in sync (the DELETE trigger removes them).
	var vecCount int
	if err := db.QueryRow("SELECT COUNT(*) FROM knowledge_vec").Scan(&vecCount); err != nil {
		t.Fatalf("failed to count knowledge_vec: %v", err)
	}
	if vecCount != 1 {
		t.Errorf("orphaned vector rows: got %d, want 1", vecCount)
	}
}

// TestReindexMultipleChunks verifies that a multi-chunk file is fully replaced.
func TestReindexMultipleChunks(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test_vector_multi.db")

	db, err := InitVectorDB(dbPath)
	if err != nil {
		t.Fatalf("InitVectorDB failed: %v", err)
	}
	defer db.Close()

	ctx := context.Background()

	restore := stubEmbeddings(func(text string) ([]float32, error) {
		emb := make([]float32, 768)
		for i := range emb {
			emb[i] = float32((i + len(text)) % 97) / 97.0
		}
		return emb, nil
	})
	defer restore()

	filePath := "memoria/multi_chunk_file.md"

	// ~2500 chars with chunkSize 1000 / overlap 100 => 3 chunks.
	big := ""
	for i := 0; i < 2500; i++ {
		big += "x"
	}

	if err := InsertFileChunks(ctx, db, filePath, big, ""); err != nil {
		t.Fatalf("first InsertFileChunks failed: %v", err)
	}
	n1 := countRows(t, db, filePath)
	if n1 < 2 {
		t.Fatalf("expected multiple chunks, got %d", n1)
	}

	if err := InsertFileChunks(ctx, db, filePath, "contenido corto nuevo", ""); err != nil {
		t.Fatalf("REINDEX FAILED: %v", err)
	}

	n2 := countRows(t, db, filePath)
	if n2 != 1 {
		t.Errorf("expected 1 chunk after re-index, got %d", n2)
	}

	var vecCount int
	if err := db.QueryRow("SELECT COUNT(*) FROM knowledge_vec").Scan(&vecCount); err != nil {
		t.Fatalf("failed to count knowledge_vec: %v", err)
	}
	if vecCount != 1 {
		t.Errorf("orphaned vector rows: got %d, want 1", vecCount)
	}
}

// TestGetFileUpdatedAtUsesChunkPrefix verifies the timestamp lookup matches the
// same chunk naming scheme used by InsertFileChunks.
func TestGetFileUpdatedAtUsesChunkPrefix(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test_vector_ts.db")

	db, err := InitVectorDB(dbPath)
	if err != nil {
		t.Fatalf("InitVectorDB failed: %v", err)
	}
	defer db.Close()

	ctx := context.Background()

	restore := stubEmbeddings(func(text string) ([]float32, error) {
		emb := make([]float32, 768)
		return emb, nil
	})
	defer restore()

	filePath := "memoria/timestamp_file.md"
	if err := InsertFileChunks(ctx, db, filePath, "contenido", ""); err != nil {
		t.Fatalf("InsertFileChunks failed: %v", err)
	}

	ts, err := GetFileUpdatedAt(ctx, db, filePath)
	if err != nil {
		t.Fatalf("GetFileUpdatedAt failed: %v", err)
	}
	if ts == 0 {
		t.Errorf("GetFileUpdatedAt returned 0, expected a real timestamp")
	}

	// A different file must not be matched.
	ts2, err := GetFileUpdatedAt(ctx, db, "memoria/otro_archivo.md")
	if err != nil {
		t.Fatalf("GetFileUpdatedAt failed: %v", err)
	}
	if ts2 != 0 {
		t.Errorf("GetFileUpdatedAt matched a different file: got %d", ts2)
	}
}

// TestWALAndPragmasApplied verifies the concurrency settings actually took effect.
func TestWALAndPragmasApplied(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test_vector_wal.db")

	db, err := InitVectorDB(dbPath)
	if err != nil {
		t.Fatalf("InitVectorDB failed: %v", err)
	}
	defer db.Close()

	var journalMode string
	if err := db.QueryRow("PRAGMA journal_mode").Scan(&journalMode); err != nil {
		t.Fatalf("failed to read journal_mode: %v", err)
	}
	if journalMode != "wal" {
		t.Errorf("journal_mode = %q, want wal", journalMode)
	}

	var busyTimeout int
	if err := db.QueryRow("PRAGMA busy_timeout").Scan(&busyTimeout); err != nil {
		t.Fatalf("failed to read busy_timeout: %v", err)
	}
	if busyTimeout != 10000 {
		t.Errorf("busy_timeout = %d, want 10000", busyTimeout)
	}
}

// TestClientIDMigration verifies that a legacy DB (no client_id column) is migrated.
func TestClientIDMigration(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test_legacy.db")

	// Create a legacy DB without client_id.
	legacy, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		t.Fatalf("failed to open legacy db: %v", err)
	}
	if _, err := legacy.Exec(`
		CREATE TABLE knowledge (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			filepath TEXT UNIQUE NOT NULL,
			content TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		);`); err != nil {
		t.Fatalf("failed to create legacy schema: %v", err)
	}
	legacy.Close()

	db, err := InitVectorDB(dbPath)
	if err != nil {
		t.Fatalf("InitVectorDB on legacy DB failed: %v", err)
	}
	defer db.Close()

	rows, err := db.Query("PRAGMA table_info(knowledge)")
	if err != nil {
		t.Fatalf("failed to inspect schema: %v", err)
	}
	defer rows.Close()

	found := false
	for rows.Next() {
		var cid int
		var name string
		var colType string
		var notNull int
		var dfltValue any
		var pk int
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dfltValue, &pk); err != nil {
			t.Fatalf("failed to scan schema: %v", err)
		}
		if name == "client_id" {
			found = true
		}
	}
	if !found {
		t.Errorf("client_id column was NOT added by the migration")
	}
}

// --- helpers ---

func countRows(t *testing.T, db *sql.DB, filePath string) int {
	t.Helper()
	var n int
	err := db.QueryRow("SELECT COUNT(*) FROM knowledge WHERE substr(filepath, 1, ?) = ?", len(filePath)+1, filePath+"#").Scan(&n)
	if err != nil {
		t.Fatalf("failed to count rows: %v", err)
	}
	return n
}

// stubEmbeddings replaces the embedding provider for the duration of a test.
func stubEmbeddings(fn func(string) ([]float32, error)) func() {
	prev := embeddingProvider
	embeddingProvider = fn
	return func() { embeddingProvider = prev }
}

func TestMain(m *testing.M) {
	os.Exit(m.Run())
}

var _ = fmt.Sprintf
