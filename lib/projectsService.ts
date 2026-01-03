
const API_BASE = 'https://lineable-maricela-primly.ngrok-free.dev';

export interface RemoteProject {
  id: string;
  files: string[];
}

export const projectsService = {
  async listProjects(): Promise<RemoteProject[]> {
    const response = await fetch(`${API_BASE}/projects/`, {
      headers: { 'ngrok-skip-browser-warning': 'true' }
    });
    if (!response.ok) throw new Error('Falha ao listar projetos');
    return response.json();
  },

  async downloadZip(id: string, fileName: string): Promise<Blob> {
    const url = `${API_BASE}/projects/${id}/download/${fileName}`;
    const response = await fetch(url, {
      headers: { 'ngrok-skip-browser-warning': 'true' }
    });
    if (!response.ok) throw new Error('Falha ao baixar ZIP');
    return response.blob();
  }
};
