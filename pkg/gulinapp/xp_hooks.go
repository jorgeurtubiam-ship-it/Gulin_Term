// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gulinapp

import (
	"log"
)

// XP defaults for automatic actions (matches xpRules in brain_route.go)
var autoXPRules = map[string]int{
	"create_block":   10,
	"run_command":    2,
	"db_query":       5,
	"register_infra": 15,
	"use_plugin":     8,
	"ai_chat":        1,
}

// RecordXPAuto records XP for an action using internal logic.
func RecordXPAuto(action string, source string) (int, error) {
	res, err := InternalRecordXP(action, source, 0)
	if err != nil {
		log.Printf("[xp] RecordXPAuto error: %v", err)
		return 0, err
	}
	return res.XPGained, nil
}

// RecordXPAutoSync is a fire-and-forget version that logs errors but never blocks.
func RecordXPAutoSync(action string, source string) {
	go func() {
		_, _ = RecordXPAuto(action, source)
	}()
}
