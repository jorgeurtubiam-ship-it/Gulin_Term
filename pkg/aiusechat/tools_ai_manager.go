package aiusechat

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"path/filepath"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/gulinbase"
)

const GulinAPIEndpointsTable = "gulin_api_endpoints"

func getGulintermDB() (*sql.DB, error) {
	dataDir := gulinbase.GetGulinDataDir()
	dbDir := filepath.Join(dataDir, gulinbase.GulinDBDir)
	if _, err := os.Stat(dbDir); os.IsNotExist(err) {
		err := os.MkdirAll(dbDir, 0755)
		if err != nil {
			return nil, fmt.Errorf("failed to create db directory: %v", err)
		}
	}
	dbPath := filepath.Join(dbDir, "gulin.db")
	return sql.Open("sqlite3", dbPath)
}

func GulinAIApiListHandler(w http.ResponseWriter, r *http.Request) {
	fmt.Printf("[API-MANAGER] GulinAIApiListHandler called\n")

	db, err := getGulintermDB()
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to open db: %v", err), http.StatusInternalServerError)
		return
	}
	defer db.Close()

	EnsureAPIEndpointsSchema(db)

	rows, err := db.Query(fmt.Sprintf("SELECT id, name, url, COALESCE(username, ''), COALESCE(password, ''), COALESCE(token, ''), COALESCE(system_prompt, ''), COALESCE(knowledge_source, ''), COALESCE(auth_instructions, ''), created_at, updated_at FROM %s ORDER BY created_at DESC", GulinAPIEndpointsTable))
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to query endpoints: %v", err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
 
	var endpoints []uctypes.APIEndpointInfo
	for rows.Next() {
		var e uctypes.APIEndpointInfo
		err := rows.Scan(&e.ID, &e.Name, &e.URL, &e.Username, &e.Password, &e.Token, &e.SystemPrompt, &e.KnowledgeSource, &e.AuthInstructions, &e.CreatedAt, &e.UpdatedAt)
		if err == nil {
			endpoints = append(endpoints, e)
		}
	}
 
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(endpoints)
}
 
func GulinAIApiRegisterHandler(w http.ResponseWriter, r *http.Request) {
	fmt.Printf("[API-MANAGER] GulinAIApiRegisterHandler called: %s\n", r.Method)
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
 
	var req uctypes.APIEndpointInfo
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fmt.Printf("[API-MANAGER] error decoding body: %v\n", err)
		http.Error(w, fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
		return
	}
	fmt.Printf("[API-MANAGER] registering endpoint: %s (%s)\n", req.Name, req.URL)
 
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || req.URL == "" {
		http.Error(w, "name and url are required", http.StatusBadRequest)
		return
	}
 
	db, err := getGulintermDB()
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to open db: %v", err), http.StatusInternalServerError)
		return
	}
	defer db.Close()

	EnsureAPIEndpointsSchema(db)

	now := time.Now().UnixMilli()
	if req.ID == "" {
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
			updated_at=excluded.updated_at
	`, GulinAPIEndpointsTable)

	_, err = db.Exec(query, req.ID, req.Name, req.URL, req.Username, req.Password, req.Token, req.SystemPrompt, req.KnowledgeSource, req.AuthInstructions, req.CreatedAt, req.UpdatedAt)
	if err != nil {
		fmt.Printf("[API-MANAGER] error executing insert: %v\n", err)
		http.Error(w, fmt.Sprintf("failed to save endpoint: %v", err), http.StatusInternalServerError)
		return
	}

	fmt.Printf("[API-MANAGER] successfully saved endpoint: %s\n", req.ID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(req)
}


func GulinAIApiDeleteHandler(w http.ResponseWriter, r *http.Request) {
	fmt.Printf("[API-MANAGER] GulinAIApiDeleteHandler called: %s\n", r.Method)
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fmt.Printf("[API-MANAGER] error decoding delete body: %v\n", err)
		http.Error(w, fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	if req.ID == "" {
		http.Error(w, "id is required", http.StatusBadRequest)
		return
	}

	db, err := getGulintermDB()
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to open db: %v", err), http.StatusInternalServerError)
		return
	}
	defer db.Close()

	_, err = db.Exec(fmt.Sprintf("DELETE FROM %s WHERE id = ?", GulinAPIEndpointsTable), req.ID)
	if err != nil {
		fmt.Printf("[API-MANAGER] error executing delete: %v\n", err)
		http.Error(w, fmt.Sprintf("failed to delete endpoint: %v", err), http.StatusInternalServerError)
		return
	}

	fmt.Printf("[API-MANAGER] successfully deleted endpoint: %s\n", req.ID)
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func EnsureAPIEndpointsSchema(db *sql.DB) {
	// Crear tabla si no existe
	query := fmt.Sprintf(`
		CREATE TABLE IF NOT EXISTS %s (
			id TEXT PRIMARY KEY,
			name TEXT UNIQUE,
			url TEXT,
			username TEXT,
			password TEXT,
			token TEXT,
			system_prompt TEXT,
			knowledge_source TEXT,
			auth_instructions TEXT,
			created_at INTEGER,
			updated_at INTEGER
		)`, GulinAPIEndpointsTable)
	db.Exec(query)

	// Asegurar esquema técnico básico (Añadir columnas si no existen - para migraciones)
	db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN system_prompt TEXT", GulinAPIEndpointsTable))
	db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN knowledge_source TEXT", GulinAPIEndpointsTable))
	db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN auth_instructions TEXT", GulinAPIEndpointsTable))
}
