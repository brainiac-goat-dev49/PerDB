import { Project, DBEntry, Collection } from '../types';

const TOOTH_DB_URL = process.env.TOOTH_DB_URL || 'https://tooth-db.up.railway.app/api';
const TOOTH_DB_API_KEY = process.env.TOOTH_DB_API_KEY || 'pk_live_0948bb5cafc8ffeda269dc3c5c8bc233';

// Base helper for ToothDB requests
async function toothDbRequest(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  collectionName: string,
  queryParams: Record<string, string | number> = {},
  body: any = null
): Promise<any> {
  const url = new URL(TOOTH_DB_URL);
  url.searchParams.set('key', TOOTH_DB_API_KEY);
  url.searchParams.set('collection', collectionName);

  for (const [key, value] of Object.entries(queryParams)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {
    'x-api-key': TOOTH_DB_API_KEY,
  };

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const options: RequestInit = {
    method,
    headers,
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url.toString(), options);
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[ToothDB] Error ${res.status} on ${method} ${collectionName}:`, errText);
      throw new Error(`ToothDB error ${res.status}: ${errText}`);
    }
    const data = await res.json();
    return data;
  } catch (err) {
    console.error(`[ToothDB] Network/Request error on ${method} ${collectionName}:`, err);
    throw err;
  }
}

// Helper to normalize ToothDB array response
function normalizeArray(response: any): any[] {
  if (Array.isArray(response)) return response;
  if (response && Array.isArray(response.entries)) return response.entries;
  if (response && Array.isArray(response.data)) return response.data;
  if (response && Array.isArray(response.documents)) return response.documents;
  return [];
}

export const ToothDbService = {
  // --- USER OPERATIONS ---
  syncUser: async (user: { id: string; email: string; displayName: string; photoURL?: string; role?: string }): Promise<void> => {
    try {
      const existing = await ToothDbService.getUser(user.id);
      const now = new Date().toISOString();
      if (!existing) {
        await toothDbRequest('POST', 'users', {}, {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL || '',
          role: user.role || (user.email === 'testimonyfresh49@gmail.com' ? 'admin' : 'user'),
          isBanned: false,
          createdAt: now,
          lastLogin: now
        });
      } else {
        await toothDbRequest('PUT', 'users', { id: user.id }, {
          ...existing,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL || existing.photoURL || '',
          lastLogin: now
        });
      }
    } catch (e) {
      console.error('[ToothDB] syncUser error:', e);
    }
  },

  getUser: async (userId: string): Promise<any | null> => {
    try {
      const res = await toothDbRequest('GET', 'users', { limit: 1000 });
      const users = normalizeArray(res);
      return users.find((u: any) => u.id === userId || u._id === userId) || null;
    } catch (e) {
      console.error('[ToothDB] getUser error:', e);
      return null;
    }
  },

  isUserBanned: async (userId: string, email?: string): Promise<boolean> => {
    try {
      const user = await ToothDbService.getUser(userId);
      if (user && user.isBanned) return true;

      if (email) {
        const res = await toothDbRequest('GET', 'banned_emails', { limit: 1000 });
        const banned = normalizeArray(res);
        if (banned.some((b: any) => b.email?.toLowerCase() === email.toLowerCase() || b.id?.toLowerCase() === email.toLowerCase())) {
          return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  },

  getAllUsers: async (): Promise<any[]> => {
    try {
      const res = await toothDbRequest('GET', 'users', { limit: 500 });
      return normalizeArray(res);
    } catch (e) {
      return [];
    }
  },

  updateUser: async (userId: string, updates: any): Promise<void> => {
    try {
      const user = await ToothDbService.getUser(userId);
      if (user) {
        const docId = user.id || user._id;
        await toothDbRequest('PUT', 'users', { id: docId }, { ...user, ...updates });
      }
    } catch (e) {
      console.error('[ToothDB] updateUser error:', e);
    }
  },

  // --- PROJECT OPERATIONS ---
  getProjectsByOwner: async (ownerId: string): Promise<Project[]> => {
    try {
      const res = await toothDbRequest('GET', 'projects', { limit: 500 });
      const projects = normalizeArray(res);
      return projects
        .filter((p: any) => p.ownerId === ownerId)
        .map(ToothDbService.mapToProject);
    } catch (e) {
      console.error('[ToothDB] getProjectsByOwner error:', e);
      return [];
    }
  },

  getProjectByApiKey: async (apiKey: string): Promise<Project | null> => {
    try {
      const res = await toothDbRequest('GET', 'projects', { limit: 500 });
      const projects = normalizeArray(res);
      const found = projects.find((p: any) => p.apiKey === apiKey);
      return found ? ToothDbService.mapToProject(found) : null;
    } catch (e) {
      console.error('[ToothDB] getProjectByApiKey error:', e);
      return null;
    }
  },

  getProjectById: async (id: string): Promise<Project | null> => {
    try {
      const res = await toothDbRequest('GET', 'projects', { limit: 500 });
      const projects = normalizeArray(res);
      const found = projects.find((p: any) => p.id === id || p._id === id);
      return found ? ToothDbService.mapToProject(found) : null;
    } catch (e) {
      console.error('[ToothDB] getProjectById error:', e);
      return null;
    }
  },

  createProject: async (projectData: any): Promise<Project> => {
    const now = new Date().toISOString();
    const payload = {
      ...projectData,
      createdAt: now,
      updatedAt: now
    };
    const res = await toothDbRequest('POST', 'projects', {}, payload);
    const id = res.id || projectData.id;
    return ToothDbService.mapToProject({ ...payload, id });
  },

  updateProject: async (id: string, updates: any): Promise<void> => {
    const existing = await ToothDbService.getProjectById(id);
    if (!existing) throw new Error('Project not found');
    const updated = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString()
    };
    await toothDbRequest('PUT', 'projects', { id }, updated);
  },

  deleteProject: async (id: string): Promise<void> => {
    await toothDbRequest('DELETE', 'projects', { id });
    // Also cleanup documents associated with this project
    try {
      const docsRes = await toothDbRequest('GET', 'project_documents', { limit: 1000 });
      const docs = normalizeArray(docsRes);
      for (const d of docs) {
        if (d.projectId === id) {
          const docId = d.id || d._id;
          if (docId) {
            await toothDbRequest('DELETE', 'project_documents', { id: docId }).catch(() => {});
          }
        }
      }
    } catch (e) {
      // ignore non-critical errors
    }
  },

  incrementStats: async (projectId: string, reads: number, writes: number): Promise<void> => {
    try {
      const proj = await ToothDbService.getProjectById(projectId);
      if (proj) {
        const curStats = proj.stats || { reads: 0, writes: 0 };
        const updatedStats = {
          reads: (curStats.reads || 0) + reads,
          writes: (curStats.writes || 0) + writes
        };
        await ToothDbService.updateProject(projectId, { stats: updatedStats });
      }
    } catch (e) {
      console.error('[ToothDB] incrementStats error:', e);
    }
  },

  // --- DOCUMENT / COLLECTION OPERATIONS ---
  getProjectCollections: async (projectId: string): Promise<Collection[]> => {
    const proj = await ToothDbService.getProjectById(projectId);
    if (!proj) return [];
    const colNames = Array.from(new Set(proj.collectionList || []));
    return colNames.map(name => ({
      name,
      entries: [],
      totalCount: 0,
      hasLoaded: false,
      isLoading: false
    }));
  },

  getCollectionPreview: async (projectId: string, collectionName: string): Promise<Partial<Collection>> => {
    try {
      const docs = await ToothDbService.getDocuments(projectId, collectionName, 10);
      return {
        entries: docs,
        totalCount: docs.length,
        hasLoaded: true
      };
    } catch (e) {
      return { entries: [], totalCount: 0, hasLoaded: true };
    }
  },

  getDocuments: async (projectId: string, collectionName: string, limitCount = 50): Promise<DBEntry[]> => {
    try {
      const res = await toothDbRequest('GET', 'project_documents', { limit: 1000 });
      const allDocs = normalizeArray(res);
      const filtered = allDocs
        .filter((d: any) => d.projectId === projectId && d.collectionName === collectionName)
        .slice(0, limitCount);

      return filtered.map((d: any) => ({
        id: d.docId || d.id || d._id,
        ...d.data,
        _created: d.createdAt || d._created
      }));
    } catch (e) {
      console.error('[ToothDB] getDocuments error:', e);
      return [];
    }
  },

  addDocument: async (projectId: string, collectionName: string, docId: string, data: any): Promise<string> => {
    const now = new Date().toISOString();
    const payload = {
      projectId,
      collectionName,
      docId,
      data,
      createdAt: now,
      updatedAt: now
    };
    const res = await toothDbRequest('POST', 'project_documents', {}, payload);

    // Update project collectionList if new collection
    const proj = await ToothDbService.getProjectById(projectId);
    if (proj) {
      const currentList = proj.collectionList || [];
      if (!currentList.includes(collectionName)) {
        await ToothDbService.updateProject(projectId, {
          collectionList: [...currentList, collectionName]
        });
      }
    }

    return res.id || docId;
  },

  // --- FEEDBACK & BANNED EMAILS ---
  getFeedback: async (): Promise<any[]> => {
    try {
      const res = await toothDbRequest('GET', 'feedback', { limit: 500 });
      return normalizeArray(res);
    } catch (e) {
      return [];
    }
  },

  addFeedback: async (feedback: { name?: string; email?: string; message: string }): Promise<void> => {
    await toothDbRequest('POST', 'feedback', {}, {
      ...feedback,
      timestamp: new Date().toISOString()
    });
  },

  deleteFeedback: async (id: string): Promise<void> => {
    await toothDbRequest('DELETE', 'feedback', { id });
  },

  banEmail: async (email: string, reason = 'Banned'): Promise<void> => {
    await toothDbRequest('POST', 'banned_emails', {}, {
      email,
      reason,
      bannedAt: new Date().toISOString()
    });
  },

  // Helper mapper
  mapToProject: (data: any): Project => {
    return {
      id: data.id || data._id,
      ownerId: data.ownerId,
      name: data.name,
      apiKey: data.apiKey,
      secretKey: data.secretKey,
      permissions: data.permissions || { allowPublicRead: true, allowPublicWrite: false, allowedOrigins: [] },
      rules: typeof data.rules === 'string' ? data.rules : JSON.stringify(data.rules || {}, null, 2),
      stats: data.stats || { reads: 0, writes: 0 },
      collections: [],
      collectionList: data.collectionList || [],
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString()
    };
  }
};
