import React, { useState, useEffect } from "react";
import { FullBlockProps } from "@/app/block/blocktypes";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { RpcApi } from "@/app/store/wshclientapi";

// ─── Types ────────────────────────────────────────────────────────────────────

type MCPMarketplaceItem = {
    id: string;
    type: string;
    name: string;
    description: string;
    author: string;
    price: string;
    buy_url?: string;
    command?: string;
    args?: string[];
};

type MCPServerInfo = {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    description?: string;
    status?: string;
    toolcount?: number;
    errormsg?: string;
};

type MCPToolInfo = {
    name: string;
    description?: string;
};

// ─── MCP Panel ────────────────────────────────────────────────────────────────

const MCPPanel = React.memo(() => {
    const [servers, setServers] = useState<MCPServerInfo[]>([]);
    const [selected, setSelected] = useState<MCPServerInfo | null>(null);
    const [detailTab, setDetailTab] = useState<"config" | "tools">("config");
    const [tools, setTools] = useState<MCPToolInfo[]>([]);
    const [testing, setTesting] = useState(false);
    const [testError, setTestError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [installingId, setInstallingId] = useState<string | null>(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [showCustomForm, setShowCustomForm] = useState(false);
    const [marketplaceItems, setMarketplaceItems] = useState<MCPMarketplaceItem[]>([]);
    const [repoMode, setRepoMode] = useState(false);
    const [repoUrls, setRepoUrls] = useState<string[]>([]);
    const [newRepoUrl, setNewRepoUrl] = useState("");
    const [newServer, setNewServer] = useState<MCPServerInfo>({ name: "", command: "npx", args: [], env: {} });
    const [newArgsStr, setNewArgsStr] = useState("");
    const [statusMap, setStatusMap] = useState<Record<string, { status: string; toolcount?: number }>>({});

    const loadServers = async () => {
        try {
            const list = await RpcApi.MCPListCommand(TabRpcClient);
            setServers(list || []);
        } catch (err) {
            console.error("MCP list failed", err);
        }
    };

    const loadMarketplace = async () => {
        try {
            const items = await RpcApi.MCPMarketplaceCatalogCommand(TabRpcClient);
            setMarketplaceItems(items || []);
        } catch (err) {
            console.error("Marketplace fetch failed", err);
        }
    };

    const loadRepos = async () => {
        try {
            const urls = await RpcApi.MCPMarketplaceGetReposCommand(TabRpcClient);
            setRepoUrls(urls || []);
        } catch (err) {
            console.error("Repo fetch failed", err);
        }
    };

    const handleAddRepo = async () => {
        if (!newRepoUrl) return;
        setSaving(true);
        try {
            await RpcApi.MCPMarketplaceAddCommand(TabRpcClient, newRepoUrl.trim());
            setNewRepoUrl("");
            await loadRepos();
            await loadMarketplace();
        } catch (err) {
            console.error("Add repo failed", err);
        } finally {
            setSaving(false);
        }
    };

    const handleInstallMarketplaceItem = async (item: MCPMarketplaceItem) => {
        if (!item.command) {
            alert(`Item ${item.name} cannot be installed automatically because it has no command specified.`);
            return;
        }
        
        setInstallingId(item.id);
        try {
            // Save it to the user's config
            const serverConfig = {
                name: item.name.replace(/[^a-zA-Z0-9_-]/g, ""), // Sanitize name
                command: item.command,
                args: item.args || [],
                env: {},
                description: item.description
            };
            
            await RpcApi.MCPAddCommand(TabRpcClient, serverConfig);
            
            // Reload sidebar
            await loadServers();
            
            // Close marketplace, open detail view, and select it
            setShowAddForm(false);
            setSelected(serverConfig);
            
            // Auto test to prove it's operational
            handleTest(serverConfig);
            
        } catch (err) {
            console.error("Install item failed", err);
            alert("Failed to install " + item.name);
        } finally {
            setInstallingId(null);
        }
    };

    const handleDeleteRepo = async (url: string) => {
        if (!confirm(`Are you sure you want to delete repository:\n${url}?`)) return;
        try {
            await RpcApi.MCPMarketplaceDeleteCommand(TabRpcClient, url);
            await loadRepos();
            await loadMarketplace();
        } catch (err) {
            console.error("Delete repo failed", err);
        }
    };

    const handleValidateRepo = async () => {
        if (!newRepoUrl) return;
        setSaving(true);
        try {
            const res = await fetch(newRepoUrl);
            if (!res.ok) {
                alert(`Validation Failed: Server returned status ${res.status}`);
                return;
            }
            const data = await res.json();
            
            // Allow generic JSON arrays
            if (Array.isArray(data)) {
                alert(`✅ Validation Successful!\nFound ${data.length} items in the repository.`);
                return;
            }
            
            // Allow Official MCP Registry format
            if (data && data.servers && Array.isArray(data.servers)) {
                alert(`✅ Validation Successful!\nOfficial MCP Registry detected with ${data.servers.length} items on this page.`);
                return;
            }

            alert("Validation Failed: The repository must contain a JSON array of items or match the official API schema.");
        } catch (err) {
            console.error("Validation error", err);
            alert("Validation Failed: Could not fetch the URL or parse the JSON.");
        } finally {
            setSaving(false);
        }
    };

    useEffect(() => {
        loadServers();
        loadMarketplace();
        loadRepos();
    }, []);

    const handleTest = async (srv: MCPServerInfo) => {
        setTesting(true);
        setTestError(null);
        setTools([]);
        setDetailTab("tools");
        try {
            const result = await RpcApi.MCPTestCommand(TabRpcClient, srv.name);
            setTools(result || []);
            setStatusMap(prev => ({ ...prev, [srv.name]: { status: "ok", toolcount: result?.length || 0 } }));
        } catch (err: any) {
            setTestError(err?.message || String(err));
            setStatusMap(prev => ({ ...prev, [srv.name]: { status: "error" } }));
        } finally {
            setTesting(false);
        }
    };

    const handleDelete = async (name: string) => {
        if (!confirm(`Delete MCP server "${name}"?`)) return;
        try {
            await RpcApi.MCPDeleteCommand(TabRpcClient, name);
            setSelected(null);
            loadServers();
        } catch (err) {
            console.error("MCP delete failed", err);
        }
    };

    const handleAdd = async () => {
        if (!newServer.name || !newServer.command) return;
        setSaving(true);
        try {
            const args = newArgsStr
                .split(" ")
                .map(s => s.trim())
                .filter(Boolean);
            await RpcApi.MCPAddCommand(TabRpcClient, { ...newServer, args });
            setShowAddForm(false);
            setNewServer({ name: "", command: "npx", args: [], env: {} });
            setNewArgsStr("");
            loadServers();
        } catch (err) {
            console.error("MCP add failed", err);
        } finally {
            setSaving(false);
        }
    };

    const statusIcon = (name: string) => {
        const s = statusMap[name];
        if (!s) return <span className="text-xs text-gray-500">⭕</span>;
        if (s.status === "ok") return <span className="text-xs text-green-400">🟢</span>;
        return <span className="text-xs text-red-400">🔴</span>;
    };

    return (
        <div className="flex h-full w-full text-white bg-gray-900">
            {/* Sidebar */}
                <div className="w-1/3 border-r border-gray-700 flex flex-col h-full">
                    <div className="p-4 pb-0">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-lg">MCP Servers</h3>
                            <button 
                                onClick={() => { setShowAddForm(true); setShowCustomForm(true); setSelected(null); }}
                                className="text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-md border border-gray-700 transition-colors shadow-sm"
                            >
                                + Add
                            </button>
                        </div>
                        <div className="flex bg-gray-900 p-1 rounded-lg mb-4 border border-gray-700">
                            <button
                                onClick={() => { setShowAddForm(false); setDetailTab("config"); }}
                                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${!showAddForm ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                            >
                                Installed
                            </button>
                            <button
                                onClick={() => { setShowAddForm(true); setShowCustomForm(false); }}
                                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center justify-center gap-2 ${showAddForm ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                            >
                                🌐 Marketplace
                            </button>
                        </div>
                    </div>

                    {!showAddForm && (
                        <div className="flex-grow overflow-y-auto p-4 pt-0">
                            {servers.length === 0 ? (
                                <div className="text-gray-500 text-sm mt-4 text-center p-4 bg-gray-900 rounded-lg border border-gray-800">
                                    No MCP servers installed yet.<br /><br />
                                    Go to the <strong>Marketplace</strong> to install new integrations.
                                </div>
                            ) : (
                                <ul className="space-y-2">
                                    {servers.map(srv => (
                                        <li
                                            key={srv.name}
                                            onClick={() => { setSelected(srv); setDetailTab("config"); setTools([]); setTestError(null); }}
                                            className={`p-3 rounded-lg cursor-pointer border transition-all ${selected?.name === srv.name ? "border-blue-500 bg-gray-800 shadow-sm" : "border-gray-800 bg-gray-900/50 hover:bg-gray-800 hover:border-gray-700"}`}
                                        >
                                            <div className="flex items-center gap-2">
                                                {statusIcon(srv.name)}
                                                <span className="font-semibold text-gray-200">{srv.name}</span>
                                            </div>
                                            <div className="text-xs text-gray-400 mt-1 truncate font-mono bg-black/20 p-1 rounded">
                                                {srv.command} {srv.args?.join(" ")}
                                            </div>
                                            {statusMap[srv.name]?.toolcount !== undefined && (
                                                <div className="text-xs font-medium text-green-400 mt-1.5 flex items-center gap-1">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
                                                    {statusMap[srv.name].toolcount} tools available
                                                </div>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>

            {/* Detail panel */}
            <div className="w-2/3 h-full p-6 flex flex-col overflow-y-auto bg-gray-900">
                {/* Add form */}
                {/* Marketplace View */}
                {/* Marketplace View */}
                {showAddForm && !showCustomForm && (
                    <div className="flex flex-col h-full fade-in">
                        <div className="flex justify-between items-end border-b border-gray-700 pb-4 mb-6">
                            <div>
                                <h2 className="text-2xl font-bold text-left text-white flex items-center gap-2">
                                    Marketplace
                                </h2>
                                <p className="text-gray-400 text-sm mt-1">Discover and install superpowers for Gulin.</p>
                            </div>
                            <div className="flex items-center gap-4">
                                <button 
                                    onClick={() => setRepoMode(!repoMode)}
                                    className={`text-xs font-bold px-4 py-2 rounded-lg border transition-all ${repoMode ? 'bg-blue-900/40 text-blue-400 border-blue-700/50 shadow-inner' : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700 shadow-lg'}`}
                                >
                                    ⚙️ Manage Repositories
                                </button>
                                <button 
                                    onClick={() => setShowCustomForm(true)}
                                    className="text-xs text-gray-500 hover:text-gray-300 font-mono underline decoration-gray-700 underline-offset-4"
                                >
                                    🛠️ Advanced Custom Server
                                </button>
                            </div>
                        </div>

                        {repoMode ? (
                            <div className="flex-grow overflow-y-auto pb-10">
                                <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 mb-6">
                                    <h3 className="text-lg font-bold text-white mb-2">Repository Sources</h3>
                                    <p className="text-sm text-gray-400 mb-4">Add a URL to a JSON repository to discover new tools. Gulin will automatically fetch and combine all available MCPs from these sources.</p>
                                    
                                    <div className="flex gap-2 mb-6">
                                        <input 
                                            className="flex-grow bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white font-mono text-sm focus:border-blue-500 outline-none"
                                            placeholder="https://raw.githubusercontent.com/.../catalog.json"
                                            value={newRepoUrl}
                                            onChange={(e) => setNewRepoUrl(e.target.value)}
                                        />
                                        <button 
                                            onClick={handleValidateRepo}
                                            disabled={saving || !newRepoUrl}
                                            className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-lg shadow-lg border border-gray-600"
                                        >
                                            Validate
                                        </button>
                                        <button 
                                            onClick={handleAddRepo}
                                            disabled={saving || !newRepoUrl}
                                            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold px-6 py-2 rounded-lg shadow-lg"
                                        >
                                            {saving ? "Adding..." : "Add Repo"}
                                        </button>
                                    </div>

                                    <ul className="space-y-3">
                                        {repoUrls.length === 0 ? (
                                            <li className="text-center text-sm text-gray-500 py-4 bg-gray-900/50 rounded-lg border border-gray-800">
                                                No extra repositories added. Showing default Gulin catalog.
                                            </li>
                                        ) : repoUrls.map((url, idx) => (
                                            <li key={idx} className="flex justify-between items-center bg-gray-900 border border-gray-700 rounded-lg p-3">
                                                <span className="text-sm font-mono text-blue-300 truncate">{url}</span>
                                                <button 
                                                    onClick={() => handleDeleteRepo(url)}
                                                    className="text-red-400 hover:text-red-300 hover:bg-red-900/30 p-2 rounded-lg transition-colors"
                                                    title="Remove Repository"
                                                >
                                                    🗑️
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 overflow-y-auto pb-10">
                                {marketplaceItems.map(item => {
                                    let badgeColor = "bg-blue-600/90 text-white border-blue-400/30";
                                    let badgeText = "MCP SERVER";
                                    let icon = "💬";
                                    
                                    if (item.type === "plugin_js") {
                                        badgeColor = "bg-purple-600/90 text-white border-purple-400/30";
                                        badgeText = "GULIN PLUGIN";
                                        icon = "⚡";
                                    } else if (item.type === "skill") {
                                        badgeColor = "bg-orange-500/90 text-white border-orange-400/30";
                                        badgeText = "SKILL";
                                        icon = "🧠";
                                    } else if (item.type === "persona") {
                                        badgeColor = "bg-pink-600/90 text-white border-pink-400/30";
                                        badgeText = "PERSONA";
                                        icon = "🎭";
                                    } else if (item.type === "rag_database") {
                                        badgeColor = "bg-teal-600/90 text-white border-teal-400/30";
                                        badgeText = "KNOWLEDGE";
                                        icon = "📚";
                                    }

                                    return (
                                        <div key={item.id} className="relative flex flex-col bg-gray-800/40 hover:bg-gray-800/80 backdrop-blur-sm border border-gray-700 hover:border-gray-500 rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-900/20 group">
                                            {/* Top Row: Icon + Texts */}
                                            <div className="flex items-start gap-4 mb-4">
                                                <div className="flex-shrink-0 w-14 h-14 rounded-xl bg-gray-900 border border-gray-700 flex items-center justify-center text-3xl shadow-inner group-hover:scale-110 transition-transform">
                                                    {icon}
                                                </div>
                                                <div className="flex-grow flex flex-col pt-1">
                                                    <div className="flex justify-between items-start">
                                                        <h3 className="font-bold text-lg text-white group-hover:text-blue-400 transition-colors leading-tight">{item.name}</h3>
                                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeColor} whitespace-nowrap ml-2`}>
                                                            {badgeText}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-gray-400 mt-1">By <span className="text-gray-300">{item.author}</span></p>
                                                </div>
                                            </div>

                                            {/* Middle: Description */}
                                            <p className="text-sm text-gray-300 flex-grow mb-6 leading-relaxed">
                                                {item.description}
                                            </p>

                                            {/* Bottom: Price and Install Button */}
                                            <div className="flex justify-between items-center mt-auto pt-4 border-t border-gray-700/50">
                                                <span className={`font-bold text-lg tracking-tight ${item.price === 'Free' ? 'text-green-400' : 'text-white'}`}>
                                                    {item.price}
                                                </span>
                                                <button 
                                                    className={`px-6 py-2.5 rounded-xl text-sm font-bold shadow-lg transition-all active:scale-95 flex items-center gap-2 ${
                                                        item.price === 'Free' 
                                                            ? 'bg-blue-600 hover:bg-blue-500 text-white hover:shadow-blue-600/50' 
                                                            : 'bg-white hover:bg-gray-200 text-gray-900 hover:shadow-white/20'
                                                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                                                    disabled={installingId === item.id}
                                                    onClick={() => {
                                                        if (item.buy_url) {
                                                            window.open(item.buy_url, '_blank');
                                                        } else {
                                                            handleInstallMarketplaceItem(item);
                                                        }
                                                    }}
                                                >
                                                    {installingId === item.id ? (
                                                        <>
                                                            <span className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin"></span>
                                                            Installing...
                                                        </>
                                                    ) : item.price === 'Free' ? 'Install' : 'Get Access'}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Advanced Custom Server Form */}
                {showAddForm && showCustomForm && (
                    <div className="flex flex-col gap-6 max-w-2xl mt-2 fade-in">
                        <div className="flex justify-between items-end border-b border-gray-700 pb-4">
                            <div>
                                <button onClick={() => setShowCustomForm(false)} className="text-gray-500 hover:text-gray-300 mb-2 text-sm">← Back to Marketplace</button>
                                <h2 className="text-2xl font-bold text-left">Advanced Custom Server</h2>
                            </div>
                            <select 
                                className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-blue-500"
                                onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === "custom") {
                                        setNewServer({ name: "", command: "npx", args: [], env: {} });
                                        setNewArgsStr("");
                                    } else if (val === "github") {
                                        setNewServer({ name: "github", description: "Search repos, read code, and manage PRs/issues", command: "npx", args: [], env: {} });
                                        setNewArgsStr("-y @modelcontextprotocol/server-github");
                                    } else if (val === "slack") {
                                        setNewServer({ name: "slack", description: "Read channels and send messages in Slack", command: "npx", args: [], env: {} });
                                        setNewArgsStr("-y @modelcontextprotocol/server-slack");
                                    } else if (val === "postgres") {
                                        setNewServer({ name: "postgres", description: "Read-only access to a PostgreSQL database", command: "npx", args: [], env: {} });
                                        setNewArgsStr("-y @modelcontextprotocol/server-postgres postgresql://localhost/mydb");
                                    } else if (val === "sqlite") {
                                        setNewServer({ name: "sqlite", description: "Database access to a local SQLite file", command: "npx", args: [], env: {} });
                                        setNewArgsStr("-y @modelcontextprotocol/server-sqlite /path/to/database.db");
                                    }
                                }}
                            >
                                <option value="custom">✨ Blank Template...</option>
                                <option disabled>── Quick Templates ──</option>
                                <option value="github">GitHub</option>
                                <option value="slack">Slack</option>
                                <option value="postgres">PostgreSQL</option>
                                <option value="sqlite">SQLite</option>
                            </select>
                        </div>
                        
                        <div className="flex flex-col items-start gap-1.5">
                            <label className="text-sm font-semibold text-gray-300">Name <span className="text-red-400">*</span></label>
                            <input
                                className="w-full bg-gray-950 border border-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none rounded-md px-4 py-2.5 text-white text-sm transition-all text-left"
                                placeholder="e.g. github, filesystem, oracle"
                                value={newServer.name}
                                onChange={e => setNewServer({ ...newServer, name: e.target.value })}
                            />
                        </div>

                        <div className="flex flex-col items-start gap-1.5">
                            <label className="text-sm font-semibold text-gray-300">Description</label>
                            <input
                                className="w-full bg-gray-950 border border-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none rounded-md px-4 py-2.5 text-white text-sm transition-all text-left"
                                placeholder="What does this server do?"
                                value={newServer.description || ""}
                                onChange={e => setNewServer({ ...newServer, description: e.target.value })}
                            />
                        </div>

                        <div className="flex flex-col items-start gap-1.5">
                            <label className="text-sm font-semibold text-gray-300">Command <span className="text-red-400">*</span></label>
                            <input
                                className="w-full bg-gray-950 border border-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none rounded-md px-4 py-2.5 text-white text-sm font-mono transition-all text-left"
                                placeholder="e.g. npx, python3, node"
                                value={newServer.command}
                                onChange={e => setNewServer({ ...newServer, command: e.target.value })}
                            />
                        </div>

                        <div className="flex flex-col items-start gap-1.5">
                            <label className="text-sm font-semibold text-gray-300">Args (space-separated)</label>
                            <input
                                className="w-full bg-gray-950 border border-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none rounded-md px-4 py-2.5 text-white text-sm font-mono transition-all text-left"
                                placeholder="e.g. -y @modelcontextprotocol/server-github"
                                value={newArgsStr}
                                onChange={e => setNewArgsStr(e.target.value)}
                            />
                        </div>

                        <div className="flex justify-end gap-3 pt-6 mt-2 border-t border-gray-800">
                            <button
                                onClick={() => setShowCustomForm(false)}
                                className="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-md text-sm font-medium transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAdd}
                                disabled={saving || !newServer.name || !newServer.command}
                                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-md text-sm font-bold shadow-sm transition-colors"
                            >
                                {saving ? "Saving..." : "Save Server"}
                            </button>
                        </div>
                    </div>
                )}

                {/* Server detail */}
                {selected && !showAddForm && (
                    <div className="flex flex-col gap-4 h-full">
                        <div className="flex justify-between items-center border-b border-gray-700 pb-2">
                            <h2 className="text-xl font-bold">{selected.name}</h2>
                            <div className="flex gap-3">
                                <button
                                    className={`pb-0.5 text-sm font-semibold ${detailTab === "config" ? "text-blue-400 border-b-2 border-blue-400" : "text-gray-500 hover:text-gray-300"}`}
                                    onClick={() => setDetailTab("config")}
                                >
                                    Config
                                </button>
                                <button
                                    className={`pb-0.5 text-sm font-semibold ${detailTab === "tools" ? "text-blue-400 border-b-2 border-blue-400" : "text-gray-500 hover:text-gray-300"}`}
                                    onClick={() => setDetailTab("tools")}
                                >
                                    Tools {statusMap[selected.name]?.toolcount !== undefined && `(${statusMap[selected.name].toolcount})`}
                                </button>
                            </div>
                        </div>

                        {detailTab === "config" && (
                            <div className="space-y-3 text-sm">
                                <div>
                                    <span className="text-gray-400">Command: </span>
                                    <code className="text-blue-300">{selected.command}</code>
                                </div>
                                {selected.args && selected.args.length > 0 && (
                                    <div>
                                        <span className="text-gray-400">Args: </span>
                                        <code className="text-blue-300">{selected.args.join(" ")}</code>
                                    </div>
                                )}
                                {selected.description && (
                                    <div>
                                        <span className="text-gray-400">Description: </span>
                                        <span>{selected.description}</span>
                                    </div>
                                )}
                                {selected.env && Object.keys(selected.env).length > 0 && (
                                    <div>
                                        <span className="text-gray-400 block mb-1">Env vars:</span>
                                        {Object.entries(selected.env).map(([k]) => (
                                            <div key={k} className="font-mono text-xs text-yellow-300">
                                                {k} = ••••••••
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div className="pt-4 border-t border-gray-800 flex gap-2">
                                    <button
                                        onClick={() => handleTest(selected)}
                                        disabled={testing}
                                        className="px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded text-sm font-semibold"
                                    >
                                        {testing ? "Testing..." : "Test Connection"}
                                    </button>
                                    <button
                                        onClick={() => handleDelete(selected.name)}
                                        className="px-4 py-2 bg-red-900 hover:bg-red-800 rounded text-sm font-semibold ml-auto"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        )}

                        {detailTab === "tools" && (
                            <div className="flex flex-col gap-2">
                                {testing && <div className="text-gray-400 text-sm">Connecting to server...</div>}
                                {testError && (
                                    <div className="bg-red-900/40 border border-red-700 rounded p-3 text-sm text-red-300">
                                        ❌ {testError}
                                    </div>
                                )}
                                {!testing && !testError && tools.length === 0 && (
                                    <button
                                        onClick={() => handleTest(selected)}
                                        className="px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded text-sm font-semibold self-start"
                                    >
                                        Test Connection
                                    </button>
                                )}
                                {tools.map(t => (
                                    <div key={t.name} className="bg-gray-800 rounded p-3 border border-gray-700">
                                        <div className="font-mono text-sm text-green-300">{t.name}</div>
                                        {t.description && (
                                            <div className="text-xs text-gray-400 mt-1">{t.description}</div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {!selected && !showAddForm && (
                    <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                        Select a server or click + Add to configure a new MCP server.
                    </div>
                )}
            </div>
        </div>
    );
});
MCPPanel.displayName = "MCPPanel";

// ─── Main ToolsAdminView ───────────────────────────────────────────────────────

export const ToolsAdminView = React.memo((props: FullBlockProps) => {
    const [mainTab, setMainTab] = useState<"plugins" | "mcp">("plugins");
    const [selectedTool, setSelectedTool] = useState<any>(null);
    const [activeTab, setActiveTab] = useState<"settings" | "code">("settings");
    const [tools, setTools] = useState<any[]>([]);

    useEffect(() => {
        if (mainTab === "plugins") {
            RpcApi.ToolsListCommand(TabRpcClient).then((list) => {
                // Filter out mcp type — those go in the MCP tab
                setTools((list || []).filter(t => t.type !== "mcp"));
            }).catch(err => {
                console.error("Error loading tools", err);
            });
        }
    }, [mainTab]);

    const handleCreateTool = () => {
        const newTool = {
            name: "get_weather",
            type: "dynamic",
            integration: "background",
            description: "Obtiene el clima actual para una ciudad especificada.",
            code: `// Ejemplo de plugin dinámico: get_weather
function execute(args) {
    const city = args.city || "Madrid";
    return {
        success: true,
        message: "Clima obtenido exitosamente",
        data: { city: city, temperature: 24, condition: "Soleado" }
    };
}`
        };
        setTools([newTool, ...tools]);
        setSelectedTool(newTool);
        setActiveTab("code");
    };

    const handleSave = async () => {
        if (!selectedTool) return;
        try {
            await RpcApi.ToolsSaveCommand(TabRpcClient, selectedTool);
            const list = await RpcApi.ToolsListCommand(TabRpcClient);
            setTools((list || []).filter(t => t.type !== "mcp"));
        } catch (err) {
            console.error("Failed to save tool", err);
        }
    };

    const handleDelete = async () => {
        if (!selectedTool || selectedTool.type !== 'dynamic') return;
        if (!confirm(`Are you sure you want to delete ${selectedTool.name}?`)) return;
        try {
            await RpcApi.ToolsDeleteCommand(TabRpcClient, selectedTool.name);
            setSelectedTool(null);
            const list = await RpcApi.ToolsListCommand(TabRpcClient);
            setTools((list || []).filter(t => t.type !== "mcp"));
        } catch (err) {
            console.error("Failed to delete tool", err);
        }
    };

    return (
        <div className="flex flex-col h-full w-full text-white bg-gray-900">
            {/* Main tab bar */}
            <div className="flex border-b border-gray-700 px-4 pt-3 gap-1 shrink-0">
                <button
                    onClick={() => setMainTab("plugins")}
                    className={`px-4 py-1.5 rounded-t text-sm font-semibold transition-colors ${mainTab === "plugins" ? "bg-gray-800 text-white border-b-2 border-blue-400" : "text-gray-400 hover:text-gray-200"}`}
                >
                    🔧 Plugins
                </button>
                <button
                    onClick={() => setMainTab("mcp")}
                    className={`px-4 py-1.5 rounded-t text-sm font-semibold transition-colors ${mainTab === "mcp" ? "bg-gray-800 text-white border-b-2 border-blue-400" : "text-gray-400 hover:text-gray-200"}`}
                >
                    🔌 MCP Servers
                </button>
            </div>

            {/* MCP tab */}
            {mainTab === "mcp" && <MCPPanel />}

            {/* Plugins tab */}
            {mainTab === "plugins" && (
                <div className="flex flex-1 min-h-0 overflow-hidden">
                    {/* Sidebar */}
                    <div className="w-1/3 border-r border-gray-700 p-4 flex flex-col overflow-y-auto">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-lg">Available Tools</h3>
                            <button
                                onClick={handleCreateTool}
                                className="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-sm font-semibold"
                            >
                                + New
                            </button>
                        </div>
                        <ul className="space-y-2 overflow-y-auto flex-grow">
                            {tools.map(tool => (
                                <li
                                    key={tool.name}
                                    className={`p-3 rounded cursor-pointer hover:bg-gray-800 border ${selectedTool?.name === tool.name ? 'border-blue-500 bg-gray-800' : 'border-gray-800'}`}
                                    onClick={() => { setSelectedTool(tool); setActiveTab("settings"); }}
                                >
                                    <div className="font-semibold">{tool.name}</div>
                                    <div className="text-xs text-gray-400">{tool.type}</div>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Editor */}
                    <div className="w-2/3 h-full p-6 flex flex-col overflow-y-auto bg-gray-900">
                        {selectedTool ? (
                            <div key={selectedTool.name} className="flex flex-col flex-grow h-full min-h-0">
                                <div className="flex justify-between items-end mb-6 border-b border-gray-800 pb-2">
                                    <h2 className="text-2xl font-bold">Edit Tool: {selectedTool.name}</h2>
                                    <div className="flex space-x-4">
                                        <button
                                            className={`pb-1 font-semibold ${activeTab === 'settings' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
                                            onClick={() => setActiveTab('settings')}
                                        >
                                            Settings
                                        </button>
                                        <button
                                            className={`pb-1 font-semibold ${activeTab === 'code' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
                                            onClick={() => setActiveTab('code')}
                                        >
                                            Code
                                        </button>
                                    </div>
                                </div>

                                {activeTab === 'settings' && (
                                    <div className="space-y-4 flex-grow overflow-y-auto">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-400 mb-1">Description</label>
                                            <textarea
                                                className="w-full bg-black border border-gray-700 rounded p-2 text-white h-24 font-mono text-sm"
                                                defaultValue={selectedTool.description}
                                                onChange={(e) => setSelectedTool({ ...selectedTool, description: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-400 mb-1">Widget Integration</label>
                                            <select
                                                className="w-full bg-black border border-gray-700 rounded p-2 text-white"
                                                defaultValue={selectedTool.integration}
                                                onChange={(e) => setSelectedTool({ ...selectedTool, integration: e.target.value })}
                                            >
                                                <option value="background">Background (Silent)</option>
                                                <option value="terminal">Terminal Widget (Visible)</option>
                                                <option value="preview">Preview Widget</option>
                                                <option value="dashboard">Dashboard Widget</option>
                                            </select>
                                        </div>
                                        <div className="pt-4 mt-4 border-t border-gray-800 flex justify-end gap-2">
                                            {selectedTool.type === 'dynamic' && (
                                                <button onClick={handleDelete} className="px-4 py-2 bg-red-900 hover:bg-red-800 rounded font-semibold mr-auto">Delete</button>
                                            )}
                                            <button className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded">Cancel</button>
                                            <button onClick={handleSave} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded font-semibold">Save Configuration</button>
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'code' && (
                                    <div className="grid grid-rows-[auto_1fr_auto] h-full gap-2 min-h-0">
                                        <label className="text-sm font-medium text-gray-400">
                                            {selectedTool.type === 'built-in' ? "Code (Read-only for built-in tools)" : "Javascript Source Code"}
                                        </label>
                                        <textarea
                                            className="w-full h-full bg-black border border-gray-700 rounded p-4 text-blue-300 font-mono text-sm resize-none"
                                            defaultValue={selectedTool.code || `// Tool: ${selectedTool.name}\n// Source code is compiled in Go and cannot be modified here.`}
                                            readOnly={selectedTool.type === 'built-in'}
                                            onChange={(e) => setSelectedTool({ ...selectedTool, code: e.target.value })}
                                        />
                                        <div className="border-t border-gray-800 pt-4 mt-2 flex justify-end gap-2">
                                            {selectedTool.type === 'dynamic' && (
                                                <button onClick={handleDelete} className="px-4 py-2 bg-red-900 hover:bg-red-800 rounded font-semibold mr-auto">Delete</button>
                                            )}
                                            <button className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded">Cancel</button>
                                            <button
                                                className={`px-4 py-2 rounded font-semibold ${selectedTool.type === 'built-in' ? 'bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500'}`}
                                                disabled={selectedTool.type === 'built-in'}
                                                onClick={handleSave}
                                            >
                                                Save Code
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="h-full flex items-center justify-center text-gray-500">
                                Select a tool from the left to edit its configuration.
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
});
ToolsAdminView.displayName = "ToolsAdminView";
