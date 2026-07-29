// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"database/sql"
	"fmt"
)

type PostgresMonitor struct{}

func init() {
	RegisterMonitor("postgres", &PostgresMonitor{})
}

func (m *PostgresMonitor) GetMetrics(ctx context.Context, db *sql.DB, results map[string]interface{}, connURL string) error {
	// --- 1. SERVICE & INSTANCE ---
	var dbName, version string
	var uptimeSeconds float64
	db.QueryRowContext(ctx, "SELECT current_database(), version()").Scan(&dbName, &version)
	db.QueryRowContext(ctx, "SELECT EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))").Scan(&uptimeSeconds)
	
	results["service"] = map[string]interface{}{
		"instance_name": dbName,
		"uptime":        formatUptime(uptimeSeconds / 60),
		"status":        "OPEN",
		"db_role":       "PRIMARY", // Simplificado
		"open_mode":     "READ WRITE",
	}

	// --- 2. USERS & SESSIONS ---
	var totalUsers, activeUsers int
	db.QueryRowContext(ctx, "SELECT count(*) FROM pg_stat_activity").Scan(&totalUsers)
	db.QueryRowContext(ctx, "SELECT count(*) FROM pg_stat_activity WHERE state = 'active'").Scan(&activeUsers)
	results["sessions"] = map[string]interface{}{
		"total":      totalUsers,
		"active":     activeUsers,
		"avg_active": float64(activeUsers) / 10.0,
	}

	// --- 3. STORAGE ---
	var sizeBytes float64
	db.QueryRowContext(ctx, "SELECT pg_database_size(current_database())").Scan(&sizeBytes)
	results["storage"] = map[string]interface{}{
		"total_files":       1,
		"total_tablespaces": 1,
		"total_gb":          fmt.Sprintf("%.2f GB", sizeBytes/1024/1024/1024),
		"used_gb":           fmt.Sprintf("%.2f GB", sizeBytes/1024/1024/1024),
		"used_pct":          100, // En PG el tamaño reportado es el usado
	}

	// Fake/Fallback data for UI layout compatibility
	results["host"] = map[string]interface{}{
		"host_name": "PostgreSQL Server",
		"cpu_usage": 5.0,
		"mem_free":  "N/A",
	}
	results["sga"] = map[string]interface{}{}
	results["server_processes"] = map[string]interface{}{}
	results["background_processes"] = []map[string]interface{}{}

	return nil
}
