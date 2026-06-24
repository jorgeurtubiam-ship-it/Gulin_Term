// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { gulinAIHasSelection } from "@/app/aipanel/gulinai-focus-utils";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { isDev } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { GulinAIModel } from "./gulinai-model";

export async function handleGulinAIContextMenu(e: React.MouseEvent, showCopy: boolean): Promise<void> {
    e.preventDefault();
    e.stopPropagation();

    const model = GulinAIModel.getInstance();
    const menu: ContextMenuItem[] = [];

    if (showCopy) {
        const hasSelection = gulinAIHasSelection();
        if (hasSelection) {
            menu.push({
                role: "copy",
            });
            menu.push({ type: "separator" });
        }
    }

    menu.push({
        label: "New Chat",
        click: () => {
            model.clearChat();
        },
    });

    menu.push({ type: "separator" });

    const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, {
        oref: model.orefContext,
    });

    const defaultTokens = model.inBuilder ? 24576 : 4096;
    const currentMaxTokens = rtInfo?.["gulinai:maxoutputtokens"] ?? defaultTokens;

    const maxTokensSubmenu: ContextMenuItem[] = [];

    if (model.inBuilder) {
        maxTokensSubmenu.push(
            {
                label: "24k",
                type: "checkbox",
                checked: currentMaxTokens === 24576,
                click: () => {
                    RpcApi.SetRTInfoCommand(TabRpcClient, {
                        oref: model.orefContext,
                        data: { "gulinai:maxoutputtokens": 24576 },
                    });
                },
            },
            {
                label: "64k (Pro)",
                type: "checkbox",
                checked: currentMaxTokens === 65536,
                click: () => {
                    RpcApi.SetRTInfoCommand(TabRpcClient, {
                        oref: model.orefContext,
                        data: { "gulinai:maxoutputtokens": 65536 },
                    });
                },
            }
        );
    } else {
        if (isDev()) {
            maxTokensSubmenu.push({
                label: "1k (Dev Testing)",
                type: "checkbox",
                checked: currentMaxTokens === 1024,
                click: () => {
                    RpcApi.SetRTInfoCommand(TabRpcClient, {
                        oref: model.orefContext,
                        data: { "gulinai:maxoutputtokens": 1024 },
                    });
                },
            });
        }
        maxTokensSubmenu.push(
            {
                label: "4k",
                type: "checkbox",
                checked: currentMaxTokens === 4096,
                click: () => {
                    RpcApi.SetRTInfoCommand(TabRpcClient, {
                        oref: model.orefContext,
                        data: { "gulinai:maxoutputtokens": 4096 },
                    });
                },
            },
            {
                label: "16k (Pro)",
                type: "checkbox",
                checked: currentMaxTokens === 16384,
                click: () => {
                    RpcApi.SetRTInfoCommand(TabRpcClient, {
                        oref: model.orefContext,
                        data: { "gulinai:maxoutputtokens": 16384 },
                    });
                },
            },
            {
                label: "64k (Pro)",
                type: "checkbox",
                checked: currentMaxTokens === 65536,
                click: () => {
                    RpcApi.SetRTInfoCommand(TabRpcClient, {
                        oref: model.orefContext,
                        data: { "gulinai:maxoutputtokens": 65536 },
                    });
                },
            }
        );
    }

    menu.push({
        label: "Max Output Tokens",
        submenu: maxTokensSubmenu,
    });

    menu.push({ type: "separator" });

    menu.push({
        label: "Configure Modes",
        click: () => {
            RpcApi.RecordTEventCommand(
                TabRpcClient,
                {
                    event: "action:other",
                    props: {
                        "action:type": "gulinai:configuremodes:contextmenu",
                    },
                },
                { noresponse: true }
            );
            model.openGulinAIConfig();
        },
    });

    if (model.canCloseGulinAIPanel()) {
        menu.push({ type: "separator" });

        menu.push({
            label: "Hide Gulin AI",
            click: () => {
                model.closeGulinAIPanel();
            },
        });
    }

    ContextMenuModel.getInstance().showContextMenu(menu, e);
}
