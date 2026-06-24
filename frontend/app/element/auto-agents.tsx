// Copyright 2026, GuLiN Terminal
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback, useRef } from "react";
import { useAtomValue } from "jotai";
import { atoms } from "@/app/store/global-atoms";
import { AgentData, AgentGroup, AgentChatMessage, AgentTask } from "./auto-agents-types";
import parser from "cron-parser";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { ClientModel } from "@/app/store/client-model";

const CONFIG_PATH = "agents_autonomos.json";

declare var window: any;

async function getConfigDir(): Promise<string> {
    return window.api.getConfigDir();
}

export function AutoAgentsWidget() {
    const [agents, setAgents] = useState<AgentData[]>([]);
    const [groups, setGroups] = useState<AgentGroup[]>([]);
    const [tasks, setTasks] = useState<AgentTask[]>([]);
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
    const [chatMessages, setChatMessages] = useState<AgentChatMessage[]>([]);
    const [chatInput, setChatInput] = useState("");
    const [chatMode, setChatMode] = useState<"group" | "individual">("group");
    const [viewMode, setViewMode] = useState<"chat" | "edit" | "tasks">("chat");
    const [isLoading, setIsLoading] = useState(true);
    const [presetProvider, setPresetProvider] = useState<string>("custom");
    const aiConfigs = useAtomValue(atoms.gulinaiModeConfigAtom);
    const lastRunRef = useRef<Record<string, number>>({});

    // Load config from file
    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        try {
            const configDir = await window.api.getConfigDir();
            const filePath = `${configDir}/${CONFIG_PATH}`;
            const result = await window.api.readTextFile(filePath);
            if (result.success && result.content) {
                const data = JSON.parse(result.content);
                if (data.agents && data.agents.length > 0) {
                    setAgents(data.agents);
                    setGroups(data.groups || []);
                    setTasks(data.tasks || []);
                    setIsLoading(false);
                    return;
                }
            }
        } catch (err) {
            console.error("Failed to load agents config:", err);
        }
        // Fallback: try reading from ~/.config/gulin/ (prod path)
        try {
            const filePath = `/Users/lordzero1/.config/gulin/${CONFIG_PATH}`;
            const result = await window.api.readTextFile(filePath);
            if (result.success && result.content) {
                const data = JSON.parse(result.content);
                setAgents(data.agents || []);
                setGroups(data.groups || []);
                setTasks(data.tasks || []);
            }
        } catch (err) {
            console.error("Fallback config also failed:", err);
        }
        setIsLoading(false);
    };

    const saveConfig = async (newAgents: AgentData[], newGroups: AgentGroup[], newTasks: AgentTask[]) => {
        try {
            const configDir = await window.api.getConfigDir();
            const filePath = `${configDir}/${CONFIG_PATH}`;
            const content = JSON.stringify({ agents: newAgents, groups: newGroups, tasks: newTasks, chat_history: {} }, null, 2);
            
            if (typeof window.api.writeTextFile === "function") {
                await window.api.writeTextFile(filePath, content);
            } else {
                console.warn("writeTextFile no está disponible, usando saveTextFile (mostrará diálogo)");
                await window.api.saveTextFile(filePath, content);
            }
        } catch (err: any) {
            console.error("Failed to save agents config:", err);
            alert("Error crítico al guardar los agentes: " + err.message);
        }
    };

    const resolveApiKey = useCallback((provider: string) => {
        if (!aiConfigs) return null;
        for (const key in aiConfigs) {
            const conf = aiConfigs[key];
            if (conf["ai:provider"] === provider && conf["ai:apitoken"]) {
                return conf["ai:apitoken"];
            }
        }
        return null;
    }, [aiConfigs]);

    // Cron Runner
    useEffect(() => {
        const interval = setInterval(() => {
            const now = new Date();
            const nowMin = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()).getTime();

            tasks.forEach(task => {
                if (!task.enabled) return;
                try {
                    const cronObj = parser.parseExpression(task.cron);
                    const prev = cronObj.prev().toDate();
                    const prevMin = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate(), prev.getHours(), prev.getMinutes()).getTime();
                    
                    if (prevMin === nowMin && lastRunRef.current[task.id] !== prevMin) {
                        lastRunRef.current[task.id] = prevMin;
                        executeTask(task);
                    }
                } catch (e) {
                    console.error("Error parsing cron for task", task.id, e);
                }
            });
        }, 30000); // Check every 30 seconds
        
        return () => clearInterval(interval);
    }, [tasks, agents, resolveApiKey]);

    const executeTask = async (task: AgentTask) => {
        const agent = agents.find(a => a.id === task.agent_id);
        if (!agent || !agent.enabled) return;

        const apiKey = resolveApiKey(agent.provider) || agent.api_key_secret;
        if (!apiKey || apiKey.includes("_KEY")) {
            console.error(`Task ${task.id}: No API Key found for provider ${agent.provider}`);
            return;
        }

        try {
            const resp = await callAgentAPI(agent, task.prompt, apiKey);
            const agentMsg: AgentChatMessage = {
                role: "assistant",
                agent_id: agent.id,
                text: `[Tarea Automática: ${task.cron}]\n${resp}`,
                timestamp: new Date().toISOString()
            };
            setChatMessages(prev => [...prev, agentMsg]);
        } catch (err: any) {
            console.error(`Task ${task.id} failed:`, err);
            const errorMsg: AgentChatMessage = {
                role: "assistant",
                agent_id: agent.id,
                text: `[Error en Tarea Automática]: ${err.message}`,
                timestamp: new Date().toISOString()
            };
            setChatMessages(prev => [...prev, errorMsg]);
        }
    };

    // Send message to agents
    const sendMessage = useCallback(async () => {
        if (!chatInput.trim()) return;

        const userMsg: AgentChatMessage = {
            role: "user",
            text: chatInput,
            timestamp: new Date().toISOString()
        };
        setChatMessages(prev => [...prev, userMsg]);
        setChatInput("");

        if (chatMode === "individual" && selectedAgentId) {
            // Send to single agent
            const agent = agents.find(a => a.id === selectedAgentId);
            if (!agent) return;

            const apiKey = resolveApiKey(agent.provider) || agent.api_key_secret;
            if (!apiKey || apiKey.includes("_KEY")) {
                const errorMsg: AgentChatMessage = {
                    role: "assistant",
                    agent_id: agent.id,
                    text: `Error: No se encontró la API Key para el proveedor '${agent.provider}' en la configuración global de GuLiN.`,
                    timestamp: new Date().toISOString()
                };
                setChatMessages(prev => [...prev, errorMsg]);
                return;
            }

            try {
                const resp = await callAgentAPI(agent, chatInput, apiKey);
                const agentMsg: AgentChatMessage = {
                    role: "assistant",
                    agent_id: agent.id,
                    text: resp,
                    timestamp: new Date().toISOString()
                };
                setChatMessages(prev => [...prev, agentMsg]);
            } catch (err: any) {
                const errorMsg: AgentChatMessage = {
                    role: "assistant",
                    agent_id: agent.id,
                    text: `Error: ${err.message}`,
                    timestamp: new Date().toISOString()
                };
                setChatMessages(prev => [...prev, errorMsg]);
            }
        } else {
            // Send to all enabled agents in group
            const enabledAgents = agents.filter(a => a.enabled);
            for (const agent of enabledAgents) {
                const apiKey = resolveApiKey(agent.provider) || agent.api_key_secret;
                if (!apiKey || apiKey.includes("_KEY")) {
                    const errorMsg: AgentChatMessage = {
                        role: "assistant",
                        agent_id: agent.id,
                        text: `Error: No se encontró la API Key para el proveedor '${agent.provider}' en la configuración global de GuLiN.`,
                        timestamp: new Date().toISOString()
                    };
                    setChatMessages(prev => [...prev, errorMsg]);
                    continue;
                }

                try {
                    const resp = await callAgentAPI(agent, chatInput, apiKey);
                    const agentMsg: AgentChatMessage = {
                        role: "assistant",
                        agent_id: agent.id,
                        text: resp,
                        timestamp: new Date().toISOString()
                    };
                    setChatMessages(prev => [...prev, agentMsg]);
                } catch (err: any) {
                    const errorMsg: AgentChatMessage = {
                        role: "assistant",
                        agent_id: agent.id,
                        text: `Error: ${err.message}`,
                        timestamp: new Date().toISOString()
                    };
                    setChatMessages(prev => [...prev, errorMsg]);
                }
            }
        }
    }, [chatInput, chatMode, selectedAgentId, agents, resolveApiKey]);

    // Create new agent
    const createAgent = useCallback(() => {
        const newAgentId = `agente-${Date.now()}`;
        const newAgent: AgentData = {
            id: newAgentId,
            name: "Nuevo Agente",
            icon: "🤖",
            provider: "deepseek",
            endpoint: "https://api.deepseek.com/v1/chat/completions",
            model: "deepseek-chat",
            api_key_secret: "DEEPSEEK_KEY",
            system_prompt: "Eres un asistente útil.",
            color: "#" + Math.floor(Math.random()*16777215).toString(16),
            enabled: true,
            lastStatus: "idle"
        };

        const newAgents = [...agents, newAgent];
        setAgents(newAgents);
        saveConfig(newAgents, groups, tasks);
        
        // Auto-select the new agent and open the edit view
        setSelectedAgentId(newAgentId);
        setChatMode("individual");
        setViewMode("edit");
    }, [agents, groups, tasks]);

    // Update agent
    const handleUpdateAgent = (updatedAgent: AgentData) => {
        const newAgents = agents.map(a => a.id === updatedAgent.id ? updatedAgent : a);
        setAgents(newAgents);
        saveConfig(newAgents, groups, tasks);
    };

    // Delete agent
    const deleteAgent = useCallback((id: string) => {
        const newAgents = agents.filter(a => a.id !== id);
        const newGroups = groups.map(g => ({
            ...g,
            agent_ids: g.agent_ids.filter(aid => aid !== id)
        }));
        const newTasks = tasks.filter(t => t.agent_id !== id);
        setAgents(newAgents);
        setGroups(newGroups);
        setTasks(newTasks);
        saveConfig(newAgents, newGroups, newTasks);
        if (selectedAgentId === id) {
            setSelectedAgentId(null);
            setViewMode("chat");
        }
    }, [agents, groups, tasks, selectedAgentId]);

    // Tasks Management
    const handleCreateTask = () => {
        if (!selectedAgentId) return;
        const cron = "*/5 * * * *";
        const promptText = "Revisa el sistema y dame un reporte";
        
        const newTask: AgentTask = {
            id: `task-${Date.now()}`,
            agent_id: selectedAgentId,
            cron,
            prompt: promptText,
            enabled: true
        };
        const newTasks = [...tasks, newTask];
        setTasks(newTasks);
        saveConfig(agents, groups, newTasks);
    };

    const toggleTask = (taskId: string) => {
        const newTasks = tasks.map(t => t.id === taskId ? { ...t, enabled: !t.enabled } : t);
        setTasks(newTasks);
        saveConfig(agents, groups, newTasks);
    };

    const deleteTask = (taskId: string) => {
        const newTasks = tasks.filter(t => t.id !== taskId);
        setTasks(newTasks);
        saveConfig(agents, groups, newTasks);
    };

    if (isLoading) {
        return <div className="flex items-center justify-center h-full text-gray-400">Cargando agentes...</div>;
    }

    const selectedAgent = agents.find(a => a.id === selectedAgentId);

    return (
        <div className="flex flex-col h-full w-full bg-[#1a1a2e] text-gray-200">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700">
                <div className="flex items-center gap-2">
                    <span className="text-lg">🤖</span>
                    <span className="font-semibold">Agentes Autónomos</span>
                </div>
                <button
                    onClick={createAgent}
                    className="px-3 py-1 text-sm bg-indigo-600 hover:bg-indigo-500 rounded transition-colors"
                >
                    + Nuevo Agente
                </button>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar: Agent List */}
                <div className="w-64 border-r border-gray-700 overflow-y-auto p-2">
                    {agents.length === 0 ? (
                        <div className="text-gray-500 text-sm text-center py-8">
                            No hay agentes creados aún
                        </div>
                    ) : (
                        agents.map(agent => (
                            <div
                                key={agent.id}
                                onClick={() => {
                                    setSelectedAgentId(agent.id === selectedAgentId ? null : agent.id);
                                    if (agent.id !== selectedAgentId) {
                                        setChatMode("individual");
                                        setViewMode("chat");
                                    }
                                }}
                                className={`flex items-center gap-2 p-2 rounded cursor-pointer mb-1 transition-colors
                                    ${selectedAgentId === agent.id ? "bg-indigo-900/50 border border-indigo-500" : "hover:bg-gray-800 border border-transparent"}`}
                            >
                                <span className="text-lg">{agent.icon}</span>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium truncate">{agent.name}</div>
                                    <div className="text-xs text-gray-500 truncate">{agent.model}</div>
                                </div>
                                <div className="flex gap-1">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); deleteAgent(agent.id); }}
                                        className="text-xs px-1.5 py-0.5 bg-red-900/50 hover:bg-red-800 rounded"
                                        title="Eliminar"
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Main Content */}
                <div className="flex-1 flex flex-col">
                    {/* Top Bar for individual mode */}
                    {chatMode === "individual" && selectedAgent && (
                        <div className="flex gap-4 border-b border-gray-700 bg-gray-800/50 px-4 pt-3">
                            <button className={`pb-2 px-2 text-sm ${viewMode === "chat" ? "border-b-2 border-indigo-500 text-white font-medium" : "text-gray-400 hover:text-gray-200"}`} onClick={() => setViewMode("chat")}>Chat</button>
                            <button className={`pb-2 px-2 text-sm ${viewMode === "edit" ? "border-b-2 border-indigo-500 text-white font-medium" : "text-gray-400 hover:text-gray-200"}`} onClick={() => setViewMode("edit")}>Configuración</button>
                            <button className={`pb-2 px-2 text-sm ${viewMode === "tasks" ? "border-b-2 border-indigo-500 text-white font-medium" : "text-gray-400 hover:text-gray-200"}`} onClick={() => setViewMode("tasks")}>Tareas Automáticas</button>
                        </div>
                    )}

                    {/* View Modes */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {/* 1. Chat View */}
                        {(!selectedAgent || (chatMode === "individual" && viewMode === "chat") || chatMode === "group") && (
                            <div className="flex-1 flex flex-col p-2 h-full">
                                {/* Chat Mode Toggle */}
                                {agents.length > 1 && (
                                    <div className="flex gap-2 mb-2">
                                        <button
                                            onClick={() => { setChatMode("group"); setSelectedAgentId(null); setViewMode("chat"); }}
                                            className={`px-3 py-1 text-xs rounded ${chatMode === "group" ? "bg-indigo-600" : "bg-gray-700"}`}
                                        >
                                            Chat Grupal ({agents.filter(a => a.enabled).length} agentes)
                                        </button>
                                        {selectedAgent && (
                                            <button
                                                onClick={() => setChatMode("individual")}
                                                className={`px-3 py-1 text-xs rounded ${chatMode === "individual" ? "bg-indigo-600" : "bg-gray-700"}`}
                                            >
                                                Chat con {selectedAgent.name}
                                            </button>
                                        )}
                                    </div>
                                )}

                                {/* Messages */}
                                <div className="flex-1 overflow-y-auto mb-2 space-y-2">
                                    {chatMessages.length === 0 ? (
                                        <div className="text-gray-500 text-sm text-center py-8">
                                            {chatMode === "group" 
                                                ? "Escribe un mensaje para todos los agentes del grupo"
                                                : `Escribe un mensaje para ${selectedAgent?.name || "el agente seleccionado"}`
                                            }
                                        </div>
                                    ) : (
                                        chatMessages.map((msg, i) => (
                                            <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : ""}`}>
                                                {msg.role === "assistant" && (
                                                    <span className="text-lg">{agents.find(a => a.id === msg.agent_id)?.icon || "🤖"}</span>
                                                )}
                                                <div className={`px-3 py-2 rounded text-sm max-w-[80%] ${
                                                    msg.role === "user" 
                                                        ? "bg-indigo-700 text-white" 
                                                        : "bg-gray-800 text-gray-200"
                                                }`}>
                                                    {msg.role === "assistant" && msg.agent_id && (
                                                        <div className="text-xs text-gray-400 mb-1">
                                                            {agents.find(a => a.id === msg.agent_id)?.name || msg.agent_id}
                                                        </div>
                                                    )}
                                                    <div className="whitespace-pre-wrap">{msg.text}</div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>

                                {/* Input */}
                                <div className="flex gap-2 shrink-0">
                                    <input
                                        type="text"
                                        value={chatInput}
                                        onChange={(e) => setChatInput(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                                        placeholder={chatMode === "group" ? "Mensaje para todos los agentes..." : `Mensaje para ${selectedAgent?.name || "el agente"}...`}
                                        className="flex-1 px-3 py-2 rounded bg-gray-800 border border-gray-700 text-sm focus:outline-none focus:border-indigo-500"
                                    />
                                    <button
                                        onClick={sendMessage}
                                        disabled={!chatInput.trim()}
                                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm transition-colors"
                                    >
                                        Enviar
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* 2. Agent Edit Form */}
                        {chatMode === "individual" && selectedAgent && viewMode === "edit" && (
                            <div className="flex-1 overflow-y-auto p-6 space-y-6 h-full">
                                <div>
                                    <h3 className="text-lg font-medium text-indigo-400 mb-1">Configuración del Agente</h3>
                                    <p className="text-sm text-gray-400 mb-4">Modifica los parámetros de identidad y conexión de tu agente.</p>
                                </div>
                                
                                {(() => {
                                    const uniqueProviders = Array.from(new Set(Object.values(aiConfigs || {}).map((c: any) => c["ai:provider"] || "custom")));
                                    // Ensure Custom is at the top if it exists, or just add it
                                    if (!uniqueProviders.includes("custom")) uniqueProviders.push("custom");
                                    uniqueProviders.sort((a, b) => a === "custom" ? -1 : b === "custom" ? 1 : a.localeCompare(b));

                                    return (
                                        <div className="mb-6 flex gap-4 bg-gray-800/30 p-4 rounded border border-gray-700/50">
                                            <div className="flex-1 flex flex-col">
                                                <label className="text-[10px] text-gray-500 mb-1 font-bold tracking-wider uppercase">Provider</label>
                                                <select 
                                                    className="w-full px-3 py-2 bg-[#1e1e24] border border-gray-700 rounded text-sm text-gray-200 focus:border-indigo-500 outline-none"
                                                    value={presetProvider}
                                                    onChange={(e) => setPresetProvider(e.target.value)}
                                                >
                                                    {uniqueProviders.map(p => (
                                                        <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="flex-1 flex flex-col">
                                                <label className="text-[10px] text-gray-500 mb-1 font-bold tracking-wider uppercase">Model</label>
                                                <select 
                                                    className="w-full px-3 py-2 bg-[#1e1e24] border border-gray-700 rounded text-sm text-gray-200 focus:border-indigo-500 outline-none"
                                                    disabled={!presetProvider}
                                                    onChange={(e) => {
                                                        const confKey = e.target.value;
                                                        if (!confKey || !aiConfigs || !aiConfigs[confKey]) return;
                                                        const conf = aiConfigs[confKey];
                                                        const provider = conf["ai:provider"] || "";
                                                        let endpoint = conf["ai:baseurl"] || "";
                                                        if (!endpoint) {
                                                            if (provider === "openai") endpoint = "https://api.openai.com/v1/chat/completions";
                                                            else if (provider === "deepseek") endpoint = "https://api.deepseek.com/v1/chat/completions";
                                                            else if (provider === "anthropic") endpoint = "https://api.anthropic.com/v1/messages";
                                                            else if (provider === "google") endpoint = "https://generativelanguage.googleapis.com/v1beta/models/";
                                                        }
                                                        let model = conf["ai:model"] || "";
                                                        if (!model) {
                                                            if (provider === "openai") model = "gpt-4o-mini";
                                                            else if (provider === "deepseek") model = "deepseek-chat";
                                                            else if (provider === "anthropic") model = "claude-3-5-sonnet-20240620";
                                                            else if (provider === "google") model = "gemini-1.5-flash-latest";
                                                        }
                                                        handleUpdateAgent({...selectedAgent, provider, endpoint, model});
                                                        e.target.value = ""; // Reset this select
                                                    }}
                                                    defaultValue=""
                                                >
                                                    <option value="" disabled>✨ Elige un modelo...</option>
                                                    {presetProvider && aiConfigs && Object.entries(aiConfigs)
                                                        .filter(([k, c]: [string, any]) => (c["ai:provider"] || "custom") === presetProvider)
                                                        .map(([key, conf]: [string, any]) => {
                                                            const model = conf["ai:model"] || "Default";
                                                            const connectionName = conf.name || key;
                                                            return (
                                                                <option key={key} value={key}>
                                                                    {connectionName} ({model})
                                                                </option>
                                                            );
                                                        })
                                                    }
                                                </select>
                                            </div>
                                        </div>
                                    );
                                })()}

                                <datalist id="endpoints-list">
                                    <option value="https://api.deepseek.com/v1/chat/completions" />
                                    <option value="https://api.openai.com/v1/chat/completions" />
                                    <option value="https://api.anthropic.com/v1/messages" />
                                    <option value="https://generativelanguage.googleapis.com/v1beta/models/" />
                                    <option value="http://localhost:11434/v1/chat/completions" />
                                    {aiConfigs && Object.values(aiConfigs).map((conf: any, i) => conf["ai:baseurl"] ? (
                                        <option key={i} value={conf["ai:baseurl"]} />
                                    ) : null)}
                                </datalist>
                                
                                <datalist id="models-list">
                                    <option value="deepseek-chat" />
                                    <option value="gpt-4o-mini" />
                                    <option value="gpt-4o" />
                                    <option value="claude-3-5-sonnet-20240620" />
                                    <option value="llama3" />
                                </datalist>

                                <div className="grid grid-cols-2 gap-6 pb-6">
                                    <div className="flex flex-col">
                                        <label className="text-xs text-gray-400 mb-1">Nombre</label>
                                        <input type="text" onFocus={e => e.target.select()} value={selectedAgent.name} onChange={e => handleUpdateAgent({...selectedAgent, name: e.target.value})} className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:border-indigo-500 outline-none" />
                                    </div>
                                    <div className="flex flex-col">
                                        <label className="text-xs text-gray-400 mb-1">Icono (Emoji)</label>
                                        <input type="text" onFocus={e => e.target.select()} value={selectedAgent.icon} onChange={e => handleUpdateAgent({...selectedAgent, icon: e.target.value})} className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:border-indigo-500 outline-none" />
                                    </div>
                                    <div className="flex flex-col">
                                        <label className="text-xs text-gray-400 mb-1">Proveedor Global</label>
                                        <input type="text" onFocus={e => e.target.select()} value={selectedAgent.provider} onChange={e => handleUpdateAgent({...selectedAgent, provider: e.target.value})} className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:border-indigo-500 outline-none" placeholder="ej: openai, deepseek..." />
                                    </div>
                                    <div className="flex flex-col">
                                        <label className="text-xs text-gray-400 mb-1">Modelo Específico</label>
                                        <input list="models-list" type="text" onFocus={e => e.target.select()} value={selectedAgent.model} onChange={e => handleUpdateAgent({...selectedAgent, model: e.target.value})} className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:border-indigo-500 outline-none" />
                                    </div>
                                    <div className="col-span-2 flex flex-col">
                                        <label className="text-xs text-gray-400 mb-1">Endpoint API</label>
                                        <input list="endpoints-list" type="text" onFocus={e => e.target.select()} value={selectedAgent.endpoint} onChange={e => handleUpdateAgent({...selectedAgent, endpoint: e.target.value})} className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:border-indigo-500 outline-none" placeholder="Elige o escribe una URL..." />
                                    </div>
                                    <div className="col-span-2 flex flex-col">
                                        <label className="text-xs text-gray-400 mb-1">System Prompt (Instrucciones)</label>
                                        <textarea rows={6} value={selectedAgent.system_prompt} onChange={e => handleUpdateAgent({...selectedAgent, system_prompt: e.target.value})} className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:border-indigo-500 outline-none resize-none font-mono" />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 3. Tasks / Cron View */}
                        {chatMode === "individual" && selectedAgent && viewMode === "tasks" && (
                            <div className="flex-1 overflow-hidden p-6 flex flex-col h-full">
                                <div className="flex items-center justify-between border-b border-gray-700 pb-4 mb-4 shrink-0">
                                    <div>
                                        <h3 className="text-lg font-medium text-indigo-400 mb-1">Tareas Programadas (Cron)</h3>
                                        <p className="text-sm text-gray-400">Las tareas se ejecutarán en segundo plano de acuerdo a la expresión Cron.</p>
                                    </div>
                                    <button onClick={handleCreateTask} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-medium transition-colors shadow-lg">
                                        + Nueva Tarea
                                    </button>
                                </div>
                                <div className="space-y-3 flex-1 overflow-y-auto pr-2">
                                    {tasks.filter(t => t.agent_id === selectedAgent.id).length === 0 ? (
                                        <div className="text-gray-500 text-sm text-center py-12 bg-gray-800/20 rounded border border-dashed border-gray-700">
                                            No hay tareas programadas para este agente.<br/>Haz clic en "+ Nueva Tarea" para comenzar.
                                        </div>
                                    ) : (
                                        tasks.filter(t => t.agent_id === selectedAgent.id).map(task => (
                                            <div key={task.id} className={`p-4 rounded border transition-colors ${task.enabled ? 'bg-gray-800/80 border-indigo-900/50 shadow-md' : 'bg-gray-800/30 border-gray-800 opacity-60'}`}>
                                                <div className="flex justify-between items-start mb-3">
                                                    <div className="flex items-center gap-3">
                                                        <span className="px-2 py-1 bg-gray-900 rounded text-xs font-mono text-indigo-400 border border-indigo-900/50" title="Cron Expression">{task.cron}</span>
                                                        <span className="text-xs text-gray-500 font-mono">ID: {task.id.split("-")[1]}</span>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button onClick={() => toggleTask(task.id)} className={`text-xs px-3 py-1.5 rounded transition-colors font-medium ${task.enabled ? 'bg-amber-600/20 text-amber-500 hover:bg-amber-600/30' : 'bg-emerald-600/20 text-emerald-500 hover:bg-emerald-600/30'}`}>
                                                            {task.enabled ? 'Pausar' : 'Activar'}
                                                        </button>
                                                        <button onClick={() => deleteTask(task.id)} className="text-xs px-3 py-1.5 bg-red-900/20 text-red-400 hover:bg-red-900/40 rounded transition-colors font-medium">Eliminar</button>
                                                    </div>
                                                </div>
                                                <div className="text-sm text-gray-300 bg-gray-900/50 p-3 rounded whitespace-pre-wrap font-mono border border-gray-800">
                                                    {task.prompt}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// Helper: Call agent's API endpoint
async function callAgentAPI(agent: AgentData, prompt: string, apiKey: string): Promise<string> {
    const clientId = ClientModel.getInstance().clientId;
    
    const opts: any = {
        model: agent.model,
        apitype: agent.provider,
        apitoken: apiKey,
        baseurl: agent.endpoint,
        timeoutms: 60000,
    };

    const beMsg: any = {
        clientid: clientId,
        opts: opts,
        prompt: [
            { role: "system", content: agent.system_prompt },
            { role: "user", content: prompt }
        ],
    };

    let fullMsg = "";
    try {
        const aiGen = RpcApi.StreamGulinAiCommand(TabRpcClient, beMsg, { timeout: opts.timeoutms });
        for await (const msg of aiGen) {
            if (!msg) continue;
            fullMsg += (msg.text ?? "");
        }
        if (!fullMsg) {
            throw new Error("Sin respuesta del agente");
        }
        return fullMsg;
    } catch (err: any) {
        throw new Error(`Error del backend Gulin: ${err.message}`);
    }
}
