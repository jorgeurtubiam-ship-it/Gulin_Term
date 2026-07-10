// Copyright 2026, GuLiN Terminal
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/gulinbase"
	"github.com/gulindev/gulin/pkg/util/utilfn"
	"github.com/gulindev/gulin/pkg/web/sse"

	"database/sql"

	_ "github.com/mattn/go-sqlite3"
)

// APICallInput describes a call to a registered API endpoint.
type APICallInput struct {
	// Name of the API as registered in the API Manager.
	APIName string `json:"api_name"`
	// HTTP method: GET, POST, PUT, DELETE, PATCH. Defaults to GET.
	Method string `json:"method,omitempty"`
	// Path to append to the base URL, e.g. "/users/1". Leave empty for the root.
	Path string `json:"path,omitempty"`
	// Optional JSON body for POST/PUT/PATCH requests (can be a string or an object).
	Body any `json:"body,omitempty"`
	// Optional extra headers as key:value pairs, e.g. {"Accept": "application/json"}.
	Headers map[string]string `json:"headers,omitempty"`
}


// listAPIEndpointNames returns all registered API names, for error hints.
func listAPIEndpointNames() ([]string, error) {
	dataDir := gulinbase.GetGulinDataDir()
	dbDir := filepath.Join(dataDir, gulinbase.GulinDBDir)
	if _, err := os.Stat(dbDir); os.IsNotExist(err) {
		os.MkdirAll(dbDir, 0755)
	}
	dbPath := filepath.Join(dbDir, "gulin.db")
	dsn := fmt.Sprintf("file:%s?_busy_timeout=5000&_journal_mode=WAL", dbPath)
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	rows, err := db.Query(fmt.Sprintf("SELECT name FROM %s ORDER BY name", GulinAPIEndpointsTable))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var names []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err == nil {
			names = append(names, n)
		}
	}
	return names, nil
}

