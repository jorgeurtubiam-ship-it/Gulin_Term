// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type GulinBridgeModel struct {
	ID           string   `json:"id"`
	Provider     string   `json:"provider"`
	Name         string   `json:"name"`
	Available    bool            `json:"available"`
	Capabilities map[string]bool `json:"capabilities,omitempty"`
}

type GulinBridgeLoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type GulinBridgeLoginResponse struct {
	Token string `json:"token"`
}

type GulinBridgeRegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type GulinBridgeRegisterResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
}

type GulinBridgeKeyResponse struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Key       string `json:"key"`
	CreatedAt string `json:"created_at"`
}

type GulinBridgeCreateKeyRequest struct {
	Name string `json:"name"`
}

type GulinBridgeDashboardResponse struct {
	Balance float64                `json:"balance"`
	ApiKeys []GulinBridgeKeyResponse `json:"apiKeys"`
}

type OpenAIModel struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	OwnedBy string `json:"owned_by"`
}

type OpenAIModelsResponse struct {
	Object string        `json:"object"`
	Data   []OpenAIModel `json:"data"`
}

type GulinBridgeClient struct {
	BaseURL string
	Client  *http.Client
}

func NewGulinBridgeClient(baseURL string) *GulinBridgeClient {
	// Limpiar la URL base para evitar dobles barras al concatenar endpoints
	baseURL = strings.TrimRight(baseURL, "/")
	return &GulinBridgeClient{
		BaseURL: baseURL,
		Client: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

func (c *GulinBridgeClient) Login(email, password string) (string, error) {
	url := fmt.Sprintf("%s/api/auth/login", c.BaseURL)
	reqBody, _ := json.Marshal(GulinBridgeLoginRequest{
		Email:    email,
		Password: password,
	})

	resp, err := c.Client.Post(url, "application/json", bytes.NewBuffer(reqBody))
	if err != nil {
		return "", fmt.Errorf("error al conectar con Gulin Bridge: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("error de login en Gulin Bridge: %s", resp.Status)
	}

	var loginResp GulinBridgeLoginResponse
	if err := json.NewDecoder(resp.Body).Decode(&loginResp); err != nil {
		return "", fmt.Errorf("error al decodificar respuesta de login: %w", err)
	}

	return loginResp.Token, nil
}

func (c *GulinBridgeClient) Register(email, password string) error {
	url := fmt.Sprintf("%s/api/auth/register", c.BaseURL)
	reqBody, _ := json.Marshal(GulinBridgeRegisterRequest{
		Email:    email,
		Password: password,
	})

	resp, err := c.Client.Post(url, "application/json", bytes.NewBuffer(reqBody))
	if err != nil {
		return fmt.Errorf("error al conectar con Gulin Bridge (registro): %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("error de registro en Gulin Bridge: %s", resp.Status)
	}

	return nil
}

func (c *GulinBridgeClient) DiscoverModels(token string) ([]GulinBridgeModel, error) {
	url := fmt.Sprintf("%s/api/admin/discover-models", c.BaseURL)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("error al crear petición de descubrimiento: %w", err)
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	resp, err := c.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("error al realizar petición de descubrimiento: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("error al descubrir modelos en Gulin Bridge (Admin): %s", resp.Status)
	}

	var models []GulinBridgeModel
	if err := json.NewDecoder(resp.Body).Decode(&models); err != nil {
		return nil, fmt.Errorf("error al decodificar modelos descubiertos: %w", err)
	}

	return models, nil
}

func (c *GulinBridgeClient) DiscoverModelsByProxy(token string) ([]GulinBridgeModel, error) {
	url := fmt.Sprintf("%s/v1/models", c.BaseURL)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("error al crear petición de proxy de modelos: %w", err)
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	resp, err := c.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("error al realizar petición de proxy de modelos: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("error al descubrir modelos vía Proxy: %s", resp.Status)
	}

	var openAIResp OpenAIModelsResponse
	if err := json.NewDecoder(resp.Body).Decode(&openAIResp); err != nil {
		return nil, fmt.Errorf("error al decodificar modelos vía Proxy: %w", err)
	}

	// Convertir formato OpenAI al formato interno GulinBridgeModel
	var models []GulinBridgeModel
	for _, m := range openAIResp.Data {
		models = append(models, GulinBridgeModel{
			ID:        m.ID,
			Provider:  m.OwnedBy, // En el Bridge, owned_by suele contener el proveedor (openai, anthropic, etc.)
			Name:      m.ID,      // Usamos el ID como nombre si no hay otro
			Available: true,
		})
	}

	return models, nil
}

func (c *GulinBridgeClient) CreateAPIKey(token string, name string) (*GulinBridgeKeyResponse, error) {
	url := fmt.Sprintf("%s/api/user/keys", c.BaseURL)
	reqBody, _ := json.Marshal(GulinBridgeCreateKeyRequest{Name: name})
	
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(reqBody))
	if err != nil {
		return nil, fmt.Errorf("error al crear petición de creación de llave: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))

	resp, err := c.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("error al realizar petición de creación de llave: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("error al crear llave en Gulin Bridge: %s", resp.Status)
	}

	var keyResp GulinBridgeKeyResponse
	if err := json.NewDecoder(resp.Body).Decode(&keyResp); err != nil {
		return nil, fmt.Errorf("error al decodificar respuesta de creación de llave: %w", err)
	}

	return &keyResp, nil
}

func (c *GulinBridgeClient) GetDashboardData(token string) (*GulinBridgeDashboardResponse, error) {
	url := fmt.Sprintf("%s/api/user/dashboard", c.BaseURL)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("error al crear petición de dashboard: %w", err)
	}
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))

	resp, err := c.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("error al realizar petición de dashboard: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("error al obtener dashboard en Gulin Bridge: %s", resp.Status)
	}

	var dashboardResp GulinBridgeDashboardResponse
	if err := json.NewDecoder(resp.Body).Decode(&dashboardResp); err != nil {
		return nil, fmt.Errorf("error al decodificar respuesta de dashboard: %w", err)
	}

	return &dashboardResp, nil
}
