package aiusechat

import (
	"context"
	"encoding/json"
	"io/ioutil"
	"os"
	"path/filepath"
	"strings"

	"github.com/gulindev/gulin/pkg/aiusechat/mcp"
	"github.com/gulindev/gulin/pkg/aiusechat/uctypes"
	"github.com/gulindev/gulin/pkg/gulinbase"
	"github.com/gulindev/gulin/pkg/wshrpc"
)

func GetAllToolsAdmin(ctx context.Context) ([]wshrpc.ToolInfo, error) {
	var allTools []wshrpc.ToolInfo
	dummyTabId := ""
	
	var defs []uctypes.ToolDefinition
	defs = append(defs, GetTermGetScrollbackToolDefinition(dummyTabId))
	defs = append(defs, GetTermRunCommandToolDefinition(dummyTabId))
	defs = append(defs, GetTermSearchToolDefinition(dummyTabId))
	defs = append(defs, GetTermCommandOutputToolDefinition(dummyTabId))

	// Plugin Tools
	defs = append(defs, GetPluginSaveToolDefinition())
	defs = append(defs, GetPluginListToolDefinition())
	defs = append(defs, GetPluginDeleteToolDefinition())
	defs = append(defs, GetPluginDebugToolDefinition())

	// Read config if we have overrides for integration
	for _, d := range defs {
		allTools = append(allTools, wshrpc.ToolInfo{
			Name:        d.Name,
			Type:        "built-in",
			Integration: "background", // default or load from config
			Description: d.Description,
			Code:        "",
		})
	}

	// Read dynamic plugins
	pluginsDir := gulinbase.GetConfiguredPluginsDir()
	files, err := os.ReadDir(pluginsDir)
	if err == nil {
		for _, f := range files {
			if !f.IsDir() && strings.HasSuffix(f.Name(), ".js") {
				path := filepath.Join(pluginsDir, f.Name())
				codeBytes, err := ioutil.ReadFile(path)
				if err == nil {
					name := strings.TrimSuffix(f.Name(), ".js")
					
					// basic parse to get description
					desc := "Dynamic Javascript Plugin"
					lines := strings.Split(string(codeBytes), "\n")
					for _, line := range lines {
						if strings.HasPrefix(strings.TrimSpace(line), "//@description") {
							desc = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "//@description"))
							break
						}
					}

					allTools = append(allTools, wshrpc.ToolInfo{
						Name:        name,
						Type:        "dynamic",
						Integration: "background",
						Description: desc,
						Code:        string(codeBytes),
					})
				}
			}
		}
	}

	// Read MCP server configs — ~/.gulin/mcp/*.json
	mcpServers, err := mcp.LoadMCPServers()
	if err == nil {
		for _, srv := range mcpServers {
			rawBytes, _ := json.MarshalIndent(srv, "", "  ")
			allTools = append(allTools, wshrpc.ToolInfo{
				Name:        srv.Name,
				Type:        "mcp",
				Integration: "background",
				Description: srv.Description,
				Code:        string(rawBytes),
			})
		}
	}

	return allTools, nil
}

func SaveToolAdmin(ctx context.Context, tool wshrpc.ToolInfo) error {
	if tool.Type == "dynamic" {
		pluginsDir := gulinbase.GetConfiguredPluginsDir()
		os.MkdirAll(pluginsDir, 0755)
		
		filename := tool.Name
		if !strings.HasSuffix(filename, ".js") {
			filename += ".js"
		}
		path := filepath.Join(pluginsDir, filename)
		return os.WriteFile(path, []byte(tool.Code), 0644)
	}

	// For built-in tools, we just save the integration override to tools_config.json
	// TODO: Implement actual tools_config.json saving here
	return nil
}

func DeleteToolAdmin(ctx context.Context, name string) error {
	pluginsDir := gulinbase.GetConfiguredPluginsDir()
	
	filename := name
	if !strings.HasSuffix(filename, ".js") {
		filename += ".js"
	}
	path := filepath.Join(pluginsDir, filename)
	
	// Only delete if it exists
	if _, err := os.Stat(path); err == nil {
		return os.Remove(path)
	}
	return nil
}
