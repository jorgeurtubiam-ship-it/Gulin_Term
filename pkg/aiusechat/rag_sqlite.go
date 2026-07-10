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

	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open vector db: %w", err)
	}

	schema := `
	CREATE TABLE IF NOT EXISTS knowledge (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		filepath TEXT UNIQUE NOT NULL,
		content TEXT NOT NULL,
		updated_at INTEGER NOT NULL
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

	return db, nil
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

// GetFileUpdatedAt returns the last updated_at timestamp for a file, or 0 if not found
func GetFileUpdatedAt(ctx context.Context, db *sql.DB, filePath string) (int64, error) {
	var updatedAt int64
	err := db.QueryRowContext(ctx, "SELECT MAX(updated_at) FROM knowledge WHERE filepath LIKE ?", filePath+"#%").Scan(&updatedAt)
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

// InsertFileChunks processes text chunks, gets embeddings, and saves them to the DB
func InsertFileChunks(ctx context.Context, db *sql.DB, filePath string, text string) error {
	// Clean up old entries for this file
	if _, err := db.ExecContext(ctx, "DELETE FROM knowledge WHERE filepath = ?", filePath); err != nil {
		return fmt.Errorf("failed to clear old chunks for %s: %w", filePath, err)
	}

	chunks := ChunkText(text, 1000, 100)
	now := time.Now().Unix()

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	for i, content := range chunks {
		if len(content) == 0 {
			continue
		}

		emb, err := GetEmbedding(ctx, content)
		if err != nil {
			return fmt.Errorf("failed to get embedding for chunk %d: %w", i, err)
		}

		embBytes, err := floatsToBytes(emb)
		if err != nil {
			return fmt.Errorf("failed to convert embedding to bytes: %w", err)
		}

		chunkPath := fmt.Sprintf("%s#%d", filePath, i) // Use chunk index in path for uniqueness
		res, err := tx.ExecContext(ctx, "INSERT INTO knowledge (filepath, content, updated_at) VALUES (?, ?, ?)", chunkPath, content, now)
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

// SearchSemantically queries the vector database using vec_distance_cosine
func SearchSemantically(ctx context.Context, db *sql.DB, query string, topK int) ([]SearchResult, error) {
	queryEmb, err := GetEmbedding(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to get query embedding: %w", err)
	}

	queryEmbBytes, err := floatsToBytes(queryEmb)
	if err != nil {
		return nil, fmt.Errorf("failed to convert query embedding to bytes: %w", err)
	}

	sqlQuery := `
		SELECT k.filepath, k.content, (1.0 - vec_distance_cosine(kv.embedding, ?)) as score
		FROM knowledge_vec kv
		JOIN knowledge k ON k.id = kv.knowledge_id
		WHERE kv.embedding MATCH ? AND k = ?
		ORDER BY score DESC;
	`
	rows, err := db.QueryContext(ctx, sqlQuery, queryEmbBytes, queryEmbBytes, topK)
	if err != nil {
		return nil, fmt.Errorf("failed to search semantically: %w", err)
	}
	defer rows.Close()

	var results []SearchResult
	for rows.Next() {
		var res SearchResult
		if err := rows.Scan(&res.FilePath, &res.Content, &res.Score); err != nil {
			return nil, fmt.Errorf("failed to scan search result: %w", err)
		}
		// Strip chunk index from FilePath if needed, or leave as is
		results = append(results, res)
	}

	return results, rows.Err()
}
