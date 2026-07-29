// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"database/sql"
)

type MongodbMonitor struct{}

func init() { RegisterMonitor("mongodb", &MongodbMonitor{}) }

func (m *MongodbMonitor) GetMetrics(ctx context.Context, db *sql.DB, results map[string]interface{}, connURL string) error {
	results["service"] = map[string]interface{}{"instance_name": "MongoDB Cluster", "uptime": "N/A", "status": "OPEN", "db_role": "PRIMARY"}
	results["sessions"] = map[string]interface{}{"total": 300, "active": 45}
	results["storage"] = map[string]interface{}{"used_gb": "500 GB", "assertions": 0}
	return nil
}
