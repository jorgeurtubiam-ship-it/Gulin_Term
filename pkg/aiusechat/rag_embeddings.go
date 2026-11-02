package aiusechat

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gulindev/gulin/pkg/secretstore"
	"github.com/gulindev/gulin/pkg/wconfig"
)

const (
	EndpointEmbeddings = "/api/embeddings"
	ChunkSizeLimit     = 512 // Approximate token limit per chunk
)

const (
	GeminiEmbeddingModel     = "gemini-embedding-001"
	GeminiEmbeddingEndpoint  = "https://generativelanguage.googleapis.com/v1beta/models/%s:embedContent?key=%s"
	MiniMaxEmbeddingModel    = "embo-01"
	MiniMaxEmbeddingEndpoint = "https://api.minimax.io/v1/embeddings"
)

// EmbeddingDimensions is the fixed width of every vector stored in the
// SQLite-vec knowledge_vec table (FLOAT[768]).
//
// All three providers MUST return exactly this many dimensions. A vector of a
// different width is rejected by SQLite-vec at INSERT time, so the dimension
// contract is enforced at the provider boundary, not at the storage boundary.
const EmbeddingDimensions = 768

// EmbeddingProvider identifies which model produced a vector. Vectors from
// different providers live in DIFFERENT vector spaces and MUST NOT be compared
// against each other: cosine similarity between them is meaningless and the
// ranking becomes garbage.
//
// Provider values (stable, stored in the DB):
const (
	EmbeddingProviderMiniMax = "minimax-embo-01"
	EmbeddingProviderGemini  = "gemini-embedding-001"
	EmbeddingProviderOllama  = "ollama-nomic-embed-text"
)

// embeddingSpaceTag returns a short, stable tag used to group vectors by space.
func embeddingSpaceTag(provider string) string {
	switch provider {
	case EmbeddingProviderMiniMax:
		return "minimax"
	case EmbeddingProviderGemini:
		return "gemini"
	case EmbeddingProviderOllama:
		return "ollama"
	default:
		return "unknown"
	}
}

// EmbeddingResponse represents the response from Ollama's embedding API
type EmbeddingResponse struct {
	Embedding []float32 `json:"embedding"`
}

// EmbeddingRequest represents the payload to Ollama
type EmbeddingRequest struct {
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
}

// embeddingProvider is the hook used to obtain embeddings. It exists so tests
// can inject a deterministic provider instead of hitting Ollama/Gemini.
// It is nil in production, meaning GetEmbedding uses the real providers.
var embeddingProvider func(text string) ([]float32, error)

// GetEmbedding queries embedding providers in priority order:
//
// 1. Local Ollama (nomic-embed-text) -- default, free, no quota, ~60ms
// 2. Google Gemini (gemini-embedding-001) -- cloud fallback
// 3. MiniMax (embo-01) -- last resort, heavily rate limited
//
// The order matters for two reasons:
//
//   - Ollama is local: it has no rate limit and no cost. Putting a cloud
//     provider first means every single chunk pays a network round trip and
//     gets throttled the moment a bulk re-index runs.
//   - The vector space of the provider used at INDEX time must match the one
//     used at SEARCH time. The provider actually used is recorded in the
//     knowledge_vec table (see rag_sqlite.go), so a search never mixes spaces.
//
// A provider that fails repeatedly is skipped for a cooldown window
// (see providerCircuit) so a bulk index does not pay the timeout of a dead
// provider for every chunk.
func GetEmbedding(ctx context.Context, text string) ([]float32, error) {
	// Test hook: use the injected provider when available.
	if embeddingProvider != nil {
		return embeddingProvider(text)
	}

	var lastErr error
	for _, p := range embeddingProviderOrder {
		if providerCircuit.isOpen(p.name) {
			continue
		}
		emb, err := p.fn(ctx, text)
		if err == nil && len(emb) > 0 {
			providerCircuit.recordSuccess(p.name)
			return emb, nil
		}
		lastErr = err
		providerCircuit.recordFailure(p.name, err)
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("no embedding provider available")
	}
	return nil, fmt.Errorf("all embedding providers failed: %w", lastErr)
}

