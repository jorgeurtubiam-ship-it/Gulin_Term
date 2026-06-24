// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gulinapp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

// XPClient is a simple client to post XP events to the brain server.
type XPClient struct {
	BaseURL string
	Client  *http.Client
}

var DefaultXPClient *XPClient

// InitXPClient sets up the default XP client pointing to the local brain server.
func InitXPClient(baseURL string) {
	DefaultXPClient = &XPClient{
		BaseURL: baseURL,
		Client:  &http.Client{Timeout: 5 * time.Second},
	}
	log.Printf("[brain-xp] client initialized, posting to %s/brain/xp", baseURL)
}

// AddXP posts an XP event synchronously or asyncrhonously.
func (c *XPClient) AddXP(action string, xpGained int, source string) {
	if c == nil {
		return
	}
	body := XPPostBody{
		Action:   action,
		XPGained: xpGained,
		Source:   source,
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return
	}

	go func() {
		resp, err := c.Client.Post(c.BaseURL+"/brain/xp", "application/json", bytes.NewReader(payload))
		if err != nil {
			log.Printf("[brain-xp] failed to post xp: %v", err)
			return
		}
		resp.Body.Close()
	}()
}

// AddXPSync posts XP and returns the server response (for testing or immediate feedback).
func (c *XPClient) AddXPSync(action string, xpGained int, source string) (*XPPostResponse, error) {
	if c == nil {
		return nil, fmt.Errorf("xp client not initialized")
	}
	body := XPPostBody{
		Action:   action,
		XPGained: xpGained,
		Source:   source,
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	resp, err := c.Client.Post(c.BaseURL+"/brain/xp", "application/json", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var result XPPostResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}

// Convenience wrappers

func AddXPAction(action string) {
	if DefaultXPClient != nil {
		DefaultXPClient.AddXP(action, 0, "system")
	}
}

func AddXPForBlockCreate() {
	if DefaultXPClient != nil {
		DefaultXPClient.AddXP("create_block", 0, "system")
	}
}

func AddXPForDBQuery() {
	if DefaultXPClient != nil {
		DefaultXPClient.AddXP("db_query", 0, "system")
	}
}

func AddXPForRunCommand() {
	if DefaultXPClient != nil {
		DefaultXPClient.AddXP("run_command", 0, "system")
	}
}

func AddXPForPluginUse() {
	if DefaultXPClient != nil {
		DefaultXPClient.AddXP("use_plugin", 0, "system")
	}
}

func AddXPForAIChat() {
	if DefaultXPClient != nil {
		DefaultXPClient.AddXP("ai_chat", 0, "system")
	}
}

func AddXPForRegisterInfra() {
	if DefaultXPClient != nil {
		DefaultXPClient.AddXP("register_infra", 0, "system")
	}
}
