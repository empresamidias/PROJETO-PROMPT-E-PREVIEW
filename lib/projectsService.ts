
const API_BASE = 'https://lineable-maricela-primly.ngrok-free.dev';

export interface RemoteProject {
  id: string;
  files: string[];
}

export const projectsService = {
  async listProjects(): Promise<RemoteProject[]> {
    try {
      const response = await fetch(`${API_BASE}/projects/`, {
        method: 'GET',
        headers: { 
          'ngrok-skip-browser-warning': 'true',
          'Accept': 'application/json'
        }
      });
      if (!response.ok) {
        console.warn(`API retornou status ${response.status}`);
        return [];
      }
      return await response.json();
    } catch (e) {
      console.error('Erro de conexão com a API de projetos:', e);
      throw new Error('Não foi possível conectar ao servidor de projetos. Verifique se o túnel ngrok está ativo.');
    }
  },

  async downloadZip(id: string, fileName: string): Promise<Blob> {
    const url = `${API_BASE}/projects/${id}/download/${fileName}`;
    try {
      const response = await fetch(url, {
        headers: { 'ngrok-skip-browser-warning': 'true' }
      });
      if (!response.ok) throw new Error(`Erro ao baixar arquivo (${response.status})`);
      return await response.blob();
    } catch (e) {
      console.error('Erro no download do ZIP:', e);
      throw e;
    }
  }
};
