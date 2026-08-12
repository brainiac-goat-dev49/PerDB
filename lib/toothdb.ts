import { Project, DBEntry, Collection } from '../types';

const TOOTHDB_URL = process.env.TOOTHDB_URL || process.env.TOOTH_DB_URL || 'https://tooth-db.up.railway.app/api';
const TOOTHDB_API_KEY = process.env.TOOTHDB_API_KEY || process.env.TOOTH_DB_API_KEY || 'pk_live_0948bb5cafc8ffeda269dc3c5c8bc233';

async function toothDbRequest(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  collectionName: string,
  queryParams: Record<string, string | number> = {},
  body: any = null
): Promise<any> {
  const url = new URL(TOOTHDB_URL);
  url.searchParams.set('key', TOOTHDB_API_KEY);
  url.searchParams.set('collection', collectionName);

  for (const [key, value] of Object.entries(queryParams)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {
    'x-api-key': TOOTHDB_API_KEY,
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
      console.error(`[ToothDB Client] Error ${res.status} on ${method} ${collectionName}:`, errText);
      throw new Error(`ToothDB error ${res.status}: ${errText}`);
    }
    return await res.json();
  } catch (err) {
    console.error(`[ToothDB Client] Network error on ${method} ${collectionName}:`, err);
    throw err;
  }
}

function normalizeArray(response: any): any[] {
  if (Array.isArray(response)) return response;
  if (response && Array.isArray(response.entries)) return response.entries;
  if (response && Array.isArray(response.data)) return response.data;
  if (response && Array.isArray(response.documents)) return response.documents;
  return [];
}

