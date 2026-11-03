//go:build cgo

package aiusechat

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	sqlite_vec "github.com/asg017/sqlite-vec-go-bindings/cgo"
	"github.com/gulindev/gulin/pkg/gulinbase"
	_ "github.com/mattn/go-sqlite3"
)

var (
	globalVectorDB *sql.DB
	workspaceDBs   = make(map[string]*sql.DB)
	dbMutex        sync.RWMutex
)

// init ensures sqlite-vec is registered
func init() {
	sqlite_vec.Auto()
}

// GetGlobalVectorDBPath returns the path to the global vector DB
func GetGlobalVectorDBPath() string {
	configDir := gulinbase.GetGulinConfigDir()
	return filepath.Join(configDir, "gulin_global_memory.db")
}

// GetWorkspaceVectorDBPath returns the path to the workspace vector DB
func GetWorkspaceVectorDBPath(dir string) string {
	return filepath.Join(dir, ".gulin", "workspace_memory.db")
}

// InitVectorDB initializes a database connection and sets up the schema
func InitVectorDB(dbPath string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		return nil, fmt.Errorf("failed to create directory for vector db: %w", err)
	}

	// Concurrency settings. Without these, concurrent writers (indexing + brain
	// context reads + agent tool calls) hit "database is locked" because the
	// default journal mode is "delete" and the busy timeout is 0.
	//
	// IMPORTANT: busy_timeout and synchronous are PER-CONNECTION settings in SQLite.
	// Running "PRAGMA busy_timeout=..." through db.Exec() would only apply it to
	// whichever pooled connection happened to serve that statement, so the DSN is
	// used instead to guarantee every connection gets the same pragmas.
	dsn := dbPath + "?_busy_timeout=10000&_journal_mode=WAL&_synchronous=NORMAL&_foreign_keys=on"
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open vector db: %w", err)
	}

	// A single writer avoids SQLITE_BUSY between concurrent transactions in this
	// process. WAL still allows concurrent readers.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	// Verify the pragmas actually took effect on the live connection.
	var journalMode string
	if err := db.QueryRow("PRAGMA journal_mode").Scan(&journalMode); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to read journal_mode: %w", err)
	}
	if !strings.EqualFold(journalMode, "wal") {
		db.Close()
		return nil, fmt.Errorf("failed to enable WAL journal mode (got %q)", journalMode)
	}

	schema := `
	CREATE TABLE IF NOT EXISTS knowledge (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		filepath TEXT UNIQUE NOT NULL,
		content TEXT NOT NULL,
		updated_at INTEGER NOT NULL,
		client_id TEXT,
		embedding_provider TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_knowledge_filepath ON knowledge(filepath);


	CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec USING vec0(
		knowledge_id INTEGER PRIMARY KEY,
		embedding FLOAT[768] -- Adjust according to your embedding model dimensions if needed
	);

	CREATE TRIGGER IF NOT EXISTS trig_knowledge_delete
	AFTER DELETE ON knowledge
	BEGIN
		DELETE FROM knowledge_vec WHERE knowledge_id = OLD.id;
	END;
	`
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to initialize schema: %w", err)
	}

	// Migrate older databases that were created before the client_id column existed.
	if err := ensureClientIDColumn(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to migrate client_id column: %w", err)
	}

	// Migrate older databases that were created before the embedding_provider
	// column existed. Without it the search cannot tell which vector space a
	// chunk belongs to, so a provider change silently corrupts the ranking.
	if err := ensureEmbeddingProviderColumn(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to migrate embedding_provider column: %w", err)
	}

	// Created after the migration: on legacy databases the column does not exist
	// yet when the schema block above runs, which would make the CREATE INDEX fail.
	if _, err := db.Exec("CREATE INDEX IF NOT EXISTS idx_knowledge_client ON knowledge(client_id)"); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to create client index: %w", err)
	}

	// NOTE: the orphaned-chunks purge is NOT run here on purpose.
	// It used to run in a background goroutine inside this constructor, which made
	// it race with any indexing done right after opening the database: the purge
	// could delete chunks that had just been inserted (it removes every chunk whose
	// base file is not present under the workspace directory), leaving the vector
	// DB empty for that file.
	// The purge is now explicit - see PurgeVectorDBOrphans - and the callers decide
	// when it is safe to run it.

	return db, nil
}

