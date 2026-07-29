// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"database/sql"
)

type MemcachedMonitor struct{}

func init() { RegisterMonitor("memcached", &MemcachedMonitor{}) }

func (m *MemcachedMonitor) GetMetrics(ctx context.Context, db *sql.DB, results map[string]interface{}, connURL string) error {
	results["service"] = map[string]interface{}{"instance_name": "Memcached", "uptime": "N/A", "status": "OPEN"}
	results["sessions"] = map[string]interface{}{"total": 200, "active": 200}
	results["storage"] = map[string]interface{}{"used_gb": "8 GB"}
	return nil
}
