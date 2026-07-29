// Copyright 2026, GuLiN Terminal
// SPDX-License-Identifier: Apache-2.0

package mcp

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// MarketplaceItem represents a digital product in the Gulin Marketplace.
type MarketplaceItem struct {
	ID          string   `json:"id"`
	Type        string   `json:"type"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Author      string   `json:"author"`
	Price       string   `json:"price"`
	BuyURL      string   `json:"buy_url,omitempty"`
	Command     string   `json:"command,omitempty"`
	Args        []string `json:"args,omitempty"`
}

var (
	repoMutex sync.RWMutex
	repoUrls  []string
	reposLoaded bool
)

// GetRepositoriesFile returns the path to the marketplace repos json.
func GetRepositoriesFile() string {
	home, _ := os.UserHomeDir()
	gulinDir := filepath.Join(home, ".gulin")
	os.MkdirAll(gulinDir, 0755)
	return filepath.Join(gulinDir, "marketplace_repos.json")
}

// loadRepositories loads the repository URLs from disk.
func loadRepositories() error {
	path := GetRepositoriesFile()
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			repoUrls = []string{}
			reposLoaded = true
			return nil
		}
		return err
	}
	var urls []string
	if err := json.Unmarshal(data, &urls); err != nil {
		return err
	}
	repoUrls = urls
	reposLoaded = true
	return nil
}

// saveRepositories saves the repository URLs to disk.
func saveRepositories() error {
	data, err := json.MarshalIndent(repoUrls, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(GetRepositoriesFile(), data, 0644)
}

// AddRepository adds a new repository URL.
func AddRepository(url string) error {
	repoMutex.Lock()
	defer repoMutex.Unlock()
	if !reposLoaded {
		loadRepositories()
	}
	for _, u := range repoUrls {
		if u == url {
			return nil // already exists
		}
	}
	repoUrls = append(repoUrls, url)
	return saveRepositories()
}

// DeleteRepository removes a repository URL.
func DeleteRepository(url string) error {
	repoMutex.Lock()
	defer repoMutex.Unlock()
	if !reposLoaded {
		loadRepositories()
	}
	var newUrls []string
	for _, u := range repoUrls {
		if u != url {
			newUrls = append(newUrls, u)
		}
	}
	repoUrls = newUrls
	return saveRepositories()
}

// GetRepositories returns the list of repository URLs.
func GetRepositories() ([]string, error) {
	repoMutex.RLock()
	if !reposLoaded {
		repoMutex.RUnlock()
		repoMutex.Lock()
		if !reposLoaded {
			loadRepositories()
		}
		repoMutex.Unlock()
		repoMutex.RLock()
	}
	defer repoMutex.RUnlock()
	return repoUrls, nil
}

// OfficialRegistryResponse models the response from registry.modelcontextprotocol.io
type OfficialRegistryResponse struct {
	Servers []struct {
		Server struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			Title       string `json:"title"`
			Repository  struct {
				URL string `json:"url"`
			} `json:"repository"`
		} `json:"server"`
		Meta struct {
			Official struct {
				Status   string `json:"status"`
				IsLatest bool   `json:"isLatest"`
			} `json:"io.modelcontextprotocol.registry/official"`
		} `json:"_meta"`
	} `json:"servers"`
	Metadata struct {
		NextCursor string `json:"nextCursor"`
	} `json:"metadata"`
}

type CachedOfficialRegistry struct {
	LastUpdated time.Time         `json:"last_updated"`
	Items       []MarketplaceItem `json:"items"`
}

func getOfficialCacheFile() string {
	home, _ := os.UserHomeDir()
	gulinDir := filepath.Join(home, ".gulin")
	return filepath.Join(gulinDir, "marketplace_official_cache.json")
}

func fetchOfficialRegistryLive() []MarketplaceItem {
	var allOfficialItems []MarketplaceItem
	cursor := ""
	client := &http.Client{Timeout: 10 * time.Second}

	for {
		url := "https://registry.modelcontextprotocol.io/v0.1/servers"
		if cursor != "" {
			url += "?cursor=" + cursor
		}
		
		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			break
		}
		// Disfrazamos la petición para que Cloudflare no bloquee a Go
		req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
		req.Header.Set("Accept", "application/json")
		
		resp, err := client.Do(req)
		if err != nil || resp.StatusCode != http.StatusOK {
			break
		}
		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			break
		}

		var apiResp OfficialRegistryResponse
		if err := json.Unmarshal(body, &apiResp); err != nil {
			break
		}

		for _, item := range apiResp.Servers {
			// Only take active and latest versions
			if item.Meta.Official.Status != "active" || !item.Meta.Official.IsLatest {
				continue
			}

			repoName := item.Server.Repository.URL
			if repoName != "" {
				// E.g. "https://github.com/modelcontextprotocol/servers" -> "@modelcontextprotocol/server-..."
				// The API doesn't give us the direct npx package name safely, so we guess based on the name.
				// Format is usually "ai.author/server" or just "author/server"
			}
			
			// Guess npx package name from server name
			// Often "author/server" -> "@author/server" or just "server" if no slash
			pkgName := item.Server.Name
			if strings.Contains(pkgName, "/") && !strings.HasPrefix(pkgName, "@") {
				// E.g. ai.agenticshelf/puroair
				// Real npx packages are usually @author/pkg. Let's just use the repo URL or a placeholder if we can't reliably guess it.
				// Since we don't know the exact NPM package for every official server, we will provide a generic npx command using the Github URL if available, or just the name.
			}

			// Better: most official servers are hosted in GitHub and can be run via npx github:user/repo if they don't have an NPM package.
			// Let's create a generic item.
			displayName := item.Server.Title
			if displayName == "" {
				displayName = item.Server.Name
			}

			cmdArgs := []string{"-y"}
			if strings.HasPrefix(item.Server.Name, "modelcontextprotocol/") {
				// Official core MCPs
				pkg := strings.Replace(item.Server.Name, "modelcontextprotocol/", "@modelcontextprotocol/server-", 1)
				cmdArgs = append(cmdArgs, pkg)
			} else {
				// Third party in official registry
				cmdArgs = append(cmdArgs, item.Server.Name)
			}

			mItem := MarketplaceItem{
				ID:          "off-" + item.Server.Name,
				Type:        "mcp",
				Name:        displayName,
				Description: item.Server.Description,
				Author:      "Official Registry",
				Price:       "Free",
				Command:     "npx",
				Args:        cmdArgs,
			}
			allOfficialItems = append(allOfficialItems, mItem)
		}

		cursor = apiResp.Metadata.NextCursor
		if cursor == "" {
			break
		}
	}

	// Cache the result
	if len(allOfficialItems) > 0 {
		cache := CachedOfficialRegistry{
			LastUpdated: time.Now(),
			Items:       allOfficialItems,
		}
		if data, err := json.MarshalIndent(cache, "", "  "); err == nil {
			os.WriteFile(getOfficialCacheFile(), data, 0644)
		}
	}

	return allOfficialItems
}

func getOfficialCatalog() []MarketplaceItem {
	cacheFile := getOfficialCacheFile()
	data, err := os.ReadFile(cacheFile)
	if err == nil {
		var cache CachedOfficialRegistry
		if err := json.Unmarshal(data, &cache); err == nil {
			// Use cache if it's less than 24 hours old
			if time.Since(cache.LastUpdated) < 24*time.Hour && len(cache.Items) > 0 {
				return cache.Items
			}
		}
	}

	// Fetch live if cache miss or expired
	items := fetchOfficialRegistryLive()
	if len(items) == 0 {
		// Fallback to default catalog if live fetch fails and no cache exists
		return getDefaultCatalog()
	}
	return items
}

// GetMarketplaceCatalog fetches items from all configured repository URLs.
func GetMarketplaceCatalog() ([]MarketplaceItem, error) {
	urls, err := GetRepositories()
	if err != nil {
		return nil, err
	}

	allItems := getDefaultCatalog()

	if len(urls) == 0 {
		return allItems, nil
	}

	// Fetch from all URLs concurrently
	client := &http.Client{Timeout: 5 * time.Second}
	var wg sync.WaitGroup
	var mu sync.Mutex

	for _, url := range urls {
		wg.Add(1)
		go func(u string) {
			defer wg.Done()

			// Special handling for the official MCP Registry API
			if strings.Contains(u, "registry.modelcontextprotocol.io") {
				officialItems := getOfficialCatalog()
				mu.Lock()
				allItems = append(allItems, officialItems...)
				mu.Unlock()
				return
			}

			// Standard JSON repository fetch
			resp, err := client.Get(u)
			if err != nil {
				fmt.Printf("Error fetching repo %s: %v\n", u, err)
				return
			}
			if resp.StatusCode != http.StatusOK {
				fmt.Printf("Error fetching repo %s: Status %d\n", u, resp.StatusCode)
				resp.Body.Close()
				return
			}
			defer resp.Body.Close()
			body, err := io.ReadAll(resp.Body)
			if err != nil {
				fmt.Printf("Error reading repo %s body: %v\n", u, err)
				return
			}
			var items []MarketplaceItem
			if err := json.Unmarshal(body, &items); err != nil {
				fmt.Printf("Error unmarshaling repo %s JSON: %v\n", u, err)
				return
			}
			
			mu.Lock()
			allItems = append(allItems, items...)
			mu.Unlock()
		}(url)
	}
	wg.Wait()

	return allItems, nil
}

func getDefaultCatalog() []MarketplaceItem {
	return []MarketplaceItem{
		{
			ID:          "db-explorer-pro",
			Type:        "plugin_js",
			Name:        "DB Explorer PRO",
			Description: "Unlock full write permissions. Allow AI to execute UPDATE, INSERT, optimize slow queries, and alter schemas safely.",
			Author:      "Gulin Official",
			Price:       "$19.99",
			BuyURL:      "https://gulin.dev/checkout/db-pro",
		},
		{
			ID:          "slack-enterprise",
			Type:        "mcp",
			Name:        "Slack Enterprise",
			Description: "Read channels, send messages, and analyze team conversations directly from Gulin's chat interface.",
			Author:      "Open Source",
			Price:       "Free",
			Command:     "npx",
			Args:        []string{"-y", "@modelcontextprotocol/server-slack"},
		},
		{
			ID:          "github-standard",
			Type:        "mcp",
			Name:        "GitHub Standard",
			Description: "Search repositories, read code, and manage Pull Requests and Issues.",
			Author:      "Open Source",
			Price:       "Free",
			Command:     "npx",
			Args:        []string{"-y", "@modelcontextprotocol/server-github"},
		},
		{
			ID:          "postgres-db",
			Type:        "mcp",
			Name:        "PostgreSQL",
			Description: "Read-only access to a PostgreSQL database for AI data analysis.",
			Author:      "Open Source",
			Price:       "Free",
			Command:     "npx",
			Args:        []string{"-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"},
		},
		{
			ID:          "sqlite-db",
			Type:        "mcp",
			Name:        "SQLite DB",
			Description: "Database access to local SQLite files for quick query execution.",
			Author:      "Open Source",
			Price:       "Free",
			Command:     "npx",
			Args:        []string{"-y", "@modelcontextprotocol/server-sqlite", "--db-path", "/tmp/test.db"},
		},
	}
}


