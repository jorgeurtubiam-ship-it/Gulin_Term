// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package aiusechat — Execution Reflection Engine
//
// Cuando una herramienta falla, este motor analiza el error en segundo plano
// y guarda un Insight en `.gulin/insights.md` dentro del directorio del proyecto activo.
// La próxima vez que el agente trabaje en ese proyecto, lee esos insights
// y los inyecta en el System Prompt para no repetir el mismo error.

package aiusechat

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/gulindev/gulin/pkg/gulinbase"
)

const (
	GulinProjectDirName   = ".gulin"
	GulinInsightsFileName = "insights.md"
	ReflectionMaxInsights = 50 // máximo de insights por proyecto antes de rotar

	// Presupuesto de inyección de insights en el System Prompt.
	// Sin estos topes, un proyecto con 33+ insights metía ~150 KB (~37 K tokens)
	// de prompt fijo en CADA request, aunque la pregunta fuese trivial.
	ProjectInsightsMaxFiles     = 15        // solo los N insights más recientes
	ProjectInsightsMaxBytes     = 24 * 1024 // tope duro del bloque completo
	ProjectInsightsMaxFileBytes = 4 * 1024  // tope por archivo individual
)

// projectRootMarkers son archivos/carpetas que indican la raíz de un proyecto.
var projectRootMarkers = []string{
	".git", "go.mod", "package.json", "Cargo.toml",
	"pyproject.toml", "pom.xml", "Taskfile.yml", "Makefile",
}

