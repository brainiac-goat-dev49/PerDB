import { Project, DBEntry, Collection } from '../types';

function getToothDbConfig() {
  const rawUrl = process.env.TOOTHDB_URL || process.env.TOOTH_DB_URL || 'https://tooth-db.vercel.app/api';
  const apiKey = process.env.TOOTHDB_API_KEY || process.env.TOOTH_DB_API_KEY || 'pk_live_8a9fb75159524cb1b47b98bee007b3d9';

  let normalizedUrl = rawUrl.trim().replace(/\/+$/, '');
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
  maxRetries = 1
): Promise<any> {
  const { url: configuredUrl, apiKey } = getToothDbConfig();

  // Prepare primary and alternative endpoint variants (e.g. with /api and without /api)
  const candidateUrls: string[] = [];
  if (configuredUrl.endsWith('/api')) {
    candidateUrls.push(configuredUrl);
    candidateUrls.push(configuredUrl.replace(/\/api$/, ''));
  } else {
    candidateUrls.push(`${configuredUrl}/api`);
    candidateUrls.push(configuredUrl);
  }

  let lastError: any = null;

  for (const baseUrl of candidateUrls) {
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
          if (res.status === 404) {
            // Might be subpath mismatch, break inner retry to try alternate candidate URL
            lastError = new Error(`ToothDB server error (404 Not Found at ${url.origin}${url.pathname}): ${errText.slice(0, 120)}`);
            break;
          }
          if (res.status >= 500 && attempt < maxRetries) {
            console.warn(`[ToothDB] Retrying ${method} ${collectionName} after status ${res.status}...`);
            await sleep(400 * (attempt + 1));
            continue;
          }
          throw new Error(`ToothDB server error (${res.status}): ${errText.slice(0, 150)}`);
        }

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          return await res.json();
        }
        return await res.text();
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastError = err;
        if (attempt < maxRetries && (err.name === 'AbortError' || err.message?.includes('fetch failed'))) {
          console.warn(`[ToothDB] Retrying ${method} ${collectionName} after network issue:`, err?.message);
          await sleep(400 * (attempt + 1));
          continue;
        }
        break;
      }
    }
  }

  throw lastError || new Error(`Failed to connect to ToothDB at ${configuredUrl}`);
}

