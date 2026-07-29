// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"database/sql"
)

type CouchbaseMonitor struct{}

func init() { RegisterMonitor("couchbase", &CouchbaseMonitor{}) }

func (m *CouchbaseMonitor) GetMetrics(ctx context.Context, db *sql.DB, results map[string]interface{}, connURL string) error {
	results["service"] = map[string]interface{}{"instance_name": "Couchbase Cluster", "uptime": "N/A", "status": "OPEN"}
	results["sessions"] = map[string]interface{}{"total": 100, "active": 40}
	results["storage"] = map[string]interface{}{"used_gb": "300 GB"}
	return nil
}
