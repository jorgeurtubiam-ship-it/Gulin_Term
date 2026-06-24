import { getApi } from "@/app/store/global";
import { fetch } from "@/util/fetchutil";
import { getWebServerEndpoint } from "@/util/endpoints";
import { atom, useAtom } from "jotai";
import { useEffect, useState } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { BlockNodeModel } from "@/app/block/blocktypes";
import { TabModel } from "@/app/store/tab-model";
import "./gulinai.scss";

interface APIEndpointInfo {
    id: string;
    name: string;
    url: string;
    username?: string;
    password?: string;
    token?: string;
    system_prompt?: string;
    knowledge_source?: string;
    created_at: number;
    updated_at: number;
}



const endpointsAtom = atom<APIEndpointInfo[]>([]);
const loadingAtom = atom<boolean>(false);


export class APIEndpointManagerViewModel implements ViewModel {
    viewType = "api-manager";
    viewComponent = APIEndpointManagerView;
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
    }

    async fetchEndpoints(setEndpoints: (val: APIEndpointInfo[]) => void, setLoading: (val: boolean) => void) {
        setLoading(true);
        try {
            const endpoint = getWebServerEndpoint();
            const headers = { "X-AuthKey": getApi().getAuthKey() };
            const resp = await fetch(`${endpoint}/gulin/api-list`, { headers });
            if (resp.ok) {
                const data = await resp.json();
                setEndpoints(data || []);
            }
        } catch (e) {
            console.error("Error fetching API endpoints", e);
        } finally {
            setLoading(false);
        }
    }

    async saveEndpoint(info: Partial<APIEndpointInfo>) {
        try {
            const endpoint = getWebServerEndpoint();
            const headers = {
                "X-AuthKey": getApi().getAuthKey(),
                "Content-Type": "application/json"
            };
            const resp = await fetch(`${endpoint}/gulin/api-register`, {
                method: "POST",
                headers,
                body: JSON.stringify(info)
            });
            if (!resp.ok) {
                const errorText = await resp.text();
                alert(`Error al guardar: ${resp.status} - ${errorText}`);
                return false;
            }
            return true;
        } catch (e) {
            console.error("Error saving API endpoint", e);
            alert(`Error de red: ${e.message}`);
            return false;
        }
    }

    async deleteEndpoint(id: string) {
        try {
            const endpoint = getWebServerEndpoint();
            const headers = {
                "X-AuthKey": getApi().getAuthKey(),
                "Content-Type": "application/json"
            };
            const resp = await fetch(`${endpoint}/gulin/api-delete`, {
                method: "POST",
                headers,
                body: JSON.stringify({ id })
            });
            if (!resp.ok) {
                const errorText = await resp.text();
                alert(`Error al eliminar: ${resp.status} - ${errorText}`);
                return false;
            }
            return true;
        } catch (e) {
            console.error("Error deleting API endpoint", e);
            alert(`Error de red: ${e.message}`);
            return false;
        }
    }
}

