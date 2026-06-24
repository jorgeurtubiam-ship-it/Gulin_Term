// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/base64"
	"fmt"
	"io"
	"os"

	"github.com/spf13/cobra"
	"github.com/gulindev/gulin/pkg/wshrpc"
	"github.com/gulindev/gulin/pkg/wshrpc/wshclient"
	"github.com/gulindev/gulin/pkg/wshutil"
)

var gulinCmd = &cobra.Command{
	Use:   "gulin [message] [files...]",
	Short: "Talk directly to Gulin Agent from terminal",
	Long: `Direct integration with Gulin Agent. Can take piped input, files, or messages.
Automatically submits the prompt to the Gulin IA sidebar.`,
	RunE:    gulinRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	rootCmd.AddCommand(gulinCmd)
}

func gulinRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("gulin", rtnErr == nil)
	}()

	tabId := getTabIdFromEnv()
	if tabId == "" {
		return fmt.Errorf("GULIN_TABID environment variable not set")
	}
	route := wshutil.MakeTabRouteId(tabId)
	const rpcTimeout = 30000

	var message string
	var filesToAttach []string

	// Detect stdin
	stat, _ := os.Stdin.Stat()
	hasStdin := (stat.Mode() & os.ModeCharDevice) == 0

	if len(args) > 0 {
		// First arg is usually the message if it doesn't look like a file
		firstArg := args[0]
		if _, err := os.Stat(firstArg); err == nil {
			// It's a file
			filesToAttach = args
		} else {
			// It's a message
			message = firstArg
			filesToAttach = args[1:]
		}
	}

	// 1. Process Stdin if present
	if hasStdin {
		data, err := io.ReadAll(os.Stdin)
		if err == nil && len(data) > 0 {
			attachedFile := wshrpc.AIAttachedFile{
				Name:   "stdin",
				Type:   "text/plain",
				Size:   len(data),
				Data64: base64.StdEncoding.EncodeToString(data),
			}
			wshclient.GulinAIAddContextCommand(RpcClient, wshrpc.CommandGulinAIAddContextData{
				Files: []wshrpc.AIAttachedFile{attachedFile},
			}, &wshrpc.RpcOpts{Route: route, Timeout: rpcTimeout})
		}
	}

	// 2. Process Files
	for _, filePath := range filesToAttach {
		data, err := os.ReadFile(filePath)
		if err != nil {
			continue
		}
		attachedFile := wshrpc.AIAttachedFile{
			Name:   filePath,
			Type:   "text/plain",
			Size:   len(data),
			Data64: base64.StdEncoding.EncodeToString(data),
		}
		wshclient.GulinAIAddContextCommand(RpcClient, wshrpc.CommandGulinAIAddContextData{
			Files: []wshrpc.AIAttachedFile{attachedFile},
		}, &wshrpc.RpcOpts{Route: route, Timeout: rpcTimeout})
	}

	// 3. Send Message and Submit
	finalContext := wshrpc.CommandGulinAIAddContextData{
		Text:   message,
		Submit: true,
	}
	return wshclient.GulinAIAddContextCommand(RpcClient, finalContext, &wshrpc.RpcOpts{
		Route:   route,
		Timeout: rpcTimeout,
	})
}
