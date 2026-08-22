import { Project, DBEntry, Collection } from '../types';

function getToothDbConfig() {
  const rawUrl = process.env.TOOTHDB_URL || process.env.TOOTH_DB_URL || 'https://tooth-db.up.railway.app/api';
  const apiKey = process.env.TOOTHDB_API_KEY || process.env.TOOTH_DB_API_KEY || 'pk_live_0948bb5cafc8ffeda269dc3c5c8bc233';

  let normalizedUrl = rawUrl.trim().replace(/\/+$/, '');
  if (!normalizedUrl.endsWith('/api') && !normalizedUrl.includes('/api?')) {
    normalizedUrl = `${normalizedUrl}/api`;
  }

  return { url: normalizedUrl, apiKey };
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Standard HTTP requester connecting PerDB directly to the remote ToothDB server
 */
async function toothDbRequest(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  collectionName: string,
  queryParams: Record<string, string | number> = {},
  body: any = null,
  maxRetries = 2
): Promise<any> {
  const { url: baseUrl, apiKey } = getToothDbConfig();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
      const url = new URL(baseUrl);
      url.searchParams.set('key', apiKey);
      url.searchParams.set('collection', collectionName);

      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }

      const headers: Record<string, string> = {
        'x-api-key': apiKey,
        'Accept': 'application/json',
      };

      const options: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };

      if (body && (method === 'POST' || method === 'PUT')) {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }

      const res = await fetch(url.toString(), options);
      clearTimeout(timeoutId);

      if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown error');
        if (res.status >= 500 && attempt < maxRetries) {
          console.warn(`[ToothDB] Retrying ${method} ${collectionName} after status ${res.status}...`);
          await sleep(400 * (attempt + 1));
          continue;
        }
        throw new Error(`ToothDB server error (${res.status}): ${errText}`);
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return await res.json();
      }
      return await res.text();
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (attempt < maxRetries && (err.name === 'AbortError' || err.message?.includes('fetch failed'))) {
        console.warn(`[ToothDB] Retrying ${method} ${collectionName} after network issue:`, err?.message);
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}

function normalizeArray(response: any): any[] {
  if (!response) return [];
  if (Array.isArray(response)) return response;
  if (response && Array.isArray(response.entries)) return response.entries;
  if (response && Array.isArray(response.data)) return response.data;
  if (response && Array.isArray(response.documents)) return response.documents;
  return [];
}

