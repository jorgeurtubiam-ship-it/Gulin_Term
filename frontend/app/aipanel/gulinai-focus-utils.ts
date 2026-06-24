// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export function findGulinAIPanel(element: HTMLElement): HTMLElement | null {
    let current: HTMLElement = element;
    while (current) {
        if (current.hasAttribute("data-gulinai-panel")) {
            return current;
        }
        current = current.parentElement;
    }
    return null;
}

export function gulinAIHasFocusWithin(focusTarget?: Element | null): boolean {
    if (focusTarget !== undefined) {
        if (focusTarget instanceof HTMLElement) {
            return findGulinAIPanel(focusTarget) != null;
        }
        return false;
    }

    const focused = document.activeElement;
    if (focused instanceof HTMLElement) {
        const gulinAIPanel = findGulinAIPanel(focused);
        if (gulinAIPanel) return true;
    }

    const sel = document.getSelection();
    if (sel && sel.anchorNode && sel.rangeCount > 0 && !sel.isCollapsed) {
        let anchor = sel.anchorNode;
        if (anchor instanceof Text) {
            anchor = anchor.parentElement;
        }
        if (anchor instanceof HTMLElement) {
            const gulinAIPanel = findGulinAIPanel(anchor);
            if (gulinAIPanel) return true;
        }
    }

    return false;
}

export function gulinAIHasSelection(): boolean {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        return false;
    }

    let anchor = sel.anchorNode;
    if (anchor instanceof Text) {
        anchor = anchor.parentElement;
    }
    if (anchor instanceof HTMLElement) {
        return findGulinAIPanel(anchor) != null;
    }

    return false;
}