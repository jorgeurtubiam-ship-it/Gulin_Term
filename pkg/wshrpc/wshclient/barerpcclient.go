// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshclient

import (
	"fmt"
	"sync"

	"github.com/google/uuid"
	"github.com/gulindev/gulin/pkg/wps"
	"github.com/gulindev/gulin/pkg/wshrpc"
	"github.com/gulindev/gulin/pkg/wshutil"
)

type WshServer struct{}

func (*WshServer) WshServerImpl() {}

var WshServerImpl = WshServer{}

var gulinSrvClient_Singleton *wshutil.WshRpc
var gulinSrvClient_Once = &sync.Once{}
var gulinSrvClient_RouteId string

func GetBareRpcClient() *wshutil.WshRpc {
	gulinSrvClient_Once.Do(func() {
		gulinSrvClient_Singleton = wshutil.MakeWshRpc(wshrpc.RpcContext{}, &WshServerImpl, "bare-client")
		gulinSrvClient_RouteId = fmt.Sprintf("bare:%s", uuid.New().String())
		// we can safely ignore the error from RegisterTrustedLeaf since the route is valid
		wshutil.DefaultRouter.RegisterTrustedLeaf(gulinSrvClient_Singleton, gulinSrvClient_RouteId)
		wps.Broker.SetClient(wshutil.DefaultRouter)
	})
	return gulinSrvClient_Singleton
}

func GetBareRpcClientRouteId() string {
	GetBareRpcClient()
	return gulinSrvClient_RouteId
}
