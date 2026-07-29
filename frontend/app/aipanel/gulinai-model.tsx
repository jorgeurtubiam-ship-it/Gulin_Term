// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    UseChatSendMessageType,
    UseChatSetMessagesType,
    GulinUIMessage,
    GulinUIMessagePart,
    ChatSummary,
} from "@/app/aipanel/aitypes";
import { FocusManager } from "@/app/store/focusManager";
import { atoms, createBlock, getApi, getOrefMetaKeyAtom, getSettingsKeyAtom, globalStore, readAtom, replaceBlock } from "@/app/store/global";
import { isBuilderWindow } from "@/app/store/windowtype";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { DebugLogEntry } from "@/app/types/debuglog";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { BuilderFocusManager } from "@/builder/store/builder-focusmanager";
import { getWebServerEndpoint } from "@/util/endpoints";
import { base64ToArrayBuffer } from "@/util/util";
import { ChatStatus } from "ai";
import * as jotai from "jotai";
import type React from "react";
import {
    createDataUrl,
    createImagePreview,
    formatFileSizeError,
    isAcceptableFile,
    normalizeMimeType,
    resizeImage,
    validateFileSizeFromInfo,
} from "./ai-utils";
import type { AIPanelInputRef } from "./aipanelinput";

export interface DroppedFile {
    id: string;
    file: File;
    name: string;
    type: string;
    size: number;
    previewUrl?: string;
}

export class GulinAIModel {
    private static instance: GulinAIModel | null = null;
    inputRef: React.RefObject<AIPanelInputRef> | null = null;
    scrollToBottomCallback: (() => void) | null = null;
    useChatSendMessage: UseChatSendMessageType | null = null;
    useChatSetMessages: UseChatSetMessagesType | null = null;
    useChatStatus: ChatStatus = "ready";
    private useChatStop: () => void = null;
    private tabModel: any = null;
    // Used for injecting Gulin-specific message data into DefaultChatTransport's prepareSendMessagesRequest
    realMessage: AIMessage | null = null;
    orefContext: ORef;
    inBuilder: boolean = false;
    isAIStreaming = jotai.atom(false);

    widgetAccessAtom!: jotai.Atom<boolean>;
    droppedFiles: jotai.PrimitiveAtom<DroppedFile[]> = jotai.atom([]);
    chatId!: jotai.PrimitiveAtom<string>;
    currentAIMode!: jotai.PrimitiveAtom<string>;
    aiModeConfigs!: jotai.Atom<Record<string, AIModeConfigType>>;
    hasPremiumAtom!: jotai.Atom<boolean>;
    defaultModeAtom!: jotai.Atom<string>;
    errorMessage: jotai.PrimitiveAtom<string> = jotai.atom(null) as jotai.PrimitiveAtom<string>;
    containerWidth: jotai.PrimitiveAtom<number> = jotai.atom(0);
    codeBlockMaxWidth!: jotai.Atom<number>;
    inputAtom: jotai.PrimitiveAtom<string> = jotai.atom("");
    isLoadingChatAtom: jotai.PrimitiveAtom<boolean> = jotai.atom(false);
    isChatEmptyAtom: jotai.PrimitiveAtom<boolean> = jotai.atom(true);
    isGulinAIFocusedAtom!: jotai.Atom<boolean>;
    panelVisibleAtom!: jotai.Atom<boolean>;
    restoreBackupModalToolCallId: jotai.PrimitiveAtom<string | null> = jotai.atom(null) as jotai.PrimitiveAtom<
        string | null
    >;
    restoreBackupStatus: jotai.PrimitiveAtom<"idle" | "processing" | "success" | "error"> = jotai.atom("idle");
    restoreBackupError: jotai.PrimitiveAtom<string> = jotai.atom(null) as jotai.PrimitiveAtom<string>;
    isSidebarOpen: jotai.PrimitiveAtom<boolean> = jotai.atom(false);
    chatSummaries: jotai.PrimitiveAtom<ChatSummary[]> = jotai.atom([]);
    isLoadingChatSummaries: jotai.PrimitiveAtom<boolean> = jotai.atom(false);
    selectedChatIds: jotai.PrimitiveAtom<string[]> = jotai.atom([]);
    debugLogs: jotai.PrimitiveAtom<DebugLogEntry[]> = jotai.atom([] as DebugLogEntry[]);
    isDebugVisible: jotai.PrimitiveAtom<boolean> = jotai.atom(false);
    unreadDebugCount: jotai.PrimitiveAtom<number> = jotai.atom(0);
    debugFilters: jotai.PrimitiveAtom<string[]> = jotai.atom(["API", "TERM", "FILE", "DB", "AI", "PLAI", "WEB"]);
    selectedSkill: jotai.PrimitiveAtom<{title: string, filename: string} | null> = jotai.atom(null) as jotai.PrimitiveAtom<{title: string, filename: string} | null>;
    availableSkills: jotai.PrimitiveAtom<{title: string, filename: string}[]> = jotai.atom([]);

