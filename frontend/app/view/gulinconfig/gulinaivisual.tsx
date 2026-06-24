// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { GulinConfigViewModel } from "@/app/view/gulinconfig/gulinconfig-model";
import { atoms } from "@/app/store/global-atoms";
import { getApi } from "@/app/store/global";
import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { memo, useCallback, useMemo, useState, useEffect } from "react";

interface GulinAIVisualContentProps {
    model: GulinConfigViewModel;
}

const PROVIDERS = [
    "gulin",
    "google",
    "groq",
    "openrouter",
    "nanogpt",
    "openai",
    "deepseek",
    "azure",
    "azure-legacy",
    "gulinbridge",
    "custom",
    "aws-bedrock"
];

const API_TYPES = [
    "google-gemini",
    "openai-responses",
    "openai-chat",
    "aws-bedrock"
];

const PROVIDER_MODELS: Record<string, string[]> = {
    "gulin": ["gulin-1.0"],
    "google": ["gemini-1.5-pro-latest", "gemini-1.5-flash-latest", "gemini-1.0-pro"],
    "groq": ["llama3-8b-8192", "llama3-70b-8192", "mixtral-8x7b-32768", "gemma-7b-it"],
    "openrouter": ["anthropic/claude-3.5-sonnet", "meta-llama/llama-3-70b-instruct", "google/gemini-1.5-pro", "openai/gpt-4o"],
    "openai": ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo", "gpt-4"],
    "deepseek": ["deepseek-chat", "deepseek-coder"],
    "azure": ["gpt-4o", "gpt-4", "gpt-35-turbo"],
    "aws-bedrock": ["anthropic.claude-3-sonnet-20240229-v1:0", "anthropic.claude-3-haiku-20240307-v1:0", "anthropic.claude-3-opus-20240229-v1:0", "meta.llama3-8b-instruct-v1:0", "meta.llama3-70b-instruct-v1:0"]
};

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

