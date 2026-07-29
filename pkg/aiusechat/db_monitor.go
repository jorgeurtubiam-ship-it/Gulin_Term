// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// APMMonitor defines the interface that all database monitors must implement.
type APMMonitor interface {
	GetMetrics(ctx context.Context, db *sql.DB, results map[string]interface{}, connURL string) error
}

var (
	monitorRegistry = make(map[string]APMMonitor)
	monitorMutex    sync.RWMutex
)

// RegisterMonitor registers a new APM monitor for a specific database engine.
func RegisterMonitor(engine string, monitor APMMonitor) {
	monitorMutex.Lock()
	defer monitorMutex.Unlock()
	monitorRegistry[engine] = monitor
}

func GetDBMetricsHandler(w http.ResponseWriter, r *http.Request) {
	connName := r.URL.Query().Get("connection")
	if connName == "" {
		http.Error(w, "Conexion requerida", http.StatusBadRequest)
		return
	}

	conns, err := loadDBConnections()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	connInfo, ok := conns[connName]
	if !ok {
		http.Error(w, "Conexion no encontrada", http.StatusNotFound)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	db, err := openSQLDB(connInfo.Type, connInfo.URL)
	if err != nil {
		http.Error(w, "Error de conexion: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer db.Close()

	results := make(map[string]interface{})
	results["last_update"] = time.Now().Format("15:04:05")

	// Dispatch to the correct metric collector based on registered APM Monitors
	monitorMutex.RLock()
	monitor, exists := monitorRegistry[connInfo.Type]
	monitorMutex.RUnlock()

	if exists {
		err := monitor.GetMetrics(ctx, db, results, connInfo.URL)
		if err != nil {
			fmt.Printf("Error APM monitor for %s: %v\n", connInfo.Type, err)
		}
	} else {
		// Fallback to basic metrics
		results["service"] = map[string]interface{}{
			"instance_name": "Generic SQL",
			"status":        "OPEN",
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}

func formatUptime(minutes float64) string {
	days := int(minutes) / 1440
	hours := (int(minutes) % 1440) / 60
	mins := int(minutes) % 60
	if days > 0 {
		return fmt.Sprintf("%d d %d h", days, hours)
	}
	return fmt.Sprintf("%d h %d m", hours, mins)
}

func calculatePct(val, total float64) int {
	if total == 0 {
		return 0
	}
	return int((val / total) * 100)
}
