// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gulinapp

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/gulindev/gulin/pkg/gulinbase"
	"github.com/gulindev/gulin/pkg/wconfig"
	_ "github.com/mattn/go-sqlite3"
)

// ----- Real-time Streaming -----

type BrainEvent struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

var (
	brainSubscribers = make(map[chan BrainEvent]bool)
	brainSubLock     sync.Mutex
)

func notifyBrainUpdate(eventType string, data interface{}) {
	event := BrainEvent{Type: eventType, Data: data}
	brainSubLock.Lock()
	defer brainSubLock.Unlock()
	for ch := range brainSubscribers {
		select {
		case ch <- event:
		default:
		}
	}
}

// ----- Data structures -----

type NodeData struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Type        string `json:"type"`
	Status      string `json:"status"`
	Icon        string `json:"icon"`
	X           int    `json:"x"`
	Y           int    `json:"y"`
	Description string `json:"description"`
	ParentID    string `json:"parent_id"`
	XpValue     int             `json:"xp_value"`
	NodeGroup   string          `json:"node_group"`
	StatusColor string          `json:"status_color"`
	Metadata    json.RawMessage `json:"metadata"`
}

type EdgeData struct {
	ID      int    `json:"id"`
	Source  string `json:"source"`
	Target  string `json:"target"`
	Traffic string `json:"traffic"`
}

type EpistemicData struct {
	TotalMemoryNodes int            `json:"total_memory_nodes"`
	AvgConfidence    float64        `json:"avg_confidence"`
	MemoryBreakdown  map[string]int `json:"memory_breakdown"`
}

type SkillData struct {
	Name        string `json:"name"`
	Level       int    `json:"level"`
	Description string `json:"description"`
}

type BrainDataResponse struct {
	Nodes     []NodeData    `json:"nodes"`
	Edges     []EdgeData    `json:"edges"`
	Epistemic EpistemicData `json:"epistemic"`
	Skills    []SkillData   `json:"skills"`
	TotalXP   int           `json:"total_xp"`
	Level     int           `json:"level"`
}

type XPStatsResponse struct {
	TotalXP       int           `json:"total_xp"`
	Level         int           `json:"level"`
	XPBreakdown   []XPBreakdown `json:"xp_breakdown"`
	RecentActions []XPAction    `json:"recent_actions"`
}

type XPBreakdown struct {
	Action string `json:"action"`
	Total  int    `json:"total"`
	Count  int    `json:"count"`
}

type XPAction struct {
	ID        int    `json:"id"`
	Action    string `json:"action"`
	XPGained  int    `json:"xp_gained"`
	Source    string `json:"source"`
	CreatedAt string `json:"created_at"`
}

type XPPostBody struct {
	Action   string `json:"action"`
	XPGained int    `json:"xp_gained"`
	Source   string `json:"source"`
}

type XPPostResponse struct {
	Success  bool   `json:"success"`
	TotalXP  int    `json:"total_xp"`
	Level    int    `json:"level"`
	XPGained int    `json:"xp_gained"`
	Message  string `json:"message"`
}

// ----- XP Rules -----

var xpRules = map[string]int{
	"create_block":   10,
	"run_command":    2,
	"db_query":       5,
	"register_infra": 15,
	"use_plugin":     8,
	"ai_chat":        1,
}

func calculateLevel(totalXP int) int {
	if totalXP <= 0 {
		return 1
	}
	return int(math.Floor(math.Sqrt(float64(totalXP) / 100.0)))
}

// ----- openDB safe -----

func OpenBrainDBInternal() (*sql.DB, error) {
	// Intentamos leer la ruta desde la configuración
	settings := wconfig.GetWatcher().GetFullConfig().Settings
	dbPath := settings.AppInfraDBPath

	// Si no está configurada, usamos la ruta unificada por defecto
	if dbPath == "" {
		dbPath = filepath.Join(gulinbase.GetGulinDataDir(), "db", "gulin.db")
	} else {
		// Expandimos ~ si el usuario lo usó en la configuración
		if strings.HasPrefix(dbPath, "~") {
			homeDir, _ := os.UserHomeDir()
			dbPath = filepath.Join(homeDir, dbPath[1:])
		}
	}
	
	log.Printf("[brain] Opening database at: %s\n", dbPath)
	dsn := fmt.Sprintf("file:%s?_busy_timeout=5000&_journal_mode=WAL", dbPath)
	return sql.Open("sqlite3", dsn)
}

