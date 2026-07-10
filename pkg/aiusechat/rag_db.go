package aiusechat

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/gulindev/gulin/pkg/gulinbase"
)

const EmbeddingFileName = "workspace_embeddings.json"

// Chunk represents a piece of text and its corresponding vector embedding
type Chunk struct {
	ID        string    `json:"id"`
	FilePath  string    `json:"filepath"`
	Content   string    `json:"content"`
	Embedding []float32 `json:"embedding"`
}

// VectorDB holds all the chunks in memory for fast Cosine Similarity
type VectorDB struct {
	mu     sync.RWMutex
	DBPath string  `json:"-"`
	Chunks []Chunk `json:"chunks"`
}

// SearchResult represents a returned document chunk with its similarity score
type SearchResult struct {
	FilePath string
	Content  string
	Score    float32
}

var (
	loadedDBs = make(map[string]*VectorDB)
	dbMapOnce sync.RWMutex
)

func IsWorkspace(dir string) bool {
	markers := []string{".git", "package.json", ".gulin", "go.mod"}
	for _, m := range markers {
		if _, err := os.Stat(filepath.Join(dir, m)); err == nil {
			return true
		}
	}
	return false
}

func GetGlobalDBPath() string {
	configDir := gulinbase.GetGulinConfigDir()
	return filepath.Join(configDir, "global_embeddings.json")
}

func GetWorkspaceDBPath(dir string) string {
	return filepath.Join(dir, ".gulin", "workspace_embeddings.json")
}

// GetVectorDB returns the instance of the VectorDB for a given path
func GetVectorDB(path string) *VectorDB {
	dbMapOnce.Lock()
	defer dbMapOnce.Unlock()

	if db, ok := loadedDBs[path]; ok {
		return db
	}

	db := &VectorDB{
		DBPath: path,
		Chunks: make([]Chunk, 0),
	}
	db.LoadFromDisk()
	loadedDBs[path] = db
	return db
}

// LoadFromDisk loads the embeddings JSON file into memory
func (db *VectorDB) LoadFromDisk() error {
	db.mu.Lock()
	defer db.mu.Unlock()

	data, err := os.ReadFile(db.DBPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // DB does not exist yet
		}
		return fmt.Errorf("failed to read vector db file: %w", err)
	}

	if err := json.Unmarshal(data, db); err != nil {
		return fmt.Errorf("failed to decode vector db: %w", err)
	}
	return nil
}

// SaveToDisk writes the current in-memory DB to the JSON file
func (db *VectorDB) SaveToDisk() error {
	db.mu.RLock()
	defer db.mu.RUnlock()

	if err := os.MkdirAll(filepath.Dir(db.DBPath), 0755); err != nil {
		return fmt.Errorf("failed to create directory for vector db: %w", err)
	}

	data, err := json.MarshalIndent(db, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to encode vector db: %w", err)
	}

	if err := os.WriteFile(db.DBPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write vector db to disk: %w", err)
	}
	return nil
}

// AddFileChunks takes a file, chunks it, gets embeddings via Ollama, and stores them.
func (db *VectorDB) AddFileChunks(ctx context.Context, filePath string, text string) error {
	// First, check if the file is already in the DB, and remove old chunks if so
	db.RemoveFileChunks(filePath)

	// We only chunk small pieces of text. Larger files take too long via local Ollama without heavy batching.
	// For this naive local implementation we will rely on 1k char splits.
	chunks := ChunkText(text, 1000, 100)

	for i, content := range chunks {
		// Do not embed completely blank chunks
		if len(strings.TrimSpace(content)) == 0 {
			continue
		}

		emb, err := GetEmbedding(ctx, content)
		if err != nil {
			return fmt.Errorf("failed to get embedding for %s chunk %d: %w", filePath, i, err)
		}

		chunkID := fmt.Sprintf("%s_%d", filePath, i)
		db.mu.Lock()
		db.Chunks = append(db.Chunks, Chunk{
			ID:        chunkID,
			FilePath:  filePath,
			Content:   content,
			Embedding: emb,
		})
		db.mu.Unlock()
	}

	return db.SaveToDisk()
}

// RemoveFileChunks deletes all chunks related to a specific file
func (db *VectorDB) RemoveFileChunks(filePath string) {
	db.mu.Lock()
	defer db.mu.Unlock()

	var newChunks []Chunk
	for _, c := range db.Chunks {
		if c.FilePath != filePath {
			newChunks = append(newChunks, c)
		}
	}
	db.Chunks = newChunks
}

// cosineSimilarity mathematically compares two vectors and returns a score [0, 1]. Higher is more similar.
func cosineSimilarity(a, b []float32) float32 {
	if len(a) != len(b) || len(a) == 0 {
		return 0.0
	}

	var dotProduct float32
	var normA float32
	var normB float32

	for i := 0; i < len(a); i++ {
		dotProduct += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}

	if normA == 0 || normB == 0 {
		return 0.0
	}

	return dotProduct / (float32(math.Sqrt(float64(normA))) * float32(math.Sqrt(float64(normB))))
}

// Search calculates the embedding for the query, and compares it against all stored chunks
func (db *VectorDB) Search(ctx context.Context, query string, topK int) ([]SearchResult, error) {
	queryEmb, err := GetEmbedding(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to get embedding for query: %w", err)
	}

	db.mu.RLock()
	defer db.mu.RUnlock()

	var results []SearchResult
	for _, chunk := range db.Chunks {
		score := cosineSimilarity(queryEmb, chunk.Embedding)
		results = append(results, SearchResult{
			FilePath: chunk.FilePath,
			Content:  chunk.Content,
			Score:    score,
		})
	}

	// Sort results descending by score
	sort.Slice(results, func(i, j int) bool {
		return results[i].Score > results[j].Score
	})

	if len(results) > topK {
		results = results[:topK]
	}

	return results, nil
}
