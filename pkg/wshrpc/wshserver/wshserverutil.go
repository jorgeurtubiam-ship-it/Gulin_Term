// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"sync"

	"github.com/gulindev/gulin/pkg/wshrpc"
	"github.com/gulindev/gulin/pkg/wshutil"
)

const (
	DefaultOutputChSize = 32
	DefaultInputChSize  = 32
)

var gulinSrvClient_Singleton *wshutil.WshRpc
var gulinSrvClient_Once = &sync.Once{}

// returns the gulinsrv main rpc client singleton
func GetMainRpcClient() *wshutil.WshRpc {
	gulinSrvClient_Once.Do(func() {
		gulinSrvClient_Singleton = wshutil.MakeWshRpc(wshrpc.RpcContext{}, &WshServerImpl, "main-client")
	})
	return gulinSrvClient_Singleton
}