// ensureClientIDColumn adds the client_id column to pre-existing databases.
// SQLite has no "ADD COLUMN IF NOT EXISTS", so the schema is inspected first.
func ensureClientIDColumn(db *sql.DB) error {
	rows, err := db.Query("PRAGMA table_info(knowledge)")
	if err != nil {
		return fmt.Errorf("failed to inspect knowledge schema: %w", err)
	}
	defer rows.Close()

	hasClientID := false
	for rows.Next() {
		var cid int
		var name string
		var colType string
		var notNull int
		var dfltValue any
		var pk int
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dfltValue, &pk); err != nil {
			return fmt.Errorf("failed to scan knowledge schema: %w", err)
		}
		if name == "client_id" {
			hasClientID = true
			break
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("failed to iterate knowledge schema: %w", err)
	}

	if hasClientID {
		return nil
	}

	if _, err := db.Exec("ALTER TABLE knowledge ADD COLUMN client_id TEXT"); err != nil {
		return fmt.Errorf("failed to add client_id column: %w", err)
	}
	return nil
}

// ensureEmbeddingProviderColumn adds the embedding_provider column to
// pre-existing databases.
//
// This column records WHICH embedding model produced the stored vector.
// Vectors from different models live in different vector spaces: comparing
// them with cosine similarity produces meaningless scores and a garbage
// ranking. Storing the provider makes it possible to (a) filter the search
// by vector space and (b) know which chunks must be re-indexed after a
// provider change.
//
// Legacy rows get an empty string, which is treated as "unknown space" and
// excluded from the space-filtered search until the file is re-indexed.
func ensureEmbeddingProviderColumn(db *sql.DB) error {
	rows, err := db.Query("PRAGMA table_info(knowledge)")
	if err != nil {
		return fmt.Errorf("failed to inspect knowledge schema: %w", err)
	}
	defer rows.Close()

	hasProvider := false
	for rows.Next() {
		var cid int
		var name string
		var colType string
		var notNull int
		var dfltValue any
		var pk int
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dfltValue, &pk); err != nil {
			return fmt.Errorf("failed to scan knowledge schema: %w", err)
		}
		if name == "embedding_provider" {
			hasProvider = true
			break
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("failed to iterate knowledge schema: %w", err)
	}

	if hasProvider {
		return nil
	}

	if _, err := db.Exec("ALTER TABLE knowledge ADD COLUMN embedding_provider TEXT"); err != nil {
		return fmt.Errorf("failed to add embedding_provider column: %w", err)
	}
	return nil
}

// GetGlobalVectorDB returns the singleton global vector database
func GetGlobalVectorDB() (*sql.DB, error) {
	dbMutex.Lock()
	defer dbMutex.Unlock()

	if globalVectorDB != nil {
		return globalVectorDB, nil
	}

	db, err := InitVectorDB(GetGlobalVectorDBPath())
	if err != nil {
		return nil, err
	}
	globalVectorDB = db
	return db, nil
}

// GetWorkspaceVectorDB returns a singleton workspace vector database
func GetWorkspaceVectorDB(workspaceDir string) (*sql.DB, error) {
	dbMutex.Lock()
	defer dbMutex.Unlock()

	if db, ok := workspaceDBs[workspaceDir]; ok {
		return db, nil
	}

	db, err := InitVectorDB(GetWorkspaceVectorDBPath(workspaceDir))
	if err != nil {
		return nil, err
	}
	workspaceDBs[workspaceDir] = db
	return db, nil
}

