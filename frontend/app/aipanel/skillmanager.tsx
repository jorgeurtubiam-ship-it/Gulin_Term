// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { memo, useState, useEffect } from "react";
import { useAtom, useAtomValue } from "jotai";
import { GulinAIModel } from "./gulinai-model";
import { cn } from "@/util/util";
import { Modal } from "@/app/modals/modal";
import { getWebServerEndpoint } from "@/util/endpoints";

interface SkillManagerProps {
    model: GulinAIModel;
    onClose: () => void;
}

export const SkillManager = memo(({ model, onClose }: SkillManagerProps) => {
    const [availableSkills, setAvailableSkills] = useAtom(model.availableSkills);
    const [editingSkill, setEditingSkill] = useState<{title: string, filename: string} | null>(null);
    const [skillContent, setSkillContent] = useState("");
    const [newSkillName, setNewSkillName] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    const loadSkillContent = async (filename: string) => {
        const baseUrl = getWebServerEndpoint();
        try {
            const response = await fetch(`${baseUrl}/gulin/brain-read?filename=${filename}`);
            if (response.ok) {
                const text = await response.text();
                setSkillContent(text);
            } else {
                setSkillContent("# Nuevo Protocolo\n\nEscribe aquí tus reglas...");
            }
        } catch (e) {
            setSkillContent("Error al cargar skill.");
        }
    };

    const handleSave = async () => {
        const baseUrl = getWebServerEndpoint();
        setIsSaving(true);
        const name = editingSkill ? editingSkill.title.replace("✨ ", "") : newSkillName;
        let filename = editingSkill?.filename;
        if (!filename) {
            filename = "skills/" + name.toLowerCase().replace(/ /g, "_").replace(/[^a-z0-9_]+/g, "").trim() + ".md";
        }
        
        try {
            await fetch(`${baseUrl}/gulin/brain-update`, {
                method: "POST",
                body: JSON.stringify({ filename: filename, content: skillContent }),
            });
            
            if (!editingSkill) {
                setAvailableSkills([...availableSkills, {title: "✨ " + name, filename: filename}]);
            }
            setEditingSkill(null);
            setNewSkillName("");
            setSkillContent("");
        } catch (e) {
            console.error("Error saving skill", e);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (filename: string) => {
        const baseUrl = getWebServerEndpoint();
        if (!confirm(`¿Estás seguro de borrar esta skill?`)) return;
        try {
            await fetch(`${baseUrl}/gulin/brain-delete?filename=${filename}`);
            setAvailableSkills(availableSkills.filter(s => s.filename !== filename));
        } catch (e) {
            console.error("Error deleting skill", e);
        }
    };

    return (
        <Modal onClose={onClose} className="w-[600px] bg-zinc-900 text-white border border-gray-700 shadow-2xl">
            <div className="flex flex-col gap-4 p-4">
                <div className="text-sm font-bold text-accent mb-2 tracking-widest">MANTENEDOR DE SKILLS AGENTICAS</div>
                {!editingSkill && !newSkillName && (
                    <>
                        <div className="flex justify-between items-center border-b border-gray-700 pb-2">
                            <span className="text-xs font-bold text-gray-400">SKILLS INSTALADAS</span>
                            <button 
                                onClick={() => setNewSkillName("Nueva Skill")}
                                className="text-[10px] bg-accent/20 text-accent px-2 py-1 rounded hover:bg-accent/30 transition-colors"
                            >
                                + AÑADIR SKILL
                            </button>
                        </div>
                        <div className="flex flex-col gap-1 max-h-[300px] overflow-auto pr-2 pb-2">
                            {(() => {
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

                                const renderNode = (node: any, level: number) => {
                                    if (node.isSkill) {
                                        let name = node.name.replace(/[-_]/g, " ");
                                        name = name.replace(/\b\w/g, (c: string) => c.toUpperCase());
                                        return (
                                            <div key={node.skill.filename} className="flex items-center justify-between bg-zinc-800/50 p-2 rounded-lg border border-gray-700/50 group w-full" style={{ marginLeft: `${level * 16}px`, width: `calc(100% - ${level * 16}px)` }}>
                                                <div className="flex items-center gap-3">
                                                    <i className="fa-solid fa-star text-[10px] text-accent"></i>
                                                    <span className="text-sm font-medium">{name}</span>
                                                </div>
                                                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button 
                                                        onClick={() => { setEditingSkill(node.skill); loadSkillContent(node.skill.filename); }}
                                                        className="p-1.5 text-gray-400 hover:text-white transition-colors"
                                                    >
                                                        <i className="fa-solid fa-pen-to-square"></i>
                                                    </button>
                                                    <button 
                                                        onClick={() => handleDelete(node.skill.filename)}
                                                        className="p-1.5 text-gray-400 hover:text-red-400 transition-colors"
                                                    >
                                                        <i className="fa-solid fa-trash"></i>
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    }

                                    return (
                                        <div key={node.name} className="flex flex-col gap-1 w-full mt-2">
                                            <div className="flex items-center gap-2 py-1 text-xs text-gray-400 font-medium" style={{ paddingLeft: `${level * 16}px` }}>
                                                <i className="fa-solid fa-folder-open text-[10px]"></i>
                                                <span className="capitalize">{node.name.replace(/[-_]/g, " ")}</span>
                                            </div>
                                            <div className="flex flex-col gap-1 border-l border-gray-700/50 ml-2">
                                                {node.children.map((child: any, i: number) => renderNode(child, level + 1))}
                                            </div>
                                        </div>
                                    );
                                };

                                return root.children.map((child: any, i: number) => renderNode(child, 0));
                            })()}
                        </div>
                    </>
                )}

                {(editingSkill || newSkillName !== "") && (
                    <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2">
                        <input 
                            type="text" 
                            value={editingSkill ? editingSkill.title.replace("✨ ", "") : newSkillName} 
                            onChange={(e) => editingSkill ? null : setNewSkillName(e.target.value)}
                            disabled={!!editingSkill}
                            className="bg-black/40 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-accent/50"
                            placeholder="Nombre de la Skill (ej: Experto en Redes)"
                        />
                        <textarea 
                            value={skillContent}
                            onChange={(e) => setSkillContent(e.target.value)}
                            className="bg-black/40 border border-gray-700 rounded px-3 py-2 text-xs font-mono min-h-[300px] focus:outline-none focus:border-accent/50 resize-none"
                            placeholder="# PROTOCOLO... \n\nDefine aquí las reglas que debe seguir Gulin."
                        />
                        <div className="flex justify-end gap-3 mt-2">
                            <button 
                                onClick={() => { setEditingSkill(null); setNewSkillName(""); }}
                                className="px-4 py-1.5 text-sm text-gray-400 hover:text-white transition-colors"
                            >
                                CANCELAR
                            </button>
                            <button 
                                onClick={handleSave}
                                disabled={isSaving}
                                className="bg-accent text-white px-6 py-1.5 rounded-lg text-sm font-bold shadow-lg shadow-accent/20 hover:brightness-110 transition-all disabled:opacity-50"
                            >
                                {isSaving ? "GUARDANDO..." : "GUARDAR PROTOCOLO"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
});

SkillManager.displayName = "SkillManager";
