// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from "@/app/store/i18n";
import { GulinStreamdown } from "@/app/element/streamdown";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { getFileIcon } from "./ai-utils";
import { AIFeedbackButtons } from "./aifeedbackbuttons";
import { AIToolUseGroup } from "./aitooluse";
import { GulinUIMessage, GulinUIMessagePart } from "./aitypes";
import { GulinAIModel } from "./gulinai-model";
import { decodeWAFText } from "./ai-utils";
import { getSettingsKeyAtom } from "@/app/store/global";
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
        const content = (part as any)?.text || (part as any)?.content || "";

        if (role === "user") {
            return <div className="whitespace-pre-wrap break-words">{content}</div>;
        } else {
            return (
                <GulinStreamdown
                    text={decodeWAFText(content)}
                    parseIncompleteMarkdown={isStreaming}
                    className="text-gray-100"
                    codeBlockMaxWidthAtom={model.codeBlockMaxWidth}
                />
            );
        }
    }

    if (part.type === "reasoning") {
        const reasoning = (part as any)?.reasoning || (part as any)?.text || (part as any)?.content || "";
        if (!reasoning) return null;
        
        return <AIReasoningBlock reasoning={reasoning} isStreaming={isStreaming} />;
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
        part.type === "reasoning" || // Permitir renderizado de razonamiento
        part.type === "data-tooluse" ||
        part.type === "data-toolprogress" ||
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

    const pendingCount = safeToolUseParts.filter(p => p.data?.status === "pending" || !p.data?.status).length;
    const isAllDone = safeToolUseParts.length > 0 && pendingCount === 0 && !isStreaming;
    const errorCount = safeToolUseParts.filter(p => p.data?.status === "error").length;
    const successCount = safeToolUseParts.filter(p => p.data?.status === "completed").length;
    const totalTime = safeToolUseParts.reduce((acc, p) => acc + (p.data?.runts || 0), 0);
    const totalCount = safeToolUseParts.length;

    // While streaming / pending: show compact, sleek live activity indicator (max 3 recent tools)
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
            };
        });

        return (
            <div className="mt-2">
                <CascadeProgress
                    title={`EJECUTANDO ACCIONES (${safeToolUseParts.length})`}
                    steps={cascadeSteps}
                    isStreaming={isStreaming}
                />
            </div>
        );
    }

    // Collapsed state — Antigravity-style single inline text line
    if (!isExpanded) {
        return (
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
    const lastPart = parts[parts.length - 1];

    if (!lastPart || typeof lastPart !== "object") return { message: t("gulin.ai.message.thinking") };

    if (lastPart.type === "data-tooluse" && (lastPart as any)?.data?.approval === "needs-approval") {
        return { message: t("gulin.ai.message.waiting_approval"), isWaitingApproval: true };
    }

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
    const hasToolCalls = validParts.some(p => p.type === "data-tooluse" || p.type === "data-toolprogress");
    // All tool parts collected flat for the unified summary block
    const allToolParts = validParts.filter(
        (p): p is GulinUIMessagePart & { type: "data-tooluse" | "data-toolprogress" } =>
            p.type === "data-tooluse" || p.type === "data-toolprogress"
    );
    const displayParts = validParts.filter(p => {
        if (!isDisplayPart(p)) return false;
        // Tool parts are removed from inline rendering — unified block handles them
        if (p.type === "data-tooluse" || p.type === "data-toolprogress") return false;
        // Si hay herramientas, ocultamos el razonamiento del cuerpo del chat 
        // para que solo se vea en el modal (moval)
        if (p.type === "reasoning" && hasToolCalls) return false;
        // Filtrar partes de texto vacías o con placeholder de no content
        if (p.type === "text") {
            const raw = ((p as any)?.text || (p as any)?.content || "").trim();
            const decoded = decodeWAFText(raw).trim();
            if (!decoded || decoded === "(no text content)" || decoded === "(sin contenido de texto)") {
                return false;
            }
        }
        return true;
    });
    
    const fileParts = validParts.filter((part): part is GulinUIMessagePart & { type: "data-userfile" } => 
        part.type === "data-userfile" && part.data !== undefined
    );
    
    const { t } = useTranslation();
    const feedbackEnabled = useAtomValue(getSettingsKeyAtom("gulin.ai.feedback.enabled"));
    const compactMode = useAtomValue(getSettingsKeyAtom("gulin.ai.compact.mode"));
    const [isMessageCopied, setIsMessageCopied] = useState(false);

    // Separate intermediate tool monologue/observations from the final synthesized response
    const { intermediateText, finalParts } = useMemo(() => {
        if (message.role !== "assistant" || allToolParts.length === 0) {
            return { intermediateText: "", finalParts: displayParts };
        }

        let lastToolIndex = -1;
        displayParts.forEach((p, idx) => {
            if (p && (p.type === "data-tooluse" || p.type === "data-toolprogress")) {
                lastToolIndex = idx;
            }
        });

        if (lastToolIndex === -1) {
            return { intermediateText: "", finalParts: displayParts };
        }

        const intermediateList: string[] = [];
        const afterToolList: GulinUIMessagePart[] = [];

        displayParts.forEach((p, idx) => {
            if (idx < lastToolIndex) {
                if (p.type === "text" || p.type === "reasoning") {
                    const txt = ((p as any)?.text || (p as any)?.reasoning || (p as any)?.content || "").trim();
                    if (txt) intermediateList.push(txt);
                }
            } else if (idx > lastToolIndex) {
                afterToolList.push(p);
            }
        });

        return {
            intermediateText: intermediateList.join("\n\n"),
            finalParts: afterToolList,
        };
    }, [message.role, allToolParts.length, displayParts]);

    const thinkingData = getThinkingMessage(validParts, isStreaming, message.role, t);
    const groupedParts = useMemo(() => groupMessageParts(finalParts), [finalParts]);
    const seenBlockIds = new Set<string>();

    const allText = validParts
        .filter((p) => p && (p.type === "text" || p.type === "reasoning"))
        .map((p) => {
            const anyP = p as any;
            return anyP?.text || anyP?.reasoning || anyP?.content || "";
        })
        .filter(t => t != null)
        .join("\n\n");

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
                            onClick={handleCopyMessage}
                            className="p-1 text-zinc-400 hover:text-white rounded hover:bg-white/10 transition-colors text-[11px] flex items-center gap-1 cursor-pointer"
                            title="Copiar respuesta completa"
                        >
                            <i className={cn(isMessageCopied ? "fa-solid fa-check text-emerald-400" : "fa-regular fa-copy")} />
                            {isMessageCopied && <span className="text-[10px] text-emerald-400 font-sans">Copiado</span>}
                        </button>
                    </div>
                )}
                {displayParts.length === 0 && allToolParts.length === 0 && !isStreaming && !thinkingData ? (
                    <div className="whitespace-pre-wrap break-words opacity-70 italic">{t("gulin.ai.message.no_content")}</div>
                ) : (
                    <div className="space-y-2">
                        {/* Collapsed intermediate thoughts / monologue if any */}
                        {intermediateText && (
                            <AIReasoningBlock reasoning={intermediateText} isStreaming={isStreaming} />
                        )}
                        {/* Final clean synthesized response */}
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
                        {/* Unified tool summary block — placed cleanly at the bottom */}
                        {message.role === "assistant" && allToolParts.length > 0 && (
                            <AIMessageToolsSummary
                                toolParts={allToolParts}
                                isStreaming={isStreaming}
                                reasoning={allText}
                            />
                        )}
                        {thinkingData != null && thinkingData.message && !compactMode && (
                            <div className="mt-2 pt-2 border-t border-white/5">
                                <AIThinking 
                                    message={thinkingData.message} 
                                    isWaitingApproval={thinkingData.isWaitingApproval} 
                                />
                            </div>
                        )}
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