// GetEmbeddingWithProvider returns the embedding AND the identity of the
// provider that produced it.
//
// The provider identity is essential: vectors from different models live in
// DIFFERENT vector spaces, and the cosine similarity between them is
// meaningless. Recording the provider at index time lets the search side
// compare the query vector only against chunks of the same space.
func GetEmbeddingWithProvider(ctx context.Context, text string) ([]float32, string, error) {
	if embeddingProvider != nil {
		emb, err := embeddingProvider(text)
		if err != nil {
			return nil, "", err
		}
		return emb, EmbeddingProviderOllama, nil
	}

	// A pinned provider is used exclusively: mixing spaces is what the
	// provider column is there to prevent.
	if pinned := GetEmbeddingProvider(); pinned != "" {
		for _, p := range embeddingProviderOrder {
			if p.name != pinned {
				continue
			}
			if providerCircuit.isOpen(p.name) {
				break
			}
			emb, err := p.fn(ctx, text)
			if err == nil && len(emb) > 0 {
				providerCircuit.recordSuccess(p.name)
				return emb, p.name, nil
			}
			providerCircuit.recordFailure(p.name, err)
			break
		}
		return nil, "", fmt.Errorf("pinned embedding provider %q is unavailable", pinned)
	}

	var lastErr error
	for _, p := range embeddingProviderOrder {
		if providerCircuit.isOpen(p.name) {
			continue
		}
		emb, err := p.fn(ctx, text)
		if err == nil && len(emb) > 0 {
			providerCircuit.recordSuccess(p.name)
			return emb, p.name, nil
		}
		lastErr = err
		providerCircuit.recordFailure(p.name, err)
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("no embedding provider available")
	}
	return nil, "", fmt.Errorf("all embedding providers failed: %w", lastErr)
}

// embeddingProviderSpec binds a provider to its stable identity.
type embeddingProviderSpec struct {
	name string
	fn   func(context.Context, string) ([]float32, error)
}

// GetEmbeddingProvider returns the embedding provider that MUST be used.
//
// When it is configured (ai:embedding_provider), that provider is the ONLY
// one used, both for indexing and for searching. This is the key to keeping
// the vector space stable: if Ollama is down at index time and the cloud
// provider takes over, the stored vectors live in a different space than the
// ones produced when Ollama is back, and the two sets must not be mixed.
//
// When it is NOT configured, the automatic priority order is used (Ollama
// first, then Gemini, then MiniMax) and the provider actually used is
// recorded per chunk, so the search only compares vectors of the same space.
func GetEmbeddingProvider() string {
	watcher := wconfig.GetWatcher()
	if watcher == nil {
		return ""
	}
	fullConfig := watcher.GetFullConfig()
	return fullConfig.Settings.AiEmbeddingProvider
}

// embeddingProviderOrder is the live priority order. Ollama leads because it is
// local and unlimited; the cloud providers only take over when Ollama is down.
var embeddingProviderOrder = []embeddingProviderSpec{
	{name: EmbeddingProviderOllama, fn: GetOllamaEmbedding},
	{name: EmbeddingProviderGemini, fn: GetGeminiEmbedding},
	{name: EmbeddingProviderMiniMax, fn: GetMiniMaxEmbedding},
}

// providerCircuitState tracks the health of a single embedding provider.
//
// The mutex lives in the breaker (providerCircuitBreaker.mu), not in this
// struct, so the state can be copied by value without copying a lock.
type providerCircuitState struct {
	failures  int
	openUntil time.Time
	lastErr   error
	totalFail int
	totalOK   int
}

// providerCircuitBreaker implements a simple circuit breaker per provider.
// After providerCircuitThreshold consecutive failures the provider is skipped
// for providerCircuitCooldown, so a dead provider costs one timeout instead of
// one timeout per chunk.
type providerCircuitBreaker struct {
	mu     sync.Mutex
	states map[string]*providerCircuitState
}

const (
	// providerCircuitThreshold is the number of consecutive failures that
	// trip the breaker for a provider.
	providerCircuitThreshold = 3
	// providerCircuitCooldown is how long a tripped provider is skipped.
	providerCircuitCooldown = 60 * time.Second
)

// providerCircuit is the live circuit breaker shared by every embedding call.
var providerCircuit = &providerCircuitBreaker{states: map[string]*providerCircuitState{}}

// isOpen reports whether the named provider is currently tripped.
func (c *providerCircuitBreaker) isOpen(name string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	st, ok := c.states[name]
	if !ok {
		return false
	}
	return st.isOpen(time.Now())
}

// recordSuccess clears the failure counter for the named provider.
func (c *providerCircuitBreaker) recordSuccess(name string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	st, ok := c.states[name]
	if !ok {
		st = &providerCircuitState{}
		c.states[name] = st
	}
	st.recordSuccess()
}

// recordFailure increments the failure counter for the named provider.
func (c *providerCircuitBreaker) recordFailure(name string, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	st, ok := c.states[name]
	if !ok {
		st = &providerCircuitState{}
		c.states[name] = st
	}
	st.recordFailure(err)
}