    private constructor(orefContext: ORef, inBuilder: boolean) {
        this.orefContext = orefContext;
        this.inBuilder = inBuilder;
        this.chatId = jotai.atom(null) as jotai.PrimitiveAtom<string>;
        this.aiModeConfigs = atoms.gulinaiModeConfigAtom;

        this.hasPremiumAtom = jotai.atom((get) => {
            const rateLimitInfo = get(atoms.gulinAIRateLimitInfoAtom);
            return !rateLimitInfo || rateLimitInfo.unknown || rateLimitInfo.preq > 0;
        });

        this.widgetAccessAtom = jotai.atom((get) => {
            if (this.inBuilder) {
                return true;
            }
            const widgetAccessMetaAtom = getOrefMetaKeyAtom(this.orefContext, "gulinai:widgetcontext");
            const value = get(widgetAccessMetaAtom);
            return value ?? true;
        });

        this.codeBlockMaxWidth = jotai.atom((get) => {
            const width = get(this.containerWidth);
            return width > 0 ? width - 35 : 0;
        });

        this.isGulinAIFocusedAtom = jotai.atom((get) => {
            if (this.inBuilder) {
                return get(BuilderFocusManager.getInstance().focusType) === "gulinai";
            }
            return get(FocusManager.getInstance().focusType) === "gulinai";
        });

        this.panelVisibleAtom = jotai.atom((get) => {
            if (this.inBuilder) {
                return true;
            }
            return get(WorkspaceLayoutModel.getInstance().panelVisibleAtom);
        });

        this.defaultModeAtom = jotai.atom((get) => {
            const telemetryEnabled = get(getSettingsKeyAtom("telemetry:enabled")) ?? false;
            const aiModeConfigs = get(this.aiModeConfigs);
            const allConfigs = Object.entries(aiModeConfigs).map(([mode, config]) => ({ mode, ...config }));
            const customConfigs = allConfigs.filter((config) => config["ai:provider"] !== "gulin");

            if (customConfigs.length > 0) {
                // If there's a specific default mode saved in settings, check if it exists
                let savedMode = get(getSettingsKeyAtom("gulinai:defaultmode"));
                if (savedMode && savedMode in aiModeConfigs && !savedMode.startsWith("gulinai@")) {
                    return savedMode;
                }
                // Return the first custom mode as default
                return customConfigs[0].mode;
            }

            if (this.inBuilder) {
                return telemetryEnabled ? "gulinai@balanced" : "invalid";
            }
            if (!telemetryEnabled) {
                let mode = get(getSettingsKeyAtom("gulinai:defaultmode"));
                if (mode == null || mode.startsWith("gulinai@")) {
                    return "unknown";
                }
                return mode;
            }
            const hasPremium = get(this.hasPremiumAtom);
            const gulinFallback = hasPremium ? "gulinai@balanced" : "gulinai@quick";
            let mode = get(getSettingsKeyAtom("gulinai:defaultmode")) ?? gulinFallback;
            if (!hasPremium && mode.startsWith("gulinai@")) {
                mode = "gulinai@quick";
            }
            const modeExists = aiModeConfigs != null && mode in aiModeConfigs;
            if (!modeExists) {
                mode = gulinFallback;
            }
            return mode;
        });

        const defaultMode = globalStore.get(this.defaultModeAtom);
        this.currentAIMode = jotai.atom(defaultMode);

        // Log inicial para visibilidad
        setTimeout(() => {
            this.addDebugLog("AI", "Sistema de Logs de Depuración inicializado. Esperando actividad...", Date.now());
        }, 1000);
    }

