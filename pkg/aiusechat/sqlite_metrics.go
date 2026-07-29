// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"database/sql"
	"fmt"
)

type SQLiteMonitor struct{}

func init() {
	RegisterMonitor("sqlite", &SQLiteMonitor{})
}

func (m *SQLiteMonitor) GetMetrics(ctx context.Context, db *sql.DB, results map[string]interface{}, filePath string) error {
	// --- 1. SERVICE & INSTANCE ---
	results["service"] = map[string]interface{}{
		"instance_name": "SQLite Local DB",
		"uptime":        "N/A", // Local file has no uptime
		"status":        "OPEN",
		"db_role":       "STANDALONE",
		"open_mode":     "READ WRITE",
	}

	// --- 2. USERS & SESSIONS ---
	results["sessions"] = map[string]interface{}{
		"total":      1,
		"active":     1,
		"avg_active": 1.0,
	}

	// --- 3. STORAGE ---
	var sizeBytes int64 = 0
	db.QueryRowContext(ctx, "SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()").Scan(&sizeBytes)
	sizeMB := float64(sizeBytes) / 1024 / 1024

	var tableCount int
	err := db.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").Scan(&tableCount)
	if err != nil {
		fmt.Printf("[SQLite APM] Error counting tables: %v\n", err)
	}

	results["storage"] = map[string]interface{}{
		"total_files":       1,
		"total_tablespaces": tableCount,
		"total_gb":          fmt.Sprintf("%.4f", sizeMB/1024),
		"used_gb":           fmt.Sprintf("%.4f", sizeMB/1024),
		"used_pct":          100,
	}

	// Fake/Fallback data for UI layout compatibility
	results["host"] = map[string]interface{}{
		"host_name": "Local Machine",
		"cpu_usage": 0.0,
		"mem_free":  "N/A",
	}
	results["sga"] = map[string]interface{}{}
	results["server_processes"] = map[string]interface{}{}
	results["background_processes"] = []map[string]interface{}{}

	return nil
}
