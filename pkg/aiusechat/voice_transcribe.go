// Copyright 2026, GuLiN Terminal
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gulindev/gulin/pkg/secretstore"
)

type VoiceTranscribeRequest struct {
	AudioBase64 string `json:"audioBase64"`
	MimeType    string `json:"mimeType"`
	Model       string `json:"model,omitempty"`
	ApiKey      string `json:"apiKey,omitempty"`
}

type VoiceTranscribeResponse struct {
	Success    bool   `json:"success"`
	Transcript string `json:"transcript"`
	Error      string `json:"error,omitempty"`
}

// GulinAIVoiceTranscribeHandler maneja la transcripción de audio usando Google Gemini Flash Lite y GOOGLE_AI_KEY
func GulinAIVoiceTranscribeHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req VoiceTranscribeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(VoiceTranscribeResponse{
			Success: false,
			Error:   "Error decodificando payload JSON: " + err.Error(),
		})
		return
	}

	if req.AudioBase64 == "" {
		json.NewEncoder(w).Encode(VoiceTranscribeResponse{
			Success: false,
			Error:   "audioBase64 es requerido",
		})
		return
	}

	// 1. Clave pasada directamente en la petición
	apiKey := strings.TrimSpace(req.ApiKey)
	if apiKey == "" {
		// 2. Clave descubierta desde SecretStore, variables de entorno o archivos gulinai.json
		apiKey = findGoogleApiKey()
	} else {
		_ = secretstore.SetSecret("GOOGLE_AI_KEY", apiKey)
	}

	if apiKey == "" {
		json.NewEncoder(w).Encode(VoiceTranscribeResponse{
			Success: false,
			Error:   "GOOGLE_AI_KEY no encontrada. Por favor asegúrate de tenerla en gulinai.json o ejecuta: wsh secret set GOOGLE_AI_KEY",
		})
		return
	}

	mimeType := req.MimeType
	if mimeType == "" {
		mimeType = "audio/webm"
	}

	modelsToTry := []string{
		"gemini-3.1-flash-lite",
		"gemini-2.5-flash",
		"gemini-2.5-flash-lite",
		"gemini-1.5-flash",
		"gemini-flash-latest",
	}
	if req.Model != "" && req.Model != "gemini-2.0-flash-lite" {
		modelsToTry = append([]string{req.Model}, modelsToTry...)
	}

	var lastErr error
	var transcript string
	for _, m := range modelsToTry {
		t, err := transcribeAudioWithGemini(apiKey, m, req.AudioBase64, mimeType)
		if err == nil && t != "" {
			transcript = t
			break
		}
		lastErr = err
	}

	if transcript == "" {
		errMsg := "Error transcribiendo audio con Google"
		if lastErr != nil {
			errMsg += ": " + lastErr.Error()
		}
		json.NewEncoder(w).Encode(VoiceTranscribeResponse{
			Success: false,
			Error:   errMsg,
		})
		return
	}

	json.NewEncoder(w).Encode(VoiceTranscribeResponse{
		Success:    true,
		Transcript: transcript,
	})
}

func findGoogleApiKey() string {
	// 1. SecretStore
	if key, exists, _ := secretstore.GetSecret("GOOGLE_AI_KEY"); exists && key != "" {
		return key
	}
	if key, exists, _ := secretstore.GetSecret("GEMINI_API_KEY"); exists && key != "" {
		return key
	}
	if key, exists, _ := secretstore.GetSecret("GOOGLE_APIKEY"); exists && key != "" {
		return key
	}

	// 2. Variables de entorno
	for _, envVar := range []string{"GOOGLE_AI_KEY", "GEMINI_API_KEY", "GOOGLE_APIKEY", "GOOGLE_MASTER_KEY"} {
		if val := os.Getenv(envVar); val != "" {
			_ = secretstore.SetSecret("GOOGLE_AI_KEY", val)
			return val
		}
	}

	// 3. Buscar en archivos gulinai.json conocidos
	homeDir, _ := os.UserHomeDir()
	candidatePaths := []string{
		filepath.Join(homeDir, "Gulin_Workspace", "config", "gulinai.json"),
		filepath.Join(homeDir, ".gulin", "gulinai.json"),
		filepath.Join(homeDir, ".config", "gulin", "gulinai.json"),
	}

	for _, path := range candidatePaths {
		if content, err := os.ReadFile(path); err == nil {
			var configMap map[string]map[string]interface{}
			if err := json.Unmarshal(content, &configMap); err == nil {
				for key, val := range configMap {
					provider, _ := val["ai:provider"].(string)
					token, _ := val["ai:apitoken"].(string)
					if (provider == "google" || strings.Contains(key, "gemini")) && token != "" {
						_ = secretstore.SetSecret("GOOGLE_AI_KEY", token)
						return token
					}
				}
			}
		}
	}

	return ""
}

func transcribeAudioWithGemini(apiKey, model, audioBase64, mimeType string) (string, error) {
	endpoint := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent", model)

	payload := map[string]interface{}{
		"contents": []map[string]interface{}{
			{
				"parts": []map[string]interface{}{
					{
						"inlineData": map[string]string{
							"mimeType": mimeType,
							"data":     audioBase64,
						},
					},
					{
						"text": "Transcribe this user speech audio verbatim in its original language. Return ONLY the plain transcribed text without quotation marks, markdown formatting, introductory greetings, or commentary.",
					},
				},
			},
		},
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	httpReq, err := http.NewRequest("POST", endpoint, bytes.NewBuffer(bodyBytes))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-goog-api-key", apiKey)

	resp, err := client.Do(httpReq)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Google API status %d: %s", resp.StatusCode, string(respBytes))
	}

	var geminiResp struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}

	if err := json.Unmarshal(respBytes, &geminiResp); err != nil {
		return "", err
	}

	if len(geminiResp.Candidates) == 0 || len(geminiResp.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("no se recibió transcripción de Google Gemini")
	}

	resultText := strings.TrimSpace(geminiResp.Candidates[0].Content.Parts[0].Text)
	return resultText, nil
}