func InitBrainDB() error {
	db, err := OpenBrainDBInternal()
	if err != nil {
		return err
	}
	defer db.Close()

	// Tables
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS infra_nodes (
		id TEXT PRIMARY KEY,
		label TEXT,
		type TEXT,
		status TEXT,
		icon TEXT,
		x INTEGER,
		y INTEGER,
		description TEXT,
		parent_id TEXT,
		metadata TEXT,
		xp_value INTEGER,
		node_group TEXT,
		status_color TEXT
	)`)
	if err != nil {
		log.Printf("Error creating infra_nodes table: %v", err)
		return fmt.Errorf("error creating infra_nodes: %v", err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS infra_edges (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		source TEXT,
		target TEXT,
		traffic TEXT
	)`)
	if err != nil {
		log.Printf("Error creating infra_edges table: %v", err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS xp_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			action TEXT,
			xp_gained INTEGER,
			source TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`)
	if err != nil {
		log.Printf("Error creating xp_history table: %v", err)
	}

	// Initial data if empty
	var count int
	db.QueryRow("SELECT COUNT(*) FROM infra_nodes").Scan(&count)
	if count == 0 {
		initialNodes := [][]interface{}{
			{"core", "Gulin Core", "core", "online", "🧠", 0, 0, "Núcleo cognitivo central", "", 0, "system", "#a855f7"},
			{"skills", "Skills Engine", "skill", "idle", "🛠️", 100, 100, "Gestor de capacidades", "core", 50, "system", "#0ea5e9"},
			{"memory", "Long-term Memory", "memory", "online", "📚", -100, 100, "Almacén de conocimiento", "core", 100, "system", "#22c55e"},
			{"plugins", "Plugin Hub", "plugin", "online", "🔌", 0, 200, "Extensiones dinámicas", "skills", 20, "system", "#f59e0b"},
		}
		for _, n := range initialNodes {
			db.Exec("INSERT INTO infra_nodes (id, label, type, status, icon, x, y, description, parent_id, xp_value, node_group, status_color) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", n...)
		}

		initialEdges := [][]interface{}{
			{"core", "skills", "pulse"},
			{"core", "memory", "sync"},
			{"skills", "plugins", "active"},
		}
		for _, e := range initialEdges {
			db.Exec("INSERT INTO infra_edges (source, target, traffic) VALUES (?,?,?)", e...)
		}
	}

	return nil
}

// ----- Endpoint: GET /brain/data -----

func getBrainNodes(db *sql.DB) ([]NodeData, error) {
	query := `
		SELECT 
			id, 
			COALESCE(label, ''), 
			COALESCE(type, 'unknown'), 
			COALESCE(status, 'offline'), 
			COALESCE(icon, ''), 
			COALESCE(x, 0), 
			COALESCE(y, 0), 
			COALESCE(description, ''), 
			COALESCE(parent_id, ''), 
			COALESCE(xp_value, 0), 
			COALESCE(node_group, ''), 
			COALESCE(status_color, '#22c55e'), 
			COALESCE(metadata, '{}') 
		FROM infra_nodes 
		ORDER BY label ASC`
	
	rows, err := db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var nodes []NodeData
	for rows.Next() {
		var n NodeData
		var metaBytes []byte
		err := rows.Scan(
			&n.ID, &n.Label, &n.Type, &n.Status, &n.Icon, 
			&n.X, &n.Y, &n.Description, &n.ParentID, 
			&n.XpValue, &n.NodeGroup, &n.StatusColor, &metaBytes,
		)
		if err != nil {
			log.Printf("[brain] CRITICAL SCAN ERROR for node: %v\n", err)
			continue
		}
		n.Metadata = json.RawMessage(metaBytes)
		log.Printf("[brain] Node loaded: ID=%s, Label=%s\n", n.ID, n.Label)
		nodes = append(nodes, n)
	}
	log.Printf("[brain] Returning %d nodes to frontend\n", len(nodes))
	return nodes, nil
}

func getBrainEdges(db *sql.DB) ([]EdgeData, error) {
	rows, err := db.Query("SELECT id, source, target, COALESCE(traffic,'') FROM infra_edges")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var edges []EdgeData
	for rows.Next() {
		var e EdgeData
		err := rows.Scan(&e.ID, &e.Source, &e.Target, &e.Traffic)
		if err != nil {
			continue
		}
		edges = append(edges, e)
	}
	return edges, nil
}

func getEpistemicData(db *sql.DB) EpistemicData {
	var ep EpistemicData
	ep.MemoryBreakdown = make(map[string]int)

	err := db.QueryRow("SELECT COUNT(*) FROM memory_nodes").Scan(&ep.TotalMemoryNodes)
	if err != nil {
		ep.TotalMemoryNodes = 0
	}

	err = db.QueryRow("SELECT COALESCE(AVG(confidence),0) FROM memory_nodes").Scan(&ep.AvgConfidence)
	if err != nil {
		ep.AvgConfidence = 0
	}

	rows, err := db.Query("SELECT memory_type, COUNT(*) FROM memory_nodes GROUP BY memory_type")
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var mtype string
			var count int
			if rows.Scan(&mtype, &count) == nil {
				ep.MemoryBreakdown[mtype] = count
			}
		}
	}
	return ep
}

func getTotalXP(db *sql.DB) int {
	var total int
	err := db.QueryRow("SELECT COALESCE(SUM(xp_gained),0) FROM xp_log").Scan(&total)
	if err != nil {
		return 0
	}
	return total
}

func HandleBrainData(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Ensure DB is initialized
	InitBrainDB()

	db, err := OpenBrainDBInternal()
	if err != nil {
		json.NewEncoder(w).Encode(BrainDataResponse{Nodes: []NodeData{}, Edges: []EdgeData{}})
		return
	}
	defer db.Close()

	nodes, errNodes := getBrainNodes(db)
	if errNodes != nil {
		log.Printf("[brain] getBrainNodes error: %v\n", errNodes)
	}
	log.Printf("[brain] Total nodes retrieved: %d\n", len(nodes))

	edges, errEdges := getBrainEdges(db)
	if errEdges != nil {
		log.Printf("[brain] getBrainEdges error: %v\n", errEdges)
	}
	epistemic := getEpistemicData(db)
	totalXP := getTotalXP(db)
	level := calculateLevel(totalXP)

	skillsDir := gulinbase.GetConfiguredSkillsDir()
	var skills []SkillData
	
	_ = filepath.Walk(skillsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() && strings.HasSuffix(info.Name(), ".md") {
			name := strings.TrimSuffix(info.Name(), ".md")
			if name == "SKILL" || name == "README" {
				name = filepath.Base(filepath.Dir(path))
			}
			
			description := "Skill: " + name
			if content, err := os.ReadFile(path); err == nil {
				lines := strings.Split(string(content), "\n")
				for _, line := range lines {
					line = strings.TrimSpace(line)
					if strings.HasPrefix(line, "description:") {
						description = strings.TrimSpace(strings.TrimPrefix(line, "description:"))
						break
					}
				}
			}

			skills = append(skills, SkillData{
				Name:        name,
				Level:       level,
				Description: description,
			})
		}
		return nil
	})

	if len(skills) == 0 {
		skills = []SkillData{
			{Name: "No skills found", Level: level, Description: "Check " + skillsDir},
		}
	}

	resp := BrainDataResponse{
		Nodes:     nodes,
		Edges:     edges,
		Epistemic: epistemic,
		Skills:    skills,
		TotalXP:   totalXP,
		Level:     level,
	}

	// Final safety check to ensure arrays are not nil
	if resp.Nodes == nil {
		resp.Nodes = []NodeData{}
	}
	if resp.Edges == nil {
		resp.Edges = []EdgeData{}
	}

	json.NewEncoder(w).Encode(resp)
}

// ----- Endpoint: GET /brain/stats -----

func HandleBrainStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Ensure DB is initialized
	InitBrainDB()

	db, err := OpenBrainDBInternal()
	if err != nil {
		json.NewEncoder(w).Encode(XPStatsResponse{})
		return
	}
	defer db.Close()

	totalXP := getTotalXP(db)
	level := calculateLevel(totalXP)

	rows, err := db.Query("SELECT action, SUM(xp_gained), COUNT(*) FROM xp_log GROUP BY action ORDER BY SUM(xp_gained) DESC")
	var breakdown []XPBreakdown
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var b XPBreakdown
			if rows.Scan(&b.Action, &b.Total, &b.Count) == nil {
				breakdown = append(breakdown, b)
			}
		}
	}

	rows2, err := db.Query("SELECT id, action, xp_gained, source, created_at FROM xp_log ORDER BY id DESC LIMIT 20")
	var recent []XPAction
	if err == nil {
		defer rows2.Close()
		for rows2.Next() {
			var a XPAction
			if rows2.Scan(&a.ID, &a.Action, &a.XPGained, &a.Source, &a.CreatedAt) == nil {
				recent = append(recent, a)
			}
		}
	}

	resp := XPStatsResponse{
		TotalXP:       totalXP,
		Level:         level,
		XPBreakdown:   breakdown,
		RecentActions: recent,
	}

	json.NewEncoder(w).Encode(resp)
}

// ----- Endpoint: POST /brain/xp -----

// InternalRecordXP records XP directly without HTTP call
func InternalRecordXP(action string, source string, xpGained int) (*XPPostResponse, error) {
	if err := InitBrainDB(); err != nil {
		log.Printf("[xp] failed to initialize brain DB: %v", err)
	}

	if xpGained <= 0 {
		xpGained = xpRules[action]
		if xpGained <= 0 {
			xpGained = 1
		}
	}

	db, err := OpenBrainDBInternal()
	if err != nil {
		return nil, err
	}
	defer db.Close()

	_, err = db.Exec("INSERT INTO xp_history (action, xp_gained, source) VALUES (?, ?, ?)", action, xpGained, source)
	if err != nil {
		return nil, err
	}

	var totalXP int
	db.QueryRow("SELECT COALESCE(SUM(xp_gained), 0) FROM xp_history").Scan(&totalXP)
	level := calculateLevel(totalXP)

	res := &XPPostResponse{
		Success:  true,
		TotalXP:  totalXP,
		Level:    level,
		XPGained: xpGained,
		Message:  fmt.Sprintf("Gained %d XP for %s", xpGained, action),
	}

	notifyBrainUpdate("xp_update", res)
	return res, nil
}

func HandlePostXP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	InitBrainDB()

	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(XPPostResponse{Success: false, Message: "method not allowed"})
		return
	}

	var body XPPostBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		json.NewEncoder(w).Encode(XPPostResponse{Success: false, Message: err.Error()})
		return
	}

	res, err := InternalRecordXP(body.Action, body.Source, body.XPGained)
	if err != nil {
		json.NewEncoder(w).Encode(XPPostResponse{Success: false, Message: err.Error()})
		return
	}
	json.NewEncoder(w).Encode(res)
}

// ----- Endpoint: GET /brain/memory -----

func HandleBrainMemory(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Ensure DB is initialized
	InitBrainDB()

	db, err := OpenBrainDBInternal()
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"nodes": []NodeData{}, "edges": []EdgeData{}})
		return
	}
	defer db.Close()

	rows, err := db.Query("SELECT id, label, memory_type, COALESCE(content,''), confidence, xp_value, COALESCE(group_name,''), COALESCE(color,'#6366f1'), created_at, updated_at FROM memory_nodes ORDER BY label")
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error()})
		return
	}
	defer rows.Close()

	type MemNode struct {
		ID         string  `json:"id"`
		Label      string  `json:"label"`
		MemType    string  `json:"memory_type"`
		Content    string  `json:"content"`
		Confidence float64 `json:"confidence"`
		XpValue    int     `json:"xp_value"`
		GroupName  string  `json:"group_name"`
		Color      string  `json:"color"`
		CreatedAt  string  `json:"created_at"`
		UpdatedAt  string  `json:"updated_at"`
	}

	var nodes []MemNode
	for rows.Next() {
		var n MemNode
		if rows.Scan(&n.ID, &n.Label, &n.MemType, &n.Content, &n.Confidence, &n.XpValue, &n.GroupName, &n.Color, &n.CreatedAt, &n.UpdatedAt) == nil {
			nodes = append(nodes, n)
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{"nodes": nodes})
}

// ----- Endpoint: GET /brain/stream (SSE) -----

func HandleBrainStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	eventCh := make(chan BrainEvent, 10)
	brainSubLock.Lock()
	brainSubscribers[eventCh] = true
	brainSubLock.Unlock()

	defer func() {
		brainSubLock.Lock()
		delete(brainSubscribers, eventCh)
		brainSubLock.Unlock()
		close(eventCh)
	}()

	// Send initial connection message
	fmt.Fprintf(w, "data: {\"type\": \"connected\"}\n\n")
	flusher.Flush()

	for {
		select {
		case event := <-eventCh:
			jsonData, _ := json.Marshal(event)
			fmt.Fprintf(w, "data: %s\n\n", jsonData)
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

// ----- Register routes -----

func RegisterBrainRoutes(client *Client) error {
	if client == nil {
		return fmt.Errorf("client is nil")
	}

	// Initialize DB
	if err := InitBrainDB(); err != nil {
		log.Printf("[brain] failed to initialize DB: %v\n", err)
	}

	// Create a subrouter for /brain
	brainRouter := client.UrlHandlerMux.PathPrefix("/brain").Subrouter()

	brainRouter.HandleFunc("/data", HandleBrainData).Methods("GET", "OPTIONS")
	brainRouter.HandleFunc("/stats", HandleBrainStats).Methods("GET", "OPTIONS")
	brainRouter.HandleFunc("/xp", HandlePostXP).Methods("POST", "OPTIONS")
	brainRouter.HandleFunc("/memory", HandleBrainMemory).Methods("GET", "OPTIONS")
	brainRouter.HandleFunc("/stream", HandleBrainStream).Methods("GET", "OPTIONS")

	log.Printf("[brain] registered /brain/data, /brain/stats, /brain/xp, /brain/memory")
	return nil
}
