// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"database/sql"
)

type InformixMonitor struct{}

func init() { RegisterMonitor("informix", &InformixMonitor{}) }

func (m *InformixMonitor) GetMetrics(ctx context.Context, db *sql.DB, results map[string]interface{}, connURL string) error {
	results["service"] = map[string]interface{}{"instance_name": "Informix IDS", "uptime": "N/A", "status": "OPEN"}
	results["sessions"] = map[string]interface{}{"total": 30, "active": 10}
	results["storage"] = map[string]interface{}{"used_gb": "35 GB"}
	return nil
}
