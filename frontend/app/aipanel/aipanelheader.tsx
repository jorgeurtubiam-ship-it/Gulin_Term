// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from "@/app/store/i18n";
import { handleGulinAIContextMenu } from "@/app/aipanel/aipanel-contextmenu";
import { useAtom, useAtomValue } from "jotai";
import { memo, useEffect, useState } from "react";
import { atoms } from "@/app/store/global";
import { cn } from "@/util/util";
import { GulinAIModel } from "./gulinai-model";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { isHandsFreeEnabledAtom, isTTSEnabledAtom } from "./voice/voice-atoms";
import { VoiceWakeWordService } from "./voice/voice-wake-word";

export const AIPanelHeader = memo(() => {
    const model = GulinAIModel.getInstance();
    const workspaceLayoutModel = WorkspaceLayoutModel.getInstance();
    const widgetAccess = useAtomValue(model.widgetAccessAtom);
    const tokenMode = useAtomValue(atoms.tokenModeAtom);
    const inBuilder = model.inBuilder;
    const [isDebugVisible, setIsDebugVisible] = useAtom(model.isDebugVisible);
    const terminalVisible = useAtomValue(workspaceLayoutModel.terminalPanelVisibleAtom);
    // Obtener las configuraciones de modelos de GulinAIModel
    const aiModeConfigs = useAtomValue(model.aiModeConfigs as any);
    const currentAtomMode = useAtomValue(model.currentAIMode as any);
    const [currentMode, setCurrentMode] = useState<string>("assistant");
    
    // Obtener los modos para el dropdown, priorizando ollama para marcarlo como gratis/local
    const modes = Object.entries(aiModeConfigs || {}).map(([key, config]: [string, any]) => {
        return {
            id: key,
            name: config.name || key,
            isLocal: key.includes("ollama") || key.includes("local")
        };
    });

    const [isHandsFree, setIsHandsFree] = useAtom(isHandsFreeEnabledAtom);
    const [isTTSEnabled, setIsTTSEnabled] = useAtom(isTTSEnabledAtom);

    useEffect(() => {
        const wakeWordService = VoiceWakeWordService.getInstance();
        wakeWordService.setSubmitCallback((command) => {
            model.submitVoiceMessage(command);
        });

        if (isHandsFree) {
            wakeWordService.start();
        } else {
            wakeWordService.stop();
        }

        return () => {
            wakeWordService.stop();
        };
    }, [isHandsFree, model]);

    useEffect(() => {
        setCurrentMode((currentAtomMode as string) || "assistant");
    }, [currentAtomMode]);

    const handleModeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newMode = e.target.value;
        setCurrentMode(newMode);
        model.setAIMode(newMode);
    };

    const handleKebabClick = (e: React.MouseEvent) => {
        handleGulinAIContextMenu(e, false);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        handleGulinAIContextMenu(e, false);
    };

    const { t } = useTranslation();

    return (
        <div
            className="py-2.5 pl-4 pr-10 border-b border-gray-600 flex items-center justify-between min-w-0 box-border"
            onContextMenu={handleContextMenu}
        >
            <h2 className="text-white text-sm @xs:text-lg font-semibold flex items-center gap-2 flex-shrink-0 whitespace-nowrap">
                <i className="fa fa-sparkles text-accent"></i>
                {t("gulin.ai.welcome.title")}
            </h2>

            <div className="flex items-center flex-shrink-0 whitespace-nowrap gap-3 pr-4">
                {!inBuilder && (
                    <div className="flex items-center text-sm whitespace-nowrap">
                        
                        <span className="text-gray-300 @xs:hidden mr-1 text-[12px]">{t("gulin.ai.header.context")}</span>
                        <span className="text-gray-300 hidden @xs:inline mr-2 text-[12px]">{t("gulin.ai.header.widget_context")}</span>
                        <button
                            onClick={() => {
                                model.setWidgetAccess(!widgetAccess);
                                setTimeout(() => {
                                    model.focusInput();
                                }, 0);
                            }}
                            className={`relative inline-flex h-6 w-14 items-center rounded-full transition-colors cursor-pointer ${widgetAccess ? "bg-accent-600" : "bg-zinc-600"
                                }`}
                            title={`${t("gulin.ai.header.widget_access_title")} ${widgetAccess ? "ON" : "OFF"}`}
                        >
                            <span
                                className={`absolute inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${widgetAccess ? "translate-x-8" : "translate-x-1"
                                    }`}
                            />
                            <span
                                className={`relative z-10 text-xs text-white transition-all ${widgetAccess ? "ml-2.5 mr-6 text-left" : "ml-6 mr-1 text-right"
                                    }`}
                            >
                                {widgetAccess ? "ON" : "OFF"}
                            </span>
                        </button>
                    </div>
                )}

                {/* Toggle Manos Libres (Oye Gulin) */}
                <button
                    onClick={() => setIsHandsFree(!isHandsFree)}
                    className={cn(
                        "cursor-pointer transition-all px-2 py-1 rounded-full flex items-center gap-1 text-xs focus:outline-none border shrink-0",
                        isHandsFree
                            ? "bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-[0_0_8px_rgba(245,158,11,0.25)]"
                            : "text-zinc-400 hover:text-zinc-200 border-zinc-700/50 bg-zinc-800/60 hover:bg-zinc-700/60"
                    )}
                    title={isHandsFree ? "Modo Manos Libres ('Oye Gulin') ACTIVADO" : "Activar Modo Manos Libres ('Oye Gulin')"}
                >
                    <i className={cn("fa-solid fa-ear-listen text-[10px]", isHandsFree && "animate-pulse text-amber-400")} />
                    <span className="hidden @xs:inline text-[10px] font-bold uppercase tracking-wider">
                        {isHandsFree ? "Oye Gulin" : "Oye Gulin"}
                    </span>
                    <span
                        className={cn(
                            "w-1.5 h-1.5 rounded-full ml-0.5",
                            isHandsFree ? "bg-emerald-400 animate-ping" : "bg-zinc-600"
                        )}
                    />
                </button>

                {/* Toggle Voz de Respuesta (TTS) */}
                <button
                    onClick={() => setIsTTSEnabled(!isTTSEnabled)}
                    className={cn(
                        "cursor-pointer transition-colors p-1 rounded flex-shrink-0 focus:outline-none",
                        isTTSEnabled ? "text-purple-400 hover:text-purple-300" : "text-zinc-600 hover:text-zinc-400"
                    )}
                    title={isTTSEnabled ? "Voz de Gulin: ACTIVADA (Haz clic para silenciar)" : "Voz de Gulin: SILENCIADA (Haz clic para activar)"}
                >
                    <i className={cn("text-xs", isTTSEnabled ? "fa-solid fa-volume-high" : "fa-solid fa-volume-xmark")} />
                </button>

                <button
                    onClick={() => model.toggleSidebar()}
                    className="text-gray-400 hover:text-white cursor-pointer transition-colors p-1 rounded flex-shrink-0 ml-2 focus:outline-none"
                    title={t("gulin.ai.header.history_title")}
                >
                    <i className="fa fa-history"></i>
                </button>

                <button
                    onClick={() => workspaceLayoutModel.toggleTerminalPanel()}
                    className={cn(
                        "cursor-pointer transition-colors p-1 rounded flex-shrink-0 ml-2 focus:outline-none",
                        terminalVisible ? "text-accent" : "text-gray-400 hover:text-white"
                    )}
                    title={terminalVisible ? "Ocultar Terminal" : "Mostrar Terminal"}
                >
                    <i className="fa-solid fa-terminal"></i>
                </button>

                <button
                    onClick={handleKebabClick}
                    className="text-gray-400 hover:text-white cursor-pointer transition-colors p-1 rounded flex-shrink-0 ml-2 focus:outline-none"
                    title={t("gulin.ai.header.more_options_title")}
                >
                    <i className="fa fa-ellipsis-vertical"></i>
                </button>
            </div>
        </div>
    );
});

AIPanelHeader.displayName = "AIPanelHeader";
