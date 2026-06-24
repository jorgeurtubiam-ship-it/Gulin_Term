// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"fmt"
	"os"
	"reflect"
	"strings"

	"github.com/gulindev/gulin/pkg/gogen"
	"github.com/gulindev/gulin/pkg/util/utilfn"
	"github.com/gulindev/gulin/pkg/gulinobj"
	"github.com/gulindev/gulin/pkg/wconfig"
	"github.com/gulindev/gulin/pkg/wshrpc"
)

const WshClientFileName = "pkg/wshrpc/wshclient/wshclient.go"
const GulinObjMetaConstsFileName = "pkg/gulinobj/metaconsts.go"
const SettingsMetaConstsFileName = "pkg/wconfig/metaconsts.go"

func GenerateWshClient() error {
	fmt.Fprintf(os.Stderr, "generating wshclient file to %s\n", WshClientFileName)
	var buf strings.Builder
	gogen.GenerateBoilerplate(&buf, "wshclient", []string{
		"github.com/gulindev/gulin/pkg/telemetry/telemetrydata",
		"github.com/gulindev/gulin/pkg/wshutil",
		"github.com/gulindev/gulin/pkg/wshrpc",
		"github.com/gulindev/gulin/pkg/wconfig",
		"github.com/gulindev/gulin/pkg/gulinobj",
		"github.com/gulindev/gulin/pkg/wps",
		"github.com/gulindev/gulin/pkg/vdom",
		"github.com/gulindev/gulin/pkg/aiusechat/uctypes",
	})
	wshDeclMap := wshrpc.GenerateWshCommandDeclMap()
	for _, key := range utilfn.GetOrderedMapKeys(wshDeclMap) {
		methodDecl := wshDeclMap[key]
		if methodDecl.CommandType == wshrpc.RpcType_ResponseStream {
			gogen.GenMethod_ResponseStream(&buf, methodDecl)
		} else if methodDecl.CommandType == wshrpc.RpcType_Call {
			gogen.GenMethod_Call(&buf, methodDecl)
		} else {
			panic("unsupported command type " + methodDecl.CommandType)
		}
	}
	buf.WriteString("\n")
	written, err := utilfn.WriteFileIfDifferent(WshClientFileName, []byte(buf.String()))
	if !written {
		fmt.Fprintf(os.Stderr, "no changes to %s\n", WshClientFileName)
	}
	return err
}

func GenerateGulinObjMetaConsts() error {
	fmt.Fprintf(os.Stderr, "generating gulinobj meta consts file to %s\n", GulinObjMetaConstsFileName)
	var buf strings.Builder
	gogen.GenerateBoilerplate(&buf, "gulinobj", []string{})
	gogen.GenerateMetaMapConsts(&buf, "MetaKey_", reflect.TypeOf(gulinobj.MetaTSType{}), false)
	buf.WriteString("\n")
	written, err := utilfn.WriteFileIfDifferent(GulinObjMetaConstsFileName, []byte(buf.String()))
	if !written {
		fmt.Fprintf(os.Stderr, "no changes to %s\n", GulinObjMetaConstsFileName)
	}
	return err
}

func GenerateSettingsMetaConsts() error {
	fmt.Fprintf(os.Stderr, "generating settings meta consts file to %s\n", SettingsMetaConstsFileName)
	var buf strings.Builder
	gogen.GenerateBoilerplate(&buf, "wconfig", []string{})
	gogen.GenerateMetaMapConsts(&buf, "ConfigKey_", reflect.TypeOf(wconfig.SettingsType{}), false)
	buf.WriteString("\n")
	written, err := utilfn.WriteFileIfDifferent(SettingsMetaConstsFileName, []byte(buf.String()))
	if !written {
		fmt.Fprintf(os.Stderr, "no changes to %s\n", SettingsMetaConstsFileName)
	}
	return err
}

func main() {
	err := GenerateWshClient()
	if err != nil {
		fmt.Fprintf(os.Stderr, "error generating wshclient: %v\n", err)
		return
	}
	err = GenerateGulinObjMetaConsts()
	if err != nil {
		fmt.Fprintf(os.Stderr, "error generating gulinobj meta consts: %v\n", err)
		return
	}
	err = GenerateSettingsMetaConsts()
	if err != nil {
		fmt.Fprintf(os.Stderr, "error generating settings meta consts: %v\n", err)
		return
	}
}