export const ToothDbClient = {
  syncUser: async (user: { id: string; email: string; displayName: string; photoURL?: string; role?: string }): Promise<void> => {
    try {
      const existing = await ToothDbClient.getUser(user.id);
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

  getAllUsers: async (): Promise<any[]> => {
    try {
      const res = await toothDbRequest('GET', 'users', { limit: 1000 });
      return normalizeArray(res);
    } catch (e) {
      console.error('[ToothDB] getAllUsers error:', e);
      return [];
    }
  },

  updateUser: async (userId: string, updates: Partial<any>): Promise<void> => {
    try {
      const user = await ToothDbClient.getUser(userId);
      if (user) {
        await toothDbRequest('PUT', 'users', { id: userId }, { ...user, ...updates });
      }
    } catch (e) {
      console.error('[ToothDB] updateUser error:', e);
    }
  },

  isUserBanned: async (userId: string, email: string): Promise<boolean> => {
    try {
      const res = await toothDbRequest('GET', 'banned_emails', { limit: 1000 });
      const bannedList = normalizeArray(res);
      if (bannedList.some((b: any) => b.email?.toLowerCase() === email.toLowerCase())) {
        return true;
      }
      if (userId) {
        const user = await ToothDbClient.getUser(userId);
        if (user && user.isBanned) return true;
      }
      return false;
    } catch (e) {
      console.error('[ToothDB] isUserBanned error:', e);
      return false;
    }
  },

  banEmail: async (email: string, reason: string): Promise<void> => {
    try {
      await toothDbRequest('POST', 'banned_emails', {}, { email: email.toLowerCase(), reason, createdAt: new Date().toISOString() });
    } catch (e) {
      console.error('[ToothDB] banEmail error:', e);
    }
  },

  mapToProject: (p: any): Project => {
    return {
      id: p.id || p._id || '',
      name: p.name || 'Untitled Project',
      ownerId: p.ownerId || '',
      apiKey: p.apiKey || '',
      secretKey: p.secretKey || '',
      permissions: p.permissions || { allowPublicRead: true, allowPublicWrite: false, allowedOrigins: ['*'] },
      rules: p.rules || '',
      createdAt: p.createdAt || new Date().toISOString(),
      updatedAt: p.updatedAt || new Date().toISOString(),
      collections: p.collections || [],
      collectionList: p.collectionList || (p.collections ? p.collections.map((c: any) => c.name) : []),
      stats: p.stats || { reads: 0, writes: 0 }
    };
  },

  getProjectsByOwner: async (ownerId: string): Promise<Project[]> => {
    try {
      const res = await toothDbRequest('GET', 'projects', { limit: 1000 });
      const projects = normalizeArray(res);
      return projects
        .filter((p: any) => p.ownerId === ownerId)
        .map(ToothDbClient.mapToProject);
    } catch (e) {
      console.error('[ToothDB] getProjectsByOwner error:', e);
      return [];
    }
  },

  getProjectByApiKey: async (apiKey: string): Promise<Project | null> => {
    try {
      const res = await toothDbRequest('GET', 'projects', { limit: 1000 });
      const projects = normalizeArray(res);
      const found = projects.find((p: any) => p.apiKey === apiKey);
      return found ? ToothDbClient.mapToProject(found) : null;
    } catch (e) {
      console.error('[ToothDB] getProjectByApiKey error:', e);
      return null;
    }
  },

  getProjectById: async (id: string): Promise<Project | null> => {
    try {
      const res = await toothDbRequest('GET', 'projects', { limit: 1000 });
      const projects = normalizeArray(res);
      const found = projects.find((p: any) => p.id === id || p._id === id);
      return found ? ToothDbClient.mapToProject(found) : null;
    } catch (e) {
      console.error('[ToothDB] getProjectById error:', e);
      return null;
    }
  },

  createProject: async (payload: { name: string; ownerId: string; apiKey: string; secretKey: string }): Promise<Project> => {
    const id = 'proj_' + Math.random().toString(36).substring(2, 10);
    const now = new Date().toISOString();
    const doc = {
      id,
      ...payload,
      permissions: { allowPublicRead: true, allowPublicWrite: false, allowedOrigins: ['*'] },
      rules: '',
      collections: [],
      collectionList: ['users'],
      createdAt: now,
      updatedAt: now,
      stats: { reads: 0, writes: 0 }
    };
    await toothDbRequest('POST', 'projects', {}, doc);
    return ToothDbClient.mapToProject(doc);
  },

  updateProject: async (id: string, updates: Partial<Project>): Promise<void> => {
    const existing = await ToothDbClient.getProjectById(id);
    if (!existing) return;
    const now = new Date().toISOString();
    await toothDbRequest('PUT', 'projects', { id }, {
      ...existing,
      ...updates,
      updatedAt: now
    });
  },

  deleteProject: async (id: string): Promise<void> => {
    await toothDbRequest('DELETE', 'projects', { id });
  },

  getProjectCollections: async (projectId: string): Promise<Collection[]> => {
    try {
      const res = await toothDbRequest('GET', 'documents', { limit: 1000 });
      const allDocs = normalizeArray(res);
      const projectDocs = allDocs.filter((d: any) => d.projectId === projectId);
      
      const counts: Record<string, number> = {};
      projectDocs.forEach((d: any) => {
        if (d.collectionName) {
          counts[d.collectionName] = (counts[d.collectionName] || 0) + 1;
        }
      });

      const cols: Collection[] = Object.keys(counts).map(cName => ({
        name: cName,
        entries: [],
        totalCount: counts[cName],
        hasLoaded: false
      }));

      if (!cols.some(c => c.name === 'users')) {
        cols.unshift({ name: 'users', entries: [], totalCount: 0, hasLoaded: false });
      }

      return cols;
    } catch (e) {
      console.error('[ToothDB] getProjectCollections error:', e);
      return [{ name: 'users', entries: [], totalCount: 0, hasLoaded: false }];
    }
  },

  getCollectionPreview: async (projectId: string, collectionName: string): Promise<Partial<Collection>> => {
    try {
      const docs = await ToothDbClient.getDocuments(projectId, collectionName, 10);
      return {
        name: collectionName,
        totalCount: docs.length,
        entries: docs.slice(0, 5),
        hasLoaded: true
      };
    } catch (e) {
      console.error('[ToothDB] getCollectionPreview error:', e);
      return { name: collectionName, totalCount: 0, entries: [], hasLoaded: false };
    }
  },

  getDocuments: async (projectId: string, collectionName: string, limit: number = 50): Promise<DBEntry[]> => {
    try {
      const res = await toothDbRequest('GET', 'documents', { limit: 1000 });
      const allDocs = normalizeArray(res);
      const filtered = allDocs.filter((d: any) => d.projectId === projectId && d.collectionName === collectionName);
      return filtered.slice(0, limit).map((d: any) => ({
        id: d.docId || d.id || d._id,
        ...d.data,
        _createdAt: d.createdAt || d._createdAt,
        _updatedAt: d.updatedAt || d._updatedAt
      }));
    } catch (e) {
      console.error('[ToothDB] getDocuments error:', e);
      return [];
    }
  },

  addDocument: async (projectId: string, collectionName: string, docId: string, data: any): Promise<string> => {
    const finalDocId = docId || ('doc_' + Math.random().toString(36).substring(2, 10));
    const now = new Date().toISOString();
    const payload = {
      id: `${projectId}_${collectionName}_${finalDocId}`,
      projectId,
      collectionName,
      docId: finalDocId,
      data,
      createdAt: now,
      updatedAt: now
    };
    await toothDbRequest('POST', 'documents', {}, payload);
    return finalDocId;
  },

  incrementStats: async (projectId: string, reads: number, writes: number): Promise<void> => {
    try {
      const proj = await ToothDbClient.getProjectById(projectId);
      if (proj) {
        const updatedStats = {
          reads: (proj.stats?.reads || 0) + reads,
          writes: (proj.stats?.writes || 0) + writes
        };
        await ToothDbClient.updateProject(projectId, { stats: updatedStats });
      }
    } catch (e) {
      console.error('[ToothDB] incrementStats error:', e);
    }
  },

  getFeedback: async (): Promise<any[]> => {
    try {
      const res = await toothDbRequest('GET', 'feedback', { limit: 1000 });
      return normalizeArray(res);
    } catch (e) {
      console.error('[ToothDB] getFeedback error:', e);
      return [];
    }
  },

  addFeedback: async (feedback: { name: string; email: string; message: string }): Promise<void> => {
    try {
      await toothDbRequest('POST', 'feedback', {}, {
        ...feedback,
        createdAt: new Date().toISOString()
      });
    } catch (e) {
      console.error('[ToothDB] addFeedback error:', e);
    }
  },

  deleteFeedback: async (id: string): Promise<void> => {
    try {
      await toothDbRequest('DELETE', 'feedback', { id });
    } catch (e) {
      console.error('[ToothDB] deleteFeedback error:', e);
    }
  }
};
