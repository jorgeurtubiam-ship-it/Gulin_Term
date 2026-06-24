package bedrock

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"

	"github.com/gulindev/gulin/pkg/aiusechat/chatstore"
	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/web/sse"
)

type BedrockMessage struct {
	MessageId string         `json:"messageid"`
	Pinned    bool           `json:"pinned,omitempty"`
	Role      string         `json:"role"`
	Usage     *uctypes.AIUsage `json:"usage,omitempty"`
	Content   string         `json:"content"` // simplified for now
}

func (m *BedrockMessage) GetMessageId() string { return m.MessageId }
func (m *BedrockMessage) GetRole() string      { return m.Role }
func (m *BedrockMessage) GetUsage() *uctypes.AIUsage { return m.Usage }
func (m *BedrockMessage) GetContent() string   { return m.Content }
func (m *BedrockMessage) IsPinned() bool       { return m.Pinned }

type BedrockBackend struct{}

func (b *BedrockBackend) RunChatStep(
	ctx context.Context,
	sseHandler *sse.SSEHandlerCh,
	chatOpts uctypes.GulinChatOpts,
	cont *uctypes.GulinContinueResponse,
) (*uctypes.GulinStopReason, []uctypes.GenAIMessage, *uctypes.RateLimitInfo, error) {
	
	conn, err := ReadAWSConnection("default")
	if err != nil {
		return nil, nil, nil, fmt.Errorf("aws connection error: %v", err)
	}

	cfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion(conn.Region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(conn.AccessKey, conn.SecretKey, "")),
	)
	if err != nil {
		return nil, nil, nil, err
	}

	client := bedrockruntime.NewFromConfig(cfg)
	
	chat := chatstore.DefaultChatStore.Get(chatOpts.ChatId)
	if chat == nil {
		return nil, nil, nil, fmt.Errorf("chat not found: %s", chatOpts.ChatId)
	}

	// Convert messages
	var bedrockMsgs []types.Message
	for _, rawMsg := range chat.NativeMessages {
		bm, ok := rawMsg.(*BedrockMessage)
		if !ok {
			continue // skip
		}
		role := types.ConversationRoleUser
		if bm.Role == "assistant" {
			role = types.ConversationRoleAssistant
		}
		bedrockMsgs = append(bedrockMsgs, types.Message{
			Role: role,
			Content: []types.ContentBlock{
				&types.ContentBlockMemberText{Value: bm.Content},
			},
		})
	}

	req := &bedrockruntime.ConverseStreamInput{
		ModelId:  aws.String(chatOpts.Config.Model),
		Messages: bedrockMsgs,
	}

	streamResp, err := client.ConverseStream(ctx, req)
	if err != nil {
		return nil, nil, nil, err
	}

	msgID := "gen-bedrock-" + chatOpts.ChatId
	textID := msgID + "-text"
	
	if sseHandler != nil {
		_ = sseHandler.AiMsgStart(msgID)
		_ = sseHandler.AiMsgStartStep()
		_ = sseHandler.AiMsgTextStart(textID)
	}

	fullText := ""
	for event := range streamResp.GetStream().Events() {
		switch v := event.(type) {
		case *types.ConverseStreamOutputMemberContentBlockDelta:
			if textDelta, ok := v.Value.Delta.(*types.ContentBlockDeltaMemberText); ok {
				fullText += textDelta.Value
				if sseHandler != nil {
					_ = sseHandler.AiMsgTextDelta(textID, textDelta.Value)
				}
			}
		}
	}

	if sseHandler != nil {
		_ = sseHandler.AiMsgTextEnd(textID)
		_ = sseHandler.AiMsgFinishStep()
	}

	stopReason := &uctypes.GulinStopReason{Kind: uctypes.StopKindDone}
	retMsg := &BedrockMessage{
		MessageId: "gen-bedrock-" + chatOpts.ChatId,
		Role:      "assistant",
		Content:   fullText,
	}

	return stopReason, []uctypes.GenAIMessage{retMsg}, nil, nil
}

func (b *BedrockBackend) UpdateToolUseData(chatId string, toolCallId string, toolUseData uctypes.UIMessageDataToolUse) error {
	return nil
}

func (b *BedrockBackend) RemoveToolUseCall(chatId string, toolCallId string) error {
	return nil
}

func (b *BedrockBackend) ConvertToolResultsToNativeChatMessage(toolResults []uctypes.AIToolResult) ([]uctypes.GenAIMessage, error) {
	return nil, nil
}

func (b *BedrockBackend) ConvertAIMessageToNativeChatMessage(message uctypes.AIMessage) (uctypes.GenAIMessage, error) {
	content := ""
	for _, p := range message.Parts {
		if p.Type == "text" {
			content += p.Text
		}
	}
	return &BedrockMessage{
		MessageId: message.MessageId,
		Role:      message.Role,
		Content:   content,
		Pinned:    message.Pinned,
	}, nil
}

func (b *BedrockBackend) GetFunctionCallInputByToolCallId(aiChat uctypes.AIChat, toolCallId string) *uctypes.AIFunctionCallInput {
	return nil
}

func (b *BedrockBackend) ConvertAIChatToUIChat(aiChat uctypes.AIChat) (*uctypes.UIChat, error) {
	rtn := &uctypes.UIChat{
		ChatId:     aiChat.ChatId,
		APIType:    aiChat.APIType,
		Model:      aiChat.Model,
		APIVersion: aiChat.APIVersion,
	}

	for _, m := range aiChat.NativeMessages {
		bm, ok := m.(*BedrockMessage)
		if !ok {
			log.Printf("ConvertAIChatToUIChat expected *BedrockMessage, got %T\n", m)
			continue
		}
		uiMsg := uctypes.UIMessage{
			ID:     bm.MessageId,
			Role:   bm.Role,
			Pinned: bm.Pinned,
			Parts: []uctypes.UIMessagePart{
				{Type: "text", Text: bm.Content},
			},
		}
		rtn.Messages = append(rtn.Messages, uiMsg)
	}

	return rtn, nil
}

// Ensure the unmarshaler is registered so Gulin can read the JSON from db
func init() {
	uctypes.NativeMessageUnmarshalers[uctypes.APIType_AWSBedrock] = func(data []byte) (uctypes.GenAIMessage, error) {
		var bm BedrockMessage
		if err := json.Unmarshal(data, &bm); err != nil {
			return nil, err
		}
		return &bm, nil
	}
}
