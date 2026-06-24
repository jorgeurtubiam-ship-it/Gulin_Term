// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { BlockNodeModel } from "@/app/block/blocktypes";
import { TabModel } from "@/app/store/tab-model";
import { WOS, globalStore } from "@/store/global";
import { ChatSummary, BrainSummary } from "@/app/aipanel/aitypes";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import clsx from "clsx";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "./memorygrid.scss";

import { GulinAIModel } from "@/app/aipanel/gulinai-model";
import { getApi } from "@/store/global";
import { getWebServerEndpoint } from "@/util/endpoints";

dayjs.extend(relativeTime);

class MemoryGridViewModel implements ViewModel {
    viewType: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    blockId: string;
    blockAtom: jotai.Atom<Block>;
    viewIcon: jotai.Atom<string>;
    viewText: jotai.Atom<string>;
    viewName: jotai.Atom<string>;

    chatsAtom = jotai.atom<ChatSummary[]>([]);
    brainsAtom = jotai.atom<BrainSummary[]>([]);
    loadingAtom = jotai.atom<boolean>(true);
    viewModeAtom = jotai.atom<"grid" | "list">("grid");

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.viewType = "memory-grid";
        this.blockId = blockId;
        this.blockAtom = WOS.getGulinObjectAtom<Block>(`block:${blockId}`);
        this.viewIcon = jotai.atom("brain");
        this.viewName = jotai.atom("Memoria y Chats");
        this.loadData();
    }

    async loadData() {
        globalStore.set(this.loadingAtom, true);
        try {
            const endpoint = getWebServerEndpoint();
            const headers = {
                "X-AuthKey": getApi().getAuthKey()
            };
            const [chatsResp, brainsResp] = await Promise.all([
                fetch(`${endpoint}/gulin/chat-list`, { headers }),
                fetch(`${endpoint}/gulin/brain-list`, { headers })
            ]);
            if (!chatsResp.ok || !brainsResp.ok) {
                console.error("Failed to load memory grid data", chatsResp.status, brainsResp.status);
                return;
            }
            const chats = await chatsResp.json();
            const brains = await brainsResp.json();
            globalStore.set(this.chatsAtom, chats || []);
            globalStore.set(this.brainsAtom, brains || []);
        } catch (e) {
            console.error("Error loading memory grid data", e);
        } finally {
            globalStore.set(this.loadingAtom, false);
        }
    }

    handleChatClick(chatId: string) {
        const aiModel = GulinAIModel.getInstance();
        aiModel.switchToChat(chatId);
        aiModel.toggleSidebar(false);
        aiModel.focusInput();
    }

    async handleBrainClick(filename: string) {
        const aiModel = GulinAIModel.getInstance();
        aiModel.focusInput();
        aiModel.appendText(`@Gulin recuérdame lo que sabes sobre este tema del archivo: ${filename}`, true);
    }

    get viewComponent(): ViewComponent {
        return MemoryGridView;
    }
}