export function APIEndpointManagerView({ model }: { model: APIEndpointManagerViewModel }) {
    const [endpoints, setEndpoints] = useAtom(endpointsAtom);
    const [loading, setLoading] = useAtom(loadingAtom);
    const [showForm, setShowForm] = useState(false);
    const [editingEndpoint, setEditingEndpoint] = useState<Partial<APIEndpointInfo> | null>(null);

    useEffect(() => {
        model.fetchEndpoints(setEndpoints, setLoading);
    }, []);

    const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const info: Partial<APIEndpointInfo> = {
            id: editingEndpoint?.id,
            name: formData.get("name") as string,
            url: formData.get("url") as string,
            username: formData.get("username") as string,
            password: formData.get("password") as string,
            token: formData.get("token") as string,
            system_prompt: formData.get("system_prompt") as string,
            knowledge_source: formData.get("knowledge_source") as string,
            auth_instructions: formData.get("auth_instructions") as string,
        };



        const success = await model.saveEndpoint(info);
        if (success) {
            setShowForm(false);
            setEditingEndpoint(null);
            model.fetchEndpoints(setEndpoints, setLoading);
        }
    };

    return (
        <div className="db-connections-view bg-[#1a1a1a] h-full w-full flex flex-col text-slate-200 font-sans selection:bg-purple-500/30">
            <div className="p-6 border-b border-white/5 bg-gradient-to-r from-purple-900/10 to-transparent">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                            <i className="fa fa-key text-purple-400"></i>
                            AI API Manager
                        </h2>
                        <p className="text-xs text-slate-400 mt-1 uppercase tracking-widest font-semibold">Configuración de Endpoints</p>
                    </div>
                    <button
                        onClick={() => { setShowForm(true); setEditingEndpoint(null); }}
                        className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg shadow-purple-900/20 flex items-center gap-2 active:scale-95"
                    >
                        <i className="fa fa-plus"></i> Añadir
                    </button>
                </div>
            </div>

            <OverlayScrollbarsComponent className="flex-1" options={{ scrollbars: { autoHide: "leave" } }}>
                <div className="p-6 space-y-4">
                    {loading && (
                        <div className="flex flex-col items-center justify-center py-20 text-purple-400/50">
                            <div className="animate-spin mb-4"><i className="fa fa-circle-notch fa-2x"></i></div>
                            <span className="text-sm font-medium animate-pulse">Cargando endpoints...</span>
                        </div>
                    )}

                    {!loading && endpoints.length === 0 && !showForm && (
                        <div className="text-center py-20 bg-white/5 rounded-2xl border border-dashed border-white/10">
                            <i className="fa fa-plug fa-3x text-slate-600 mb-4"></i>
                            <h3 className="text-lg font-medium text-white">No hay APIs registradas</h3>
                            <p className="text-sm text-slate-400 mt-2">Registra tu primera URL de API para comenzar.</p>
                        </div>
                    )}

                    {!loading && (
                        <div className="grid gap-4">
                            {endpoints.map((ep) => (
                                <div key={ep.id} className="group bg-white/5 hover:bg-white/[0.08] p-5 rounded-2xl border border-white/5 transition-all hover:border-purple-500/30 hover:shadow-2xl hover:shadow-purple-900/10 relative overflow-hidden">
                                    <div className="flex justify-between items-start relative z-10">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-2">
                                                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400 group-hover:bg-purple-500 group-hover:text-white transition-colors shadow-inner">
                                                    <i className="fa fa-plug text-lg"></i>
                                                </div>
                                                <h3 className="text-lg font-bold text-white group-hover:text-purple-300 transition-colors">{ep.name}</h3>
                                            </div>
                                            <div className="space-y-2 mt-4">
                                                <div className="flex items-center gap-2 text-xs text-slate-400 font-mono bg-black/20 p-2 rounded-lg border border-white/5 truncate">
                                                    <i className="fa fa-link text-purple-500/50"></i>
                                                    {ep.url}
                                                </div>
                                                {ep.system_prompt && (
                                                    <p className="text-xs text-slate-400 line-clamp-2 italic leading-relaxed border-l-2 border-purple-500/30 pl-3 py-1">
                                                        "{ep.system_prompt}"
                                                    </p>
                                                )}
                                                {ep.auth_instructions && (
                                                    <div className="flex items-center gap-2 text-[10px] text-purple-300 font-bold uppercase tracking-tighter bg-purple-500/10 p-1.5 rounded-md border border-purple-500/20">
                                                        <i className="fa fa-key"></i>
                                                        Auth: {ep.auth_instructions}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => { setEditingEndpoint(ep); setShowForm(true); }}
                                                className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors"
                                                title="Editar"
                                            >
                                                <i className="fa fa-edit"></i>
                                            </button>
                                            <button
                                                onClick={async () => {
                                                    if (window.confirm(`¿Estás seguro de que deseas eliminar la configuración de "${ep.name}"?`)) {
                                                        const success = await model.deleteEndpoint(ep.id);
                                                        if (success) {
                                                            model.fetchEndpoints(setEndpoints, setLoading);
                                                        }
                                                    }
                                                }}
                                                className="p-2 hover:bg-red-500/20 rounded-lg text-slate-400 hover:text-red-400 transition-colors"
                                                title="Eliminar"
                                            >
                                                <i className="fa fa-trash"></i>
                                            </button>
                                        </div>
                                    </div>
                                    <div className="absolute -right-8 -bottom-8 text-white/[0.02] text-8xl transition-all group-hover:text-white/[0.05] group-hover:scale-110">
                                        <i className="fa fa-plug"></i>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </OverlayScrollbarsComponent>

            {showForm && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-[#2a2a2a] w-full max-w-md rounded-3xl border border-white/10 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
                        <div className="p-6 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-purple-900/20 to-transparent">
                            <h3 className="text-xl font-bold text-white flex items-center gap-3">
                                <i className="fa fa-plug text-purple-400"></i>
                                {editingEndpoint ? "Editar API" : "Nueva API"}
                            </h3>
                            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white transition-colors p-2 hover:bg-white/5 rounded-full"><i className="fa fa-times text-lg"></i></button>
                        </div>
                        <form onSubmit={handleSave} className="p-8 space-y-5">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">Nombre Descriptivo</label>
                                <input name="name" defaultValue={editingEndpoint?.name} required placeholder="Ej. DeepSeek Local / OpenAI Proxy" className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40 focus:border-purple-500/40 transition-all font-medium" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">URL del Endpoint</label>
                                <input name="url" defaultValue={editingEndpoint?.url} required placeholder="https://api.ejemplo.com/v1" className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40 transition-all font-mono text-sm" />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">Usuario (Opcional)</label>
                                    <input name="username" defaultValue={editingEndpoint?.username} placeholder="admin" className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40 transition-all font-medium" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">Password (Opcional)</label>
                                    <input name="password" type="password" defaultValue={editingEndpoint?.password} placeholder="••••••••" className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40 transition-all font-medium" />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">API Token (Opcional)</label>
                                <input name="token" defaultValue={editingEndpoint?.token} placeholder="sk-..." className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40 transition-all font-mono text-xs" />
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">Identidad Corporativa (System Prompt)</label>
                                <textarea name="system_prompt" defaultValue={editingEndpoint?.system_prompt} rows={3} placeholder="Ej. Eres el asistente experto de Logística Express. Tu tono es..." className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40 transition-all text-sm resize-none" />
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">Fuentes de Conocimiento (Web/Docs)</label>
                                <input name="knowledge_source" defaultValue={editingEndpoint?.knowledge_source} placeholder="https://mi-empresa.com/docs" className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40 transition-all text-sm" />
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">Instrucciones de Login (Ruta/Ticket)</label>
                                <input name="auth_instructions" defaultValue={editingEndpoint?.auth_instructions} placeholder="P. ej: /apiv2/login o {{username}}" className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40 transition-all text-sm" />
                            </div>

                            <div className="pt-4 flex gap-3">
                                <button type="submit" className="flex-1 bg-purple-600 hover:bg-purple-550 text-white font-bold py-3.5 rounded-xl transition-all shadow-xl shadow-purple-900/20 active:scale-[0.98]">
                                    Guardar Configuración
                                </button>
                                <button type="button" onClick={() => setShowForm(false)} className="bg-white/5 hover:bg-white/10 text-white font-bold px-6 py-3.5 rounded-xl transition-all active:scale-[0.98]">
                                    Cancelar
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

// Ensure unique export
export const APIEndpointManagerViewModel_Prop = APIEndpointManagerViewModel;
