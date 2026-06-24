// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package gulinai

import (
	"context"
	"log"
	"net/url"
	"strings"

	"github.com/gulindev/gulin/pkg/telemetry"
	"github.com/gulindev/gulin/pkg/telemetry/telemetrydata"
	"github.com/gulindev/gulin/pkg/wshrpc"
)

const GulinAIPacketstr = "gulinai"
const APIType_Anthropic = "anthropic"
const APIType_Perplexity = "perplexity"
const APIType_Google = "google"
const APIType_OpenAI = "openai"

type GulinAICmdInfoPacketOutputType struct {
	Model        string `json:"model,omitempty"`
	Created      int64  `json:"created,omitempty"`
	FinishReason string `json:"finish_reason,omitempty"`
	Message      string `json:"message,omitempty"`
	Error        string `json:"error,omitempty"`
}

func MakeGulinAIPacket() *wshrpc.GulinAIPacketType {
	return &wshrpc.GulinAIPacketType{Type: GulinAIPacketstr}
}

type GulinAICmdInfoChatMessage struct {
	MessageID           int                            `json:"messageid"`
	IsAssistantResponse bool                           `json:"isassistantresponse,omitempty"`
	AssistantResponse   *GulinAICmdInfoPacketOutputType `json:"assistantresponse,omitempty"`
	UserQuery           string                         `json:"userquery,omitempty"`
	UserEngineeredQuery string                         `json:"userengineeredquery,omitempty"`
}

type AIBackend interface {
	StreamCompletion(
		ctx context.Context,
		request wshrpc.GulinAIStreamRequest,
	) chan wshrpc.RespOrErrorUnion[wshrpc.GulinAIPacketType]
}

func IsCloudAIRequest(opts *wshrpc.GulinAIOptsType) bool {
	if opts == nil {
		return true
	}
	return opts.BaseURL == "" && opts.APIToken == ""
}

func isLocalURL(baseURL string) bool {
	if baseURL == "" {
		return false
	}

	u, err := url.Parse(baseURL)
	if err != nil {
		return false
	}

	host := strings.ToLower(u.Hostname())
	return host == "localhost" || host == "127.0.0.1" || host == "0.0.0.0" || strings.HasPrefix(host, "192.168.") || strings.HasPrefix(host, "10.") || (strings.HasPrefix(host, "172.") && len(host) > 4)
}

func makeAIError(err error) wshrpc.RespOrErrorUnion[wshrpc.GulinAIPacketType] {
	return wshrpc.RespOrErrorUnion[wshrpc.GulinAIPacketType]{Error: err}
}

func RunAICommand(ctx context.Context, request wshrpc.GulinAIStreamRequest) chan wshrpc.RespOrErrorUnion[wshrpc.GulinAIPacketType] {
	telemetry.GoUpdateActivityWrap(wshrpc.ActivityUpdate{NumAIReqs: 1}, "RunAICommand")

	endpoint := request.Opts.BaseURL
	if endpoint == "" {
		endpoint = "default"
	}
	var backend AIBackend
	var backendType string
	if request.Opts.APIType == APIType_Anthropic {
		backend = AnthropicBackend{}
		backendType = APIType_Anthropic
	} else if request.Opts.APIType == APIType_Perplexity {
		backend = PerplexityBackend{}
		backendType = APIType_Perplexity
	} else if request.Opts.APIType == APIType_Google {
		backend = GoogleBackend{}
		backendType = APIType_Google
	} else if IsCloudAIRequest(request.Opts) {
		endpoint = "gulin cloud"
		request.Opts.APIType = APIType_OpenAI
		request.Opts.Model = "default"
		backend = GulinAICloudBackend{}
		backendType = "gulin"
	} else {
		backend = OpenAIBackend{}
		backendType = APIType_OpenAI
	}
	if backend == nil {
		log.Printf("no backend found for %s\n", request.Opts.APIType)
		return nil
	}
	aiLocal := backendType != "gulin" && isLocalURL(request.Opts.BaseURL)
	telemetry.GoRecordTEventWrap(&telemetrydata.TEvent{
		Event: "action:runaicmd",
		Props: telemetrydata.TEventProps{
			AiBackendType: backendType,
			AiLocal:       aiLocal,
		},
	})

	log.Printf("sending ai chat message to %s endpoint %q using model %s\n", request.Opts.APIType, endpoint, request.Opts.Model)
	return backend.StreamCompletion(ctx, request)
}
