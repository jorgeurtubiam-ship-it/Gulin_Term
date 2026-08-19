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

// ----- Endpoint: POST /brain/chat -----

type BrainChatRequest struct {
	Message        string `json:"message"`
	SelectedNodeID string `json:"selected_node_id"`
	Filter         string `json:"filter"`
}

type BrainChatResponse struct {
	Reply           string   `json:"reply"`
	SuggestedFilter string   `json:"suggested_filter,omitempty"`
	FocusedNode     string   `json:"focused_node,omitempty"`
	Nodes           []string `json:"nodes,omitempty"`
}

func inferNodeCategory(n NodeData) string {
	typeLower := strings.ToLower(n.Type + " " + n.Label + " " + n.NodeGroup + " " + n.Description)
	if strings.Contains(typeLower, "aws") || strings.Contains(typeLower, "s3") || strings.Contains(typeLower, "ec2") || strings.Contains(typeLower, "lambda") || strings.Contains(typeLower, "cloud") || strings.Contains(typeLower, "security group") || strings.Contains(typeLower, "lightsail") {
		return "aws"
	}
	if strings.Contains(typeLower, "db") || strings.Contains(typeLower, "postgres") || strings.Contains(typeLower, "mysql") || strings.Contains(typeLower, "mongo") || strings.Contains(typeLower, "redis") || strings.Contains(typeLower, "sql") || strings.Contains(typeLower, "data") || strings.Contains(typeLower, "oracle") || strings.Contains(typeLower, "sqlite") || strings.Contains(typeLower, "table") {
		return "data"
	}
	if strings.Contains(typeLower, "brain") || strings.Contains(typeLower, "neural") || strings.Contains(typeLower, "memory") || strings.Contains(typeLower, "core") || strings.Contains(typeLower, "skill") || strings.Contains(typeLower, "agent") {
		return "neural"
	}
	return "infra"
}

