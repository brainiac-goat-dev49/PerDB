import pg from 'pg';
import { Project, DBEntry, Collection } from '../types';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let isInitialized = false;

export function getPostgresPool(): pg.Pool | null {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return null;
  }

  try {
    pool = new Pool({
      connectionString,
      ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1') 
        ? false 
        : { rejectUnauthorized: false } // Required for secure hosted DBs on Railway, Heroku, etc.
    });

    pool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client', err);
    });

    return pool;
  } catch (error) {
    console.error('Failed to initialize PostgreSQL pool:', error);
    return null;
  }
}

// Automatically create tables if they do not exist
export async function initializePostgres(): Promise<boolean> {
  if (isInitialized) return true;
  
  const clientPool = getPostgresPool();
  if (!clientPool) {
    return false;
  }

  try {
    console.log('[Postgres] Initializing schema...');
    
    // 1. Users Table
    await clientPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT,
        display_name TEXT,
        photo_url TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        is_banned BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Projects Table
    await clientPool.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        api_key TEXT UNIQUE NOT NULL,
        secret_key TEXT NOT NULL,
        permissions JSONB NOT NULL DEFAULT '{"allowPublicRead": true, "allowPublicWrite": false, "allowedOrigins": []}'::jsonb,
        rules TEXT NOT NULL DEFAULT '{}',
        stats JSONB NOT NULL DEFAULT '{"reads": 0, "writes": 0}'::jsonb,
        collection_list JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Documents Table
    await clientPool.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        collection_name TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Feedback Table
    await clientPool.query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT,
        message TEXT,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Indexes for fast querying
    await clientPool.query(`
      CREATE INDEX IF NOT EXISTS idx_projects_api_key ON projects(api_key);
      CREATE INDEX IF NOT EXISTS idx_documents_project_collection ON documents(project_id, collection_name);
      CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at DESC);
    `);

    console.log('[Postgres] Schema verification and initialization succeeded.');
    isInitialized = true;
    return true;
  } catch (error) {
    console.error('[Postgres] Critical initialization error:', error);
    return false;
  }
}

// Map PostgreSQL row to frontend/SDK standard model
function rowToProject(row: any): Project {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    apiKey: row.api_key,
    secretKey: row.secret_key,
    permissions: row.permissions || { allowPublicRead: true, allowPublicWrite: false, allowedOrigins: [] },
    rules: row.rules || '{}',
    stats: row.stats || { reads: 0, writes: 0 },
    collections: [],
    collectionList: row.collection_list || [],
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString()
  };
}

