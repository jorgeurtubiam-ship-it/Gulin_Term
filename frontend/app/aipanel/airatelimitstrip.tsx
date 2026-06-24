// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from "@/app/store/i18n";
import { atoms } from "@/app/store/global";
import * as jotai from "jotai";
import { memo, useEffect, useState } from "react";
import { GulinAIModel } from "./gulinai-model";

const GetMoreButton = memo(({ variant, showClose = true }: { variant: "yellow" | "red"; showClose?: boolean }) => {
    const { t } = useTranslation();
    const isYellow = variant === "yellow";
    const bgColor = isYellow ? "bg-yellow-900/30" : "bg-red-900/30";
    const hoverBg = isYellow ? "hover:bg-yellow-700/60" : "hover:bg-red-700/60";
    const borderColor = isYellow ? "border-yellow-700/50" : "border-red-700/50";
    const textColor = isYellow ? "text-yellow-200" : "text-red-200";
    const iconColor = isYellow ? "text-yellow-400" : "text-red-400";
    const iconHoverBg =
        showClose && isYellow
            ? "hover:has-[.close:hover]:bg-yellow-900/30"
            : showClose
                ? "hover:has-[.close:hover]:bg-red-900/30"
                : "";

    if (true as boolean) {
        // disable now until we have modal
        return null;
    }

    return (
        <div className="pl-2 pb-1.5">
            <button
                className={`flex items-center gap-1.5 ${showClose ? "pl-1" : "pl-2"} pr-2 py-1 ${bgColor} ${iconHoverBg} ${hoverBg} rounded-b border border-t-0 ${borderColor} text-[11px] ${textColor} cursor-pointer transition-colors`}
            >
                {showClose && (
                    <i className={`close fa fa-xmark ${iconColor}/60 hover:${iconColor} transition-colors`}></i>
                )}
                <span>{t("gulin.ai.ratelimit.get_more")}</span>
                <i className={`fa fa-arrow-right ${iconColor}`}></i>
            </button>
        </div>
    );
});

GetMoreButton.displayName = "GetMoreButton";

function formatTimeRemaining(expirationEpoch: number, t: (key: string) => string): string {
    const now = Math.floor(Date.now() / 1000);
    const secondsRemaining = expirationEpoch - now;

    if (secondsRemaining <= 0) {
        return t("gulin.ai.ratelimit.soon");
    }

    const hours = Math.floor(secondsRemaining / 3600);
    const minutes = Math.floor((secondsRemaining % 3600) / 60);

    if (hours > 0) {
        return `${hours}${t("gulin.ai.ratelimit.hours")}`;
    }
    return `${minutes}${t("gulin.ai.ratelimit.minutes")}`;
}

const AIRateLimitStripComponent = memo(() => {
    let rateLimitInfo = jotai.useAtomValue(atoms.gulinAIRateLimitInfoAtom);
    const model = GulinAIModel.getInstance();
    const currentMode = jotai.useAtomValue(model.currentAIMode);
    const aiModeConfigs = jotai.useAtomValue(model.aiModeConfigs);
    const config = aiModeConfigs?.[currentMode];
    const isGulinProvider = config?.["ai:provider"] === "gulin";

    // rateLimitInfo = { req: 0, reqlimit: 200, preq: 0, preqlimit: 50, resetepoch: 1759374575 + 45 * 60 }; // testing
    const [, forceUpdate] = useState({});

    const shouldShow =
        isGulinProvider && rateLimitInfo && !rateLimitInfo.unknown && (rateLimitInfo.preq <= 5 || rateLimitInfo.req === 0);

    useEffect(() => {
        if (!shouldShow) {
            return;
        }

        const interval = setInterval(() => {
            forceUpdate({});
        }, 60000);

        return () => clearInterval(interval);
    }, [shouldShow]);

    if (!rateLimitInfo || rateLimitInfo.unknown || !shouldShow) {
        return null;
    }

    const { req, reqlimit, preq, preqlimit, resetepoch } = rateLimitInfo;
    const { t } = useTranslation();
    const timeRemaining = formatTimeRemaining(resetepoch, t);
    const totalLimit = preqlimit + reqlimit;

    if (preq > 0 && preq <= 5) {
        return (
            <div>
                <div className="bg-yellow-900/30 border-b border-yellow-700/50 px-2 py-1.5 flex items-center gap-1 text-[11px] text-yellow-200">
                    <i className="fa fa-sparkles text-yellow-400"></i>
                    <span>
                        {preqlimit - preq}/{preqlimit} {t("gulin.ai.ratelimit.premium_used")}
                    </span>
                    <div className="flex-1"></div>
                    <span className="text-yellow-300/80">{t("gulin.ai.ratelimit.resets_in")} {timeRemaining}</span>
                </div>
                <GetMoreButton variant="yellow" />
            </div>
        );
    }

    if (preq === 0 && req > 0) {
        return (
            <div>
                <div className="bg-yellow-900/30 border-b border-yellow-700/50 px-2 pr-1 py-1.5 flex items-center gap-1 text-[11px] text-yellow-200">
                    <i className="fa fa-check text-yellow-400"></i>
                    <span>
                        {preqlimit}/{preqlimit} {t("gulin.ai.ratelimit.premium")}
                    </span>
                    <span className="text-yellow-400">•</span>
                    <span className="font-medium">{t("gulin.ai.ratelimit.now_on_basic")}</span>
                    <div className="flex-1"></div>
                    <span className="text-yellow-300/80">{t("gulin.ai.ratelimit.resets_in")} {timeRemaining}</span>
                </div>
                <GetMoreButton variant="yellow" />
            </div>
        );
    }

    if (req === 0 && preq === 0) {
        return (
            <div>
                <div className="bg-red-900/30 border-b border-red-700/50 px-2 py-1.5 flex items-center gap-2 text-[11px] text-red-200">
                    <i className="fa fa-check text-red-400"></i>
                    <span>
                        {totalLimit}/{totalLimit} {t("gulin.ai.ratelimit.reqs")}
                    </span>
                    <span className="text-red-400">•</span>
                    <span className="font-medium">{t("gulin.ai.ratelimit.limit_reached")}</span>
                    <div className="flex-1"></div>
                    <span className="text-red-300/80">{t("gulin.ai.ratelimit.resets_in")} {timeRemaining}</span>
                </div>
                <GetMoreButton variant="red" showClose={false} />
            </div>
        );
    }

    return null;
});

AIRateLimitStripComponent.displayName = "AIRateLimitStrip";

export { AIRateLimitStripComponent as AIRateLimitStrip };
