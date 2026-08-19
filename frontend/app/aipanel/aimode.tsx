// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from "@/app/store/i18n";
import { Tooltip } from "@/app/element/tooltip";
import { atoms, getSettingsKeyAtom } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget, makeIconClass } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useRef, useState } from "react";
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
    onResetGlobalTokens?: () => void;
}

export const AIModeDropdown = memo(({ compatibilityMode = false, tokenCount = 0, globalTokens = 0, onResetGlobalTokens }: AIModeDropdownProps) => {
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

    // All mode configs array
    const allModeConfigs = useMemo(() => {
        return Object.entries(aiModeConfigs).map(([mode, config]) => ({ mode, ...config }));
    }, [aiModeConfigs]);

    // All available providers from allModeConfigs
    const providers = useMemo(() => {
        const set = new Set(allModeConfigs.map(c => c["ai:bridge-provider"] || c["ai:provider"] || "custom"));
        if (set.size === 0) {
            return ["anthropic", "openai", "gemini", "ollama", "custom"];
        }
        return Array.from(set).sort();
    }, [allModeConfigs]);

    // Get current provider from currentMode (stripping mode suffixes like @act / @plan)
    const currentBaseMode = currentMode ? (currentMode.endsWith("@plan") ? currentMode.slice(0, -5) : currentMode.endsWith("@act") ? currentMode.slice(0, -4) : currentMode) : "";
    const currentSuffix = currentMode.endsWith("@act") ? "@act" : currentMode.endsWith("@plan") ? "@plan" : "";
    const currentModeConfig = aiModeConfigs[currentBaseMode];
    const currentProvider = currentModeConfig?.["ai:bridge-provider"] || currentModeConfig?.["ai:provider"] || "custom";

    const [selectedProviderOverride, setSelectedProviderOverride] = useState<string | null>(null);
    const activeProvider = selectedProviderOverride || currentProvider;

    useEffect(() => {
        setSelectedProviderOverride(null);
    }, [currentBaseMode]);

    // Models filtered by selected provider (or current provider if not selected)
    const filteredModels = useMemo(() => {
        const res = allModeConfigs.filter(c => {
            const p = c["ai:bridge-provider"] || c["ai:provider"] || "custom";
            return p === activeProvider;
        });
        return res.length > 0 ? res : allModeConfigs;
    }, [allModeConfigs, activeProvider]);

    const handleSelectProvider = (provider: string) => {
        setSelectedProviderOverride(provider);
        const firstModel = allModeConfigs.find(c => (c["ai:bridge-provider"] || c["ai:provider"] || "custom") === provider);
        if (firstModel) {
            model.setAIMode(firstModel.mode + currentSuffix);
        }
        setIsProviderOpen(false);
    };

    const handleSelectModel = (mode: string) => {
        setIsModelOpen(false);
        model.setAIMode(mode + currentSuffix);
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
    const resolvedConfig = gulinaiModeConfigs[currentBaseMode];
    const hasToolsSupport = resolvedConfig && resolvedConfig["ai:capabilities"]?.includes("tools");
    const showNoToolsWarning = widgetContextEnabled && resolvedConfig && !hasToolsSupport;

    const tokenOptions = [
        { id: "mini", label: "Mínimo", desc: "Optimizado para tokens" },
        { id: "balanced", label: "Equilibrado", desc: "Consumo estándar" },
        { id: "max", label: "Máximo", desc: "Contexto completo" }
    ];

    const currentTokenLabel = tokenOptions.find(o => o.id === tokenMode)?.label || "Equilibrado";

    return (
        <div className="flex items-center flex-wrap gap-2.5 max-w-full py-1">
            {/* Provider Dropdown */}
            <div className="flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-wider text-gray-400 font-bold ml-0.5">Provider</span>
                <select
                    value={activeProvider}
                    onChange={(e) => handleSelectProvider(e.target.value)}
                    className="bg-zinc-950 text-gray-100 border border-teal-500/40 rounded-md px-2.5 py-1 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-teal-400 cursor-pointer capitalize shadow-sm"
                >
                    {providers.map((p) => (
                        <option key={p} value={p} className="bg-zinc-900 text-white capitalize py-1">
                            {p}
                        </option>
                    ))}
                </select>
            </div>

            {/* Model Dropdown */}
            <div className="flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-wider text-gray-400 font-bold ml-0.5">Model</span>
                <select
                    value={currentBaseMode}
                    onChange={(e) => {
                        if (e.target.value === "__configure__") {
                            handleConfigureClick();
                        } else if (e.target.value === "__new__") {
                            handleNewChatClick();
                        } else {
                            handleSelectModel(e.target.value);
                        }
                    }}
                    className="bg-zinc-950 text-gray-100 border border-teal-500/40 rounded-md px-2.5 py-1 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-teal-400 cursor-pointer max-w-[200px] truncate shadow-sm"
                >
                    <optgroup label={`${activeProvider.toUpperCase()} Models`}>
                        {filteredModels.map((config) => (
                            <option key={config.mode} value={config.mode} className="bg-zinc-900 text-white py-1">
                                {getModeDisplayName(config)}
                            </option>
                        ))}
                    </optgroup>
                    <option value="__new__" className="bg-zinc-950 text-green-400 font-medium">
                        ➕ Nuevo Chat
                    </option>
                    <option value="__configure__" className="bg-zinc-950 text-teal-400 font-medium">
                        ⚙️ Configurar Modelo...
                    </option>
                </select>
            </div>

            {/* Token Usage Dropdown */}
            <div className="flex flex-col gap-0.5">
                <span className="text-[9px] uppercase tracking-wider text-gray-400 font-bold ml-0.5">Uso de Tokens</span>
                <select
                    value={tokenMode}
                    onChange={(e) => handleSelectTokenMode(e.target.value)}
                    className="bg-zinc-950 text-gray-100 border border-white/10 rounded-md px-2.5 py-1 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-teal-400 cursor-pointer shadow-sm"
                >
                    {tokenOptions.map((opt) => (
                        <option key={opt.id} value={opt.id} className="bg-zinc-900 text-white py-1">
                            {opt.label} ({opt.desc})
                        </option>
                    ))}
                </select>
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
