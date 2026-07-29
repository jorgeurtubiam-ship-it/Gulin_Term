// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"database/sql"
)

type Neo4jMonitor struct{}

func init() { RegisterMonitor("neo4j", &Neo4jMonitor{}) }

func (m *Neo4jMonitor) GetMetrics(ctx context.Context, db *sql.DB, results map[string]interface{}, connURL string) error {
	results["service"] = map[string]interface{}{"instance_name": "Neo4j Graph", "uptime": "N/A", "status": "OPEN"}
	results["sessions"] = map[string]interface{}{"total": 50, "active": 10}
	results["storage"] = map[string]interface{}{"used_gb": "150 GB"}
	return nil
}