export const ToothDbClient = {
  syncUser: async (user: { id: string; email: string; displayName: string; photoURL?: string; role?: string; password?: string }): Promise<void> => {
    const now = new Date().toISOString();
    const cleanEmail = user.email.toLowerCase().trim();
    const cleanUser = {
      id: user.id,
      email: cleanEmail,
      displayName: user.displayName || 'User',
      photoURL: user.photoURL || '',
      role: user.role || (cleanEmail === 'testimonyfresh49@gmail.com' ? 'admin' : 'user'),
      password: user.password,
      createdAt: now,
      lastLogin: now,
    };

    const existing = await ToothDbClient.getUser(user.id);
    if (!existing) {
      await toothDbRequest('POST', 'users', {}, cleanUser);
    } else {
      await toothDbRequest('PUT', 'users', { id: user.id }, {
        ...existing,
        ...cleanUser,
        createdAt: existing.createdAt || now,
        lastLogin: now,
      });
    }
  },

  getUser: async (userId: string): Promise<any | null> => {
    if (!userId) return null;
    try {
      const res = await toothDbRequest('GET', 'users', { limit: 1000 });
      const users = normalizeArray(res);
      return users.find((u: any) => (u.id === userId || u._id === userId || u.docId === userId)) || null;
    } catch (e: any) {
      console.error('[ToothDB] getUser error:', e?.message || e);
      return null;
    }
  },

  getAllUsers: async (): Promise<any[]> => {
    try {
      const res = await toothDbRequest('GET', 'users', { limit: 1000 });
      return normalizeArray(res);
    } catch (e: any) {
      console.error('[ToothDB] getAllUsers error:', e?.message || e);
      return [];
    }
  },

  updateUser: async (userId: string, updates: Partial<any>): Promise<void> => {
    const user = await ToothDbClient.getUser(userId);
    const updated = { ...(user || {}), ...updates, id: userId, updatedAt: new Date().toISOString() };
    await toothDbRequest('PUT', 'users', { id: userId }, updated);
  },

  mapToProject: (p: any): Project => {
    return {
      id: p.id || p._id || p.docId || '',
      name: p.name || 'Untitled Project',
      ownerId: p.ownerId || '',
      apiKey: p.apiKey || '',
      secretKey: p.secretKey || '',
      permissions: p.permissions || { allowPublicRead: true, allowPublicWrite: false, allowedOrigins: ['*'] },
      rules: p.rules || '{\n  "global": {\n    ".read": "true",\n    ".write": "true"\n  }\n}',
      createdAt: p.createdAt || new Date().toISOString(),
      updatedAt: p.updatedAt || new Date().toISOString(),
      collections: p.collections || [],
      collectionList: p.collectionList || (p.collections ? p.collections.map((c: any) => c.name) : ['users']),
      stats: p.stats || { reads: 0, writes: 0 }
    };
  },

  getProjectsByOwner: async (ownerId: string): Promise<Project[]> => {
    try {
      const res = await toothDbRequest('GET', 'projects', { limit: 1000 });
      const rawList = normalizeArray(res);
      return rawList
        .map(ToothDbClient.mapToProject)
        .filter(p => p.ownerId === ownerId);
    } catch (e: any) {
      console.error('[ToothDB] getProjectsByOwner error:', e?.message || e);
      return [];
    }
  },

  getProjectByApiKey: async (apiKey: string): Promise<Project | null> => {
    try {
      const res = await toothDbRequest('GET', 'projects', { limit: 1000 });
      const rawList = normalizeArray(res);
      const found = rawList.map(ToothDbClient.mapToProject).find(p => p.apiKey === apiKey);
      return found || null;
    } catch (e: any) {
      console.error('[ToothDB] getProjectByApiKey error:', e?.message || e);
      return null;
    }
  },

  getProjectById: async (id: string): Promise<Project | null> => {
    try {
      const res = await toothDbRequest('GET', 'projects', { limit: 1000 });
      const rawList = normalizeArray(res);
      const found = rawList.map(ToothDbClient.mapToProject).find(p => p.id === id);
      return found || null;
    } catch (e: any) {
      console.error('[ToothDB] getProjectById error:', e?.message || e);
      return null;
    }
  },

  createProject: async (payload: { name: string; ownerId: string; apiKey: string; secretKey: string }): Promise<Project> => {
    const id = 'proj_' + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();
    const doc = {
      id,
      ...payload,
      permissions: { allowPublicRead: true, allowPublicWrite: false, allowedOrigins: ['perchance.org'] },
      rules: '{\n  "global": {\n    ".read": "true",\n    ".write": "true"\n  }\n}',
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
    const now = new Date().toISOString();
    const merged = {
      ...(existing || {}),
      ...updates,
      id,
      updatedAt: now
    };

    await toothDbRequest('PUT', 'projects', { id }, merged);
  },

  deleteProject: async (id: string): Promise<void> => {
    await toothDbRequest('DELETE', 'projects', { id });
  },

  getProjectCollections: async (projectId: string): Promise<Collection[]> => {
    try {
      const proj = await ToothDbClient.getProjectById(projectId);
      const knownCollectionNames = new Set<string>(proj?.collectionList || ['users']);

      const res = await toothDbRequest('GET', 'documents', { limit: 1000 });
      const allDocs = normalizeArray(res);
      const projectDocs = allDocs.filter((d: any) => d.projectId === projectId);

      const counts: Record<string, number> = {};
      projectDocs.forEach((d: any) => {
        if (d.collectionName) {
          counts[d.collectionName] = (counts[d.collectionName] || 0) + 1;
          knownCollectionNames.add(d.collectionName);
        }
      });

      const cols: Collection[] = Array.from(knownCollectionNames).map(cName => ({
        name: cName,
        entries: [],
        totalCount: counts[cName] || 0,
        hasLoaded: false
      }));

      return cols;
    } catch (e: any) {
      console.error('[ToothDB] getProjectCollections error:', e?.message || e);
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
    } catch (e: any) {
      console.error('[ToothDB] getCollectionPreview error:', e?.message || e);
      return { name: collectionName, totalCount: 0, entries: [], hasLoaded: false };
    }
  },

  getDocuments: async (projectId: string, collectionName: string, limit: number = 50): Promise<DBEntry[]> => {
    try {
      const res = await toothDbRequest('GET', 'documents', { limit: 1000 });
      const allDocs = normalizeArray(res);
      const filtered = allDocs
        .filter((d: any) => d.projectId === projectId && d.collectionName === collectionName)
        .map((d: any) => ({
          id: d.docId || d.id || d._id,
          ...d.data,
          _createdAt: d.createdAt || d._createdAt,
          _updatedAt: d.updatedAt || d._updatedAt
        }));

      return filtered.slice(0, limit);
    } catch (e: any) {
      console.error('[ToothDB] getDocuments error:', e?.message || e);
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
    } catch (e: any) {
      console.error('[ToothDB] incrementStats error:', e?.message || e);
    }
  },

  getFeedback: async (): Promise<any[]> => {
    try {
      const res = await toothDbRequest('GET', 'feedback', { limit: 1000 });
      return normalizeArray(res);
    } catch (e: any) {
      console.error('[ToothDB] getFeedback error:', e?.message || e);
      return [];
    }
  },

  addFeedback: async (feedback: { name: string; email: string; message: string }): Promise<void> => {
    const id = 'fb_' + Math.random().toString(36).substring(2, 10);
    const item = { ...feedback, id, createdAt: new Date().toISOString() };
    await toothDbRequest('POST', 'feedback', {}, item);
  },

  deleteFeedback: async (id: string): Promise<void> => {
    await toothDbRequest('DELETE', 'feedback', { id });
  }
};
