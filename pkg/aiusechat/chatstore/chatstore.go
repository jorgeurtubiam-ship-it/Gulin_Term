// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chatstore

import (
	"fmt"
	"slices"
	"sync"

	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
)

type ChatStore struct {
	lock  sync.Mutex
	chats map[string]*uctypes.AIChat
}

var DefaultChatStore = &ChatStore{
	chats: make(map[string]*uctypes.AIChat),
}

func (cs *ChatStore) GetAll() []*uctypes.AIChat {
	cs.lock.Lock()
	defer cs.lock.Unlock()
	var rtn []*uctypes.AIChat
	for _, chat := range cs.chats {
		rtn = append(rtn, chat)
	}
	return rtn
}

func (cs *ChatStore) Get(chatId string) *uctypes.AIChat {
	cs.lock.Lock()
	chat := cs.chats[chatId]
	cs.lock.Unlock()

	if chat == nil {
		// Try loading from DB
		var err error
		chat, err = LoadChatFromDB(chatId)
		if err != nil || chat == nil {
			return nil
		}
		// Populate memory cache
		cs.lock.Lock()
		cs.chats[chatId] = chat
		cs.lock.Unlock()
	}

	cs.lock.Lock()
	defer cs.lock.Unlock()

	// Copy the chat to prevent concurrent access issues
	copyChat := &uctypes.AIChat{
		ChatId:         chat.ChatId,
		APIType:        chat.APIType,
		Model:          chat.Model,
		APIVersion:     chat.APIVersion,
		NativeMessages: make([]uctypes.GenAIMessage, len(chat.NativeMessages)),
	}
	copy(copyChat.NativeMessages, chat.NativeMessages)

	return copyChat
}

func (cs *ChatStore) Delete(chatId string) {
	cs.lock.Lock()
	delete(cs.chats, chatId)
	cs.lock.Unlock()

	// Persistence: Delete from DB
	DeleteChatFromDB(chatId)
}

func (cs *ChatStore) BulkDelete(chatIds []string) error {
	cs.lock.Lock()
	for _, id := range chatIds {
		delete(cs.chats, id)
	}
	cs.lock.Unlock()

	// Persistence: Delete from DB
	return BulkDeleteChatsFromDB(chatIds)
}



func (cs *ChatStore) CountUserMessages(chatId string) int {
	cs.lock.Lock()
	defer cs.lock.Unlock()

	chat := cs.chats[chatId]
	if chat == nil {
		return 0
	}

	count := 0
	for _, msg := range chat.NativeMessages {
		if msg.GetRole() == "user" {
			count++
		}
	}
	return count
}
func (cs *ChatStore) PostMessage(chatId string, aiOpts *uctypes.AIOptsType, message uctypes.GenAIMessage) error {
	cs.lock.Lock()
	chat := cs.chats[chatId]
	if chat == nil {
		// Try loading from DB first to see if it exists
		cs.lock.Unlock()
		var err error
		chat, err = LoadChatFromDB(chatId)
		cs.lock.Lock()
		if err == nil && chat != nil {
			cs.chats[chatId] = chat
		}
	}

	if chat == nil {
		// Create new chat
		chat = &uctypes.AIChat{
			ChatId:         chatId,
			APIType:        aiOpts.APIType,
			Model:          aiOpts.Model,
			APIVersion:     aiOpts.APIVersion,
			NativeMessages: make([]uctypes.GenAIMessage, 0),
		}
		cs.chats[chatId] = chat
	} else {
		// Verify that the AI options match
		if !uctypes.AreAPITypesCompatible(chat.APIType, aiOpts.APIType) {
			cs.lock.Unlock()
			return fmt.Errorf("API type mismatch: expected %s, got %s (must start a new chat)", chat.APIType, aiOpts.APIType)
		}
		// Update chat APIType if they are compatible but different
		if chat.APIType != aiOpts.APIType {
			chat.APIType = aiOpts.APIType
		}
		if !uctypes.AreModelsCompatible(chat.APIType, chat.Model, aiOpts.Model) {
			cs.lock.Unlock()
			return fmt.Errorf("model mismatch: expected %s, got %s (must start a new chat)", chat.Model, aiOpts.Model)
		}
		if chat.APIVersion != aiOpts.APIVersion {
			cs.lock.Unlock()
			return fmt.Errorf("API version mismatch: expected %s, got %s (must start a new chat)", chat.APIVersion, aiOpts.APIVersion)
		}
	}

	// Check for existing message with same ID (idempotency)
	messageId := message.GetMessageId()
	for i, existingMessage := range chat.NativeMessages {
		if existingMessage.GetMessageId() == messageId {
			// Replace existing message with same ID
			chat.NativeMessages[i] = message
			cs.lock.Unlock()
			// Persistence: Update in DB
			SaveMessageToDB(chatId, aiOpts, message)
			return nil
		}
	}

	// Append the new message if no duplicate found
	chat.NativeMessages = append(chat.NativeMessages, message)
	cs.lock.Unlock()

	// Persistence: Save to DB
	return SaveMessageToDB(chatId, aiOpts, message)
}

func (cs *ChatStore) RemoveMessage(chatId string, messageId string) bool {
	cs.lock.Lock()
	defer cs.lock.Unlock()

	chat := cs.chats[chatId]
	if chat == nil {
		return false
	}

	initialLen := len(chat.NativeMessages)
	chat.NativeMessages = slices.DeleteFunc(chat.NativeMessages, func(msg uctypes.GenAIMessage) bool {
		return msg.GetMessageId() == messageId
	})

	if len(chat.NativeMessages) < initialLen {
		// Persistence: Remove from DB
		DeleteMessageFromDB(chatId, messageId)
		return true
	}
	return false
}
func (cs *ChatStore) GetLastUserMessage(chatId string) uctypes.GenAIMessage {
	cs.lock.Lock()
	defer cs.lock.Unlock()

	chat := cs.chats[chatId]
	if chat == nil || len(chat.NativeMessages) == 0 {
		return nil
	}

	for i := len(chat.NativeMessages) - 1; i >= 0; i-- {
		if chat.NativeMessages[i].GetRole() == "user" {
			return chat.NativeMessages[i]
		}
	}
	return nil
}

func (cs *ChatStore) GetLastMessage(chatId string) uctypes.GenAIMessage {
	cs.lock.Lock()
	defer cs.lock.Unlock()

	chat := cs.chats[chatId]
	if chat == nil || len(chat.NativeMessages) == 0 {
		return nil
	}
	return chat.NativeMessages[len(chat.NativeMessages)-1]
}

func (cs *ChatStore) TrimMessagesAfter(chatId string, messageId string) {
	cs.lock.Lock()
	defer cs.lock.Unlock()

	chat := cs.chats[chatId]
	if chat == nil {
		return
	}

	foundIdx := -1
	for i, msg := range chat.NativeMessages {
		if msg.GetMessageId() == messageId {
			foundIdx = i
			break
		}
	}

	if foundIdx != -1 && foundIdx < len(chat.NativeMessages)-1 {
		chat.NativeMessages = chat.NativeMessages[:foundIdx+1]
		// Persistence: For simplicity in this implementation, we rely on the next PostMessage to resync DB
		// or we could implement a DeleteMessagesAfter in DB.
	}
}
