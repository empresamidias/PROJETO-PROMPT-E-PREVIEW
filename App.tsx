
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

// --- Componentes de Apoio ---

const HistoryItem: React.FC<{ entry: PromptEntry; isCurrent: boolean }> = ({ entry, isCurrent }) => (
  <div className={`bg-white/5 border rounded-lg p-4 mb-3 transition-all hover:bg-white/10 ${isCurrent ? 'border-indigo-500/50 bg-indigo-500/5' : 'border-white/10'}`}>
    <div className="flex justify-between items-start mb-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-blue-400">ID: {entry.id}</span>
        {isCurrent && <span className="text-[9px] bg-indigo-500 text-white px-1.5 rounded-full uppercase font-bold tracking-tighter">Sessão</span>}
      </div>
      <span className="text-xs text-gray-500">{new Date(entry.created_at).toLocaleString('pt-BR')}</span>
    </div>
    <p className="text-gray-300 text-sm whitespace-pre-wrap line-clamp-3">{entry.mensagem}</p>
  </div>
);

export default function App() {
  const [activeTab, setActiveTab] = useState<'logger' | 'projects'>('logger');
  
  // State: Logger
  const [prompt, setPrompt] = useState('');
  const [dbStatus, setDbStatus] = useState<Status>(Status.IDLE);
  const [history, setHistory] = useState<PromptEntry[]>([]);
  
  // Session ID com fallback seguro
  const [sessionId] = useState(() => {
    try {
      const saved = localStorage.getItem('prompt_session_id');
      if (saved) return saved;
      const newId = (typeof crypto !== 'undefined' && crypto.randomUUID) 
        ? crypto.randomUUID() 
        : Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
      localStorage.setItem('prompt_session_id', newId);
      return newId;
    } catch (e) {
      return "sessao-" + Date.now();
    }
  });

  // State: Projects
  const [projects, setProjects] = useState<LocalProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<LocalProject | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // --- Logger Logic ---

  const fetchHistory = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('prompts').select('*').order('created_at', { ascending: false }).limit(10);
      if (!error && data) setHistory(data);
    } catch (e) { 
      console.error("Erro ao buscar histórico:", e); 
    }
  }, []);

  const handlePromptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    setDbStatus(Status.LOADING);
    try {
      const { data: existing } = await supabase.from('prompts').select('id').eq('session_id', sessionId).maybeSingle();
      const res = existing 
        ? await supabase.from('prompts').update({ mensagem: prompt, created_at: new Date().toISOString() }).eq('id', existing.id)
        : await supabase.from('prompts').insert({ mensagem: prompt, session_id: sessionId });
      if (res.error) throw res.error;
      setDbStatus(Status.SUCCESS);
      fetchHistory();
      setTimeout(() => setDbStatus(Status.IDLE), 2000);
    } catch (err) { 
      console.error("Erro ao salvar prompt:", err);
      setDbStatus(Status.ERROR); 
    }
  };

  // --- Projects Logic ---

  const refreshProjectList = useCallback(async () => {
    setIsLoadingList(true);
    setApiError(null);
    try {
      const remote = await projectsService.listProjects();
      const mapped = remote.map(p => ({
        id: p.id,
        name: `Project #${p.id}`,
        files: p.files,
        status: 'available' as ProjectStatus,
        logs: [`Projeto sincronizado da API remota.`]
      }));
      setProjects(mapped);
    } catch (e: any) {
      setApiError("Não foi possível conectar à API de projetos. Verifique o servidor.");
    } finally {
      setIsLoadingList(false);
    }
  }, []);

  useEffect(() => {
    refreshProjectList();
    fetchHistory();
  }, [refreshProjectList, fetchHistory]);

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [selectedProject?.logs]);

  const handleRunProject = async (project: LocalProject) => {
    if (project.files.length === 0) return;
    const fileName = project.files[0];
    
    const update = (partial: Partial<LocalProject>) => {
      setProjects(prev => prev.map(p => p.id === project.id ? { ...p, ...partial, logs: partial.logs ? [...p.logs, ...partial.logs] : p.logs } : p));
      setSelectedProject(prev => prev?.id === project.id ? { ...prev, ...partial, logs: partial.logs ? [...prev.logs, ...partial.logs] : prev.logs } : prev);
    };

    try {
      update({ status: 'downloading', logs: [`> Baixando arquivo: ${fileName}...`] });
      const blob = await projectsService.downloadZip(project.id, fileName);
      
      update({ status: 'extracting', logs: [`> ZIP recebido. Iniciando extração...`] });
      const zip = await JSZip.loadAsync(blob);
      const fs: Record<string, VirtualFile> = {};
      
      const filePromises: Promise<void>[] = [];
      zip.forEach((path, file) => {
        if (!file.dir) {
          filePromises.push(
            file.async('string').then(content => {
              fs[path] = { path, content, type: 'text' };
            })
          );
        }
      });
      await Promise.all(filePromises);

      update({ status: 'validating', logs: [`> Validando estrutura (Vite/React)...`], fileSystem: fs });
      
      const hasIndex = Object.keys(fs).some(k => k.endsWith('index.html'));
      const hasPackage = Object.keys(fs).some(k => k.endsWith('package.json'));

      if (!hasIndex || !hasPackage) throw new Error("Estrutura ZIP inválida.");

      const indexKey = Object.keys(fs).find(k => k.endsWith('index.html'))!;
      const indexContent = fs[indexKey].content as string;
      const htmlBlob = new Blob([indexContent], { type: 'text/html' });
      const previewUrl = URL.createObjectURL(htmlBlob);

      update({ status: 'running', previewUrl, logs: [`> Renderizando preview via BlobURL.`, `> Sucesso.`] });
    } catch (e: any) {
      update({ status: 'error', logs: [`! ERRO: ${e.message}`] });
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a] text-gray-100 selection:bg-indigo-500/30">
      <nav className="bg-black/60 border-b border-white/5 px-6 py-4 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-lg shadow-lg shadow-indigo-600/20">
              <Code2 className="text-white w-5 h-5" />
            </div>
            <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white to-gray-500 bg-clip-text text-transparent">
              DevHub ZIP Preview
            </span>
          </div>
          <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
            <button 
              onClick={() => setActiveTab('logger')}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${activeTab === 'logger' ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-600/20' : 'text-gray-400 hover:text-white'}`}
            >
              <Database size={16} /> Logger
            </button>
            <button 
              onClick={() => setActiveTab('projects')}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${activeTab === 'projects' ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-600/20' : 'text-gray-400 hover:text-white'}`}
            >
              <Package size={16} /> Projetos
            </button>
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-7xl mx-auto w-full p-6">
        {activeTab === 'logger' ? (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="lg:col-span-3">
              <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 shadow-2xl relative overflow-hidden backdrop-blur-sm">
                <form onSubmit={handlePromptSubmit}>
                  <div className="flex justify-between items-center mb-4">
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] flex items-center gap-2">
                      <Edit3 size={12} className="text-indigo-400" /> Editor de Prompt
                    </label>
                  </div>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl p-5 text-white min-h-[400px] focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all font-mono text-sm leading-relaxed placeholder-gray-700 custom-scrollbar"
                    placeholder="Escreva seu prompt aqui..."
                  />
                  <button
                    type="submit"
                    disabled={dbStatus === Status.LOADING || !prompt.trim()}
                    className="w-full mt-4 py-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-white/5 disabled:text-gray-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-xl shadow-indigo-600/10 active:scale-[0.98]"
                  >
                    {dbStatus === Status.LOADING ? <Loader2 className="animate-spin" /> : <RefreshCcw size={18} />}
                    Sincronizar no Supabase
                  </button>
                </form>
              </div>
            </div>
            <div className="lg:col-span-2">
              <h2 className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2 px-2">
                <History size={14} /> Histórico Global
              </h2>
              <div className="space-y-3 overflow-y-auto max-h-[640px] pr-2 custom-scrollbar">
                {history.map(item => <HistoryItem key={item.id} entry={item} isCurrent={item.session_id === sessionId} />)}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-160px)]">
            <div className="lg:col-span-3 flex flex-col gap-4 overflow-hidden">
              <div className="flex items-center justify-between px-2">
                <h2 className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em]">Repositório</h2>
                <button onClick={refreshProjectList} disabled={isLoadingList} className="text-gray-500 hover:text-white transition-colors p-1">
                  <RefreshCcw size={14} className={isLoadingList ? 'animate-spin' : ''} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                {apiError && (
                  <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-[10px] font-medium">
                    <AlertCircle size={14} className="mb-1" />
                    {apiError}
                  </div>
                )}
                {projects.map(proj => (
                  <div 
                    key={proj.id} 
                    onClick={() => setSelectedProject(proj)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer group relative overflow-hidden ${selectedProject?.id === proj.id ? 'bg-indigo-600/10 border-indigo-500' : 'bg-white/[0.02] border-white/5 hover:border-white/10'}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className={`p-2 rounded-lg ${proj.status === 'running' ? 'bg-green-500/10 text-green-400' : 'bg-indigo-500/10 text-indigo-400'}`}>
                        <Package size={18} />
                      </div>
                      {proj.status === 'downloading' && <Loader2 size={12} className="animate-spin text-indigo-400" />}
                    </div>
                    <h3 className="font-bold text-xs truncate mb-1">ID: {proj.id}</h3>
                    <div className="mt-4 flex items-center justify-between">
                      <span className={`text-[8px] uppercase font-black px-2 py-0.5 rounded-full ${proj.status === 'running' ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-gray-600'}`}>
                        {proj.status}
                      </span>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleRunProject(proj); }}
                        disabled={proj.status === 'running' || proj.status === 'downloading'}
                        className="p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-all disabled:opacity-20 active:scale-90"
                      >
                        <Play size={14} fill="currentColor" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-9 flex flex-col gap-6">
              {selectedProject ? (
                <>
                  <div className="flex-1 bg-black/40 border border-white/10 rounded-2xl overflow-hidden relative shadow-2xl flex flex-col">
                    <div className="bg-white/[0.02] border-b border-white/10 px-4 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <FileJson size={14} className="text-indigo-400" />
                        <span className="text-[10px] text-gray-400 font-mono font-bold tracking-widest uppercase">Preview Sandbox</span>
                      </div>
                      <div className="flex gap-2">
                        {selectedProject.previewUrl && (
                          <a href={selectedProject.previewUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[10px] bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg text-gray-300 transition-all border border-white/10 font-bold">
                            <ExternalLink size={12} /> Abrir
                          </a>
                        )}
                        <button onClick={() => setSelectedProject(null)} className="p-1.5 hover:bg-white/10 rounded-lg text-gray-500">
                          <Square size={14} />
                        </button>
                      </div>
                    </div>
                    
                    <div className="flex-1 bg-white relative">
                      {selectedProject.status === 'running' && selectedProject.previewUrl ? (
                        <iframe src={selectedProject.previewUrl} className="w-full h-full border-none" title="Preview" />
                      ) : (
                        <div className="absolute inset-0 bg-[#0c0c0c] flex flex-col items-center justify-center text-center p-8">
                          <LayoutDashboard size={48} className="text-white/10 mb-6" />
                          <h3 className="text-white font-bold mb-2">Aguardando Execução</h3>
                          <p className="text-gray-500 text-xs max-w-sm mb-6">Status: {selectedProject.status}</p>
                          {selectedProject.status === 'available' && (
                            <button onClick={() => handleRunProject(selectedProject)} className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-sm transition-all active:scale-95">
                              Carregar Projeto
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="h-48 bg-black/80 border border-white/10 rounded-2xl p-5 font-mono text-[10px] overflow-y-auto custom-scrollbar shadow-2xl">
                    <div className="flex items-center gap-2 text-indigo-400 mb-4 border-b border-white/5 pb-2">
                      <Terminal size={12} />
                      <span className="font-bold uppercase tracking-[0.3em] text-[9px]">VFS Logs</span>
                    </div>
                    <div className="space-y-2">
                      {selectedProject.logs.map((log, i) => (
                        <div key={i} className="flex gap-4">
                          <span className="text-gray-700">[{new Date().toLocaleTimeString()}]</span>
                          <span className={`${log.startsWith('!') ? 'text-red-400' : log.startsWith('>') ? 'text-indigo-300' : 'text-gray-500'} whitespace-pre-wrap`}>
                            {log}
                          </span>
                        </div>
                      ))}
                      <div ref={logEndRef} />
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-white/5 rounded-3xl bg-white/[0.01]">
                  <Package size={54} className="text-white/5 mb-6" />
                  <h4 className="text-white font-semibold text-sm">Selecione um projeto</h4>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="bg-black/60 border-t border-white/5 px-6 py-3 flex items-center justify-between text-[10px] text-gray-600 font-mono backdrop-blur-xl">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-1.5"><Database size={12} className="text-indigo-500" /> Supabase OK</div>
          <div className="flex items-center gap-1.5"><Globe size={12} className="text-indigo-500" /> Ngrok Active</div>
        </div>
        <div className="flex gap-6 items-center">
          <span className="bg-indigo-600/10 text-indigo-500 px-2 py-0.5 rounded border border-indigo-500/10 font-bold tracking-widest">VFS v2.2</span>
        </div>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.05); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(99, 102, 241, 0.3); }
      `}</style>
    </div>
  );
}
