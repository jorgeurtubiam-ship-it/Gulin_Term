package cmd

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"github.com/gulindev/gulin/pkg/aiusechat"
)

var gulinIndexCmd = &cobra.Command{
	Use:   "index [directory]",
	Short: "Generate Semantic Search Index for a project using local Ollama",
	Long: `Reads source code files in a directory and creates mathematical 
embeddings using your local Ollama instance running 'nomic-embed-text'.
This powers Semantic RAG searches for Gulin IA.`,
	RunE: gulinIndexRun,
}

func init() {
	gulinCmd.AddCommand(gulinIndexCmd)
}

func isIndexableFile(path string, info fs.FileInfo) bool {
	if info.IsDir() {
		return false
	}

	// Skip large/binary files, basic heuristic
	if info.Size() > 1024*1024 { // 1MB limit for quick indexing
		return false
	}

	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	// Add your target languages here
	case ".go", ".ts", ".tsx", ".js", ".jsx", ".md", ".json", ".sql", ".css", ".html":
		return true
	default:
		return false
	}
}

func gulinIndexRun(cmd *cobra.Command, args []string) error {
	var targetDir string
	if len(args) > 0 {
		targetDir = args[0]
	} else {
		cwd, err := os.Getwd()
		if err != nil {
			return fmt.Errorf("could not determine current directory and no directory provided: %v", err)
		}
		targetDir = cwd
	}

	targetDir, err := filepath.Abs(targetDir)
	if err != nil {
		return fmt.Errorf("invalid directory path: %w", err)
	}

	db := aiusechat.GetVectorDB()
	fmt.Printf("Starting Gulin Workspace Indexing for: %s\n", targetDir)
	fmt.Printf("Using Ollama Model: %s\n", aiusechat.GetOllamaEmbeddingModel())
	fmt.Printf("--------------------------------------------------\n")

	fileCount := 0
	ctx := context.Background()

	err = filepath.Walk(targetDir, func(path string, info fs.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Skip invisible folders like .git
		if info.IsDir() && strings.HasPrefix(info.Name(), ".") && info.Name() != "." {
			return filepath.SkipDir
		}
		// Skip node_modules and similar massive untracked folders
		if info.IsDir() && (info.Name() == "node_modules" || info.Name() == "dist" || info.Name() == "build") {
			return filepath.SkipDir
		}

		if isIndexableFile(path, info) {
			content, readErr := os.ReadFile(path)
			if readErr == nil {
				fmt.Printf("Indexing %s... ", filepath.Base(path))
				dbErr := db.AddFileChunks(ctx, path, string(content))
				if dbErr != nil {
					fmt.Printf("[ERROR] %v\n", dbErr)
				} else {
					fmt.Printf("[OK]\n")
					fileCount++
				}
			}
		}

		return nil
	})

	if err != nil {
		return fmt.Errorf("error during directory traversal: %w", err)
	}

	fmt.Printf("--------------------------------------------------\n")
	fmt.Printf("Done! Successfully embedded %d files.\n", fileCount)
	fmt.Printf("Database saved to: %s\n", aiusechat.GetDBPath())

	return nil
}
