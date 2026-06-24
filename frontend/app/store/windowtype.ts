// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// gulinWindowType is set once at startup and never changes.
let gulinWindowType: "tab" | "builder" | "preview" = "tab";

function getGulinWindowType(): "tab" | "builder" | "preview" {
    return gulinWindowType;
}

function isBuilderWindow(): boolean {
    return gulinWindowType === "builder";
}

function isTabWindow(): boolean {
    return gulinWindowType === "tab";
}

function isPreviewWindow(): boolean {
    return gulinWindowType === "preview";
}

function setGulinWindowType(windowType: "tab" | "builder" | "preview") {
    gulinWindowType = windowType;
}

export { getGulinWindowType, isBuilderWindow, isPreviewWindow, isTabWindow, setGulinWindowType };