// floatsToBytes converts a float32 slice to a byte slice for SQLite BLOB storage
func floatsToBytes(floats []float32) ([]byte, error) {
	buf := new(bytes.Buffer)
	err := binary.Write(buf, binary.LittleEndian, floats)
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// floatsFromBytes is the inverse of floatsToBytes: it decodes a BLOB back
// into a float32 slice.
//
// It is needed to inspect the vectors stored in the DB (to verify which
// vector space a chunk belongs to) and to score vectors in Go when the
// SQLite-vec extension is not available.
func floatsFromBytes(data []byte) ([]float32, error) {
	if len(data)%4 != 0 {
		return nil, fmt.Errorf("invalid float32 blob length: %d bytes", len(data))
	}
	floats := make([]float32, len(data)/4)
	if err := binary.Read(bytes.NewReader(data), binary.LittleEndian, floats); err != nil {
		return nil, err
	}
	return floats, nil
}

// GetFileUpdatedAt returns the last updated_at timestamp for a file, or 0 if not found
func GetFileUpdatedAt(ctx context.Context, db *sql.DB, filePath string) (int64, error) {
	var updatedAt int64
	// The prefix match used to use substr(filepath, 1, ?) = ?, which cannot use the
	// idx_knowledge_filepath index and forced a full table scan for EVERY file on
	// EVERY message (432 files x 1503 rows).
	// A range scan is used instead: [filePath# , filePath$) selects exactly the
	// chunks of that file and lets SQLite use the B-tree index (~3x faster).
	// LIKE is NOT used on purpose: '_' and '%' are LIKE wildcards and this
	// workspace has files such as "004-insight-read_text_file.md".
	// '#' (0x23) < '$' (0x24), so the range covers every "<filePath>#<chunk>".
	err := db.QueryRowContext(ctx,
		"SELECT MAX(updated_at) FROM knowledge WHERE filepath >= ? AND filepath < ?",
		filePath+"#", filePath+"$").Scan(&updatedAt)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		// If there are no rows that match LIKE, MAX returns NULL which causes scan error.
		// Handle this gracefully.
		return 0, nil
	}
	return updatedAt, nil
}

// HasChunksWithoutProvider reports whether the given file has chunks stored
// WITHOUT the embedding_provider tag.
//
// Those are the chunks indexed before the embedding_provider column existed:
// their vector space is unknown, so the space-filtered search excludes them.
// The caller must re-index the file to make it searchable again.
//
// The lookup uses the same B-tree range as GetFileUpdatedAt so it hits the
// idx_knowledge_filepath index instead of scanning the whole table.
func HasChunksWithoutProvider(ctx context.Context, db *sql.DB, filePath string) (bool, error) {
	var cnt int
	err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM knowledge WHERE filepath >= ? AND filepath < ? AND (embedding_provider IS NULL OR embedding_provider = '')",
		filePath+"#", filePath+"$").Scan(&cnt)
	if err != nil {
		return false, fmt.Errorf("failed to check legacy chunks for %s: %w", filePath, err)
	}
	return cnt > 0, nil
}

