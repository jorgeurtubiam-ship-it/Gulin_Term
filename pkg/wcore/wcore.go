// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// gulin core application coordinator
package wcore

import (
	"context"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/gulindev/gulin/pkg/panichandler"
	"github.com/gulindev/gulin/pkg/gulinjwt"
	"github.com/gulindev/gulin/pkg/gulinobj"
	"github.com/gulindev/gulin/pkg/wcloud"
	"github.com/gulindev/gulin/pkg/wps"
	"github.com/gulindev/gulin/pkg/wstore"
)

// the wcore package coordinates actions across the storage layer
// orchestrating the gulin object store, the gulin pubsub system, and the gulin rpc system

// Ensures that the initial data is present in the store, creates an initial window if needed
func EnsureInitialData() (bool, error) {
	// does not need to run in a transaction since it is called on startup
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	client, err := wstore.DBGetSingleton[*gulinobj.Client](ctx)
	firstLaunch := false
	if err == wstore.ErrNotFound {
		client, err = CreateClient(ctx)
		if err != nil {
			return false, fmt.Errorf("error creating client: %w", err)
		}
		firstLaunch = true
	}
	if client.TempOID == "" {
		log.Println("client.TempOID is empty")
		client.TempOID = uuid.NewString()
		err = wstore.DBUpdate(ctx, client)
		if err != nil {
			return firstLaunch, fmt.Errorf("error updating client: %w", err)
		}
	}
	if client.InstallId == "" {
		log.Println("client.InstallId is empty")
		client.InstallId = uuid.NewString()
		err = wstore.DBUpdate(ctx, client)
		if err != nil {
			return firstLaunch, fmt.Errorf("error updating client: %w", err)
		}
	}
	log.Printf("clientid: %s\n", client.OID)
	wstore.SetClientId(client.OID)
	if len(client.WindowIds) == 1 {
		log.Println("client has one window")
		CheckAndFixWindow(ctx, client.WindowIds[0])
		return firstLaunch, nil
	}
	if len(client.WindowIds) > 0 {
		log.Println("client has windows")
		return firstLaunch, nil
	}
	wsId := ""
	if firstLaunch {
		log.Println("client has no windows and first launch, creating starter workspace")
		starterWs, err := CreateWorkspace(ctx, "Starter workspace", "custom@gulin-logo-solid", "#58C142", false, true)
		if err != nil {
			return firstLaunch, fmt.Errorf("error creating starter workspace: %w", err)
		}
		wsId = starterWs.OID
	}
	_, err = CreateWindow(ctx, nil, wsId)
	if err != nil {
		return firstLaunch, fmt.Errorf("error creating window: %w", err)
	}
	return firstLaunch, nil
}

func CreateClient(ctx context.Context) (*gulinobj.Client, error) {
	client := &gulinobj.Client{
		OID:       uuid.NewString(),
		WindowIds: []string{},
	}
	err := wstore.DBInsert(ctx, client)
	if err != nil {
		return nil, fmt.Errorf("error inserting client: %w", err)
	}
	return client, nil
}

func GetClientData(ctx context.Context) (*gulinobj.Client, error) {
	clientData, err := wstore.DBGetSingleton[*gulinobj.Client](ctx)
	if err != nil {
		return nil, fmt.Errorf("error getting client data: %w", err)
	}
	return clientData, nil
}

func SendGulinObjUpdate(oref gulinobj.ORef) {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	// send a gulinobj:update event
	gulinObj, err := wstore.DBGetORef(ctx, oref)
	if err != nil {
		log.Printf("error getting object for update event: %v", err)
		return
	}
	wps.Broker.Publish(wps.GulinEvent{
		Event:  wps.Event_GulinObjUpdate,
		Scopes: []string{oref.String()},
		Data: gulinobj.GulinObjUpdate{
			UpdateType: gulinobj.UpdateType_Update,
			OType:      gulinObj.GetOType(),
			OID:        gulinobj.GetOID(gulinObj),
			Obj:        gulinObj,
		},
	})
}

func ResolveBlockIdFromPrefix(ctx context.Context, tabId string, blockIdPrefix string) (string, error) {
	if len(blockIdPrefix) != 8 {
		return "", fmt.Errorf("widget_id must be 8 characters")
	}

	tab, err := wstore.DBMustGet[*gulinobj.Tab](ctx, tabId)
	if err != nil {
		return "", fmt.Errorf("error getting tab: %w", err)
	}

	for _, blockId := range tab.BlockIds {
		if strings.HasPrefix(blockId, blockIdPrefix) {
			return blockId, nil
		}
	}

	return "", fmt.Errorf("widget_id not found: %q", blockIdPrefix)
}

func GoSendNoTelemetryUpdate(telemetryEnabled bool) {
	go func() {
		defer func() {
			panichandler.PanicHandler("GoSendNoTelemetryUpdate", recover())
		}()
		ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelFn()
		clientId := wstore.GetClientId()
		err := wcloud.SendNoTelemetryUpdate(ctx, clientId, !telemetryEnabled)
		if err != nil {
			log.Printf("[error] sending no-telemetry update: %v\n", err)
			return
		}
	}()
}

func InitMainServer() error {
	ctx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()

	mainServer, err := wstore.DBGetSingleton[*gulinobj.MainServer](ctx)
	if err == wstore.ErrNotFound {
		mainServer = &gulinobj.MainServer{
			OID: uuid.NewString(),
		}
		err = wstore.DBInsert(ctx, mainServer)
		if err != nil {
			return fmt.Errorf("error inserting mainserver: %w", err)
		}
	} else if err != nil {
		return fmt.Errorf("error getting mainserver: %w", err)
	}

	needsUpdate := false
	if mainServer.JwtPrivateKey == "" || mainServer.JwtPublicKey == "" {
		keyPair, err := gulinjwt.GenerateKeyPair()
		if err != nil {
			return fmt.Errorf("error generating jwt keypair: %w", err)
		}
		mainServer.JwtPrivateKey = base64.StdEncoding.EncodeToString(keyPair.PrivateKey)
		mainServer.JwtPublicKey = base64.StdEncoding.EncodeToString(keyPair.PublicKey)
		needsUpdate = true
	}

	if needsUpdate {
		err = wstore.DBUpdate(ctx, mainServer)
		if err != nil {
			return fmt.Errorf("error updating mainserver: %w", err)
		}
	}

	privateKeyBytes, err := base64.StdEncoding.DecodeString(mainServer.JwtPrivateKey)
	if err != nil {
		return fmt.Errorf("error decoding jwt private key: %w", err)
	}
	publicKeyBytes, err := base64.StdEncoding.DecodeString(mainServer.JwtPublicKey)
	if err != nil {
		return fmt.Errorf("error decoding jwt public key: %w", err)
	}

	err = gulinjwt.SetPrivateKey(privateKeyBytes)
	if err != nil {
		return fmt.Errorf("error setting jwt private key: %w", err)
	}
	err = gulinjwt.SetPublicKey(publicKeyBytes)
	if err != nil {
		return fmt.Errorf("error setting jwt public key: %w", err)
	}

	pubKeyDer, err := x509.MarshalPKIXPublicKey(ed25519.PublicKey(publicKeyBytes))
	if err != nil {
		log.Printf("warning: could not marshal public key for logging: %v", err)
	} else {
		pubKeyPem := pem.EncodeToMemory(&pem.Block{
			Type:  "PUBLIC KEY",
			Bytes: pubKeyDer,
		})
		log.Printf("JWT Public Key:\n%s", string(pubKeyPem))
	}

	return nil
}
