package bedrock

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/gulindev/gulin/pkg/gulinbase"
)

type AWSConnection struct {
	AccessKey string `json:"aws:accesskey"`
	SecretKey string `json:"aws:secretkey"`
	Region    string `json:"aws:region"`
}

func ReadAWSConnection(profileName string) (*AWSConnection, error) {
	if profileName == "" {
		profileName = "default"
	}
	
	configDir := gulinbase.GetGulinConfigDir()
	fullPath := filepath.Join(configDir, "aws-connections.json")
	
	data, err := os.ReadFile(fullPath)
	if err != nil {
		return nil, fmt.Errorf("aws-connections.json not found or empty (looked in %s): %v", fullPath, err)
	}

	var parsed map[string]AWSConnection
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, fmt.Errorf("error parsing aws-connections.json: %v", err)
	}

	conn, ok := parsed[profileName]
	if !ok {
		return nil, fmt.Errorf("profile %q not found in aws-connections.json", profileName)
	}

	if conn.Region == "" {
		conn.Region = "us-east-1"
	}

	return &conn, nil
}