    getPanelVisibleAtom(): jotai.Atom<boolean> {
        return this.panelVisibleAtom;
    }

    static getInstance(): GulinAIModel {
        if (!GulinAIModel.instance) {
            let orefContext: ORef;
            if (isBuilderWindow()) {
                const builderId = globalStore.get(atoms.builderId);
                orefContext = WOS.makeORef("builder", builderId);
            } else {
                const tabId = globalStore.get(atoms.staticTabId);
                orefContext = WOS.makeORef("tab", tabId);
            }
            GulinAIModel.instance = new GulinAIModel(orefContext, isBuilderWindow());
            (window as any).GulinAIModel = GulinAIModel.instance;
        }
        return GulinAIModel.instance;
    }

    static resetInstance(): void {
        GulinAIModel.instance = null;
    }

    getUseChatEndpointUrl(): string {
        return `${getWebServerEndpoint()}/api/post-chat-message`;
    }

    async addFile(file: File): Promise<DroppedFile> {
        // Resize images before storing
        const processedFile = await resizeImage(file);

        const droppedFile: DroppedFile = {
            id: crypto.randomUUID(),
            file: processedFile,
            name: processedFile.name,
            type: processedFile.type,
            size: processedFile.size,
        };

        // Create 128x128 preview data URL for images
        if (processedFile.type.startsWith("image/")) {
            const previewDataUrl = await createImagePreview(processedFile);
            if (previewDataUrl) {
                droppedFile.previewUrl = previewDataUrl;
            }
        }

        const currentFiles = globalStore.get(this.droppedFiles);
        globalStore.set(this.droppedFiles, [...currentFiles, droppedFile]);

        return droppedFile;
    }

