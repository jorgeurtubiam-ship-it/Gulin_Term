// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"

	"github.com/gulindev/gulin/pkg/gulinbase"
)

const GulinMemoryDirName = "gulin"
const EmbeddingsFileName = "embeddings.json"
const EndpointEmbeddingsAPI = "/api/embeddings"

type GulinEmbeddings map[string][]float32

func GetGulinMemoryDir() string {
	dataDir := gulinbase.GetGulinDataDir()
	workspaceDir := filepath.Dir(dataDir)
	return filepath.Join(workspaceDir, "memoria")
}

func EnsureGulinMemoryDir() error {
	dir := GetGulinMemoryDir()
	return os.MkdirAll(dir, 0700)
}

func UpdateGulinMemoryFile(filename string, content string) error {
	dataDir := gulinbase.GetGulinDataDir()
	workspaceDir := filepath.Dir(dataDir)
	
	// Si viene con path relativo, lo guardamos ahí, sino por defecto a memoria/
	var absPath string
	if strings.HasPrefix(filename, "skills/") {
		skillsDir := gulinbase.GetConfiguredSkillsDir()
		absPath = filepath.Join(skillsDir, strings.TrimPrefix(filepath.FromSlash(filename), "skills/"))
		os.MkdirAll(filepath.Dir(absPath), 0700)
	} else if strings.Contains(filename, "/") || strings.Contains(filename, "\\") {
		absPath = filepath.Join(workspaceDir, filepath.FromSlash(filename))
		// Ensure parent directory exists
		os.MkdirAll(filepath.Dir(absPath), 0700)
	} else {
		if err := EnsureGulinMemoryDir(); err != nil {
			return err
		}
		filename = filepath.Base(filename)
		if !strings.HasSuffix(filename, ".md") {
			filename += ".md"
		}
		absPath = filepath.Join(GetGulinMemoryDir(), filename)
	}

	return os.WriteFile(absPath, []byte(content), 0600)
}

func ReadGulinMemoryFile(filename string) (string, error) {
	dataDir := gulinbase.GetGulinDataDir()
	workspaceDir := filepath.Dir(dataDir)

	var absPath string
	if filepath.IsAbs(filename) {
		absPath = filename
	} else if strings.HasPrefix(filename, "skills/") {
		skillsDir := gulinbase.GetConfiguredSkillsDir()
		absPath = filepath.Join(skillsDir, strings.TrimPrefix(filepath.FromSlash(filename), "skills/"))
	} else if strings.Contains(filename, "/") || strings.Contains(filename, "\\") {
		// Es un path relativo al workspace
		absPath = filepath.Join(workspaceDir, filepath.FromSlash(filename))
	} else {
		// Compatibilidad hacia atrás (solo nombre base)
		filename = filepath.Base(filename)
		if !strings.HasSuffix(filename, ".md") {
			filename += ".md"
		}
		absPath = filepath.Join(GetGulinMemoryDir(), filename)
	}

	content, err := os.ReadFile(absPath)
	if err != nil {
		return "", err
	}
	return string(content), nil
}

func ListGulinMemoryFiles() ([]string, error) {
	if err := EnsureGulinMemoryDir(); err != nil {
		return nil, err
	}

	dataDir := gulinbase.GetGulinDataDir()
	workspaceDir := filepath.Dir(dataDir)

	// Carpetas clave a indexar para el RAG universal (EXCLUYE skills para no contaminar la memoria ambiental)
	targetDirs := []string{
		filepath.Join(workspaceDir, "memoria"),
		filepath.Join(workspaceDir, "learned"),
		filepath.Join(workspaceDir, ".agents"),
	}

	var files []string

	for _, dir := range targetDirs {
		filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil // ignorar directorios inaccesibles
			}
			if !info.IsDir() && strings.HasSuffix(info.Name(), ".md") {
				relPath, err := filepath.Rel(workspaceDir, path)
				if err == nil {
					// Guardar path relativo y universal para los keys JSON
					files = append(files, filepath.ToSlash(relPath))
				}
			}
			return nil
		})
	}

	return files, nil
}

func ListGulinSkillFiles() ([]string, error) {
	skillsDir := gulinbase.GetConfiguredSkillsDir()
	var files []string

	_ = filepath.Walk(skillsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() && (strings.HasSuffix(strings.ToLower(info.Name()), ".md") || strings.HasSuffix(strings.ToLower(info.Name()), ".skill")) {
			relPath, err := filepath.Rel(skillsDir, path)
			if err == nil {
				files = append(files, "skills/"+filepath.ToSlash(relPath))
			}
		}
		return nil
	})

	return files, nil
}

