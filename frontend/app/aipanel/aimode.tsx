// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from "@/app/store/i18n";
import { Tooltip } from "@/app/element/tooltip";
import { atoms, getSettingsKeyAtom } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget, makeIconClass } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useRef, useState } from "react";
import { getFilteredAIModeConfigs, getModeDisplayName } from "./ai-utils";
import { GulinAIModel } from "./gulinai-model";

interface AIModeMenuItemProps {
    config: AIModeConfigWithMode;
    isSelected: boolean;
    isDisabled: boolean;
    isPremiumDisabled: boolean;
    onClick: () => void;
    isFirst?: boolean;
    isLast?: boolean;
}

const AIModeMenuItem = memo(({ config, isSelected, isDisabled, isPremiumDisabled, onClick, isFirst, isLast }: AIModeMenuItemProps) => {
    return (
        <button
            key={config.mode}
            onClick={onClick}
            disabled={isDisabled}
            className={cn(
                "w-full flex flex-col gap-0.5 px-3 transition-colors text-left",
                isFirst ? "pt-1 pb-0.5" : isLast ? "pt-0.5 pb-1" : "pt-0.5 pb-0.5",
                isDisabled ? "text-zinc-500" : "text-zinc-300 hover:bg-zinc-700 cursor-pointer"
            )}
        >
            <div className="flex items-center gap-2 w-full">
                <i className={makeIconClass(config["display:icon"] || "sparkles", false)}></i>
                <span className={cn("text-sm", isSelected && "font-bold")}>
                    {getModeDisplayName(config)}
                    {isPremiumDisabled && useAtomValue(atoms.settingsAtom)["app:language"] === "es" ? " (premium)" : " (premium)"} 
                </span>
                {isSelected && <i className="fa fa-check ml-auto"></i>}
            </div>
            {config["display:description"] && (
                <div
                    className={cn("text-xs pl-5", isDisabled ? "text-gray-500" : "text-muted")}
                    style={{ whiteSpace: "pre-line" }}
                >
                    {config["display:description"]}
                </div>
            )}
        </button>
    );
});

AIModeMenuItem.displayName = "AIModeMenuItem";

interface ConfigSection {
    sectionName: string;
    configs: AIModeConfigWithMode[];
    isIncompatible?: boolean;
    noTelemetry?: boolean;
}

function computeCompatibleSections(
    currentMode: string,
    aiModeConfigs: Record<string, AIModeConfigType>,
    gulinProviderConfigs: AIModeConfigWithMode[],
    otherProviderConfigs: AIModeConfigWithMode[]
): ConfigSection[] {
    const currentConfig = aiModeConfigs[currentMode];
    const allConfigs = [...gulinProviderConfigs, ...otherProviderConfigs];

    // Gulin Custom: All models are now compatible to allow switching with Unified Memory.
    // We just return one section with all available configs.
    const sections: ConfigSection[] = [];
    sections.push({ sectionName: "Available Modes", configs: allConfigs });

    return sections;
}

function computeGulinCloudSections(
    gulinProviderConfigs: AIModeConfigWithMode[],
    otherProviderConfigs: AIModeConfigWithMode[],
    telemetryEnabled: boolean
): ConfigSection[] {
    const sections: ConfigSection[] = [];

    if (otherProviderConfigs.length > 0) {
        // Group by provider
        const groups: Record<string, AIModeConfigWithMode[]> = {};
        for (const config of otherProviderConfigs) {
            const provider = (config["ai:provider"] || "other").toUpperCase();
            if (!groups[provider]) {
                groups[provider] = [];
            }
            groups[provider].push(config);
        }

        // Sort providers alphabetically but keep certain ones at top if needed
        const sortedProviders = Object.keys(groups).sort();
        for (const provider of sortedProviders) {
            sections.push({ sectionName: provider, configs: groups[provider] });
        }
    }

    return sections;
}

interface AIModeDropdownProps {
    compatibilityMode?: boolean;
    tokenCount?: number;
    globalTokens?: number;
}

