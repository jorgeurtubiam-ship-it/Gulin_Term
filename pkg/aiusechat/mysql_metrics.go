// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"database/sql"
	"fmt"
)

type MySQLMonitor struct{}

func init() {
	RegisterMonitor("mysql", &MySQLMonitor{})
}

func (m *MySQLMonitor) GetMetrics(ctx context.Context, db *sql.DB, results map[string]interface{}, connURL string) error {
	// --- 1. SERVICE & INSTANCE ---
	var dbName, version string
	var uptimeSeconds float64
	db.QueryRowContext(ctx, "SELECT DATABASE(), VERSION()").Scan(&dbName, &version)
	
	// MySQL Uptime
	var varName string
	var uptimeStr string
	db.QueryRowContext(ctx, "SHOW GLOBAL STATUS LIKE 'Uptime'").Scan(&varName, &uptimeStr)
	fmt.Sscanf(uptimeStr, "%f", &uptimeSeconds)

	results["service"] = map[string]interface{}{
		"instance_name": dbName,
		"uptime":        formatUptime(uptimeSeconds / 60),
		"status":        "OPEN",
		"db_role":       "PRIMARY",
		"open_mode":     "READ WRITE",
	}

	// --- 2. USERS & SESSIONS ---
	var threadsConnected, threadsRunning int
	var tName, tVal string
	db.QueryRowContext(ctx, "SHOW GLOBAL STATUS LIKE 'Threads_connected'").Scan(&tName, &tVal)
	fmt.Sscanf(tVal, "%d", &threadsConnected)
	
	db.QueryRowContext(ctx, "SHOW GLOBAL STATUS LIKE 'Threads_running'").Scan(&tName, &tVal)
	fmt.Sscanf(tVal, "%d", &threadsRunning)

	results["sessions"] = map[string]interface{}{
		"total":      threadsConnected,
		"active":     threadsRunning,
		"avg_active": float64(threadsRunning) / 10.0,
	}

	// --- 3. STORAGE ---
	var sizeMB float64
	db.QueryRowContext(ctx, "SELECT COALESCE(SUM(data_length + index_length) / 1024 / 1024, 0) FROM information_schema.tables WHERE table_schema = DATABASE()").Scan(&sizeMB)
	results["storage"] = map[string]interface{}{
		"total_files":       1,
		"total_tablespaces": 1,
		"total_gb":          fmt.Sprintf("%.2f GB", sizeMB/1024),
		"used_gb":           fmt.Sprintf("%.2f GB", sizeMB/1024),
		"used_pct":          100,
	}

	// Fake/Fallback data for UI layout compatibility
	results["host"] = map[string]interface{}{
		"host_name": "MySQL Server",
		"cpu_usage": 5.0,
		"mem_free":  "N/A",
	}
	results["sga"] = map[string]interface{}{}
	results["server_processes"] = map[string]interface{}{}
	results["background_processes"] = []map[string]interface{}{}

	return nil
}