function MemoryGridView({ model }: { model: MemoryGridViewModel }) {
    const chats = jotai.useAtomValue(model.chatsAtom) || [];
    const brains = jotai.useAtomValue(model.brainsAtom) || [];
    const loading = jotai.useAtomValue(model.loadingAtom);
    const viewMode = jotai.useAtomValue(model.viewModeAtom);

    const setViewMode = (mode: "grid" | "list") => {
        globalStore.set(model.viewModeAtom, mode);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full text-muted">
                <i className="fa fa-spinner fa-spin mr-2"></i> Cargando memorias...
            </div>
        );
    }

    return (
        <div className="h-full w-full flex flex-col bg-zinc-950 overflow-hidden">
            <OverlayScrollbarsComponent
                className="memory-grid-container flex-1 w-full p-6 text-secondary overflow-y-auto"
                options={{ scrollbars: { autoHide: "leave" } }}
            >
                <div className="max-w-6xl mx-auto">
                <header className="mb-10 text-center">
                    <h1 className="text-4xl font-bold text-white mb-2 flex items-center justify-center gap-3">
                        <i className="fa fa-brain text-accent"></i>
                        Gulin Dashboard
                    </h1>
                    <p className="text-muted text-lg">
                        Centro de control de tus memorias y conversaciones pasadas.
                    </p>
                </header>

                <section className="mb-12">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                            <i className="fa fa-comments text-blue-400"></i>
                            Conversaciones Recientes
                        </h2>
                        <div className="flex bg-zinc-900 p-1 rounded-lg border border-zinc-800">
                            <button
                                onClick={() => setViewMode("grid")}
                                className={clsx(
                                    "px-3 py-1.5 rounded-md text-xs transition-all flex items-center gap-2",
                                    viewMode === "grid" ? "bg-blue-600 text-white shadow-lg" : "text-muted hover:text-white"
                                )}
                            >
                                <i className="fa fa-th-large"></i> Grilla
                            </button>
                            <button
                                onClick={() => setViewMode("list")}
                                className={clsx(
                                    "px-3 py-1.5 rounded-md text-xs transition-all flex items-center gap-2",
                                    viewMode === "list" ? "bg-blue-600 text-white shadow-lg" : "text-muted hover:text-white"
                                )}
                            >
                                <i className="fa fa-list"></i> Lista
                            </button>
                        </div>
                    </div>
                    <div className={clsx(viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" : "flex flex-col gap-3")}>
                        {chats.map(chat => (
                            viewMode === "grid" ? (
                                <div
                                    key={chat.chatid}
                                    onClick={() => model.handleChatClick(chat.chatid)}
                                    className="group bg-zinc-900/50 border border-zinc-800 p-5 rounded-xl hover:border-blue-500/50 hover:bg-zinc-800/80 transition-all cursor-pointer shadow-lg hover:shadow-blue-900/20 flex flex-col h-[180px]"
                                >
                                    <div className="flex justify-between items-start mb-3">
                                        <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded uppercase font-bold tracking-wider">
                                            {chat.model || "AI Chat"}
                                        </span>
                                        <span className="text-[11px] text-muted">
                                            {dayjs(chat.lastupdate).fromNow()}
                                        </span>
                                    </div>
                                    <p className="text-sm line-clamp-3 text-zinc-300 leading-relaxed flex-grow">
                                        {chat.snippet || "Sin contenido..."}
                                    </p>
                                    <div className="mt-4 pt-3 border-t border-zinc-800/50 flex items-center justify-between text-[11px] text-muted">
                                        <span className="flex items-center gap-1">
                                            <i className="fa fa-message text-[9px]"></i>
                                            {chat.messagecount} mensajes
                                        </span>
                                        <span className="text-blue-400 opacity-0 group-hover:opacity-100 transition-all flex items-center gap-1">
                                            Continuar <i className="fa fa-arrow-right text-[9px]"></i>
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                <div
                                    key={chat.chatid}
                                    onClick={() => model.handleChatClick(chat.chatid)}
                                    className="group bg-zinc-900/40 border border-zinc-800/50 p-4 rounded-lg hover:border-blue-500/30 hover:bg-zinc-800/60 transition-all cursor-pointer flex items-center gap-4"
                                >
                                    <div className="bg-blue-500/10 w-10 h-10 flex items-center justify-center rounded-full text-blue-400 shrink-0">
                                        <i className="fa fa-comment-dots"></i>
                                    </div>
                                    <div className="flex-grow min-w-0">
                                        <div className="flex items-center gap-3 mb-1">
                                            <span className="font-semibold text-white truncate max-w-[200px]">
                                                {chat.model || "AI Chat"}
                                            </span>
                                            <span className="text-[10px] text-muted italic">
                                                {dayjs(chat.lastupdate).fromNow()}
                                            </span>
                                        </div>
                                        <p className="text-xs text-zinc-400 line-clamp-1">
                                            {chat.snippet || "Sin contenido..."}
                                        </p>
                                    </div>
                                    <div className="text-[11px] text-muted flex items-center gap-4 shrink-0">
                                        <span className="hidden sm:inline">{chat.messagecount} msg</span>
                                        <i className="fa fa-chevron-right opacity-0 group-hover:opacity-100 transition-all"></i>
                                    </div>
                                </div>
                            )
                        ))}
                    </div>
                </section>

                <section>
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                            <i className="fa fa-book text-amber-500"></i>
                            Memoria a Largo Plazo (Brain)
                        </h2>
                    </div>
                    <div className={clsx(viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" : "flex flex-col gap-3")}>
                        {brains.map(brain => (
                            viewMode === "grid" ? (
                                <div
                                    key={brain.filename}
                                    onClick={() => model.handleBrainClick(brain.filename)}
                                    className="group bg-zinc-900/50 border border-zinc-800 p-5 rounded-xl hover:border-amber-500/50 hover:bg-zinc-800/80 transition-all cursor-pointer shadow-lg hover:shadow-amber-900/20 flex flex-col h-[180px]"
                                >
                                    <div className="flex justify-between items-start mb-3">
                                        <span className="text-sm font-bold text-amber-200">
                                            {brain.title}
                                        </span>
                                        <span className="text-[11px] text-muted">
                                            {dayjs(brain.lastupdate).fromNow()}
                                        </span>
                                    </div>
                                    <p className="text-sm line-clamp-3 text-zinc-400 leading-relaxed italic flex-grow">
                                        "{brain.snippet}..."
                                    </p>
                                    <div className="mt-4 pt-3 border-t border-zinc-800/50 flex items-center justify-between text-[11px] text-muted">
                                        <span className="flex items-center gap-1 uppercase tracking-tighter text-[9px] text-amber-500/50">
                                            Reflective Memory
                                        </span>
                                        <span className="text-amber-500 opacity-0 group-hover:opacity-100 transition-all flex items-center gap-1">
                                            Consultar <i className="fa fa-magnifying-glass text-[9px]"></i>
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                <div
                                    key={brain.filename}
                                    onClick={() => model.handleBrainClick(brain.filename)}
                                    className="group bg-zinc-900/40 border border-zinc-800/50 p-4 rounded-lg hover:border-amber-500/30 hover:bg-zinc-800/60 transition-all cursor-pointer flex items-center gap-4"
                                >
                                    <div className="bg-amber-500/10 w-10 h-10 flex items-center justify-center rounded-full text-amber-500 shrink-0">
                                        <i className="fa fa-book-open"></i>
                                    </div>
                                    <div className="flex-grow min-w-0">
                                        <div className="flex items-center gap-3 mb-1">
                                            <span className="font-semibold text-white truncate">
                                                {brain.title}
                                            </span>
                                            <span className="text-[10px] text-muted italic">
                                                {dayjs(brain.lastupdate).fromNow()}
                                            </span>
                                        </div>
                                        <p className="text-xs text-zinc-400 line-clamp-1">
                                            {brain.snippet}
                                        </p>
                                    </div>
                                    <div className="text-[11px] text-muted flex items-center gap-4 shrink-0">
                                        <span className="hidden sm:inline uppercase text-[9px] tracking-tight">Reflective</span>
                                        <i className="fa fa-chevron-right opacity-0 group-hover:opacity-100 transition-all"></i>
                                    </div>
                                </div>
                            )
                        ))}
                    </div>
                </section>
            </div>
        </OverlayScrollbarsComponent>
        </div>
    );
}

export { MemoryGridViewModel };
