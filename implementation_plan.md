# Cross-Provider Model Switching

## Problem
Currently, `gulin-term` throws errors like `API type mismatch` or `expected StoredChatMessage, got *gemini.GeminiChatMessage` when a user tries to switch the AI model provider mid-conversation (e.g., from `google-gemini` to `openai-chat`).

## Proposed Changes

1. **Modify `uctypes.AreAPITypesCompatible` and `AreModelsCompatible`**
   - Update these functions in `pkg/aiusechat/uctypes/uctypes.go` to always return `true`. This removes the hard block on changing providers mid-chat.

2. **Remove Strict Backend Checks**
   - Remove the `chat.APIType != chatOpts.Config.APIType` and `chat.Model != chatOpts.Config.Model` checks in all backends (`RunGeminiChatStep`, `RunChatStep`, `RunAnthropicChatStep`, `RunBedrockChatStep`, `RunPlaiChatStep`).

3. **Implement Universal Message Converter (`uctypes.ConvertToGenericAIMessage`)**
   - Add a function to `uctypes.go` that can gracefully convert any `GenAIMessage` into a standard `*uctypes.AIMessage` using `GetRole()` and `GetContent()`.
   - Update the role mapping to correctly handle `model` -> `assistant` mapping so bot messages don't turn into user messages.

4. **Update Backend Converters to use Universal Fallback**
   - Update `ConvertAIMessageToGeminiChatMessage`, `ConvertAIMessageToOpenAIChatMessage`, etc. to support converting bot messages (currently they hardcode `Role: "user"`).
   - Update the iterators in the backends (e.g., `for _, genMsg := range chat.NativeMessages`) to fallback to `ConvertToGenericAIMessage(genMsg)` when encountering a foreign native message type.
   - Apply the same fallback logic in `ConvertAIChatToUIChat` implementations so the frontend can properly render cross-provider history.

## Open Questions
- The conversion to generic `AIMessage` will strip out native tool call details (e.g., intermediate tool-use blocks) for foreign messages, collapsing them into text. Is this acceptable for history? (Yes, typically only the final text matters when continuing a conversation with a new model).
