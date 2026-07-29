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
    const rafRef = useRef<number | null>(null);

    const scrollToBottom = () => {
        if (virtuosoRef.current) {
            virtuosoRef.current.scrollToIndex({
                index: "LAST",
                align: "end",
                behavior: "auto",
            });
        }
    };

    // Auto-scroll continuo durante streaming
    useEffect(() => {
        if (status === "streaming") {
            const doScroll = () => {
                scrollToBottom();
                rafRef.current = requestAnimationFrame(doScroll);
            };
            rafRef.current = requestAnimationFrame(doScroll);
        } else {
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        }
        return () => {
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        };
    }, [status]);

    useEffect(() => {
        model.registerScrollToBottom(scrollToBottom);
    }, [model]);

    useEffect(() => {
        if (isPanelOpen) {
            setTimeout(scrollToBottom, 50);
        }
    }, [isPanelOpen]);

    useEffect(() => {
        const wasStreaming = prevStatusRef.current === "streaming";
        const isNowNotStreaming = status !== "streaming";

        if (wasStreaming && isNowNotStreaming) {
            requestAnimationFrame(() => {
                scrollToBottom();
            });
        }

        prevStatusRef.current = status;
    }, [status]);

    const displayMessages = [...messages];
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
                followOutput="smooth"
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
