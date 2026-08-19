// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from "@/app/store/i18n";
import { formatFileSizeError, isAcceptableFile, validateFileSize } from "@/app/aipanel/ai-utils";
import { gulinAIHasFocusWithin } from "@/app/aipanel/gulinai-focus-utils";
import { GulinAIModel } from "@/app/aipanel/gulinai-model";
import { Tooltip } from "@/element/tooltip";
import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import * as jotai from "jotai";
import { memo, useCallback, useEffect, useRef, useState, useMemo } from "react";
import { getWebServerEndpoint } from "@/util/endpoints";
import { SkillManager } from "./skillmanager";
import { VoiceRecordButton } from "./voice/voice-record-button";
import { VoiceIndicator } from "./voice/voice-indicator";

interface AIPanelInputProps {
    onSubmit: (e: React.FormEvent) => void;
    status: string;
    model: GulinAIModel;
}

export interface AIPanelInputRef {
    focus: () => void;
    resize: () => void;
    scrollToBottom: () => void;
}

interface QuickSuggestion {
    prefix: "@" | "/";
    key: string;
    label: string;
    description: string;
    icon: string;
    insertText: string;
    action?: () => void;
}

const QUICK_SUGGESTIONS: QuickSuggestion[] = [
    {
        prefix: "@",
        key: "@terminal",
        label: "@terminal",
        description: "Adjuntar contexto de la terminal activa",
        icon: "fa-solid fa-terminal text-teal-400",
        insertText: "@terminal ",
    },
    {
        prefix: "@",
        key: "@file",
        label: "@file",
        description: "Adjuntar o referenciar un archivo",
        icon: "fa-solid fa-file-code text-blue-400",
        insertText: "@file ",
    },
    {
        prefix: "@",
        key: "@db",
        label: "@db",
        description: "Consultar base de datos conectada",
        icon: "fa-solid fa-database text-emerald-400",
        insertText: "@db ",
    },
    {
        prefix: "@",
        key: "@plan",
        label: "@plan",
        description: "Activar modo Planificación",
        icon: "fa-solid fa-clipboard-list text-teal-300",
        insertText: "@plan ",
    },
    {
        prefix: "@",
        key: "@act",
        label: "@act",
        description: "Activar modo Ejecución Directa",
        icon: "fa-solid fa-rocket text-red-400",
        insertText: "@act ",
    },
    {
        prefix: "/",
        key: "/audit",
        label: "/audit",
        description: "Auditar rendimiento y seguridad del sistema",
        icon: "fa-solid fa-shield-halved text-amber-400",
        insertText: "Audita la seguridad, recursos y servicios activos del servidor.",
    },
    {
        prefix: "/",
        key: "/explain",
        label: "/explain",
        description: "Explicar el último error o salida de la terminal",
        icon: "fa-solid fa-circle-question text-cyan-400",
        insertText: "Explica detalladamente qué causó el último error en la terminal y cómo resolverlo.",
    },
    {
        prefix: "/",
        key: "/fix",
        label: "/fix",
        description: "Proponer comando correctivo inmediato",
        icon: "fa-solid fa-wrench text-orange-400",
        insertText: "Dame el comando exacto para corregir el último fallo de la terminal.",
    },
    {
        prefix: "/",
        key: "/clear",
        label: "/clear",
        description: "Iniciar un nuevo chat limpio",
        icon: "fa-solid fa-trash-can text-red-400",
        insertText: "",
        action: () => GulinAIModel.getInstance().newChat(),
    },
];