// snapshot returns a copy of the breaker state, for diagnostics.
func (c *providerCircuitBreaker) snapshot() map[string]providerCircuitState {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make(map[string]providerCircuitState, len(c.states))
	for k, v := range c.states {
		out[k] = *v
	}
	return out
}

func (p *providerCircuitState) isOpen(now time.Time) bool {
	return now.Before(p.openUntil)
}

func (p *providerCircuitState) recordSuccess() {
	p.failures = 0
	p.openUntil = time.Time{}
	p.totalOK++
}

func (p *providerCircuitState) recordFailure(err error) {
	p.failures++
	p.totalFail++
	p.lastErr = err
	if p.failures >= providerCircuitThreshold {
		p.openUntil = time.Now().Add(providerCircuitCooldown)
		p.failures = 0
	}
}

// isOpen reports whether the named provider is currently tripped.


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

	// Same dimension contract as the cloud providers: nomic-embed-text
	// natively returns 768, but a different local model may return another
	// width, and the vector must always fit FLOAT[768].
	vec, err := conformEmbedding(data.Embedding, EmbeddingDimensions)
	if err != nil {
		return nil, err
	}

	return vec, nil
}

// GetMiniMaxEmbedding queries the MiniMax API for embeddings
func GetMiniMaxEmbedding(ctx context.Context, text string) ([]float32, error) {
	apiKey := getMiniMaxAPIKey()
	if apiKey == "" {
		return nil, fmt.Errorf("MiniMax API key not found")
	}

	reqBody := map[string]any{
		"model": MiniMaxEmbeddingModel,
		"texts": []string{text},
		"type":  "db",
		// Ask for a native 768-dimension output so the vector lands in the
		// same space as Gemini/Ollama instead of being folded down from 1536.
		// If the API ignores this field, conformEmbedding still guarantees
		// the schema width.
		"dimension": EmbeddingDimensions,
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", MiniMaxEmbeddingEndpoint, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to call minimax embedding API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("minimax embedding API returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var result struct {
		Vectors  [][]float32 `json:"vectors"`
		BaseResp struct {
			StatusCode int    `json:"status_code"`
			StatusMsg  string `json:"status_msg"`
		} `json:"base_resp"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to parse minimax response: %w", err)
	}

	if result.BaseResp.StatusCode != 0 {
		return nil, fmt.Errorf("minimax API error (%d): %s", result.BaseResp.StatusCode, result.BaseResp.StatusMsg)
	}

	if len(result.Vectors) == 0 || len(result.Vectors[0]) == 0 {
		return nil, fmt.Errorf("minimax returned empty embedding vector")
	}

	vec := result.Vectors[0]

	// Dimension contract: the vector MUST end up with exactly
	// EmbeddingDimensions components, otherwise SQLite-vec rejects the INSERT.
	//
	// MiniMax embo-01 natively returns 1536 dimensions. Truncating the tail
	// (vec[:768]) silently drops half of the signal and yields a vector that is
	// NOT the same space as the Gemini/Ollama 768-dim vectors: it keeps only
	// the first 768 principal directions of a 1536-dim model, which is a
	// different geometry than a model trained natively at 768. Mixing those
	// two families inside one vector space corrupts every cosine ranking.
	//
	// Instead of truncating, ask the API for a 768-dim output. Gemini's
	// embedContent supports "outputDimensionality"; MiniMax embo-01 exposes
	// the same knob. When the API honours it we get a true 768-dim vector.
	// When it does not (older API version), we fall back to a deterministic
	// projection that preserves the vector direction as well as possible
	// instead of a blind tail cut.
	//
	// Either way the resulting vector is normalised so that the cosine
	// distance computed by SQLite-vec is a true cosine similarity.
	vec, err = conformEmbedding(vec, EmbeddingDimensions)
	if err != nil {
		return nil, err
	}

	return vec, nil
}

// conformEmbedding forces an embedding vector to exactly targetDim components.
//
// Strategy:
//  1. Already the right width -> L2 normalise and return.
//  2. Narrower than target   -> pad with zeros (preserves the original vector
//     as a subspace of the larger space; cosine similarity is unchanged).
//  3. Wider than target     -> request-style deterministic projection:
//     fold the surplus dimensions back into the first targetDim slots by
//     accumulating their contribution, then L2 normalise.
//
// The projection preserves total energy far better than a tail cut: a plain
// vec[:768] on a 1536-dim vector throws away ~50% of the L2 norm, which makes
// cosine distance degrade towards "unrelated" for every pair of vectors.
func conformEmbedding(vec []float32, targetDim int) ([]float32, error) {
	if len(vec) == 0 {
		return nil, fmt.Errorf("empty embedding vector")
	}

	out := make([]float32, targetDim)

	switch {
	case len(vec) == targetDim:
		copy(out, vec)

	case len(vec) < targetDim:
		// Narrower than the schema: zero-pad. Cosine similarity between two
		// padded vectors equals the cosine similarity of the originals.
		copy(out, vec)

	default:
		// Wider than the schema: fold the surplus back instead of discarding it.
		//
		// For each surplus dimension d >= targetDim, its magnitude is added into
		// the slot d % targetDim. This keeps every original dimension's
		// contribution inside the target space, so no energy is silently lost
		// and the resulting direction stays close to the original vector.
		for i, v := range vec {
			if i < targetDim {
				out[i] = v
				continue
			}
			out[i%targetDim] += v
		}
	}

	return normalizeVector(out), nil
}

// normalizeVector L2-normalises a vector in place-safe fashion (returns a new
// slice). A zero vector is returned untouched because it has no direction to
// preserve and normalising it would produce NaNs that poison the vector index.
func normalizeVector(vec []float32) []float32 {
	var sum float64
	for _, v := range vec {
		sum += float64(v) * float64(v)
	}
	if sum == 0 {
		return vec
	}
	inv := float32(1.0 / sqrt(sum))
	for i := range vec {
		vec[i] *= inv
	}
	return vec
}

// sqrt is a tiny local helper to avoid pulling math into every call site of
// this file; it delegates to the standard library implementation.
func sqrt(x float64) float64 {
	return math.Sqrt(x)
}

func getMiniMaxAPIKey() string {
	apiKey, exists, _ := secretstore.GetSecret("MINIMAX_API_KEY")
	if exists && apiKey != "" {
		return apiKey
	}

	// Fallback to checking gulinai.json
	homeDir, _ := os.UserHomeDir()
	candidatePaths := []string{
		filepath.Join(homeDir, "Gulin_Workspace", "config", "gulinai.json"),
		filepath.Join(homeDir, ".gulin", "gulinai.json"),
		filepath.Join(homeDir, ".config", "gulin", "gulinai.json"),
	}

	for _, path := range candidatePaths {
		if content, err := os.ReadFile(path); err == nil {
			var configMap map[string]map[string]interface{}
			if err := json.Unmarshal(content, &configMap); err == nil {
				for key, val := range configMap {
					provider, _ := val["ai:provider"].(string)
					token, _ := val["ai:apitoken"].(string)
					if (strings.EqualFold(provider, "minimax") || strings.Contains(strings.ToLower(key), "minimax")) && token != "" {
						return token
					}
				}
			}
		}
	}
	return ""
}

func getGeminiAPIKey() string {
	apiKey, exists, _ := secretstore.GetSecret("GOOGLE_AI_KEY")
	if exists && apiKey != "" {
		return apiKey
	}

	homeDir, _ := os.UserHomeDir()
	candidatePaths := []string{
		filepath.Join(homeDir, "Gulin_Workspace", "config", "gulinai.json"),
		filepath.Join(homeDir, ".gulin", "gulinai.json"),
		filepath.Join(homeDir, ".config", "gulin", "gulinai.json"),
	}

	for _, path := range candidatePaths {
		if content, err := os.ReadFile(path); err == nil {
			var configMap map[string]map[string]interface{}
			if err := json.Unmarshal(content, &configMap); err == nil {
				for key, val := range configMap {
					provider, _ := val["ai:provider"].(string)
					token, _ := val["ai:apitoken"].(string)
					if (strings.EqualFold(provider, "google") || strings.Contains(strings.ToLower(key), "gemini")) && token != "" {
						return token
					}
				}
			}
		}
	}
	return ""
}

// GetGeminiEmbedding queries the Google Gemini API for embeddings
func GetGeminiEmbedding(ctx context.Context, text string) ([]float32, error) {
	apiKey := getGeminiAPIKey()
	if apiKey == "" {
		return nil, fmt.Errorf("GOOGLE_AI_KEY not found in secret store or config")
	}

	url := fmt.Sprintf(GeminiEmbeddingEndpoint, GeminiEmbeddingModel, apiKey)

	reqBody := map[string]any{
		"model": "models/" + GeminiEmbeddingModel,
		"content": map[string]any{
			"parts": []map[string]any{
				{"text": text},
			},
		},
		"outputDimensionality": 768,
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

	// Enforce the dimension contract: the API is asked for 768 via
	// outputDimensionality, but conformEmbedding guarantees it even if the
	// API ignores the hint, and it normalises the vector so cosine distance
	// is a true cosine similarity.
	vec, err := conformEmbedding(result.Embedding.Values, EmbeddingDimensions)
	if err != nil {
		return nil, err
	}

	return vec, nil
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
