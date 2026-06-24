// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package tsgen

import (
	"reflect"
	"strings"
	"testing"

	"github.com/gulindev/gulin/pkg/wps"
	"github.com/gulindev/gulin/pkg/wshrpc"
)

func TestGenerateGulinEventTypes(t *testing.T) {
	tsTypesMap := make(map[reflect.Type]string)
	gulinEventTypeDecl := GenerateGulinEventTypes(tsTypesMap)

	if !strings.Contains(gulinEventTypeDecl, `type GulinEventName = "blockclose"`) {
		t.Fatalf("expected GulinEventName declaration, got:\n%s", gulinEventTypeDecl)
	}
	if !strings.Contains(gulinEventTypeDecl, `{ event: "block:jobstatus"; data?: BlockJobStatusData; }`) {
		t.Fatalf("expected typed block:jobstatus event, got:\n%s", gulinEventTypeDecl)
	}
	if !strings.Contains(gulinEventTypeDecl, `{ event: "route:up"; data?: null; }`) {
		t.Fatalf("expected null for known no-data event, got:\n%s", gulinEventTypeDecl)
	}
	if got := getGulinEventDataTSType("unmapped:event", tsTypesMap); got != "any" {
		t.Fatalf("expected any for unmapped event fallback, got: %q", got)
	}
	if _, found := tsTypesMap[reflect.TypeOf(wps.GulinEvent{})]; !found {
		t.Fatalf("expected GulinEvent type to be seeded in tsTypesMap")
	}
	if _, found := tsTypesMap[reflect.TypeOf(wshrpc.BlockJobStatusData{})]; !found {
		t.Fatalf("expected mapped data types to be generated into tsTypesMap")
	}
}