export const AIPanelInput = memo(({ onSubmit, status, model }: AIPanelInputProps) => {
    const [input, setInput] = useAtom(model.inputAtom);
    const isFocused = useAtomValue(model.isGulinAIFocusedAtom);
    const isChatEmpty = useAtomValue(model.isChatEmptyAtom);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const hiddenDivRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isPanelOpen = useAtomValue(model.getPanelVisibleAtom());
    const [isManagerOpen, setIsManagerOpen] = useState(false);
    const [suggestionIndex, setSuggestionIndex] = useState(0);

    // Compute active suggestions based on @ or / typing
    const activeSuggestions = useMemo(() => {
        if (!input) return [];
        const lastWord = input.split(/\s+/).pop() || "";
        if (lastWord.startsWith("@")) {
            const query = lastWord.toLowerCase();
            return QUICK_SUGGESTIONS.filter((s) => s.prefix === "@" && s.key.toLowerCase().startsWith(query));
        }
        if (lastWord.startsWith("/")) {
            const query = lastWord.toLowerCase();
            return QUICK_SUGGESTIONS.filter((s) => s.prefix === "/" && s.key.toLowerCase().startsWith(query));
        }
        return [];
    }, [input]);

    const applySuggestion = useCallback(
        (s: QuickSuggestion) => {
            if (s.action) {
                s.action();
                setInput("");
                return;
            }
            const words = input.split(/\s+/);
            words.pop(); // remove incomplete prefix
            const newText = (words.length > 0 ? words.join(" ") + " " : "") + s.insertText;
            setInput(newText);
            setTimeout(() => textareaRef.current?.focus(), 10);
        },
        [input, setInput]
    );

    useEffect(() => {
        const handler = () => setIsManagerOpen(true);
        window.addEventListener("gulin:open-skill-manager", handler);
        return () => window.removeEventListener("gulin:open-skill-manager", handler);
    }, []);

    const { t } = useTranslation();

    let placeholder: string;
    if (!isChatEmpty) {
        placeholder = t("gulin.ai.input.placeholder.continue");
    } else if (model.inBuilder) {
        placeholder = t("gulin.ai.input.placeholder.build");
    } else {
        placeholder = t("gulin.ai.input.placeholder.ask");
    }

    const resizeTextarea = useCallback(() => {
        const textarea = textareaRef.current;
        const hiddenDiv = hiddenDivRef.current;
        if (!textarea || !hiddenDiv) return;

        hiddenDiv.style.width = `${textarea.clientWidth}px`;
        hiddenDiv.textContent = (textarea.value || "") + " ";
        
        const scrollHeight = hiddenDiv.scrollHeight;
        const minHeight = 2 * 20; // approx 2 lines minimum
        const maxHeight = 12 * 20; // approx 12 lines maximum
        const newHeight = `${Math.min(Math.max(scrollHeight, minHeight), maxHeight)}px`;
        
        if (textarea.style.height !== newHeight) {
            textarea.style.height = newHeight;
        }
    }, []);

    useEffect(() => {
        const inputRefObject: React.RefObject<AIPanelInputRef> = {
            current: {
                focus: () => {
                    textareaRef.current?.focus();
                },
                resize: resizeTextarea,
                scrollToBottom: () => {
                    const textarea = textareaRef.current;
                    if (textarea) {
                        textarea.scrollTop = textarea.scrollHeight;
                    }
                },
            },
        };
        model.registerInputRef(inputRefObject);
    }, [model, resizeTextarea]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const isComposing = e.nativeEvent?.isComposing || e.keyCode == 229;

        if (activeSuggestions.length > 0) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setSuggestionIndex((prev) => (prev + 1) % activeSuggestions.length);
                return;
            }
            if (e.key === "ArrowUp") {
                e.preventDefault();
                setSuggestionIndex((prev) => (prev - 1 + activeSuggestions.length) % activeSuggestions.length);
                return;
            }
            if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                e.preventDefault();
                const selected = activeSuggestions[suggestionIndex] || activeSuggestions[0];
                if (selected) {
                    applySuggestion(selected);
                }
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                return;
            }
        }

        if (e.key === "Enter" && !e.shiftKey && !isComposing) {
            e.preventDefault();
            onSubmit(e as any);
        }
    };

    const handleFocus = useCallback(() => {
        model.requestGulinAIFocus();
    }, [model]);

    const handleBlur = useCallback(
        (e: React.FocusEvent) => {
            if (e.relatedTarget === null) {
                return;
            }

            if (gulinAIHasFocusWithin(e.relatedTarget)) {
                return;
            }

            model.requestNodeFocus();
        },
        [model]
    );

    useEffect(() => {
        resizeTextarea();
    }, [input, resizeTextarea]);

    useEffect(() => {
        if (isPanelOpen) {
            resizeTextarea();
        }
    }, [isPanelOpen, resizeTextarea]);

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        const acceptableFiles = files.filter(isAcceptableFile);

        for (const file of acceptableFiles) {
            const sizeError = validateFileSize(file);
            if (sizeError) {
                model.setError(formatFileSizeError(sizeError));
                if (e.target) {
                    e.target.value = "";
                }
                return;
            }
            await model.addFile(file);
        }

        if (acceptableFiles.length < files.length) {
            console.warn(`${files.length - acceptableFiles.length} files were rejected due to unsupported file types`);
        }

        if (e.target) {
            e.target.value = "";
        }
    };

    const handlePaste = useCallback(
        async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
            // Only intercept if the clipboard actually contains image files (screenshots, copied images, etc.)
            const items = e.clipboardData?.items;
            if (!items || items.length === 0) return;

            const imageFiles: File[] = [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.kind === "file" && item.type && item.type.startsWith("image/")) {
                    const file = item.getAsFile();
                    if (file) imageFiles.push(file);
                }
            }

            if (imageFiles.length === 0) return;

            // Prevent the default text-paste behavior so the data URL string is not injected into the textarea
            e.preventDefault();

            for (const file of imageFiles) {
                // Normalize the file name (clipboard files often come as "image.png" with no path)
                const normalizedName =
                    file.name && file.name !== "image.png" ? file.name : `pasted-image-${Date.now()}.${(file.type.split("/")[1] || "png").split(";")[0]}`;
                const namedFile = new File([file], normalizedName, { type: file.type });

                if (!isAcceptableFile(namedFile)) {
                    model.setError(`Pasted image type not supported: ${file.type}`);
                    continue;
                }
                const sizeError = validateFileSize(namedFile);
                if (sizeError) {
                    model.setError(formatFileSizeError(sizeError));
                    continue;
                }
                try {
                    await model.addFile(namedFile);
                } catch (err) {
                    console.error("Error adding pasted image:", err);
                    model.setError("Failed to attach pasted image.");
                }
            }
        },
        [model]
    );

    const [currentMode, setCurrentMode] = useAtom(model.currentAIMode);

    const toggleMode = useCallback(
        (suffix: string) => {
            let baseMode = currentMode;
            if (currentMode.endsWith("@plan")) {
                baseMode = currentMode.substring(0, currentMode.length - 5);
            } else if (currentMode.endsWith("@act")) {
                baseMode = currentMode.substring(0, currentMode.length - 4);
            }

            if (currentMode.endsWith(suffix)) {
                model.setAIMode(baseMode);
            } else {
                model.setAIMode(baseMode + suffix);
            }
        },
        [currentMode, model]
    );

    const [visualBI, setVisualBI] = useAtom(model.docGenVisualBI);
    const [scope, setScope] = useAtom(model.docGenScope);
    const [docMode, setDocMode] = useAtom(model.docGenMode);
    const [format, setFormat] = useAtom(model.docGenFormat);

    const chipBase = "flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer select-none border";

    const formatChips: { key: "ppt" | "word" | "excel"; label: string; icon: string; activeClass: string }[] = [
        { key: "ppt", label: "PPT", icon: "fa-solid fa-chart-pie", activeClass: "bg-orange-500/20 text-orange-300 border-orange-500/50" },
        { key: "word", label: "Word", icon: "fa-solid fa-file-word", activeClass: "bg-blue-500/20 text-blue-300 border-blue-500/50" },
        { key: "excel", label: "Excel", icon: "fa-solid fa-file-excel", activeClass: "bg-green-500/20 text-green-300 border-green-500/50" },
    ];

    const handleVoiceSubmit = useCallback(
        (transcript: string) => {
            if (transcript.trim()) {
                model.submitVoiceMessage(transcript);
            }
        },
        [model]
    );

    return (
        <div className={cn("border-t flex flex-col relative z-20", isFocused ? "border-accent/50" : "border-gray-600")}>
            {/* Toolbar: PLAN / ACT / SKILLS / separador / Visual BI / Sample / Mode / PPT / Word / Excel */}
            <div className="flex items-center gap-1.5 px-3 py-1 border-b border-gray-600/30 flex-wrap relative z-30">
                <button
                    type="button"
                    onClick={() => toggleMode("@plan")}
                    className={cn(
                        "flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer border shrink-0",
                        currentMode.endsWith("@plan")
                            ? "bg-teal-500/20 text-teal-300 border-teal-500/50 shadow-[0_0_8px_rgba(20,184,166,0.2)]"
                            : "bg-zinc-800/80 text-zinc-400 border-zinc-700/50 hover:bg-zinc-700 hover:text-zinc-200"
                    )}
                    title={t("gulin.ai.input.plan_title")}
                >
                    <i className="fa-solid fa-clipboard-list text-[9px]"></i>
                    PLAN
                </button>
                <button
                    type="button"
                    onClick={() => toggleMode("@act")}
                    className={cn(
                        "flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer border shrink-0",
                        currentMode.endsWith("@act")
                            ? "bg-red-500/20 text-red-300 border-red-500/50 shadow-[0_0_8px_rgba(239,68,68,0.2)]"
                            : "bg-zinc-800/50 text-zinc-500 border-transparent hover:text-zinc-400"
                    )}
                    title={t("gulin.ai.input.act_title")}
                >
                    <i className="fa-solid fa-rocket text-[9px]"></i>
                    ACT
                </button>

                <div className="h-3.5 w-[1px] bg-gray-600/40 mx-0.5 shrink-0"></div>
                <SkillSelector model={model} />

                <div className="h-3.5 w-[1px] bg-gray-600/40 mx-0.5 shrink-0"></div>

                {/* DocGen inline */}
                <button
                    type="button"
                    onClick={() => setVisualBI(!visualBI)}
                    title="Visual BI (gráficos inline)"
                    className={cn(chipBase, "shrink-0",
                        visualBI ? "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/50" : "bg-zinc-800/50 text-zinc-500 border-transparent hover:text-zinc-400"
                    )}
                >
                    <i className="fa-solid fa-chart-column text-[9px]" />
                    BI
                </button>
                <button
                    type="button"
                    onClick={() => setScope(scope === "sample" ? "full" : "sample")}
                    title="Sample (~100 filas) / Full (hasta 50k)"
                    className={cn(chipBase, "shrink-0",
                        scope === "full" ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/50" : "bg-zinc-800/50 text-zinc-500 border-transparent hover:text-zinc-400"
                    )}
                >
                    <i className="fa-solid fa-filter text-[9px]" />
                    {scope === "sample" ? "Smp" : "Full"}
                </button>
                <button
                    type="button"
                    onClick={() => setDocMode(docMode === "browser" ? "deep" : "browser")}
                    title="Browser·fast / Deep·slow"
                    className={cn(chipBase, "shrink-0",
                        docMode === "deep" ? "bg-violet-500/20 text-violet-300 border-violet-500/50" : "bg-zinc-800/50 text-zinc-500 border-transparent hover:text-zinc-400"
                    )}
                >
                    <i className="fa-solid fa-magnifying-glass text-[9px]" />
                    {docMode === "browser" ? "Fast" : "Deep"}
                </button>

                <div className="h-3.5 w-[1px] bg-gray-600/40 mx-0.5 shrink-0"></div>

                {formatChips.map((chip) => (
                    <button
                        key={chip.key}
                        type="button"
                        onClick={() => setFormat(format === chip.key ? "none" : chip.key)}
                        title={`Generar ${chip.label}`}
                        className={cn(chipBase, "shrink-0",
                            format === chip.key ? chip.activeClass : "bg-zinc-800/50 text-zinc-500 border-transparent hover:text-zinc-400"
                        )}
                    >
                        <i className={chip.icon + " text-[9px]"} />
                        {chip.label}
                    </button>
                ))}
            </div>
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.txt,.md,.js,.jsx,.ts,.tsx,.go,.py,.java,.c,.cpp,.h,.hpp,.html,.css,.scss,.sass,.json,.xml,.yaml,.yml,.sh,.bat,.sql"
                onChange={handleFileChange}
                className="hidden"
            />
            <VoiceIndicator />
            {/* Popover de Sugerencias Rápidas @ y / */}
            {activeSuggestions.length > 0 && (
                <div className="mx-2 mb-1 z-50 bg-zinc-900/95 backdrop-blur-xl border border-teal-500/30 rounded-xl shadow-2xl overflow-hidden py-1 divide-y divide-white/5 animate-in fade-in slide-in-from-bottom-2 duration-150 select-none">
                    <div className="px-3 py-1 text-[10px] font-mono font-bold tracking-wider text-teal-400 uppercase flex items-center justify-between bg-teal-950/30">
                        <span>Comandos y Contexto</span>
                        <span className="text-[9px] text-zinc-400 font-sans">↑ ↓ para navegar • Tab para elegir</span>
                    </div>
                    <div className="max-h-48 overflow-y-auto custom-scrollbar">
                        {activeSuggestions.map((item, idx) => {
                            const isSelected = idx === suggestionIndex;
                            return (
                                <button
                                    key={item.key}
                                    type="button"
                                    onClick={() => applySuggestion(item)}
                                    className={cn(
                                        "w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors cursor-pointer",
                                        isSelected
                                            ? "bg-teal-500/20 text-teal-200 border-l-2 border-teal-400"
                                            : "text-zinc-300 hover:bg-zinc-800/60"
                                    )}
                                >
                                    <i className={cn(item.icon, "text-xs w-4 text-center shrink-0")} />
                                    <div className="flex-1 min-w-0">
                                        <div className="font-semibold text-xs font-mono">{item.label}</div>
                                        <div className="text-[11px] text-zinc-400 truncate">{item.description}</div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
            <form onSubmit={onSubmit} className="px-2 py-1">
                <div className="flex items-end gap-2 bg-zinc-800/80 border border-zinc-700/60 rounded-xl p-2 focus-within:border-teal-500/60 transition-colors">
                    <button
                        type="button"
                        onClick={handleUploadClick}
                        className="w-7 h-7 shrink-0 transition-colors flex items-center justify-center text-zinc-400 hover:text-teal-400 cursor-pointer mb-0.5"
                        title={t("gulin.ai.input.attach_tooltip")}
                    >
                        <i className="fa-solid fa-paperclip text-sm"></i>
                    </button>
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        onFocus={handleFocus}
                        onBlur={handleBlur}
                        placeholder={placeholder}
                        className="flex-1 text-white text-sm focus:outline-none resize-none overflow-auto bg-transparent min-h-[32px] py-1"
                        rows={1}
                    />
                    <div
                        ref={hiddenDivRef}
                        className="w-full px-3 py-2 whitespace-pre-wrap break-words absolute opacity-0 pointer-events-none"
                        style={{ fontSize: "14px", top: -9999, left: -9999, zIndex: -100 }}
                    />
                    <VoiceRecordButton
                        onSpeechSubmit={handleVoiceSubmit}
                        disabled={status === "streaming"}
                    />
                    {status === "streaming" ? (
                        <button
                            type="button"
                            onClick={() => model.stopResponse()}
                            className="w-8 h-8 shrink-0 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 flex items-center justify-center transition-all cursor-pointer shadow-sm mb-0.5"
                            title={t("gulin.ai.input.stop_tooltip")}
                        >
                            <i className="fa-solid fa-square text-xs"></i>
                        </button>
                    ) : (
                        <button
                            type="submit"
                            disabled={status === "streaming"}
                            className={cn(
                                "w-8 h-8 shrink-0 rounded-lg flex items-center justify-center transition-all cursor-pointer shadow-sm mb-0.5",
                                input.trim()
                                    ? "bg-teal-500 hover:bg-teal-400 text-black border border-teal-400 shadow-teal-500/30 font-bold"
                                    : "bg-teal-500/40 text-teal-100 border border-teal-400/60 hover:bg-teal-500/60"
                            )}
                            title={t("gulin.ai.input.send_tooltip")}
                        >
                            <i className="fa-solid fa-paper-plane text-xs"></i>
                        </button>
                    )}
                </div>
            </form>
            {isManagerOpen && <SkillManager model={model} onClose={() => setIsManagerOpen(false)} />}
        </div>
    );
});

const SkillTreeNode = ({ node, level, onSelect, selectedFilename }: any) => {
    const [isOpen, setIsOpen] = useState(false);
    
    if (node.isSkill) {
        let name = node.name.replace(/[-_]/g, " ");
        name = name.replace(/\b\w/g, (c: string) => c.toUpperCase());
        const isSelected = selectedFilename === node.skill.filename;
        return (
            <button
                type="button"
                onClick={() => onSelect(node.skill)}
                className={cn(
                    "flex items-center gap-2 py-1.5 text-xs transition-colors hover:text-accent hover:bg-zinc-800/60 text-left w-full pr-3 rounded",
                    isSelected ? "text-accent font-bold bg-accent/10" : "text-gray-300"
                )}
                style={{ paddingLeft: `${(level + 1) * 12}px` }}
            >
                <i className={cn("fa-solid text-[10px]", isSelected ? "fa-circle-check text-accent" : "fa-star text-accent/70")}></i>
                <span className="truncate">{name}</span>
            </button>
        );
    }

    return (
        <div className="flex flex-col">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 py-1.5 text-xs transition-colors hover:text-white hover:bg-zinc-800/40 text-left w-full text-gray-400 font-medium pr-3 rounded cursor-pointer"
                style={{ paddingLeft: `${(level + 1) * 12}px` }}
            >
                <i className={cn("fa-solid text-[8px] w-2 transition-transform", isOpen ? "fa-chevron-down" : "fa-chevron-right")}></i>
                <i className={cn("fa-regular text-[10px]", isOpen ? "fa-folder-open text-accent/80" : "fa-folder")}></i>
                <span className="truncate capitalize">{node.name.replace(/[-_]/g, " ")}</span>
            </button>
            {isOpen && node.children.map((child: any, i: number) => (
                <SkillTreeNode key={i} node={child} level={level + 1} onSelect={onSelect} selectedFilename={selectedFilename} />
            ))}
        </div>
    );
};

const SkillSelector = memo(({ model }: { model: GulinAIModel }) => {
    const [selectedSkill, setSelectedSkill] = useAtom(model.selectedSkill);
    const [availableSkills, setAvailableSkills] = useAtom(model.availableSkills);
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const fetchSkills = async () => {
            try {
                const response = await fetch(`${getWebServerEndpoint()}/gulin/brain-list`);
                if (response.ok) {
                    const data = await response.json();
                    if (Array.isArray(data)) {
                        const backendSkills = data
                            .filter((item: any) => item.filename.startsWith("skills/"))
                            .map((item: any) => ({ title: "✨ " + item.title, filename: item.filename }));
                        
                        setAvailableSkills(backendSkills);
                    }
                }
            } catch (e) {
                console.error("Error fetching skills", e);
            }
        };
        fetchSkills();
    }, [setAvailableSkills]);

    // Close on click outside
    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isOpen]);

    const skillTree = useMemo(() => {
        const root: any = { name: "root", children: [], isSkill: false };
        availableSkills.forEach(skill => {
            const cleanTitle = skill.title.replace("✨ ", "");
            const parts = cleanTitle.split("/"); 
            
            let folderParts: string[] = [];
            let skillName: string = "";

            if (parts[parts.length - 1].toLowerCase() === "skill" && parts.length > 1) {
                folderParts = parts.slice(0, parts.length - 2);
                skillName = parts[parts.length - 2];
            } else if (parts.length > 1) {
                folderParts = parts.slice(0, parts.length - 1);
                skillName = parts[parts.length - 1];
            } else {
                folderParts = [];
                skillName = parts[0];
            }

            let current = root;
            for (const folder of folderParts) {
                let child = current.children.find((c: any) => c.name === folder && !c.isSkill);
                if (!child) {
                    child = { name: folder, children: [], isSkill: false };
                    current.children.push(child);
                }
                current = child;
            }

            current.children.push({
                name: skillName,
                isSkill: true,
                skill: skill
            });
        });
        return root.children;
    }, [availableSkills]);

    // Compute display name for selected skill
    let selectedDisplayName = "SKILLS";
    if (selectedSkill) {
        const parts = selectedSkill.title.replace("✨ ", "").split("/");
        selectedDisplayName = parts[parts.length - 1];
        if (selectedDisplayName.toLowerCase() === "skill" && parts.length > 1) {
            selectedDisplayName = parts[parts.length - 2];
        }
        selectedDisplayName = selectedDisplayName.replace(/[-_]/g, " ");
    }

    return (
        <div className="relative" ref={containerRef}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                title={selectedSkill ? `Skill activa: ${selectedDisplayName} (clic para cambiar)` : "Seleccionar Protocolo / Skill de Experto"}
                className={cn(
                    "flex items-center gap-1.5 px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer border max-w-[160px]",
                    selectedSkill 
                        ? "bg-accent/20 text-accent border-accent/50 shadow-[0_0_8px_rgba(var(--accent-rgb),0.2)]"
                        : "bg-zinc-800/80 text-zinc-400 border-zinc-700/50 hover:bg-zinc-700 hover:text-zinc-200"
                )}
            >
                <i className="fa-solid fa-graduation-cap text-[10px]"></i>
                <span className="truncate">{selectedDisplayName}</span>
                <i className={cn("fa-solid text-[7px] ml-0.5 opacity-60 transition-transform", isOpen ? "fa-chevron-up" : "fa-chevron-down")}></i>
            </button>

            {isOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-80 max-w-[calc(100vw-32px)] bg-zinc-900 border border-gray-700 rounded-lg shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-2">
                    <div className="bg-zinc-800/80 px-3 py-2 border-b border-gray-700 flex justify-between items-center">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">PROTOCOLOS EXPERTOS</span>
                        {selectedSkill && (
                            <span className="text-[9px] text-accent font-semibold px-1.5 py-0.5 bg-accent/10 rounded">Activo</span>
                        )}
                    </div>
                    <div className="flex flex-col py-2 max-h-64 overflow-y-auto">
                        <button
                            type="button"
                            onClick={() => { setSelectedSkill(null); setIsOpen(false); }}
                            className={cn(
                                "flex items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-zinc-800 text-left mb-1 cursor-pointer",
                                !selectedSkill ? "text-accent font-bold bg-accent/10" : "text-gray-300"
                            )}
                        >
                            <i className="fa-solid fa-ghost w-4"></i> Sin Skill (Modo Base)
                        </button>
                        
                        {skillTree.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-gray-500 italic">No hay skills instaladas</div>
                        ) : (
                            <div className="flex flex-col">
                                {skillTree.map((node: any, i: number) => (
                                    <SkillTreeNode 
                                        key={i} 
                                        node={node} 
                                        level={0} 
                                        onSelect={(s: any) => { setSelectedSkill(s); setIsOpen(false); }} 
                                        selectedFilename={selectedSkill?.filename} 
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="border-t border-gray-700 bg-zinc-800/30 p-1">
                        <button 
                            type="button"
                            onClick={() => { 
                                setIsOpen(false); 
                                window.dispatchEvent(new CustomEvent("gulin:open-skill-manager"));
                            }}
                            className="w-full text-center py-1.5 text-[9px] font-bold text-gray-400 hover:text-accent transition-colors cursor-pointer"
                        >
                            <i className="fa-solid fa-sliders mr-1"></i> GESTIONAR SKILLS
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
});

SkillSelector.displayName = "SkillSelector";

// Barra DocGen (B2): controles para generar documentos / visual BI desde el chat.
const DocGenBar = memo(({ model }: { model: GulinAIModel }) => {
    const [visualBI, setVisualBI] = useAtom(model.docGenVisualBI);
    const [scope, setScope] = useAtom(model.docGenScope);
    const [mode, setMode] = useAtom(model.docGenMode);
    const [format, setFormat] = useAtom(model.docGenFormat);

    const chipBase =
        "flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer select-none border";

    const formatChips: { key: "ppt" | "word" | "excel"; label: string; icon: string; activeClass: string }[] = [
        { key: "ppt", label: "PPT", icon: "fa-solid fa-chart-pie", activeClass: "bg-orange-500/20 text-orange-300 border-orange-500/50" },
        { key: "word", label: "Word", icon: "fa-solid fa-file-word", activeClass: "bg-blue-500/20 text-blue-300 border-blue-500/50" },
        { key: "excel", label: "Excel", icon: "fa-solid fa-file-excel", activeClass: "bg-green-500/20 text-green-300 border-green-500/50" },
    ];

    const onFormatClick = (key: "ppt" | "word" | "excel") => {
        // Si ya está seleccionado, se deselecciona; si no, se activa ese formato.
        setFormat(format === key ? "none" : key);
    };

    return (
        <div className="flex items-center gap-1.5 pl-2 pr-6 py-1 border-t border-gray-600/20 bg-zinc-800/20 overflow-x-auto">
            {/* Toggle Visual BI */}
            <button
                type="button"
                onClick={() => setVisualBI(!visualBI)}
                title="Visual BI (gráficos inline)"
                className={cn(
                    chipBase,
                    visualBI
                        ? "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/50"
                        : "bg-zinc-800/50 text-zinc-500 border-transparent hover:text-zinc-400"
                )}
            >
                <i className="fa-solid fa-chart-column text-[10px]" />
                Visual BI
            </button>

            <div className="h-3.5 w-[1px] bg-gray-600/30 mx-0.5" />

            {/* DocScope: Sample / Full */}
            <button
                type="button"
                onClick={() => setScope(scope === "sample" ? "full" : "sample")}
                title="Alcance de datos: Sample (preview ~100 filas) / Full (hasta 50k)"
                className={cn(
                    chipBase,
                    scope === "full"
                        ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/50"
                        : "bg-zinc-800/50 text-zinc-500 border-transparent hover:text-zinc-400"
                )}
            >
                <i className="fa-solid fa-filter text-[10px]" />
                {scope === "sample" ? "Sample" : "Full"}
            </button>

            {/* DocGenMode: Browser / Deep */}
            <button
                type="button"
                onClick={() => setMode(mode === "browser" ? "deep" : "browser")}
                title="Modo de generación: Browser·fast / Deep·slow"
                className={cn(
                    chipBase,
                    mode === "deep"
                        ? "bg-violet-500/20 text-violet-300 border-violet-500/50"
                        : "bg-zinc-800/50 text-zinc-500 border-transparent hover:text-zinc-400"
                )}
            >
                <i className="fa-solid fa-magnifying-glass text-[10px]" />
                {mode === "browser" ? "Browser·fast" : "Deep·slow"}
            </button>

            <div className="h-3.5 w-[1px] bg-gray-600/30 mx-0.5" />

            {/* Formatos PPT / Word / Excel */}
            {formatChips.map((chip) => (
                <button
                    key={chip.key}
                    type="button"
                    onClick={() => onFormatClick(chip.key)}
                    title={`Generar ${chip.label}`}
                    className={cn(
                        chipBase,
                        format === chip.key ? chip.activeClass : "bg-zinc-800/50 text-zinc-500 border-transparent hover:text-zinc-400"
                    )}
                >
                    <i className={chip.icon + " text-[10px]"} />
                    {chip.label}
                </button>
            ))}
        </div>
    );
});

DocGenBar.displayName = "DocGenBar";

AIPanelInput.displayName = "AIPanelInput";
