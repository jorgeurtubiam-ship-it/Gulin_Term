// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from "@/app/store/i18n";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { useState } from "react";
import { GulinAIModel } from "./gulinai-model";

interface TelemetryRequiredMessageProps {
    className?: string;
}

const TelemetryRequiredMessage = ({ className }: TelemetryRequiredMessageProps) => {
    const [isEnabling, setIsEnabling] = useState(false);

    const handleEnableTelemetry = async () => {
        setIsEnabling(true);
        try {
            await RpcApi.GulinAIEnableTelemetryCommand(TabRpcClient);
            setTimeout(() => {
                GulinAIModel.getInstance().focusInput();
            }, 100);
        } catch (error) {
            console.error("Failed to enable telemetry:", error);
            setIsEnabling(false);
        }
    };

    const { t } = useTranslation();

    return (
        <div className={cn("flex flex-col h-full", className)}>
            <div className="flex-grow"></div>
            <div className="flex items-center justify-center p-8 text-center">
                <div className="max-w-md space-y-6">
                    <div className="space-y-4">
                        <i className="fa fa-sparkles text-accent text-5xl"></i>
                        <h2 className="text-2xl font-semibold text-foreground">{t("gulin.ai.welcome.title")}</h2>
                        <p className="text-secondary leading-relaxed">
                            {t("gulin.ai.telemetry.intro")}
                        </p>
                    </div>

                    <div className="bg-blue-900/20 border border-blue-500 rounded-lg p-4">
                        <div className="flex items-start gap-3">
                            <i className="fa fa-info-circle text-blue-400 text-lg mt-0.5"></i>
                            <div className="text-left">
                                <div className="text-blue-400 font-medium mb-1">{t("gulin.ai.telemetry.title")}</div>
                                <div className="text-secondary text-sm mb-3">
                                    <p className="mb-2">
                                        {t("gulin.ai.telemetry.desc1")}
                                    </p>
                                    <p className="mb-2">
                                        {t("gulin.ai.telemetry.desc2")}
                                    </p>
                                    <p className="mb-2">
                                        {t("gulin.ai.telemetry.privacy")}
                                    </p>
                                    <p>
                                        {t("gulin.ai.telemetry.byok_info")}
                                        <a
                                            href="https://docs.gulin.dev/gulinai-modes"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="!text-secondary hover:!text-accent/80 cursor-pointer"
                                        >
                                            https://docs.gulin.dev/gulinai-modes
                                        </a>
                                        .
                                    </p>
                                </div>
                                <button
                                    onClick={handleEnableTelemetry}
                                    disabled={isEnabling}
                                    className="bg-accent/80 hover:bg-accent disabled:bg-accent/50 text-background px-4 py-2 rounded-lg font-medium cursor-pointer disabled:cursor-not-allowed"
                                >
                                    {isEnabling ? t("gulin.ai.telemetry.enabling") : t("gulin.ai.telemetry.enable_btn")}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="text-xs text-secondary">
                        <a
                            href="https://gulin.dev/privacy"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="!text-secondary hover:!text-accent/80 cursor-pointer"
                        >
                            {t("gulin.ai.telemetry.privacy_policy")}
                        </a>
                    </div>
                </div>
            </div>
            <div className="flex-grow-[2]"></div>
        </div>
    );
};

TelemetryRequiredMessage.displayName = "TelemetryRequiredMessage";

export { TelemetryRequiredMessage };