// GetAPICallToolDefinition returns the tool definition for calling registered REST APIs.
func GetAPICallToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "apimanager_call",
		DisplayName: "Call API Manager Endpoint",
		ToolLogName: "apimanager:call",
		Description: strings.TrimSpace(`
Call an HTTP REST API that has been registered in the GuLiN API Manager widget.
The API Manager stores the base URL and credentials (token, username/password).
You have access to these credentials via 'apimanager_list'. Use them to construct authentication requests (like login endpoints) if needed.
You only need to provide the API name, the HTTP method, and optionally a path and body.
SECURE PLACEHOLDERS: You can also use {{username}}, {{password}}, and {{token}} inside 'body' or 'path' if you want the tool to swap them automatically for you.
Use this tool whenever the user mentions "api manager" or an API registered in the app.
8. DYNAMISM: Always read 'auth_instructions' from 'apimanager_list' before calling this tool. Follow those instructions strictly as they contain the correct endpoints for the specific environment.
9. URL EXTRACTION: If the user provides a full URL, extract the path and query yourself.
10. DEBUGGING: If apimanager_call returns 404 or 401, check the 'auth_instructions' again and use terminal commands (curl) to verify the correct endpoint.
`),
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"api_name": map[string]any{
					"type":        "string",
					"description": "Name of the API as saved in the GuLiN API Manager (case-sensitive).",
				},
				"method": map[string]any{
					"type":        "string",
					"enum":        []string{"GET", "POST", "PUT", "DELETE", "PATCH"},
					"description": "HTTP method. Defaults to GET.",
				},
				"path": map[string]any{
					"type":        "string",
					"description": "Path to append to the base URL, e.g. '/users' or '/v1/models'. Leave empty to call the base URL.",
				},
				"body": map[string]any{
					"type":        "string",
					"description": "JSON request body as a string (only for POST/PUT/PATCH).",
				},
				"headers": map[string]any{
					"type":        "object",
					"description": "Extra HTTP headers to include (e.g. {\"Accept\": \"application/json\"}).",
					"additionalProperties": map[string]any{
						"type": "string",
					},
				},
				"api_id":   map[string]any{"type": "string", "description": "Unique ID of the API to delete (optional)"},
			},
			"required":             []string{"api_name"},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			var parsed APICallInput
			inputBytes, _ := json.Marshal(input)
			json.Unmarshal(inputBytes, &parsed)
			method := parsed.Method
			if method == "" {
				method = "GET"
			}
			if parsed.Path != "" {
				return fmt.Sprintf("Call API %s: %s %s", parsed.APIName, method, parsed.Path)
			}
			return fmt.Sprintf("Call API %s: %s", parsed.APIName, method)
		},

		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			b, _ := json.Marshal(input)
			var parsed APICallInput
			json.Unmarshal(b, &parsed)

			if parsed.APIName == "" {
				return nil, fmt.Errorf("api_name is required")
			}

			// Resolve the API endpoint
			ep, err := getAPIEndpointByName(parsed.APIName)
			if err != nil {
				// Provide a helpful list of available APIs
				names, listErr := listAPIEndpointNames()
				if listErr == nil && len(names) > 0 {
					return nil, fmt.Errorf("%v. Available APIs: %s", err, strings.Join(names, ", "))
				}
				return nil, err
			}

			// Build URL
			method := strings.ToUpper(parsed.Method)
			if method == "" {
				method = "GET"
			}
			baseURL := strings.TrimRight(ep.URL, "/")
			path := parsed.Path

			// Handle body: can be string or object
			bodyStr := ""
			if parsed.Body != nil {
				switch v := parsed.Body.(type) {
				case string:
					bodyStr = v
				default:
					jb, _ := json.Marshal(v)
					bodyStr = string(jb)
				}
			}

			// Replace placeholders in Path, Body, and Headers
			replacePlaceholders := func(s string) string {
				username := ep.Username
				password := ep.Password

				s = strings.ReplaceAll(s, "{{username}}", username)
				s = strings.ReplaceAll(s, "{{password}}", password)
				
				if ep.Token != "" { s = strings.ReplaceAll(s, "{{token}}", ep.Token) }
				
				return s
			}

			path = replacePlaceholders(path)
			bodyStr = replacePlaceholders(bodyStr)
			for k, v := range parsed.Headers {
				parsed.Headers[k] = replacePlaceholders(v)
			}

			if path != "" && !strings.HasPrefix(path, "/") {
				path = "/" + path
			}
			fullURL := baseURL + path

			// Build request
			var bodyReader io.Reader
			if bodyStr != "" {
				bodyReader = strings.NewReader(bodyStr)
			}
			req, err := http.NewRequestWithContext(ctx, method, fullURL, bodyReader)
			if err != nil {
				return nil, fmt.Errorf("failed to build request: %w", err)
			}

			// Auth: prefer token, then basic auth
			if ep.Token != "" {
				req.Header.Set("Authorization", ep.Token)
			} else if ep.Username != "" && ep.Password != "" {
				req.SetBasicAuth(ep.Username, ep.Password)
			}

			// Default content type for body requests
			if bodyStr != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			req.Header.Set("Accept", "application/json")

			// Extra headers
			for k, v := range parsed.Headers {
				req.Header.Set(k, v)
			}

			// --- VISIBILIDAD PARA JORGE ---
			curlCmd := fmt.Sprintf("curl -X %s %s", method, fullURL)
			if bodyStr != "" { curlCmd += fmt.Sprintf(" -d '%s'", bodyStr) }
			fmt.Printf("\n[DEBUG API] %s\n", curlCmd)
			sse.SendDebugLog(ctx, sse.LogCatAPI, fmt.Sprintf("[DEBUG API] %s", curlCmd))
			toolUseData.Thought = fmt.Sprintf("Ejecutando: %s", curlCmd)
			// -------------------------

			// ENFORCEMENT: Dremio SQL must be POST
			if strings.Contains(fullURL, "/api/v3/sql") && method == "GET" {
				return nil, fmt.Errorf("DREMIO ERROR: El endpoint /api/v3/sql EXIGE el método POST. No intentes usar GET.")
			}

			// Execute
			client := &http.Client{Timeout: 30 * time.Second}
			resp, err := client.Do(req)
			if err != nil {
				return nil, fmt.Errorf("request failed: %w", err)
			}
			defer resp.Body.Close()

			respBody, err := io.ReadAll(resp.Body)
			if err != nil {
				return nil, fmt.Errorf("failed to read response: %w", err)
			}
			
			respStr := utilfn.StripANSI(string(respBody))
			fmt.Printf("[DEBUG RESP] %s\n", respStr)
			sse.SendDebugLog(ctx, sse.LogCatAPI, fmt.Sprintf("[DEBUG RESP] %s", respStr))

			// --- OPTIMIZACIÓN PARA JORGE: Solo pasar el Token a la IA ---
			var respJson map[string]interface{}
			if err := json.Unmarshal(respBody, &respJson); err == nil {
				if token, ok := respJson["token"].(string); ok {
					cleanJson := map[string]string{"token": token}
					cleanBytes, _ := json.Marshal(cleanJson)
					respStr = string(cleanBytes)
					fmt.Printf("[DEBUG OPTIMIZE] Respuesta de login reducida solo a token para ahorrar contexto.\n")
				}
			}
			// -----------------------------------------------------------


			// Try to pretty-print JSON responses and TRUNCATE if it's too huge, saving to file
			var prettyJSON any
			if err := json.Unmarshal(respBody, &prettyJSON); err == nil {
				prettyBytes, _ := json.MarshalIndent(prettyJSON, "", "  ")
				bodyStr = utilfn.StripANSI(string(prettyBytes))
				
				// Limit output length to prevent LLM context overflow (max ~15KB per API call)
				const MaxBodyLen = 15000
				if len(bodyStr) > MaxBodyLen {
					// Save to a temporary file so the AI can use python/bash to process it if needed
					tmpFile := filepath.Join(gulinbase.GetGulinDataDir(), "tmp_api_response.json")
					os.WriteFile(tmpFile, prettyBytes, 0644)
					
					truncMsg := fmt.Sprintf("\n\n... [RESPONSE TRUNCATED: The API returned a huge JSON payload (%d bytes) which exceeds the context limit. Only showing the first %d bytes.]\n>>> CRITICAL INSTRUCTION: The FULL JSON response has been saved to the local file: %s\n>>> DO NOT try to read this file into chat (no cat, no read_file) or you will crash. Instead, use term_run_command to run a Python script that reads this file, performs the necessary data aggregation/counting, and prints a small summary. Then use that summary to generate the chart.", len(bodyStr), MaxBodyLen, tmpFile)
					bodyStr = bodyStr[:MaxBodyLen] + truncMsg
				}

				// --- SMART WAIT FOR DREMIO ---
				// 1. Si acabamos de lanzar un SQL, esperamos 10s obligatorios para que Dremio procese
				if strings.Contains(fullURL, "/api/v3/sql") {
					fmt.Printf("[SMART WAIT] SQL Lanzado. Esperando 10 segundos obligatorios para el DataLake...\n")
					time.Sleep(10 * time.Second)
				}

				// 2. Si el estado del job no es COMPLETED, esperamos otros 10 segundos
				if strings.Contains(bodyStr, "\"jobState\"") && !strings.Contains(bodyStr, "\"COMPLETED\"") {
					fmt.Printf("[SMART WAIT] Job en curso... esperando 10 segundos más.\n")
					time.Sleep(10 * time.Second)
				}
				// -----------------------------
				
				return map[string]any{
					"status":  resp.StatusCode,
					"url":     fullURL,
					"method":  method,
					"body":    bodyStr,
				}, nil
			}

			// Non-JSON response truncation
			bodyStr = respStr
			if strings.Contains(strings.ToLower(bodyStr), "<html") {
				bodyStr += "\n\n>>> WARNING: This endpoint returned HTML instead of JSON. You might be calling a UI URL instead of an API endpoint. For Dremio, ensure your path starts with /api/v3/ (e.g. /api/v3/login)."
			}
			const MaxStringLen = 15000
			if len(bodyStr) > MaxStringLen {
				tmpFile := filepath.Join(gulinbase.GetGulinDataDir(), "tmp_api_response.txt")
				os.WriteFile(tmpFile, respBody, 0644)
				bodyStr = bodyStr[:MaxStringLen] + fmt.Sprintf("\n\n... [TRUNCATED: %d bytes. Full response saved to %s. CRITICAL: DO NOT read this file into chat. Use python/bash to process it and print a summary.]", len(bodyStr), tmpFile)
			}

			return map[string]any{
				"status": resp.StatusCode,
				"url":    fullURL,
				"method": method,
				"body":   bodyStr,
			}, nil
		},
	}
}

