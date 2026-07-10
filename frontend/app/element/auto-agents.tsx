// Copyright 2026, GuLiN Terminal
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  Node,
  Edge,
  Handle,
  Position
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useAtomValue } from "jotai";
import { atoms } from "@/app/store/global-atoms";
import { AgentData, AgentGroup, AgentChatMessage, AgentTask } from "./auto-agents-types";
import parser from "cron-parser";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { ClientModel } from "@/app/store/client-model";
import { getWebServerEndpoint } from "@/util/endpoints";

const CONFIG_PATH = "agents_autonomos.json";

declare var window: any;

async function getConfigDir(): Promise<string> {
    return window.api.getConfigDir();
}

const CustomAgentNode = ({ data }: any) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [activeTab, setActiveTab] = useState<"chat"|"logs">("chat");
    const [input, setInput] = useState("");
    const messages = data.messages || [];

    // Filter tool executions for the logs tab
    const logs = messages.filter((m: any) => m.role === "assistant" && m.text.includes("[⚙️")).map((m:any) => m.text).join("\n\n") || "No hay logs de herramientas aún...";

    return (
        <div className={`bg-gray-800 border border-gray-600 rounded-lg p-3 shadow-2xl transition-all duration-200 ${isExpanded ? 'w-[600px] h-[750px] flex flex-col' : 'w-[250px]'}`}>
            <Handle type="target" position={Position.Left} className="w-3 h-3 bg-indigo-500" />
            <div className="flex items-center justify-between mb-2 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
                <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${data.status === 'running' ? 'bg-yellow-400 animate-pulse' : data.status === 'success' ? 'bg-green-500' : data.status === 'error' ? 'bg-red-500' : 'bg-gray-500'}`}></div>
                    <div className="text-white font-medium text-base">{data.label}</div>
                </div>
                <div className="flex gap-2">
                    {data.onConfigClick && (
                        <button onClick={(e) => { e.stopPropagation(); data.onConfigClick(); }} className="text-gray-400 hover:text-white" title="Configuración">⚙️</button>
                    )}
                    <button className="text-gray-400 hover:text-white" title={isExpanded ? "Colapsar" : "Expandir"}>
                        {isExpanded ? '🗕' : '🗖'}
                    </button>
                </div>
            </div>
            {!isExpanded ? (
                <div className="text-sm text-gray-400 mt-1">{data.status === 'running' ? 'Procesando...' : data.status === 'idle' ? 'Inactivo' : data.status === 'success' ? 'Terminado' : 'Error'}</div>
            ) : (
                <>
                    <div className="flex gap-4 border-b border-gray-600 mb-2 px-1">
                        <button onClick={() => setActiveTab("chat")} className={`pb-1 text-sm font-medium ${activeTab === 'chat' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-gray-400 hover:text-gray-300'}`}>Chat</button>
                        <button onClick={() => setActiveTab("logs")} className={`pb-1 text-sm font-medium ${activeTab === 'logs' ? 'text-indigo-400 border-b-2 border-indigo-400' : 'text-gray-400 hover:text-gray-300'}`}>Logs</button>
                    </div>
                    {activeTab === 'chat' ? (
                        <div className="flex-1 overflow-y-auto mb-3 space-y-2 bg-gray-900/50 p-3 rounded nowheel nodrag">
                            {messages.length === 0 ? (
                                <div className="text-gray-500 text-sm text-center py-4">No hay mensajes</div>
                            ) : (
                                messages.map((msg: any, i: number) => (
                                    <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : ""}`}>
                                        <div className={`px-3 py-2 rounded text-sm max-w-[90%] ${msg.role === "user" ? "bg-indigo-700 text-white" : "bg-gray-800 text-gray-200"}`}>
                                            <div className="whitespace-pre-wrap">{msg.text}</div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    ) : (
                        <div className="flex-1 overflow-y-auto mb-3 bg-black/80 p-3 rounded nowheel nodrag border border-gray-700 font-mono text-xs text-green-400">
                            <pre className="whitespace-pre-wrap">{logs}</pre>
                        </div>
                    )}
                    <div className="flex gap-2 shrink-0">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    data.onSendMessage(input, data.agentId, false);
                                    setInput("");
                                }
                            }}
                            className="flex-1 px-3 py-2 rounded bg-gray-700 border border-gray-600 text-sm focus:outline-none focus:border-indigo-500 nodrag"
                            placeholder={`Mensaje a ${data.label}...`}
                        />
                        <button onClick={() => { data.onSendMessage(input, data.agentId, false); setInput(""); }} className="bg-indigo-600 hover:bg-indigo-500 px-3 py-2 rounded text-sm nodrag font-medium">
                            Enviar
                        </button>
                    </div>
                </>
            )}
            <Handle type="source" position={Position.Right} className="w-3 h-3 bg-indigo-500" />
        </div>
    );
};

const GroupChatPanel = ({ messages, onSendMessage }: { messages: any[], onSendMessage: (msg: string, id: string | null, isGroup: boolean) => void }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [input, setInput] = useState("");

    return (
        <div className={`fixed bottom-4 right-4 z-50 bg-indigo-950 border border-indigo-500/50 rounded-lg shadow-2xl transition-all duration-300 flex flex-col overflow-hidden ${isExpanded ? 'w-[600px] h-[500px]' : 'w-[300px] h-[48px]'}`}>
            <div className="flex items-center justify-between px-4 py-3 cursor-pointer bg-indigo-900/80 hover:bg-indigo-800/80 transition-colors" onClick={() => setIsExpanded(!isExpanded)}>
                <div className="flex items-center gap-2">
                    <span className="text-xl">💬</span>
                    <div className="text-white font-medium text-base">Chat Grupal</div>
                </div>
                <button className="text-indigo-300 hover:text-white">
                    {isExpanded ? '▼' : '▲'}
                </button>
            </div>
            {isExpanded && (
                <div className="flex flex-col flex-1 bg-gray-900/90 p-3">
                    <div className="flex-1 overflow-y-auto mb-3 space-y-3 pr-2">
                        {messages.length === 0 ? (
                            <div className="text-gray-500 text-sm text-center py-4 flex flex-col items-center gap-2">
                                <span className="text-3xl opacity-50">🤖</span>
                                Mensaje para todos los agentes
                            </div>
                        ) : (
                            messages.map((msg: any, i: number) => (
                                <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : ""}`}>
                                    <div className={`px-3 py-2 rounded-lg text-sm max-w-[90%] shadow-md ${msg.role === "user" ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-200 border border-gray-700"}`}>
                                        {msg.role === "assistant" && msg.agent_id && (
                                            <div className="text-xs text-indigo-300 font-semibold mb-1 border-b border-gray-700/50 pb-1">{msg.agent_name || msg.agent_id}</div>
                                        )}
                                        <div className="whitespace-pre-wrap">{msg.text}</div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                    <div className="flex gap-2 shrink-0 bg-gray-800 p-2 rounded-lg border border-gray-700">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    onSendMessage(input, null, true);
                                    setInput("");
                                }
                            }}
                            className="flex-1 px-3 py-2 bg-transparent text-sm focus:outline-none text-white placeholder-gray-400"
                            placeholder="Mensaje para todos los agentes..."
                        />
                        <button onClick={() => { onSendMessage(input, null, true); setInput(""); }} className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded text-sm font-medium transition-colors shadow-lg">
                            Ejecutar
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export function AutoAgentsWidget() {
    const [agents, setAgents] = useState<AgentData[]>([]);
    const [groups, setGroups] = useState<AgentGroup[]>([]);
    const [tasks, setTasks] = useState<AgentTask[]>([]);
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
    const [chatMessages, setChatMessages] = useState<AgentChatMessage[]>([]);
    const [chatInput, setChatInput] = useState("");
    const [chatMode, setChatMode] = useState<"group" | "individual">("group");
    const [viewMode, setViewMode] = useState<"chat" | "edit" | "tasks" | "canvas">("chat");

    // React Flow State
    const [nodes, setNodes] = useState<Node[]>([]);
    const [edges, setEdges] = useState<Edge[]>([]);
    const [agentStatuses, setAgentStatuses] = useState<Record<string, "idle" | "running" | "success" | "error">>({});
    const nodeTypes = useRef({ agentNode: CustomAgentNode }).current;
    
    // Additional state moved up
    const [isLoading, setIsLoading] = useState(true);
    const [presetProvider, setPresetProvider] = useState<string>("custom");
    const [isDragging, setIsDragging] = useState(false);
    const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
    const aiConfigs = useAtomValue(atoms.gulinaiModeConfigAtom);
    
    // Config getters
    const resolveApiKey = useCallback((providerKey: string) => {
        if (!aiConfigs) return "";
        if (aiConfigs[providerKey]) {
            return aiConfigs[providerKey]["ai:apikey"] || aiConfigs[providerKey]["ai:apikey-secret"];
        }
        return "";
    }, [aiConfigs]);

    const resolveEndpoint = useCallback((providerKey: string) => {
        if (!aiConfigs) return "";
        if (aiConfigs[providerKey]) {
            return aiConfigs[providerKey]["ai:endpoint"];
        }
        return "";
    }, [aiConfigs]);

    // Send message to agents
    const sendMessage = useCallback(async (overridePrompt?: string, overrideAgentId?: string | null, isGroupOverride?: boolean) => {
        const promptToUse = overridePrompt || chatInput;
        if (!promptToUse.trim() && attachedFiles.length === 0) return;

        let finalPrompt = promptToUse;
        if (attachedFiles.length > 0) {
            finalPrompt += "\n\n[Contexto Adjunto]\nPor favor, lee y ten en cuenta los siguientes archivos:\n" + attachedFiles.map(p => `- ${p}`).join("\n");
        }

        const userMsg: AgentChatMessage = {
            role: "user",
            text: promptToUse + (attachedFiles.length > 0 ? `\n*(+${attachedFiles.length} archivos adjuntos)*` : ""),
            timestamp: new Date().toISOString(),
            is_group: isGroupOverride ?? (chatMode === "group"),
            agent_id: (!isGroupOverride && chatMode === "individual") ? (selectedAgentId || undefined) : undefined
        };
        setChatMessages(prev => [...prev, userMsg]);
        if (!overridePrompt) setChatInput("");
        setAttachedFiles([]);

        if (overrideAgentId || (chatMode === "individual" && selectedAgentId)) {
            const targetId = overrideAgentId || selectedAgentId;
            const agent = agents.find(a => a.id === targetId);
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

            const endpoint = resolveEndpoint(agent.provider) || agent.endpoint;
            
            // Create a temporary ID for streaming message
            const tempMsgId = "msg-" + Date.now().toString();
            const initialAgentMsg: AgentChatMessage = {
                role: "assistant",
                agent_id: agent.id,
                text: "...",
                timestamp: new Date().toISOString(),
                is_group: false
            };
            // Add the placeholder to the state (we append an _id for tracking)
            setChatMessages(prev => [...prev, { ...initialAgentMsg, _tempId: tempMsgId } as any]);

            setAgentStatuses(prev => ({ ...prev, [agent.id]: "running" }));
            try {
                let accumulatedResp = "";
                await callAgentAPI(agent, finalPrompt, apiKey, endpoint, aiConfigs, (chunk: string, fullMsg: string) => {
                    accumulatedResp = fullMsg;
                    // Update the specific message in state
                    setChatMessages(prev => prev.map(msg => 
                        (msg as any)._tempId === tempMsgId 
                            ? { ...msg, text: fullMsg } 
                            : msg
                    ));
                });
                
                // Final update without tempId
                setChatMessages(prev => prev.map(msg => 
                    (msg as any)._tempId === tempMsgId 
                        ? { role: "assistant", agent_id: agent.id, text: accumulatedResp, timestamp: new Date().toISOString(), is_group: false } 
                        : msg
                ));
                setAgentStatuses(prev => ({ ...prev, [agent.id]: "success" }));
            } catch (err: any) {
                console.error("Chat error:", err);
                setAgentStatuses(prev => ({ ...prev, [agent.id]: "error" }));
                setChatMessages(prev => prev.map(msg => 
                    (msg as any)._tempId === tempMsgId 
                        ? { role: "assistant", agent_id: agent.id, text: `Error: ${err.message}`, timestamp: new Date().toISOString(), is_group: false } 
                        : msg
                ));
            }
            setTimeout(() => setAgentStatuses(prev => ({ ...prev, [agent.id]: "idle" })), 3000);
        } else {
            // Group chat logic
            const enabledAgents = agents.filter(a => a.enabled);
            if (enabledAgents.length === 0) return;

            enabledAgents.forEach(async (agent) => {
                const apiKey = resolveApiKey(agent.provider) || agent.api_key_secret;
                if (!apiKey || apiKey.includes("_KEY")) {
                    const errorMsg: AgentChatMessage = {
                        role: "assistant",
                        agent_id: agent.id,
                        agent_name: agent.name,
                        text: `Error: No se encontró la API Key para el proveedor '${agent.provider}'.`,
                        timestamp: new Date().toISOString(),
                        is_group: true
                    };
                    setChatMessages(prev => [...prev, errorMsg]);
                    return;
                }

                const endpoint = resolveEndpoint(agent.provider) || agent.endpoint;
                
                const tempMsgId = "msg-" + agent.id + "-" + Date.now().toString();
                const initialAgentMsg: AgentChatMessage = {
                    role: "assistant",
                    agent_id: agent.id,
                    agent_name: agent.name,
                    text: "...",
                    timestamp: new Date().toISOString(),
                    is_group: true
                };
                setChatMessages(prev => [...prev, { ...initialAgentMsg, _tempId: tempMsgId } as any]);

                setAgentStatuses(prev => ({ ...prev, [agent.id]: "running" }));
                try {
                    let accumulatedResp = "";
                    await callAgentAPI(agent, finalPrompt, apiKey, endpoint, aiConfigs, (chunk: string, fullMsg: string) => {
                        accumulatedResp = fullMsg;
                        setChatMessages(prev => prev.map(msg => 
                            (msg as any)._tempId === tempMsgId 
                                ? { ...msg, text: fullMsg } 
                                : msg
                        ));
                    });
                    
                    setChatMessages(prev => prev.map(msg => 
                        (msg as any)._tempId === tempMsgId 
                            ? { role: "assistant", agent_id: agent.id, agent_name: agent.name, text: accumulatedResp, timestamp: new Date().toISOString(), is_group: true } 
                            : msg
                    ));
                    setAgentStatuses(prev => ({ ...prev, [agent.id]: "success" }));
                } catch (err: any) {
                    console.error("Group Chat error for", agent.name, ":", err);
                    setAgentStatuses(prev => ({ ...prev, [agent.id]: "error" }));
                    setChatMessages(prev => prev.map(msg => 
                        (msg as any)._tempId === tempMsgId 
                            ? { role: "assistant", agent_id: agent.id, agent_name: agent.name, text: `Error: ${err.message}`, timestamp: new Date().toISOString(), is_group: true } 
                            : msg
                    ));
                }
                setTimeout(() => setAgentStatuses(prev => ({ ...prev, [agent.id]: "idle" })), 3000);
            });
        }
    }, [chatInput, attachedFiles, chatMode, selectedAgentId, agents, aiConfigs, resolveApiKey, resolveEndpoint]);

    const onNodesChange = useCallback(
        (changes: any) => setNodes((nds) => applyNodeChanges(changes, nds)),
        []
    );
    const onEdgesChange = useCallback(
        (changes: any) => setEdges((eds) => applyEdgeChanges(changes, eds)),
        []
    );
    const onConnect = useCallback(
        (params: any) => setEdges((eds) => addEdge(params, eds)),
        []
    );

    useEffect(() => {
        setNodes((prev) => {
            const prevMap = new Map(prev.map(n => [n.id, n]));
            const newNodes: Node[] = [];
            
            // Add Agent Nodes
            agents.forEach((agent, i) => {
                const existing = prevMap.get(agent.id);
                newNodes.push(existing ? { 
                    ...existing, 
                    data: { 
                        ...existing.data, 
                        label: agent.name, 
                        status: agentStatuses[agent.id] || "idle",
                        messages: chatMessages.filter(m => !m.is_group && m.agent_id === agent.id),
                        onSendMessage: sendMessage,
                        agentId: agent.id,
                        onConfigClick: () => { setSelectedAgentId(agent.id); setViewMode("edit"); }
                    } 
                } : {
                    id: agent.id,
                    type: 'agentNode',
                    position: { x: (i % 3) * 450 + 100, y: Math.floor(i / 3) * 300 + 100 },
                    data: { 
                        label: agent.name,
                        status: agentStatuses[agent.id] || "idle",
                        messages: chatMessages.filter(m => !m.is_group && m.agent_id === agent.id),
                        onSendMessage: sendMessage,
                        agentId: agent.id,
                        onConfigClick: () => { setSelectedAgentId(agent.id); setViewMode("edit"); }
                    }
                });
            });
            return newNodes;
        });
    }, [agents, agentStatuses, chatMessages, sendMessage]);

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
        // Fallback: try reading using dynamic config directory
        try {
            const configDir = await window.api.getConfigDir();
            const filePath = `${configDir}/${CONFIG_PATH}`;
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


    // Cron Runner
    useEffect(() => {
        const interval = setInterval(() => {
            const now = new Date();
            const nowMin = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()).getTime();

            tasks.forEach(task => {
                if (!task.enabled) return;

                const agent = agents.find(a => a.id === task.agent_id);
                if (!agent) return;

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

        const endpoint = resolveEndpoint(agent.provider) || agent.endpoint;

        try {
            const resp = await callAgentAPI(agent, task.prompt, apiKey, endpoint, aiConfigs);
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
            system_prompt: "Eres un experto. REGLA ESTRICTA: NO inventes ni asumas información del entorno (bases de datos, archivos, etc). SIEMPRE usa tus herramientas para explorar el entorno primero (ej. ver conexiones DB, leer archivos), o haz preguntas aclaratorias al usuario si te falta contexto.",
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
        <div className="flex flex-col h-full w-full bg-[#1a1a2e] text-gray-200 relative">
            {/* Header / Floating Controls */}
            <div className="absolute top-4 left-4 z-10 flex gap-2">
                <div className="flex items-center gap-2 bg-gray-800/80 p-2 px-4 rounded-lg shadow-lg border border-gray-700 backdrop-blur">
                    <span className="text-xl">🤖</span>
                    <span className="font-semibold text-sm">Lienzo de Orquestación</span>
                </div>
            </div>
            <div className="absolute top-4 right-4 z-10 flex gap-2">
                <button
                    onClick={createAgent}
                    className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-lg border border-indigo-500/50 transition-colors font-medium flex items-center gap-2"
                >
                    + Nuevo Agente
                </button>
            </div>

            {/* Main Canvas Area */}
            <div className="flex-1 w-full h-full bg-[#1a1a2e]">
                <ReactFlow
                    nodes={nodes}
                    edges={edges.map(e => ({ ...e, animated: agentStatuses[e.source] === "running" }))}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    nodeTypes={nodeTypes}
                    fitView
                    colorMode="dark"
                >
                    <Background />
                    <Controls />
                </ReactFlow>
            </div>
            
            {/* Group Chat Fixed Panel */}
            <GroupChatPanel messages={chatMessages.filter(m => m.is_group)} onSendMessage={sendMessage} />

            {/* Configuration Modal */}
            {selectedAgent && viewMode === "edit" && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
                        <div className="flex items-center justify-between p-4 border-b border-gray-700">
                            <h3 className="text-lg font-medium text-indigo-400">Configuración: {selectedAgent.name}</h3>
                            <button onClick={() => setViewMode("canvas")} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
                        </div>
                        <div className="p-6 overflow-y-auto space-y-6">
                                {(() => {
                                    // 1. Filtrar los configs del sistema (gulin) y ordenar
                                    const otherProviderConfigs = Object.entries(aiConfigs || {})
                                        .filter(([key, config]: [string, any]) => config["ai:provider"] !== "gulin")
                                        .map(([key, config]: [string, any]) => ({ key, ...config }))
                                        .sort((a, b) => {
                                            const provA = (a["ai:bridge-provider"] || a["ai:provider"] || "custom").toLowerCase();
                                            const provB = (b["ai:bridge-provider"] || b["ai:provider"] || "custom").toLowerCase();
                                            if (provA !== provB) return provA.localeCompare(provB);
                                            const nameA = (a.name || a.key).toLowerCase();
                                            const nameB = (b.name || b.key).toLowerCase();
                                            return nameA.localeCompare(nameB);
                                        });

                                    // 2. Obtener proveedores únicos
                                    const uniqueProviders = Array.from(new Set(otherProviderConfigs.map(c => c["ai:bridge-provider"] || c["ai:provider"] || "custom")));
                                    if (uniqueProviders.length === 0) uniqueProviders.push("custom");
                                    
                                    // 3. Determinar el proveedor y modelo actual basado en agent.provider (que guarda el configKey)
                                    const currentConfig = aiConfigs?.[selectedAgent.provider];
                                    let currentProvider = "custom";
                                    if (currentConfig && currentConfig["ai:provider"] !== "gulin") {
                                        currentProvider = currentConfig["ai:bridge-provider"] || currentConfig["ai:provider"] || "custom";
                                    }

                                    // 4. Obtener modelos para el proveedor seleccionado
                                    const providerModels = otherProviderConfigs.filter(c => (c["ai:bridge-provider"] || c["ai:provider"] || "custom") === currentProvider);

                                    return (
                                        <div className="mb-6 flex gap-4 bg-gray-800/30 p-4 rounded border border-gray-700/50">
                                            <div className="flex-1 flex flex-col">
                                                <label className="text-[10px] text-gray-500 mb-1 font-bold tracking-wider uppercase">Proveedor</label>
                                                <select 
                                                    className="w-full px-3 py-2 bg-[#1e1e24] border border-gray-700 rounded text-sm text-gray-200 focus:border-indigo-500 outline-none capitalize"
                                                    value={currentProvider}
                                                    onChange={(e) => {
                                                        const newProvider = e.target.value;
                                                        const firstModel = otherProviderConfigs.find(c => (c["ai:bridge-provider"] || c["ai:provider"] || "custom") === newProvider);
                                                        if (firstModel) {
                                                            handleUpdateAgent({...selectedAgent, provider: firstModel.key, model: ""});
                                                        }
                                                    }}
                                                >
                                                    {uniqueProviders.map(p => (
                                                        <option key={p} value={p}>{p}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="flex-1 flex flex-col">
                                                <label className="text-[10px] text-gray-500 mb-1 font-bold tracking-wider uppercase">Modelo</label>
                                                <select 
                                                    className="w-full px-3 py-2 bg-[#1e1e24] border border-gray-700 rounded text-sm text-gray-200 focus:border-indigo-500 outline-none"
                                                    value={selectedAgent.provider}
                                                    onChange={(e) => {
                                                        handleUpdateAgent({...selectedAgent, provider: e.target.value, model: ""});
                                                    }}
                                                >
                                                    {!currentConfig && <option value={selectedAgent.provider} disabled>✨ Selecciona un modelo...</option>}
                                                    {providerModels.map(c => (
                                                        <option key={c.key} value={c.key}>
                                                            {c.name || c.key} {c["ai:model"] ? `(${c["ai:model"]})` : ""}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    );
                                })()}

                                <div className="grid grid-cols-2 gap-6 pb-6 border-b border-gray-700">
                                    <div className="flex flex-col">
                                        <label className="text-xs text-gray-400 mb-1">Nombre</label>
                                        <input type="text" onFocus={e => e.target.select()} value={selectedAgent.name} onChange={e => handleUpdateAgent({...selectedAgent, name: e.target.value})} className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:border-indigo-500 outline-none" />
                                    </div>
                                    <div className="flex flex-col">
                                        <label className="text-xs text-gray-400 mb-1">Icono (Emoji)</label>
                                        <input type="text" onFocus={e => e.target.select()} value={selectedAgent.icon} onChange={e => handleUpdateAgent({...selectedAgent, icon: e.target.value})} className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:border-indigo-500 outline-none" />
                                    </div>
                                    <div className="col-span-2 flex flex-col">
                                        <label className="text-xs text-gray-400 mb-1">System Prompt (Instrucciones)</label>
                                        <textarea rows={5} value={selectedAgent.system_prompt} onChange={e => handleUpdateAgent({...selectedAgent, system_prompt: e.target.value})} className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:border-indigo-500 outline-none resize-none font-mono" />
                                    </div>
                                </div>
                                
                                <div className="flex justify-between pt-2">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); deleteAgent(selectedAgent.id); setViewMode("canvas"); }}
                                        className="px-4 py-2 bg-red-900/50 hover:bg-red-800 text-red-200 rounded text-sm transition-colors"
                                    >
                                        Eliminar Agente
                                    </button>
                                    <button
                                        onClick={() => setViewMode("canvas")}
                                        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-medium transition-colors"
                                    >
                                        Guardar y Cerrar
                                    </button>
                                </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Helper: Call agent's API endpoint
async function callAgentAPI(agent: AgentData, prompt: string, apiKey: string, endpoint: string, aiConfigs?: any, onUpdate?: (chunk: string, fullMsg: string) => void): Promise<string> {
    const chatID = "agent-" + agent.id + "-" + Date.now().toString();

    const requestBody = {
        chatid: chatID,
        msg: {
            messageid: "msg-" + Date.now(),
            role: "user",
            parts: [{ type: "text", text: prompt }]
        },
        endpoint: endpoint, 
        apikey: apiKey,
        model: agent.model,
        provider: agent.provider,
        systemprompt: agent.system_prompt,
        tabid: ""
    };

    let fullMsg = "";
    try {
        const response = await fetch(`${getWebServerEndpoint()}/api/agent-chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (reader) {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                
                const lines = chunk.split("\n");
                for (const line of lines) {
                    if (line.startsWith("data:")) {
                        const dataStr = line.substring(5).trim();
                        if (dataStr === "[DONE]") continue;
                        try {
                            const data = JSON.parse(dataStr);
                            if (data.type === "text-delta" && typeof data.delta === "string") {
                                fullMsg += data.delta;
                                if (onUpdate) onUpdate(data.delta, fullMsg);
                            } else if (data.type === "tool-input-start" && data.tool_name) {
                                const msg = `\n\n[⚙️ Herramienta: ${data.tool_name}...]\n`;
                                fullMsg += msg;
                                if (onUpdate) onUpdate(msg, fullMsg);
                            } else if (data.text) {
                                fullMsg += data.text;
                                if (onUpdate) onUpdate(data.text, fullMsg);
                            } else if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
                                const contentChunk = data.choices[0].delta.content;
                                fullMsg += contentChunk;
                                if (onUpdate) onUpdate(contentChunk, fullMsg);
                            } else if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.tool_calls) {
                                const toolCall = data.choices[0].delta.tool_calls[0];
                                if (toolCall?.function?.name) {
                                    const msg = `\n\n[⚙️ Herramienta: ${toolCall.function.name}...]\n`;
                                    fullMsg += msg;
                                    if (onUpdate) onUpdate(msg, fullMsg);
                                }
                            } else if (data.error) {
                                fullMsg += "\n[Error del servidor]: " + data.error;
                                if (onUpdate) onUpdate(data.error, fullMsg);
                            } else if (typeof data === "string") {
                                fullMsg += data;
                                if (onUpdate) onUpdate(data, fullMsg);
                            }
                        } catch(e) {
                            // En caso de que Vercel AI SDK devuelva formato 0:"..." (text)
                            if (dataStr.startsWith("0:")) {
                                try {
                                    const textChunk = JSON.parse(dataStr.substring(2));
                                    fullMsg += textChunk;
                                    if (onUpdate) onUpdate(textChunk, fullMsg);
                                } catch(e2) {}
                            } else if (dataStr.startsWith("3:")) {
                                // Vercel AI SDK format for errors
                                try {
                                    const errChunk = JSON.parse(dataStr.substring(2));
                                    fullMsg += "\n[Error]: " + errChunk;
                                    if (onUpdate) onUpdate(errChunk, fullMsg);
                                } catch(e2) {}
                            } else if (dataStr.startsWith("9:")) {
                                const toolMsg = "\n[⚙️ Ejecutando herramienta...]";
                                fullMsg += toolMsg;
                                if (onUpdate) onUpdate(toolMsg, fullMsg);
                            } else if (dataStr.startsWith("a:")) {
                                const toolMsg = "\n[✅ Resultado obtenido]";
                                fullMsg += toolMsg;
                                if (onUpdate) onUpdate(toolMsg, fullMsg);
                            } else if (dataStr.startsWith("e:")) {
                                // Another common error prefix
                                fullMsg += "\n[Error]: " + dataStr.substring(2);
                                if (onUpdate) onUpdate(dataStr.substring(2), fullMsg);
                            }
                        }
                    }
                }
            }
        }

        if (!fullMsg) {
            fullMsg = "El agente completó la tarea silenciosamente usando herramientas.";
            if (onUpdate) onUpdate(fullMsg, fullMsg);
        }
        return fullMsg;
    } catch (err: any) {
        fullMsg += `\n[Error de Conexión]: ${err.message}`;
        throw new Error(`Error conectando al backend: ${err.message}`);
    } finally {
        try {
            fetch(`${getWebServerEndpoint()}/api/agent-log`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    agentid: agent.id,
                    agentname: agent.label || agent.name || "Agent",
                    log: `--- [Prompt] ---\n${prompt}\n\n--- [Respuesta] ---\n${fullMsg}\n`
                })
            }).catch(e => console.error("Error guardando log", e));
        } catch(e) {}
    }
}
