// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from "@/app/store/i18n";
import { BlockModel } from "@/app/block/block-model";
import { Modal } from "@/app/modals/modal";
import { recordTEvent } from "@/app/store/global";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useEffect, useRef, useState } from "react";
import { GulinUIMessagePart } from "./aitypes";
import { RestoreBackupModal } from "./restorebackupmodal";
import { GulinAIModel } from "./gulinai-model";
import { decodeWAFText } from "./ai-utils";
import { getSettingsKeyAtom } from "@/app/store/global";

// matches pkg/filebackup/filebackup.go
const BackupRetentionDays = 5;

interface ToolDescLineProps {
    text: string;
}

const ToolDescLine = memo(({ text }: ToolDescLineProps) => {
    if (!text || typeof text !== "string") return null;
    let displayText = text;
    if (displayText.startsWith("* ")) {
        displayText = "• " + displayText.slice(2);
    }

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    const regex = /(?<!\w)([+-])(\d+)(?!\w)/g;
    let match;

    while ((match = regex.exec(displayText)) !== null) {
        if (match.index > lastIndex) {
            parts.push(displayText.slice(lastIndex, match.index));
        }

        const sign = match[1];
        const number = match[2];
        const colorClass = sign === "+" ? "text-green-600" : "text-red-600";
        parts.push(
            <span key={match.index} className={colorClass}>
                {sign}
                {number}
            </span>
        );

        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < displayText.length) {
        parts.push(displayText.slice(lastIndex));
    }

    return <div>{parts.length > 0 ? parts : displayText}</div>;
});

ToolDescLine.displayName = "ToolDescLine";

interface ToolDescProps {
    text: string | string[];
    className?: string;
}

const ToolDesc = memo(({ text, className }: ToolDescProps) => {
    if (!text) return null;
    const lines = Array.isArray(text) ? text : text.split("\n");

    if (lines.length === 0) return null;

    return (
        <div className={className}>
            {lines.map((line, idx) => (
                <ToolDescLine key={idx} text={line} />
            ))}
        </div>
    );
});

ToolDesc.displayName = "ToolDesc";

function getEffectiveApprovalStatus(baseApproval: string, isStreaming: boolean): string {
    return !isStreaming && baseApproval === "needs-approval" ? "timeout" : baseApproval;
}

interface AIToolApprovalButtonsProps {
    count: number;
    onApprove: () => void;
    onDeny: () => void;
}

const AIToolApprovalButtons = memo(({ count, onApprove, onDeny }: AIToolApprovalButtonsProps) => {
    const { t } = useTranslation();
    const approveText = count > 1 ? t("gulin.ai.tool.approve_all").replace("{count}", count.toString()) : t("gulin.ai.tool.approve");
    const denyText = count > 1 ? t("gulin.ai.tool.deny_all") : t("gulin.ai.tool.deny");

    return (
        <div className="mt-2 flex gap-2">
            <button
                onClick={onApprove}
                className="px-3 py-1 border border-gray-600 text-gray-300 hover:border-gray-500 hover:text-white text-sm rounded cursor-pointer transition-colors"
            >
                {approveText}
            </button>
            <button
                onClick={onDeny}
                className="px-3 py-1 border border-gray-600 text-gray-300 hover:border-gray-500 hover:text-white text-sm rounded cursor-pointer transition-colors"
            >
                {denyText}
            </button>
        </div>
    );
});

AIToolApprovalButtons.displayName = "AIToolApprovalButtons";

interface AIToolUseBatchItemProps {
    part: GulinUIMessagePart & { type: "data-tooluse" };
    effectiveApproval: string;
}

const AIToolUseBatchItem = memo(({ part, effectiveApproval }: AIToolUseBatchItemProps) => {
    const { t } = useTranslation();
    if (!part?.data) return null;
    const statusIcon = part.data.status === "completed" ? "✓" : part.data.status === "error" ? "✗" : "•";
    const statusColor =
        part.data.status === "completed"
            ? "text-success"
            : part.data.status === "error"
                ? "text-error"
                : "text-gray-400";
    const effectiveErrorMessage = part.data.errormessage || (effectiveApproval === "timeout" ? t("gulin.ai.tool.not_approved") : null);

    return (
        <div className="text-sm pl-2 flex items-start gap-1.5">
            <span className={cn("font-bold flex-shrink-0", statusColor)}>{statusIcon}</span>
            <div className="flex-1">
                <span className="text-gray-400">{part.data.tooldesc || part.data.toolname}</span>
                {effectiveErrorMessage && <div className="text-red-300 mt-0.5">{effectiveErrorMessage}</div>}
            </div>
        </div>
    );
});