// GetAPIListToolDefinition returns a tool to list all registered APIs (so the AI knows what's available).
func GetAPIListToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "apimanager_list",
		DisplayName: "List API Manager Endpoints",
		ToolLogName: "apimanager:list",
		Description: "List all APIs registered securely in the GuLiN API Manager. Use this before calling apimanager_call if you are unsure which APIs are available or if the user tells you to check the api manager.",
		InputSchema: map[string]any{
			"type":                 "object",
			"properties":           map[string]any{},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			return "List registered APIs"
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			dataDir := gulinbase.GetGulinDataDir()
			dbPath := filepath.Join(dataDir, gulinbase.GulinDBDir, "gulin.db")
			dsn := fmt.Sprintf("file:%s?_busy_timeout=5000&_journal_mode=WAL", dbPath)
			db, err := sql.Open("sqlite3", dsn)
			if err != nil {
				return nil, fmt.Errorf("failed to open db: %w", err)
			}
			defer db.Close()

			rows, err := db.Query(
				fmt.Sprintf("SELECT name, url, COALESCE(username, ''), COALESCE(password, ''), COALESCE(token, ''), COALESCE(system_prompt, ''), COALESCE(knowledge_source, ''), COALESCE(auth_instructions, '') FROM %s ORDER BY name", GulinAPIEndpointsTable),
			)
			if err != nil {
				return nil, fmt.Errorf("failed to query APIs: %w", err)
			}
			defer rows.Close()

			type APIInfo struct {
				Name             string `json:"name"`
				URL              string `json:"url"`
				Username         string `json:"username,omitempty"`
				Password         string `json:"password,omitempty"`
				Token            string `json:"token,omitempty"`
				SystemPrompt     string `json:"system_prompt,omitempty"`
				KnowledgeSource  string `json:"knowledge_source,omitempty"`
				AuthInstructions string `json:"auth_instructions,omitempty"`
			}
			var apis []APIInfo
			for rows.Next() {
				var a APIInfo
				rows.Scan(&a.Name, &a.URL, &a.Username, &a.Password, &a.Token, &a.SystemPrompt, &a.KnowledgeSource, &a.AuthInstructions)
				apis = append(apis, a)
			}
			if len(apis) == 0 {
				return "No APIs registered. Use the API Manager widget to add one.", nil
			}
			return apis, nil
		},
	}
}

