// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { memo, useState } from "react";
import { ChatBiWidget, ChatBiWidgetProps } from "./chatBi";
import { cn } from "@/util/util";

export const MAX_CHAT_VISUALS = 3; // Límite de visualizaciones en el chat

export interface ChatBiSplitProps {
    visuals: ChatBiWidgetProps[];
}

export const ChatBiSplit = memo(({ visuals }: ChatBiSplitProps) => {
    const [activeIndex, setActiveIndex] = useState(0);

    if (!visuals || visuals.length === 0) return null;

    const displayVisuals = visuals.slice(0, MAX_CHAT_VISUALS);
    const activeVisual = displayVisuals[activeIndex];

    if (displayVisuals.length === 1) {
        return <ChatBiWidget {...activeVisual} />;
    }

    return (
        <div className="flex flex-col w-full my-2 border border-violet-500/30 rounded-xl overflow-hidden bg-zinc-950/40 shadow-lg">
            <div className="flex bg-zinc-900/80 border-b border-zinc-800">
                {displayVisuals.map((vis, idx) => (
                    <button
                        key={idx}
                        onClick={() => setActiveIndex(idx)}
                        className={cn(
                            "flex-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors border-r border-zinc-800 last:border-r-0",
                            activeIndex === idx
                                ? "bg-violet-600/20 text-violet-300 border-b-2 border-b-violet-500"
                                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                        )}
                    >
                        <div className="flex items-center justify-center gap-2">
                            <i className="fa-solid fa-chart-pie"></i>
                            {vis.title || `Visual ${idx + 1}`}
                        </div>
                    </button>
                ))}
            </div>
            
            <div className="p-1">
                {activeVisual && <ChatBiWidget {...activeVisual} />}
            </div>

            {visuals.length > MAX_CHAT_VISUALS && (
                <div className="bg-orange-500/10 border-t border-orange-500/20 px-3 py-1.5 text-center">
                    <span className="text-[9px] text-orange-400">
                        <i className="fa-solid fa-triangle-exclamation mr-1"></i>
                        Mostrando {MAX_CHAT_VISUALS} de {visuals.length} visuales para mantener el rendimiento.
                    </span>
                </div>
            )}
        </div>
    );
});

ChatBiSplit.displayName = "ChatBiSplit";
