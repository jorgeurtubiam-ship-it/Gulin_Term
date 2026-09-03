// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from "@/app/store/i18n";
import { GulinStreamdown } from "@/app/element/streamdown";
import { cn, fireAndForget } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { getFileIcon } from "./ai-utils";
import { AIFeedbackButtons } from "./aifeedbackbuttons";
import { AIToolUseGroup } from "./aitooluse";
import { GulinUIMessage, GulinUIMessagePart } from "./aitypes";
import { GulinAIModel } from "./gulinai-model";
import { decodeWAFText } from "./ai-utils";
import { getSettingsKeyAtom } from "@/app/store/global";
import { VoiceService } from "./voice/voice-service";
import { voiceStateAtom } from "./voice/voice-atoms";
import { ChatBiSplit } from "./chatBiSplit";
import { CascadeProgress, CascadeStep } from "./cascade-progress";

const AIThinking = memo(
    ({
        message = "AI is thinking...",
        isWaitingApproval = false,
    }: {
        message?: string;
        reasoningText?: string;
        isWaitingApproval?: boolean;
    }) => {
        const { t } = useTranslation();
        const thinkingMessage = message || t("gulin.ai.message.thinking");

        return (
            <div className="flex items-center gap-2 text-sm text-zinc-400 py-1">
                {isWaitingApproval ? (
                    <i className="fa fa-clock text-base text-yellow-500"></i>
                ) : (
                    <div className="animate-pulse flex items-center text-teal-400">
                        <i className="fa fa-circle text-[8px]"></i>
                        <i className="fa fa-circle text-[8px] mx-1"></i>
                        <i className="fa fa-circle text-[8px]"></i>
                    </div>
                )}
                <span className="text-xs text-zinc-400">{thinkingMessage}</span>
            </div>
        );
    }
);

AIThinking.displayName = "AIThinking";

const AIReasoningBlock = memo(({ reasoning, isStreaming }: { reasoning: string; isStreaming: boolean }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const wordCount = useMemo(() => (reasoning ? reasoning.trim().split(/\s+/).length : 0), [reasoning]);

    if (!reasoning || !reasoning.trim()) return null;

    return (
        <div className="my-2 rounded-xl border border-zinc-800 bg-zinc-950/60 overflow-hidden text-xs select-none shadow-sm">
            <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-3 py-2 text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03] transition-colors cursor-pointer"
            >
                <div className="flex items-center gap-2">
                    <i className={cn("fa-solid fa-brain text-teal-400 text-xs", isStreaming && "animate-pulse")} />
                    <span className="font-semibold text-zinc-300">Razonamiento del Modelo</span>
                    {isStreaming ? (
                        <span className="px-1.5 py-0.5 rounded-full text-[9px] bg-teal-500/20 text-teal-300 font-mono animate-pulse">Pensando...</span>
                    ) : (
                        <span className="px-1.5 py-0.5 rounded-full text-[9px] bg-zinc-800 text-zinc-400 font-mono">{wordCount} palabras</span>
                    )}
                </div>
                <div className="flex items-center gap-1.5 text-zinc-500 text-[10px]">
                    <span>{isExpanded ? "Ocultar" : "Mostrar"}</span>
                    <i className={cn("fa-solid fa-chevron-down transition-transform duration-200", isExpanded && "rotate-180")} />
                </div>
            </button>
            {isExpanded && (
                <div className="px-3.5 py-2.5 bg-black/40 border-t border-zinc-800/80 text-zinc-400 font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-text max-h-64 overflow-y-auto custom-scrollbar">
                    {decodeWAFText(reasoning)}
                </div>
            )}
        </div>
    );
});

AIReasoningBlock.displayName = "AIReasoningBlock";

interface UserMessageFilesProps {
    fileParts: Array<GulinUIMessagePart & { type: "data-userfile" }>;
}

