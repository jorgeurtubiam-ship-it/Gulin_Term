// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import settingsSchema from "../../../schema/settings.json";
import connectionsSchema from "../../../schema/connections.json";
import aipresetsSchema from "../../../schema/aipresets.json";
import bgpresetsSchema from "../../../schema/bgpresets.json";
import gulinaiSchema from "../../../schema/gulinai.json";
import widgetsSchema from "../../../schema/widgets.json";

type SchemaInfo = {
    uri: string;
    fileMatch: Array<string>;
    schema: object;
};

const MonacoSchemas: SchemaInfo[] = [
    {
        uri: "gulin://schema/settings.json",
        fileMatch: ["*/GULINCONFIGPATH/settings.json"],
        schema: settingsSchema,
    },
    {
        uri: "gulin://schema/connections.json",
        fileMatch: ["*/GULINCONFIGPATH/connections.json"],
        schema: connectionsSchema,
    },
    {
        uri: "gulin://schema/aipresets.json",
        fileMatch: ["*/GULINCONFIGPATH/presets/ai.json"],
        schema: aipresetsSchema,
    },
    {
        uri: "gulin://schema/bgpresets.json",
        fileMatch: ["*/GULINCONFIGPATH/presets/bg.json"],
        schema: bgpresetsSchema,
    },
    {
        uri: "gulin://schema/gulinai.json",
        fileMatch: ["*/GULINCONFIGPATH/gulinai.json"],
        schema: gulinaiSchema,
    },
    {
        uri: "gulin://schema/widgets.json",
        fileMatch: ["*/GULINCONFIGPATH/widgets.json"],
        schema: widgetsSchema,
    },
];

export { MonacoSchemas };
