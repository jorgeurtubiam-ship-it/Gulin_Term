import React, { useState } from "react";
import { Modal } from "../modal";
import { atoms } from "../../store/global";
import { useAtomValue } from "jotai";

export function ToolsAdminModal() {
    // For now, always show if rendered, or handle visibility via generic modal state
    const [selectedTool, setSelectedTool] = useState<any>(null);

    // Complete list of built-in tools based on agents.go
    const tools = [
        { name: "term_run_and_wait", type: "built-in", integration: "terminal", description: "Execute a command in the specified terminal widget and wait for it to complete" },
        { name: "term_run_command", type: "built-in", integration: "terminal", description: "Execute a command in the terminal asynchronously" },
        { name: "term_command_output", type: "built-in", integration: "background", description: "Get the output of a running terminal command" },
        { name: "apimanager_call", type: "built-in", integration: "background", description: "Call an API endpoint" },
        { name: "apimanager_list", type: "built-in", integration: "background", description: "List available API endpoints" },
        { name: "db_query", type: "built-in", integration: "background", description: "Execute a database query" },
        { name: "read_text_file", type: "built-in", integration: "background", description: "Read contents of a text file" },
        { name: "write_text_file", type: "built-in", integration: "background", description: "Write contents to a text file" },
        { name: "web_navigate", type: "built-in", integration: "preview", description: "Navigate to a URL in the browser" },
        { name: "web_read_page", type: "built-in", integration: "background", description: "Read content from a web page" },
        { name: "brain_register_node", type: "built-in", integration: "dashboard", description: "Register a memory node in the Brain Map" },
        { name: "plugin_save", type: "built-in", integration: "background", description: "Save a new dynamic plugin" },
    ];

    return (
        <Modal className="tools-admin-modal" title="Tools Administration">
            <div className="flex h-[600px] w-[900px] text-white">
                {/* Sidebar list */}
                <div className="w-1/3 border-r border-gray-700 p-4 overflow-y-auto">
                    <h3 className="font-bold mb-4 text-lg">Available Tools</h3>
                    <ul className="space-y-2">
                        {tools.map(tool => (
                            <li 
                                key={tool.name} 
                                className={`p-3 rounded cursor-pointer hover:bg-gray-800 border ${selectedTool?.name === tool.name ? 'border-blue-500 bg-gray-800' : 'border-gray-800'}`}
                                onClick={() => setSelectedTool(tool)}
                            >
                                <div className="font-semibold">{tool.name}</div>
                                <div className="text-xs text-gray-400">{tool.type}</div>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Editor Area */}
                <div className="w-2/3 p-6 overflow-y-auto bg-gray-900">
                    {selectedTool ? (
                        <div>
                            <h2 className="text-2xl font-bold mb-6">Edit Tool: {selectedTool.name}</h2>
                            
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Description</label>
                                    <textarea 
                                        className="w-full bg-black border border-gray-700 rounded p-2 text-white h-24" 
                                        defaultValue={selectedTool.description}
                                    />
                                </div>
                                
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Widget Integration</label>
                                    <select className="w-full bg-black border border-gray-700 rounded p-2 text-white" defaultValue={selectedTool.integration}>
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
                                    <button className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded">Cancel</button>
                                    <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded font-semibold">Save Configuration</button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex items-center justify-center text-gray-500">
                            Select a tool from the left to edit its configuration and widget integrations.
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
}