// FindProjectRoot busca la raíz del proyecto subiendo desde el directorio dado.
// Si no encuentra un marcador conocido, usa el directorio inicial como raíz.
func FindProjectRoot(startDir string) string {
	if startDir == "" {
		return ""
	}

	dir := startDir
	for {
		for _, marker := range projectRootMarkers {
			if _, err := os.Stat(filepath.Join(dir, marker)); err == nil {
				return dir
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			// llegamos al filesystem root sin encontrar marcador
			break
		}
		dir = parent
	}

	// Fallback: usar el directorio inicial
	return startDir
}

// ExtractCwdFromTabState extrae el directorio de trabajo (CWD) del TabState de WaveTerm.
// WaveTerm genera el estado con el formato (ver makeTerminalBlockDesc en tools.go):
//
//   - (abc12345) local CLI terminal (zsh), in directory "/Users/lordzero1/Gulin_Agent"
func ExtractCwdFromTabState(tabState string) string {
	if tabState == "" {
		return ""
	}

	// Patrón principal: 'in directory "/ruta"' con comillas dobles (formato real de WaveTerm)
	reInDir := regexp.MustCompile(`in directory "([^"]+)"`)
	if m := reInDir.FindStringSubmatch(tabState); len(m) > 1 {
		candidate := m[1]
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
	}

	// Fallback 1: 'cwd: /ruta' o 'directory: /ruta' (otros formatos posibles)
	reCwd := regexp.MustCompile(`(?i)(?:cwd|dir(?:ectory)?):\s*"?([^\s\n"]+)"?`)
	if m := reCwd.FindStringSubmatch(tabState); len(m) > 1 {
		candidate := m[1]
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
	}

	// Fallback 2: buscar rutas absolutas con prefijos Unix conocidos
	reAbsPath := regexp.MustCompile(`"(/(?:Users|home|root|var|opt|srv|workspace|[Pp]rojects?|[Cc]ode|[Dd]ev)[^"\s\n]*)"`)
	if m := reAbsPath.FindStringSubmatch(tabState); len(m) > 1 {
		candidate := m[1]
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
	}

	// Fallback final: usar el directorio de trabajo del proceso del servidor
	if cwd, err := os.Getwd(); err == nil {
		return cwd
	}

	return ""
}

func getLearnedBaseDir() string {
	dataDir := gulinbase.GetGulinDataDir()
	workspaceDir := filepath.Dir(dataDir)
	return filepath.Join(workspaceDir, "learned")
}

// GetProjectInsightsDir retorna la ruta a la carpeta del proyecto dentro de learned/
func GetProjectInsightsDir(tabState string) string {
	cwd := ExtractCwdFromTabState(tabState)
	if cwd == "" {
		cwd, _ = os.Getwd()
	}

	projectName := "general"
	if cwd != "" {
		root := FindProjectRoot(cwd)
		if root != "" {
			projectName = filepath.Base(root)
		}
	}

	return filepath.Join(getLearnedBaseDir(), projectName)
}

// AppendProjectInsight agrega un insight usando el formato ADR (001-xxx.md).
func AppendProjectInsight(insightsDir string, toolName string, insight string) error {
	if insightsDir == "" {
		return fmt.Errorf("no insights dir provided")
	}

	if err := os.MkdirAll(insightsDir, 0700); err != nil {
		return fmt.Errorf("failed to create learned dir: %w", err)
	}

	// Buscar el número de secuencia más alto
	entries, err := os.ReadDir(insightsDir)
	maxSeq := 0
	if err == nil {
		for _, entry := range entries {
			if entry.IsDir() || filepath.Ext(entry.Name()) != ".md" {
				continue
			}
			var seq int
			if n, _ := fmt.Sscanf(entry.Name(), "%03d", &seq); n == 1 {
				if seq > maxSeq {
					maxSeq = seq
				}
			}
		}
	}

	nextSeq := maxSeq + 1

	safeToolName := strings.ReplaceAll(toolName, " ", "-")
	safeToolName = strings.ReplaceAll(safeToolName, "/", "-")
	fileName := fmt.Sprintf("%03d-insight-%s.md", nextSeq, safeToolName)
	filePath := filepath.Join(insightsDir, fileName)

	timestamp := time.Now().Format("2006-01-02 15:04")
	content := fmt.Sprintf("# Gulin — Lección Aprendida\n\nGenerado automáticamente.\n\n## [%s] %s\n> %s\n", timestamp, toolName, insight)

	return os.WriteFile(filePath, []byte(content), 0600)
}

// ReflectOnToolFailure analiza un error de herramienta en segundo plano y guarda el insight.
// Debe llamarse como goroutine: go ReflectOnToolFailure(...)
func ReflectOnToolFailure(toolName string, errorText string, tabState string) {
	insightsDir := GetProjectInsightsDir(tabState)
	if insightsDir == "" {
		log.Printf("[ReflectionEngine] No se pudo determinar directorio de insights. Omitiendo reflexión para '%s'.\n", toolName)
		return
	}

	log.Printf("[ReflectionEngine] Analizando fallo de '%s' → insight en: %s\n", toolName, insightsDir)

	// Generar insight heurístico basado en el patrón del error
	insight := generateHeuristicInsight(toolName, errorText)
	if insight == "" {
		log.Printf("[ReflectionEngine] Error sin patrón reconocible para '%s', omitiendo.\n", toolName)
		return
	}

	if err := AppendProjectInsight(insightsDir, toolName, insight); err != nil {
		log.Printf("[ReflectionEngine] Error guardando insight: %v\n", err)
		return
	}

	log.Printf("[ReflectionEngine] ✓ Insight guardado para '%s'.\n", toolName)
}

// generateHeuristicInsight genera un insight basado en patrones conocidos de errores,
// sin necesidad de llamar al LLM. Es rápido y no consume tokens.
func generateHeuristicInsight(toolName string, errorText string) string {
	errLower := strings.ToLower(errorText)

	// Patrones de errores comunes → insights directos
	type pattern struct {
		keywords []string
		insight  string
	}

	patterns := []pattern{
		{
			keywords: []string{"permission denied", "permiso denegado", "operation not permitted"},
			insight:  fmt.Sprintf("La herramienta '%s' requiere permisos elevados. Considera usar 'sudo' o verificar los permisos del archivo/directorio antes de ejecutar.", toolName),
		},
		{
			keywords: []string{"command not found", "no such file or directory", "executable file not found"},
			insight:  fmt.Sprintf("El binario o archivo utilizado por '%s' no está instalado o no existe en el PATH. Verifica la instalación o usa la ruta absoluta.", toolName),
		},
		{
			keywords: []string{"connection refused", "connection reset", "timeout", "dial tcp", "i/o timeout"},
			insight:  fmt.Sprintf("'%s' falló por un problema de conectividad de red. Verifica que el servicio remoto esté activo y accesible antes de ejecutar.", toolName),
		},
		{
			keywords: []string{"syntax error", "parse error", "invalid syntax", "unexpected token", "unexpected end of json"},
			insight:  fmt.Sprintf("'%s' recibió una sintaxis inválida. Revisa el formato de los argumentos y asegúrate de escapar correctamente los caracteres especiales.", toolName),
		},
		{
			keywords: []string{"does not exist", "relation", "no such table", "unknown column", "column", "table"},
			insight:  fmt.Sprintf("'%s' encontró un error de esquema en la base de datos. Verifica los nombres exactos de tablas y columnas antes de operar sobre ellas.", toolName),
		},
		{
			keywords: []string{"port", "already in use", "address already in use", "bind: address"},
			insight:  fmt.Sprintf("'%s' falló porque el puerto necesario ya está en uso. Verifica los procesos activos con 'lsof -i :PUERTO' antes de levantar el servicio.", toolName),
		},
		{
			keywords: []string{"out of memory", "killed", "oom", "cannot allocate memory"},
			insight:  fmt.Sprintf("'%s' fue terminado por falta de memoria. Procesa los datos en bloques más pequeños o verifica la memoria disponible antes de ejecutar.", toolName),
		},
		{
			keywords: []string{"not authenticated", "unauthorized", "401", "403", "forbidden", "invalid token", "invalid api key"},
			insight:  fmt.Sprintf("'%s' falló por autenticación. Verifica que el token/credenciales estén vigentes y correctamente configurados antes de llamar a la API.", toolName),
		},
		{
			keywords: []string{"rate limit", "too many requests", "429", "quota exceeded"},
			insight:  fmt.Sprintf("'%s' alcanzó el límite de velocidad de la API. Agrega pausas entre llamadas o reduce la frecuencia de solicitudes.", toolName),
		},
		{
			keywords: []string{"disk full", "no space left", "insufficient disk"},
			insight:  fmt.Sprintf("'%s' falló por falta de espacio en disco. Verifica el espacio disponible con 'df -h' antes de operaciones que escriban datos.", toolName),
		},
	}

	for _, p := range patterns {
		for _, kw := range p.keywords {
			if strings.Contains(errLower, kw) {
				return p.insight
			}
		}
	}

	// Insight genérico si no hay patrón conocido
	if len(errorText) > 0 {
		shortError := errorText
		if len(shortError) > 120 {
			shortError = shortError[:120] + "..."
		}
		return fmt.Sprintf("La herramienta '%s' falló con: \"%s\". Revisa este error antes de reintentar en este contexto.", toolName, shortError)
	}

	return ""
}

// ReadProjectInsights lee los archivos ADR de insights del proyecto activo
// y retorna su contenido listo para inyectar en el System Prompt.
// Retorna "" si no hay insights o no se puede leer el archivo.
func ReadProjectInsights(tabState string) string {
	insightsDir := GetProjectInsightsDir(tabState)
	if insightsDir == "" {
		return ""
	}
	return readInsightsFromDir(insightsDir)
}

// readInsightsFromDir lee los insights de un directorio aplicando el presupuesto
// de contexto (máx N archivos por recencia, tope por archivo y tope global).
func readInsightsFromDir(insightsDir string) string {
	entries, err := os.ReadDir(insightsDir)
	if err != nil {
		return "" // directorio no existe, es normal
	}

	// Ordenar por fecha de modificación DESC: los insights más recientes son los
	// más valiosos. Antes se insertaban TODOS los archivos completos sin tope de
	// tamaño, agotando el contexto del modelo en cada llamada.
	type insightFile struct {
		name    string
		modTime int64
		size    int64
	}
	var candidates []insightFile
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".md" {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		candidates = append(candidates, insightFile{
			name:    entry.Name(),
			modTime: info.ModTime().UnixNano(),
			size:    info.Size(),
		})
	}

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].modTime > candidates[j].modTime
	})

	var sb strings.Builder
	count := 0
	omitted := 0
	for _, c := range candidates {
		if count >= ProjectInsightsMaxFiles {
			omitted = len(candidates) - count
			break
		}

		data, err := os.ReadFile(filepath.Join(insightsDir, c.name))
		if err != nil {
			continue
		}

		body := string(data)
		if len(body) > ProjectInsightsMaxFileBytes {
			body = body[:ProjectInsightsMaxFileBytes] + "\n\n[...insight truncado por límite de contexto...]\n"
		}

		// Reservamos espacio para la cabecera del bloque (~250 bytes).
		if sb.Len()+len(body)+64 > ProjectInsightsMaxBytes-512 {
			omitted = len(candidates) - count
			break
		}

		sb.WriteString("\n--- Archivo: ")
		sb.WriteString(c.name)
		sb.WriteString(" ---\n")
		sb.WriteString(body)
		sb.WriteString("\n")
		count++
	}

	if count == 0 {
		return ""
	}

	var finalSb strings.Builder
	finalSb.WriteString("\n<gulin_lessons_learned>\n")
	finalSb.WriteString(fmt.Sprintf("LECCIONES APRENDIDAS EN ESTE PROYECTO (%d insights):\n", count))
	finalSb.WriteString("Lee estos insights ANTES de ejecutar cualquier herramienta. Son errores reales que ocurrieron en este proyecto y debes evitar repetirlos.\n\n")
	finalSb.WriteString(sb.String())
	if omitted > 0 {
		finalSb.WriteString(fmt.Sprintf("\n[%d insights adicionales omitidos por presupuesto de contexto. Usa brain_search o read_text_file si necesitas el histórico completo de learned/%s/]\n", omitted, filepath.Base(insightsDir)))
	}
	finalSb.WriteString("\n</gulin_lessons_learned>\n")

	return finalSb.String()
}