AIToolUseBatchItem.displayName = "AIToolUseBatchItem";

interface AIToolUseBatchProps {
    parts: Array<GulinUIMessagePart & { type: "data-tooluse" }>;
    isStreaming: boolean;
}

const AIToolUseBatch = memo(({ parts, isStreaming }: AIToolUseBatchProps) => {
    const { t } = useTranslation();
    const [userApprovalOverride, setUserApprovalOverride] = useState<string | null>(null);

    if (!Array.isArray(parts) || parts.length === 0 || !parts[0]?.data) return null;
    const firstTool = parts[0].data;
    if (!firstTool) return null;
    const baseApproval = userApprovalOverride || firstTool.approval;
    const effectiveApproval = getEffectiveApprovalStatus(baseApproval, isStreaming);

    const handleApprove = () => {
        setUserApprovalOverride("user-approved");
        parts.forEach((part) => {
            if (part?.data?.toolcallid) {
                GulinAIModel.getInstance().toolUseSendApproval(part.data.toolcallid, "user-approved");
            }
        });
    };

    const handleDeny = () => {
        setUserApprovalOverride("user-denied");
        parts.forEach((part) => {
            if (part?.data?.toolcallid) {
                GulinAIModel.getInstance().toolUseSendApproval(part.data.toolcallid, "user-denied");
            }
        });
    };

    return (
        <div className="flex items-start gap-2 p-2 rounded bg-zinc-800/60 border border-zinc-700">
            <div className="flex-1">
                <div className="font-semibold">{t("gulin.ai.tool.reading_files")}</div>
                <div className="mt-1 space-y-0.5">
                    {parts.map((part, idx) => (
                        <AIToolUseBatchItem key={idx} part={part} effectiveApproval={effectiveApproval} />
                    ))}
                </div>
                {effectiveApproval === "needs-approval" && (
                    <AIToolApprovalButtons count={parts.length} onApprove={handleApprove} onDeny={handleDeny} />
                )}
            </div>
        </div>
    );
});

AIToolUseBatch.displayName = "AIToolUseBatch";

interface AIToolUseProps {
    part: GulinUIMessagePart & { type: "data-tooluse" };
    isStreaming: boolean;
    reasoning?: string;
}