export const PostgresService = {
  isActive: () => {
    return !!process.env.DATABASE_URL;
  },

  // --- Project Operations ---
  getProjectByApiKey: async (apiKey: string): Promise<Project | null> => {
    const clientPool = getPostgresPool();
    if (!clientPool) return null;

    const res = await clientPool.query('SELECT * FROM projects WHERE api_key = $1 LIMIT 1', [apiKey]);
    if (res.rows.length === 0) return null;
    return rowToProject(res.rows[0]);
  },

  getProjectById: async (id: string): Promise<Project | null> => {
    const clientPool = getPostgresPool();
    if (!clientPool) return null;

    const res = await clientPool.query('SELECT * FROM projects WHERE id = $1 LIMIT 1', [id]);
    if (res.rows.length === 0) return null;
    return rowToProject(res.rows[0]);
  },

  getProjectsByOwner: async (ownerId: string): Promise<Project[]> => {
    const clientPool = getPostgresPool();
    if (!clientPool) return [];

    const res = await clientPool.query('SELECT * FROM projects WHERE owner_id = $1 ORDER BY created_at DESC', [ownerId]);
    return res.rows.map(rowToProject);
  },

  createProject: async (project: Omit<Project, 'collections' | 'createdAt' | 'updatedAt'>): Promise<Project> => {
    const clientPool = getPostgresPool();
    if (!clientPool) throw new Error('Database not connected');

    const now = new Date().toISOString();
    await clientPool.query(
      `INSERT INTO projects (id, owner_id, name, api_key, secret_key, permissions, rules, stats, collection_list, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        project.id,
        project.ownerId,
        project.name,
        project.apiKey,
        project.secretKey,
        JSON.stringify(project.permissions),
        project.rules,
        JSON.stringify(project.stats),
        JSON.stringify(project.collectionList),
        now,
        now
      ]
    );

    return {
      ...project,
      collections: [],
      createdAt: now,
      updatedAt: now
    };
  },

  updateProject: async (id: string, updates: Partial<Project>): Promise<void> => {
    const clientPool = getPostgresPool();
    if (!clientPool) throw new Error('Database not connected');

    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.permissions !== undefined) {
      fields.push(`permissions = $${paramIndex++}`);
      values.push(JSON.stringify(updates.permissions));
    }
    if (updates.rules !== undefined) {
      fields.push(`rules = $${paramIndex++}`);
      values.push(updates.rules);
    }
    if (updates.stats !== undefined) {
      fields.push(`stats = $${paramIndex++}`);
      values.push(JSON.stringify(updates.stats));
    }
    if (updates.collectionList !== undefined) {
      fields.push(`collection_list = $${paramIndex++}`);
      values.push(JSON.stringify(updates.collectionList));
    }

    if (fields.length === 0) return;

    fields.push(`updated_at = $${paramIndex++}`);
    values.push(new Date().toISOString());

    values.push(id);
    const queryStr = `UPDATE projects SET ${fields.join(', ')} WHERE id = $${paramIndex}`;
    await clientPool.query(queryStr, values);
  },

  deleteProject: async (id: string): Promise<void> => {
    const clientPool = getPostgresPool();
    if (!clientPool) throw new Error('Database not connected');

    await clientPool.query('DELETE FROM projects WHERE id = $1', [id]);
  },

  incrementStats: async (id: string, reads: number, writes: number): Promise<void> => {
    const clientPool = getPostgresPool();
    if (!clientPool) return;

    await clientPool.query(
      `UPDATE projects 
       SET stats = jsonb_build_object(
         'reads', COALESCE((stats->>'reads')::int, 0) + $1,
         'writes', COALESCE((stats->>'writes')::int, 0) + $2
       ),
       updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [reads, writes, id]
    );
  },

  // --- Document Operations ---
  getDocument: async (projectId: string, collectionName: string, docId: string): Promise<any | null> => {
    const clientPool = getPostgresPool();
    if (!clientPool) return null;

    const res = await clientPool.query(
      'SELECT * FROM documents WHERE project_id = $1 AND collection_name = $2 AND id = $3 LIMIT 1',
      [projectId, collectionName, docId]
    );
    if (res.rows.length === 0) return null;
    
    const docRow = res.rows[0];
    return {
      id: docRow.id,
      ...docRow.data,
      _created: docRow.created_at ? new Date(docRow.created_at).toISOString() : undefined,
      _updated: docRow.updated_at ? new Date(docRow.updated_at).toISOString() : undefined
    };
  },

  getDocuments: async (projectId: string, collectionName: string, limitVal: number): Promise<any[]> => {
    const clientPool = getPostgresPool();
    if (!clientPool) return [];

    const res = await clientPool.query(
      'SELECT * FROM documents WHERE project_id = $1 AND collection_name = $2 ORDER BY created_at DESC LIMIT $3',
      [projectId, collectionName, limitVal]
    );
    return res.rows.map(row => ({
      id: row.id,
      ...row.data,
      _created: row.created_at ? new Date(row.created_at).toISOString() : undefined,
      _updated: row.updated_at ? new Date(row.updated_at).toISOString() : undefined
    }));
  },

  addDocument: async (projectId: string, collectionName: string, docId: string, data: any): Promise<void> => {
    const clientPool = getPostgresPool();
    if (!clientPool) throw new Error('Database not connected');

    const now = new Date().toISOString();
    await clientPool.query(
      `INSERT INTO documents (id, project_id, collection_name, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [docId, projectId, collectionName, JSON.stringify(data), now, now]
    );

    // Ensure collection is in collection_list metadata
    const projRes = await clientPool.query('SELECT collection_list FROM projects WHERE id = $1', [projectId]);
    if (projRes.rows.length > 0) {
      const list: string[] = projRes.rows[0].collection_list || [];
      if (!list.includes(collectionName)) {
        list.push(collectionName);
        await clientPool.query('UPDATE projects SET collection_list = $1 WHERE id = $2', [JSON.stringify(list), projectId]);
      }
    }
  },

  updateDocument: async (projectId: string, collectionName: string, docId: string, updates: any): Promise<void> => {
    const clientPool = getPostgresPool();
    if (!clientPool) throw new Error('Database not connected');

    const existingRes = await clientPool.query(
      'SELECT data FROM documents WHERE project_id = $1 AND collection_name = $2 AND id = $3',
      [projectId, collectionName, docId]
    );
    if (existingRes.rows.length === 0) throw new Error('Document not found');

    const currentData = existingRes.rows[0].data || {};
    const mergedData = { ...currentData, ...updates };

    await clientPool.query(
      'UPDATE documents SET data = $1, updated_at = $2 WHERE project_id = $3 AND collection_name = $4 AND id = $5',
      [JSON.stringify(mergedData), new Date().toISOString(), projectId, collectionName, docId]
    );
  },

  deleteDocument: async (projectId: string, collectionName: string, docId: string): Promise<void> => {
    const clientPool = getPostgresPool();
    if (!clientPool) throw new Error('Database not connected');

    await clientPool.query(
      'DELETE FROM documents WHERE project_id = $1 AND collection_name = $2 AND id = $3',
      [projectId, collectionName, docId]
    );
  },

  getCollectionCount: async (projectId: string, collectionName: string): Promise<number> => {
    const clientPool = getPostgresPool();
    if (!clientPool) return 0;

    const res = await clientPool.query(
      'SELECT COUNT(*) FROM documents WHERE project_id = $1 AND collection_name = $2',
      [projectId, collectionName]
    );
    return parseInt(res.rows[0].count, 10);
  },

  // --- Feedback Operations ---
  addFeedback: async (feedback: { id: string; name: string; email: string; message: string; timestamp: string }): Promise<void> => {
    const clientPool = getPostgresPool();
    if (!clientPool) throw new Error('Database not connected');

    await clientPool.query(
      'INSERT INTO feedback (id, name, email, message, timestamp) VALUES ($1, $2, $3, $4, $5)',
      [feedback.id, feedback.name, feedback.email, feedback.message, feedback.timestamp]
    );
  },

  getAllFeedback: async (): Promise<any[]> => {
    const clientPool = getPostgresPool();
    if (!clientPool) return [];

    const res = await clientPool.query('SELECT * FROM feedback ORDER BY timestamp DESC');
    return res.rows;
  },

  deleteFeedback: async (id: string): Promise<void> => {
    const clientPool = getPostgresPool();
    if (!clientPool) throw new Error('Database not connected');

    await clientPool.query('DELETE FROM feedback WHERE id = $1', [id]);
  },

  // --- User Operations ---
  syncUser: async (user: { id: string; email: string; displayName: string; photoURL: string; role: string }): Promise<void> => {
    const clientPool = getPostgresPool();
    if (!clientPool) throw new Error('Database not connected');

    const bannedRes = await clientPool.query('SELECT is_banned FROM users WHERE id = $1 AND is_banned = true', [user.id]);
    if (bannedRes.rows.length > 0) {
      throw new Error('This account has been permanently banned from PerDB.');
    }

    const now = new Date().toISOString();
    await clientPool.query(
      `INSERT INTO users (id, email, display_name, photo_url, role, is_banned, created_at, last_login)
       VALUES ($1, $2, $3, $4, $5, false, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         display_name = EXCLUDED.display_name,
         photo_url = EXCLUDED.photo_url,
         last_login = EXCLUDED.last_login`,
      [user.id, user.email, user.displayName, user.photoURL, user.role, now, now]
    );
  },

  isUserBanned: async (id: string): Promise<boolean> => {
    const clientPool = getPostgresPool();
    if (!clientPool) return false;

    const res = await clientPool.query('SELECT is_banned FROM users WHERE id = $1 LIMIT 1', [id]);
    if (res.rows.length === 0) return false;
    return !!res.rows[0].is_banned;
  },

  getAllUsers: async (): Promise<any[]> => {
    const clientPool = getPostgresPool();
    if (!clientPool) return [];

    const res = await clientPool.query('SELECT * FROM users ORDER BY last_login DESC');
    return res.rows.map(row => ({
      uid: row.id,
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      photoURL: row.photo_url,
      role: row.role,
      isBanned: row.is_banned,
      createdAt: row.created_at,
      lastLogin: row.last_login
    }));
  },

  updateUserStatus: async (userId: string, isBanned: boolean): Promise<void> => {
    const clientPool = getPostgresPool();
    if (!clientPool) throw new Error('Database not connected');

    await clientPool.query('UPDATE users SET is_banned = $1 WHERE id = $2', [isBanned, userId]);
  }
};