const UserMessageFiles = memo(({ fileParts }: UserMessageFilesProps) => {
    const { t } = useTranslation();
    if (fileParts.length === 0) return null;

    return (
        <div className="mt-2 pt-2 border-t border-gray-600">
            <div className="flex gap-2 overflow-x-auto pb-1">
                {fileParts.map((file, index) => (
                    <div key={index} className="relative bg-zinc-700 rounded-lg p-2 min-w-20 flex-shrink-0">
                        <div className="flex flex-col items-center text-center">
                            <div className="w-12 h-12 mb-1 flex items-center justify-center bg-zinc-600 rounded overflow-hidden">
                                {file.data?.previewurl ? (
                                    <img
                                        src={file.data.previewurl}
                                        alt={file.data?.filename || t("gulin.ai.message.file")}
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <i
                                        className={cn(
                                            "fa text-lg text-gray-300",
                                            getFileIcon(file.data?.filename || "", file.data?.mimetype || "")
                                        )}
                                    ></i>
                                )}
                            </div>
                            <div
                                className="text-[10px] text-gray-200 truncate w-full max-w-16"
                                title={file.data?.filename || t("gulin.ai.message.file")}
                            >
                                {file.data?.filename || t("gulin.ai.message.file")}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
});

UserMessageFiles.displayName = "UserMessageFiles";

interface AIMessagePartProps {
    part: GulinUIMessagePart;
    role: string;
    isStreaming: boolean;
}

const AIMessagePart = memo(({ part, role, isStreaming }: AIMessagePartProps) => {
    const model = GulinAIModel.getInstance();

    if (!part || typeof part !== "object") return null;

    if (part.type === "text") {
        const rawContent = (part as any)?.text || (part as any)?.content || "";

        if (role === "user") {
            return <div className="whitespace-pre-wrap break-words">{rawContent}</div>;
        }

        const cleanText = rawContent.replace(/<(?:think|thought)>[\s\S]*?(?:<\/(?:think|thought)>|$)/gi, "").trim();

        if (!cleanText) return null;

        return (
            <div className="w-full">
                <GulinStreamdown
                    text={decodeWAFText(cleanText)}
                    parseIncompleteMarkdown={isStreaming}
                    className="text-gray-100"
                    codeBlockMaxWidthAtom={model.codeBlockMaxWidth}
                />
            </div>
        );
    }

    return null;
});

AIMessagePart.displayName = "AIMessagePart";

interface AIMessageProps {
    message: GulinUIMessage;
    isStreaming: boolean;
}

const isDisplayPart = (part: GulinUIMessagePart): boolean => {
    if (!part || typeof part.type !== "string") return false;
    return (
        part.type === "text" ||
        part.type === "data-bi" ||
        (part.type.startsWith("tool-") && "state" in part && part.state === "input-available")
    );
};

type MessagePart =
    | { type: "single"; part: GulinUIMessagePart }
    | { type: "bigroup"; parts: Array<GulinUIMessagePart & { type: "data-bi" }> };

const groupMessageParts = (parts: GulinUIMessagePart[]): MessagePart[] => {
    const grouped: MessagePart[] = [];
    if (!Array.isArray(parts)) return grouped;

    let currentBiGroup: Array<GulinUIMessagePart & { type: "data-bi" }> = [];
    let currentBlockType: "none" | "bi" = "none";

    const flushGroup = () => {
        if (currentBlockType === "bi" && currentBiGroup.length > 0) {
            grouped.push({ type: "bigroup", parts: currentBiGroup });
            currentBiGroup = [];
        }
        currentBlockType = "none";
    };

    for (const part of parts) {
        if (!part) continue;

        // Skip tool parts from inline rendering — they go to unified summary block
        if (part.type === "data-tooluse" || part.type === "data-toolprogress") {
            continue;
        } else if (part.type === "data-bi") {
            if (currentBlockType !== "bi") flushGroup();
            currentBlockType = "bi";
            currentBiGroup.push(part as GulinUIMessagePart & { type: "data-bi" });
        } else {
            if (currentBlockType !== "none") flushGroup();
            grouped.push({ type: "single", part });
        }
    }

    if (currentBlockType !== "none") {
        flushGroup();
    }

    return grouped;
};

// ---- AIToolApprovalBanner: Prominent Approval Card for actions needing permission ----
interface AIToolApprovalBannerProps {
    parts: Array<GulinUIMessagePart & { type: "data-tooluse" }>;
}

export const AIToolApprovalBanner = memo(({ parts }: AIToolApprovalBannerProps) => {
    const { t } = useTranslation();
    const [actionStates, setActionStates] = useState<Record<string, "approved" | "denied">>({});

    const activeParts = parts.filter(p => p?.data?.toolcallid && !actionStates[p.data.toolcallid]);
    if (parts.length === 0 || activeParts.length === 0) return null;

    const handleApprove = (toolcallid: string) => {
        setActionStates(prev => ({ ...prev, [toolcallid]: "approved" }));
        GulinAIModel.getInstance().toolUseSendApproval(toolcallid, "user-approved");
    };

    const handleDeny = (toolcallid: string) => {
        setActionStates(prev => ({ ...prev, [toolcallid]: "denied" }));
        GulinAIModel.getInstance().toolUseSendApproval(toolcallid, "user-denied");
    };

    const handleApproveAll = () => {
        activeParts.forEach(p => {
            if (p.data?.toolcallid) {
                setActionStates(prev => ({ ...prev, [p.data!.toolcallid]: "approved" }));
                GulinAIModel.getInstance().toolUseSendApproval(p.data.toolcallid, "user-approved");
            }
        });
    };

    const handleDenyAll = () => {
        activeParts.forEach(p => {
            if (p.data?.toolcallid) {
                setActionStates(prev => ({ ...prev, [p.data!.toolcallid]: "denied" }));
                GulinAIModel.getInstance().toolUseSendApproval(p.data.toolcallid, "user-denied");
            }
        });
    };

    const handleOpenDiff = (toolData: any) => {
        if (toolData.inputfilename && toolData.toolcallid) {
            fireAndForget(() => GulinAIModel.getInstance().openDiff(toolData.inputfilename, toolData.toolcallid));
        }
    };

    return (
        <div className="my-2 rounded-xl bg-gradient-to-b from-amber-950/40 via-zinc-950/80 to-zinc-950/90 border border-amber-500/30 p-3 shadow-xl backdrop-blur-md transition-all animate-fade-in">
            {/* Banner Header */}
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-amber-500/20">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_#f59e0b] animate-ping" />
                    <span className="text-[10px] font-mono font-bold tracking-wider text-amber-300 uppercase flex items-center gap-1.5">
                        <i className="fa-solid fa-shield-halved text-xs text-amber-400"></i>
                        {t("gulin.ai.message.waiting_approval") || "APROBACIÓN REQUERIDA"}
                    </span>
                </div>
                {activeParts.length > 1 && (
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleApproveAll}
                            className="px-2.5 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 hover:text-white border border-emerald-500/40 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 shadow-sm"
                        >
                            <i className="fa-solid fa-check-double text-[10px]" />
                            <span>{t("gulin.ai.tool.approve_all").replace("{count}", activeParts.length.toString())}</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleDenyAll}
                            className="px-2.5 py-1 bg-red-600/20 hover:bg-red-600/40 text-red-300 hover:text-white border border-red-500/30 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 shadow-sm"
                        >
                            <i className="fa-solid fa-ban text-[10px]" />
                            <span>{t("gulin.ai.tool.deny_all")}</span>
                        </button>
                    </div>
                )}
            </div>

            {/* List of tools needing approval */}
            <div className="space-y-2">
                {activeParts.map((p, idx) => {
                    const toolData = p.data!;
                    const toolName = toolData.toolname;
                    const desc = toolData.tooldesc || (toolData.parameters ? JSON.stringify(toolData.parameters) : "");
                    const isFileWrite = toolName === "write_text_file" || toolName === "edit_text_file";

                    return (
                        <div
                            key={toolData.toolcallid || idx}
                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-lg bg-zinc-900/60 border border-amber-500/20 hover:border-amber-500/40 transition-colors"
                        >
                            <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                <div className="flex-shrink-0 w-6 h-6 rounded-md bg-amber-500/10 border border-amber-400/30 flex items-center justify-center text-amber-300 text-xs mt-0.5">
                                    <i className={cn(
                                        isFileWrite ? "fa-solid fa-file-pen" :
                                        toolName.startsWith("term_") ? "fa-solid fa-terminal" :
                                        toolName.startsWith("brain_") ? "fa-solid fa-brain" :
                                        "fa-solid fa-gear"
                                    )} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <code className="text-xs font-mono font-bold text-zinc-200">{toolName}</code>
                                        {toolData.inputfilename && (
                                            <span className="text-[10px] font-mono text-zinc-400 truncate max-w-[200px]" title={toolData.inputfilename}>
                                                {toolData.inputfilename}
                                            </span>
                                        )}
                                        {isFileWrite && toolData.inputfilename && (
                                            <button
                                                type="button"
                                                onClick={() => handleOpenDiff(toolData)}
                                                className="px-1.5 py-0.5 border border-zinc-600 hover:border-zinc-500 hover:bg-zinc-700 text-zinc-300 rounded text-[10px] cursor-pointer transition-colors flex items-center gap-1"
                                                title={t("gulin.ai.tool.diff_title")}
                                            >
                                                <span>Diff</span>
                                                <i className="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
                                            </button>
                                        )}
                                    </div>
                                    {desc && (
                                        <div className="text-[11px] text-zinc-400 mt-0.5 line-clamp-2 break-all font-mono">
                                            {desc}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Individual Action Buttons */}
                            <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                                <button
                                    type="button"
                                    onClick={() => handleApprove(toolData.toolcallid)}
                                    className="px-3 py-1.5 bg-emerald-600/30 hover:bg-emerald-600/50 hover:text-white text-emerald-300 border border-emerald-500/40 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 shadow-sm"
                                    title={t("gulin.ai.tool.approve")}
                                >
                                    <i className="fa-solid fa-check text-xs" />
                                    <span>{t("gulin.ai.tool.approve")}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDeny(toolData.toolcallid)}
                                    className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 hover:text-white text-red-300 border border-red-500/30 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 shadow-sm"
                                    title={t("gulin.ai.tool.deny")}
                                >
                                    <i className="fa-solid fa-xmark text-xs" />
                                    <span>{t("gulin.ai.tool.deny")}</span>
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
});

AIToolApprovalBanner.displayName = "AIToolApprovalBanner";

// ---- Unified tool summary (Antigravity-style) ----
interface AIMessageToolsSummaryProps {
    toolParts: Array<GulinUIMessagePart & { type: "data-tooluse" | "data-toolprogress" }>;
    isStreaming: boolean;
    reasoning: string;
}

const AIMessageToolsSummary = memo(({ toolParts, isStreaming, reasoning }: AIMessageToolsSummaryProps) => {
    const { t } = useTranslation();
    const [isExpanded, setIsExpanded] = useState(false);
    const seenBlockIds = useRef(new Set<string>()).current;

    const tooluseParts = toolParts.filter(p => p.type === "data-tooluse") as Array<GulinUIMessagePart & { type: "data-tooluse" }>;
    const safeToolUseParts = tooluseParts.filter(p => p && p.data);

    if (toolParts.length === 0) return null;

    const pendingApprovalParts = safeToolUseParts.filter(
        p => p.data?.approval === "needs-approval" && p.data?.status !== "completed" && p.data?.status !== "error"
    );

    const pendingCount = safeToolUseParts.filter(p => p.data?.status === "pending" || !p.data?.status).length;
    const isAllDone = safeToolUseParts.length > 0 && pendingCount === 0 && !isStreaming;
    const errorCount = safeToolUseParts.filter(p => p.data?.status === "error").length;
    const successCount = safeToolUseParts.filter(p => p.data?.status === "completed").length;
    const totalTime = safeToolUseParts.reduce((acc, p) => acc + (p.data?.runts || 0), 0);
    const totalCount = safeToolUseParts.length;

    // While streaming / pending: show compact, sleek live activity indicator (max 3 recent tools) + approval prompt
    if (!isAllDone) {
        const cascadeSteps: CascadeStep[] = safeToolUseParts.slice(-3).map((p, idx) => {
            const toolName = p.data?.toolname || t("gulin.ai.tool.execution");
            const args = p.data?.parameters || {};
            const target = args.host || args.service || args.query || args.cmd || args.action || undefined;
            const targetStr = target ? (typeof target === "string" ? target.slice(0, 35) : JSON.stringify(target).slice(0, 35)) : undefined;

            return {
                id: p.data?.toolcallid || `${idx}`,
                label: toolName,
                target: targetStr,
                status: p.data?.status === "completed" ? "completed" : p.data?.status === "error" ? "error" : "running",
                detail: p.data?.runts ? `${p.data.runts}ms` : undefined,
                needsApproval: p.data?.approval === "needs-approval" && p.data?.status !== "completed",
            };
        });

        return (
            <div className="mt-2 space-y-2">
                <CascadeProgress
                    title={`EJECUTANDO ACCIONES (${safeToolUseParts.length})`}
                    steps={cascadeSteps}
                    isStreaming={isStreaming}
                />
                {pendingApprovalParts.length > 0 && (
                    <AIToolApprovalBanner parts={pendingApprovalParts} />
                )}
            </div>
        );
    }

    // Collapsed state — Antigravity-style single inline text line
    if (!isExpanded) {
        return (
            <div className="space-y-2">
                <div
                    className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 cursor-pointer transition-colors select-none w-fit group"
                    onClick={() => setIsExpanded(true)}
                >
                    <i className="fa-solid fa-chevron-right text-[8px] w-2 text-center opacity-50 group-hover:opacity-100 transition-opacity" />
                    <i className="fa-solid fa-microchip opacity-60 group-hover:text-teal-400 transition-colors" />
                    <span className="font-medium">
                        {isStreaming
                            ? t("gulin.ai.tool.execution")
                            : `${t("gulin.ai.tool.execution")} (${totalCount})`}
                    </span>
                    {isAllDone && (
                        <>
                            <span className="opacity-30">·</span>
                            {errorCount > 0 ? (
                                <span className="text-red-400/80">
                                    ✗ {errorCount} {errorCount === 1 ? "error" : "errores"}
                                </span>
                            ) : (
                                <span className="text-emerald-500/80">✓ {successCount} {successCount === 1 ? "éxito" : "éxitos"}</span>
                            )}
                            {totalTime > 0 && (
                                <span className="opacity-40 font-mono">({totalTime < 1000 ? `${totalTime}ms` : `${(totalTime/1000).toFixed(1)}s`})</span>
                            )}
                        </>
                    )}
                </div>
                {pendingApprovalParts.length > 0 && (
                    <AIToolApprovalBanner parts={pendingApprovalParts} />
                )}
            </div>
        );
    }

    // Expanded state — clean indented block, no card/background
    return (
        <div className="mt-2 pl-3 border-l border-zinc-800 flex flex-col gap-0">
            <div
                className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider cursor-pointer hover:text-zinc-300 transition-colors select-none mb-1.5"
                onClick={() => setIsExpanded(false)}
            >
                <i className="fa-solid fa-chevron-down text-[8px] w-2 text-center" />
                <i className="fa-solid fa-microchip" />
                <span>{t("gulin.ai.tool.execution")} ({totalCount})</span>
            </div>
            <AIToolUseGroup
                parts={toolParts}
                isStreaming={isStreaming}
                seenBlockIds={seenBlockIds}
                reasoning={reasoning}
                forceExpanded={true}
            />
        </div>
    );
});

AIMessageToolsSummary.displayName = "AIMessageToolsSummary";

const getThinkingMessage = (
    parts: GulinUIMessagePart[],
    isStreaming: boolean,
    role: string,
    t: (key: string) => string
): { message: string; reasoningText?: string; isWaitingApproval?: boolean } | null => {
    if (!isStreaming || role !== "assistant") {
        return null;
    }

    if (!Array.isArray(parts) || parts.length === 0) return { message: t("gulin.ai.message.thinking") };

    // Check if ANY tool is waiting for approval
    const hasWaitingApproval = parts.some(
        p => p?.type === "data-tooluse" && (p as any)?.data?.approval === "needs-approval" && (p as any)?.data?.status !== "completed" && (p as any)?.data?.status !== "error"
    );
    if (hasWaitingApproval) {
        return { message: t("gulin.ai.message.waiting_approval"), isWaitingApproval: true };
    }

    const lastPart = parts[parts.length - 1];

    if (!lastPart || typeof lastPart !== "object") return { message: t("gulin.ai.message.thinking") };

    if (lastPart.type === "reasoning") {
        const reasoningContent = (lastPart as any)?.reasoning || (lastPart as any)?.text || (lastPart as any)?.content || "";
        // Extreme safety for providerMetadata access which can cause crashes in some SDK versions
        const metadata = (lastPart as any)?.providerMetadata;
        return { message: t("gulin.ai.message.thinking"), reasoningText: reasoningContent };
    }

    if (lastPart.type === "text" && ((lastPart as any)?.text || (lastPart as any)?.content)) {
        return null;
    }

    return { message: t("gulin.ai.message.thinking") };
};

export const isInternalToolResult = (message: GulinUIMessage): boolean => {
    if (!message || message.role !== "user") return false;
    const parts = Array.isArray(message.parts) ? message.parts : [];
    if (parts.length === 0) return false;

    // Explicit tool result parts
    if (parts.every(p => p.type === "tool-result" || p.type === "data-toolresult" || (typeof p.type === "string" && p.type.startsWith("tool-")))) {
        return true;
    }

    const text = parts
        .filter(p => p.type === "text")
        .map(p => (p as any)?.text || (p as any)?.content || "")
        .join("")
        .trim();

    if (!text) return false;

    // Check for raw tool response signatures
    if (
        text.startsWith('{"data":') ||
        text.startsWith('{"message":') ||
        text.startsWith('{"exitcode":') ||
        text.startsWith('{"status":') ||
        text.startsWith('{"success":') ||
        text.startsWith('{"result":') ||
        text.startsWith('{"error":') ||
        text.startsWith('"Command sent to terminal') ||
        text.startsWith('Command sent to terminal') ||
        text.startsWith('{"type":"tool_result"') ||
        text.startsWith('{"tool_call_id":')
    ) {
        return true;
    }

    return false;
};

export const AIMessage = memo(({ message, isStreaming }: AIMessageProps) => {
    // Seguridad extrema en el acceso a 'message' y 'parts'
    if (!message) return null;

    // Ocultar mensajes de resultado interno de herramientas que se envían como rol user
    if (isInternalToolResult(message)) {
        return null;
    }

    const parts = Array.isArray(message.parts) ? message.parts : [];
    
    // Filtrar partes válidas con guarda de tipo
    const validParts = parts.filter(p => p && typeof p.type === "string");
    // All tool parts collected flat for the unified summary block
    const allToolParts = validParts.filter(
        (p): p is GulinUIMessagePart & { type: "data-tooluse" | "data-toolprogress" } =>
            p.type === "data-tooluse" || p.type === "data-toolprogress"
    );
    
    const fileParts = validParts.filter((part): part is GulinUIMessagePart & { type: "data-userfile" } => 
        part.type === "data-userfile" && part.data !== undefined
    );
    
    const { t } = useTranslation();
    const feedbackEnabled = useAtomValue(getSettingsKeyAtom("gulin.ai.feedback.enabled"));
    const compactMode = useAtomValue(getSettingsKeyAtom("gulin.ai.compact.mode"));
    const [isMessageCopied, setIsMessageCopied] = useState(false);

    // Group all reasoning and intermediate monologue into unifiedReasoning placed at the bottom
    const { unifiedReasoning, displayParts } = useMemo(() => {
        if (message.role !== "assistant") {
            const userParts = validParts.filter(p => p.type === "text" || p.type === "data-userfile");
            return { unifiedReasoning: "", displayParts: userParts };
        }

        let lastToolIndex = -1;
        validParts.forEach((p, idx) => {
            if (p.type === "data-tooluse" || p.type === "data-toolprogress") {
                lastToolIndex = idx;
            }
        });

        const reasoningChunks: string[] = [];
        const cleanParts: GulinUIMessagePart[] = [];

        validParts.forEach((p, idx) => {
            if (p.type === "data-tooluse" || p.type === "data-toolprogress") {
                const toolThought = (p as any)?.data?.thought;
                if (toolThought && typeof toolThought === "string" && toolThought.trim()) {
                    reasoningChunks.push(toolThought.trim());
                }
                return;
            }

            if (p.type === "reasoning") {
                const r = ((p as any)?.reasoning || (p as any)?.text || (p as any)?.content || "").trim();
                if (r) reasoningChunks.push(r);
                return;
            }

            if (p.type === "text") {
                const raw = ((p as any)?.text || (p as any)?.content || "");
                
                // Extract think/thought tags
                const thinkRegex = /<(?:think|thought)>([\s\S]*?)(?:<\/(?:think|thought)>|$)/gi;
                let match: RegExpExecArray | null;
                while ((match = thinkRegex.exec(raw)) !== null) {
                    const t = match[1].trim();
                    if (t) reasoningChunks.push(t);
                }

                const clean = raw.replace(/<(?:think|thought)>[\s\S]*?(?:<\/(?:think|thought)>|$)/gi, "").trim();
                const decodedClean = decodeWAFText(clean).trim();

                if (!decodedClean || decodedClean === "(no text content)" || decodedClean === "(sin contenido de texto)") {
                    return;
                }

                // If before last tool call, it's intermediate observation / monologue -> include in reasoning
                if (lastToolIndex !== -1 && idx < lastToolIndex) {
                    // Ignore stray single punctuation (e.g. "." or ".." or ",") but keep real thoughts
                    if (!/^[\s.,;:\-_]+$/.test(decodedClean)) {
                        reasoningChunks.push(decodedClean);
                    }
                } else {
                    // Ignore stray single dots / punctuation between tool calls if tools exist
                    if (lastToolIndex !== -1 && /^[\s.,;:\-_]+$/.test(decodedClean)) {
                        return;
                    }
                    cleanParts.push({ ...p, text: clean } as any);
                }
                return;
            }

            if (p.type === "data-bi") {
                cleanParts.push(p);
                return;
            }

            if (isDisplayPart(p)) {
                cleanParts.push(p);
            }
        });

        // Deduplicate consecutive identical reasoning chunks
        const uniqueReasoningChunks = reasoningChunks.filter((chunk, i) => {
            if (!chunk) return false;
            return i === 0 || chunk !== reasoningChunks[i - 1];
        });

        return {
            unifiedReasoning: uniqueReasoningChunks.join("\n\n"),
            displayParts: cleanParts,
        };
    }, [message.role, validParts]);

    const thinkingData = getThinkingMessage(validParts, isStreaming, message.role, t);
    const groupedParts = useMemo(() => groupMessageParts(displayParts), [displayParts]);
    const seenBlockIds = new Set<string>();

    const allText = validParts
        .filter((p) => p && (p.type === "text" || p.type === "reasoning"))
        .map((p) => {
            const anyP = p as any;
            return anyP?.text || anyP?.reasoning || anyP?.content || "";
        })
        .filter(t => t != null)
        .join("\n\n");

    const [voiceState] = useAtom(voiceStateAtom);
    const [isPlayingThis, setIsPlayingThis] = useState(false);

    const handleToggleSpeech = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (voiceState === "speaking" && isPlayingThis) {
            VoiceService.getInstance().stopSpeaking();
            setIsPlayingThis(false);
        } else {
            VoiceService.getInstance().stopSpeaking();
            setIsPlayingThis(true);
            VoiceService.getInstance().speakResponse(allText);
        }
    };

    useEffect(() => {
        if (voiceState !== "speaking") {
            setIsPlayingThis(false);
        }
    }, [voiceState]);

    const handleCopyMessage = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!allText) return;
        await navigator.clipboard.writeText(decodeWAFText(allText));
        setIsMessageCopied(true);
        setTimeout(() => setIsMessageCopied(false), 2000);
    };

    return (
        <div className={cn("flex gap-3 mb-2 group/msg relative", message.role === "user" ? "flex-row-reverse" : "flex-row")}>
            <div className={cn(
                "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs mt-1 shadow-sm",
                message.role === "user" ? "bg-teal-600 text-white" : "bg-zinc-800 text-teal-400 border border-teal-500/30"
            )}>
                {message.role === "user" ? <i className="fa fa-user"></i> : <i className="fa fa-robot"></i>}
            </div>
            <div
                className={cn(
                    "rounded-2xl transition-all duration-300 relative group/bubble",
                    message.role === "user"
                        ? "py-3 px-5 bg-gradient-to-br from-teal-600/30 to-emerald-600/20 text-white max-w-[calc(100%-80px)] border border-teal-400/20 shadow-md hover:shadow-teal-500/10"
                        : "py-3 px-5 bg-[#09090b] text-zinc-100 w-full max-w-full overflow-hidden border border-white/5 shadow-sm hover:border-white/10"
                )}
            >
                {/* Floating Quick Action Bar on Hover */}
                {!isStreaming && allText && message.role === "assistant" && (
                    <div className="absolute top-2.5 right-3 opacity-0 group-hover/bubble:opacity-100 transition-opacity z-20 flex items-center gap-1 bg-zinc-900/90 backdrop-blur-md px-2 py-0.5 rounded-lg border border-white/10 shadow-lg select-none">
                        <button
                            type="button"
                            onClick={handleToggleSpeech}
                            className={cn(
                                "p-1 rounded transition-colors text-[11px] flex items-center gap-1 cursor-pointer",
                                isPlayingThis
                                    ? "text-purple-400 bg-purple-500/20 hover:bg-purple-500/30"
                                    : "text-zinc-400 hover:text-teal-300 hover:bg-white/10"
                            )}
                            title={isPlayingThis ? "Detener voz" : "Escuchar esta respuesta"}
                        >
                            <i className={cn(isPlayingThis ? "fa-solid fa-stop text-purple-400" : "fa-solid fa-volume-high")} />
                        </button>
                        <button
                            type="button"
                            onClick={handleCopyMessage}
                            className="p-1 text-zinc-400 hover:text-white rounded hover:bg-white/10 transition-colors text-[11px] flex items-center gap-1 cursor-pointer"
                            title="Copiar respuesta completa"
                        >
                            <i className={cn(isMessageCopied ? "fa-solid fa-check text-emerald-400" : "fa-regular fa-copy")} />
                            {isMessageCopied && <span className="text-[10px] text-emerald-400 font-sans">Copiado</span>}
                        </button>
                    </div>
                )}
                {displayParts.length === 0 && allToolParts.length === 0 && !unifiedReasoning && !isStreaming && !thinkingData ? (
                    <div className="whitespace-pre-wrap break-words opacity-70 italic">{t("gulin.ai.message.no_content")}</div>
                ) : (
                    <div className="space-y-2">
                        {/* Main clean synthesized response */}
                        {groupedParts.map((group, index: number) => {
                            if (group.type === "bigroup") {
                                // Mapeamos las partes data-bi a ChatBiWidgetProps
                                const visuals = group.parts.map(p => p.data as any);
                                return <ChatBiSplit key={index} visuals={visuals} />;
                            }
                            if (!group.part) return null;
                            return (
                                <div key={index}>
                                    <AIMessagePart part={group.part} role={message.role} isStreaming={isStreaming} />
                                </div>
                            );
                        })}

                        {/* Unified tool summary block — placed cleanly below response */}
                        {message.role === "assistant" && allToolParts.length > 0 && (
                            <AIMessageToolsSummary
                                toolParts={allToolParts}
                                isStreaming={isStreaming}
                                reasoning={unifiedReasoning || allText}
                            />
                        )}

                        {/* Unified model reasoning block — grouped into a single block at the bottom */}
                        {message.role === "assistant" && unifiedReasoning && (
                            <AIReasoningBlock
                                reasoning={unifiedReasoning}
                                isStreaming={isStreaming && displayParts.length === 0}
                            />
                        )}

                        {/* Live Thinking Status during streaming if no text yet */}
                        {thinkingData != null && thinkingData.message && !compactMode && (
                            <div className="mt-2 pt-2 border-t border-white/5">
                                <AIThinking 
                                    message={thinkingData.message} 
                                    isWaitingApproval={thinkingData.isWaitingApproval} 
                                />
                            </div>
                        )}

                        {/* Feedback Thumbs */}
                        {message.role === "assistant" && !isStreaming && feedbackEnabled && !compactMode && (
                            <div className="mt-2 pt-2 border-t border-white/5 opacity-80">
                                <AIFeedbackButtons messageText={allText} />
                            </div>
                        )}
                    </div>
                )}

                {message.role === "user" && fileParts.length > 0 && <UserMessageFiles fileParts={fileParts} />}
            </div>
        </div>
    );
});

AIMessage.displayName = "AIMessage";
