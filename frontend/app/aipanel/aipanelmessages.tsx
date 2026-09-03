// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtomValue } from "jotai";
import { memo, useEffect, useRef, useCallback, useState } from "react";
import { AIMessage, isInternalToolResult } from "./aimessage";
import { type GulinUIMessage } from "./aitypes";
import { GulinAIModel } from "./gulinai-model";

interface AIPanelMessagesProps {
    messages: GulinUIMessage[];
    status: string;
    onContextMenu?: (e: React.MouseEvent) => void;
}

export const AIPanelMessages = memo(({ messages, status, onContextMenu }: AIPanelMessagesProps) => {
    const model = GulinAIModel.getInstance();
    const isPanelOpen = useAtomValue(model.getPanelVisibleAtom());
    const containerRef = useRef<HTMLDivElement>(null);
    const bottomAnchorRef = useRef<HTMLDivElement>(null);
    
    // Estado y ref para saber si el usuario ha subido el scroll manualmente para leer
    const [isUserScrolledUp, setIsUserScrolledUp] = useState<boolean>(false);
    const userHasScrolledUpRef = useRef<boolean>(false);
    const prevStatusRef = useRef<string>(status);

    const scrollToBottom = useCallback((behavior: "auto" | "smooth" = "auto") => {
        const container = containerRef.current;
        if (!container) return;

        // Reset scroll position lock
        userHasScrolledUpRef.current = false;
        setIsUserScrolledUp(false);

        if (behavior === "smooth") {
            container.scrollTo({
                top: container.scrollHeight,
                behavior: "smooth",
            });
        } else {
            container.scrollTop = container.scrollHeight;
        }
    }, []);

    // Detectar cuando el usuario hace scroll manual con la rueda
    const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
        const container = containerRef.current;
        if (!container) return;

        if (e.deltaY < 0) {
            // Usuario giró la rueda activamente hacia arriba
            userHasScrolledUpRef.current = true;
            setIsUserScrolledUp(true);
        } else if (e.deltaY > 0) {
            // Usuario giró hacia abajo
            const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            if (distanceFromBottom <= 60) {
                userHasScrolledUpRef.current = false;
                setIsUserScrolledUp(false);
            }
        }
    }, []);

    // Detectar scroll pasivo
    const handleScroll = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;

        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (distanceFromBottom <= 60) {
            userHasScrolledUpRef.current = false;
            setIsUserScrolledUp(false);
        } else if (distanceFromBottom > 250 && status !== "streaming") {
            userHasScrolledUpRef.current = true;
            setIsUserScrolledUp(true);
        }
    }, [status]);

    // Mantener pegado al fondo cuando el panel se abre
    useEffect(() => {
        if (isPanelOpen) {
            const timer = setTimeout(() => {
                scrollToBottom("auto");
            }, 30);
            return () => clearTimeout(timer);
        }
    }, [isPanelOpen, scrollToBottom]);

    // Cuando inicia el streaming, asegurar scroll al fondo
    useEffect(() => {
        const wasNotStreaming = prevStatusRef.current !== "streaming";
        const isNowStreaming = status === "streaming";

        if (wasNotStreaming && isNowStreaming) {
            userHasScrolledUpRef.current = false;
            setIsUserScrolledUp(false);
            scrollToBottom("auto");
        }

        prevStatusRef.current = status;
    }, [status, scrollToBottom]);

    // Registro del comando imperativo global para scroll al fondo
    useEffect(() => {
        model.registerScrollToBottom(() => scrollToBottom("auto"));
    }, [model, scrollToBottom]);

    const displayMessages: GulinUIMessage[] = messages.filter((m) => !isInternalToolResult(m));
    if (
        status === "streaming" &&
        (displayMessages.length === 0 || displayMessages[displayMessages.length - 1].role !== "assistant")
    ) {
        displayMessages.push({ role: "assistant", parts: [], id: "last-message" } as any);
    }

    // Auto-scroll continuo durante el streaming si el usuario no ha subido manualmente
    useEffect(() => {
        if (!userHasScrolledUpRef.current) {
            const container = containerRef.current;
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        }
    }, [displayMessages, status]);

    return (
        <div
            className="flex-1 min-h-0 relative flex flex-col"
            onContextMenu={onContextMenu}
        >
            {/* Contenedor de scroll nativo acelerado por hardware */}
            <div
                ref={containerRef}
                onScroll={handleScroll}
                onWheel={handleWheel}
                className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-3 custom-scrollbar select-text"
                style={{
                    overflowAnchor: "auto",
                }}
            >
                {displayMessages.map((message, index) => {
                    const isStreamingDummy = message.id === "last-message";
                    const isStreaming =
                        (status === "streaming" || status === "submitted") &&
                        (isStreamingDummy || (index === displayMessages.length - 1 && message.role === "assistant"));

                    return (
                        <div key={message.id || `msg-${index}`} className="w-full">
                            <AIMessage message={message} isStreaming={isStreaming} />
                        </div>
                    );
                })}
                {/* Sentinel al final para anclaje */}
                <div ref={bottomAnchorRef} className="h-1 w-full pointer-events-none" />
            </div>

            {/* Botón flotante inteligente para volver abajo si el usuario subió */}
            {isUserScrolledUp && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
                    <button
                        onClick={() => scrollToBottom("smooth")}
                        className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-zinc-900/95 hover:bg-teal-950 text-teal-400 border border-teal-500/40 shadow-2xl backdrop-blur-md transition-all cursor-pointer group text-xs font-semibold hover:scale-105 active:scale-95"
                    >
                        <i className="fa-solid fa-arrow-down text-[10px] group-hover:translate-y-0.5 transition-transform" />
                        <span>Ir al último mensaje</span>
                        {status === "streaming" && (
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-500"></span>
                            </span>
                        )}
                    </button>
                </div>
            )}
        </div>
    );
});

AIPanelMessages.displayName = "AIPanelMessages";
