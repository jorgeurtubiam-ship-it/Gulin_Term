// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gulindev/gulin/pkg/gulinbase"
)

const GulinMemoryDirName = "gulin"
const EmbeddingsFileName = "embeddings.json"
const EndpointEmbeddingsAPI = "/api/embeddings"

// Budget for the ambient memory injected into every system prompt.
// The semantic search returns 3 files; the keyword fallback is capped at the
// same order of magnitude, and the total injected payload is hard-capped so a
// pathological query can never blow up the prompt (or the renderer).
const (
	MemorySearchMaxFiles     = 9
	MemoryInjectMaxBytes     = 24 * 1024
	MemoryInjectMaxFileBytes = 8 * 1024
)

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
		filepath.Join(workspaceDir, "clientes"),
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

	var sb strings.Builder
	sb.WriteString("\n<gulin_brain_memory>\n")
	sb.WriteString("Esta es tu MEMORIA A LARGO PLAZO (RAG). Contiene hábitos, lecciones aprendidas y contexto importante recuperado automáticamente para esta conversación.\n")
	sb.WriteString("IMPORTANTE: Toda la información que necesitas sobre el usuario ya está aquí abajo. NO uses herramientas de búsqueda (brain_search) si la respuesta ya está en este bloque.\n")

	hits, _ := SearchGulinMemoryHits(query)

	if len(hits) == 0 {
		// Sin resultados semánticos: fallback legacy (sesion-actual + más recientes).
		for _, f := range fallbackMemoryFiles(files) {
			content, rErr := ReadGulinMemoryFile(f)
			if rErr != nil {
				continue
			}
			if len(content) > MemoryInjectMaxFileBytes {
				content = content[:MemoryInjectMaxFileBytes] + "\n\n[...contenido truncado por límite de contexto...]"
			}
			if sb.Len()+len(content) > MemoryInjectMaxBytes {
				break
			}
			sb.WriteString(fmt.Sprintf("\n### Archivo: %s\n", f))
			sb.WriteString(content)
			sb.WriteString("\n")
		}
		sb.WriteString("\n</gulin_brain_memory>\n")
		return sb.String()
	}

	// Inyección por chunks: lo que se rankeó es exactamente lo que se inyecta.
	// Antes se volcaba el archivo completo (hasta 32 KB) y un solo archivo
	// agotaba el presupuesto global de 24 KB.
	curFile := ""
	perFile := 0
	for _, h := range hits {
		if h.File != curFile {
			curFile = h.File
			perFile = 0
		}
		if perFile >= MemoryMaxChunksPerFile {
			continue
		}
		content := h.Content
		if len(content) > MemoryInjectMaxFileBytes {
			content = content[:MemoryInjectMaxFileBytes]
		}
		if sb.Len()+len(content) > MemoryInjectMaxBytes {
			break
		}
		if perFile == 0 {
			sb.WriteString(fmt.Sprintf("\n### Archivo: %s (fragmento %d)\n", h.File, h.Index))
		}
		sb.WriteString(content)
		sb.WriteString("\n")
		perFile++
	}

	sb.WriteString("\n</gulin_brain_memory>\n")
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

// orphanPurgeState tracks the last orphan purge so it does not run on every message.
var orphanPurgeState = struct {
	sync.Mutex
	lastRun   time.Time
	lastFiles string
}{}

// orphanPurgeInterval is the safety-net minimum between two purge runs.
const orphanPurgeInterval = 5 * time.Minute

// shouldRunOrphanPurge decides whether the orphan purge is needed.
// It returns true when the set of files on disk changed since the last run
// (a file was added or deleted), or when more than orphanPurgeInterval has
// elapsed since the last run (safety net for files removed outside the workspace).
func shouldRunOrphanPurge(files []string) (bool, error) {
	orphanPurgeState.Lock()
	defer orphanPurgeState.Unlock()

	// Cheap fingerprint of the file set: sorted names joined.
	names := make([]string, len(files))
	copy(names, files)
	sort.Strings(names)
	fingerprint := strings.Join(names, "\n")

	if fingerprint != orphanPurgeState.lastFiles {
		orphanPurgeState.lastFiles = fingerprint
		orphanPurgeState.lastRun = time.Now()
		return true, nil
	}

	if time.Since(orphanPurgeState.lastRun) > orphanPurgeInterval {
		orphanPurgeState.lastRun = time.Now()
		return true, nil
	}

	return false, nil
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

	// Purge orphaned chunks BEFORE indexing, synchronously.
	// The purge used to run in a background goroutine when the vector DB was opened,
	// which raced with this indexing pass and could delete chunks that had just been
	// written (leaving the file with zero chunks in the vector DB).
	//
	// It used to run unconditionally on EVERY message. That meant a full
	// "SELECT DISTINCT filepath" + one os.Stat() per chunk on every single chat
	// turn. It is now throttled: the purge only runs when the set of files on disk
	// has actually changed since the last run, or at most once every 5 minutes as
	// a safety net.
	shouldPurge, err := shouldRunOrphanPurge(files)
	if err != nil {
		log.Printf("[memory_brain] orphan purge check failed: %v", err)
	}
	if shouldPurge {
		if _, err := PurgeVectorDBOrphans(db); err != nil {
			log.Printf("[memory_brain] purge of orphaned chunks failed: %v", err)
		}
	}

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

		// Safeguard: no indexar ficheros binarios/enormes (>2MB). Los .md grandes
		// se indexan truncados (cabecera + final) con truncateMemoryForIndex.
		if info.Size() > 2*1024*1024 {
			log.Printf("[memory_brain] skipping huge file (%d bytes): %s", info.Size(), file)
			continue
		}

		lastUpdated, _ := GetFileUpdatedAt(ctx, db, file)

		// A file whose chunks were indexed before the embedding_provider tag
		// existed has an UNKNOWN vector space, so the space-filtered search
		// excludes it. The mtime check alone would never re-index it (the
		// file did not change), leaving it permanently invisible. Detect that
		// case and force a re-index.
		needsReindex := false
		if legacy, err := HasChunksWithoutProvider(ctx, db, file); err == nil && legacy {
			needsReindex = true
		}

		if needsReindex || info.ModTime().Unix() > lastUpdated {
			content, err := ReadGulinMemoryFile(file)
			if err == nil {
				content = truncateMemoryForIndex(content)
				// Detect client ID if the file is under clientes/<client_name>/
				clientID := ""
				parts := strings.Split(filepath.ToSlash(file), "/")
				if len(parts) >= 2 && parts[0] == "clientes" {
					clientID = parts[1]
				}

				if err := InsertFileChunks(ctx, db, file, content, clientID); err != nil {
					log.Printf("[memory_brain] failed to index %s: %v", file, err)
				}
			}
		}
	}

	return nil
}

func SearchGulinMemory(query string) ([]string, error) {
	// Ensure everything is indexed
	IndexMemoryFiles()

	hits, err := SearchGulinMemoryHits(query)
	if err != nil {
		return nil, err
	}

	var topFiles []string
	seen := make(map[string]bool)
	for _, h := range hits {
		if !seen[h.File] {
			topFiles = append(topFiles, h.File)
			seen[h.File] = true
		}
	}
	return topFiles, nil
}
