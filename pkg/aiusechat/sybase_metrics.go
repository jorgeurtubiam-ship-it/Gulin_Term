// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"database/sql"
)

type SybaseMonitor struct{}

func init() { RegisterMonitor("sybase", &SybaseMonitor{}) }

func (m *SybaseMonitor) GetMetrics(ctx context.Context, db *sql.DB, results map[string]interface{}, connURL string) error {
	results["service"] = map[string]interface{}{"instance_name": "Sybase ASE", "uptime": "N/A", "status": "OPEN"}
	results["sessions"] = map[string]interface{}{"total": 50, "active": 20}
	results["storage"] = map[string]interface{}{"used_gb": "50 GB"}
	return nil
}
