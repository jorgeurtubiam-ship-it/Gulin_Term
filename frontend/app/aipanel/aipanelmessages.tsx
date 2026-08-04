// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtomValue } from "jotai";
import { memo, useEffect, useRef } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { AIMessage } from "./aimessage";
import { AIModeDropdown } from "./aimode";
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
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const prevStatusRef = useRef<string>(status);
    // stickRef: true mientras el usuario está pegado al fondo.
    // Si sube manualmente durante streaming, se pone en false y NO se le arranca.
    const stickRef = useRef<boolean>(true);

    const scrollToBottom = () => {
        if (virtuosoRef.current) {
            virtuosoRef.current.scrollToIndex({
                index: "LAST",
                align: "end",
                behavior: "auto",
            });
        }
    };

    // Mantener pegado al fondo cuando el panel cambia a abierto.
    useEffect(() => {
        if (isPanelOpen) {
            const t = setTimeout(scrollToBottom, 50);
            return () => clearTimeout(t);
        }
    }, [isPanelOpen]);

    // Cuando finaliza el streaming, hacer un scroll final limpio (una sola vez).
    useEffect(() => {
        const wasStreaming = prevStatusRef.current === "streaming";
        const isNowNotStreaming = status !== "streaming";

        if (wasStreaming && isNowNotStreaming) {
            stickRef.current = true;
            requestAnimationFrame(() => {
                scrollToBottom();
            });
        }

        prevStatusRef.current = status;
    }, [status]);

    useEffect(() => {
        model.registerScrollToBottom(scrollToBottom);
    }, [model]);

    const displayMessages: GulinUIMessage[] = [...messages];
    if (
        status === "streaming" &&
        (messages.length === 0 || messages[messages.length - 1].role !== "assistant")
    ) {
        displayMessages.push({ role: "assistant", parts: [], id: "last-message" } as any);
    }

    return (
        <div className="flex-1 h-full relative" onContextMenu={onContextMenu}>
            <Virtuoso
                ref={virtuosoRef}
                data={displayMessages}
                className="w-full h-full"
                style={{ padding: "0.5rem" }}
                initialTopMostItemIndex={displayMessages.length > 0 ? displayMessages.length - 1 : 0}
                followOutput={(atBottom) => {
                    // Seguimos el stream solo si seguimos pegados al fondo (incluyendo el
                    // caso de que la lista crezca con contenido nuevo) y el usuario no subió.
                    // Virtuoso nos da 'atBottom' calculado por él mismo.
                    return stickRef.current && atBottom;
                }}
                atBottomStateChange={(atBottom) => {
                    stickRef.current = atBottom;
                }}
                itemContent={(index, message) => {
                    const isStreamingDummy = message.id === "last-message";
                    const isStreaming =
                        status === "streaming" &&
                        (isStreamingDummy || (index === displayMessages.length - 1 && message.role === "assistant"));

                    return (
                        <div className="pb-4">
                            <AIMessage key={message.id} message={message} isStreaming={isStreaming} />
                        </div>
                    );
                }}
            />
        </div>
    );
});

AIPanelMessages.displayName = "AIPanelMessages";