func getAPIEndpointByName(name string) (*uctypes.APIEndpointInfo, error) {
	dataDir := gulinbase.GetGulinDataDir()
	dbDir := filepath.Join(dataDir, gulinbase.GulinDBDir)
	if _, err := os.Stat(dbDir); os.IsNotExist(err) {
		os.MkdirAll(dbDir, 0755)
	}
	dbPath := filepath.Join(dbDir, "gulin.db")
	dsn := fmt.Sprintf("file:%s?_busy_timeout=5000&_journal_mode=WAL", dbPath)
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open gulin db: %w", err)
	}
	defer db.Close()

	row := db.QueryRow(
		fmt.Sprintf("SELECT id, name, url, username, password, token, system_prompt, knowledge_source, auth_instructions, created_at, updated_at FROM %s WHERE LOWER(name) = LOWER(?) LIMIT 1", GulinAPIEndpointsTable),
		name,
	)
	var ep uctypes.APIEndpointInfo
	var username, password, token, systemPrompt, knowledgeSource, authInstructions sql.NullString

	if err := row.Scan(&ep.ID, &ep.Name, &ep.URL, &username, &password, &token, &systemPrompt, &knowledgeSource, &authInstructions, &ep.CreatedAt, &ep.UpdatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("API '%s' not found", name)
		}
		return nil, fmt.Errorf("error reading API endpoint: %w", err)
	}

	if username.Valid { ep.Username = username.String }
	if password.Valid { ep.Password = password.String }
	if token.Valid { ep.Token = token.String }
	if systemPrompt.Valid { ep.SystemPrompt = systemPrompt.String }
	if knowledgeSource.Valid { ep.KnowledgeSource = knowledgeSource.String }
	if authInstructions.Valid { ep.AuthInstructions = authInstructions.String }

	return &ep, nil
}

