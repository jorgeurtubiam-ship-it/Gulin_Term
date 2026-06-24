// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package tsgen

import (
	"bytes"
	"fmt"
	"reflect"
	"strconv"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/blockcontroller"
	"github.com/gulindev/gulin/pkg/userinput"
	"github.com/gulindev/gulin/pkg/gulinobj"
	"github.com/gulindev/gulin/pkg/wconfig"
	"github.com/gulindev/gulin/pkg/wps"
	"github.com/gulindev/gulin/pkg/wshrpc"
)

var gulinEventRType = reflect.TypeOf(wps.GulinEvent{})

var GulinEventDataTypes = map[string]reflect.Type{
	wps.Event_BlockClose:          reflect.TypeOf(""),
	wps.Event_ConnChange:          reflect.TypeOf(wshrpc.ConnStatus{}),
	wps.Event_SysInfo:             reflect.TypeOf(wshrpc.TimeSeriesData{}),
	wps.Event_ControllerStatus:    reflect.TypeOf((*blockcontroller.BlockControllerRuntimeStatus)(nil)),
	wps.Event_BuilderStatus:       reflect.TypeOf(wshrpc.BuilderStatusData{}),
	wps.Event_BuilderOutput:       reflect.TypeOf(map[string]any{}),
	wps.Event_GulinObjUpdate:       reflect.TypeOf(gulinobj.GulinObjUpdate{}),
	wps.Event_BlockFile:           reflect.TypeOf((*wps.WSFileEventData)(nil)),
	wps.Event_Config:              reflect.TypeOf(wconfig.WatcherUpdate{}),
	wps.Event_UserInput:           reflect.TypeOf((*userinput.UserInputRequest)(nil)),
	wps.Event_RouteDown:           nil,
	wps.Event_RouteUp:             nil,
	wps.Event_WorkspaceUpdate:     nil,
	wps.Event_GulinAIRateLimit:     reflect.TypeOf((*uctypes.RateLimitInfo)(nil)),
	wps.Event_GulinAppAppGoUpdated: nil,
	wps.Event_TsunamiUpdateMeta:   reflect.TypeOf(wshrpc.AppMeta{}),
	wps.Event_AIModeConfig:        reflect.TypeOf(wconfig.AIModeConfigUpdate{}),
	wps.Event_TabIndicator:        reflect.TypeOf(wshrpc.TabIndicatorEventData{}),
	wps.Event_BlockJobStatus:      reflect.TypeOf(wshrpc.BlockJobStatusData{}),
}

func getGulinEventDataTSType(eventName string, tsTypesMap map[reflect.Type]string) string {
	rtype, found := GulinEventDataTypes[eventName]
	if !found {
		return "any"
	}
	if rtype == nil {
		return "null"
	}
	tsType, _ := TypeToTSType(rtype, tsTypesMap)
	if tsType == "" {
		return "any"
	}
	return tsType
}

func GenerateGulinEventTypes(tsTypesMap map[reflect.Type]string) string {
	for _, rtype := range GulinEventDataTypes {
		GenerateTSType(rtype, tsTypesMap)
	}
	// suppress default struct generation, this type is custom generated
	tsTypesMap[gulinEventRType] = ""

	var buf bytes.Buffer
	buf.WriteString("// wps.GulinEvent\n")
	buf.WriteString("type GulinEventName = ")
	for idx, eventName := range wps.AllEvents {
		if idx > 0 {
			buf.WriteString(" | ")
		}
		buf.WriteString(strconv.Quote(eventName))
	}
	buf.WriteString(";\n\n")
	buf.WriteString("type GulinEvent = {\n")
	buf.WriteString("    event: GulinEventName;\n")
	buf.WriteString("    scopes?: string[];\n")
	buf.WriteString("    sender?: string;\n")
	buf.WriteString("    persist?: number;\n")
	buf.WriteString("    data?: unknown;\n")
	buf.WriteString("} & (\n")
	for idx, eventName := range wps.AllEvents {
		if idx > 0 {
			buf.WriteString(" | \n")
		}
		buf.WriteString(fmt.Sprintf("    { event: %s; data?: %s; }", strconv.Quote(eventName), getGulinEventDataTSType(eventName, tsTypesMap)))
	}
	buf.WriteString("\n);\n")
	return buf.String()
}
