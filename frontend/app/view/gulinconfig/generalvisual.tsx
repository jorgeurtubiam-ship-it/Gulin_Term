import type { GulinConfigViewModel } from "@/app/view/gulinconfig/gulinconfig-model";
import { useAtom } from "jotai";
import { memo, useMemo } from "react";
import { useTranslation } from "@/app/store/i18n";

interface GulinGeneralVisualContentProps {
    model: GulinConfigViewModel;
}

function tryParseJSON(str: string): Record<string, any> {
    try {
        const parsed = JSON.parse(str);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            return parsed;
        }
    } catch (e) {
        // ignore
    }
    return {};
}

export const GulinGeneralVisualContent = memo(({ model }: GulinGeneralVisualContentProps) => {
    const { t } = useTranslation();
    const [fileContent, setFileContent] = useAtom(model.fileContentAtom);
    const parsedConfig = useMemo(() => tryParseJSON(fileContent), [fileContent]);

    const handleUpdateField = (field: string, value: any) => {
        const newConfig = { ...parsedConfig };
        if (value === "" || value === undefined || value === null) {
            delete newConfig[field];
        } else {
            newConfig[field] = value;
        }
        setFileContent(JSON.stringify(newConfig, null, 2));
        model.markAsEdited();
    };

    return (
        <div className="flex w-full h-full overflow-y-auto p-6 bg-zinc-900/50">
            <div className="flex flex-col gap-6 max-w-2xl w-full mx-auto">
                <div className="flex justify-between items-center border-b border-border pb-4">
                    <h2 className="text-xl font-semibold">{t("settings.general.title")}</h2>
                </div>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5 p-4 bg-zinc-800/20 border border-zinc-700/50 rounded-lg">
                        <label className="font-medium text-zinc-300 text-sm">{t("settings.general.language.label")}</label>
                        <select
                            className="px-3 py-2 bg-zinc-800 border fill-border border-zinc-600 rounded focus:outline-none focus:border-accent-500 max-w-xs text-sm"
                            value={parsedConfig["app:language"] || "en"}
                            onChange={(e) => handleUpdateField("app:language", e.target.value)}
                        >
                            <option value="en">English (US)</option>
                            <option value="es">Español (ES)</option>
                        </select>
                        <span className="text-xs text-zinc-500 mt-1">{t("settings.general.language.desc")}</span>
                    </div>

                    <div className="flex flex-col gap-4 p-4 bg-zinc-800/20 border border-border rounded-lg mt-4">
                        <div className="flex items-center gap-2 border-b border-border pb-2 mb-2">
                            <i className="fa-solid fa-bridge text-accent-500" />
                            <h3 className="font-semibold text-zinc-200">{t("settings.general.gulinbridge.title")}</h3>
                        </div>
                        <div className="flex items-center gap-2 mb-2">
                            <input
                                type="checkbox"
                                id="gulinbridge-enabled"
                                className="w-4 h-4 rounded border-zinc-600 bg-zinc-700 text-accent-500 focus:ring-accent-500"
                                checked={parsedConfig["gulinbridge:enabled"] || false}
                                onChange={(e) => handleUpdateField("gulinbridge:enabled", e.target.checked)}
                            />
                            <label htmlFor="gulinbridge-enabled" className="text-sm font-medium text-zinc-300">
                                {t("settings.general.gulinbridge.enabled")}
                            </label>
                        </div>
                        {parsedConfig["gulinbridge:enabled"] && (
                            <div className="flex flex-col gap-3 ml-6 pt-2 border-l border-zinc-700/50 pl-4">
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-xs font-medium text-zinc-400">{t("settings.general.gulinbridge.url")}</label>
                                    <input
                                        type="text"
                                        className="px-3 py-1.5 bg-zinc-800 border fill-border border-zinc-600 rounded focus:outline-none focus:border-accent-500 text-sm font-mono"
                                        value={parsedConfig["gulinbridge:url"] || ""}
                                        onChange={(e) => handleUpdateField("gulinbridge:url", e.target.value)}
                                        placeholder="http://localhost:8090"
                                    />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-xs font-medium text-zinc-400">{t("settings.general.gulinbridge.email")}</label>
                                    <input
                                        type="text"
                                        className="px-3 py-1.5 bg-zinc-800 border fill-border border-zinc-600 rounded focus:outline-none focus:border-accent-500 text-sm"
                                        value={parsedConfig["gulinbridge:email"] || ""}
                                        onChange={(e) => handleUpdateField("gulinbridge:email", e.target.value)}
                                        placeholder="admin@example.com"
                                    />
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-xs font-medium text-zinc-400">{t("settings.general.gulinbridge.password_secret")}</label>
                                    <input
                                        type="text"
                                        className="px-3 py-1.5 bg-zinc-800 border fill-border border-zinc-600 rounded focus:outline-none focus:border-accent-500 text-sm font-mono"
                                        value={parsedConfig["gulinbridge:passwordsecretname"] || ""}
                                        onChange={(e) => handleUpdateField("gulinbridge:passwordsecretname", e.target.value)}
                                        placeholder="gulinbridge:password"
                                    />
                                </div>
                            </div>
                        )}
                        <span className="text-xs text-zinc-500 mt-1">{t("settings.general.gulinbridge.desc")}</span>
                    </div>

                    <div className="pt-4 mt-4 border-t border-zinc-700/50">
                        <p className="text-xs text-zinc-400">{t("gulin.ai.note_raw")}</p>
                    </div>
                </div>
            </div>
        </div>
    );
});

GulinGeneralVisualContent.displayName = "GulinGeneralVisualContent";