// GetAPIDeleteToolDefinition returns a tool to delete a registered API by name.
func GetAPIDeleteToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "apimanager_delete",
		DisplayName: "Delete API Manager Endpoint",
		ToolLogName: "apimanager:delete",
		Description: "Permanently delete an API endpoint registered in the GuLiN API Manager by its name. Use this only when the user explicitly asks to remove or delete an API registration.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"api_name": map[string]any{"type": "string", "description": "Name of the API to delete"},
				"api_id":   map[string]any{"type": "string", "description": "Unique ID of the API to delete (optional)"},
			},
			"required":             []string{},
			"additionalProperties": false,
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			m, ok := input.(map[string]any)
			if !ok { return "Delete API" }
			if name, ok := m["api_name"].(string); ok && name != "" {
				return fmt.Sprintf("Delete API: %s", name)
			}
			return "Delete API"
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			m, ok := input.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("invalid input")
			}
			name, _ := m["api_name"].(string)
			id, _ := m["api_id"].(string)

			if name == "" && id == "" {
				return nil, fmt.Errorf("api_name or api_id is required")
			}

			db, err := getAPIContextDB()
			if err != nil {
				return nil, fmt.Errorf("failed to open db: %w", err)
			}
			defer db.Close()

			var res sql.Result
			if id != "" {
				res, err = db.Exec(fmt.Sprintf("DELETE FROM %s WHERE id = ?", GulinAPIEndpointsTable), id)
			} else {
				res, err = db.Exec(fmt.Sprintf("DELETE FROM %s WHERE name = ?", GulinAPIEndpointsTable), name)
			}

			if err != nil {
				return nil, fmt.Errorf("failed to delete API: %w", err)
			}

			count, _ := res.RowsAffected()
			if count == 0 {
				return nil, fmt.Errorf("API '%s' not found in the manager", name)
			}

			return fmt.Sprintf("API '%s' has been successfully deleted from the GuLiN API Manager.", name), nil
		},
	}
}
// GetAPIRegisterToolDefinition returns a tool to register a new API in the manager.
func GetAPIRegisterToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "apimanager_register",
		DisplayName: "Register API Manager Endpoint",
		ToolLogName: "apimanager:register",
		Description: "Register a new API endpoint in the GuLiN API Manager. Provide a name, base URL, and optionally credentials (username, password, token).",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"name":     map[string]any{"type": "string", "description": "Unique name for this API (e.g. 'dremio')"},
				"url":      map[string]any{"type": "string", "description": "Base URL of the API (e.g. 'http://127.0.0.1:9047')"},
				"username":          map[string]any{"type": "string", "description": "Username for authentication (optional)"},
				"password":          map[string]any{"type": "string", "description": "Password for authentication (optional)"},
				"token":             map[string]any{"type": "string", "description": "API token or Bearer token (optional)"},
				"system_prompt":     map[string]any{"type": "string", "description": "Custom identity or instructions for this API (optional)"},
				"knowledge_source":  map[string]any{"type": "string", "description": "URL or description of the knowledge source for this API (optional)"},
				"auth_instructions": map[string]any{"type": "string", "description": "Specific login path or token usage instructions (optional)"},
			},
			"required": []string{"name", "url"},
		},
		ToolCallDesc: func(input any, output any, toolUseData *uctypes.UIMessageDataToolUse) string {
			b, _ := json.Marshal(input)
			var req uctypes.APIEndpointInfo
			json.Unmarshal(b, &req)
			return fmt.Sprintf("Register API: %s", req.Name)
		},
		ToolAnyCallback: func(ctx context.Context, input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			b, _ := json.Marshal(input)
			var req uctypes.APIEndpointInfo
			json.Unmarshal(b, &req)

			db, err := getAPIContextDB()
			if err != nil {
				return nil, err
			}
			defer db.Close()

			// ASEGURAR QUE LA TABLA EXISTA
			EnsureAPIEndpointsSchema(db)

			// BUSCAR SI YA EXISTE POR NOMBRE PARA REUTILIZAR EL ID (Case-insensitive)
			existing := uctypes.APIEndpointInfo{}
			var exURL, exUser, exPass, exToken, exPrompt, exSource, exAuth sql.NullString
			err = db.QueryRow(fmt.Sprintf("SELECT id, url, username, password, token, system_prompt, knowledge_source, auth_instructions, created_at FROM %s WHERE LOWER(name) = LOWER(?)", GulinAPIEndpointsTable), req.Name).Scan(
				&existing.ID, &exURL, &exUser, &exPass, &exToken, &exPrompt, &exSource, &exAuth, &existing.CreatedAt,
			)

			now := time.Now().UnixMilli()
			if err == nil && existing.ID != "" {
				req.ID = existing.ID
				req.CreatedAt = existing.CreatedAt
				// Patch behavior: keep existing values if new ones are empty
				if req.URL == "" && exURL.Valid { req.URL = exURL.String }
				if req.Username == "" && exUser.Valid { req.Username = exUser.String }
				if req.Password == "" && exPass.Valid { req.Password = exPass.String }
				if req.Token == "" && exToken.Valid { req.Token = exToken.String }
				if req.SystemPrompt == "" && exPrompt.Valid { req.SystemPrompt = exPrompt.String }
				if req.KnowledgeSource == "" && exSource.Valid { req.KnowledgeSource = exSource.String }
				if req.AuthInstructions == "" && exAuth.Valid { req.AuthInstructions = exAuth.String }
			} else {
				req.ID = uuid.New().String()
				req.CreatedAt = now
			}
			req.UpdatedAt = now

			query := fmt.Sprintf(`
				INSERT INTO %s (id, name, url, username, password, token, system_prompt, knowledge_source, auth_instructions, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					name=excluded.name,
					url=excluded.url,
					username=excluded.username,
					password=excluded.password,
					token=excluded.token,
					system_prompt=excluded.system_prompt,
					knowledge_source=excluded.knowledge_source,
					auth_instructions=excluded.auth_instructions,
					updated_at=excluded.updated_at`, GulinAPIEndpointsTable)
			_, err = db.Exec(query, req.ID, req.Name, req.URL, req.Username, req.Password, req.Token, req.SystemPrompt, req.KnowledgeSource, req.AuthInstructions, req.CreatedAt, req.UpdatedAt)
			if err != nil {
				return nil, fmt.Errorf("failed to register API: %w", err)
			}
			return fmt.Sprintf("API '%s' registrada/actualizada exitosamente en el API Manager.", req.Name), nil
		},
	}
}

func getAPIContextDB() (*sql.DB, error) {
	dataDir := gulinbase.GetGulinDataDir()
	dbDir := filepath.Join(dataDir, gulinbase.GulinDBDir)
	if _, err := os.Stat(dbDir); os.IsNotExist(err) {
		os.MkdirAll(dbDir, 0755)
	}
	dbPath := filepath.Join(dbDir, "gulin.db")
	dsn := fmt.Sprintf("file:%s?_busy_timeout=5000&_journal_mode=WAL", dbPath)
	return sql.Open("sqlite3", dsn)
}
