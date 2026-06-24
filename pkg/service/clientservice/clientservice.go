// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package clientservice

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/gulindev/gulin/pkg/remote/conncontroller"
	"github.com/gulindev/gulin/pkg/gulinobj"
	"github.com/gulindev/gulin/pkg/wconfig"
	"github.com/gulindev/gulin/pkg/wcore"
	"github.com/gulindev/gulin/pkg/wshrpc"
	"github.com/gulindev/gulin/pkg/wslconn"
	"github.com/gulindev/gulin/pkg/wstore"
)

type ClientService struct{}

const DefaultTimeout = 2 * time.Second

func (cs *ClientService) GetClientData() (*gulinobj.Client, error) {
	log.Println("GetClientData")
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	return wcore.GetClientData(ctx)
}

func (cs *ClientService) GetTab(tabId string) (*gulinobj.Tab, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	tab, err := wstore.DBGet[*gulinobj.Tab](ctx, tabId)
	if err != nil {
		return nil, fmt.Errorf("error getting tab: %w", err)
	}
	return tab, nil
}

func (cs *ClientService) GetAllConnStatus(ctx context.Context) ([]wshrpc.ConnStatus, error) {
	sshStatuses := conncontroller.GetAllConnStatus()
	wslStatuses := wslconn.GetAllConnStatus()
	return append(sshStatuses, wslStatuses...), nil
}

// moves the window to the front of the windowId stack
func (cs *ClientService) FocusWindow(ctx context.Context, windowId string) error {
	return wcore.FocusWindow(ctx, windowId)
}

func (cs *ClientService) AgreeTos(ctx context.Context) (gulinobj.UpdatesRtnType, error) {
	ctx = gulinobj.ContextWithUpdates(ctx)
	clientData, err := wstore.DBGetSingleton[*gulinobj.Client](ctx)
	if err != nil {
		return nil, fmt.Errorf("error getting client data: %w", err)
	}
	timestamp := time.Now().UnixMilli()
	clientData.TosAgreed = timestamp
	err = wstore.DBUpdate(ctx, clientData)
	if err != nil {
		return nil, fmt.Errorf("error updating client data: %w", err)
	}
	wcore.BootstrapStarterLayout(ctx)
	return gulinobj.ContextGetUpdatesRtn(ctx), nil
}

func (cs *ClientService) TelemetryUpdate(ctx context.Context, telemetryEnabled bool) error {
	meta := gulinobj.MetaMapType{
		wconfig.ConfigKey_TelemetryEnabled: telemetryEnabled,
	}
	err := wconfig.SetBaseConfigValue(meta)
	if err != nil {
		return fmt.Errorf("error setting telemetry value: %w", err)
	}
	return nil
}
