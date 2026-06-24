package aiusechat

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/gulindev/gulin/pkg/secretstore"
)

const (
	EndpointEmbeddings = "/api/embeddings"
	ChunkSizeLimit     = 512 // Approximate token limit per chunk
)

const (
	GeminiEmbeddingModel    = "text-embedding-004"
	GeminiEmbeddingEndpoint = "https://generativelanguage.googleapis.com/v1beta/models/%s:embedContent?key=%s"
)

// EmbeddingResponse represents the response from Ollama's embedding API
type EmbeddingResponse struct {
	Embedding []float32 `json:"embedding"`
}

// EmbeddingRequest represents the payload to Ollama
type EmbeddingRequest struct {
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
}

// GetEmbedding queries the local Ollama instance to get a vector representation of the text.
// If Ollama fails, it attempts to use Google Gemini as a fallback if an API key is available.
func GetEmbedding(ctx context.Context, text string) ([]float32, error) {
	// Try Ollama first
	emb, err := GetOllamaEmbedding(ctx, text)
	if err == nil {
		return emb, nil
	}

	log.Printf("Ollama embedding failed, attempting fallback to Gemini: %v\n", err)

	// Fallback to Gemini
	emb, err = GetGeminiEmbedding(ctx, text)
	if err == nil {
		return emb, nil
	}

	return nil, fmt.Errorf("all embedding providers failed (Ollama and Gemini fallback)")
}

// GetOllamaEmbedding queries the local Ollama instance
func GetOllamaEmbedding(ctx context.Context, text string) ([]float32, error) {
	reqBody := EmbeddingRequest{
		Model:  GetOllamaEmbeddingModel(),
		Prompt: text,
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal embedding request: %w", err)
	}

	url := fmt.Sprintf("%s%s", GetOllamaEmbeddingEndpoint(), EndpointEmbeddings)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second} // Shorter timeout for faster fallback
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to call ollama API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("ollama API returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var data EmbeddingResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("failed to parse ollama response: %w", err)
	}

	if len(data.Embedding) == 0 {
		return nil, fmt.Errorf("ollama returned empty embedding")
	}

	return data.Embedding, nil
}

// GetGeminiEmbedding queries the Google Gemini API for embeddings
func GetGeminiEmbedding(ctx context.Context, text string) ([]float32, error) {
	apiKey, exists, _ := secretstore.GetSecret("GOOGLE_AI_KEY")
	if !exists || apiKey == "" {
		return nil, fmt.Errorf("GOOGLE_AI_KEY not found in secret store")
	}

	url := fmt.Sprintf(GeminiEmbeddingEndpoint, GeminiEmbeddingModel, apiKey)

	reqBody := map[string]any{
		"model": "models/" + GeminiEmbeddingModel,
		"content": map[string]any{
			"parts": []map[string]any{
				{"text": text},
			},
		},
	}

	jsonData, _ := json.Marshal(reqBody)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to call gemini embedding API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("gemini embedding API returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var result struct {
		Embedding struct {
			Values []float32 `json:"values"`
		} `json:"embedding"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to parse gemini response: %w", err)
	}

	if len(result.Embedding.Values) == 0 {
		return nil, fmt.Errorf("gemini returned empty embedding")
	}

	return result.Embedding.Values, nil
}

// ChunkText splits a long text document into smaller chunks suitable for embedding models
// This uses a simple character-based chunking strategy with a little overlap.
func ChunkText(text string, chunkSize int, overlap int) []string {
	var chunks []string
	textLen := len(text)

	if textLen == 0 {
		return chunks
	}

	if textLen <= chunkSize {
		chunks = append(chunks, text)
		return chunks
	}

	for i := 0; i < textLen; i += (chunkSize - overlap) {
		end := i + chunkSize
		if end > textLen {
			end = textLen
		}
		chunks = append(chunks, text[i:end])
		if end == textLen {
			break
		}
	}

	return chunks
}