    async addFileFromRemoteUri(draggedFile: DraggedFile): Promise<void> {
        if (draggedFile.isDir) {
            this.setError("Cannot add directories to Gulin AI. Please select a file.");
            return;
        }

        try {
            const fileInfo = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: draggedFile.uri } }, null);
            if (fileInfo.notfound) {
                this.setError(`File not found: ${draggedFile.relName}`);
                return;
            }
            if (fileInfo.isdir) {
                this.setError("Cannot add directories to Gulin AI. Please select a file.");
                return;
            }

            const mimeType = fileInfo.mimetype || "application/octet-stream";
            const fileSize = fileInfo.size || 0;
            const sizeError = validateFileSizeFromInfo(draggedFile.relName, fileSize, mimeType);
            if (sizeError) {
                this.setError(formatFileSizeError(sizeError));
                return;
            }

            const fileData = await RpcApi.FileReadCommand(TabRpcClient, { info: { path: draggedFile.uri } }, null);
            if (!fileData.data64) {
                this.setError(`Failed to read file: ${draggedFile.relName}`);
                return;
            }

            const buffer = base64ToArrayBuffer(fileData.data64);
            const file = new File([buffer], draggedFile.relName, { type: mimeType });
            if (!isAcceptableFile(file)) {
                this.setError(
                    `File type not supported: ${draggedFile.relName}. Supported: images, PDFs, and text/code files.`
                );
                return;
            }

            await this.addFile(file);
        } catch (error) {
            console.error("Error handling FILE_ITEM drop:", error);
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.setError(`Failed to add file: ${errorMsg}`);
        }
    }

    removeFile(fileId: string) {
        const currentFiles = globalStore.get(this.droppedFiles);
        const updatedFiles = currentFiles.filter((f) => f.id !== fileId);
        globalStore.set(this.droppedFiles, updatedFiles);
    }

    clearFiles() {
        const currentFiles = globalStore.get(this.droppedFiles);

        // Cleanup all preview URLs
        currentFiles.forEach((file) => {
            if (file.previewUrl) {
                URL.revokeObjectURL(file.previewUrl);
            }
        });

        globalStore.set(this.droppedFiles, []);
    }

    async loadChatSummaries() {
        globalStore.set(this.isLoadingChatSummaries, true);
        try {
            const response = await fetch(`${getWebServerEndpoint()}/gulin/chat-list`);
            if (response.ok) {
                const data = await response.json();
                globalStore.set(this.chatSummaries, data);
            }
        } catch (error) {
            console.error("Failed to load chat summaries:", error);
        } finally {
            globalStore.set(this.isLoadingChatSummaries, false);
        }
    }

    async switchToChat(chatId: string) {
        if (chatId === globalStore.get(this.chatId)) {
            return;
        }
        this.useChatStop?.();
        this.clearFiles();
        this.clearError();
        globalStore.set(this.isLoadingChatAtom, true);
        globalStore.set(this.chatId, chatId);

        // Update RTInfo so it persists on reload
        RpcApi.SetRTInfoCommand(TabRpcClient, {
            oref: this.orefContext,
            data: { "gulinai:chatid": chatId },
        });

        // The component will remount via the dynamic key and loadInitialChat will handle the rest
        // Send a signal that chat has changed (UI will remount with new key)
        // Removed: direct setMessages call - handled by component remount

        globalStore.set(this.isLoadingChatAtom, false);
        this.toggleSidebar(false);
    }

    async deleteChat(chatId: string) {
        try {
            const response = await fetch(`${getWebServerEndpoint()}/gulin/chat-delete?chatid=${chatId}`);
            if (response.ok) {
                // If we deleted the active chat, start a new one
                if (chatId === globalStore.get(this.chatId)) {
                    this.clearChat();
                }
                // Refresh summaries
                await this.loadChatSummaries();
            }
        } catch (error) {
            console.error("Failed to delete chat:", error);
            this.setError("Failed to delete chat.");
        }
    }

    toggleChatSelection(chatId: string) {
        const current = globalStore.get(this.selectedChatIds);
        if (current.includes(chatId)) {
            globalStore.set(
                this.selectedChatIds,
                current.filter((id) => id !== chatId)
            );
        } else {
            globalStore.set(this.selectedChatIds, [...current, chatId]);
        }
    }

    clearChatSelection() {
        globalStore.set(this.selectedChatIds, []);
    }

    setSelectedChatIds(chatIds: string[]) {
        globalStore.set(this.selectedChatIds, chatIds);
    }

    async bulkDeleteSelectedChats() {
        const chatIds = globalStore.get(this.selectedChatIds);
        if (chatIds.length === 0) {
            return;
        }

        globalStore.set(this.isLoadingChatSummaries, true);
        try {
            const response = await fetch(`${getWebServerEndpoint()}/gulin/chat-bulk-delete`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ chatids: chatIds }),
            });

            if (response.ok) {
                const activeChatId = globalStore.get(this.chatId);
                if (chatIds.includes(activeChatId)) {
                    this.clearChat();
                }
                this.clearChatSelection();
                await this.loadChatSummaries();
            } else {
                const errorText = await response.text();
                console.error("Bulk delete failed:", errorText);
                this.setError(`Failed to delete selected chats: ${errorText}`);
            }
        } catch (error) {
            console.error("Failed to bulk delete chats:", error);
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.setError(`Failed to delete selected chats: ${errorMsg}`);
        } finally {
            globalStore.set(this.isLoadingChatSummaries, false);
        }
    }


    toggleSidebar(open?: boolean) {
        const next = open ?? !globalStore.get(this.isSidebarOpen);
        globalStore.set(this.isSidebarOpen, next);
        if (next) {
            this.loadChatSummaries();
        }
    }

    clearChat() {
        this.useChatStop?.();
        this.clearFiles();
        this.clearError();
        globalStore.set(this.isChatEmptyAtom, true);
        const newChatId = crypto.randomUUID();
        globalStore.set(this.chatId, newChatId);

        RpcApi.SetRTInfoCommand(TabRpcClient, {
            oref: this.orefContext,
            data: { "gulinai:chatid": newChatId },
        });

        this.useChatSetMessages?.([]);
    }

    setError(message: string) {
        globalStore.set(this.errorMessage, message);
    }

    clearError() {
        globalStore.set(this.errorMessage, null);
    }

    registerInputRef(ref: React.RefObject<AIPanelInputRef>) {
        this.inputRef = ref;
    }

    registerScrollToBottom(callback: () => void) {
        this.scrollToBottomCallback = callback;
    }

    registerUseChatData(
        sendMessage: UseChatSendMessageType,
        setMessages: UseChatSetMessagesType,
        status: ChatStatus,
        stop: () => void
    ) {
        this.useChatSendMessage = sendMessage;
        this.useChatSetMessages = setMessages;
        this.useChatStatus = status;
        this.useChatStop = stop;
    }

    registerTabModel(tabModel: any) {
        this.tabModel = tabModel;
    }

    async openDebugLogsAsWidget() {
        this.addDebugLog("AI", "Abriendo Consola de Logs...", Date.now());
        await createBlock({
            meta: { view: "debug-logs" }
        });
        this.toggleDebugVisible(false);
    }

    async openDebugLogsWithFilter(filterCategory?: string) {
        const msg = filterCategory 
            ? `Abriendo Consola filtrada por: ${filterCategory}`
            : "Abriendo Consola de Logs...";
        this.addDebugLog("AI", msg, Date.now());
        
        // Apply filter atom so the console opens pre-filtered
        if (filterCategory) {
            globalStore.set(this.debugFilters, [filterCategory]);
        }
        
        await createBlock({
            meta: { view: "debug-logs" }
        });
        this.toggleDebugVisible(false);
    }

    async openServiceMap() {
        this.addDebugLog("AI", "Abriendo Mapa de Servicios...", Date.now());
        try {
            await createBlock({
                meta: { view: "service-map" }
            });
        } catch (e: any) {
            this.addDebugLog("AI", `Error al abrir Mapa: ${e.message}`, Date.now());
        }
    }

    addDebugLog(category: string, message: string, ts: number, toolName?: string, durationMs?: number, status?: 'success' | 'fail', errorContext?: string) {
        const currentLogs = globalStore.get(this.debugLogs);
        const newLog: DebugLogEntry = {
            id: crypto.randomUUID(),
            category,
            message,
            ts,
            ...(toolName !== undefined && { toolName }),
            ...(durationMs !== undefined && { durationMs }),
            ...(status !== undefined && { status }),
            ...(errorContext !== undefined && { errorContext }),
        };
        globalStore.set(this.debugLogs, [newLog, ...currentLogs].slice(0, 1000) as DebugLogEntry[]);
        
        if (!globalStore.get(this.isDebugVisible)) {
            globalStore.set(this.unreadDebugCount, (prev) => prev + 1);
        }
    }

    clearDebugLogs() {
        globalStore.set(this.debugLogs, []);
        globalStore.set(this.unreadDebugCount, 0);
    }

    toggleDebugVisible(visible?: boolean) {
        const next = visible ?? !globalStore.get(this.isDebugVisible);
        globalStore.set(this.isDebugVisible, next);
        if (next) {
            globalStore.set(this.unreadDebugCount, 0);
        }
    }

    scrollToBottom() {
        this.scrollToBottomCallback?.();
    }

    focusInput() {
        if (!this.inBuilder && !WorkspaceLayoutModel.getInstance().getAIPanelVisible()) {
            WorkspaceLayoutModel.getInstance().setAIPanelVisible(true);
        }
        if (this.inputRef?.current) {
            this.inputRef.current.focus();
        }
    }

    async reloadChatFromBackend(chatIdValue: string): Promise<GulinUIMessage[]> {
        const chatData = await RpcApi.GetGulinAIChatCommand(TabRpcClient, { chatid: chatIdValue });
        const messages: UIMessage[] = chatData?.messages ?? [];
        globalStore.set(this.isChatEmptyAtom, messages.length === 0);
        return messages as GulinUIMessage[];
    }

    async stopResponse() {
        this.useChatStop?.();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const chatIdValue = globalStore.get(this.chatId);
        if (!chatIdValue) {
            return;
        }
        try {
            const messages = await this.reloadChatFromBackend(chatIdValue);
            this.useChatSetMessages?.(messages);
        } catch (error) {
            console.error("Failed to reload chat after stop:", error);
        }
    }

    getAndClearMessage(): AIMessage | null {
        const msg = this.realMessage;
        this.realMessage = null;
        return msg;
    }

    hasNonEmptyInput(): boolean {
        const input = globalStore.get(this.inputAtom);
        return input != null && input.trim().length > 0;
    }

    appendText(text: string, newLine?: boolean, opts?: { scrollToBottom?: boolean }) {
        const currentInput = globalStore.get(this.inputAtom);
        let newInput = currentInput;

        if (newInput.length > 0) {
            if (newLine) {
                if (!newInput.endsWith("\n")) {
                    newInput += "\n";
                }
            } else if (!newInput.endsWith(" ") && !newInput.endsWith("\n")) {
                newInput += " ";
            }
        }

        newInput += text;
        globalStore.set(this.inputAtom, newInput);

        if (opts?.scrollToBottom && this.inputRef?.current) {
            setTimeout(() => this.inputRef.current.scrollToBottom(), 10);
        }
    }

    setModel(model: string) {
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: this.orefContext,
            meta: { "gulinai:model": model },
        });
    }

    setWidgetAccess(enabled: boolean) {
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: this.orefContext,
            meta: { "gulinai:widgetcontext": enabled },
        });
    }

    isValidMode(mode: string): boolean {
        const telemetryEnabled = globalStore.get(getSettingsKeyAtom("telemetry:enabled")) ?? false;
        let baseMode = mode;
        if (mode.endsWith("@plan")) {
            baseMode = mode.substring(0, mode.length - 5);
        } else if (mode.endsWith("@act")) {
            baseMode = mode.substring(0, mode.length - 4);
        }

        if (baseMode.startsWith("gulinai@") && !telemetryEnabled) {
            return false;
        }

        const aiModeConfigs = globalStore.get(this.aiModeConfigs);
        console.log("isValidMode debug:", { baseMode, hasConfig: aiModeConfigs && (baseMode in aiModeConfigs), configKeys: Object.keys(aiModeConfigs || {}) });
        if (aiModeConfigs == null || !(baseMode in aiModeConfigs)) {
            return false;
        }

        return true;
    }

    setAIMode(mode: string) {
        if (!this.isValidMode(mode)) {
            this.setAIModeToDefault();
        } else {
            globalStore.set(this.currentAIMode, mode);
            RpcApi.SetRTInfoCommand(TabRpcClient, {
                oref: this.orefContext,
                data: { "gulinai:mode": mode },
            });
        }
    }

    setAIModeToDefault() {
        const defaultMode = globalStore.get(this.defaultModeAtom);
        globalStore.set(this.currentAIMode, defaultMode);
        RpcApi.SetRTInfoCommand(TabRpcClient, {
            oref: this.orefContext,
            data: { "gulinai:mode": null },
        });
    }

    async fixModeAfterConfigChange(): Promise<void> {
        const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, {
            oref: this.orefContext,
        });
        const mode = rtInfo?.["gulinai:mode"];
        if (mode == null || !this.isValidMode(mode)) {
            this.setAIModeToDefault();
        }
    }

    async getRTInfo(): Promise<Record<string, any>> {
        const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, {
            oref: this.orefContext,
        });
        return rtInfo ?? {};
    }

    async loadInitialChat(): Promise<GulinUIMessage[]> {
        const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, {
            oref: this.orefContext,
        });
        let chatIdValue = rtInfo?.["gulinai:chatid"];
        if (chatIdValue == null) {
            chatIdValue = crypto.randomUUID();
            RpcApi.SetRTInfoCommand(TabRpcClient, {
                oref: this.orefContext,
                data: { "gulinai:chatid": chatIdValue },
            });
        }
        globalStore.set(this.chatId, chatIdValue);

        const aiModeValue = rtInfo?.["gulinai:mode"];
        if (aiModeValue == null) {
            const defaultMode = globalStore.get(this.defaultModeAtom);
            globalStore.set(this.currentAIMode, defaultMode);
        } else if (this.isValidMode(aiModeValue)) {
            globalStore.set(this.currentAIMode, aiModeValue);
        } else {
            this.setAIModeToDefault();
        }
        
        const tokenModeValue = rtInfo?.["gulinai:tokenmode"];
        if (tokenModeValue === "mini" || tokenModeValue === "balanced" || tokenModeValue === "max") {
            globalStore.set(atoms.tokenModeAtom, tokenModeValue);
        } else {
            globalStore.set(atoms.tokenModeAtom, "balanced");
        }

        try {
            return await this.reloadChatFromBackend(chatIdValue);
        } catch (error) {
            console.error("Failed to load chat:", error);
            this.setError("Failed to load chat. Starting new chat...");

            this.clearChat();
            return [];
        }
    }

    async handleSubmit() {
        const input = globalStore.get(this.inputAtom);
        const droppedFiles = globalStore.get(this.droppedFiles);

        const trimmedInput = input.trim().toLowerCase();
        if (trimmedInput === "/clear" || trimmedInput === "/new") {
            this.clearChat();
            globalStore.set(this.inputAtom, "");
            return;
        }

        if (trimmedInput.startsWith("/mapa") || trimmedInput.startsWith("/map")) {
            this.openServiceMap();
            globalStore.set(this.inputAtom, "");
            return;
        }

        if (
            (!input.trim() && droppedFiles.length === 0) ||
            (this.useChatStatus !== "ready" && this.useChatStatus !== "error") ||
            globalStore.get(this.isLoadingChatAtom)
        ) {
            return;
        }

        this.clearError();

        const aiMessageParts: AIMessagePart[] = [];
        const uiMessageParts: GulinUIMessagePart[] = [];

        if (input.trim()) {
            aiMessageParts.push({ type: "text", text: input.trim() });
            uiMessageParts.push({ type: "text", text: input.trim() });
        }

        for (const droppedFile of droppedFiles) {
            const normalizedMimeType = normalizeMimeType(droppedFile.file);
            const dataUrl = await createDataUrl(droppedFile.file);

            aiMessageParts.push({
                type: "file",
                filename: droppedFile.name,
                mimetype: normalizedMimeType,
                url: dataUrl,
                size: droppedFile.file.size,
                previewurl: droppedFile.previewUrl,
            });

            uiMessageParts.push({
                type: "data-userfile",
                data: {
                    filename: droppedFile.name,
                    mimetype: normalizedMimeType,
                    size: droppedFile.file.size,
                    previewurl: droppedFile.previewUrl,
                },
            });
        }

        const realMessage: AIMessage = {
            messageid: crypto.randomUUID(),
            role: "user",
            parts: aiMessageParts,
        };
        this.realMessage = realMessage;

        // console.log("SUBMIT MESSAGE", realMessage);
        
        const tokenMode = globalStore.get(atoms.tokenModeAtom);

        this.useChatSendMessage?.({ parts: uiMessageParts }, {
            body: {
                tokenmode: tokenMode,
            }
        });

        globalStore.set(this.isChatEmptyAtom, false);
        globalStore.set(this.inputAtom, "");
        this.clearFiles();

        // Refrescar la lista de chats en la sidebar tras enviar un mensaje
        this.loadChatSummaries();
    }

    setTokenMode(mode: "mini" | "balanced" | "max") {
        globalStore.set(atoms.tokenModeAtom, mode);
        RpcApi.SetRTInfoCommand(TabRpcClient, {
            oref: this.orefContext,
            data: { "gulinai:tokenmode": mode },
        });
    }

    async uiLoadInitialChat() {
        globalStore.set(this.isLoadingChatAtom, true);
        const messages = await this.loadInitialChat();
        this.useChatSetMessages?.(messages);
        globalStore.set(this.isLoadingChatAtom, false);
        setTimeout(() => {
            this.scrollToBottom();
        }, 100);
    }

    async ensureRateLimitSet() {
        const currentInfo = globalStore.get(atoms.gulinAIRateLimitInfoAtom);
        if (currentInfo != null) {
            return;
        }
        try {
            const rateLimitInfo = await RpcApi.GetGulinAIRateLimitCommand(TabRpcClient);
            if (rateLimitInfo != null) {
                globalStore.set(atoms.gulinAIRateLimitInfoAtom, rateLimitInfo);
            }
        } catch (error) {
            console.error("Failed to fetch rate limit info:", error);
        }
    }

    handleAIFeedback(feedback: "good" | "bad") {
        RpcApi.RecordTEventCommand(
            TabRpcClient,
            {
                event: "gulinai:feedback",
                props: {
                    "gulinai:feedback": feedback,
                },
            },
            { noresponse: true }
        );
    }

    requestGulinAIFocus() {
        if (this.inBuilder) {
            BuilderFocusManager.getInstance().setGulinAIFocused();
        } else {
            FocusManager.getInstance().requestGulinAIFocus();
        }
    }

    requestNodeFocus() {
        if (this.inBuilder) {
            BuilderFocusManager.getInstance().setAppFocused();
        } else {
            FocusManager.getInstance().requestNodeFocus();
        }
    }

    getChatId(): string {
        return globalStore.get(this.chatId);
    }

    toolUseSendApproval(toolcallid: string, approval: string) {
        RpcApi.GulinAIToolApproveCommand(TabRpcClient, {
            toolcallid: toolcallid,
            approval: approval,
        });
    }

    async openDiff(fileName: string, toolcallid: string) {
        const chatId = this.getChatId();

        if (!chatId || !fileName) {
            console.error("Missing chatId or fileName for opening diff", chatId, fileName);
            return;
        }

        const blockDef: BlockDef = {
            meta: {
                view: "aifilediff",
                file: fileName,
                "aifilediff:chatid": chatId,
                "aifilediff:toolcallid": toolcallid,
            },
        };
        await createBlock(blockDef, false, true);
    }

    async openGulinAIConfig() {
        const blockDef: BlockDef = {
            meta: {
                view: "gulinconfig",
                file: "gulinai.json",
            },
        };
        await createBlock(blockDef, false, true);
    }

    openRestoreBackupModal(toolcallid: string) {
        globalStore.set(this.restoreBackupModalToolCallId, toolcallid);
    }

    closeRestoreBackupModal() {
        globalStore.set(this.restoreBackupModalToolCallId, null);
        globalStore.set(this.restoreBackupStatus, "idle");
        globalStore.set(this.restoreBackupError, null);
    }

    async restoreBackup(toolcallid: string, backupFilePath: string, restoreToFileName: string) {
        globalStore.set(this.restoreBackupStatus, "processing");
        globalStore.set(this.restoreBackupError, null);
        try {
            await RpcApi.FileRestoreBackupCommand(TabRpcClient, {
                backupfilepath: backupFilePath,
                restoretofilename: restoreToFileName,
            });
            console.log("Backup restored successfully:", { toolcallid, backupFilePath, restoreToFileName });
            globalStore.set(this.restoreBackupStatus, "success");
        } catch (error) {
            console.error("Failed to restore backup:", error);
            const errorMsg = error?.message || String(error);
            globalStore.set(this.restoreBackupError, errorMsg);
            globalStore.set(this.restoreBackupStatus, "error");
        }
    }

    canCloseGulinAIPanel(): boolean {
        if (this.inBuilder) {
            return false;
        }
        return true;
    }

    closeGulinAIPanel() {
        if (this.inBuilder) {
            return;
        }
        WorkspaceLayoutModel.getInstance().setAIPanelVisible(false);
    }
}
