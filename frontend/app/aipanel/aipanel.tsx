// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { handleGulinAIContextMenu } from "@/app/aipanel/aipanel-contextmenu";
import { gulinAIHasSelection } from "@/app/aipanel/gulinai-focus-utils";
import { ErrorBoundary } from "@/app/element/errorboundary";
import { atoms, getSettingsKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { isBuilderWindow } from "@/app/store/windowtype";
import { maybeUseTabModel } from "@/app/store/tab-model";
import { checkKeyPressed, keydownWrapper } from "@/util/keyutil";
import { isMacOS, isWindows } from "@/util/platformutil";
import { cn } from "@/util/util";
import { useTranslation } from "@/app/store/i18n";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import * as jotai from "jotai";
import { memo, useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useDrop } from "react-dnd";
import { formatFileSizeError, isAcceptableFile, validateFileSize } from "./ai-utils";
import { AIDroppedFiles } from "./aidroppedfiles";
import { AIModeDropdown } from "./aimode";
import { AIPanelHeader } from "./aipanelheader";
import { AIPanelInput } from "./aipanelinput";
import { AIPanelMessages } from "./aipanelmessages";
import { AIRateLimitStrip } from "./airatelimitstrip";
import { GulinUIMessage } from "./aitypes";
import { AIHistorySidebar } from "./aihistorysidebar";
import { BYOKAnnouncement } from "./byokannouncement";
import { TelemetryRequiredMessage } from "./telemetryrequired";
import { GulinAIModel } from "./gulinai-model";
import { isTTSEnabledAtom, lastQueryWasVoiceAtom } from "./voice/voice-atoms";
import { VoiceService } from "./voice/voice-service";

const AIBlockMask = memo(() => {
    return (
        <div
            key="block-mask"
            className="absolute top-0 left-0 right-0 bottom-0 border-1 border-transparent pointer-events-auto select-none p-0.5"
            style={{
                borderRadius: "var(--block-border-radius)",
                zIndex: "var(--zindex-block-mask-inner)",
            }}
        >
            <div
                className="w-full mt-[44px] h-[calc(100%-44px)] flex items-center justify-center"
                style={{
                    backgroundColor: "rgb(from var(--block-bg-color) r g b / 50%)",
                }}
            >
                <div className="font-bold opacity-70 mt-[-25%] text-[60px]">0</div>
            </div>
        </div>
    );
});

AIBlockMask.displayName = "AIBlockMask";

const AIDragOverlay = memo(() => {
    const { t } = useTranslation();
    return (
        <div
            key="drag-overlay"
            className="absolute inset-0 bg-accent/20 border-2 border-dashed border-accent rounded-lg flex items-center justify-center z-10 p-4"
        >
            <div className="text-accent text-center">
                <i className="fa fa-upload text-3xl mb-2"></i>
                <div className="text-lg font-semibold">{t("gulin.ai.welcome.drop_files")}</div>
                <div className="text-sm">{t("gulin.ai.welcome.supported_files")}</div>
            </div>
        </div>
    );
});

AIDragOverlay.displayName = "AIDragOverlay";

const KeyCap = memo(({ children, className }: { children: React.ReactNode; className?: string }) => {
    return (
        <kbd
            className={cn(
                "px-1.5 py-0.5 text-xs bg-zinc-700 border border-zinc-600 rounded-sm shadow-sm font-mono",
                className
            )}
        >
            {children}
        </kbd>
    );
});

KeyCap.displayName = "KeyCap";

const AIWelcomeMessage = memo(() => {
    const { t } = useTranslation();
    const modKey = isMacOS() ? "⌘" : "Alt";
    const aiModeConfigs = jotai.useAtomValue(atoms.gulinaiModeConfigAtom);
    const hasCustomModes = Object.keys(aiModeConfigs).some((key) => !key.startsWith("gulinai@"));
    return (
        <div className="text-secondary py-8">
            <div className="text-center">
                <i className="fa fa-sparkles text-4xl text-accent mb-2 block"></i>
                <p className="text-lg font-bold text-primary">{t("gulin.ai.welcome.title")}</p>
            </div>
            <div className="mt-4 text-left max-w-md mx-auto">
                <p className="text-sm mb-6">{t("gulin.ai.welcome.desc")}</p>
                <div className="bg-accent/10 border border-accent/30 rounded-lg p-4">
                    <div className="text-sm font-semibold mb-3 text-accent">{t("gulin.ai.welcome.getting_started")}</div>
                    <div className="space-y-3 text-sm">
                        <div className="flex items-start gap-3">
                            <div className="w-4 text-center flex-shrink-0">
                                <i className="fa-solid fa-plug text-accent"></i>
                            </div>
                            <div>
                                <span className="font-bold">{t("gulin.ai.welcome.widget_context.title")}</span>
                                <div className="">{t("gulin.ai.welcome.widget_context.on")}</div>
                                <div className="">{t("gulin.ai.welcome.widget_context.off")}</div>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <div className="w-4 text-center flex-shrink-0">
                                <i className="fa-solid fa-file-import text-accent"></i>
                            </div>
                            <div>{t("gulin.ai.welcome.drag_drop")}</div>
                        </div>
                        <div className="flex items-start gap-3">
                            <div className="w-4 text-center flex-shrink-0">
                                <i className="fa-solid fa-keyboard text-accent"></i>
                            </div>
                            <div className="space-y-1">
                                <div>
                                    <KeyCap>{modKey}</KeyCap>
                                    <KeyCap className="ml-1">K</KeyCap>
                                    <span className="ml-1.5">{t("gulin.ai.welcome.new_chat")}</span>
                                </div>
                                <div>
                                    <KeyCap>{modKey}</KeyCap>
                                    <KeyCap className="ml-1">Shift</KeyCap>
                                    <KeyCap className="ml-1">A</KeyCap>
                                    <span className="ml-1.5">{t("gulin.ai.welcome.toggle_panel")}</span>
                                </div>
                                <div>
                                    {isWindows() ? (
                                        <>
                                            <KeyCap>Alt</KeyCap>
                                            <KeyCap className="ml-1">0</KeyCap>
                                            <span className="ml-1.5">{t("gulin.ai.welcome.focus")}</span>
                                        </>
                                    ) : (
                                        <>
                                            <KeyCap>Ctrl</KeyCap>
                                            <KeyCap className="ml-1">Shift</KeyCap>
                                            <KeyCap className="ml-1">0</KeyCap>
                                            <span className="ml-1.5">{t("gulin.ai.welcome.focus")}</span>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <div className="w-4 text-center flex-shrink-0">
                                <i className="fa-brands fa-discord text-accent"></i>
                            </div>
                            <div>
                                {t("gulin.ai.welcome.questions")}
                                <a
                                    target="_blank"
                                    href="https://discord.gg/XfvZ334gwU"
                                    rel="noopener"
                                    className="text-accent hover:underline cursor-pointer"
                                >
                                    {t("gulin.ai.welcome.discord")}
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
                {!hasCustomModes && <BYOKAnnouncement />}
            </div>
        </div>
    );
});

AIWelcomeMessage.displayName = "AIWelcomeMessage";

const AIBuilderWelcomeMessage = memo(() => {
    return (
        <div className="text-secondary py-8">
            <div className="text-center">
                <i className="fa fa-sparkles text-4xl text-accent mb-4 block"></i>
                <p className="text-lg font-bold text-primary">GulinApp Builder</p>
            </div>
            <div className="mt-4 text-left max-w-md mx-auto">
                <p className="text-sm mb-6">
                    The GulinApp builder helps create gulin widgets that integrate seamlessly into Gulin Terminal.
                </p>
            </div>
        </div>
    );
});

AIBuilderWelcomeMessage.displayName = "AIBuilderWelcomeMessage";

const AIErrorMessage = memo(() => {
    const model = GulinAIModel.getInstance();
    const errorMessage = jotai.useAtomValue(model.errorMessage);

    if (!errorMessage) {
        return null;
    }

    return (
        <div className="px-4 py-2 text-red-400 bg-red-900/20 border-l-4 border-red-500 mx-2 mb-2 relative">
            <button
                onClick={() => model.clearError()}
                className="absolute top-2 right-2 text-red-400 hover:text-red-300 cursor-pointer z-10"
                aria-label="Close error"
            >
                <i className="fa fa-times text-sm"></i>
            </button>
            <div className="text-sm pr-6 max-h-[100px] overflow-y-auto">
                {errorMessage}
                <button
                    onClick={() => model.clearChat()}
                    className="ml-2 text-xs text-red-300 hover:text-red-200 cursor-pointer underline"
                >
                    New Chat
                </button>
            </div>
        </div>
    );
});

AIErrorMessage.displayName = "AIErrorMessage";

const ConfigChangeModeFixer = memo(() => {
    const model = GulinAIModel.getInstance();
    const telemetryEnabled = jotai.useAtomValue(getSettingsKeyAtom("telemetry:enabled")) ?? false;
    const aiModeConfigs = jotai.useAtomValue(model.aiModeConfigs);

    useEffect(() => {
        model.fixModeAfterConfigChange();
    }, [telemetryEnabled, aiModeConfigs, model]);

    return null;
});

ConfigChangeModeFixer.displayName = "ConfigChangeModeFixer";

const AIPanelComponentInner = memo(() => {
    const [isDragOver, setIsDragOver] = useState(false);
    const [isReactDndDragOver, setIsReactDndDragOver] = useState(false);
    const [initialLoadDone, setInitialLoadDone] = useState(false);
    const model = GulinAIModel.getInstance();
    const containerRef = useRef<HTMLDivElement>(null);
    const isLayoutMode = jotai.useAtomValue(atoms.controlShiftDelayAtom);
    const showOverlayBlockNums = jotai.useAtomValue(getSettingsKeyAtom("app:showoverlayblocknums")) ?? true;
    const isFocused = jotai.useAtomValue(model.isGulinAIFocusedAtom);
    const focusFollowsCursorMode = jotai.useAtomValue(getSettingsKeyAtom("app:focusfollowscursor")) ?? "off";
    const telemetryEnabled = jotai.useAtomValue(getSettingsKeyAtom("telemetry:enabled")) ?? false;
    const isPanelVisible = jotai.useAtomValue(model.getPanelVisibleAtom());
    const tabModel = maybeUseTabModel();
    const defaultMode = jotai.useAtomValue(getSettingsKeyAtom("gulinai:defaultmode")) ?? "gulinai@balanced";
    const aiModeConfigs = jotai.useAtomValue(model.aiModeConfigs);

    const hasCustomModes = Object.keys(aiModeConfigs).some((key) => !key.startsWith("gulinai@"));
    const isUsingCustomMode = !defaultMode.startsWith("gulinai@");
    const allowAccess = telemetryEnabled || (hasCustomModes && isUsingCustomMode);

    const { messages, sendMessage, status, setMessages, error, stop, data } = useChat<GulinUIMessage>({
        transport: new DefaultChatTransport({
            api: model.getUseChatEndpointUrl(),
            prepareSendMessagesRequest: (opts) => {
                let msg = model.getAndClearMessage();
                if (!msg || !(msg as any).messageid) {
                    const textInput = (opts as any)?.messages?.[(opts as any)?.messages?.length - 1]?.content || "";
                    msg = {
                        messageid: crypto.randomUUID(),
                        role: "user",
                        parts: [{ type: "text", text: typeof textInput === "string" ? textInput : "Hola" } as any],
                    } as any;
                }
                const body: any = {
                    msg,
                    chatid: globalStore.get(model.chatId),
                    widgetaccess: globalStore.get(model.widgetAccessAtom),
                    aimode: globalStore.get(model.currentAIMode),
                    skill: globalStore.get(model.selectedSkill)?.filename || "",
                    tokenmode: globalStore.get(atoms.tokenModeAtom),
                };
                if (isBuilderWindow()) {
                    body.builderid = globalStore.get(atoms.builderId);
                    body.builderappid = globalStore.get(atoms.builderAppId);
                } else {
                    body.tabid = tabModel.tabId;
                }
                return { body };
            },
        }),
        onData: (dataParts) => {
            if (!dataParts) return;
            const parts = Array.isArray(dataParts) ? dataParts : [dataParts];
            parts.forEach((item: any) => {
                if (item && item.type === "data-debuglog" && item.data) {
                    model.addDebugLog(
                        item.data.category,
                        item.data.message,
                        item.data.ts,
                        item.data.toolName,
                        item.data.durationMs,
                        item.data.status,
                        item.data.errorContext
                    );
                } else if (item && item.type === "data-tokenusage" && item.data) {
                    const reqTotal = item.data.total || 0;
                    setChatTokens(reqTotal);
                    setGlobalTokens((prev) => {
                        const newGlobal = prev + reqTotal;
                        localStorage.setItem("gulin_global_tokens", newGlobal.toString());
                        return newGlobal;
                    });
                }
            });
        },
        onFinish: (options: any) => {
            const wasVoice = globalStore.get(lastQueryWasVoiceAtom);
            const isTTS = globalStore.get(isTTSEnabledAtom);
            // Modo Inteligente: solo reproduce voz automáticamente si la pregunta se hizo por voz y el audio no está silenciado
            if (wasVoice && isTTS) {
                const msg = options?.message || options;
                let textContent = "";
                if (typeof msg?.content === "string") {
                    textContent = msg.content;
                } else if (Array.isArray(msg?.parts)) {
                    textContent = msg.parts
                        .filter((p: any) => p?.type === "text" && p?.text)
                        .map((p: any) => p.text)
                        .join(" ");
                }

                if (!textContent && Array.isArray(messages) && messages.length > 0) {
                    const lastMsg: any = messages[messages.length - 1];
                    if (lastMsg && (lastMsg.role === "assistant" || lastMsg.role === "system")) {
                        if (typeof lastMsg.content === "string") {
                            textContent = lastMsg.content;
                        } else if (Array.isArray(lastMsg.parts)) {
                            textContent = lastMsg.parts
                                .filter((p: any) => p?.type === "text" && p?.text)
                                .map((p: any) => p.text)
                                .join(" ");
                        }
                    }
                }

                if (textContent) {
                    VoiceService.getInstance().speakResponse(textContent);
                }
            }
            globalStore.set(lastQueryWasVoiceAtom, false);
        },
        onError: (error) => {
            model.setError(error.message || "An error occurred");
        },
    });

    model.registerUseChatData(sendMessage, setMessages, status, stop);
    useEffect(() => {
        model.registerTabModel(tabModel);
    }, [tabModel, model]);

    const [chatTokens, setChatTokens] = useState(0);

    const [globalTokens, setGlobalTokens] = useState(() => {
        return parseInt(localStorage.getItem("gulin_global_tokens") || "0", 10);
    });

    const handleResetGlobalTokens = useCallback(() => {
        setGlobalTokens(0);
        localStorage.removeItem("gulin_global_tokens");
    }, []);

    useEffect(() => {
        const handleReset = () => {
            setGlobalTokens(0);
        };
        const handleStorage = (e: StorageEvent) => {
            if (e.key === "gulin_global_tokens") {
                setGlobalTokens(parseInt(e.newValue || "0", 10));
            }
        };
        window.addEventListener("gulin_reset_global_tokens", handleReset);
        window.addEventListener("storage", handleStorage);
        return () => {
            window.removeEventListener("gulin_reset_global_tokens", handleReset);
            window.removeEventListener("storage", handleStorage);
        };
    }, []);



    // console.log("AICHAT messages", messages);
    (window as any).aichatmessages = messages;
    (window as any).aichatstatus = status;

    const handleKeyDown = (gulinEvent: GulinKeyboardEvent): boolean => {
        if (checkKeyPressed(gulinEvent, "Cmd:k")) {
            model.clearChat();
            return true;
        }
        return false;
    };

    useEffect(() => {
        globalStore.set(model.isAIStreaming, status === "streaming" || status === "submitted");
        if (status === "ready" || status === "error") {
            // Optional: could clear some temporary data here
        }
    }, [status]);


    useEffect(() => {
        const keyHandler = keydownWrapper(handleKeyDown);
        document.addEventListener("keydown", keyHandler);
        return () => {
            document.removeEventListener("keydown", keyHandler);
        };
    }, []);

    useEffect(() => {
        const loadChat = async () => {
            await model.uiLoadInitialChat();
            setInitialLoadDone(true);
        };
        loadChat();
    }, [model]);

    useEffect(() => {
        const updateWidth = () => {
            if (containerRef.current) {
                globalStore.set(model.containerWidth, containerRef.current.offsetWidth);
            }
        };

        updateWidth();

        const resizeObserver = new ResizeObserver(updateWidth);
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        return () => {
            resizeObserver.disconnect();
        };
    }, [model]);

    useEffect(() => {
        model.ensureRateLimitSet();
    }, [model]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await model.handleSubmit();
        setTimeout(() => {
            model.focusInput();
        }, 100);
    };

    const hasFilesDragged = (dataTransfer: DataTransfer): boolean => {
        // Check if the drag operation contains files by looking at the types
        return dataTransfer.types.includes("Files");
    };

    const handleDragOver = (e: React.DragEvent) => {
        if (!allowAccess) {
            return;
        }

        const hasFiles = hasFilesDragged(e.dataTransfer);

        // Only handle native file drags here, let react-dnd handle FILE_ITEM drags
        if (!hasFiles) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        if (!isDragOver) {
            setIsDragOver(true);
        }
    };

    const handleDragEnter = (e: React.DragEvent) => {
        if (!allowAccess) {
            return;
        }

        const hasFiles = hasFilesDragged(e.dataTransfer);

        // Only handle native file drags here, let react-dnd handle FILE_ITEM drags
        if (!hasFiles) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        if (!allowAccess) {
            return;
        }

        const hasFiles = hasFilesDragged(e.dataTransfer);

        // Only handle native file drags here, let react-dnd handle FILE_ITEM drags
        if (!hasFiles) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        // Only set drag over to false if we're actually leaving the drop zone
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;

        if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
            setIsDragOver(false);
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        if (!allowAccess) {
            e.preventDefault();
            e.stopPropagation();
            setIsDragOver(false);
            return;
        }

        // Check if this is a FILE_ITEM drag from react-dnd
        // If so, let react-dnd handle it instead
        if (!e.dataTransfer.files.length) {
            return; // Let react-dnd handle FILE_ITEM drags
        }

        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        const files = Array.from(e.dataTransfer.files);
        const acceptableFiles = files.filter(isAcceptableFile);

        for (const file of acceptableFiles) {
            const sizeError = validateFileSize(file);
            if (sizeError) {
                model.setError(formatFileSizeError(sizeError));
                return;
            }
            await model.addFile(file);
        }

        if (acceptableFiles.length < files.length) {
            const rejectedCount = files.length - acceptableFiles.length;
            const rejectedFiles = files.filter((f) => !isAcceptableFile(f));
            const fileNames = rejectedFiles.map((f) => f.name).join(", ");
            model.setError(
                `${rejectedCount} file${rejectedCount > 1 ? "s" : ""} rejected (unsupported type): ${fileNames}. Supported: images, PDFs, and text/code files.`
            );
        }
    };

    const handleFileItemDrop = useCallback(
        (draggedFile: DraggedFile) => {
            if (!allowAccess) {
                return;
            }
            model.addFileFromRemoteUri(draggedFile);
        },
        [model, allowAccess]
    );

    const [{ isOver, canDrop }, drop] = useDrop(
        () => ({
            accept: "FILE_ITEM",
            drop: handleFileItemDrop,
            collect: (monitor) => ({
                isOver: monitor.isOver(),
                canDrop: monitor.canDrop(),
            }),
        }),
        [handleFileItemDrop]
    );

    // Update drag over state for FILE_ITEM drags
    useEffect(() => {
        if (isOver && canDrop) {
            setIsReactDndDragOver(true);
        } else {
            setIsReactDndDragOver(false);
        }
    }, [isOver, canDrop]);

    // Attach the drop ref to the container
    useEffect(() => {
        if (containerRef.current) {
            drop(containerRef.current);
        }
    }, [drop]);

    const handleFocusCapture = useCallback(
        (event: React.FocusEvent) => {
            // console.log("Gulin AI focus capture", getElemAsStr(event.target));
            model.requestGulinAIFocus();
        },
        [model]
    );

    const handlePointerEnter = useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            if (focusFollowsCursorMode !== "on") return;
            if (event.pointerType === "touch" || event.buttons > 0) return;
            if (isFocused) return;
            model.focusInput();
        },
        [focusFollowsCursorMode, isFocused, model]
    );

    const handleClick = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        const isInteractive = target.closest('button, a, input, textarea, select, [role="button"], [tabindex]');

        if (isInteractive) {
            return;
        }

        const hasSelection = gulinAIHasSelection();
        if (hasSelection) {
            model.requestGulinAIFocus();
            return;
        }

        setTimeout(() => {
            if (!gulinAIHasSelection()) {
                model.focusInput();
            }
        }, 0);
    };

    const showBlockMask = isLayoutMode && showOverlayBlockNums;

    return (
        <div
            ref={containerRef}
            data-gulinai-panel="true"
            className={cn(
                "@container bg-[#09090b] flex flex-col relative w-full h-full z-10",
                (isDragOver || isReactDndDragOver) && "bg-zinc-800",
                isFocused ? "border-2 border-accent" : "border border-zinc-700/60"
            )}
            style={{
                borderTopRightRadius: model.inBuilder ? 0 : 10,
                borderBottomRightRadius: model.inBuilder ? 0 : 10,
                borderBottomLeftRadius: 10,
            }}
            onFocusCapture={handleFocusCapture}
            onPointerEnter={handlePointerEnter}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleClick}
            inert={!isPanelVisible ? true : undefined}
        >
            <AIHistorySidebar />
            <ConfigChangeModeFixer />
            {(isDragOver || isReactDndDragOver) && allowAccess && <AIDragOverlay />}
            {showBlockMask && <AIBlockMask />}
            <AIPanelHeader />
            <AIRateLimitStrip />

            <div key="main-content" className="flex-1 flex flex-col min-h-0 relative">
                {!allowAccess ? (
                    <TelemetryRequiredMessage />
                ) : (
                    <>
                        <div className="sticky top-0 z-20 bg-zinc-900/95 backdrop-blur-sm px-3 py-1 border-b border-gray-700/30">
                            <AIModeDropdown tokenCount={chatTokens} globalTokens={globalTokens} onResetGlobalTokens={handleResetGlobalTokens} />
                        </div>
                        {messages.length === 0 && initialLoadDone ? (
                            <div
                                className="flex-1 overflow-y-auto relative"
                                onContextMenu={(e) => handleGulinAIContextMenu(e, true)}
                            >
                                <div className="min-h-full flex flex-col items-center justify-center p-4">
                                    {model.inBuilder ? <AIBuilderWelcomeMessage /> : <AIWelcomeMessage />}
                                </div>
                            </div>
                        ) : (
                            <AIPanelMessages
                                messages={messages}
                                status={status}
                                onContextMenu={(e) => handleGulinAIContextMenu(e, true)}
                            />
                        )}
                        <AIErrorMessage />
                        <AIDroppedFiles model={model} />
                        <AIPanelInput onSubmit={handleSubmit} status={status} model={model} />
                    </>
                )}
            </div>
        </div>
    );
});

AIPanelComponentInner.displayName = "AIPanelInner";

const AIPanelComponent = () => {
    const model = GulinAIModel.getInstance();
    const chatId = jotai.useAtomValue(model.chatId);

    return (
        <ErrorBoundary>
            <AIPanelComponentInner key={chatId || "initial"} />
        </ErrorBoundary>
    );
};

AIPanelComponent.displayName = "AIPanel";

export { AIPanelComponent as AIPanel };
