// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gulindev/gulin/pkg/gulinbase"
)

const GulinMemoryDirName = "gulin"
const EmbeddingsFileName = "embeddings.json"
const EndpointEmbeddingsAPI = "/api/embeddings"

type GulinEmbeddings map[string][]float32

func GetGulinMemoryDir() string {
	return filepath.Join(gulinbase.GetGulinConfigDir(), GulinMemoryDirName)
}

func EnsureGulinMemoryDir() error {
	dir := GetGulinMemoryDir()
	return os.MkdirAll(dir, 0700)
}

func UpdateGulinMemoryFile(filename string, content string) error {
	if err := EnsureGulinMemoryDir(); err != nil {
		return err
	}
	// Sanitize filename to prevent directory traversal
	filename = filepath.Base(filename)
	if !strings.HasSuffix(filename, ".md") {
		filename += ".md"
	}
	path := filepath.Join(GetGulinMemoryDir(), filename)
	return os.WriteFile(path, []byte(content), 0600)
}

func ReadGulinMemoryFile(filename string) (string, error) {
	filename = filepath.Base(filename)
	if !strings.HasSuffix(filename, ".md") {
		filename += ".md"
	}
	path := filepath.Join(GetGulinMemoryDir(), filename)
	content, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(content), nil
}

func ListGulinMemoryFiles() ([]string, error) {
	if err := EnsureGulinMemoryDir(); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(GetGulinMemoryDir())
	if err != nil {
		return nil, err
	}
	var files []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".md") {
			files = append(files, entry.Name())
		}
	}
	return files, nil
}

func GetGulinSkillContext(skillName string) string {
	if skillName == "" {
		return ""
	}
	// Sanitize skill name to get filename (e.g. "🛡️ Seguridad" -> "seguridad.md")
	clean := strings.ToLower(skillName)
	// Remove emojis and spaces
	reg, _ := regexp.Compile("[^a-z0-9_]+")
	clean = strings.ReplaceAll(clean, " ", "_")
	clean = reg.ReplaceAllString(clean, "")
	clean = strings.Trim(clean, "_")

	content, err := ReadGulinMemoryFile(clean + ".md")
	if err != nil {
		return ""
	}

	var sb strings.Builder
	sb.WriteString("\n<active_skill_protocol>\n")
	sb.WriteString(fmt.Sprintf("ESTÁS ACTUANDO COMO UN EXPERTO BAJO EL PROTOCOLO: %s\n", skillName))
	sb.WriteString("Sigue estrictamente las reglas definidas a continuación para esta conversación:\n\n")
	sb.WriteString(content)
	sb.WriteString("\n</active_skill_protocol>\n")
	return sb.String()
}

func GetGulinBrainContext(query string) string {
	files, err := ListGulinMemoryFiles()
	if err != nil || len(files) == 0 {
		return ""
	}

	var relevantFiles []string
	if query != "" {
		// Use semantic search to find top relevant files
		relevantFiles, _ = SearchGulinMemory(query)
	}

	// Falls back to showing a few files if no semantic results or small number of files
	if len(relevantFiles) == 0 {
		// No results from semantic search, show the most recent ones (first 3)
		// Siempre priorizar sesion-actual.md si existe (contiene el contexto de la sesión actual)
		sessionFile := "sesion-actual.md"
		sessionFound := false
		for i := 0; i < len(files) && len(relevantFiles) < 5; i++ {
			if files[i] == sessionFile {
				relevantFiles = append(relevantFiles, files[i])
				sessionFound = true
			} else if len(relevantFiles) > 0 || i >= 1 {
				// Después de sesion-actual (o en su defecto), completar con otros archivos
				if len(relevantFiles) < 3 {
					relevantFiles = append(relevantFiles, files[i])
				}
			}
		}
		// Si no encontramos sesion-actual.md, mostrar los primeros archivos como antes
		if !sessionFound {
			relevantFiles = nil
			for i := 0; i < len(files) && i < 3; i++ {
				relevantFiles = append(relevantFiles, files[i])
			}
		}
	}

	var sb strings.Builder
	sb.WriteString("\n<gulin_brain_memory>\n")
	sb.WriteString("Esta es tu MEMORIA A LARGO PLAZO (RAG). Contiene hábitos, lecciones aprendidas y contexto importante recuperado automáticamente para esta conversación.\n")
	sb.WriteString("IMPORTANTE: Toda la información que necesitas sobre el usuario ya está aquí abajo. NO uses herramientas de búsqueda (brain_search) si la respuesta ya está en este bloque.\n")

	for _, file := range relevantFiles {
		content, err := ReadGulinMemoryFile(file)
		if err == nil {
			sb.WriteString(fmt.Sprintf("\n### Archivo: %s\n", file))
			sb.WriteString(content)
			sb.WriteString("\n")
		}
	}

	sb.WriteString("</gulin_brain_memory>\n")
	return sb.String()
}

func GetEmbeddings(text string) ([]float32, error) {
	return GetEmbedding(context.Background(), text)
}

func CosineSimilarity(a, b []float32) float32 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	var dotProduct, normA, normB float64
	for i := 0; i < len(a); i++ {
		dotProduct += float64(a[i]) * float64(b[i])
		normA += float64(a[i]) * float64(a[i])
		normB += float64(b[i]) * float64(b[i])
	}
	if normA == 0 || normB == 0 {
		return 0
	}
	return float32(dotProduct / (math.Sqrt(normA) * math.Sqrt(normB)))
}

func LoadEmbeddings() GulinEmbeddings {
	path := filepath.Join(GetGulinMemoryDir(), EmbeddingsFileName)
	data, err := os.ReadFile(path)
	if err != nil {
		return make(GulinEmbeddings)
	}
	var embs GulinEmbeddings
	json.Unmarshal(data, &embs)
	return embs
}

func SaveEmbeddings(embs GulinEmbeddings) error {
	path := filepath.Join(GetGulinMemoryDir(), EmbeddingsFileName)
	data, _ := json.MarshalIndent(embs, "", "  ")
	return os.WriteFile(path, data, 0600)
}

func IndexMemoryFiles() error {
	files, err := ListGulinMemoryFiles()
	if err != nil {
		return err
	}
	embs := LoadEmbeddings()
	updated := false

	for _, file := range files {
		if _, ok := embs[file]; !ok {
			content, err := ReadGulinMemoryFile(file)
			if err == nil {
				embedding, err := GetEmbeddings(content)
				if err == nil {
					embs[file] = embedding
					updated = true
				}
			}
		}
	}

	if updated {
		return SaveEmbeddings(embs)
	}
	return nil
}

func SearchGulinMemory(query string) ([]string, error) {
	queryEmb, err := GetEmbeddings(query)
	if err != nil {
		return nil, err
	}

	// Ensure everything is indexed
	IndexMemoryFiles()

	embs := LoadEmbeddings()
	type result struct {
		file  string
		score float32
	}
	var results []result

	for file, emb := range embs {
		score := CosineSimilarity(queryEmb, emb)
		if score > 0.6 { // Umbral de similitud
			results = append(results, result{file, score})
		}
	}

	// Sort by score
	for i := 0; i < len(results); i++ {
		for j := i + 1; j < len(results); j++ {
			if results[j].score > results[i].score {
				results[i], results[j] = results[j], results[i]
			}
		}
	}

	var topFiles []string
	for i := 0; i < len(results) && i < 3; i++ {
		topFiles = append(topFiles, results[i].file)
	}
	return topFiles, nil
}