export const AIModeDropdown = memo(({ compatibilityMode = false, tokenCount = 0, globalTokens = 0 }: AIModeDropdownProps) => {
    const model = GulinAIModel.getInstance();
    const currentMode = useAtomValue(model.currentAIMode);
    const aiModeConfigs = useAtomValue(model.aiModeConfigs);
    const gulinaiModeConfigs = useAtomValue(atoms.gulinaiModeConfigAtom);
    const widgetContextEnabled = useAtomValue(model.widgetAccessAtom);
    const hasPremium = useAtomValue(model.hasPremiumAtom);
    const showCloudModes = useAtomValue(getSettingsKeyAtom("gulinai:showcloudmodes"));
    const [isProviderOpen, setIsProviderOpen] = useState(false);
    const [isModelOpen, setIsModelOpen] = useState(false);
    const [isTokenOpen, setIsTokenOpen] = useState(false);
    const providerRef = useRef<HTMLDivElement>(null);
    const modelRef = useRef<HTMLDivElement>(null);
    const tokenRef = useRef<HTMLDivElement>(null);

    const tokenMode = useAtomValue(atoms.tokenModeAtom);

    const { gulinProviderConfigs, otherProviderConfigs } = getFilteredAIModeConfigs(
        aiModeConfigs,
        showCloudModes,
        model.inBuilder,
        hasPremium,
        currentMode
    );

    const { t } = useTranslation();

    // Get current provider from currentMode
    const currentModeConfig = aiModeConfigs[currentMode.split("@")[0]];
    const currentProvider = currentModeConfig?.["ai:bridge-provider"] || currentModeConfig?.["ai:provider"] || "custom";

    // All available providers from otherProviderConfigs
    const providers = Array.from(new Set(otherProviderConfigs.map(c => c["ai:bridge-provider"] || c["ai:provider"] || "custom"))).sort();

    // Models filtered by selected provider (or current provider if not selected)
    const filteredModels = otherProviderConfigs.filter(c => {
        const p = c["ai:bridge-provider"] || c["ai:provider"] || "custom";
        return p === currentProvider;
    });

    const handleSelectProvider = (provider: string) => {
        setIsProviderOpen(false);
        // Find first model for this provider and select it
        const firstModel = otherProviderConfigs.find(c => (c["ai:bridge-provider"] || c["ai:provider"] || "custom") === provider);
        if (firstModel) {
            model.setAIMode(firstModel.mode);
        }
    };

    const handleSelectModel = (mode: string) => {
        setIsModelOpen(false);
        model.setAIMode(mode);
    };

    const handleSelectTokenMode = (mode: string) => {
        model.setTokenMode(mode as any);
        setIsTokenOpen(false);
    };

    const handleNewChatClick = () => {
        model.clearChat();
        setIsModelOpen(false);
        setIsProviderOpen(false);
    };

    const handleConfigureClick = () => {
        fireAndForget(async () => {
            await model.openGulinAIConfig();
            setIsModelOpen(false);
            setIsProviderOpen(false);
        });
    };

    const displayIcon = currentModeConfig ? currentModeConfig["display:icon"] || "sparkles" : "question";
    const displayName = currentModeConfig ? getModeDisplayName(currentModeConfig) : currentMode;
    const resolvedConfig = gulinaiModeConfigs[currentMode.split("@")[0]];
    const hasToolsSupport = resolvedConfig && resolvedConfig["ai:capabilities"]?.includes("tools");
    const showNoToolsWarning = widgetContextEnabled && resolvedConfig && !hasToolsSupport;

    const tokenOptions = [
        { id: "mini", label: "Mínimo", desc: "Optimizado para tokens" },
        { id: "balanced", label: "Equilibrado", desc: "Consumo estándar" },
        { id: "max", label: "Máximo", desc: "Contexto completo" }
    ];

    const currentTokenLabel = tokenOptions.find(o => o.id === tokenMode)?.label || "Equilibrado";

    return (
        <div className="flex items-center gap-2">
            {/* Provider Dropdown */}
            <div className="relative" ref={providerRef}>
                <div className="flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold ml-1">Provider</span>
                    <button
                        onClick={() => { setIsProviderOpen(!isProviderOpen); setIsModelOpen(false); setIsTokenOpen(false); }}
                        className={cn(
                            "group flex items-center justify-between gap-1.5 px-3 py-1.5 text-xs text-gray-300 hover:text-white rounded transition-colors cursor-pointer border border-white/5 min-w-[120px]",
                            isProviderOpen ? "bg-zinc-800" : "bg-zinc-950/60 hover:bg-zinc-800"
                        )}
                        title="Seleccionar Proveedor"
                    >
                        <span className="text-[11px] capitalize font-medium">{currentProvider}</span>
                        <i className="fa fa-chevron-down text-[8px] opacity-50"></i>
                    </button>
                </div>
                {isProviderOpen && (
                    <>
                        <div className="fixed inset-0 z-40" onClick={() => setIsProviderOpen(false)} />
                        <div className="absolute top-full left-0 mt-2 bg-zinc-950 border border-white/10 rounded-md shadow-2xl z-50 min-w-[150px] py-1 overflow-hidden">
                            <div className="px-3 py-1.5 text-[10px] text-gray-400 uppercase tracking-widest border-b border-gray-700/50 mb-1 bg-zinc-900/50">
                                Proveedores
                            </div>
                            {providers.map(p => (
                                <button
                                    key={p}
                                    onClick={() => handleSelectProvider(p)}
                                    className={cn(
                                        "w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 transition-colors capitalize flex items-center justify-between",
                                        currentProvider === p ? "text-blue-400 font-bold bg-blue-500/5" : "text-gray-300"
                                    )}
                                >
                                    {p}
                                    {currentProvider === p && <i className="fa fa-check text-[10px]"></i>}
                                </button>
                            ))}
                            <div className="border-t border-gray-700 my-1" />
                            <div className="px-1 py-1">
                                <button
                                    onClick={handleConfigureClick}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-gray-300 hover:bg-zinc-700 rounded transition-colors text-left"
                                >
                                    <i className={cn(makeIconClass("gear", false), "text-gray-400")}></i>
                                    <span className="text-xs">Configurar Modelo</span>
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Model Dropdown */}
            <div className="relative" ref={modelRef}>
                <div className="flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold ml-1">Model</span>
                    <button
                        onClick={() => { setIsModelOpen(!isModelOpen); setIsProviderOpen(false); setIsTokenOpen(false); }}
                        className={cn(
                            "group flex items-center justify-between gap-1.5 px-3 py-1.5 text-xs text-gray-300 hover:text-white rounded transition-colors cursor-pointer border border-white/5 min-w-[200px]",
                            isModelOpen ? "bg-zinc-800" : "bg-zinc-950/60 hover:bg-zinc-800"
                        )}
                        title={`${t("gulin.ai.welcome.title")}: ${displayName}`}
                    >
                        <div className="flex items-center gap-2 overflow-hidden">
                            <i className={cn(makeIconClass(displayIcon, false), "text-[10px] text-blue-400")}></i>
                            <span className="text-[11px] truncate font-medium">{displayName}</span>
                        </div>
                        <i className="fa fa-chevron-down text-[8px] opacity-50"></i>
                    </button>
                </div>

                {isModelOpen && (
                    <>
                        <div className="fixed inset-0 z-40" onClick={() => setIsModelOpen(false)} />
                        <div className="absolute top-full left-0 mt-2 bg-zinc-950 border border-white/10 rounded-md shadow-2xl z-50 min-w-[300px] py-1 max-h-[450px] overflow-y-auto">
                            <div className="px-3 py-1.5 text-[10px] text-gray-400 uppercase tracking-widest border-b border-gray-700/50 mb-1 bg-zinc-900/50">
                                {currentProvider.toUpperCase()} Models
                            </div>
                            {filteredModels.map((config, index) => {
                                const isPremiumDisabled = !hasPremium && config["gulinai:premium"];
                                const isSelected = currentMode === config.mode;
                                return (
                                    <AIModeMenuItem
                                        key={config.mode}
                                        config={config}
                                        isSelected={isSelected}
                                        isDisabled={isPremiumDisabled}
                                        isPremiumDisabled={isPremiumDisabled}
                                        onClick={() => handleSelectModel(config.mode)}
                                        isFirst={index === 0}
                                        isLast={index === filteredModels.length - 1}
                                    />
                                );
                            })}
                            <div className="border-t border-gray-700 my-1" />
                            <div className="px-1 py-1">
                                <button
                                    onClick={handleNewChatClick}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-gray-300 hover:bg-zinc-700 rounded transition-colors text-left"
                                >
                                    <i className={cn(makeIconClass("plus", false), "text-green-400")}></i>
                                    <span className="text-xs">{t("gulin.ai.mode.new_chat")}</span>
                                </button>
                                <button
                                    onClick={handleConfigureClick}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-gray-300 hover:bg-zinc-700 rounded transition-colors text-left"
                                >
                                    <i className={cn(makeIconClass("gear", false), "text-gray-400")}></i>
                                    <span className="text-xs">{t("gulin.ai.mode.configure")}</span>
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Token Usage Dropdown */}
            <div className="relative" ref={tokenRef}>
                <div className="flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold ml-1">Uso de Tokens</span>
                    <button
                        onClick={() => { setIsTokenOpen(!isTokenOpen); setIsModelOpen(false); setIsProviderOpen(false); }}
                        className={cn(
                            "group flex items-center justify-between gap-1.5 px-3 py-1.5 text-xs text-gray-300 hover:text-white rounded transition-colors cursor-pointer border border-white/5 min-w-[120px]",
                            isTokenOpen ? "bg-zinc-800" : "bg-zinc-950/60 hover:bg-zinc-800"
                        )}
                        title="Nivel de contexto y uso de tokens"
                    >
                        <div className="flex items-center gap-2 overflow-hidden">
                            <i className="fa fa-database text-[10px] text-green-400"></i>
                            <span className="text-[11px] truncate font-medium">{currentTokenLabel}</span>
                        </div>
                        <i className="fa fa-chevron-down text-[8px] opacity-50"></i>
                    </button>
                </div>

                {isTokenOpen && (
                    <>
                        <div className="fixed inset-0 z-40" onClick={() => setIsTokenOpen(false)} />
                        <div className="absolute top-full left-0 mt-2 bg-zinc-950 border border-white/10 rounded-md shadow-2xl z-50 min-w-[200px] py-1 overflow-hidden">
                            <div className="px-3 py-1.5 text-[10px] text-gray-400 uppercase tracking-widest border-b border-gray-700/50 mb-1 bg-zinc-900/50">
                                Modo de Contexto
                            </div>
                            {tokenOptions.map(opt => (
                                <button
                                    key={opt.id}
                                    onClick={() => handleSelectTokenMode(opt.id)}
                                    className={cn(
                                        "w-full px-3 py-2 text-left hover:bg-zinc-700 transition-colors flex flex-col gap-0.5",
                                        tokenMode === opt.id ? "bg-accent/10 border-l-2 border-accent" : ""
                                    )}
                                >
                                    <div className="flex items-center justify-between w-full">
                                        <span className={cn("text-xs font-medium", tokenMode === opt.id ? "text-accent" : "text-gray-300")}>
                                            {opt.label}
                                        </span>
                                        {tokenMode === opt.id && <i className="fa fa-check text-[10px] text-accent"></i>}
                                    </div>
                                    <span className="text-[10px] text-gray-500">{opt.desc}</span>
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {/* Token Counter Widget */}
            <div className="relative">
                <div className="flex flex-col gap-0.5">
                    <span className="text-[9px] uppercase tracking-wider text-gray-500 font-bold ml-1">Tokens</span>
                    <div className="flex gap-1">
                        <div
                            className="flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs text-green-400 bg-green-400/10 border border-green-400/20 rounded cursor-default min-w-[60px]"
                            title="Tokens en el chat actual"
                        >
                            <i className="fa fa-calculator text-[10px]"></i>
                            <span className="text-[11px] font-mono">{tokenCount.toLocaleString()}</span>
                        </div>
                        <div
                            className="flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs text-blue-400 bg-blue-400/10 border border-blue-400/20 rounded cursor-default min-w-[80px]"
                            title="Tokens históricos totales consumidos en todas las sesiones"
                        >
                            <i className="fa fa-globe text-[10px]"></i>
                            <span className="text-[11px] font-mono">{globalTokens.toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            </div>

            {showNoToolsWarning && (
                <Tooltip
                    content={<div className="max-w-xs">{t("gulin.ai.mode.tools_warning")}</div>}
                    placement="bottom"
                >
                    <div className="flex items-center gap-1 text-[10px] text-yellow-600 ml-1 cursor-default">
                        <i className="fa fa-triangle-exclamation"></i>
                    </div>
                </Tooltip>
            )}
        </div>
    );
});

AIModeDropdown.displayName = "AIModeDropdown";
