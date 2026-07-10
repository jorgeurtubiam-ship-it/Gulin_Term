// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from "@/app/store/i18n";
import { formatFileSizeError, isAcceptableFile, validateFileSize } from "@/app/aipanel/ai-utils";
import { gulinAIHasFocusWithin } from "@/app/aipanel/gulinai-focus-utils";
import { type GulinAIModel } from "@/app/aipanel/gulinai-model";
import { Tooltip } from "@/element/tooltip";
import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import * as jotai from "jotai";
import { memo, useCallback, useEffect, useRef, useState, useMemo } from "react";
import { getWebServerEndpoint } from "@/util/endpoints";
import { SkillManager } from "./skillmanager";

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

export const AIPanelInput = memo(({ onSubmit, status, model }: AIPanelInputProps) => {
    const [input, setInput] = useAtom(model.inputAtom);
    const isFocused = useAtomValue(model.isGulinAIFocusedAtom);
    const isChatEmpty = useAtomValue(model.isChatEmptyAtom);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const hiddenDivRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isPanelOpen = useAtomValue(model.getPanelVisibleAtom());
    const [isManagerOpen, setIsManagerOpen] = useState(false);

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
        const minHeight = 4 * 20; // approx 4 lines minimum
        const maxHeight = 15 * 20; // approx 15 lines maximum
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

    return (
        <div className={cn("border-t flex flex-col", isFocused ? "border-accent/50" : "border-gray-600")}>
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-600/30">
                <button
                    type="button"
                    onClick={() => toggleMode("@plan")}
                    className={cn(
                        "flex items-center gap-1.5 px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer border",
                        currentMode.endsWith("@plan")
                            ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/50 shadow-[0_0_8px_rgba(99,102,241,0.2)]"
                            : "bg-zinc-800/50 text-zinc-500 border-transparent hover:text-zinc-400"
                    )}
                    title={t("gulin.ai.input.plan_title")}
                >
                    <i className="fa-solid fa-clipboard-list text-[10px]"></i>
                    PLAN
                </button>
                <button
                    type="button"
                    onClick={() => toggleMode("@act")}
                    className={cn(
                        "flex items-center gap-1.5 px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer border",
                        currentMode.endsWith("@act")
                            ? "bg-red-500/20 text-red-300 border-red-500/50 shadow-[0_0_8px_rgba(239,68,68,0.2)]"
                            : "bg-zinc-800/50 text-zinc-500 border-transparent hover:text-zinc-400"
                    )}
                    title={t("gulin.ai.input.act_title")}
                >
                    <i className="fa-solid fa-rocket text-[10px]"></i>
                    ACT
                </button>

                <div className="h-4 w-[1px] bg-gray-600/30 mx-1"></div>

                <SkillSelector model={model} />
            </div>
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.txt,.md,.js,.jsx,.ts,.tsx,.go,.py,.java,.c,.cpp,.h,.hpp,.html,.css,.scss,.sass,.json,.xml,.yaml,.yml,.sh,.bat,.sql"
                onChange={handleFileChange}
                className="hidden"
            />
            <form onSubmit={onSubmit}>
                <div className="relative">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onFocus={handleFocus}
                        onBlur={handleBlur}
                        placeholder={placeholder}
                        className={cn(
                            "w-full text-white px-2 py-2 pr-5 focus:outline-none resize-none overflow-auto bg-zinc-800/50"
                        )}
                        style={{ fontSize: "13px" }}
                        rows={1}
                    />
                    <div
                        ref={hiddenDivRef}
                        className="w-full px-2 py-2 pr-5 whitespace-pre-wrap break-words absolute opacity-0 pointer-events-none"
                        style={{ fontSize: "13px", top: -9999, left: -9999, zIndex: -100 }}
                    />
                    <Tooltip content={t("gulin.ai.input.attach_tooltip")} placement="top" divClassName="absolute bottom-6.5 right-1">
                        <button
                            type="button"
                            onClick={handleUploadClick}
                            className={cn(
                                "w-5 h-5 transition-colors flex items-center justify-center text-gray-400 hover:text-accent cursor-pointer"
                            )}
                        >
                            <i className="fa fa-paperclip text-sm"></i>
                        </button>
                    </Tooltip>
                    {status === "streaming" ? (
                        <Tooltip content={t("gulin.ai.input.stop_tooltip")} placement="top" divClassName="absolute bottom-1.5 right-1">
                            <button
                                type="button"
                                onClick={() => model.stopResponse()}
                                className={cn(
                                    "w-5 h-5 transition-colors flex items-center justify-center",
                                    "text-green-500 hover:text-green-400 cursor-pointer"
                                )}
                            >
                                <i className="fa fa-square text-sm"></i>
                            </button>
                        </Tooltip>
                    ) : (
                        <Tooltip content={t("gulin.ai.input.send_tooltip")} placement="top" divClassName="absolute bottom-1.5 right-1">
                            <button
                                type="submit"
                                disabled={status !== "ready" || !input.trim()}
                                className={cn(
                                    "w-5 h-5 transition-colors flex items-center justify-center",
                                    status !== "ready" || !input.trim()
                                        ? "text-gray-400"
                                        : "text-accent/80 hover:text-accent cursor-pointer"
                                )}
                            >
                                <i className="fa fa-paper-plane text-sm"></i>
                            </button>
                        </Tooltip>
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
        // Capitalize words
        name = name.replace(/\b\w/g, (c: string) => c.toUpperCase());
        return (
            <button
                onClick={() => onSelect(node.skill)}
                className={cn(
                    "flex items-center gap-2 py-1.5 text-xs transition-colors hover:text-accent text-left w-full pr-3",
                    selectedFilename === node.skill.filename ? "text-accent font-bold" : "text-gray-300"
                )}
                style={{ paddingLeft: `${(level + 1) * 12}px` }}
            >
                <i className="fa-solid fa-star text-[10px] text-accent"></i>
                <span className="truncate">{name}</span>
            </button>
        );
    }

    return (
        <div className="flex flex-col">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 py-1.5 text-xs transition-colors hover:text-white text-left w-full text-gray-400 font-medium pr-3"
                style={{ paddingLeft: `${(level + 1) * 12}px` }}
            >
                <i className={cn("fa-solid text-[8px] w-2 transition-transform", isOpen ? "fa-chevron-down" : "fa-chevron-right")}></i>
                <i className="fa-regular fa-folder text-[10px]"></i>
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

    const skillTree = useMemo(() => {
        const root: any = { name: "root", children: [], isSkill: false };
        availableSkills.forEach(skill => {
            const cleanTitle = skill.title.replace("✨ ", "");
            const parts = cleanTitle.split("/"); 
            let current = root;
            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                let child = current.children.find((c: any) => c.name === part && !c.isSkill);
                if (!child) {
                    child = { name: part, children: [], isSkill: false };
                    current.children.push(child);
                }
                current = child;
            }
            let finalName = parts[parts.length - 1];
            if (finalName.toLowerCase() === "skill" && parts.length > 1) {
                finalName = parts[parts.length - 2];
            }
            current.children.push({
                name: finalName,
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
        <div className="relative">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "flex items-center gap-1.5 px-3 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer border max-w-[150px]",
                    selectedSkill 
                        ? "bg-accent/20 text-accent border-accent/50 shadow-[0_0_8px_rgba(var(--accent-rgb),0.2)]"
                        : "bg-zinc-800/50 text-zinc-500 border-transparent hover:text-zinc-400"
                )}
            >
                <i className="fa-solid fa-graduation-cap text-[10px]"></i>
                <span className="truncate">{selectedDisplayName}</span>
            </button>

            {isOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-80 bg-zinc-900 border border-gray-700 rounded-lg shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-2">
                    <div className="bg-zinc-800/80 px-3 py-2 border-b border-gray-700 flex justify-between items-center">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">PROTOCOLOS EXPERTOS</span>
                    </div>
                    <div className="flex flex-col py-2 max-h-64 overflow-y-auto">
                        <button
                            onClick={() => { setSelectedSkill(null); setIsOpen(false); }}
                            className={cn(
                                "flex items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-zinc-800 text-left mb-2",
                                !selectedSkill ? "text-accent font-bold" : "text-gray-300"
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
                            onClick={() => { 
                                setIsOpen(false); 
                                window.dispatchEvent(new CustomEvent("gulin:open-skill-manager"));
                            }}
                            className="w-full text-center py-1.5 text-[9px] font-bold text-gray-500 hover:text-accent transition-colors"
                        >
                            GESTIONAR SKILLS
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
});

SkillSelector.displayName = "SkillSelector";

AIPanelInput.displayName = "AIPanelInput";
