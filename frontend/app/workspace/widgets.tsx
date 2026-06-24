// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { useTranslation } from "@/app/store/i18n";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { shouldIncludeWidgetForWorkspace } from "@/app/workspace/widgetfilter";
import { atoms, createBlock, isDev } from "@/store/global";
import { fireAndForget, makeIconClass } from "@/util/util";
import {
    FloatingPortal,
    autoUpdate,
    offset,
    shift,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import { useAtomValue } from "jotai";
import { memo, useEffect, useRef, useState } from "react";

function sortByDisplayOrder(wmap: { [key: string]: WidgetConfigType }): WidgetConfigType[] {
    if (wmap == null) {
        return [];
    }
    const wlist = Object.values(wmap);
    wlist.sort((a, b) => {
        return (a["display:order"] ?? 0) - (b["display:order"] ?? 0);
    });
    return wlist;
}

async function handleWidgetSelect(widget: WidgetConfigType) {
    const blockDef = widget.blockdef;
    createBlock(blockDef, widget.magnified);
}

function calculateGridSize(appCount: number): number {
    if (appCount <= 4) return 2;
    if (appCount <= 9) return 3;
    if (appCount <= 16) return 4;
    if (appCount <= 25) return 5;
    return 6;
}

const AppsFloatingWindow = memo(
    ({
        isOpen,
        onClose,
        referenceElement,
        widgets,
    }: {
        isOpen: boolean;
        onClose: () => void;
        referenceElement: HTMLElement;
        widgets: WidgetConfigType[];
    }) => {
        const [apps, setApps] = useState<AppInfo[]>([]);
        const [loading, setLoading] = useState(true);

        const { refs, floatingStyles, context } = useFloating({
            open: isOpen,
            onOpenChange: onClose,
            placement: "left-start",
            middleware: [offset(-2), shift({ padding: 12 })],
            whileElementsMounted: autoUpdate,
            elements: {
                reference: referenceElement,
            },
        });

        const dismiss = useDismiss(context);
        const { getFloatingProps } = useInteractions([dismiss]);

        useEffect(() => {
            if (!isOpen) return;

            const fetchApps = async () => {
                setLoading(true);
                try {
                    const allApps = await RpcApi.ListAllAppsCommand(TabRpcClient);
                    const localApps = allApps
                        .filter((app) => !app.appid.startsWith("draft/"))
                        .sort((a, b) => {
                            const aName = a.appid.replace(/^local\//, "");
                            const bName = b.appid.replace(/^local\//, "");
                            return aName.localeCompare(bName);
                        });
                    setApps(localApps);
                } catch (error) {
                    console.error("Failed to fetch apps:", error);
                    setApps([]);
                } finally {
                    setLoading(false);
                }
            };

            fetchApps();
        }, [isOpen]);

        if (!isOpen) return null;

        const totalItems = apps.length + widgets.length + 3;
        const gridSize = calculateGridSize(totalItems);

        return (
            <FloatingPortal>
                <div
                    ref={refs.setFloating}
                    style={floatingStyles}
                    {...getFloatingProps()}
                    className="bg-modalbg border border-border rounded-lg shadow-xl p-4 z-50"
                >
                    {loading ? (
                        <div className="flex items-center justify-center p-8">
                            <i className="fa fa-solid fa-spinner fa-spin text-2xl text-muted"></i>
                        </div>
                    ) : (
                        <div
                            className="grid gap-3"
                            style={{
                                gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
                                maxWidth: `${gridSize * 80}px`,
                            }}
                        >
                            {widgets.map((widget, idx) => {
                                if (widget["display:hidden"]) return null;
                                return (
                                    <div
                                        key={`widget-${idx}`}
                                        className="flex flex-col items-center justify-center p-2 rounded hover:bg-hoverbg cursor-pointer transition-colors"
                                        onClick={() => {
                                            handleWidgetSelect(widget);
                                            onClose();
                                        }}
                                        title={widget.description || widget.label}
                                    >
                                        <div style={{ color: widget.color }} className="text-3xl mb-1">
                                            <i className={makeIconClass(widget.icon, true, { defaultIcon: "browser" })}></i>
                                        </div>
                                        <div className="text-xxs text-center text-secondary break-words w-full px-1">
                                            {widget.label}
                                        </div>
                                    </div>
                                );
                            })}
                            <div
                                className="flex flex-col items-center justify-center p-2 rounded hover:bg-hoverbg cursor-pointer transition-colors"
                                onClick={() => {
                                    createBlock({ meta: { view: "service-map" } }, true);
                                    onClose();
                                }}
                            >
                                <div className="text-indigo-400 text-3xl mb-1">
                                    <i className={makeIconClass("network-wired", true)}></i>
                                </div>
                                <div className="text-xxs text-center text-secondary break-words w-full px-1">Mapa</div>
                            </div>
                            <div
                                className="flex flex-col items-center justify-center p-2 rounded hover:bg-hoverbg cursor-pointer transition-colors"
                                onClick={() => {
                                    createBlock({ meta: { view: "tools-admin" } }, true);
                                    onClose();
                                }}
                            >
                                <div className="text-green-400 text-3xl mb-1">
                                    <i className={makeIconClass("wrench", true)}></i>
                                </div>
                                <div className="text-xxs text-center text-secondary break-words w-full px-1">Tools</div>
                            </div>
                            <div
                                className="flex flex-col items-center justify-center p-2 rounded hover:bg-hoverbg cursor-pointer transition-colors"
                                onClick={() => {
                                    createBlock({ meta: { view: "brain" } }, true);
                                    onClose();
                                }}
                            >
                                <div className="text-purple-400 text-3xl mb-1">
                                    <i className={makeIconClass("brain", true)}></i>
                                </div>
                                <div className="text-xxs text-center text-secondary break-words w-full px-1">Brain</div>
                            </div>
                            {apps.map((app) => {
                                const appMeta = app.manifest?.appmeta;
                                const displayName = app.appid.replace(/^local\//, "");
                                const icon = appMeta?.icon || "cube";
                                const iconColor = appMeta?.iconcolor || "white";

                                return (
                                    <div
                                        key={app.appid}
                                        className="flex flex-col items-center justify-center p-2 rounded hover:bg-hoverbg cursor-pointer transition-colors"
                                        onClick={() => {
                                            const blockDef: BlockDef = {
                                                meta: {
                                                    view: "tsunami",
                                                    controller: "tsunami",
                                                    "tsunami:appid": app.appid,
                                                },
                                            };
                                            createBlock(blockDef, true);
                                            onClose();
                                        }}
                                    >
                                        <div style={{ color: iconColor }} className="text-3xl mb-1">
                                            <i className={makeIconClass(icon, false)}></i>
                                        </div>
                                        <div className="text-xxs text-center text-secondary break-words w-full px-1">
                                            {displayName}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </FloatingPortal>
        );
    }
);

const SettingsFloatingWindow = memo(
    ({
        isOpen,
        onClose,
        referenceElement,
    }: {
        isOpen: boolean;
        onClose: () => void;
        referenceElement: HTMLElement;
    }) => {
        const { refs, floatingStyles, context } = useFloating({
            open: isOpen,
            onOpenChange: onClose,
            placement: "left-start",
            middleware: [offset(-2), shift({ padding: 12 })],
            whileElementsMounted: autoUpdate,
            elements: {
                reference: referenceElement,
            },
        });

        const dismiss = useDismiss(context);
        const { getFloatingProps } = useInteractions([dismiss]);
        const { t } = useTranslation();

        if (!isOpen) return null;

        const menuItems = [
            {
                icon: "gear",
                label: t("settings.menu.settings"),
                onClick: () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "gulinconfig",
                        },
                    };
                    createBlock(blockDef, false, true);
                    onClose();
                },
            },
            {
                icon: "lightbulb",
                label: t("settings.menu.tips"),
                onClick: () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "tips",
                        },
                    };
                    createBlock(blockDef, true, true);
                    onClose();
                },
            },
            {
                icon: "lock",
                label: t("settings.menu.secrets"),
                onClick: () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "gulinconfig",
                            file: "secrets",
                        },
                    };
                    createBlock(blockDef, false, true);
                    onClose();
                },
            },
            {
                icon: "circle-question",
                label: t("settings.menu.help"),
                onClick: () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "help",
                        },
                    };
                    createBlock(blockDef);
                    onClose();
                },
            },
        ];

        return (
            <FloatingPortal>
                <div
                    ref={refs.setFloating}
                    style={floatingStyles}
                    {...getFloatingProps()}
                    className="bg-modalbg border border-border rounded-lg shadow-xl p-2 z-50"
                >
                    {menuItems.map((item, idx) => (
                        <div
                            key={idx}
                            className="flex items-center gap-3 px-3 py-2 rounded hover:bg-hoverbg cursor-pointer transition-colors text-secondary hover:text-white"
                            onClick={item.onClick}
                        >
                            <div className="text-lg w-5 flex justify-center">
                                <i className={makeIconClass(item.icon, false)}></i>
                            </div>
                            <div className="text-sm whitespace-nowrap">{item.label}</div>
                        </div>
                    ))}
                </div>
            </FloatingPortal>
        );
    }
);