// InsertFileChunks processes text chunks, gets embeddings, and saves them to the DB.
// clientID scopes the chunks to a customer/project. Pass "" for global knowledge.
func InsertFileChunks(ctx context.Context, db *sql.DB, filePath string, text string, clientID string) error {
	chunks := ChunkText(text, 1000, 100)
	now := time.Now().Unix()

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Clean up old entries for this file.
	// NOTE: chunks are stored as "<filePath>#<chunkIndex>", so the DELETE must match
	// the suffix as well. The previous "filepath = ?" matched ZERO rows, which made
	// every re-index fail with "UNIQUE constraint failed: knowledge.filepath" and
	// left modified files permanently stale in the vector DB.
	// The prefix comparison is done with a B-tree RANGE instead of substr() or
	// LIKE/GLOB: substr() cannot use the index and forces a full table scan on
	// every re-index, while LIKE/GLOB treat '_' (and '*'/'?') as wildcards and
	// file names in this workspace do contain '_' (e.g. "004-insight-read_text_file.md").
	// The range [filePath# , filePath$) selects exactly the chunks of that file:
	// '#' (0x23) < '$' (0x24), so "<filePath>#<chunk>" is always inside it.
	// The delete runs inside the transaction so a failure while embedding does
	// not leave the file with zero chunks.
	if _, err := tx.ExecContext(ctx,
		"DELETE FROM knowledge WHERE filepath >= ? AND filepath < ?",
		filePath+"#", filePath+"$"); err != nil {
		return fmt.Errorf("failed to clear old chunks for %s: %w", filePath, err)
	}

	for i, content := range chunks {
		if len(content) == 0 {
			continue
		}

		emb, provider, err := GetEmbeddingWithProvider(ctx, content)
		if err != nil {
			return fmt.Errorf("failed to get embedding for chunk %d: %w", i, err)
		}

		embBytes, err := floatsToBytes(emb)
		if err != nil {
			return fmt.Errorf("failed to convert embedding to bytes: %w", err)
		}

		chunkPath := fmt.Sprintf("%s#%d", filePath, i) // Use chunk index in path for uniqueness
		res, err := tx.ExecContext(ctx, "INSERT INTO knowledge (filepath, content, updated_at, client_id, embedding_provider) VALUES (?, ?, ?, ?, ?)", chunkPath, content, now, clientID, provider)
		if err != nil {
			return fmt.Errorf("failed to insert knowledge: %w", err)
		}

		id, err := res.LastInsertId()
		if err != nil {
			return fmt.Errorf("failed to get last insert id: %w", err)
		}

		if _, err := tx.ExecContext(ctx, "INSERT INTO knowledge_vec (knowledge_id, embedding) VALUES (?, ?)", id, embBytes); err != nil {
			return fmt.Errorf("failed to insert knowledge_vec: %w", err)
		}
	}

	return tx.Commit()
}

// SearchSemantically queries the vector database using vec_distance_cosine.
//
// The search is restricted to the vector space of the provider that produced
// the query embedding. Vectors from different models are NOT comparable: the
// cosine distance between a Gemini vector and an Ollama vector is meaningless
// and silently corrupts the ranking.
//
// The provider filter lives in the WHERE clause of the JOIN. It is pushed
// down into the vec0 KNN (verified with EXPLAIN QUERY PLAN: the plan is
// identical with and without the filter, and the k limit is applied AFTER
// the filter), so k = topK is correct and no over-fetching is needed.
func SearchSemantically(ctx context.Context, db *sql.DB, query string, topK int) ([]SearchResult, error) {
	queryEmb, provider, err := GetEmbeddingWithProvider(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to get query embedding: %w", err)
	}

	queryEmbBytes, err := floatsToBytes(queryEmb)
	if err != nil {
		return nil, fmt.Errorf("failed to convert query embedding to bytes: %w", err)
	}

	if topK <= 0 {
		topK = 5
	}

	// Chunks indexed before the embedding_provider column existed have an
	// empty/NULL provider: their vector space is unknown. They are only
	// accepted when the query itself is in an unknown space, which is the
	// legacy single-provider case.
	providerFilter := provider
	if embeddingSpaceTag(provider) == "unknown" {
		providerFilter = ""
	}

	sqlQuery := `
		SELECT k.filepath, k.content, (1.0 - vec_distance_cosine(kv.embedding, ?)) as score,
		       COALESCE(k.embedding_provider, '') as provider
		FROM knowledge_vec kv
		JOIN knowledge k ON k.id = kv.knowledge_id
		WHERE kv.embedding MATCH ? AND k = ?
		  AND (k.embedding_provider = ? OR (? = '' AND (k.embedding_provider IS NULL OR k.embedding_provider = '')))
		ORDER BY score DESC;
	`
	rows, err := db.QueryContext(ctx, sqlQuery, queryEmbBytes, queryEmbBytes, topK, providerFilter, providerFilter)
	if err != nil {
		return nil, fmt.Errorf("failed to search semantically: %w", err)
	}
	defer rows.Close()

	var results []SearchResult
	for rows.Next() {
		var res SearchResult
		if err := rows.Scan(&res.FilePath, &res.Content, &res.Score, &res.Provider); err != nil {
			return nil, fmt.Errorf("failed to scan search result: %w", err)
		}
		results = append(results, res)
	}

	return results, rows.Err()
}

