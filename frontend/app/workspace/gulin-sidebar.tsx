// Copyright 2026, GuLiN Terminal
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useMemo } from "react";
import { createBlock } from "@/store/global";
import { WindowService } from "@/app/store/services";
import { useAtomValue, useAtom } from "jotai";
import { GulinAIModel } from "@/app/aipanel/gulinai-model";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";

interface SidebarItem {
    id: string;
    label: string;
    icon: string;
    badge?: string;
    view?: string;
}

interface SidebarSection {
    title: string;
    items: SidebarItem[];
}

function cleanChatTitle(snippet?: string, title?: string, chatId?: string): string {
    let text = (snippet || title || "").trim();
    if (!text) return `Chat ${(chatId || "").substring(0, 6)}`;

    // If text is raw JSON string (e.g. {"message": "..."} or {"data": "..."})
    if (text.startsWith("{") && (text.endsWith("}") || text.includes('":"'))) {
        try {
            const parsed = JSON.parse(text);
            if (typeof parsed.message === "string") text = parsed.message;
            else if (typeof parsed.data === "string") text = parsed.data;
            else if (typeof parsed.query === "string") text = parsed.query;
            else if (typeof parsed.cmd === "string") text = parsed.cmd;
            else if (typeof parsed.prompt === "string") text = parsed.prompt;
            else {
                const firstVal = Object.values(parsed).find(v => typeof v === "string");
                if (firstVal) text = firstVal as string;
            }
        } catch {
            // Regex fallback for truncated JSON like {"message":"request was...
            const msgMatch = text.match(/"(?:message|data|query|cmd|prompt)"\s*:\s*"([^"]+)"?/i);
            if (msgMatch && msgMatch[1]) {
                text = msgMatch[1];
            } else {
                text = text.replace(/^{"[^"]+":/, "").replace(/[{}"]/g, "");
            }
        }
    }

    // Clean common command execution echo patterns
    if (text.includes("spawn ssh") || text.includes("Command sent to terminal")) {
        text = "Sesión de Terminal";
    }

    // Remove markdown formatting
    text = text
        .replace(/^#+\s*/, "")
        .replace(/\*\*/g, "")
        .replace(/\*/g, "")
        .replace(/`/g, "")
        .replace(/\\n/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (!text) return title || `Chat ${(chatId || "").substring(0, 6)}`;
    return text.length > 28 ? text.substring(0, 28) + "..." : text;
}

export const GulinSidebar = () => {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [activeId, setActiveId] = useState<string>("chat_main");
    
    // Estado de selección y carpetas colapsadas
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
    const [isSelectionMode, setIsSelectionMode] = useState(false);

    // Modelo de IA e historial de chats reales de GuLiN
    const model = GulinAIModel.getInstance();
    const chatSummaries = (useAtomValue(model.chatSummaries as any) || []) as any[];
    const activeChatId = useAtomValue(model.chatId as any);

    useEffect(() => {
        if (typeof model.loadChatSummaries === "function") {
            model.loadChatSummaries();
        }
    }, []);

    const handleNewChat = () => {
        model.clearChat();
        setActiveId("chat_main");
        WorkspaceLayoutModel.getInstance().setAIPanelVisible(true);
    };

    const handleSwitchChat = (chatid: string) => {
        if (isSelectionMode) {
            toggleSelectChat(chatid);
            return;
        }
        model.switchToChat(chatid);
        setActiveId(`chat_${chatid}`);
        WorkspaceLayoutModel.getInstance().setAIPanelVisible(true);
    };

    const handleDeleteSingleChat = (e: React.MouseEvent, chatid: string) => {
        e.stopPropagation();
        if (confirm("¿Estás seguro de borrar esta conversación?")) {
            model.deleteChat(chatid);
        }
    };

    const handleExportSingleChat = (e: React.MouseEvent, s: any) => {
        e.stopPropagation();
        const textContent = s.snippet ? `Title: ${s.snippet}\nChat ID: ${s.chatid}\nDate: ${new Date(s.lastupdate).toLocaleString()}` : JSON.stringify(s, null, 2);
        const blob = new Blob([textContent], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `chat-${s.chatid.substring(0, 8)}.md`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const toggleSelectChat = (chatid: string) => {
        setSelectedIds(prev => 
            prev.includes(chatid) ? prev.filter(id => id !== chatid) : [...prev, chatid]
        );
    };

    const handleBulkDelete = () => {
        if (selectedIds.length === 0) return;
        if (confirm(`¿Borrar ${selectedIds.length} conversaciones seleccionadas?`)) {
            selectedIds.forEach(id => model.deleteChat(id));
            setSelectedIds([]);
            setIsSelectionMode(false);
        }
    };

    const handleBulkExport = () => {
        if (selectedIds.length === 0) return;
        const selectedChats = chatSummaries.filter((s: any) => selectedIds.includes(s.chatid));
        const blob = new Blob([JSON.stringify(selectedChats, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `gulin-chats-export-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const toggleFolder = (folderName: string) => {
        setCollapsedFolders(prev => ({ ...prev, [folderName]: !prev[folderName] }));
    };

    // Agrupación tipo Explorer por fecha
    const groupedChats = useMemo(() => {
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        
        const groups: Record<string, any[]> = {
            "Hoy": [],
            "Ayer": [],
            "Últimos 7 días": [],
            "Anteriores": []
        };

        chatSummaries.forEach((s: any) => {
            const diff = now - (s.lastupdate || now);
            if (diff < oneDay) {
                groups["Hoy"].push(s);
            } else if (diff < 2 * oneDay) {
                groups["Ayer"].push(s);
            } else if (diff < 7 * oneDay) {
                groups["Últimos 7 días"].push(s);
            } else {
                groups["Anteriores"].push(s);
            }
        });

        return groups;
    }, [chatSummaries]);

    const sections: SidebarSection[] = [
        {
            title: "Data & BI",
            items: [
                { id: "data_catalog", label: "Data Catalog", icon: "fa-diagram-project", view: "gulin-map", badge: "NEW" },
                { id: "knowledge_base", label: "Knowledge Base", icon: "fa-brain", view: "brain" },
                { id: "semantic_layer", label: "Semantic Layer", icon: "fa-layer-group", view: "sql-flow" },
                { id: "bi_workspace", label: "BI Workspace", icon: "fa-chart-pie", view: "dashboard" },
                { id: "dev_workspace", label: "Developer workspace", icon: "fa-code", badge: "NEW", view: "tools-admin" },
            ]
        },
        {
            title: "Library",
            items: [
                { id: "prompt_library", label: "Prompt Library", icon: "fa-bookmark", view: "preview" },
                { id: "skill_library", label: "Skill Library", icon: "fa-wand-magic-sparkles", view: "auto-agents" },
            ]
        },
        {
            title: "Integrations",
            items: [
                { id: "integrations", label: "Integrations", icon: "fa-puzzle-piece", view: "api-manager" },
                { id: "web_embedding", label: "Web Embedding", icon: "fa-globe", view: "web" },
                { id: "secrets", label: "Secrets", icon: "fa-key", view: "gulinconfig" },
                { id: "mcp_servers", label: "MCP Servers", icon: "fa-plug", view: "tools-admin" },
                { id: "model_registry", label: "Model Registry", icon: "fa-cubes", view: "gulinconfig" },
            ]
        },
        {
            title: "Observability",
            items: [
                { id: "analytics", label: "Analytics", icon: "fa-chart-line", view: "sysinfo" },
                { id: "swarm_traces", label: "Teamwork Gulin", icon: "fa-network-wired", view: "service-map" },
                { id: "traces_logs", label: "Traces & Logs", icon: "fa-list-check", view: "debug-logs" },
                { id: "audit_log", label: "Audit Log", icon: "fa-shield-halved", view: "universal-monitor" },
            ]
        }
    ];

    const handleItemClick = (item: SidebarItem) => {
        setActiveId(item.id);
        if (item.view) {
            createBlock({ meta: { view: item.view } as any }, false);
        }
    };

    return (
        <aside 
            className={`h-full bg-[#09090b] border-r border-white/10 flex flex-col transition-all duration-300 z-40 select-none flex-shrink-0 ${
                isCollapsed ? "w-14" : "w-64"
            }`}
        >
            {/* Header del Sidebar */}
            <div className="flex items-center justify-between p-3 border-b border-white/5">
                {!isCollapsed && (
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg bg-accent-500/20 border border-accent-500/40 flex items-center justify-center text-accent-400 font-bold text-xs shadow-sm">
                            G
                        </div>
                        <span className="font-bold text-sm tracking-wide text-zinc-100">GuLiN Enterprise</span>
                    </div>
                )}
                <button 
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-white/5 rounded-lg transition-colors ml-auto"
                    title={isCollapsed ? "Expandir menú" : "Colapsar menú"}
                >
                    <i className={`fa-solid ${isCollapsed ? "fa-indent" : "fa-outdent"}`}></i>
                </button>
            </div>

            {/* Botón de Nuevo Chat y Barra de Acciones de Conversación */}
            {!isCollapsed && (
                <div className="p-3 border-b border-white/5 space-y-2">
                    <button
                        onClick={handleNewChat}
                        className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-accent-500/20 hover:bg-accent-500/30 text-accent-300 border border-accent-500/40 rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer"
                    >
                        <i className="fa-solid fa-plus text-xs"></i>
                        <span>Nuevo Chat</span>
                    </button>

                    {/* Toolbar de selección / borrado / exportación */}
                    <div className="flex items-center justify-between pt-1">
                        <button
                            onClick={() => setIsSelectionMode(!isSelectionMode)}
                            className={`text-[10px] px-2 py-1 rounded-lg border font-semibold transition-all cursor-pointer ${
                                isSelectionMode 
                                    ? "bg-accent-500/30 text-accent-200 border-accent-500/50" 
                                    : "text-zinc-400 hover:text-zinc-200 border-white/10"
                            }`}
                        >
                            <i className="fa-solid fa-check-double mr-1"></i>
                            {isSelectionMode ? "Cancelar" : "Elegir"}
                        </button>

                        {isSelectionMode && selectedIds.length > 0 && (
                            <div className="flex items-center gap-1.5">
                                <button
                                    onClick={handleBulkExport}
                                    className="p-1 text-accent-400 hover:text-accent-200 bg-accent-500/10 hover:bg-accent-500/20 rounded-lg text-xs cursor-pointer"
                                    title="Exportar seleccionados"
                                >
                                    <i className="fa-solid fa-file-export"></i>
                                </button>
                                <button
                                    onClick={handleBulkDelete}
                                    className="p-1 text-red-400 hover:text-red-200 bg-red-500/10 hover:bg-red-500/20 rounded-lg text-xs cursor-pointer"
                                    title="Borrar seleccionados"
                                >
                                    <i className="fa-solid fa-trash"></i>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Contenido scrolleable principal */}
            <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4 custom-scrollbar">
                
                {/* Historial en formato Explorer / Carpetas por Fecha */}
                {!isCollapsed && (
                    <div className="space-y-2">
                        <div className="px-2 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider flex items-center justify-between">
                            <span>Explorer de Chats</span>
                            <span className="text-[9px] bg-zinc-800 text-accent-400 px-1.5 py-0.5 rounded-full font-bold">{chatSummaries.length}</span>
                        </div>
                        
                        <div className="max-h-72 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                            {Object.entries(groupedChats).map(([folderName, chats]) => {
                                if (chats.length === 0) return null;
                                const isFolderCollapsed = collapsedFolders[folderName];

                                return (
                                    <div key={folderName} className="space-y-1">
                                        {/* Encabezado de Carpeta */}
                                        <button
                                            onClick={() => toggleFolder(folderName)}
                                            className="w-full flex items-center gap-2 px-2 py-1 text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-white/5 rounded-lg transition-colors cursor-pointer"
                                        >
                                            <i className={`fa-solid ${isFolderCollapsed ? "fa-folder" : "fa-folder-open"} text-accent-400/80`}></i>
                                            <span className="flex-1 text-left">{folderName}</span>
                                            <span className="text-[9px] text-zinc-500">{chats.length}</span>
                                            <i className={`fa-solid ${isFolderCollapsed ? "fa-chevron-right" : "fa-chevron-down"} text-[9px] text-zinc-600`}></i>
                                        </button>

                                        {/* Elementos dentro de la Carpeta */}
                                        {!isFolderCollapsed && (
                                            <div className="pl-3 space-y-1 border-l border-white/5 ml-2">
                                                {chats.map((s: any) => {
                                                    const isActive = activeChatId === s.chatid;
                                                    const isSelected = selectedIds.includes(s.chatid);
                                                    const displayTitle = cleanChatTitle(s.snippet, s.title, s.chatid);

                                                    return (
                                                        <div
                                                            key={s.chatid}
                                                            onClick={() => handleSwitchChat(s.chatid)}
                                                            className={`group w-full flex items-center gap-2 px-2 py-1.5 rounded-xl text-xs transition-all cursor-pointer ${
                                                                isActive
                                                                    ? "bg-accent-500/20 text-accent-200 font-semibold border border-accent-500/40 shadow-sm"
                                                                    : isSelected
                                                                        ? "bg-accent-500/10 text-accent-300 border border-accent-500/20"
                                                                        : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
                                                            }`}
                                                            title={s.snippet || displayTitle}
                                                        >
                                                            {isSelectionMode ? (
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isSelected}
                                                                    onChange={() => toggleSelectChat(s.chatid)}
                                                                    className="w-3 h-3 accent-accent-500 cursor-pointer"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                />
                                                            ) : (
                                                                <i className="fa-regular fa-message text-[11px] text-accent-400/80 flex-shrink-0"></i>
                                                            )}
                                                            <span className="flex-1 text-left truncate leading-tight">{displayTitle}</span>

                                                            {/* Acciones al pasar el cursor (Hover) */}
                                                            {!isSelectionMode && (
                                                                <div className="hidden group-hover:flex items-center gap-1">
                                                                    <button
                                                                        onClick={(e) => handleExportSingleChat(e, s)}
                                                                        className="text-zinc-400 hover:text-accent-300 p-0.5"
                                                                        title="Exportar"
                                                                    >
                                                                        <i className="fa-solid fa-download text-[10px]"></i>
                                                                    </button>
                                                                    <button
                                                                        onClick={(e) => handleDeleteSingleChat(e, s.chatid)}
                                                                        className="text-zinc-400 hover:text-red-400 p-0.5"
                                                                        title="Borrar"
                                                                    >
                                                                        <i className="fa-solid fa-trash-can text-[10px]"></i>
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Secciones del Menú Enterprise */}
                {sections.map((section, idx) => (
                    <div key={idx} className="space-y-1">
                        {!isCollapsed && (
                            <div className="px-2 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
                                {section.title}
                            </div>
                        )}
                        {section.items.map((item) => {
                            const isActive = activeId === item.id;
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => handleItemClick(item)}
                                    className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-xs font-medium transition-all ${
                                        isActive 
                                            ? "bg-accent-500/15 text-accent-300 border border-accent-500/30 shadow-sm" 
                                            : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
                                    }`}
                                    title={isCollapsed ? item.label : undefined}
                                >
                                    <i className={`fa-solid ${item.icon} text-sm ${isActive ? "text-accent-400" : "text-zinc-400"}`}></i>
                                    {!isCollapsed && (
                                        <span className="flex-1 text-left truncate">{item.label}</span>
                                    )}
                                    {!isCollapsed && item.badge && (
                                        <span className="px-1.5 py-0.5 text-[9px] font-bold bg-accent-500/20 text-accent-300 border border-accent-500/40 rounded-full">
                                            {item.badge}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                ))}
            </div>

            {/* Footer con Usuario */}
            {!isCollapsed && (
                <div className="p-3 border-t border-white/5 bg-zinc-950/40 flex items-center justify-between">
                    <div className="flex items-center gap-2 overflow-hidden">
                        <div className="w-7 h-7 rounded-full bg-accent-500/20 border border-accent-500/40 flex items-center justify-center text-xs font-bold text-accent-400">
                            E
                        </div>
                        <div className="flex flex-col truncate">
                            <span className="text-xs font-semibold text-zinc-200 truncate">Empresa GuLiN</span>
                            <span className="text-[10px] text-zinc-500 truncate">enterprise@gulin.internal</span>
                        </div>
                    </div>
                    <button className="text-zinc-400 hover:text-red-400 p-1 transition-colors" title="Cerrar Sesión">
                        <i className="fa-solid fa-right-from-bracket text-xs"></i>
                    </button>
                </div>
            )}
        </aside>
    );
};