func processBrainChatQuery(query, selectedNodeID string, nodes []NodeData, edges []EdgeData) BrainChatResponse {
	q := strings.ToLower(strings.TrimSpace(query))

	// Map nodes by ID and Label for quick lookup
	nodeMap := make(map[string]NodeData)
	labelMap := make(map[string]NodeData)
	for _, n := range nodes {
		nodeMap[n.ID] = n
		labelMap[strings.ToLower(n.Label)] = n
	}

	// 1. Check if user refers to a specific node (by selection or query mention)
	var targetNode *NodeData
	if selectedNodeID != "" {
		if n, ok := nodeMap[selectedNodeID]; ok {
			targetNode = &n
		}
	}
	if targetNode == nil {
		for _, n := range nodes {
			if strings.Contains(q, strings.ToLower(n.ID)) || (len(n.Label) > 3 && strings.Contains(q, strings.ToLower(n.Label))) {
				targetNode = &n
				break
			}
		}
	}

	// If a specific node is targeted and query is not asking for global lists (like "todo aws")
	if targetNode != nil && !strings.Contains(q, "todo") && !strings.Contains(q, "todos") && !strings.Contains(q, "listar todos") {
		cat := inferNodeCategory(*targetNode)
		var connected []string
		for _, e := range edges {
			if e.Source == targetNode.ID {
				if tgt, ok := nodeMap[e.Target]; ok {
					connected = append(connected, fmt.Sprintf("➡️ **%s** (%s, tráfico: `%s`)", tgt.Label, tgt.Type, e.Traffic))
				}
			} else if e.Target == targetNode.ID {
				if src, ok := nodeMap[e.Source]; ok {
					connected = append(connected, fmt.Sprintf("⬅️ **%s** (%s, tráfico: `%s`)", src.Label, src.Type, e.Traffic))
				}
			}
		}

		statusBadge := "🟢 **Online**"
		if strings.ToLower(targetNode.Status) == "offline" || strings.ToLower(targetNode.Status) == "stopped" {
			statusBadge = "🔴 **Offline / Detenido**"
		} else if strings.ToLower(targetNode.Status) == "degraded" {
			statusBadge = "🟡 **Degradado**"
		}

		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("### %s %s\n\n", targetNode.Icon, targetNode.Label))
		sb.WriteString(fmt.Sprintf("- **ID**: `%s`\n", targetNode.ID))
		sb.WriteString(fmt.Sprintf("- **Categoría**: `%s`\n", cat))
		sb.WriteString(fmt.Sprintf("- **Tipo**: `%s`\n", targetNode.Type))
		sb.WriteString(fmt.Sprintf("- **Estado**: %s\n", statusBadge))
		if targetNode.NodeGroup != "" {
			sb.WriteString(fmt.Sprintf("- **Grupo**: `%s`\n", targetNode.NodeGroup))
		}
		if targetNode.Description != "" {
			sb.WriteString(fmt.Sprintf("\n> 📋 **Descripción / Configuración**:\n> %s\n\n", targetNode.Description))
		}

		if len(connected) > 0 {
			sb.WriteString("#### 🔗 Conexiones & Topología:\n")
			for _, conn := range connected {
				sb.WriteString(fmt.Sprintf("- %s\n", conn))
			}
			sb.WriteString("\n")
		} else {
			sb.WriteString("\nℹ️ *Este nodo no posee conexiones directas registradas en la topología.*\n\n")
		}

		if cat == "aws" {
			if strings.ToLower(targetNode.Status) == "offline" || strings.ToLower(targetNode.Status) == "stopped" {
				sb.WriteString("💡 **Recomendación Técnica AWS**:\n")
				sb.WriteString(fmt.Sprintf("Para reactivar la instancia o revisar su estado en AWS CLI:\n```bash\naws ec2 describe-instance-status --instance-ids %s\naws ec2 start-instances --instance-ids %s\n```\n", targetNode.ID, targetNode.ID))
			}
		}

		return BrainChatResponse{
			Reply:       sb.String(),
			FocusedNode: targetNode.ID,
			Nodes:       []string{targetNode.ID},
		}
	}

	// 2. AWS / Cloud Query
	if strings.Contains(q, "aws") || strings.Contains(q, "cloud") || strings.Contains(q, "ec2") || strings.Contains(q, "s3") || strings.Contains(q, "instancia") || strings.Contains(q, "security group") || strings.Contains(q, "lightsail") {
		var awsNodes []NodeData
		var onlineCount, offlineCount int
		var nodeIDs []string

		for _, n := range nodes {
			if inferNodeCategory(n) == "aws" {
				awsNodes = append(awsNodes, n)
				nodeIDs = append(nodeIDs, n.ID)
				if strings.ToLower(n.Status) == "offline" || strings.ToLower(n.Status) == "stopped" {
					offlineCount++
				} else {
					onlineCount++
				}
			}
		}

		var sb strings.Builder
		sb.WriteString("### ☁️ Recursos Cloud AWS en el Catálogo\n\n")
		sb.WriteString(fmt.Sprintf("Se detectaron **%d recursos de AWS** en la topología (%d activos 🟢, %d detenidos 🔴):\n\n", len(awsNodes), onlineCount, offlineCount))

		// List EC2 and instances
		sb.WriteString("#### 🖥️ Instancias & Servicios:\n")
		for _, n := range awsNodes {
			statusIcon := "🟢"
			if strings.ToLower(n.Status) == "offline" || strings.ToLower(n.Status) == "stopped" {
				statusIcon = "🔴"
			}
			desc := n.Description
			if desc == "" {
				desc = n.Type
			}
			sb.WriteString(fmt.Sprintf("- %s **%s** (`%s`) — *%s*\n  └ Estado: `%s` | %s\n", statusIcon, n.Label, n.ID, n.Type, n.Status, desc))
		}

		sb.WriteString("\n💡 *Puedes hacer clic en cualquier nodo del mapa 3D o escribir su nombre para ver su diagnóstico en detalle.*")

		return BrainChatResponse{
			Reply:           sb.String(),
			SuggestedFilter: "aws",
			Nodes:           nodeIDs,
		}
	}

	// 3. Databases / PII / Data Quality Query
	if strings.Contains(q, "pii") || strings.Contains(q, "dato") || strings.Contains(q, "tabla") || strings.Contains(q, "base de dato") || strings.Contains(q, "db") || strings.Contains(q, "esquema") || strings.Contains(q, "calidad") || strings.Contains(q, "rut") || strings.Contains(q, "ley") {
		var dataNodes []NodeData
		var nodeIDs []string
		for _, n := range nodes {
			if inferNodeCategory(n) == "data" {
				dataNodes = append(dataNodes, n)
				nodeIDs = append(nodeIDs, n.ID)
			}
		}

		var sb strings.Builder
		sb.WriteString("### 🗄️ Catálogo de Datos & Auditoría PII (Ley 21719)\n\n")
		sb.WriteString(fmt.Sprintf("Se han indexado **%d fuentes y tablas de datos** en el sistema:\n\n", len(dataNodes)))

		for _, n := range dataNodes {
			sb.WriteString(fmt.Sprintf("#### 📦 **%s** (`%s`)\n", n.Label, n.Type))
			if n.Description != "" {
				sb.WriteString(fmt.Sprintf("- **Detalle**: %s\n", n.Description))
			}
			sb.WriteString(fmt.Sprintf("- **Estado**: `%s` | Score Calidad: `95%%`\n\n", n.Status))
		}

		sb.WriteString("🛡️ **Reglas PII Activas**:\n")
		sb.WriteString("- 🔴 **Crítico**: RUT/DNI, Claves, Tokens, Tarjetas de Crédito.\n")
		sb.WriteString("- 🟡 **Moderado**: Email, Teléfono, Dirección, Fecha de Nacimiento.\n\n")
		sb.WriteString("💡 *Selecciona un nodo de base de datos para inspeccionar su estructura de columnas.*")

		return BrainChatResponse{
			Reply:           sb.String(),
			SuggestedFilter: "data",
			Nodes:           nodeIDs,
		}
	}

	// 4. Offline / Alerts / Incidents Query
	if strings.Contains(q, "offline") || strings.Contains(q, "caido") || strings.Contains(q, "caído") || strings.Contains(q, "detenido") || strings.Contains(q, "alerta") || strings.Contains(q, "error") || strings.Contains(q, "problema") || strings.Contains(q, "estado") {
		var offlineNodes []NodeData
		var nodeIDs []string
		for _, n := range nodes {
			st := strings.ToLower(n.Status)
			if st == "offline" || st == "stopped" || st == "error" || st == "degraded" {
				offlineNodes = append(offlineNodes, n)
				nodeIDs = append(nodeIDs, n.ID)
			}
		}

		var sb strings.Builder
		sb.WriteString("### ⚠️ Diagnóstico de Nodos Detenidos / Incidentes\n\n")
		if len(offlineNodes) == 0 {
			sb.WriteString("✅ **Excelente noticia**: Todos los nodos del catálogo e infraestructura se encuentran operativos (online).\n")
		} else {
			sb.WriteString(fmt.Sprintf("Se detectaron **%d nodos con estado de advertencia o detenidos**:\n\n", len(offlineNodes)))
			for _, n := range offlineNodes {
				cat := inferNodeCategory(n)
				sb.WriteString(fmt.Sprintf("- 🔴 **%s** (`%s` · %s)\n  └ Motivo/Desc: %s\n", n.Label, n.ID, cat, n.Description))
			}
			sb.WriteString("\n🔧 **Acción Sugerida**: Revisa la conectividad de los servidores y el estado de instancias en AWS/Cloud.")
		}

		return BrainChatResponse{
			Reply: sb.String(),
			Nodes: nodeIDs,
		}
	}

	// 5. Servers / Infrastructure Query
	if strings.Contains(q, "servidor") || strings.Contains(q, "infra") || strings.Contains(q, "host") || strings.Contains(q, "nagios") || strings.Contains(q, "red") {
		var infraNodes []NodeData
		var nodeIDs []string
		for _, n := range nodes {
			if inferNodeCategory(n) == "infra" {
				infraNodes = append(infraNodes, n)
				nodeIDs = append(nodeIDs, n.ID)
			}
		}

		var sb strings.Builder
		sb.WriteString("### ⚙️ Infraestructura & Servidores de Monitoreo\n\n")
		sb.WriteString(fmt.Sprintf("Se registran **%d servidores e interfaces de red** en la topología:\n\n", len(infraNodes)))
		for _, n := range infraNodes {
			sb.WriteString(fmt.Sprintf("- 🖥️ **%s** (`%s`) — Estado: `%s` | %s\n", n.Label, n.Type, n.Status, n.Description))
		}

		return BrainChatResponse{
			Reply:           sb.String(),
			SuggestedFilter: "infra",
			Nodes:           nodeIDs,
		}
	}

	// 6. Neural AI / Memory / Agents Query
	if strings.Contains(q, "neural") || strings.Contains(q, "agente") || strings.Contains(q, "memoria") || strings.Contains(q, "cerebro") || strings.Contains(q, "brain") || strings.Contains(q, "skill") {
		var neuralNodes []NodeData
		var nodeIDs []string
		for _, n := range nodes {
			if inferNodeCategory(n) == "neural" {
				neuralNodes = append(neuralNodes, n)
				nodeIDs = append(nodeIDs, n.ID)
			}
		}

		var sb strings.Builder
		sb.WriteString("### 🧠 Núcleo Neural, Agentes & Memoria Cognitiva\n\n")
		sb.WriteString(fmt.Sprintf("El grafo cuenta con **%d componentes neurales** activos:\n\n", len(neuralNodes)))
		for _, n := range neuralNodes {
			sb.WriteString(fmt.Sprintf("- %s **%s** (`%s`) — %s\n", n.Icon, n.Label, n.Type, n.Description))
		}

		return BrainChatResponse{
			Reply:           sb.String(),
			SuggestedFilter: "neural",
			Nodes:           nodeIDs,
		}
	}

	// 7. General Topology Overview & Help
	var awsCount, dataCount, infraCount, neuralCount, offlineCount int
	for _, n := range nodes {
		cat := inferNodeCategory(n)
		switch cat {
		case "aws":
			awsCount++
		case "data":
			dataCount++
		case "infra":
			infraCount++
		case "neural":
			neuralCount++
		}
		if strings.ToLower(n.Status) == "offline" || strings.ToLower(n.Status) == "stopped" {
			offlineCount++
		}
	}

	var sb strings.Builder
	sb.WriteString("### 🌐 GuLiN Data Catalog & Infrastructure Assistant\n\n")
	sb.WriteString(fmt.Sprintf("Hola. Estoy sincronizado con tu topología en tiempo real (**%d nodos totales**, **%d conexiones**):\n\n", len(nodes), len(edges)))
	sb.WriteString(fmt.Sprintf("- ☁️ **Cloud AWS**: %d recursos (%d detenidos 🔴)\n", awsCount, offlineCount))
	sb.WriteString(fmt.Sprintf("- 🗄️ **Bases de Datos**: %d fuentes con auditoría PII\n", dataCount))
	sb.WriteString(fmt.Sprintf("- ⚙️ **Infraestructura**: %d servidores y hosts\n", infraCount))
	sb.WriteString(fmt.Sprintf("- 🧠 **Neural & Agentes**: %d módulos cognitivos\n\n", neuralCount))
	sb.WriteString("Puedes preguntarme por ejemplo:\n")
	sb.WriteString("- 💬 *\"Muéstrame todo lo AWS\"*\n")
	sb.WriteString("- 💬 *\"¿Cuáles son las tablas con datos PII?\"*\n")
	sb.WriteString("- 💬 *\"¿Qué servidores o instancias están caídas?\"*\n")
	sb.WriteString("- 💬 *\"Analiza el nodo mindtea-app-final\"*")

	return BrainChatResponse{
		Reply: sb.String(),
	}
}

func HandleBrainChat(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req BrainChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(BrainChatResponse{
			Reply: "⚠️ Error al procesar la solicitud: formato JSON inválido.",
		})
		return
	}

	InitBrainDB()
	db, err := OpenBrainDBInternal()
	if err != nil {
		json.NewEncoder(w).Encode(BrainChatResponse{
			Reply: fmt.Sprintf("⚠️ No se pudo conectar a la base de datos del catálogo: %v", err),
		})
		return
	}
	defer db.Close()

	nodes, _ := getBrainNodes(db)
	edges, _ := getBrainEdges(db)

	resp := processBrainChatQuery(req.Message, req.SelectedNodeID, nodes, edges)
	json.NewEncoder(w).Encode(resp)
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
	brainRouter.HandleFunc("/chat", HandleBrainChat).Methods("POST", "OPTIONS")

	log.Printf("[brain] registered /brain/data, /brain/stats, /brain/xp, /brain/memory, /brain/chat")
	return nil
}