func ReadGulinSkillFile(skillName string) (string, error) {
	skillsDir := gulinbase.GetConfiguredSkillsDir()
	rel := strings.TrimPrefix(filepath.ToSlash(skillName), "skills/")

	candidates := []string{
		filepath.Join(skillsDir, rel),
		filepath.Join(skillsDir, rel, "SKILL.md"),
		filepath.Join(skillsDir, rel, "skill.md"),
		filepath.Join(skillsDir, rel+".md"),
		filepath.Join(skillsDir, strings.ReplaceAll(rel, "_", "-")),
		filepath.Join(skillsDir, strings.ReplaceAll(rel, "_", "-"), "SKILL.md"),
		filepath.Join(skillsDir, strings.ReplaceAll(rel, "_", "-"), "skill.md"),
		filepath.Join(skillsDir, strings.ReplaceAll(rel, "-", "_")),
		filepath.Join(skillsDir, strings.ReplaceAll(rel, "-", "_"), "SKILL.md"),
		filepath.Join(skillsDir, strings.ReplaceAll(rel, "-", "_"), "skill.md"),
	}

	for _, cand := range candidates {
		info, err := os.Stat(cand)
		if err == nil && !info.IsDir() {
			c, err := os.ReadFile(cand)
			if err == nil && len(c) > 0 {
				return string(c), nil
			}
		}
	}

	// Recursive walk in skillsDir matching cleanName
	clean := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(rel, "-", ""), "_", ""))
	clean = strings.TrimSuffix(clean, "skill.md")
	clean = strings.TrimSuffix(clean, ".md")
	clean = strings.Trim(clean, "/")

	var foundContent string
	_ = filepath.Walk(skillsDir, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil || info.IsDir() {
			return nil
		}
		pathNorm := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(filepath.ToSlash(path), "-", ""), "_", ""))
		if clean != "" && strings.Contains(pathNorm, clean) && (strings.HasSuffix(strings.ToLower(info.Name()), ".md") || strings.HasSuffix(strings.ToLower(info.Name()), ".skill")) {
			if c, readErr := os.ReadFile(path); readErr == nil && len(c) > 0 {
				foundContent = string(c)
				return filepath.SkipAll
			}
		}
		return nil
	})

	if foundContent != "" {
		return foundContent, nil
	}

	return "", fmt.Errorf("skill not found: %s", skillName)
}

func GetGulinSkillContext(skillName string) string {
	if skillName == "" {
		return ""
	}

	content, err := ReadGulinSkillFile(skillName)
	if err != nil {
		// Fallback to ReadGulinMemoryFile
		content, err = ReadGulinMemoryFile(skillName)
	}

	if err != nil || content == "" {
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

func IndexMemoryFiles() error {
	files, err := ListGulinMemoryFiles()
	if err != nil {
		return err
	}
	
	db, err := GetGlobalVectorDB()
	if err != nil {
		return err
	}

	ctx := context.Background()

	for _, file := range files {
		absPath := ""
		if filepath.IsAbs(file) {
			absPath = file
		} else {
			absPath = filepath.Join(filepath.Dir(gulinbase.GetGulinDataDir()), filepath.FromSlash(file))
		}

		info, err := os.Stat(absPath)
		if err != nil {
			continue
		}

		lastUpdated, _ := GetFileUpdatedAt(ctx, db, file)
		if info.ModTime().Unix() > lastUpdated {
			content, err := ReadGulinMemoryFile(file)
			if err == nil {
				InsertFileChunks(ctx, db, file, content)
			}
		}
	}

	return nil
}

func SearchGulinMemory(query string) ([]string, error) {
	// Ensure everything is indexed
	IndexMemoryFiles()

	db, err := GetGlobalVectorDB()
	if err != nil {
		return nil, err
	}

	results, err := SearchSemantically(context.Background(), db, query, 3)
	if err != nil {
		return nil, err
	}

	var topFiles []string
	seen := make(map[string]bool)
	for _, res := range results {
		// Strip chunk suffix (e.g. #0, #1)
		baseFile := strings.Split(res.FilePath, "#")[0]
		if !seen[baseFile] {
			topFiles = append(topFiles, baseFile)
			seen[baseFile] = true
		}
	}

	// Keyword & Filename matching fallback (e.g. o365, aws, dba, ley, etc.)
	queryWords := strings.Fields(strings.ToLower(query))
	allFiles, _ := ListGulinMemoryFiles()
	for _, f := range allFiles {
		fLower := strings.ToLower(f)
		for _, w := range queryWords {
			cleanWord := strings.Trim(w, "@,.?!:;\"'")
			if len(cleanWord) >= 3 && strings.Contains(fLower, cleanWord) {
				if !seen[f] {
					topFiles = append(topFiles, f)
					seen[f] = true
				}
			}
		}
	}
	
	return topFiles, nil
}
