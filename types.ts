
export interface PromptEntry {
  id: number;
  session_id: string;
  mensagem: string;
  created_at: string;
}

export enum Status {
  IDLE = 'idle',
  LOADING = 'loading',
  SUCCESS = 'success',
  ERROR = 'error'
}

export type ProjectStatus = 'available' | 'downloading' | 'extracting' | 'validating' | 'running' | 'error';

export interface VirtualFile {
  path: string;
  content: string | Uint8Array;
  type: 'text' | 'binary';
}

export interface LocalProject {
  id: string;
  name: string;
  files: string[]; // Lista de arquivos zip vindos da API
  status: ProjectStatus;
  previewUrl?: string;
  logs: string[];
  fileSystem?: Record<string, VirtualFile>;
}

export interface ApiResponseProject {
  id: string;
  files: string[];
}
