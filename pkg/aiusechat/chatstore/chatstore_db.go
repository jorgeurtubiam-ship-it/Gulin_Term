// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chatstore

import (
	"context"
	"encoding/json"
	"log"
	"strings"
	"time"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/wstore"
)

type ChatSummary struct {
	ChatID       string `json:"chatid"`
	LastUpdate   int64  `json:"lastupdate"`
	Model        string `json:"model"`
	Snippet      string `json:"snippet"`
	MessageCount int    `json:"messagecount"`
}

type DBChatMessage struct {
	ChatID    string `db:"chat_id"`
	MessageID string `db:"message_id"`
	Role      string `db:"role"`
	Content   string `db:"content"`
	CreatedAt int64  `db:"created_at"`
	APIType   string `db:"api_type"`
	Model     string `db:"model"`
	Pinned    bool   `db:"pinned"`
	ExtraData string `db:"extra_data"`
}

func getContent(message uctypes.GenAIMessage) string {
	return message.GetContent()
}

func SaveMessageToDB(chatId string, aiOpts *uctypes.AIOptsType, message uctypes.GenAIMessage) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	return wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		// Always save the FULL native message for reloading
		fullData, _ := json.Marshal(message)
		extraData := string(fullData)

		dbMsg := DBChatMessage{
			ChatID:    chatId,
			MessageID: message.GetMessageId(),
			Role:      message.GetRole(),
			Content:   getContent(message),
			CreatedAt: time.Now().UnixMilli(),
			APIType:   aiOpts.APIType,
			Model:     aiOpts.Model,
			Pinned:    message.IsPinned(),
			ExtraData: extraData,
		}

		query := `INSERT OR REPLACE INTO chat_message 
			(chat_id, message_id, role, content, created_at, api_type, model, pinned, extra_data) 
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`

		tx.Exec(query,
			dbMsg.ChatID,
			dbMsg.MessageID,
			dbMsg.Role,
			dbMsg.Content,
			dbMsg.CreatedAt,
			dbMsg.APIType,
			dbMsg.Model,
			dbMsg.Pinned,
			dbMsg.ExtraData,
		)
		return nil
	})
}

func LoadChatFromDB(chatId string) (*uctypes.AIChat, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	return wstore.WithTxRtn(ctx, func(tx *wstore.TxWrap) (*uctypes.AIChat, error) {
		var dbMsgs []DBChatMessage
		query := `SELECT * FROM chat_message WHERE chat_id = ? ORDER BY created_at ASC`
		tx.Select(&dbMsgs, query, chatId)

		if len(dbMsgs) == 0 {
			return nil, nil
		}

		chat := &uctypes.AIChat{
			ChatId:         chatId,
			APIType:        dbMsgs[0].APIType,
			Model:          dbMsgs[0].Model,
			NativeMessages: make([]uctypes.GenAIMessage, 0, len(dbMsgs)),
		}

		for _, dbMsg := range dbMsgs {
			var aiMsg uctypes.GenAIMessage
			if unmarshaler, ok := uctypes.NativeMessageUnmarshalers[dbMsg.APIType]; ok && dbMsg.ExtraData != "" {
				var err error
				aiMsg, err = unmarshaler([]byte(dbMsg.ExtraData))
				if err != nil {
					log.Printf("error unmarshaling native message: %v\n", err)
				}
			}

			// Fallback específico para PLAI si el unmarshaler falló o no existe el tipo exacto
			if aiMsg == nil && dbMsg.ExtraData != "" && (dbMsg.APIType == "plai-assistant" || strings.Contains(dbMsg.ExtraData, "toolcalls")) {
				var m uctypes.PlaiMessage
				if err := json.Unmarshal([]byte(dbMsg.ExtraData), &m); err == nil && m.Role != "" {
					m.Pinned = dbMsg.Pinned
					aiMsg = &m
				}
			}

			if aiMsg == nil {
				// Fallback to generic AIMessage
				genericMsg := &uctypes.AIMessage{
					MessageId: dbMsg.MessageID,
					Role:      dbMsg.Role,
					Pinned:    dbMsg.Pinned,
				}
				if dbMsg.ExtraData != "" {
					var parts []uctypes.AIMessagePart
					err := json.Unmarshal([]byte(dbMsg.ExtraData), &parts)
					if err == nil {
						genericMsg.Parts = parts
					}
				}
				// If no parts (fallback), create one from content
				if len(genericMsg.Parts) == 0 {
					genericMsg.Parts = []uctypes.AIMessagePart{{Type: uctypes.AIMessagePartTypeText, Text: dbMsg.Content}}
				}
				aiMsg = genericMsg
			}
			chat.NativeMessages = append(chat.NativeMessages, aiMsg)
		}

		return chat, nil
	})
}

func DeleteChatFromDB(chatId string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	return wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		tx.Exec(`DELETE FROM chat_message WHERE chat_id = ?`, chatId)
		return nil
	})
}

func DeleteMessageFromDB(chatId string, messageId string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	return wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		tx.Exec(`DELETE FROM chat_message WHERE chat_id = ? AND message_id = ?`, chatId, messageId)
		return nil
	})
}

func BulkDeleteChatsFromDB(chatIds []string) error {
	if len(chatIds) == 0 {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	log.Printf("[GULIN] Starting bulk delete of %d chats\n", len(chatIds))

	return wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		// Use a single query for efficiency
		query := "DELETE FROM chat_message WHERE chat_id IN ("
		args := make([]interface{}, len(chatIds))
		for i, id := range chatIds {
			if i > 0 {
				query += ","
			}
			query += "?"
			args[i] = id
		}
		query += ")"

		tx.Exec(query, args...)
		return nil
	})
}


func GetChatListFromDB() ([]ChatSummary, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	return wstore.WithTxRtn(ctx, func(tx *wstore.TxWrap) ([]ChatSummary, error) {
		summaries := make([]ChatSummary, 0)
		query := `
			SELECT 
				chat_id as chatid, 
				MAX(created_at) as lastupdate, 
				model, 
				(SELECT content FROM chat_message cm2 WHERE cm2.chat_id = chat_message.chat_id ORDER BY created_at DESC LIMIT 1) as snippet,
				COUNT(*) as messagecount
			FROM chat_message 
			GROUP BY chat_id 
			ORDER BY lastupdate DESC
		`
		tx.Select(&summaries, query)
		return summaries, nil
	})
}
