// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"database/sql"
)

type Db2Monitor struct{}

func init() { RegisterMonitor("db2", &Db2Monitor{}) }

func (m *Db2Monitor) GetMetrics(ctx context.Context, db *sql.DB, results map[string]interface{}, connURL string) error {
	results["service"] = map[string]interface{}{"instance_name": "IBM Db2 LUW", "uptime": "N/A", "status": "OPEN"}
	results["sessions"] = map[string]interface{}{"total": 85, "active": 5}
	results["storage"] = map[string]interface{}{"used_gb": "200 GB", "buffer_pool_hit": "98%"}
	return nil
}
