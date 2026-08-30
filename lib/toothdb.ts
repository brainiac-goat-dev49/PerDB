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
    const res = await toothDbRequest('GET', 'projects', { limit: 1000 });
    const rawList = normalizeArray(res);
    return rawList
      .filter((p: any) => !p.isDeleted && !p.deleted && p.status !== 'deleted' && !p._deleted)
      .map(ToothDbClient.mapToProject)
      .filter(p => p.ownerId === ownerId);
  },

  getProjectByApiKey: async (apiKey: string): Promise<Project | null> => {
    const res = await toothDbRequest('GET', 'projects', { limit: 1000 });
    const rawList = normalizeArray(res);
    const found = rawList
      .filter((p: any) => !p.isDeleted && !p.deleted && p.status !== 'deleted' && !p._deleted)
      .map(ToothDbClient.mapToProject)
      .find(p => p.apiKey === apiKey);
    return found || null;
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
    // 1. Send DELETE request
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
    const knownCollectionNames = Array.from(new Set<string>(proj.collectionList || []));

    const cols: Collection[] = await Promise.all(
      knownCollectionNames.map(async (cName) => {
        const docs = await ToothDbClient.getDocuments(projectId, cName, 1000).catch(() => []);
        return {
          name: cName,
          entries: [],
          totalCount: docs.length,
          hasLoaded: false
        };
      })
    );

    return cols;
  },

  getCollectionPreview: async (projectId: string, collectionName: string): Promise<Partial<Collection>> => {
    const docs = await ToothDbClient.getDocuments(projectId, collectionName, 10);
    return {
      name: collectionName,
      totalCount: docs.length,
      entries: docs.slice(0, 5),
      hasLoaded: true
    };
  },

  getDocuments: async (projectId: string, collectionName: string, limit: number = 50): Promise<DBEntry[]> => {
    const scopedCollection = `${projectId}_${collectionName}`;

    // 1. Fetch documents directly from project-scoped ToothDB collection
    const resScoped = await toothDbRequest('GET', scopedCollection, { limit: 1000 }).catch(() => []);
    const docsScoped = normalizeArray(resScoped);

    // 2. Fetch documents from un-prefixed collection for backward compatibility if scoped is empty
    let docsUnprefixed: any[] = [];
    if (docsScoped.length === 0) {
      const resUnprefixed = await toothDbRequest('GET', collectionName, { limit: 1000 }).catch(() => []);
      docsUnprefixed = normalizeArray(resUnprefixed);
    }

    const combinedRaw = [...docsScoped, ...docsUnprefixed];
    const seen = new Set<string>();
    const filtered: DBEntry[] = [];

    for (const d of combinedRaw) {
      if (!d || typeof d !== 'object') continue;
      const isDeleted = d.isDeleted || d.deleted || d.status === 'deleted' || d._deleted;
      if (isDeleted) continue;

      const pId = d.perdbProjectId || d.projectId;
      const cName = d.perdbCollectionName || d.collectionName || collectionName;

      const isProjectMatch = !pId || pId === projectId || (d.docKey && d.docKey.startsWith(projectId));
      const isCollectionMatch = cName === collectionName || (d.docKey && d.docKey.includes(`_${collectionName}_`));

      if (isProjectMatch && isCollectionMatch) {
        const docId = d.docId || d.id || d._id;
        if (!docId || docId === 'projects' || docId === 'users') continue;

        const dedupeKey = `${projectId}_${collectionName}_${docId}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);

          // Extract inner data fields cleanly
          const {
            id, docId: _docId, docKey: _docKey, perdbProjectId, perdbCollectionName,
            projectId: _pId, collectionName: _cName, isDeleted: _isDel, deleted: _del,
            status: _st, _deleted: _uDel, _created, createdAt, updatedAt, data: innerData,
            ...restFields
          } = d;

          const payloadData = (innerData && typeof innerData === 'object') ? innerData : restFields;

          filtered.push({
            id: docId,
            ...payloadData,
            _createdAt: createdAt || _created || d._createdAt || new Date().toISOString(),
            _updatedAt: updatedAt || d._updatedAt || new Date().toISOString()
          });
        }
      }
    }

    return filtered.slice(0, limit);
  },

  addDocument: async (projectId: string, collectionName: string, docId: string, data: any): Promise<string> => {
    const finalDocId = docId || ('doc_' + Math.random().toString(36).substring(2, 10));
    const now = new Date().toISOString();
    const docKey = `${projectId}_${collectionName}_${finalDocId}`;
    const scopedCollection = `${projectId}_${collectionName}`;

    const dataObj = (typeof data === 'object' && data !== null) ? data : { value: data };

    const payload = {
      id: finalDocId,
      docId: finalDocId,
      docKey,
      perdbProjectId: projectId,
      perdbCollectionName: collectionName,
      ...dataObj,
      data: dataObj,
      isDeleted: false,
      deleted: false,
      createdAt: now,
      updatedAt: now
    };

    // Post exclusively to project-scoped ToothDB collection
    await toothDbRequest('POST', scopedCollection, {}, payload);

    // Register collectionName in project's collectionList if missing
    try {
      const proj = await ToothDbClient.getProjectById(projectId);
      if (proj && (!proj.collectionList || !proj.collectionList.includes(collectionName))) {
        const updatedList = Array.from(new Set([...(proj.collectionList || []), collectionName]));
        await ToothDbClient.updateProject(projectId, { collectionList: updatedList });
      }
    } catch (e) {}

    // Increment stats
    ToothDbClient.incrementStats(projectId, 0, 1).catch(() => {});

    // Read-back verification to guarantee durable commitment
    const verifyDocs = await ToothDbClient.getDocuments(projectId, collectionName, 1000);
    const exists = verifyDocs.some(d => d.id === finalDocId || (d as any).docId === finalDocId || (d as any).docKey === docKey);
    if (!exists) {
      await sleep(300);
      const retryDocs = await ToothDbClient.getDocuments(projectId, collectionName, 1000);
      const retryExists = retryDocs.some(d => d.id === finalDocId || (d as any).docId === finalDocId || (d as any).docKey === docKey);
      if (!retryExists) {
        throw new Error(`Durable write verification failed for collection '${collectionName}': document '${finalDocId}' was not committed to ToothDB store`);
      }
    }

    return finalDocId;
  },

  deleteDocument: async (projectId: string, collectionName: string, docId: string): Promise<void> => {
    const scopedCollection = `${projectId}_${collectionName}`;
    await toothDbRequest('DELETE', scopedCollection, { id: docId }).catch(() => {});
    await toothDbRequest('DELETE', collectionName, { id: docId }).catch(() => {});
    try {
      const softDeletePayload = {
        id: docId,
        projectId,
        collectionName,
        docId,
        isDeleted: true,
        deleted: true,
        status: 'deleted',
        updatedAt: new Date().toISOString()
      };
      await toothDbRequest('PUT', scopedCollection, { id: docId }, softDeletePayload).catch(() => {});
      await toothDbRequest('PUT', collectionName, { id: docId }, softDeletePayload).catch(() => {});
    } catch (e) {}
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