SettingsFloatingWindow.displayName = "SettingsFloatingWindow";

const Widgets = memo(() => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const workspace = useAtomValue(atoms.workspace);
    const hasCustomAIPresets = useAtomValue(atoms.hasCustomAIPresetsAtom);
    const containerRef = useRef<HTMLDivElement>(null);
    const measurementRef = useRef<HTMLDivElement>(null);

    const featureGulinAppBuilder = fullConfig?.settings?.["feature:gulinappbuilder"] ?? false;
    const widgetsMap = fullConfig?.widgets ?? {};
    const filteredWidgets = Object.fromEntries(
        Object.entries(widgetsMap).filter(([key, widget]) => {
            if (!hasCustomAIPresets && key === "defwidget@ai") {
                return false;
            }
            return shouldIncludeWidgetForWorkspace(widget, workspace?.oid);
        })
    );
    const widgets = sortByDisplayOrder(filteredWidgets);

    const [isAppsOpen, setIsAppsOpen] = useState(false);
    const appsButtonRef = useRef<HTMLDivElement>(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const settingsButtonRef = useRef<HTMLDivElement>(null);

    const handleWidgetsBarContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        const menu: ContextMenuItem[] = [
            {
                label: "Edit widgets.json",
                click: () => {
                    fireAndForget(async () => {
                        const blockDef: BlockDef = {
                            meta: {
                                view: "gulinconfig",
                                file: "widgets.json",
                            },
                        };
                        await createBlock(blockDef, false, true);
                    });
                },
            },
        ];
        ContextMenuModel.getInstance().showContextMenu(menu, e);
    };

    return (
        <>
            <div
                ref={containerRef}
                className="flex flex-col w-12 overflow-hidden py-1 -ml-1 select-none"
                onContextMenu={handleWidgetsBarContextMenu}
            >
                <div
                    ref={appsButtonRef}
                    className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-lg overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                    onClick={() => setIsAppsOpen(!isAppsOpen)}
                >
                    <Tooltip content="Apps & Widgets" placement="left" disable={isAppsOpen}>
                        <div className="flex flex-col items-center w-full">
                            <div>
                                <i className={makeIconClass("cube", true)}></i>
                            </div>
                            <div className="text-xxs mt-0.5 w-full px-0.5 text-center whitespace-nowrap overflow-hidden text-ellipsis">
                                apps
                            </div>
                        </div>
                    </Tooltip>
                </div>
                <div className="flex-grow" />
                <div
                    ref={settingsButtonRef}
                    className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-lg overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                    onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                >
                    <Tooltip content="Settings & Help" placement="left" disable={isSettingsOpen}>
                        <div className="flex flex-col items-center w-full">
                            <div>
                                <i className={makeIconClass("gear", true)}></i>
                            </div>
                            <div className="text-xxs mt-0.5 w-full px-0.5 text-center whitespace-nowrap overflow-hidden text-ellipsis">
                                settings
                            </div>
                        </div>
                    </Tooltip>
                </div>
                {isDev() ? (
                    <div
                        className="flex justify-center items-center w-full py-1 text-accent text-[30px]"
                        title="Running Gulin Dev Build"
                    >
                        <i className="fa fa-brands fa-dev fa-fw" />
                    </div>
                ) : null}
            </div>
            {appsButtonRef.current && (
                <AppsFloatingWindow
                    isOpen={isAppsOpen}
                    onClose={() => setIsAppsOpen(false)}
                    referenceElement={appsButtonRef.current}
                    widgets={widgets}
                />
            )}
            {settingsButtonRef.current && (
                <SettingsFloatingWindow
                    isOpen={isSettingsOpen}
                    onClose={() => setIsSettingsOpen(false)}
                    referenceElement={settingsButtonRef.current}
                />
            )}

            <div
                ref={measurementRef}
                className="flex flex-col w-12 py-1 -ml-1 select-none absolute -z-10 opacity-0 pointer-events-none"
            >
                <div className="flex-grow" />
                <div className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-lg">
                    <div>
                        <i className={makeIconClass("cube", true)}></i>
                    </div>
                    <div className="text-xxs mt-0.5 w-full px-0.5 text-center">apps</div>
                </div>
                <div className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-lg">
                    <div>
                        <i className={makeIconClass("gear", true)}></i>
                    </div>
                    <div className="text-xxs mt-0.5 w-full px-0.5 text-center">settings</div>
                </div>
                {isDev() ? (
                    <div
                        className="flex justify-center items-center w-full py-1 text-accent text-[30px]"
                        title="Running Gulin Dev Build"
                    >
                        <i className="fa fa-brands fa-dev fa-fw" />
                    </div>
                ) : null}
            </div>
        </>
    );
});

export { Widgets };
