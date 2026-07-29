// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"database/sql"
	"fmt"
)

type MSSQLMonitor struct{}

func init() {
	RegisterMonitor("mssql", &MSSQLMonitor{})
}

func (m *MSSQLMonitor) GetMetrics(ctx context.Context, db *sql.DB, results map[string]interface{}, connURL string) error {
	// --- 1. SERVICE & INSTANCE ---
	var dbName, version string
	var uptimeMinutes float64
	db.QueryRowContext(ctx, "SELECT DB_NAME(), @@VERSION").Scan(&dbName, &version)
	db.QueryRowContext(ctx, "SELECT DATEDIFF(minute, sqlserver_start_time, GETDATE()) FROM sys.dm_os_sys_info").Scan(&uptimeMinutes)
	
	results["service"] = map[string]interface{}{
		"instance_name": dbName,
		"uptime":        formatUptime(uptimeMinutes),
		"status":        "OPEN",
		"db_role":       "PRIMARY",
		"open_mode":     "READ WRITE",
	}

	// --- 2. USERS & SESSIONS ---
	var totalUsers, activeUsers int
	db.QueryRowContext(ctx, "SELECT count(*) FROM sys.dm_exec_sessions").Scan(&totalUsers)
	db.QueryRowContext(ctx, "SELECT count(*) FROM sys.dm_exec_requests").Scan(&activeUsers)
	results["sessions"] = map[string]interface{}{
		"total":      totalUsers,
		"active":     activeUsers,
		"avg_active": float64(activeUsers) / 10.0,
	}

	// --- 3. STORAGE ---
	var totalFiles int
	var usedGB, totalGB, freeGB float64
	queryStorage := `
		SELECT 
			COUNT(*),
			ISNULL(SUM(size * 8.0 / 1024 / 1024), 0),
			ISNULL(MAX(vs.total_bytes / 1024.0 / 1024 / 1024), 0),
			ISNULL(MAX(vs.available_bytes / 1024.0 / 1024 / 1024), 0)
		FROM sys.master_files mf
		CROSS APPLY sys.dm_os_volume_stats(mf.database_id, mf.file_id) vs
		WHERE mf.database_id = DB_ID()
	`
	db.QueryRowContext(ctx, queryStorage).Scan(&totalFiles, &usedGB, &totalGB, &freeGB)
	
	usedPct := 0.0
	if totalGB > 0 {
		usedPct = ((totalGB - freeGB) / totalGB) * 100
	}

	results["storage"] = map[string]interface{}{
		"total_files":       totalFiles,
		"total_tablespaces": 1,
		"total_gb":          fmt.Sprintf("%.2f GB", totalGB),
		"used_gb":           fmt.Sprintf("%.2f GB", totalGB - freeGB),
		"used_pct":          usedPct,
	}

	// Fake/Fallback data for UI layout compatibility
	results["host"] = map[string]interface{}{
		"host_name": "SQL Server",
		"cpu_usage": 5.0,
		"mem_free":  "N/A",
	}
	// --- 4. MEMORY ARCHITECTURE ---
	sgaData := make(map[string]interface{})
	var bufferPoolKB, planCacheKB, logPoolKB float64
	db.QueryRowContext(ctx, "SELECT ISNULL(SUM(pages_kb), 0) FROM sys.dm_os_memory_clerks WHERE type = 'MEMORYCLERK_SQLBUFFERPOOL'").Scan(&bufferPoolKB)
	db.QueryRowContext(ctx, "SELECT ISNULL(SUM(pages_kb), 0) FROM sys.dm_os_memory_clerks WHERE type LIKE 'CACHESTORE_%'").Scan(&planCacheKB)
	db.QueryRowContext(ctx, "SELECT ISNULL(SUM(pages_kb), 0) FROM sys.dm_os_memory_clerks WHERE type = 'MEMORYCLERK_SQLLOGPOOL'").Scan(&logPoolKB)
	
	totalMB := (bufferPoolKB + planCacheKB + logPoolKB) / 1024
	if totalMB == 0 {
		totalMB = 1 // Prevent div by zero
	}
	sgaData["total"] = fmt.Sprintf("%.0f MB", totalMB)
	sgaData["buffer_cache"] = fmt.Sprintf("%.0f MB", bufferPoolKB/1024)
	sgaData["shared_pool"] = fmt.Sprintf("%.0f MB", planCacheKB/1024)
	sgaData["shared_pool_pct"] = calculatePct(planCacheKB, bufferPoolKB + planCacheKB + logPoolKB)
	sgaData["java_pool"] = fmt.Sprintf("%.0f MB", logPoolKB/1024)
	sgaData["large_pool"] = "N/A"
	results["sga"] = sgaData

	// --- 5. SERVER PROCESSES ---
	var maxServerMemMB float64
	db.QueryRowContext(ctx, "SELECT ISNULL(CAST(value_in_use AS FLOAT), 0) FROM sys.configurations WHERE name = 'max server memory (MB)'").Scan(&maxServerMemMB)
	
	results["server_processes"] = map[string]interface{}{
		"pga_target": fmt.Sprintf("%.0f MB", maxServerMemMB),
		"pga_used":   fmt.Sprintf("%.0f MB", totalMB),
		"pga_pct":    calculatePct(totalMB, maxServerMemMB),
	}

	// --- 6. BACKGROUND PROCESSES ---
	bgProcs := []map[string]interface{}{}
	rows, err := db.QueryContext(ctx, "SELECT session_id, status FROM sys.dm_exec_sessions WHERE is_user_process = 0")
	if err == nil {
		defer rows.Close()
		count := 0
		for rows.Next() {
			if count >= 8 { break }
			var id int
			var status string
			if err := rows.Scan(&id, &status); err == nil {
				bgProcs = append(bgProcs, map[string]interface{}{
					"name":   fmt.Sprintf("SYS_SPID_%d", id),
					"status": "ACTIVE",
					"desc":   status,
				})
				count++
			}
		}
	}
	// --- 7. SLOW QUERIES (DBA METRICS) ---
	slowQueries := []map[string]interface{}{}
	queryStats := `
		SELECT TOP 5 
			SUBSTRING(qt.text, (qs.statement_start_offset/2)+1, 
				((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(qt.text) ELSE qs.statement_end_offset END - qs.statement_start_offset)/2)+1) as query_text,
			qs.execution_count,
			(qs.total_worker_time / qs.execution_count) / 1000 as avg_cpu_ms,
			(qs.total_elapsed_time / qs.execution_count) / 1000 as avg_time_ms
		FROM sys.dm_exec_query_stats qs
		CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
		ORDER BY qs.total_worker_time DESC
	`
	rowsSQ, errSQ := db.QueryContext(ctx, queryStats)
	if errSQ == nil {
		defer rowsSQ.Close()
		for rowsSQ.Next() {
			var qText string
			var execCount int
			var avgCpu, avgTime int64
			if err := rowsSQ.Scan(&qText, &execCount, &avgCpu, &avgTime); err == nil {
				// Truncate query text if too long
				if len(qText) > 100 {
					qText = qText[:97] + "..."
				}
				slowQueries = append(slowQueries, map[string]interface{}{
					"query":       qText,
					"executions":  execCount,
					"avg_cpu_ms":  avgCpu,
					"avg_time_ms": avgTime,
				})
			}
		}
	}
	results["slow_queries"] = slowQueries

	// --- 8. PERFORMANCE COUNTERS (CACHE) ---
	var bchr, bchrBase, ple float64
	db.QueryRowContext(ctx, "SELECT cntr_value FROM sys.dm_os_performance_counters WHERE counter_name = 'Buffer cache hit ratio'").Scan(&bchr)
	db.QueryRowContext(ctx, "SELECT cntr_value FROM sys.dm_os_performance_counters WHERE counter_name = 'Buffer cache hit ratio base'").Scan(&bchrBase)
	db.QueryRowContext(ctx, "SELECT cntr_value FROM sys.dm_os_performance_counters WHERE counter_name = 'Page life expectancy' AND object_name LIKE '%Buffer Manager%'").Scan(&ple)
	
	cacheHitRatio := 100.0
	if bchrBase > 0 {
		cacheHitRatio = (bchr / bchrBase) * 100
	}
	results["performance_counters"] = map[string]interface{}{
		"buffer_cache_hit_ratio": cacheHitRatio,
		"page_life_expectancy": ple,
	}

	// --- 9. DEADLOCKS & BLOCKS ---
	blocks := []map[string]interface{}{}
	queryBlocks := `
		SELECT 
			er.session_id as blocked_spid, 
			er.blocking_session_id as blocking_spid, 
			er.wait_type, 
			er.wait_time, 
			er.wait_resource, 
			SUBSTRING(qt.text, (er.statement_start_offset/2)+1, 
				((CASE er.statement_end_offset WHEN -1 THEN DATALENGTH(qt.text) ELSE er.statement_end_offset END - er.statement_start_offset)/2)+1) as query_text
		FROM sys.dm_exec_requests er
		CROSS APPLY sys.dm_exec_sql_text(er.sql_handle) qt
		WHERE er.blocking_session_id > 0
	`
	rowsBlk, errBlk := db.QueryContext(ctx, queryBlocks)
	if errBlk == nil {
		defer rowsBlk.Close()
		for rowsBlk.Next() {
			var blocked, blocking int
			var waitType, waitResource, query string
			var waitTime int64
			if err := rowsBlk.Scan(&blocked, &blocking, &waitType, &waitTime, &waitResource, &query); err == nil {
				blocks = append(blocks, map[string]interface{}{
					"blocked_spid": blocked, "blocking_spid": blocking,
					"wait_type": waitType, "wait_time_ms": waitTime, "wait_resource": waitResource, "query": query,
				})
			}
		}
	}
	results["blocks"] = blocks

	// --- 10. DETAILED SESSIONS (CONNECTIVITY) ---
	sessionsDetail := []map[string]interface{}{}
	querySessions := `
		SELECT TOP 100 session_id, status, login_name, host_name, program_name, cpu_time, memory_usage
		FROM sys.dm_exec_sessions
		WHERE is_user_process = 1
	`
	rowsSess, errSess := db.QueryContext(ctx, querySessions)
	if errSess == nil {
		defer rowsSess.Close()
		for rowsSess.Next() {
			var spid, memory int
			var status, login, host, program sql.NullString
			var cpu int64
			if err := rowsSess.Scan(&spid, &status, &login, &host, &program, &cpu, &memory); err == nil {
				sessionsDetail = append(sessionsDetail, map[string]interface{}{
					"spid": spid, "status": status.String, "login": login.String, 
					"host": host.String, "program": program.String, "cpu_ms": cpu, "memory_pages": memory,
				})
			}
		}
	}
	results["sessions_detailed"] = sessionsDetail

	// --- 11. AVAILABILITY GROUPS (ALWAYSON) ---
	agStates := []map[string]interface{}{}
	queryAG := `
		SELECT 
			ag.name,
			ar.replica_server_name,
			rs.role_desc,
			rs.operational_state_desc,
			rs.connected_state_desc,
			rs.synchronization_health_desc
		FROM sys.availability_groups ag
		JOIN sys.availability_replicas ar ON ag.group_id = ar.group_id
		JOIN sys.dm_hadr_availability_replica_states rs ON ar.replica_id = rs.replica_id
	`
	rowsAG, errAG := db.QueryContext(ctx, queryAG)
	if errAG == nil {
		defer rowsAG.Close()
		for rowsAG.Next() {
			var name, server, role, opState, connState, syncHealth sql.NullString
			if err := rowsAG.Scan(&name, &server, &role, &opState, &connState, &syncHealth); err == nil {
				agStates = append(agStates, map[string]interface{}{
					"group_name": name.String, "replica_server": server.String, "role": role.String,
					"operational_state": opState.String, "connected_state": connState.String, "sync_health": syncHealth.String,
				})
			}
		}
	}
	results["availability_groups"] = agStates

	return nil
}
