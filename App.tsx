
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './lib/supabase';
import { projectsService } from './lib/projectsService';
import { PromptEntry, Status, LocalProject, ProjectStatus, VirtualFile } from './types';
import JSZip from 'jszip';
import { 
  Database, 
  History, 
  AlertCircle, 
  Loader2,
  Terminal,
  RefreshCcw,
  Edit3,
  Package,
  Play,
  Square,
  ExternalLink,
  LayoutDashboard,
  Code2,
  FileJson,
  Search,
  Globe
} from 'lucide-react';

// Componente de item de histórico robusto
const HistoryItem: React.FC<{ entry: PromptEntry; isCurrent: boolean }> = ({ entry, isCurrent }) => {
  // Garantimos que os valores renderizados sejam strings ou números para evitar Erro #31
  const mensagem = typeof entry.mensagem === 'string' ? entry.mensagem : JSON.stringify(entry.mensagem);
  const id = String(entry.id);
  const data = new Date(entry.created_at).toLocaleString('pt-BR');

  return (
    <div className={`bg-white/5 border rounded-xl p-4 mb-3 transition-all hover:bg-white/10 ${isCurrent ? 'border-indigo-500/40 bg-indigo-500/5' : 'border-white/5'}`}>
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-indigo-400 font-bold">#{id}</span>
          {isCurrent && (
            <span className="text-[8px] bg-indigo-600 text-white px-1.5 py-0.5 rounded-full uppercase font-black tracking-tighter">
              Sua Sessão
            </span>
          )}
        </div>
        <span className="text-[10px] text-gray-600 font-medium">{data}</span>
      </div>
      <p className="text-gray-300 text-sm whitespace-pre-wrap line-clamp-4 leading-relaxed">{mensagem}</p>
    </div>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'logger' | 'projects'>('logger');
  const [isInitializing, setIsInitializing] = useState(true);
  
  // State: Logger
  const [prompt, setPrompt] = useState('');
  const [dbStatus, setDbStatus] = useState<Status>(Status.IDLE);
  const [history, setHistory] = useState<PromptEntry[]>([]);
  
  // Session ID persistente
  const [sessionId] = useState(() => {
    try {
      const saved = localStorage.getItem('prompt_session_id');
      if (saved) return saved;
      const newId = `sess-${Math.random().toString(36).substring(2, 11)}`;
      localStorage.setItem('prompt_session_id', newId);
      return newId;
    } catch (e) {
      return "sess-fallback";
    }
  });

  // State: Projects
  const [projects, setProjects] = useState<LocalProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<LocalProject | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('prompts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
      if (!error && data) setHistory(data);
    } catch (e) {
      console.error("Erro ao buscar histórico:", e);
    }
  }, []);

  const refreshProjectList = useCallback(async () => {
    setIsLoadingList(true);
    setApiError(null);
    try {
      const remote = await projectsService.listProjects();
      const mapped = (remote || []).map(p => ({
        id: String(p.id),
        name: `Project #${p.id}`,
        files: p.files || [],
        status: 'available' as ProjectStatus,
        logs: [`Projeto sincronizado e pronto.`]
      }));
      setProjects(mapped);
    } catch (e: any) {
      setApiError("A API de Projetos (ngrok) parece estar offline.");
    } finally {
      setIsLoadingList(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      // Usamos Promise.allSettled para garantir que o app carregue mesmo se um serviço falhar
      await Promise.allSettled([fetchHistory(), refreshProjectList()]);
      setIsInitializing(false);
    };
    init();
  }, [fetchHistory, refreshProjectList]);

  // Auto-scroll para logs
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [selectedProject?.logs]);

  const handlePromptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setDbStatus(Status.LOADING);
    try {
      // Tenta atualizar se já existir na sessão, senão insere novo
      const { data: existing } = await supabase
        .from('prompts')
        .select('id')
        .eq('session_id', sessionId)
        .maybeSingle();

      const res = existing 
        ? await supabase.from('prompts').update({ mensagem: prompt, created_at: new Date().toISOString() }).eq('id', existing.id)
        : await supabase.from('prompts').insert({ mensagem: prompt, session_id: sessionId });

      if (res.error) throw res.error;
      
      setDbStatus(Status.SUCCESS);
      fetchHistory();
      setTimeout(() => setDbStatus(Status.IDLE), 3000);
    } catch (err) {
      console.error("Erro Supabase:", err);
      setDbStatus(Status.ERROR);
      setTimeout(() => setDbStatus(Status.IDLE), 4000);
    }
  };

  const handleRunProject = async (project: LocalProject) => {
    if (!project.files || project.files.length === 0) return;
    const fileName = project.files[0];
    
    const updateLocal = (partial: Partial<LocalProject>) => {
      setProjects(prev => prev.map(p => p.id === project.id ? { ...p, ...partial, logs: partial.logs ? [...p.logs, ...partial.logs] : p.logs } : p));
      setSelectedProject(prev => prev?.id === project.id ? { ...prev, ...partial, logs: partial.logs ? [...prev.logs, ...partial.logs] : prev.logs } : prev);
    };

    try {
      updateLocal({ status: 'downloading', logs: [`> Baixando pacote: ${fileName}`] });
      const blob = await projectsService.downloadZip(project.id, fileName);
      
      updateLocal({ status: 'extracting', logs: [`> ZIP recebido (${(blob.size / 1024).toFixed(1)} KB). Extraindo...`] });
      const zip = await JSZip.loadAsync(blob);
      
      const fs: Record<string, VirtualFile> = {};
      const filePromises: Promise<void>[] = [];
      
      zip.forEach((path, file) => {
        if (!file.dir) {
          filePromises.push(file.async('string').then(content => {
            fs[path] = { path, content, type: 'text' };
          }));
        }
      });
      
      await Promise.all(filePromises);
      
      const indexKey = Object.keys(fs).find(k => k.toLowerCase().endsWith('index.html'));
      if (!indexKey) throw new Error("Arquivo 'index.html' não encontrado no ZIP.");

      const htmlContent = fs[indexKey].content as string;
      const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
      const previewUrl = URL.createObjectURL(htmlBlob);
      
      updateLocal({ status: 'running', previewUrl, logs: [`> Executando sandbox em ambiente virtual.`] });
    } catch (e: any) {
      updateLocal({ status: 'error', logs: [`! ERRO: ${e.message}`] });
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a] text-gray-100">
      <nav className="bg-black/80 border-b border-white/5 px-6 py-4 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-lg shadow-lg shadow-indigo-600/20">
              <Code2 className="text-white w-5 h-5" />
            </div>
            <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white to-gray-500 bg-clip-text text-transparent">
              DevHub ZIP
            </span>
          </div>
          <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
            <button 
              onClick={() => setActiveTab('logger')} 
              className={`px-5 py-2 rounded-lg text-xs font-bold transition-all uppercase tracking-widest ${activeTab === 'logger' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
            >
              Logger
            </button>
            <button 
              onClick={() => setActiveTab('projects')} 
              className={`px-5 py-2 rounded-lg text-xs font-bold transition-all uppercase tracking-widest ${activeTab === 'projects' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'}`}
            >
              Projetos
            </button>
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-7xl mx-auto w-full p-6 relative">
        {isInitializing && (
          <div className="absolute inset-x-0 top-0 h-0.5 bg-indigo-500/10 overflow-hidden z-50">
            <div className="w-1/4 h-full bg-indigo-500 animate-[loading_2s_infinite]" />
          </div>
        )}

        {activeTab === 'logger' ? (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 animate-in fade-in duration-700">
            <div className="lg:col-span-3">
              <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-8 shadow-2xl backdrop-blur-sm relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Database size={120} />
                </div>
                
                <form onSubmit={handlePromptSubmit} className="relative z-10">
                  <div className="flex items-center justify-between mb-6">
                    <label className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.3em]">
                      Entrada de Mensagem
                    </label>
                    <div className="flex items-center gap-2 text-[9px] text-gray-600 font-mono">
                      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      SUPABASE CONNECTED
                    </div>
                  </div>

                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-2xl p-6 text-white min-h-[400px] focus:ring-1 focus:ring-indigo-500 outline-none font-mono text-sm leading-relaxed transition-all placeholder:text-gray-800"
                    placeholder="Cole seu prompt ou código aqui para salvar no banco de dados..."
                  />

                  <button
                    type="submit"
                    disabled={dbStatus === Status.LOADING || !prompt.trim()}
                    className="w-full mt-6 py-5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-white/5 disabled:text-gray-700 text-white font-black rounded-2xl flex items-center justify-center gap-3 transition-all shadow-xl shadow-indigo-600/10 active:scale-[0.98] uppercase text-xs tracking-widest"
                  >
                    {dbStatus === Status.LOADING ? (
                      <Loader2 className="animate-spin" size={20} />
                    ) : (
                      <>
                        <RefreshCcw size={18} />
                        Sincronizar com Supabase
                      </>
                    )}
                  </button>

                  <div className="mt-4 h-6 text-center">
                    {dbStatus === Status.ERROR && <span className="text-red-500 text-[10px] font-bold uppercase tracking-widest">Erro na transação. Verifique a rede.</span>}
                    {dbStatus === Status.SUCCESS && <span className="text-green-500 text-[10px] font-bold uppercase tracking-widest">Sincronizado com sucesso!</span>}
                  </div>
                </form>
              </div>
            </div>

            <div className="lg:col-span-2">
              <div className="flex items-center justify-between mb-6 px-2">
                <h2 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.3em] flex items-center gap-2">
                  <History size={14} className="text-indigo-500" /> Histórico Recente
                </h2>
                <button onClick={fetchHistory} className="text-gray-600 hover:text-white transition-colors">
                  <RefreshCcw size={14} />
                </button>
              </div>
              <div className="space-y-4 max-h-[650px] overflow-y-auto pr-3 custom-scrollbar">
                {history.length === 0 && !isInitializing && (
                  <div className="text-center py-20 bg-white/[0.01] border border-dashed border-white/5 rounded-3xl">
                    <p className="text-gray-700 text-xs uppercase font-bold">Nenhum registro</p>
                  </div>
                )}
                {history.map(item => (
                  <HistoryItem key={String(item.id)} entry={item} isCurrent={item.session_id === sessionId} />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-[calc(100vh-180px)] animate-in fade-in duration-700">
            {/* Sidebar de Projetos */}
            <div className="lg:col-span-3 flex flex-col gap-6 overflow-hidden">
              <div className="flex items-center justify-between px-2">
                <h2 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.3em]">ZIP Repo</h2>
                <button onClick={refreshProjectList} disabled={isLoadingList} className="text-gray-600 hover:text-white p-1">
                  <RefreshCcw size={14} className={isLoadingList ? 'animate-spin' : ''} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto pr-3 space-y-4 custom-scrollbar">
                {apiError && (
                  <div className="p-5 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-[10px] font-bold flex flex-col items-center text-center gap-3">
                    <AlertCircle size={20} />
                    {apiError}
                  </div>
                )}
                
                {projects.map(proj => (
                  <div 
                    key={proj.id} 
                    onClick={() => setSelectedProject(proj)}
                    className={`p-5 rounded-2xl border transition-all cursor-pointer group relative ${selectedProject?.id === proj.id ? 'bg-indigo-600/10 border-indigo-500' : 'bg-white/[0.02] border-white/5 hover:border-white/20'}`}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className={`p-2.5 rounded-xl ${proj.status === 'running' ? 'bg-green-500/20 text-green-400' : 'bg-indigo-500/10 text-indigo-400'}`}>
                        <Package size={20} />
                      </div>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleRunProject(proj); }}
                        disabled={proj.status === 'running' || proj.status === 'downloading'}
                        className="p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-500 transition-all disabled:opacity-10 active:scale-90 shadow-lg shadow-indigo-600/20"
                      >
                        <Play size={14} fill="currentColor" />
                      </button>
                    </div>
                    <h3 className="font-bold text-sm truncate text-white/90">Projeto #{proj.id}</h3>
                    <p className="text-[9px] uppercase tracking-widest text-gray-600 mt-2 font-black">{proj.status}</p>
                  </div>
                ))}
                
                {!isLoadingList && projects.length === 0 && !apiError && (
                  <div className="text-center py-20 text-gray-800">
                    <Package size={32} className="mx-auto mb-3 opacity-20" />
                    <p className="text-[10px] uppercase font-bold tracking-widest">Vazio</p>
                  </div>
                )}
              </div>
            </div>

            {/* Preview Section */}
            <div className="lg:col-span-9 flex flex-col gap-6">
              {selectedProject ? (
                <>
                  <div className="flex-1 bg-white rounded-3xl overflow-hidden relative border border-white/10 shadow-2xl flex flex-col">
                    <div className="bg-black/95 border-b border-white/10 px-6 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-red-500" />
                        <div className="w-2 h-2 rounded-full bg-yellow-500" />
                        <div className="w-2 h-2 rounded-full bg-green-500" />
                        <span className="text-[10px] text-gray-500 font-mono ml-4 uppercase tracking-widest">Sandboxed-Environment-V1</span>
                      </div>
                      <div className="flex gap-2">
                        {selectedProject.previewUrl && (
                          <a href={selectedProject.previewUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[10px] bg-white/5 hover:bg-white/10 px-4 py-1.5 rounded-xl text-gray-300 transition-all border border-white/10 font-bold">
                            <ExternalLink size={12} /> VER TELA CHEIA
                          </a>
                        )}
                        <button onClick={() => setSelectedProject(null)} className="p-1.5 hover:bg-white/10 rounded-xl text-gray-600 transition-colors">
                          <Square size={14} />
                        </button>
                      </div>
                    </div>
                    
                    <div className="flex-1 bg-white relative">
                      {selectedProject.previewUrl ? (
                        <iframe 
                          src={selectedProject.previewUrl} 
                          className="w-full h-full border-none"
                          title="Sandboxed Project Preview"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-[#0c0c0c] flex flex-col items-center justify-center text-center p-12">
                          <div className="p-6 bg-white/[0.02] rounded-full mb-6 border border-white/5 animate-pulse">
                            <LayoutDashboard size={48} className="text-indigo-500/40" />
                          </div>
                          <h3 className="text-white font-bold text-lg mb-2">Ambiente Preparado</h3>
                          <p className="text-gray-600 text-xs uppercase tracking-widest">Clique no botão play para iniciar a renderização</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Console Minimalista */}
                  <div className="h-40 bg-black/95 border border-white/5 rounded-3xl p-6 font-mono text-[10px] overflow-y-auto custom-scrollbar shadow-2xl">
                    <div className="flex items-center gap-3 text-indigo-400/80 mb-4 border-b border-white/5 pb-2 uppercase font-black tracking-widest text-[9px]">
                      <Terminal size={12} /> System Console Output
                    </div>
                    {selectedProject.logs.map((log, i) => (
                      <div key={i} className="mb-2 flex gap-3 animate-in fade-in slide-in-from-left-2">
                        <span className="text-gray-800 shrink-0 font-bold">{new Date().toLocaleTimeString()}</span>
                        <span className={`${log.startsWith('!') ? 'text-red-500 font-bold' : 'text-gray-500'}`}>
                          {typeof log === 'string' ? log : JSON.stringify(log)}
                        </span>
                      </div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </>
              ) : (
                <div className="flex-1 border-2 border-dashed border-white/5 rounded-[40px] flex flex-col items-center justify-center text-center p-20 bg-white/[0.01] group hover:border-indigo-500/20 transition-all">
                   <div className="p-8 bg-white/[0.02] rounded-full mb-8 border border-white/5 group-hover:scale-110 transition-transform duration-500">
                     <Package size={64} className="text-white/5 group-hover:text-indigo-500/20 transition-colors" />
                   </div>
                   <h4 className="text-white font-black text-xl mb-3 tracking-tight">Virtual ZIP Previewer</h4>
                   <p className="text-gray-700 text-xs uppercase tracking-[0.4em] max-w-xs leading-relaxed">Selecione um pacote da lista lateral para visualizar em tempo real</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="bg-black/80 border-t border-white/5 px-8 py-3 flex justify-between text-[10px] text-gray-700 font-mono backdrop-blur-md">
        <div className="flex gap-6">
          <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-indigo-500" /> SUPABASE_CLUSTER_ACTIVE</div>
          <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-indigo-500" /> NGROK_TUNNEL_ESTABLISHED</div>
        </div>
        <div className="font-black text-indigo-900/40 uppercase tracking-widest">Engine Build v2.6.0-stable</div>
      </footer>

      <style>{`
        @keyframes loading { from { transform: translateX(-100%); } to { transform: translateX(400%); } }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(99, 102, 241, 0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(99, 102, 241, 0.4); }
      `}</style>
    </div>
  );
}
