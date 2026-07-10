//go:build !cgo

package aiusechat

import (
	"context"
	"database/sql"
	"fmt"
)

func InitVectorDB(dbPath string) (*sql.DB, error) {
	return nil, fmt.Errorf("vector db not supported without cgo")
}

func GetGlobalVectorDB() (*sql.DB, error) {
	return nil, fmt.Errorf("vector db not supported without cgo")
}

func GetWorkspaceVectorDB(workspaceDir string) (*sql.DB, error) {
	return nil, fmt.Errorf("vector db not supported without cgo")
}

func GetFileUpdatedAt(ctx context.Context, db *sql.DB, filePath string) (int64, error) {
	return 0, fmt.Errorf("vector db not supported without cgo")
}

func InsertFileChunks(ctx context.Context, db *sql.DB, filePath string, text string) error {
	return fmt.Errorf("vector db not supported without cgo")
}

func SearchSemantically(ctx context.Context, db *sql.DB, query string, topK int) ([]SearchResult, error) {
	return nil, fmt.Errorf("vector db not supported without cgo")
}
