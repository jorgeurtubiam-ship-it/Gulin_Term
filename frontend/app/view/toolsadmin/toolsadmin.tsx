import React, { useState, useEffect } from "react";
import { FullBlockProps } from "@/app/block/blocktypes";
import { useAtomValue } from "jotai";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { RpcApi } from "@/app/store/wshclientapi";

export const ToolsAdminView = React.memo((props: FullBlockProps) => {
    const [selectedTool, setSelectedTool] = useState<any>(null);
    const [activeTab, setActiveTab] = useState<"settings" | "code">("settings");
    const [tools, setTools] = useState<any[]>([]);

    useEffect(() => {
        RpcApi.ToolsListCommand(TabRpcClient).then((list) => {
            setTools(list || []);
        }).catch(err => {
            console.error("Error loading tools", err);
        });
    }, []);

    const handleCreateTool = () => {
        const newTool = {
            name: "get_weather",
            type: "dynamic",
            integration: "background",
            description: "Obtiene el clima actual para una ciudad especificada.",
            code: `// Ejemplo de plugin dinámico: get_weather
function execute(args) {
    const city = args.city || "Madrid";
    
    // Aquí podrías hacer fetch a una API real
    // const response = fetchSync("https://api.weather.com/...");
    
    return {
        success: true,
        message: "Clima obtenido exitosamente",
        data: {
            city: city,
            temperature: 24,
            condition: "Soleado"
        }
    };
}`
        };
        setTools([newTool, ...tools]);
        setSelectedTool(newTool);
        setActiveTab("code");
    };

    const handleSave = async () => {
        if (!selectedTool) return;
        try {
            await RpcApi.ToolsSaveCommand(TabRpcClient, selectedTool);
            console.log("Saved tool", selectedTool.name);
            // Refresh list
            const list = await RpcApi.ToolsListCommand(TabRpcClient);
            setTools(list || []);
        } catch (err) {
            console.error("Failed to save tool", err);
        }
    };

    const handleDelete = async () => {
        if (!selectedTool || selectedTool.type !== 'dynamic') return;
        const confirmDelete = window.confirm(`Are you sure you want to delete ${selectedTool.name}?`);
        if (!confirmDelete) return;

        try {
            await RpcApi.ToolsDeleteCommand(TabRpcClient, selectedTool.name);
            console.log("Deleted tool", selectedTool.name);
            setSelectedTool(null);
            const list = await RpcApi.ToolsListCommand(TabRpcClient);
            setTools(list || []);
        } catch (err) {
            console.error("Failed to delete tool", err);
        }
    };

    return (
        <div className="flex h-full w-full text-white bg-gray-900" style={{ height: "100%", width: "100%" }}>
            {/* Sidebar list */}
            <div className="w-1/3 border-r border-gray-700 p-4 flex flex-col overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-lg">Available Tools</h3>
                    <button 
                        onClick={handleCreateTool}
                        className="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-sm font-semibold"
                    >
                        + New
                    </button>
                </div>
                <ul className="space-y-2 overflow-y-auto flex-grow">
                    {tools.map(tool => (
                        <li 
                            key={tool.name} 
                            className={`p-3 rounded cursor-pointer hover:bg-gray-800 border ${selectedTool?.name === tool.name ? 'border-blue-500 bg-gray-800' : 'border-gray-800'}`}
                            onClick={() => { setSelectedTool(tool); setActiveTab("settings"); }}
                        >
                            <div className="font-semibold">{tool.name}</div>
                            <div className="text-xs text-gray-400">{tool.type}</div>
                        </li>
                    ))}
                </ul>
            </div>

            {/* Editor Area */}
            <div className="w-2/3 h-full p-6 flex flex-col overflow-y-auto bg-gray-900">
                {selectedTool ? (
                    <div key={selectedTool.name} className="flex flex-col flex-grow h-full min-h-0">
                        <div className="flex justify-between items-end mb-6 border-b border-gray-800 pb-2">
                            <h2 className="text-2xl font-bold">Edit Tool: {selectedTool.name}</h2>
                            <div className="flex space-x-4">
                                <button 
                                    className={`pb-1 font-semibold ${activeTab === 'settings' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
                                    onClick={() => setActiveTab('settings')}
                                >
                                    Settings
                                </button>
                                <button 
                                    className={`pb-1 font-semibold ${activeTab === 'code' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
                                    onClick={() => setActiveTab('code')}
                                >
                                    Code
                                </button>
                            </div>
                        </div>
                        
                        {activeTab === 'settings' && (
                            <div className="space-y-4 flex-grow overflow-y-auto">
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Description</label>
                                    <textarea 
                                        className="w-full bg-black border border-gray-700 rounded p-2 text-white h-24 font-mono text-sm" 
                                        defaultValue={selectedTool.description}
                                        onChange={(e) => {
                                            setSelectedTool({...selectedTool, description: e.target.value});
                                        }}
                                    />
                                </div>
                                
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Widget Integration</label>
                                    <select 
                                        className="w-full bg-black border border-gray-700 rounded p-2 text-white" 
                                        defaultValue={selectedTool.integration}
                                        onChange={(e) => {
                                            setSelectedTool({...selectedTool, integration: e.target.value});
                                        }}
                                    >
                                        <option value="background">Background (Silent)</option>
                                        <option value="terminal">Terminal Widget (Visible)</option>
                                        <option value="preview">Preview Widget</option>
                                        <option value="dashboard">Dashboard Widget</option>
                                    </select>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Select how this tool should interact with the user interface when executed by the AI.
                                    </p>
                                </div>
                                
                                <div className="pt-4 mt-4 border-t border-gray-800 flex justify-end gap-2">
                                    {selectedTool.type === 'dynamic' && (
                                        <button onClick={handleDelete} className="px-4 py-2 bg-red-900 hover:bg-red-800 rounded font-semibold mr-auto">Delete</button>
                                    )}
                                    <button className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded">Cancel</button>
                                    <button onClick={handleSave} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded font-semibold">Save Configuration</button>
                                </div>
                            </div>
                        )}

                        {activeTab === 'code' && (
                            <div className="grid grid-rows-[auto_1fr_auto] h-full gap-2 min-h-0">
                                <label className="text-sm font-medium text-gray-400">
                                    {selectedTool.type === 'built-in' 
                                        ? "Code (Read-only for built-in tools)" 
                                        : "Javascript Source Code"}
                                </label>
                                <textarea 
                                    className="w-full h-full bg-black border border-gray-700 rounded p-4 text-blue-300 font-mono text-sm resize-none" 
                                    defaultValue={selectedTool.code || `// Tool: ${selectedTool.name}\n// Source code is compiled in Go and cannot be modified here.`}
                                    readOnly={selectedTool.type === 'built-in'}
                                    onChange={(e) => {
                                        setSelectedTool({...selectedTool, code: e.target.value});
                                    }}
                                />
                                <div className="border-t border-gray-800 pt-4 mt-2 flex justify-end gap-2">
                                    {selectedTool.type === 'dynamic' && (
                                        <button onClick={handleDelete} className="px-4 py-2 bg-red-900 hover:bg-red-800 rounded font-semibold mr-auto">Delete</button>
                                    )}
                                    <button className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded">Cancel</button>
                                    <button 
                                        className={`px-4 py-2 rounded font-semibold ${selectedTool.type === 'built-in' ? 'bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500'}`}
                                        disabled={selectedTool.type === 'built-in'}
                                        onClick={handleSave}
                                    >
                                        Save Code
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="h-full flex items-center justify-center text-gray-500">
                        Select a tool from the left to edit its configuration and widget integrations.
                    </div>
                )}
            </div>
        </div>
    );
});
ToolsAdminView.displayName = "ToolsAdminView";
