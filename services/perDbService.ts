import { AuthService } from './authService';
import { Project, DBEntry, Collection } from '../types';

async function safeJson(res: Response): Promise<any> {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    throw new Error(`Server response error (${res.status}): ${text.slice(0, 80)}`);
  }
  return await res.json();
}

export const PerDbService = {
  // --- Management API ---

  getProjectCollections: async (projectId: string): Promise<Collection[]> => {
    const token = AuthService.getToken();
    if (!token) return [];
    const res = await fetch(`/api/projects/${projectId}/collections`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed to fetch collections');
    return await safeJson(res);
  },

  getCollectionPreview: async (projectId: string, collectionName: string): Promise<Partial<Collection>> => {
    const token = AuthService.getToken();
    if (!token) return {};
    const res = await fetch(`/api/projects/${projectId}/collections/${collectionName}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed to fetch collection preview');
    return await safeJson(res);
  },

  getFullCollection: async (
    projectId: string, 
    collectionName: string, 
    limitCount: number = 50,
    cursor?: any
  ): Promise<{ entries: DBEntry[], lastDoc: any }> => {
    const token = AuthService.getToken();
    if (!token) return { entries: [], lastDoc: null };
    const res = await fetch(`/api/projects/${projectId}/collections/${collectionName}/full?limit=${limitCount}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed to fetch full collection');
    const data = await safeJson(res);
    return {
      entries: data.entries || [],
      lastDoc: null
    };
  },

  createProject: async (name: string): Promise<Project> => {
    const token = AuthService.getToken();
    if (!token) throw new Error("Must be logged in");
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name })
    });
    if (!res.ok) {
      const err = await safeJson(res).catch(() => ({ error: 'Failed to create project' }));
      throw new Error(err.error || 'Failed to create project');
    }
    return await safeJson(res);
  },

  getAllProjects: async (): Promise<Project[]> => {
    const token = AuthService.getToken();
    if (!token) return [];
    const res = await fetch('/api/projects', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed to fetch projects');
    return await safeJson(res);
  },

  deleteProject: async (projectId: string): Promise<void> => {
    const token = AuthService.getToken();
    if (!token) throw new Error("Must be logged in");
    const res = await fetch(`/api/projects/${projectId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to delete project');
    }
  },

  updateProject: async (projectId: string, data: Partial<Project>): Promise<void> => {
    const token = AuthService.getToken();
    if (!token) throw new Error("Must be logged in");
    const { id, collections, ...cleanData } = data as any;
    const res = await fetch(`/api/projects/${projectId}`, {
      method: 'PUT',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(cleanData)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update project');
    }
  },

  saveFeedback: async (feedback: { name: string; email: string; message: string; timestamp: string }): Promise<void> => {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(feedback)
    });
    if (!res.ok) {
      // fallback silent success
    }
  },

  getAllFeedback: async (): Promise<any[]> => {
    const token = AuthService.getToken();
    if (!token) throw new Error("Unauthorized");

    const res = await fetch('/api/admin/feedback', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch feedback');
    }
    return await res.json();
  },

  deleteFeedback: async (id: string): Promise<void> => {
    const token = AuthService.getToken();
    if (!token) throw new Error("Unauthorized");

    const res = await fetch(`/api/admin/feedback/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to delete feedback');
    }
  },

  // --- User Management ---

  syncUser: async (): Promise<void> => {
    const token = AuthService.getToken();
    if (!token) return;
    const res = await fetch('/api/user/sync', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) {
      const err = await res.json();
      if (res.status === 403) {
        await AuthService.signOut();
      }
      throw new Error(err.error || 'Failed to sync user');
    }
  },

  getAllUsers: async (): Promise<any[]> => {
    const token = AuthService.getToken();
    if (!token) throw new Error("Unauthorized");

    const res = await fetch('/api/admin/users', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch users');
    }
    return await res.json();
  },

  updateUserStatus: async (userId: string, isBanned: boolean): Promise<void> => {
    const token = AuthService.getToken();
    if (!token) throw new Error("Unauthorized");

    const res = await fetch('/api/admin/update-user', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ userId, updates: { isBanned } })
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update user status');
    }
  },

  deleteUser: async (userId: string): Promise<void> => {
    const token = AuthService.getToken();
    if (!token) throw new Error("Unauthorized");

    await fetch('/api/admin/update-user', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ userId, updates: { isDeleted: true } })
    });
  },

  deleteUserFull: async (userId: string): Promise<void> => {
    const token = AuthService.getToken();
    if (!token) throw new Error("Unauthorized");

    const res = await fetch('/api/admin/delete-user-full', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ userId })
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to delete user and data');
    }
  },

  sendResetLink: async (email: string): Promise<string> => {
    const token = AuthService.getToken();
    if (!token) throw new Error("Unauthorized");

    const res = await fetch('/api/admin/send-reset-link', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email })
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to generate reset link');
    }
    const data = await res.json();
    return data.link;
  },

  // --- Runtime API ---
  
  runtimeAdd: async (apiKey: string, collectionName: string, data: any): Promise<any> => {
    const params = new URLSearchParams({ collection: collectionName });
    const res = await fetch(`/api?${params.toString()}`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify(data)
    });
    const result = await safeJson(res);
    if (result.error) throw new Error(result.error);
    return result;
  },

  runtimeGet: async (apiKey: string, collectionName: string): Promise<DBEntry[]> => {
    const params = new URLSearchParams({ collection: collectionName });
    const res = await fetch(`/api?${params.toString()}`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey
      }
    });
    const result = await safeJson(res);
    if (result.error) throw new Error(result.error);
    return result;
  },

  runtimeUpdate: async (apiKey: string, collectionName: string, docId: string, data: any, secretKey?: string): Promise<void> => {
    const params = new URLSearchParams({ collection: collectionName, id: docId });
    const res = await fetch(`/api?${params.toString()}`, {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        ...(secretKey ? { 'x-secret-key': secretKey } : {})
      },
      body: JSON.stringify(data)
    });
    const result = await safeJson(res);
    if (result.error) throw new Error(result.error);
  },

  runtimeDelete: async (apiKey: string, collectionName: string, docId: string, secretKey?: string): Promise<void> => {
    const params = new URLSearchParams({ collection: collectionName, id: docId });
    const res = await fetch(`/api?${params.toString()}`, {
      method: 'DELETE',
      headers: {
        'x-api-key': apiKey,
        ...(secretKey ? { 'x-secret-key': secretKey } : {})
      }
    });
    const result = await safeJson(res);
    if (result.error) throw new Error(result.error);
  }
};
