// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from "@/app/store/i18n";
import { useAtomValue, useAtom } from "jotai";
import { memo } from "react";
import { GulinAIModel } from "./gulinai-model";
import { cn, formatRelativeTime } from "@/util/util";

export const AIHistorySidebar = memo(() => {
    const model = GulinAIModel.getInstance();
    const isOpen = useAtomValue(model.isSidebarOpen);
    const summaries = useAtomValue(model.chatSummaries);
    const isLoading = useAtomValue(model.isLoadingChatSummaries);
    const activeChatId = useAtomValue(model.chatId);
    const [selectedIds, setSelectedIds] = useAtom(model.selectedChatIds);
    const { t } = useTranslation();

    if (!isOpen) {
        return null;
    }

    const isAllSelected = summaries.length > 0 && selectedIds.length === summaries.length;
    const hasSelection = selectedIds.length > 0;

    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) {
            model.setSelectedChatIds(summaries.map((s) => s.chatid));
        } else {
            model.clearChatSelection();
        }
    };

    const handleBulkDelete = () => {
        if (confirm(t("gulin.ai.history.bulk_delete_confirm").replace("{count}", selectedIds.length.toString()))) {
            model.bulkDeleteSelectedChats();
        }
    };

    return (
        <div className="absolute inset-0 z-[100] flex min-w-0">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                onClick={() => model.toggleSidebar(false)}
            />

            {/* Sidebar Content */}
            <div className="relative w-[320px] h-full bg-zinc-900 border-r border-zinc-700 shadow-2xl flex flex-col p-0 transition-transform duration-200">
                <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                    <h3 className="text-primary font-bold flex items-center gap-2">
                        <i className="fa fa-history text-accent"></i>
                        {t("gulin.ai.history.title")}
                    </h3>
                    <button
                        onClick={() => model.toggleSidebar(false)}
                        className="text-muted hover:text-primary transition-colors cursor-pointer"
                    >
                        <i className="fa fa-times"></i>
                    </button>
                </div>

                {summaries.length > 0 && (
                    <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between bg-zinc-950">
                        <label className="flex items-center gap-2 text-[10px] text-muted cursor-pointer hover:text-primary">
                            <input
                                type="checkbox"
                                checked={isAllSelected}
                                onChange={handleSelectAll}
                                className="w-3 h-3 accent-accent cursor-pointer"
                            />
                            {t("gulin.ai.history.select_all")}
                        </label>
                        {hasSelection && (
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-accent font-bold">
                                    {t("gulin.ai.history.selected").replace("{count}", selectedIds.length.toString())}
                                </span>
                                <button
                                    onClick={handleBulkDelete}
                                    className="text-[10px] bg-red-600/20 text-red-500 hover:bg-red-600 hover:text-white px-2 py-0.5 rounded transition-colors font-bold uppercase tracking-wider"
                                >
                                    {t("gulin.ai.history.delete_selected")}
                                </button>
                                <button
                                    onClick={() => model.clearChatSelection()}
                                    className="text-[10px] text-muted hover:text-primary"
                                >
                                    {t("gulin.ai.history.cancel_selection")}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {isLoading && summaries.length === 0 ? (
                        <div className="p-8 text-center text-muted">
                            <i className="fa fa-spinner fa-spin text-2xl mb-2"></i>
                            <p className="text-xs">{t("gulin.ai.history.loading")}</p>
                        </div>
                    ) : (
                        <div className="py-2">
                            {summaries.length === 0 ? (
                                <div className="p-8 text-center text-muted text-xs">
                                    {t("gulin.ai.history.no_chats")}
                                </div>
                            ) : (
                                summaries.map((s) => (
                                    <div
                                        key={s.chatid}
                                        className={cn(
                                            "group relative flex items-start px-4 py-3 cursor-pointer hover:bg-zinc-800 transition-colors border-l-2 gap-3",
                                            activeChatId === s.chatid ? "bg-zinc-800 border-accent" : "border-transparent",
                                            selectedIds.includes(s.chatid) && "bg-accent/5"
                                        )}
                                        onClick={() => model.switchToChat(s.chatid)}
                                    >
                                        <div
                                            className="pt-1"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                model.toggleChatSelection(s.chatid);
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(s.chatid)}
                                                readOnly
                                                className="w-3 h-3 accent-accent cursor-pointer"
                                            />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-start mb-1">
                                                <span className="text-[10px] text-accent uppercase font-bold tracking-tight">
                                                    {s.model || "Default Model"}
                                                </span>
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            // model.exportChatLog(s.chatid);
                                                        }}
                                                        className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-all p-1"
                                                        title={t("gulin.ai.history.export_title")}
                                                    >
                                                        <i className="fa fa-download text-[10px]"></i>
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (confirm(t("gulin.ai.history.delete_confirm"))) {
                                                                model.deleteChat(s.chatid);
                                                            }
                                                        }}
                                                        className="opacity-0 group-hover:opacity-100 text-muted hover:text-red-500 transition-all p-1"
                                                        title={t("gulin.ai.history.delete_title")}
                                                    >
                                                        <i className="fa fa-trash text-[10px]"></i>
                                                    </button>
                                                    <span className="text-[10px] text-muted">
                                                        {formatRelativeTime(s.lastupdate)}
                                                    </span>
                                                </div>
                                            </div>
                                            <p className="text-sm text-primary line-clamp-2 leading-snug">
                                                {s.snippet || t("gulin.ai.history.no_content")}
                                            </p>
                                            <div className="mt-1 text-[10px] text-muted flex items-center gap-1">
                                                <i className="fa fa-message text-[8px]"></i>
                                                {s.messagecount} {t("gulin.ai.history.messages")}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-zinc-800">
                    <button
                        onClick={() => {
                            model.clearChat();
                            model.toggleSidebar(false);
                        }}
                        className="w-full py-2 bg-accent hover:bg-accent-600 text-white rounded font-bold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg"
                    >
                        <i className="fa fa-plus"></i>
                        {t("gulin.ai.history.new_chat")}
                    </button>
                </div>
            </div>
        </div>
    );
});

AIHistorySidebar.displayName = "AIHistorySidebar";