const AIToolUse = memo(({ part, isStreaming, reasoning: reasoningProp }: AIToolUseProps) => {
    const toolData = part?.data;
    if (!toolData) return null;

    const { t } = useTranslation();
    const [userApprovalOverride, setUserApprovalOverride] = useState<string | null>(null);
    const reasoning = reasoningProp || toolData.thought;
    const [showReasoningModal, setShowReasoningModal] = useState(false);

    const model = GulinAIModel.getInstance();
    const restoreModalToolCallId = useAtomValue(model.restoreBackupModalToolCallId);
    const showRestoreModal = toolData.toolcallid && restoreModalToolCallId === toolData.toolcallid;
    const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const highlightedBlockIdRef = useRef<string | null>(null);

    const statusIcon = toolData.status === "completed" ? "✓" : toolData.status === "error" ? "✗" : "•";
    const statusStyles =
        toolData.status === "completed"
            ? "text-green-400 border-green-500/40 bg-green-500/10"
            : toolData.status === "error"
                ? "text-red-400 border-red-500/40 bg-red-500/10"
                : "text-gray-400 border-zinc-700 bg-zinc-800/60";

    const baseApproval = userApprovalOverride || toolData.approval;
    const effectiveApproval = getEffectiveApprovalStatus(baseApproval, isStreaming);

    const isFileWriteTool = toolData.toolname === "write_text_file" || toolData.toolname === "edit_text_file";

    useEffect(() => {
        return () => {
            if (highlightTimeoutRef.current) {
                clearTimeout(highlightTimeoutRef.current);
            }
        };
    }, []);

    const handleApprove = () => {
        setUserApprovalOverride("user-approved");
        GulinAIModel.getInstance().toolUseSendApproval(toolData.toolcallid, "user-approved");
    };

    const handleDeny = () => {
        setUserApprovalOverride("user-denied");
        GulinAIModel.getInstance().toolUseSendApproval(toolData.toolcallid, "user-denied");
    };

    const handleMouseEnter = () => {
        if (!toolData.blockid) return;

        if (highlightTimeoutRef.current) {
            clearTimeout(highlightTimeoutRef.current);
        }

        highlightedBlockIdRef.current = toolData.blockid;
        BlockModel.getInstance().setBlockHighlight({
            blockId: toolData.blockid,
            icon: "sparkles",
        });

        highlightTimeoutRef.current = setTimeout(() => {
            if (highlightedBlockIdRef.current === toolData.blockid) {
                BlockModel.getInstance().setBlockHighlight(null);
                highlightedBlockIdRef.current = null;
            }
        }, 2000);
    };

    const handleMouseLeave = () => {
        if (!toolData.blockid) return;

        if (highlightTimeoutRef.current) {
            clearTimeout(highlightTimeoutRef.current);
            highlightTimeoutRef.current = null;
        }

        if (highlightedBlockIdRef.current === toolData.blockid) {
            BlockModel.getInstance().setBlockHighlight(null);
            highlightedBlockIdRef.current = null;
        }
    };

    const handleOpenDiff = () => {
        recordTEvent("gulinai:showdiff");
        fireAndForget(() => GulinAIModel.getInstance().openDiff(toolData.inputfilename, toolData.toolcallid));
    };

    return (
        <>
            <div
                className={cn(
                    "flex flex-col gap-1 p-2 rounded border transition-all duration-200",
                    statusStyles,
                    "cursor-pointer hover:brightness-110 active:scale-[0.98]"
                )}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onClick={() => setShowReasoningModal(true)}
            >
            <div className="flex items-center gap-2">
                <span className="font-bold">{statusIcon}</span>
                <div className="font-semibold">{toolData.toolname}</div>
                <div className="flex-1" />
                {isFileWriteTool &&
                    toolData.inputfilename &&
                    toolData.writebackupfilename &&
                    toolData.runts &&
                    Date.now() - toolData.runts < BackupRetentionDays * 24 * 60 * 60 * 1000 && (
                        <button
                            onClick={() => {
                                recordTEvent("gulinai:revertfile", { "gulinai:action": "revertfile:open" });
                                model.openRestoreBackupModal(toolData.toolcallid);
                            }}
                            className="flex-shrink-0 px-1.5 py-0.5 border border-zinc-600 hover:border-zinc-500 hover:bg-zinc-700 rounded cursor-pointer transition-colors flex items-center gap-1 text-zinc-400"
                            title={t("gulin.ai.tool.restore_title")}
                        >
                            <span className="text-xs">{t("gulin.ai.tool.revert_file")}</span>
                            <i className="fa fa-clock-rotate-left text-xs"></i>
                        </button>
                    )}
                {isFileWriteTool && toolData.inputfilename && (
                    <button
                        onClick={handleOpenDiff}
                        className="flex-shrink-0 px-1.5 py-0.5 border border-zinc-600 hover:border-zinc-500 hover:bg-zinc-700 rounded cursor-pointer transition-colors flex items-center gap-1 text-zinc-400"
                        title={t("gulin.ai.tool.diff_title")}
                    >
                        <span className="text-xs">{t("gulin.ai.tool.show_diff")}</span>
                        <i className="fa fa-arrow-up-right-from-square text-xs"></i>
                    </button>
                )}
            </div>
            {toolData.tooldesc && <ToolDesc text={toolData.tooldesc} className="text-sm text-gray-400 pl-6" />}
            {(toolData.errormessage || effectiveApproval === "timeout") && (
                <div className="text-sm text-red-300 pl-6">{toolData.errormessage || t("gulin.ai.tool.not_approved")}</div>
            )}
            {effectiveApproval === "needs-approval" && (
                <div className="pl-6">
                    <AIToolApprovalButtons count={1} onApprove={handleApprove} onDeny={handleDeny} />
                </div>
            )}
            </div>
            {showRestoreModal && <RestoreBackupModal part={part} />}
            {showReasoningModal && (
                <Modal
                    open={true}
                    onClose={() => setShowReasoningModal(false)}
                    title="Razonamiento de la IA"
                    className="max-w-2xl"
                >
                    <div className="p-6">
                        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-white/10">
                            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                                <i className="fa fa-brain"></i>
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">¿Qué pensó Gulin?</h3>
                                <p className="text-xs text-gray-400">Contexto y lógica detrás de esta acción</p>
                            </div>
                        </div>
                        <div className="bg-zinc-950/40 p-4 rounded-lg border border-white/5 font-mono text-sm leading-relaxed text-zinc-300 max-h-[60vh] overflow-y-auto custom-scrollbar whitespace-pre-wrap">
                            {decodeWAFText(reasoning) || "Gulin realizó una acción técnica directa sin comentarios adicionales."}
                        </div>
                        <div className="mt-6 flex justify-end">
                            <button
                                onClick={() => setShowReasoningModal(false)}
                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-sm font-semibold transition-colors"
                            >
                                Entendido
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
        </>
    );
});

AIToolUse.displayName = "AIToolUse";

interface AIToolProgressProps {
    part: GulinUIMessagePart & { type: "data-toolprogress" };
}

const AIToolProgress = memo(({ part }: AIToolProgressProps) => {
    const progressData = part?.data;
    if (!progressData) return null;

    return (
        <div className="flex flex-col gap-1 p-2 rounded bg-zinc-800/60 border border-zinc-700">
            <div className="flex items-center gap-2">
                <i className="fa fa-spinner fa-spin text-gray-400"></i>
                <div className="font-semibold">{progressData.toolname || "Tool Progress"}</div>
            </div>
            {progressData.statuslines && Array.isArray(progressData.statuslines) && progressData.statuslines.length > 0 && (
                <ToolDesc text={progressData.statuslines} className="text-sm text-gray-400 pl-6 space-y-0.5" />
            )}
        </div>
    );
});

AIToolProgress.displayName = "AIToolProgress";

interface AIExpertStatusProps {
    part: GulinUIMessagePart & { type: "data-expert-status" };
}

export const AIExpertStatus = memo(({ part }: AIExpertStatusProps) => {
    const expertData = (part as any)?.data;
    if (!expertData) return null;
    const { expertid, status, task } = expertData;
    const isRunning = status === "running";

    return (
        <div className="flex flex-col gap-1 p-2 rounded bg-indigo-900/40 border border-indigo-700/50 my-2">
            <div className="flex items-center gap-2">
                {isRunning ? (
                    <i className="fa fa-robot fa-spin text-indigo-400"></i>
                ) : (
                    <i className="fa fa-check-circle text-green-400"></i>
                )}
                <div className="font-semibold text-indigo-200">
                    {(expertid || "expert").replace("_", " ").toUpperCase()}
                </div>
                <div className="text-xs text-indigo-300 ml-auto">
                    {isRunning ? "TRABAJANDO..." : "COMPLETADO"}
                </div>
            </div>
            {task && <div className="text-sm text-indigo-100 pl-6 italic">"{task}"</div>}
        </div>
    );
});

AIExpertStatus.displayName = "AIExpertStatus";

// ---- Terminal tool group: consolidates all tool calls sharing the same blockid into one card ----

interface AITerminalToolGroupCardProps {
    blockid: string;
    parts: Array<GulinUIMessagePart & { type: "data-tooluse" }>;
    isStreaming: boolean;
    reasoning?: string;
}

const AITerminalToolGroupCard = memo(({ parts, reasoning: reasoningProp }: AITerminalToolGroupCardProps) => {
    const [showReasoningModal, setShowReasoningModal] = useState(false);
    if (!Array.isArray(parts) || parts.length === 0) return null;

    // Representative tool: the first one that ran a command (not just output)
    const commandPart = parts.find((p) => p?.data?.toolname === "term_run_command") ?? parts[0];
    if (!commandPart?.data) return null;
    const toolData = commandPart.data;

    // Overall status: error if any errored, completed if all done, else pending
    const hasError = parts.some((p) => p?.data?.status === "error");
    const anyCompleted = parts.some((p) => p?.data?.status === "completed");
    const allCompletedOrFinished = parts.every((p) => p?.data?.status === "completed" || (p?.data?.toolname && !p?.data?.status));
    const overallStatus = hasError ? "error" : (allCompletedOrFinished || anyCompleted ? "completed" : "pending");
    
    // Reasoning from parts
    const effectiveReasoning = reasoningProp || parts.find(p => p.data?.thought)?.data?.thought;

    const statusIcon = overallStatus === "completed" ? "✓" : overallStatus === "error" ? "✗" : "•";
    const statusStyles =
        overallStatus === "completed"
            ? "text-green-400 border-green-500/40 bg-green-500/10"
            : overallStatus === "error"
                ? "text-red-400 border-red-500/40 bg-red-500/10"
                : "text-gray-400 border-zinc-700 bg-zinc-800/60";

    // Collect all distinct descriptions from tool calls (skip duplicates)
    const allDescs: string[] = [];
    const seenDescs = new Set<string>();
    for (const p of parts) {
        if (!p || !p.data) continue;
        const desc = p.data.tooldesc;
        if (desc && !seenDescs.has(desc)) {
            seenDescs.add(desc);
            allDescs.push(desc);
        }
    }

    // Show first tool name as the card title
    const cardTitle = toolData.toolname;

    return (
        <>
            <div
                className={cn(
                    "flex flex-col gap-1 p-2 rounded border transition-all duration-200",
                    statusStyles,
                    effectiveReasoning ? "cursor-pointer hover:brightness-110 active:scale-[0.98]" : ""
                )}
                onClick={effectiveReasoning ? () => setShowReasoningModal(true) : undefined}
            >
            <div className="flex items-center gap-2">
                <span className="font-bold">{statusIcon}</span>
                <div className="font-semibold">{cardTitle}</div>
            </div>
            {allDescs.length > 0 && (
                <div className="text-sm text-gray-400 pl-6 space-y-0.5">
                    {allDescs.map((desc, i) => (
                        <ToolDescLine key={i} text={desc} />
                    ))}
                </div>
            )}
            {parts.some((p) => p?.data?.errormessage) && (
                <div className="text-sm text-red-300 pl-6">
                    {parts.find((p) => p?.data?.errormessage)?.data?.errormessage}
                </div>
            )}
            </div>
            {showReasoningModal && effectiveReasoning && (
                <Modal
                    open={true}
                    onClose={() => setShowReasoningModal(false)}
                    title="Razonamiento de la IA"
                    className="max-w-2xl"
                >
                    <div className="p-6">
                        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-white/10">
                            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                                <i className="fa fa-brain"></i>
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">¿Qué pensó Gulin?</h3>
                                <p className="text-xs text-gray-400">Contexto y lógica detrás de esta acción agrupada</p>
                            </div>
                        </div>
                        <div className="bg-zinc-950/40 p-4 rounded-lg border border-white/5 font-mono text-sm leading-relaxed text-zinc-300 max-h-[60vh] overflow-y-auto custom-scrollbar whitespace-pre-wrap">
                            {decodeWAFText(effectiveReasoning)}
                        </div>
                        <div className="mt-6 flex justify-end">
                            <button
                                onClick={() => setShowReasoningModal(false)}
                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-sm font-semibold transition-colors"
                            >
                                Entendido
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
        </>
    );
});

AITerminalToolGroupCard.displayName = "AITerminalToolGroupCard";

// ---- Main group component ----

interface AIToolUseGroupProps {
    parts: Array<GulinUIMessagePart & { type: "data-tooluse" | "data-toolprogress" }>;
    isStreaming: boolean;
    seenBlockIds?: Set<string>;
    reasoning?: string;
}

type ToolGroupItem =
    | { type: "batch"; parts: Array<GulinUIMessagePart & { type: "data-tooluse" }> }
    | { type: "single"; part: GulinUIMessagePart & { type: "data-tooluse" } }
    | { type: "progress"; part: GulinUIMessagePart & { type: "data-toolprogress" } }
    | { type: "terminal-group"; blockid: string; parts: Array<GulinUIMessagePart & { type: "data-tooluse" }> };

// ============================================================
// ActionAnnouncer: Resumen final de herramientas ejecutadas
// ============================================================

interface ActionSummaryTool {
    toolname: string;
    status: string;
    runts?: number;
    errormessage?: string;
    icon: string;
    tooldesc?: string;
}

const toolIconMap: Record<string, string> = {
    read_text_file: "📁",
    read_dir: "📂",
    write_text_file: "✏️",
    edit_text_file: "✂️",
    delete_text_file: "🗑️",
    term_run_command: "💻",
    term_search: "🔍",
    brain_update: "🧠",
    brain_register_node: "🌐",
    brain_connect_nodes: "🔗",
    brain_search: "🔎",
    web_search: "🌍",
    web_navigate: "🧭",
    web_read_page: "📄",
    web_click: "👆",
    web_type: "⌨️",
    db_query: "🗃️",
    db_register_connection: "🔌",
    plugin_save: "🔧",
    apimanager_call: "📡",
    apimanager_register: "📋",
    hello_gulin: "👋",
};

function getToolIcon(toolname: string): string {
    if (toolIconMap[toolname]) return toolIconMap[toolname];
    if (toolname.startsWith("brain_")) return "🧠";
    if (toolname.startsWith("web_")) return "🌍";
    if (toolname.startsWith("db_")) return "🗃️";
    if (toolname.startsWith("term_")) return "💻";
    return "🔧";
}

function formatRunTime(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

const ActionSummaryBanner = memo(({ parts, isExpanded, onToggle, children }: { parts: Array<GulinUIMessagePart & { type: "data-tooluse" }>, isExpanded?: boolean, onToggle?: () => void, children?: React.ReactNode }) => {
    const validParts = parts.filter(p => p?.data?.toolname);
    if (validParts.length === 0) return null;

    const summaryTools: ActionSummaryTool[] = validParts.map(p => ({
        toolname: p.data!.toolname,
        status: p.data!.status || "pending",
        runts: p.data!.runts,
        errormessage: p.data!.errormessage,
        icon: getToolIcon(p.data!.toolname),
        tooldesc: p.data!.tooldesc,
    }));

    const totalTime = summaryTools.reduce((acc, t) => acc + (t.runts || 0), 0);
    const errorCount = summaryTools.filter(t => t.status === "error").length;
    const successCount = summaryTools.filter(t => t.status === "completed").length;
    const pendingCount = summaryTools.filter(t => t.status === "pending").length;
    const isAllDone = pendingCount === 0;
    
    // Don't show during streaming
    if (!isAllDone) return null;

    return (
        <div className="mt-3 pt-2 border-t border-white/10">
            <div className="bg-zinc-900/60 border border-zinc-700/50 rounded-lg overflow-hidden shadow-sm">
                {/* Header */}
                <div 
                    className="flex items-center gap-2 px-3 py-2 bg-zinc-800/80 border-b border-zinc-700/50 cursor-pointer hover:bg-zinc-700/80 transition-colors"
                    onClick={onToggle}
                >
                    <i className={cn("fa", isExpanded ? "fa-chevron-down" : "fa-chevron-right", "text-zinc-400 text-[10px] w-3 text-center")} />
                    {errorCount > 0 ? (
                        <span className="text-amber-400 text-sm">⚠️</span>
                    ) : (
                        <span className="text-emerald-400 text-sm">✓</span>
                    )}
                    <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                        Acciones ejecutadas ({validParts.length})
                    </span>
                    {!isExpanded && (
                        <div className="ml-auto flex items-center gap-2 text-[11px] text-zinc-500">
                            <span className="flex items-center gap-1">
                                <span className="text-emerald-500">{successCount}</span> éxito
                                {errorCount > 0 && (
                                    <><span className="text-zinc-600">·</span><span className="text-red-400">{errorCount}</span> error</>
                                )}
                            </span>
                        </div>
                    )}
                </div>
                {/* Body */}
                {isExpanded && (
                    <div className="px-3 py-2 space-y-2">
                        {children || summaryTools.map((tool, idx) => (
                            <div key={idx} className="flex flex-col gap-1">
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="w-4 text-center">{tool.icon}</span>
                                    <code className="text-zinc-300 font-mono text-[11px]">{tool.toolname}</code>
                                    <span className="ml-auto flex items-center gap-1">
                                        {tool.status === "completed" && (
                                            <span className="text-emerald-500">✓</span>
                                        )}
                                        {tool.status === "error" && (
                                            <span className="text-red-400" title={tool.errormessage}>✗</span>
                                        )}
                                        {tool.status === "pending" && (
                                            <span className="text-yellow-400">⋯</span>
                                        )}
                                        {tool.runts != null && (
                                            <span className="text-zinc-500 font-mono">{formatRunTime(tool.runts)}</span>
                                        )}
                                    </span>
                                </div>
                                {tool.tooldesc && (
                                    <div className="pl-6 ml-1.5 border-l-2 border-zinc-700/50">
                                        <ToolDesc text={tool.tooldesc} className="text-[11px] text-zinc-400" />
                                    </div>
                                )}
                                {tool.errormessage && (
                                    <div className="pl-6 ml-1.5 border-l-2 border-red-500/30">
                                        <div className="text-[11px] text-red-300/80 break-words font-mono bg-red-500/5 p-1.5 rounded-sm">
                                            {tool.errormessage}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
                {/* Footer summary */}
                {isExpanded && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800/40 border-t border-zinc-700/30 text-[11px] text-zinc-500">
                        <span className="flex items-center gap-1">
                            <i className="fa fa-clock-o" />
                            {totalTime > 0 ? formatRunTime(totalTime) : "—"}
                        </span>
                        <span className="text-zinc-600">|</span>
                        <span className="flex items-center gap-1">
                            <span className="text-emerald-500">{successCount}</span> éxito
                            {errorCount > 0 && (
                                <><span className="text-zinc-600">·</span><span className="text-red-400">{errorCount}</span> error</>
                            )}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
});

ActionSummaryBanner.displayName = "ActionSummaryBanner";

export const AIToolUseGroup = memo(({ parts, isStreaming, seenBlockIds, reasoning }: AIToolUseGroupProps) => {
    const { t } = useTranslation();
    const compactMode = useAtomValue(getSettingsKeyAtom("gulin.ai.compact.mode"));
    const [isExpanded, setIsExpanded] = useState(true);

    const tooluseParts = parts.filter((p) => p.type === "data-tooluse") as Array<
        GulinUIMessagePart & { type: "data-tooluse" }
    >;
    const toolprogressParts = parts.filter((p) => p.type === "data-toolprogress") as Array<
        GulinUIMessagePart & { type: "data-toolprogress" }
    >;

    const tooluseCallIds = new Set(tooluseParts.map((p) => p?.data?.toolcallid).filter(id => id != null));
    const filteredProgressParts = toolprogressParts.filter((p) => p && p.data && p.data.toolcallid && !tooluseCallIds.has(p.data.toolcallid));

    const isFileOp = (part: GulinUIMessagePart & { type: "data-tooluse" }) => {
        const toolName = part.data?.toolname;
        return toolName === "read_text_file" || toolName === "read_dir";
    };

    const isTerminalOp = (part: GulinUIMessagePart & { type: "data-tooluse" }) => {
        return !!part.data?.blockid;
    };

    const needsApproval = (part: GulinUIMessagePart & { type: "data-tooluse" }) => {
        return getEffectiveApprovalStatus(part.data?.approval, isStreaming) === "needs-approval";
    };

    const readFileNeedsApproval: Array<GulinUIMessagePart & { type: "data-tooluse" }> = [];
    const readFileOther: Array<GulinUIMessagePart & { type: "data-tooluse" }> = [];

    const safeToolUseParts = tooluseParts.filter(p => p && p.data);

    // Group terminal ops by blockid
    const terminalGroupMap = new Map<string, Array<GulinUIMessagePart & { type: "data-tooluse" }>>();
    for (const part of tooluseParts) {
        if (isTerminalOp(part) && !isFileOp(part)) {
            const bid = part.data?.blockid;
            if (bid) {
                if (!terminalGroupMap.has(bid)) terminalGroupMap.set(bid, []);
                terminalGroupMap.get(bid)!.push(part);
            }
        }
    }

    for (const part of safeToolUseParts) {
        if (isFileOp(part)) {
            if (needsApproval(part)) {
                readFileNeedsApproval.push(part);
            } else {
                readFileOther.push(part);
            }
        }
    }

    const groupedItems: ToolGroupItem[] = [];
    let addedApprovalBatch = false;
    let addedOtherBatch = false;
    const addedTerminalGroups = new Set<string>();

    for (const part of safeToolUseParts) {
        const isFileOpPart = isFileOp(part);
        const isTermOp = isTerminalOp(part);
        const partNeedsApproval = needsApproval(part);

        if (isFileOpPart && partNeedsApproval) {
            if (!addedApprovalBatch) {
                groupedItems.push({ type: "batch", parts: readFileNeedsApproval });
                addedApprovalBatch = true;
            }
        } else if (isFileOpPart && !partNeedsApproval) {
            if (!addedOtherBatch) {
                groupedItems.push({ type: "batch", parts: readFileOther });
                addedOtherBatch = true;
            }
        } else if (isTermOp) {
            const bid = part.data?.blockid;
            if (bid && !addedTerminalGroups.has(bid)) {
                addedTerminalGroups.add(bid);
                // Skip if already rendered in a previous tool group of this message
                if (seenBlockIds && seenBlockIds.has(bid)) {
                    // do nothing — already shown
                } else {
                    if (seenBlockIds) seenBlockIds.add(bid);
                    const groupParts = terminalGroupMap.get(bid)!;
                    if (groupParts.length === 1) {
                        groupedItems.push({ type: "single", part: groupParts[0] });
                    } else {
                        groupedItems.push({ type: "terminal-group", blockid: bid, parts: groupParts });
                    }
                }
            }
        } else {
            groupedItems.push({ type: "single", part });
        }
    }

    filteredProgressParts.forEach((part) => {
        groupedItems.push({ type: "progress", part });
    });

    const pendingCount = safeToolUseParts.filter(p => p.data?.status === "pending" || !p.data?.status).length;
    const isAllDone = safeToolUseParts.length > 0 && pendingCount === 0 && !isStreaming;

    const renderedItems = groupedItems.map((item, idx) => {
        if (item.type === "batch") {
            return (
                <div key={idx} className="mt-2">
                    <AIToolUseBatch parts={item.parts} isStreaming={isStreaming} />
                </div>
            );
        } else if (item.type === "progress") {
            return (
                <div key={idx} className="mt-2">
                    <AIToolProgress part={item.part} />
                </div>
            );
        } else if (item.type === "terminal-group") {
            return (
                <div key={idx} className="mt-2">
                    <AITerminalToolGroupCard
                        blockid={item.blockid}
                        parts={item.parts}
                        isStreaming={isStreaming}
                        reasoning={reasoning}
                    />
                </div>
            );
        } else {
            return (
                <div key={idx} className="mt-2">
                    <AIToolUse part={item.part} isStreaming={isStreaming} reasoning={reasoning} />
                </div>
            );
        }
    });

    const totalCount = safeToolUseParts.length;
    const errorCount = safeToolUseParts.filter(p => p.data?.status === "error").length;

    // Modo compacto: solo un inline "🔧 N tools"
    if (compactMode && !isStreaming && isAllDone) {
        return (
            <div className="mt-2 text-xs text-zinc-500 flex items-center gap-1.5">
                <span>🔧</span>
                <span>{totalCount} {t("gulin.ai.tool.tools")}</span>
                {errorCount > 0 && (
                    <span className="text-red-400">({errorCount} {t("gulin.ai.tool.errors")})</span>
                )}
            </div>
        );
    }

      return (
          <>
              {isAllDone ? (
                  <ActionSummaryBanner 
                      parts={tooluseParts} 
                      isExpanded={isExpanded} 
                      onToggle={() => setIsExpanded(!isExpanded)}
                  />
              ) : (
                  <>
                      {renderedItems}
                  </>
              )}
          </>
      );
});

AIToolUseGroup.displayName = "AIToolUseGroup";