export const GulinAIVisualContent = memo(({ model }: GulinAIVisualContentProps) => {
    const settings = useAtomValue(atoms.settingsAtom);
    const isBridgeEnabled = settings?.["gulinbridge:enabled"];
    const [fileContent, setFileContent] = useAtom(model.fileContentAtom);
    const parsedConfig = useMemo(() => tryParseJSON(fileContent), [fileContent]);
    const configKeys = Object.keys(parsedConfig).sort();

    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [isLoginOpen, setIsLoginOpen] = useState(false);
    const [isRegisterMode, setIsRegisterMode] = useState(false);
    const [loginData, setLoginData] = useState({
        url: "https://gulin-bridge.738rw5vk4n066.us-east-1.cs.amazonlightsail.com",
        email: "",
        password: "",
        confirmPassword: ""
    });
    const [isLoggingIn, setIsLoggingIn] = useState(false);

    // Auto-select first key if none is selected
    useEffect(() => {
        if (!selectedKey && configKeys.length > 0) {
            setSelectedKey(configKeys[0]);
        } else if (selectedKey && !configKeys.includes(selectedKey)) {
            setSelectedKey(configKeys.length > 0 ? configKeys[0] : null);
        }
    }, [configKeys, selectedKey]);

    const updateConfig = useCallback((newConfig: Record<string, any>) => {
        setFileContent(JSON.stringify(newConfig, null, 2));
        model.markAsEdited();
    }, [setFileContent, model]);

    const handleAddMode = () => {
        let newKey = "new-mode";
        let counter = 1;
        while (parsedConfig[newKey]) {
            newKey = `new-mode-${counter}`;
            counter++;
        }

        const newConfig = {
            ...parsedConfig,
            [newKey]: {
                "display:name": "New Gulin IA Mode",
                "ai:provider": "custom",
                "ai:model": "llama3",
            }
        };
        updateConfig(newConfig);
        setSelectedKey(newKey);
    };

    const handleDeleteMode = (keyToDelete: string) => {
        const newConfig = { ...parsedConfig };
        delete newConfig[keyToDelete];
        updateConfig(newConfig);
        if (selectedKey === keyToDelete) {
            setSelectedKey(null);
        }
    };

    const handleUpdateField = (field: string, value: any) => {
        if (!selectedKey) return;
        const currentMode = parsedConfig[selectedKey] || {};

        const newMode = { ...currentMode };
        if (value === "") {
            delete newMode[field];
        } else {
            newMode[field] = value;
        }

        const newConfig = {
            ...parsedConfig,
            [selectedKey]: newMode
        };
        updateConfig(newConfig);
    };

    const handleKeyChange = (newKey: string) => {
        if (!selectedKey || newKey === selectedKey || newKey.trim() === "") return;
        if (parsedConfig[newKey]) return; // Refuse if already exists

        const newConfig = { ...parsedConfig };
        newConfig[newKey] = newConfig[selectedKey];
        delete newConfig[selectedKey];

        updateConfig(newConfig);
        setSelectedKey(newKey);
    };

    const selectedData = selectedKey ? parsedConfig[selectedKey] : null;

    return (
        <div className="flex w-full h-full overflow-hidden text-sm">
            {/* Left Sidebar - List of Modes */}
            <div className="w-1/3 min-w-[200px] border-r border-border flex flex-col h-full bg-zinc-800/20">
                <div className="p-3 border-b border-border flex justify-between items-center bg-zinc-800/20">
                    <span className="font-semibold text-zinc-300">Mis Modelos</span>
                    <button
                        onClick={handleAddMode}
                        className="p-1 px-2 hover:bg-zinc-700/50 rounded flex items-center justify-center cursor-pointer transition-colors text-accent-500 text-xs font-medium"
                        title="Add Custom Model"
                    >
                        <i className="fa-sharp fa-solid fa-plus mr-1" />
                        Personalizado
                    </button>
                </div>
                <div className="p-3 border-b border-border bg-accent-500/5 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] text-accent-500 font-bold uppercase tracking-wider">Gulin Bridge</span>
                        <div className="flex gap-2">
                            {isBridgeEnabled ? (
                                <>
                                    <button
                                        onClick={async () => {
                                            if (confirm("¿Estás seguro de que deseas cerrar sesión? se borrarán tus tokens locales.")) {
                                                try {
                                                    await model.syncGulinBridgeLogout();
                                                    alert("Sesión cerrada correctamente.");
                                                } catch (e) {
                                                    alert("Error al cerrar sesión: " + e.message);
                                                }
                                            }
                                        }}
                                        className="flex items-center gap-1.5 px-2 py-1 bg-zinc-700 text-zinc-300 rounded text-[10px] font-bold hover:bg-zinc-600 transition-all active:scale-95 cursor-pointer"
                                        title="Cerrar Sesión"
                                    >
                                        <i className="fa-solid fa-right-from-bracket" />
                                        Salir
                                    </button>
                                    <button
                                        onClick={async () => {
                                            const name = prompt("Nombre para el nuevo token:", "Gulin Term " + new Date().toLocaleDateString());
                                            if (name) {
                                                try {
                                                    const token = await model.syncGulinBridgeCreateToken(name);
                                                    alert("Token creado y activado:\n" + token);
                                                } catch (e) {
                                                    alert("Error al crear token: " + e.message);
                                                }
                                            }
                                        }}
                                        className="flex items-center gap-1.5 px-2 py-1 bg-accent-500 text-white rounded text-[10px] font-bold hover:bg-accent-600 transition-all shadow-lg shadow-accent-500/20 active:scale-95 cursor-pointer"
                                        title="Crear Nuevo Token"
                                    >
                                        <i className="fa-solid fa-key" />
                                        Token
                                    </button>
                                </>
                            ) : (
                                <button
                                    onClick={() => setIsLoginOpen(true)}
                                    className="flex items-center gap-1.5 px-2 py-1 bg-accent-500 text-white rounded text-[10px] font-bold hover:bg-accent-600 transition-all shadow-lg shadow-accent-500/20 active:scale-95 cursor-pointer"
                                >
                                    <i className="fa-solid fa-right-to-bracket" />
                                    Login
                                </button>
                            )}
                        </div>
                    </div>
                    <p className="text-[9px] text-zinc-400 leading-tight">
                        {isBridgeEnabled 
                            ? `Conectado como ${settings?.["gulinbridge:email"] || "usuario"}`
                            : "Accede a tus modelos privados y herramientas avanzadas de forma segura."
                        }
                    </p>
                </div>
                <div className="p-2 border-b border-border bg-zinc-800/30 flex flex-col gap-1.5 justify-center">
                    <div className="text-[10px] text-zinc-400 font-medium uppercase px-1">Configuración Rápida</div>
                    <button
                        onClick={() => {
                            let newKey = "deepseek-api";
                            let counter = 1;
                            while (parsedConfig[newKey]) {
                                newKey = `deepseek-api-${counter}`;
                                counter++;
                            }
                            const newConfig = {
                                ...parsedConfig,
                                [newKey]: {
                                    "display:name": "DeepSeek (API)",
                                    "ai:provider": "deepseek",
                                    "ai:apitype": "openai-chat",
                                    "ai:model": "deepseek-chat",
                                    "ai:capabilities": ["tools"]
                                }
                            };
                            updateConfig(newConfig);
                            setSelectedKey(newKey);
                        }}
                        className="py-1 px-3 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 rounded text-[11px] text-indigo-300 cursor-pointer transition-colors flex items-center gap-2 w-full justify-start"
                    >
                        <i className="fa-solid fa-sparkles text-indigo-400" />
                        Añadir DeepSeek
                    </button>
                    <button
                        onClick={() => {
                            let newKey = "ollama-local";
                            let counter = 1;
                            while (parsedConfig[newKey]) {
                                newKey = `ollama-local-${counter}`;
                                counter++;
                            }
                            const newConfig = {
                                ...parsedConfig,
                                [newKey]: {
                                    "display:name": "Ollama (Local)",
                                    "ai:provider": "custom",
                                    "ai:apitype": "openai-chat",
                                    "ai:model": "llama3.2",
                                    "ai:endpoint": "http://127.0.0.1:11434/v1/chat/completions",
                                    "ai:capabilities": ["tools"]
                                }
                            };
                            updateConfig(newConfig);
                            setSelectedKey(newKey);
                        }}
                        className="py-1 px-3 bg-zinc-700/50 hover:bg-zinc-600 border border-zinc-600 rounded text-[11px] text-zinc-200 cursor-pointer transition-colors flex items-center gap-2 w-full justify-start mt-1"
                    >
                        <i className="fa-solid fa-bolt text-yellow-500" />
                        Añadir Ollama
                    </button>
                    <button
                        onClick={() => {
                            let newKey = "openai-api";
                            let counter = 1;
                            while (parsedConfig[newKey]) {
                                newKey = `openai-api-${counter}`;
                                counter++;
                            }
                            const newConfig = {
                                ...parsedConfig,
                                [newKey]: {
                                    "display:name": "OpenAI (API)",
                                    "ai:provider": "openai",
                                    "ai:apitype": "openai-chat",
                                    "ai:model": "gpt-4o",
                                    "ai:capabilities": ["tools"]
                                }
                            };
                            updateConfig(newConfig);
                            setSelectedKey(newKey);
                        }}
                        className="py-1 px-3 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 rounded text-[11px] text-green-300 cursor-pointer transition-colors flex items-center gap-2 w-full justify-start mt-1"
                    >
                        <i className="fa-solid fa-brain text-green-400" />
                        Añadir OpenAI
                    </button>
                    <button
                        onClick={() => {
                            let newKey = "gemini-api";
                            let counter = 1;
                            while (parsedConfig[newKey]) {
                                newKey = `gemini-api-${counter}`;
                                counter++;
                            }
                            const newConfig = {
                                ...parsedConfig,
                                [newKey]: {
                                    "display:name": "Google Gemini",
                                    "ai:provider": "google",
                                    "ai:apitype": "google-gemini",
                                    "ai:model": "gemini-2.5-flash",
                                    "ai:capabilities": ["tools"]
                                }
                            };
                            updateConfig(newConfig);
                            setSelectedKey(newKey);
                        }}
                        className="py-1 px-3 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded text-[11px] text-blue-300 cursor-pointer transition-colors flex items-center gap-2 w-full justify-start mt-1"
                    >
                        <i className="fa-brands fa-google text-blue-400" />
                        Añadir Gemini
                    </button>
                    <button
                        onClick={() => {
                            let newKey = "nvidia-nim";
                            let counter = 1;
                            while (parsedConfig[newKey]) {
                                newKey = `nvidia-nim-${counter}`;
                                counter++;
                            }
                            const newConfig = {
                                ...parsedConfig,
                                [newKey]: {
                                    "display:name": "NVIDIA NIM",
                                    "ai:provider": "custom",
                                    "ai:apitype": "openai-chat",
                                    "ai:model": "meta/llama3-70b-instruct",
                                    "ai:endpoint": "https://integrate.api.nvidia.com/v1/chat/completions",
                                    "ai:capabilities": ["tools"]
                                }
                            };
                            updateConfig(newConfig);
                            setSelectedKey(newKey);
                        }}
                        className="py-1 px-3 bg-[#76b900]/10 hover:bg-[#76b900]/20 border border-[#76b900]/30 rounded text-[11px] text-[#76b900] cursor-pointer transition-colors flex items-center gap-2 w-full justify-start mt-1"
                    >
                        <i className="fa-solid fa-microchip text-[#76b900]" />
                        Añadir NVIDIA NIM
                    </button>
                    <div className="mt-4 pt-4 border-t border-zinc-700/50">
                        <div className="text-[10px] text-zinc-400 font-medium uppercase px-1 mb-2">Gulin Bridge</div>
                        <button
                            onClick={async () => {
                                try {
                                    await model.syncGulinBridgeModels();
                                    alert("Sincronización iniciada correctamente");
                                } catch (e) {
                                    alert("Error al sincronizar: " + e.message);
                                }
                            }}
                            className="py-1.5 px-3 bg-accent-500/10 hover:bg-accent-500/20 border border-accent-500/30 rounded text-[11px] text-accent-500 cursor-pointer transition-colors flex items-center gap-2 w-full justify-center"
                        >
                            <i className="fa-solid fa-sync fa-spin-hover" />
                            Sincronizar Bridge
                        </button>
                    </div>
                </div>
                <div className="text-[10px] text-zinc-400 font-medium uppercase px-3 pt-3">Tus Modelos Listos</div>
                <div className="flex-1 overflow-y-auto w-full">
                    {configKeys.length === 0 ? (
                        <div className="p-4 text-zinc-500 text-center text-xs">No hay configuraciones aún.</div>
                    ) : (
                        <div className="flex flex-col divide-y divide-zinc-700/50">
                            {configKeys.map(key => {
                                const m = parsedConfig[key];
                                const displayName = m["display:name"] || key;
                                const isSelected = selectedKey === key;

                                return (
                                    <div
                                        key={key}
                                        className={cn(
                                            "p-3 cursor-pointer hover:bg-zinc-700/30 transition-colors flex justify-between items-center",
                                            isSelected ? "bg-zinc-700/50 border-l-2 border-accent-500" : "border-l-2 border-transparent"
                                        )}
                                        onClick={() => setSelectedKey(key)}
                                    >
                                        <div className="flex flex-col overflow-hidden">
                                            <span className="font-medium truncate">{displayName}</span>
                                            <span className="text-xs text-zinc-500 font-mono truncate">{key}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Right Side - Details Editor */}
            <div className="w-2/3 flex-1 flex flex-col h-full overflow-y-auto p-6 bg-zinc-900/50">
                {!selectedKey || !selectedData ? (
                    <div className="flex h-full items-center justify-center text-zinc-500">
                        Select a Gulin IA mode to edit its properties
                    </div>
                ) : (
                    <div className="flex flex-col gap-6 max-w-2xl w-full mx-auto">
                        <div className="flex justify-between items-center">
                            <h2 className="text-xl font-semibold">Edit Mode Configuration</h2>
                            <button
                                onClick={() => handleDeleteMode(selectedKey)}
                                className="px-3 py-1.5 bg-red-500/10 text-red-500 hover:bg-red-500/20 rounded cursor-pointer transition-colors flex items-center gap-2"
                            >
                                <i className="fa-sharp fa-solid fa-trash" />
                                Delete
                            </button>
                        </div>

                        <div className="flex flex-col gap-4">
                            {/* Unique Key Editor */}
                            <div className="flex flex-col gap-1.5">
                                <label className="font-medium text-zinc-300">Mode ID (Key)</label>
                                <input
                                    type="text"
                                    className="px-3 py-2 bg-zinc-800 border fill-border border-zinc-600 rounded focus:outline-none focus:border-accent-500 font-mono text-xs"
                                    value={selectedKey}
                                    onChange={(e) => handleKeyChange(e.target.value)}
                                    placeholder="my-custom-model"
                                />
                                <span className="text-xs text-zinc-500">Must be unique, letters/numbers/hyphens only.</span>
                            </div>

                            {/* Display Name */}
                            <div className="flex flex-col gap-1.5">
                                <label className="font-medium text-zinc-300">Display Name</label>
                                <input
                                    type="text"
                                    className="px-3 py-2 bg-zinc-800 border fill-border border-zinc-600 rounded focus:outline-none focus:border-accent-500"
                                    value={selectedData["display:name"] || ""}
                                    onChange={(e) => handleUpdateField("display:name", e.target.value)}
                                    placeholder="E.g. Ollama - Llama 3"
                                />
                            </div>

                            {/* Provider & APIType */}
                            <div className="flex gap-4">
                                <div className="flex flex-col gap-1.5 flex-1">
                                    <label className="font-medium text-zinc-300">Provider</label>
                                    <select
                                        className="px-3 py-2 bg-zinc-800 border border-zinc-600 rounded focus:outline-none focus:border-accent-500"
                                        value={selectedData["ai:provider"] || ""}
                                        onChange={(e) => handleUpdateField("ai:provider", e.target.value)}
                                    >
                                        <option value="">-- Select Provider --</option>
                                        {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                                    </select>
                                </div>
                                <div className="flex flex-col gap-1.5 flex-1">
                                    <label className="font-medium text-zinc-300">API Type</label>
                                    <select
                                        className="px-3 py-2 bg-zinc-800 border border-zinc-600 rounded focus:outline-none focus:border-accent-500"
                                        value={selectedData["ai:apitype"] || ""}
                                        onChange={(e) => handleUpdateField("ai:apitype", e.target.value)}
                                    >
                                        <option value="">-- Default --</option>
                                        {API_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                                    </select>
                                </div>
                            </div>

                            {/* Model */}
                            <div className="flex flex-col gap-1.5">
                                <label className="font-medium text-zinc-300">Model Name</label>
                                <select
                                    className="px-3 py-2 bg-zinc-800 border border-zinc-600 rounded focus:outline-none focus:border-accent-500 font-mono text-xs"
                                    value={(PROVIDER_MODELS[selectedData["ai:provider"]] || []).includes(selectedData["ai:model"]) ? selectedData["ai:model"] : "custom"}
                                    onChange={(e) => {
                                        if (e.target.value === "custom") {
                                            handleUpdateField("ai:model", "");
                                        } else {
                                            handleUpdateField("ai:model", e.target.value);
                                        }
                                    }}
                                >
                                    {(PROVIDER_MODELS[selectedData["ai:provider"]] || []).map(model => (
                                        <option key={model} value={model}>{model}</option>
                                    ))}
                                    <option value="custom">-- Custom Model --</option>
                                </select>
                                {(!(PROVIDER_MODELS[selectedData["ai:provider"]] || []).includes(selectedData["ai:model"])) && (
                                    <input
                                        type="text"
                                        className="px-3 py-2 mt-1 bg-zinc-800 border border-zinc-600 rounded focus:outline-none focus:border-accent-500 font-mono text-xs"
                                        value={selectedData["ai:model"] || ""}
                                        onChange={(e) => handleUpdateField("ai:model", e.target.value)}
                                        placeholder="llama3, gpt-4o, etc."
                                        autoFocus
                                    />
                                )}
                            </div>

                            {/* Endpoint URL */}
                            <div className="flex flex-col gap-1.5">
                                <label className="font-medium text-zinc-300">API Endpoint (Optional)</label>
                                <input
                                    type="text"
                                    className="px-3 py-2 bg-zinc-800 border border-zinc-600 rounded focus:outline-none focus:border-accent-500 font-mono text-xs"
                                    value={selectedData["ai:endpoint"] || ""}
                                    onChange={(e) => handleUpdateField("ai:endpoint", e.target.value)}
                                    placeholder="http://localhost:11434/v1/chat/completions"
                                />
                                <span className="text-xs text-zinc-500">Required for custom providers or local Ollama / LM Studio.</span>
                            </div>

                            {/* API Token Secret Name */}
                            <div className="flex flex-col gap-1.5">
                                <label className="font-medium text-zinc-300">API Token Secret Name</label>
                                <input
                                    type="text"
                                    className="px-3 py-2 bg-zinc-800 border border-zinc-600 rounded focus:outline-none focus:border-accent-500 font-mono text-xs"
                                    value={selectedData["ai:apitokensecretname"] || ""}
                                    onChange={(e) => handleUpdateField("ai:apitokensecretname", e.target.value)}
                                    placeholder="Provide the name of a secret configured in 'Secrets'"
                                />
                            </div>

                            {/* API Token Inline */}
                            <div className="flex flex-col gap-1.5">
                                <label className="font-medium text-zinc-300">Inline API Token (Insecure)</label>
                                <input
                                    type="password"
                                    className="px-3 py-2 bg-zinc-800 border border-zinc-600 rounded focus:outline-none focus:border-accent-500 font-mono text-xs"
                                    value={selectedData["ai:apitoken"] || ""}
                                    onChange={(e) => handleUpdateField("ai:apitoken", e.target.value)}
                                    placeholder="Prefer using API Token Secret Name above"
                                />
                            </div>

                            <div className="pt-4 border-t border-zinc-700">
                                <p className="text-xs text-zinc-400">Note: Use the "Raw JSON" tab to view or edit advanced fields not shown here.</p>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Login Modal */}
            {isLoginOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="w-full max-w-md bg-zinc-900/90 border border-zinc-700/50 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-xl animate-in zoom-in-95 duration-200">
                        {/* Modal Header */}
                        <div className="p-6 pb-4 flex justify-between items-start border-b border-zinc-800/50 relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-accent-500/10 blur-3xl -mr-16 -mt-16 rounded-full" />
                            <div className="relative z-10">
                                <h3 className="text-xl font-bold text-white flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-accent-500/20 flex items-center justify-center border border-accent-500/30">
                                        <i className={`fa-solid ${isRegisterMode ? 'fa-user-plus' : 'fa-bridge'} text-accent-500`} />
                                    </div>
                                    {isRegisterMode ? 'Registrar Nuevo Usuario' : 'Conectar Gulin Bridge'}
                                </h3>
                                <p className="text-zinc-400 text-xs mt-1 ml-13">
                                    {isRegisterMode ? 'Crea una cuenta para acceder a modelos privados' : 'Configuración automática de modelos de IA'}
                                </p>
                            </div>
                            <button 
                                onClick={() => {
                                    setIsLoginOpen(false);
                                    setIsRegisterMode(false);
                                    setLoginData(d => ({ ...d, confirmPassword: "" }));
                                }}
                                className="text-zinc-500 hover:text-white transition-colors p-1"
                            >
                                <i className="fa-solid fa-times text-lg" />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-6 flex flex-col gap-5">
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider ml-1">URL del Servidor</label>
                                <div className="relative group">
                                    <i className="fa-solid fa-globe absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-accent-500 transition-colors" />
                                    <input 
                                        type="text" 
                                        className="w-full pl-10 pr-4 py-3 bg-zinc-800/50 border border-zinc-700/50 rounded-xl focus:outline-none focus:border-accent-500/50 focus:bg-zinc-800 transition-all font-mono text-xs"
                                        placeholder="https://gulin-bridge.example.com"
                                        value={loginData.url}
                                        onChange={(e) => setLoginData({...loginData, url: e.target.value})}
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider ml-1">Email</label>
                                <div className="relative group">
                                    <i className="fa-solid fa-envelope absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-indigo-500 transition-colors" />
                                    <input 
                                        type="email" 
                                        className="w-full pl-10 pr-4 py-3 bg-zinc-800/50 border border-zinc-700/50 rounded-xl focus:outline-none focus:border-indigo-500/50 focus:bg-zinc-800 transition-all"
                                        placeholder="admin@gulin.dev"
                                        value={loginData.email}
                                        onChange={(e) => setLoginData({...loginData, email: e.target.value})}
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider ml-1">Contraseña</label>
                                <div className="relative group">
                                    <i className="fa-solid fa-lock absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-emerald-500 transition-colors" />
                                    <input 
                                        type="password" 
                                        className="w-full pl-10 pr-4 py-3 bg-zinc-800/50 border border-zinc-700/50 rounded-xl focus:outline-none focus:border-emerald-500/50 focus:bg-zinc-800 transition-all"
                                        placeholder="••••••••••••"
                                        value={loginData.password}
                                        onChange={(e) => setLoginData({...loginData, password: e.target.value})}
                                    />
                                </div>
                            </div>

                            {isRegisterMode && (
                                <div className="flex flex-col gap-1.5 animate-in slide-in-from-top-2 duration-200">
                                    <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider ml-1">Confirmar Contraseña</label>
                                    <div className="relative group">
                                        <i className="fa-solid fa-shield-check absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-emerald-500 transition-colors" />
                                        <input 
                                            type="password" 
                                            className="w-full pl-10 pr-4 py-3 bg-zinc-800/50 border border-zinc-700/50 rounded-xl focus:outline-none focus:border-emerald-500/50 focus:bg-zinc-800 transition-all"
                                            placeholder="••••••••••••"
                                            value={loginData.confirmPassword}
                                            onChange={(e) => setLoginData({...loginData, confirmPassword: e.target.value})}
                                        />
                                    </div>
                                </div>
                            )}

                            <button 
                                onClick={() => {
                                    if (loginData.url) {
                                        getApi().openExternal(loginData.url);
                                    }
                                }}
                                className="mt-2 p-3 bg-indigo-500/10 hover:bg-indigo-500/20 rounded-xl border border-indigo-500/30 flex gap-3 items-center justify-center transition-colors cursor-pointer group"
                            >
                                <i className="fa-solid fa-credit-card text-indigo-400 group-hover:scale-110 transition-transform" />
                                <span className="text-xs font-bold text-indigo-300">Cargar Saldo / Ir al Dashboard</span>
                                <i className="fa-solid fa-arrow-up-right-from-square text-[10px] text-indigo-500" />
                            </button>
                        </div>

                        {/* Modal Footer */}
                        <div className="p-6 pt-0 flex flex-col gap-3">
                            <button 
                                onClick={async () => {
                                    if (isLoggingIn) return;
                                    setIsLoggingIn(true);
                                    try {
                                        if (isRegisterMode) {
                                            if (loginData.password !== loginData.confirmPassword) {
                                                alert("Las contraseñas no coinciden.");
                                                return;
                                            }
                                            await model.syncGulinBridgeRegister(loginData);
                                            alert("¡Usuario registrado y conectado con éxito!");
                                        } else {
                                            await model.syncGulinBridgeLogin(loginData.url, loginData.email, loginData.password);
                                            alert("¡Conexión exitosa! Tus modelos se han sincronizado.");
                                        }
                                        setIsLoginOpen(false);
                                        setIsRegisterMode(false);
                                    } catch (e) {
                                        alert("Error: " + e.message);
                                    } finally {
                                        setIsLoggingIn(false);
                                    }
                                }}
                                disabled={isLoggingIn || !loginData.email || !loginData.password || !loginData.url || (isRegisterMode && !loginData.confirmPassword)}
                                className="w-full py-4 bg-gradient-to-r from-accent-600 to-indigo-600 hover:from-accent-500 hover:to-indigo-500 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-xl shadow-accent-500/20 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                            >
                                {isLoggingIn ? (
                                    <>
                                        <i className="fa-solid fa-spinner-third fa-spin" />
                                        Procesando...
                                    </>
                                ) : (
                                    <>
                                        <i className={`fa-solid ${isRegisterMode ? 'fa-user-plus' : 'fa-bolt'}`} />
                                        {isRegisterMode ? 'Crear Cuenta y Conectar' : 'Establecer Conexión'}
                                    </>
                                )}
                            </button>
                            
                            <div className="flex justify-center items-center gap-2 mt-1">
                                <p className="text-[10px] text-zinc-500">
                                    {isRegisterMode ? '¿Ya tienes una cuenta?' : '¿No tienes cuenta?'}
                                </p>
                                <button 
                                     onClick={() => {
                                        setIsRegisterMode(!isRegisterMode);
                                        setLoginData(d => ({ ...d, confirmPassword: "" }));
                                    }}
                                    className="text-[10px] text-accent-500 font-bold hover:underline cursor-pointer"
                                >
                                    {isRegisterMode ? 'Iniciar Sesión' : 'Registrarse Ahora'}
                                </button>
                            </div>

                            <p className="text-center text-[10px] text-zinc-500 mt-2">
                                Al continuar, aceptas las <a href="#" className="underline text-zinc-400">condiciones de uso</a>.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

GulinAIVisualContent.displayName = "GulinAIVisualContent";