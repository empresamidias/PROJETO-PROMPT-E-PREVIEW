
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
  const [isInitialized, setIsInitialized] = useState(false);
  
  // State: Logger
  const [prompt, setPrompt] = useState('');
  const [dbStatus, setDbStatus] = useState<Status>(Status.IDLE);
  const [history, setHistory] = useState<PromptEntry[]>([]);
  
  // Session ID com fallback
  const [sessionId] = useState(() => {
    try {
      const saved = localStorage.getItem('prompt_session_id');
      if (saved) return saved;
      const newId = (typeof crypto !== 'undefined' && crypto.randomUUID) 
        ? crypto.randomUUID() 
        : "session-" + Math.random().toString(36).substring(2, 9);
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

  const fetchHistory = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('prompts').select('*').order('created_at', { ascending: false }).limit(10);
      if (!error && data) setHistory(data);
    } catch (e) { 
      console.error("Erro Supabase:", e); 
    }
  }, []);

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
        logs: [`Projeto detectado.`]
      }));
      setProjects(mapped);
    } catch (e: any) {
      console.error("Erro API Projects:", e);
      setApiError("API de projetos indisponível no momento.");
    } finally {
      setIsLoadingList(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      await Promise.allSettled([fetchHistory(), refreshProjectList()]);
      setIsInitialized(true);
    };
    init();
  }, [fetchHistory, refreshProjectList]);

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [selectedProject?.logs]);

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
      setDbStatus(Status.ERROR); 
    }
  };

  const handleRunProject = async (project: LocalProject) => {
    if (project.files.length === 0) return;
    const fileName = project.files[0];
    const update = (partial: Partial<LocalProject>) => {
      setProjects(prev => prev.map(p => p.id === project.id ? { ...p, ...partial, logs: partial.logs ? [...p.logs, ...partial.logs] : p.logs } : p));
      setSelectedProject(prev => prev?.id === project.id ? { ...prev, ...partial, logs: partial.logs ? [...prev.logs, ...partial.logs] : prev.logs } : prev);
    };

    try {
      update({ status: 'downloading', logs: [`> Baixando ${fileName}...`] });
      const blob = await projectsService.downloadZip(project.id, fileName);
      update({ status: 'extracting', logs: [`> Extraindo arquivos...`] });
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
      const indexKey = Object.keys(fs).find(k => k.endsWith('index.html'));
      if (!indexKey) throw new Error("index.html não encontrado.");
      const htmlBlob = new Blob([fs[indexKey].content as string], { type: 'text/html' });
      const previewUrl = URL.createObjectURL(htmlBlob);
      update({ status: 'running', previewUrl, logs: [`> Preview pronto.`] });
    } catch (e: any) {
      update({ status: 'error', logs: [`! ERRO: ${e.message}`] });
    }
  };

  if (!isInitialized) return null; // Deixa o CSS do index.html mostrar o loader

  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a] text-gray-100">
      <nav className="bg-black/60 border-b border-white/5 px-6 py-4 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-600 rounded-lg">
              <Code2 className="text-white w-5 h-5" />
            </div>
            <span className="font-bold text-lg tracking-tight text-white">DevHub</span>
          </div>
          <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
            <button onClick={() => setActiveTab('logger')} className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${activeTab === 'logger' ? 'bg-indigo-600 text-white' : 'text-gray-400'}`}>
              <Database size={16} /> Logger
            </button>
            <button onClick={() => setActiveTab('projects')} className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${activeTab === 'projects' ? 'bg-indigo-600 text-white' : 'text-gray-400'}`}>
              <Package size={16} /> Projetos
            </button>
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-7xl mx-auto w-full p-6">
        {activeTab === 'logger' ? (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
            <div className="lg:col-span-3">
              <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 shadow-2xl backdrop-blur-sm">
                <form onSubmit={handlePromptSubmit}>
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4 block">Editor de Prompt</label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl p-5 text-white min-h-[400px] focus:ring-1 focus:ring-indigo-500 outline-none font-mono text-sm"
                    placeholder="Escreva sua mensagem aqui..."
                  />
                  <button type="submit" disabled={dbStatus === Status.LOADING || !prompt.trim()} className="w-full mt-4 py-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all">
                    {dbStatus === Status.LOADING ? <Loader2 className="animate-spin" /> : <RefreshCcw size={18} />}
                    Sincronizar no Supabase
                  </button>
                </form>
              </div>
            </div>
            <div className="lg:col-span-2">
              <h2 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4 px-2">Histórico Recente</h2>
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                {history.map(item => <HistoryItem key={item.id} entry={item} isCurrent={item.session_id === sessionId} />)}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-160px)]">
            <div className="lg:col-span-3 flex flex-col gap-4 overflow-hidden">
              <h2 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-2">ZIP Repository</h2>
              <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                {apiError && <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">{apiError}</div>}
                {projects.map(proj => (
                  <div key={proj.id} onClick={() => setSelectedProject(proj)} className={`p-4 rounded-xl border transition-all cursor-pointer ${selectedProject?.id === proj.id ? 'bg-indigo-600/10 border-indigo-500' : 'bg-white/[0.02] border-white/5'}`}>
                    <div className="flex justify-between items-center">
                      <Package size={16} className="text-indigo-400" />
                      <button onClick={(e) => { e.stopPropagation(); handleRunProject(proj); }} disabled={proj.status === 'running'} className="p-1 bg-indigo-600 rounded-md"><Play size={12} fill="white" /></button>
                    </div>
                    <p className="text-xs font-bold mt-2 truncate">ID: {proj.id}</p>
                    <span className="text-[8px] uppercase text-gray-500">{proj.status}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="lg:col-span-9 flex flex-col gap-4">
              {selectedProject ? (
                <>
                  <div className="flex-1 bg-white rounded-2xl overflow-hidden relative border border-white/10 shadow-2xl">
                    {selectedProject.previewUrl ? (
                      <iframe src={selectedProject.previewUrl} className="w-full h-full border-none" />
                    ) : (
                      <div className="absolute inset-0 bg-[#0c0c0c] flex flex-col items-center justify-center">
                        <LayoutDashboard size={40} className="text-white/5 mb-4" />
                        <p className="text-xs text-gray-600">Aguardando execução do projeto...</p>
                      </div>
                    )}
                  </div>
                  <div className="h-32 bg-black/80 border border-white/10 rounded-xl p-4 font-mono text-[10px] overflow-y-auto custom-scrollbar">
                    {selectedProject.logs.map((log, i) => <div key={i} className="text-gray-500 mb-1">{log}</div>)}
                    <div ref={logEndRef} />
                  </div>
                </>
              ) : (
                <div className="flex-1 border-2 border-dashed border-white/5 rounded-2xl flex items-center justify-center">
                  <p className="text-gray-700 text-xs">Selecione um projeto para preview</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="bg-black/60 border-t border-white/5 px-6 py-2 flex justify-between text-[9px] text-gray-600 font-mono backdrop-blur-xl">
        <div className="flex gap-4">
          <div className="flex items-center gap-1"><Database size={10} className="text-indigo-500" /> Supabase Conectado</div>
          <div className="flex items-center gap-1"><Globe size={10} className="text-indigo-500" /> Ngrok API</div>
        </div>
        <div>VFS ENGINE V2.3 ACTIVE</div>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 10px; }
      `}</style>
    </div>
  );
}