async function saveProjectToToothDb(projectDoc: any): Promise<void> {
  const projId = projectDoc.id || projectDoc.docId || projectDoc._id;
  try {
    await toothDbRequest('PUT', 'projects', { id: projId }, projectDoc);
  } catch (err: any) {
    console.warn(`[ToothDB] PUT project ${projId} failed, falling back to POST:`, err?.message);
    try {
      await toothDbRequest('POST', 'projects', {}, projectDoc);
    } catch (postErr: any) {
      console.error(`[ToothDB] POST project ${projId} fallback error:`, postErr);
      throw postErr;
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
    const res = await toothDbRequest('GET', 'users', { limit: 1000 });
    const users = normalizeArray(res);
    const found = users.find((u: any) => (u.id === userId || u._id === userId || u.docId === userId));
    if (!found || found.isDeleted || found.deleted || found.status === 'deleted' || found._deleted) return null;
    return found;
  },

  getAllUsers: async (): Promise<any[]> => {
    const res = await toothDbRequest('GET', 'users', { limit: 1000 });
    const users = normalizeArray(res);
    return users.filter((u: any) => !u.isDeleted && !u.deleted && u.status !== 'deleted' && !u._deleted);
  },

  updateUser: async (userId: string, updates: Partial<any>): Promise<void> => {
    const user = await ToothDbClient.getUser(userId);
    const updated = { ...(user || {}), ...updates, id: userId, updatedAt: new Date().toISOString() };
    await toothDbRequest('PUT', 'users', { id: userId }, updated);
  },

  mapToProject: (p: any): Project => {
    const colData = p.collections_data || {};
    const derivedColList = Array.from(new Set([
      ...(p.collectionList || []),
      ...Object.keys(colData)
    ]));

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
      collectionList: derivedColList.length > 0 ? derivedColList : ['users'],
      collections_data: colData,
      stats: p.stats || { reads: 0, writes: 0 }
    };
  },

  getProjectsByOwner: async (ownerId: string): Promise<Project[]> => {
    const res = await toothDbRequest('GET', 'projects', { limit: 1000 });
    const rawList = normalizeArray(res);
    return rawList
      .filter((p: any) => !p.isDeleted && !p.deleted && p.status !== 'deleted' && !p._deleted)
      .map(ToothDbClient.mapToProject)
      .filter(p => p.ownerId === ownerId);
  },

  getProjectByApiKey: async (apiKey: string): Promise<Project | null> => {
    if (!apiKey) return null;
    const res = await toothDbRequest('GET', 'projects', { limit: 1000 }).catch(() => []);
    const rawList = normalizeArray(res);
    const found = rawList
      .filter((p: any) => !p.isDeleted && !p.deleted && p.status !== 'deleted' && !p._deleted)
      .map(ToothDbClient.mapToProject)
      .find(p => p.apiKey === apiKey);

    if (found) return found;

    // Auto-provision project for pk_ key if missing
    if (apiKey.startsWith('pk_')) {
      try {
        const autoProj = await ToothDbClient.createProject({
          name: 'Mini PerDB Plugin',
          ownerId: 'usr_c8ui955yxz0tfum1fo92',
          apiKey,
          secretKey: 'sk_live_' + apiKey.slice(8)
        });
        return autoProj;
      } catch (e) {
        return {
          id: 'proj_' + apiKey.slice(-10),
          name: 'PerDB Project',
          ownerId: 'system',
          apiKey,
          secretKey: 'sk_live_' + apiKey.slice(-10),
          permissions: { allowPublicRead: true, allowPublicWrite: true, allowedOrigins: ['*'] },
          rules: '{\n  "global": {\n    ".read": "true",\n    ".write": "true"\n  }\n}',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          collections: [],
          collectionList: ['users', 'default'],
          collections_data: {},
          stats: { reads: 0, writes: 0 }
        };
      }
    }

    return null;
  },

  getProjectById: async (id: string): Promise<Project | null> => {
    const res = await toothDbRequest('GET', 'projects', { limit: 1000 });
    const rawList = normalizeArray(res);
    const found = rawList
      .filter((p: any) => !p.isDeleted && !p.deleted && p.status !== 'deleted' && !p._deleted)
      .map(ToothDbClient.mapToProject)
      .find(p => p.id === id);
    return found || null;
  },

  createProject: async (payload: { name: string; ownerId: string; apiKey: string; secretKey: string }): Promise<Project> => {
    const id = 'prj_' + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();
    const doc = {
      id,
      ...payload,
      permissions: { allowPublicRead: true, allowPublicWrite: false, allowedOrigins: ['*'] },
      rules: '{\n  "global": {\n    ".read": "true",\n    ".write": "true"\n  }\n}',
      collections: [],
      collectionList: ['users'],
      collections_data: {},
      createdAt: now,
      updatedAt: now,
      stats: { reads: 0, writes: 0 }
    };

    await toothDbRequest('POST', 'projects', {}, doc);
    return ToothDbClient.mapToProject(doc);
  },

  updateProject: async (id: string, updates: Partial<Project>): Promise<void> => {
    const res = await toothDbRequest('GET', 'projects', { limit: 1000 }).catch(() => []);
    const rawList = normalizeArray(res);
    const existingRaw = rawList.find((p: any) => (p.id === id || p._id === id || p.docId === id));
    const now = new Date().toISOString();
    const merged = {
      ...(existingRaw || {}),
      ...updates,
      id,
      updatedAt: now
    };

    await toothDbRequest('PUT', 'projects', { id }, merged);
  },

  deleteProject: async (id: string): Promise<void> => {
    // 1. Send DELETE request to projects collection
    await toothDbRequest('DELETE', 'projects', { id });
    // 2. Also send soft-delete update to ensure ToothDB excludes it across all query styles
    try {
      await toothDbRequest('PUT', 'projects', { id }, { 
        id, 
        isDeleted: true, 
        deleted: true, 
        status: 'deleted', 
        updatedAt: new Date().toISOString() 
      });
    } catch (e) {}
  },

  getProjectCollections: async (projectId: string): Promise<Collection[]> => {
    const proj = await ToothDbClient.getProjectById(projectId);
    if (!proj) return [];
    
    const colData = proj.collections_data || {};
    const knownCollectionNames = Array.from(new Set<string>([
      ...(proj.collectionList || []),
      ...Object.keys(colData)
    ]));

    if (knownCollectionNames.length === 0) {
      knownCollectionNames.push('users');
    }

    const cols: Collection[] = [];
    for (const cName of knownCollectionNames) {
      const list = colData[cName] || [];
      const activeList = list.filter((d: any) => !d.isDeleted && !d.deleted && d.status !== 'deleted' && !d._deleted);
      
      const formattedEntries = activeList.map((d: any) => {
        const docId = d.id || d.docId || d._id;
        let payloadData: any = {};
        if (d.data && typeof d.data === 'object' && !Array.isArray(d.data)) {
          payloadData = d.data;
        } else {
          const { id: _id, docId: _dId, _id: _rawId, isDeleted: _isD, deleted: _d, status: _st, _deleted: _uD, createdAt: _cA, updatedAt: _uA, _createdAt: _cAt, _updatedAt: _uAt, data: _dData, ...rest } = d;
          payloadData = rest;
        }
        return {
          id: docId,
          ...payloadData,
          _createdAt: d.createdAt || d._createdAt || d._created || new Date().toISOString(),
          _updatedAt: d.updatedAt || d._updatedAt || new Date().toISOString()
        };
      });

      cols.push({
        name: cName,
        entries: formattedEntries.slice(0, 10),
        totalCount: activeList.length,
        hasLoaded: true
      });
    }

    return cols;
  },

  getCollectionPreview: async (projectId: string, collectionName: string): Promise<Partial<Collection>> => {
    const docs = await ToothDbClient.getDocuments(projectId, collectionName, 10);
    const proj = await ToothDbClient.getProjectById(projectId);
    const colData = proj?.collections_data || {};
    const list = colData[collectionName] || [];
    const activeCount = list.filter((d: any) => !d.isDeleted && !d.deleted && d.status !== 'deleted' && !d._deleted).length;

    return {
      name: collectionName,
      totalCount: Math.max(activeCount, docs.length),
      entries: docs.slice(0, 5),
      hasLoaded: true
    };
  },

  getDocuments: async (projectId: string, collectionName: string, limit: number = 50): Promise<DBEntry[]> => {
    const proj = await ToothDbClient.getProjectById(projectId);
    if (!proj) return [];

    const colData = proj.collections_data || {};
    const list = colData[collectionName] || [];
    const activeList = list.filter((d: any) => !d.isDeleted && !d.deleted && d.status !== 'deleted' && !d._deleted);

    const formatted: DBEntry[] = activeList.map((d: any) => {
      const docId = d.id || d.docId || d._id || ('doc_' + Math.random().toString(36).substring(2, 8));
      let payloadData: any = {};
      if (d.data && typeof d.data === 'object' && !Array.isArray(d.data)) {
        payloadData = d.data;
      } else {
        const { id: _id, docId: _dId, _id: _rawId, isDeleted: _isD, deleted: _d, status: _st, _deleted: _uD, createdAt: _cA, updatedAt: _uA, _createdAt: _cAt, _updatedAt: _uAt, data: _dData, ...rest } = d;
        payloadData = rest;
      }
      return {
        id: docId,
        ...payloadData,
        _createdAt: d.createdAt || d._createdAt || d._created || new Date().toISOString(),
        _updatedAt: d.updatedAt || d._updatedAt || new Date().toISOString()
      };
    });

    ToothDbClient.incrementStats(projectId, 1, 0).catch(() => {});

    return formatted.slice(0, limit);
  },

  addDocument: async (projectId: string, collectionName: string, docId: string, data: any): Promise<string> => {
    const finalDocId = docId || ('doc_' + Math.random().toString(36).substring(2, 10));
    const now = new Date().toISOString();

    // Fetch the raw project document directly from ToothDB 'projects' collection
    const res = await toothDbRequest('GET', 'projects', { limit: 1000 }).catch(() => []);
    const rawList = normalizeArray(res);
    let rawProj = rawList.find((p: any) => (
      p.id === projectId || p._id === projectId || p.docId === projectId || p.apiKey === projectId
    ));

    if (!rawProj) {
      rawProj = {
        id: projectId,
        ownerId: 'usr_c8ui955yxz0tfum1fo92',
        name: 'PerDB Project',
        apiKey: projectId.startsWith('pk_') ? projectId : `pk_live_${projectId}`,
        secretKey: `sk_live_${projectId}`,
        permissions: { allowPublicRead: true, allowPublicWrite: true, allowedOrigins: ['*'] },
        rules: '{\n  "global": {\n    ".read": "true",\n    ".write": "true"\n  }\n}',
        collectionList: [collectionName],
        collections_data: {},
        createdAt: now,
        updatedAt: now,
        stats: { reads: 0, writes: 0 }
      };
    }

    const collectionsData = { ...(rawProj.collections_data || {}) };
    const currentEntries: any[] = Array.isArray(collectionsData[collectionName]) 
      ? [...collectionsData[collectionName]] 
      : [];

    const dataObj = (typeof data === 'object' && data !== null) ? data : { value: data };

    // Check for existing document in this collection
    const existingIndex = currentEntries.findIndex((e: any) => (e.id === finalDocId || e.docId === finalDocId || e._id === finalDocId));
    const existingDoc = existingIndex >= 0 ? currentEntries[existingIndex] : null;

    const docEntry = {
      id: finalDocId,
      docId: finalDocId,
      ...dataObj,
      createdAt: existingDoc?.createdAt || existingDoc?._createdAt || now,
      updatedAt: now,
      isDeleted: false
    };

    if (existingIndex >= 0) {
      currentEntries[existingIndex] = docEntry;
    } else {
      currentEntries.unshift(docEntry);
    }

    collectionsData[collectionName] = currentEntries;

    const updatedCollectionList = Array.from(new Set([
      ...(rawProj.collectionList || []),
      collectionName
    ]));

    const updatedStats = {
      reads: rawProj.stats?.reads || 0,
      writes: (rawProj.stats?.writes || 0) + 1
    };

    const updatedProj = {
      ...rawProj,
      collectionList: updatedCollectionList,
      collections_data: collectionsData,
      stats: updatedStats,
      updatedAt: now
    };

    // Save strictly to ToothDB
    await saveProjectToToothDb(updatedProj);

    return finalDocId;
  },

  deleteDocument: async (projectId: string, collectionName: string, docId: string): Promise<void> => {
    const res = await toothDbRequest('GET', 'projects', { limit: 1000 }).catch(() => []);
    const rawList = normalizeArray(res);
    const rawProj = rawList.find((p: any) => (p.id === projectId || p._id === projectId || p.docId === projectId || p.apiKey === projectId));

    if (!rawProj) return;

    const collectionsData = { ...(rawProj.collections_data || {}) };
    if (!collectionsData[collectionName]) return;

    const currentEntries: any[] = Array.isArray(collectionsData[collectionName]) 
      ? [...collectionsData[collectionName]] 
      : [];

    const filtered = currentEntries.filter((e: any) => (e.id !== docId && e.docId !== docId && e._id !== docId));
    collectionsData[collectionName] = filtered;

    const updatedStats = {
      reads: rawProj.stats?.reads || 0,
      writes: (rawProj.stats?.writes || 0) + 1
    };

    const updatedProj = {
      ...rawProj,
      collections_data: collectionsData,
      stats: updatedStats,
      updatedAt: new Date().toISOString()
    };

    await saveProjectToToothDb(updatedProj);
  },

  incrementStats: async (projectId: string, reads: number, writes: number): Promise<void> => {
    try {
      const res = await toothDbRequest('GET', 'projects', { limit: 1000 }).catch(() => []);
      const rawList = normalizeArray(res);
      const rawProj = rawList.find((p: any) => (p.id === projectId || p._id === projectId || p.docId === projectId || p.apiKey === projectId));
      if (rawProj) {
        const updatedStats = {
          reads: (rawProj.stats?.reads || 0) + reads,
          writes: (rawProj.stats?.writes || 0) + writes
        };
        await saveProjectToToothDb({
          ...rawProj,
          stats: updatedStats,
          updatedAt: new Date().toISOString()
        });
      }
    } catch (e: any) {
      // Non-blocking
    }
  },

  getFeedback: async (): Promise<any[]> => {
    const res = await toothDbRequest('GET', 'feedback', { limit: 1000 });
    return normalizeArray(res);
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
