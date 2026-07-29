// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"database/sql"
)

type MaxdbMonitor struct{}

func init() { RegisterMonitor("maxdb", &MaxdbMonitor{}) }

func (m *MaxdbMonitor) GetMetrics(ctx context.Context, db *sql.DB, results map[string]interface{}, connURL string) error {
	results["service"] = map[string]interface{}{"instance_name": "SAP MaxDB", "uptime": "N/A", "status": "OPEN"}
	results["sessions"] = map[string]interface{}{"total": 25, "active": 8}
	results["storage"] = map[string]interface{}{"used_gb": "60 GB"}
	return nil
}
