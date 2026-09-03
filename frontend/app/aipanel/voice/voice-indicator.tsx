// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import React, { memo } from "react";
import { interimTranscriptAtom, isTTSEnabledAtom, voiceStateAtom } from "./voice-atoms";
import { VoiceService } from "./voice-service";

export const VoiceIndicator: React.FC = memo(() => {
    const [voiceState, setVoiceState] = useAtom(voiceStateAtom);
    const interimTranscript = useAtomValue(interimTranscriptAtom);
    const [isTTSEnabled, setIsTTSEnabled] = useAtom(isTTSEnabledAtom);

    const voiceService = VoiceService.getInstance();

    if (voiceState === "idle" || voiceState === "recording") {
        return null;
    }

    if (voiceState === "listening") {
        return (
            <div className="flex items-center justify-between bg-amber-500/15 border border-amber-500/30 rounded-lg px-3 py-1.5 mx-2 my-1 text-xs text-amber-300 animate-fadeIn">
                <div className="flex items-center gap-2 overflow-hidden">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping shrink-0" />
                    <i className="fa-solid fa-ear-listen shrink-0" />
                    <span className="font-medium truncate">
                        {interimTranscript ? `"${interimTranscript}"` : "Escuchando orden..."}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={() => setVoiceState("idle")}
                    className="text-amber-400 hover:text-amber-200 ml-2 text-[10px] uppercase font-bold shrink-0 cursor-pointer"
                >
                    Cancelar
                </button>
            </div>
        );
    }

    if (voiceState === "processing") {
        return (
            <div className="flex items-center justify-between bg-teal-500/15 border border-teal-500/30 rounded-lg px-3 py-1.5 mx-2 my-1 text-xs text-teal-300 animate-fadeIn">
                <div className="flex items-center gap-2 overflow-hidden">
                    <i className="fa-solid fa-circle-notch fa-spin shrink-0 text-teal-400" />
                    <span className="font-medium truncate">
                        {interimTranscript || "Procesando voz..."}
                    </span>
                </div>
            </div>
        );
    }

    if (voiceState === "speaking") {
        return (
            <div className="flex items-center justify-between bg-purple-500/15 border border-purple-500/30 rounded-lg px-3 py-1.5 mx-2 my-1 text-xs text-purple-300 animate-fadeIn">
                <div className="flex items-center gap-2">
                    <span className="flex gap-0.5 items-center">
                        <span className="w-1 h-3 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-1 h-4 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-1 h-2.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </span>
                    <i className="fa-solid fa-volume-high shrink-0" />
                    <span className="font-medium">Gulin respondiendo por voz...</span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => voiceService.stopSpeaking()}
                        className="bg-purple-500/30 hover:bg-purple-500/50 text-purple-200 px-2 py-0.5 rounded text-[10px] uppercase font-bold cursor-pointer transition-colors"
                        title="Silenciar a Gulin"
                    >
                        <i className="fa-solid fa-stop text-[9px] mr-1" />
                        Detener voz
                    </button>
                </div>
            </div>
        );
    }

    return null;
});

VoiceIndicator.displayName = "VoiceIndicator";
