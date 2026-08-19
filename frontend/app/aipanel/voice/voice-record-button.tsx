// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { audioLevelAtom, recordingDurationAtom, voiceStateAtom } from "./voice-atoms";
import { VoiceService } from "./voice-service";

interface VoiceRecordButtonProps {
    onSpeechSubmit: (text: string) => void;
    disabled?: boolean;
}

export const VoiceRecordButton: React.FC<VoiceRecordButtonProps> = memo(({ onSpeechSubmit, disabled }) => {
    const [voiceState, setVoiceState] = useAtom(voiceStateAtom);
    const audioLevel = useAtomValue(audioLevelAtom);
    const duration = useAtomValue(recordingDurationAtom);
    const [isHovered, setIsHovered] = useState(false);
    const isHoldingRef = useRef(false);
    const holdTimeoutRef = useRef<any>(null);

    const voiceService = VoiceService.getInstance();
    const isRecording = voiceState === "recording";

    // Formatear segundos en formato mm:ss
    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
    };

    const handleStart = useCallback(async () => {
        if (disabled || isRecording) return;
        await voiceService.startRecording((transcript) => {
            if (transcript) {
                onSpeechSubmit(transcript);
            }
        });
    }, [disabled, isRecording, onSpeechSubmit, voiceService]);

    const handleStopAndSend = useCallback(async () => {
        if (!isRecording) return;
        const text = await voiceService.stopAndSubmit();
        if (text) {
            onSpeechSubmit(text);
        }
    }, [isRecording, onSpeechSubmit, voiceService]);

    const handleCancel = useCallback(() => {
        voiceService.cancelRecording();
    }, [voiceService]);

    // Manejo de Click simple vs Mantener presionado (Estilo WhatsApp)
    const handleMouseDown = (e: React.MouseEvent) => {
        if (disabled) return;

        isHoldingRef.current = false;
        holdTimeoutRef.current = setTimeout(() => {
            isHoldingRef.current = true;
            if (!isRecording) {
                handleStart();
            }
        }, 220);
    };

    const handleMouseUp = (e: React.MouseEvent) => {
        if (disabled) return;

        if (holdTimeoutRef.current) {
            clearTimeout(holdTimeoutRef.current);
            holdTimeoutRef.current = null;
        }

        if (isHoldingRef.current) {
            isHoldingRef.current = false;
            handleStopAndSend();
        }
    };

    const handleClick = (e: React.MouseEvent) => {
        if (disabled) return;
        if (!isHoldingRef.current) {
            if (isRecording) {
                handleStopAndSend();
            } else {
                handleStart();
            }
        }
    };

    // Atajo de teclado global Cmd+Shift+V
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "v" || e.key === "V")) {
                e.preventDefault();
                if (isRecording) {
                    handleStopAndSend();
                } else {
                    handleStart();
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isRecording, handleStart, handleStopAndSend]);

    if (isRecording) {
        return (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-2.5 py-1 mb-0.5 animate-pulse select-none">
                {/* Indicador rojo parpadeante y contador */}
                <div className="flex items-center gap-1.5 text-red-400 font-mono text-xs font-semibold">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                    <span>{formatTime(duration)}</span>
                </div>

                {/* Ondas sonoras reactivas al volumen del micrófono */}
                <div className="flex items-center gap-0.5 h-4 px-1">
                    {[0.3, 0.7, 1.0, 0.6, 0.4].map((multiplier, i) => {
                        const height = Math.max(4, Math.min(16, (audioLevel * 24 + 4) * multiplier));
                        return (
                            <div
                                key={i}
                                className="w-1 bg-red-400 rounded-full transition-all duration-75"
                                style={{ height: `${height}px` }}
                            />
                        );
                    })}
                </div>

                {/* Botón cancelar */}
                <button
                    type="button"
                    onClick={handleCancel}
                    className="text-zinc-400 hover:text-zinc-200 text-xs px-1.5 py-0.5 rounded hover:bg-zinc-700/50 transition-colors cursor-pointer"
                    title="Cancelar grabación"
                >
                    <i className="fa-solid fa-trash-can text-[11px] mr-1" />
                    <span className="text-[10px] uppercase font-semibold">Cancelar</span>
                </button>

                {/* Botón Enviar Audio (WhatsApp) */}
                <button
                    type="button"
                    onClick={handleStopAndSend}
                    className="w-7 h-7 rounded-lg bg-red-500 hover:bg-red-400 text-white flex items-center justify-center transition-all cursor-pointer shadow-md shadow-red-500/20"
                    title="Enviar mensaje de voz"
                >
                    <i className="fa-solid fa-arrow-up text-xs font-bold" />
                </button>
            </div>
        );
    }

    return (
        <button
            type="button"
            onClick={handleClick}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            disabled={disabled}
            className={cn(
                "w-8 h-8 shrink-0 rounded-lg flex items-center justify-center transition-all cursor-pointer shadow-sm mb-0.5 relative group",
                voiceState === "listening"
                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/40 animate-pulse"
                    : voiceState === "speaking"
                    ? "bg-purple-500/20 text-purple-400 border border-purple-500/40"
                    : "bg-zinc-800/80 hover:bg-teal-500/20 text-zinc-400 hover:text-teal-400 border border-zinc-700/60 hover:border-teal-500/40"
            )}
            title="Mensaje de voz (Hacer click para hablar o Cmd+Shift+V)"
        >
            <i
                className={cn(
                    "text-sm transition-transform group-hover:scale-110",
                    voiceState === "speaking"
                        ? "fa-solid fa-volume-high animate-bounce text-purple-400"
                        : voiceState === "listening"
                        ? "fa-solid fa-ear-listen text-amber-400"
                        : "fa-solid fa-microphone"
                )}
            />
            {voiceState === "speaking" && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-purple-500 rounded-full animate-ping" />
            )}
        </button>
    );
});

VoiceRecordButton.displayName = "VoiceRecordButton";