// PurgeOrphanedAndSkillsChunks cleans up stale skills chunks and chunks whose source files
// no longer exist in the workspace, then runs VACUUM if needed.
func PurgeOrphanedAndSkillsChunks(ctx context.Context, db *sql.DB) (int64, error) {
	// 1. Delete skills chunks (skills are no longer part of ambient memory)
	res, err := db.ExecContext(ctx, "DELETE FROM knowledge WHERE filepath LIKE 'skills/%'")
	var totalDeleted int64
	if err == nil {
		if n, _ := res.RowsAffected(); n > 0 {
			totalDeleted += n
		}
	}

	// 2. Find and delete orphaned chunks from files that no longer exist
	rows, err := db.QueryContext(ctx, "SELECT DISTINCT filepath FROM knowledge")
	if err == nil {
		workspaceDir := filepath.Dir(gulinbase.GetGulinDataDir())
		var orphansToDelete []string
		checkedFiles := make(map[string]bool)

		for rows.Next() {
			var chunkPath string
			if err := rows.Scan(&chunkPath); err != nil {
				continue
			}

			// Extract base file path (e.g. "memoria/test.md#0" -> "memoria/test.md")
			baseFile := chunkPath
			if idx := strings.Index(chunkPath, "#"); idx != -1 {
				baseFile = chunkPath[:idx]
			}

			if checked, exists := checkedFiles[baseFile]; exists {
				if !checked {
					orphansToDelete = append(orphansToDelete, chunkPath)
				}
				continue
			}

			// Check file on disk
			absPath := filepath.Join(workspaceDir, filepath.FromSlash(baseFile))
			if _, err := os.Stat(absPath); os.IsNotExist(err) {
				checkedFiles[baseFile] = false
				orphansToDelete = append(orphansToDelete, chunkPath)
			} else {
				checkedFiles[baseFile] = true
			}
		}
		rows.Close()

		if len(orphansToDelete) > 0 {
			// Group the orphan chunks by base file and delete them with a single
			// ranged statement per file. The previous code issued one
			// "DELETE ... WHERE filepath = ?" per chunk (hundreds of statements,
			// each a unique-index lookup) inside one transaction.
			byBaseFile := make(map[string][]string)
			var baseOrder []string
			for _, orphan := range orphansToDelete {
				base := orphan
				if idx := strings.Index(orphan, "#"); idx != -1 {
					base = orphan[:idx]
				}
				if _, ok := byBaseFile[base]; !ok {
					baseOrder = append(baseOrder, base)
				}
				byBaseFile[base] = append(byBaseFile[base], orphan)
			}

			tx, err := db.BeginTx(ctx, nil)
			if err == nil {
				for _, base := range baseOrder {
					// Same B-tree range trick as InsertFileChunks: it uses the
					// idx_knowledge_filepath index and avoids LIKE wildcards.
					if r, err := tx.ExecContext(ctx,
						"DELETE FROM knowledge WHERE filepath >= ? AND filepath < ?",
						base+"#", base+"$"); err == nil {
						if n, _ := r.RowsAffected(); n > 0 {
							totalDeleted += n
						}
					}
				}
				_ = tx.Commit()
			}
		}
	}

	// If rows were deleted, run VACUUM to reclaim disk space.
	// In WAL mode VACUUM does not shrink the -wal file, so a TRUNCATE checkpoint is
	// issued afterwards to release the space back to the filesystem. Without it the
	// WAL kept growing (7 MB observed) on every purge.
	if totalDeleted > 0 {
		_, _ = db.ExecContext(ctx, "VACUUM")
		_, _ = db.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)")
	}

	return totalDeleted, nil
}
