import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { ToothDbClient } from './lib/toothdb.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to authenticate user from Bearer token
async function getAuthenticatedUser(req: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Unauthorized: Missing token');
  }
  const token = authHeader.split('Bearer ')[1];

  try {
    const payloadStr = Buffer.from(token, 'base64').toString('utf-8');
    const payload = JSON.parse(payloadStr);
    if (!payload.uid && !payload.id) {
      throw new Error('Invalid token payload');
    }
    return {
      uid: payload.uid || payload.id,
      email: payload.email || '',
      displayName: payload.displayName || payload.name || '',
      role: payload.role || (payload.email === 'testimonyfresh49@gmail.com' ? 'admin' : 'user')
    };
  } catch (e) {
    throw new Error('Unauthorized: Invalid token');
  }
}

// In-memory cache for GET requests & project lookup
const projectCache = new Map<string, { doc: any, timestamp: number }>();
const PROJECT_CACHE_TTL = 300000; // 5 mins

// Rate limiter
const rateLimit = new Map<string, { count: number, lastReset: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 min
const MAX_REQUESTS_PER_WINDOW = 60; // 60 reqs/min

// Stats Buffering
const statsBuffer = new Map<string, { reads: number, writes: number }>();
const STATS_FLUSH_INTERVAL = 60000;

function flushStats() {
  if (statsBuffer.size === 0) return;
  console.log(`[Stats] Flushing stats for ${statsBuffer.size} projects to ToothDB...`);
  statsBuffer.forEach(async (stats, projectId) => {
    try {
      await ToothDbClient.incrementStats(projectId, stats.reads, stats.writes);
    } catch (e) {
      console.error(`[Stats] Failed to flush stats for ${projectId}:`, e);
    }
  });
  statsBuffer.clear();
}

setInterval(flushStats, STATS_FLUSH_INTERVAL);

async function startServer() {
  console.log("--- Starting PerDB Server (ToothDB Native Auth & Storage) ---");
  console.log(`Node Version: ${process.version}`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);

  const app = express();
  const PORT = process.env.PORT || 3000;

  // Middleware
  app.use(cors({ origin: true }));
  app.use(bodyParser.json());

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", database: "ToothDB", env: process.env.NODE_ENV });
  });

  // Config
  app.get("/api/config", (req, res) => {
    res.json({ usePostgres: false, useToothDb: true });
  });

  // Native Auth: Register
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password, displayName } = req.body;
      if (!email || !password || !displayName) {
        return res.status(400).json({ error: 'Email, password, and display name are required' });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: 'Password should be at least 6 characters' });
      }

      const cleanEmail = email.toLowerCase().trim();

      const isBanned = await ToothDbClient.isUserBanned('', cleanEmail);
      if (isBanned) {
        return res.status(403).json({ error: 'This email is permanently banned from PerDB.' });
      }

      const users = await ToothDbClient.getAllUsers();
      const existing = users.find((u: any) => u.email?.toLowerCase() === cleanEmail);
      if (existing) {
        return res.status(400).json({ error: 'Email already in use' });
      }

      const uid = 'usr_' + Math.random().toString(36).substring(2, 12) + Math.random().toString(36).substring(2, 12);
      const role = cleanEmail === 'testimonyfresh49@gmail.com' ? 'admin' : 'user';

      const newUser = {
        id: uid,
        email: cleanEmail,
        displayName,
        password,
        role,
        isBanned: false,
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString()
      };

      await ToothDbClient.syncUser(newUser);

      const tokenPayload = { uid, email: cleanEmail, displayName, role };
      const token = Buffer.from(JSON.stringify(tokenPayload)).toString('base64');

      res.json({
        token,
        user: tokenPayload
      });
    } catch (error: any) {
      console.error("Register Error:", error);
      res.status(500).json({ error: error.message || 'Registration failed' });
    }
  });

  // Native Auth: Login
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const cleanEmail = email.toLowerCase().trim();

      const users = await ToothDbClient.getAllUsers();
      const user = users.find((u: any) => u.email?.toLowerCase() === cleanEmail);

      if (!user) {
        return res.status(400).json({ error: 'Invalid email or password' });
      }

      if (user.password && user.password !== password) {
        return res.status(400).json({ error: 'Invalid email or password' });
      }

      const uid = user.id || user._id;

      const isBanned = await ToothDbClient.isUserBanned(uid, cleanEmail);
      if (isBanned || user.isBanned) {
        return res.status(403).json({ error: 'This account has been permanently banned from PerDB.' });
      }

      const role = cleanEmail === 'testimonyfresh49@gmail.com' ? 'admin' : (user.role || 'user');
      const displayName = user.displayName || 'User';

      await ToothDbClient.updateUser(uid, { lastLogin: new Date().toISOString() });

      const tokenPayload = { uid, email: cleanEmail, displayName, role };
      const token = Buffer.from(JSON.stringify(tokenPayload)).toString('base64');

      res.json({
        token,
        user: tokenPayload
      });
    } catch (error: any) {
      console.error("Login Error:", error);
      res.status(500).json({ error: error.message || 'Login failed' });
    }
  });

  // User Sync
  app.post("/api/user/sync", async (req, res) => {
    try {
      const decoded = await getAuthenticatedUser(req);
      const { uid, email, displayName } = decoded;
      const userEmail = email || '';

      const isBanned = await ToothDbClient.isUserBanned(uid, userEmail);
      if (isBanned) {
        return res.status(403).json({ error: 'This account has been permanently banned from PerDB.' });
      }

      await ToothDbClient.syncUser({
        id: uid,
        email: userEmail,
        displayName: displayName || 'User',
        role: userEmail === 'testimonyfresh49@gmail.com' ? 'admin' : 'user'
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Sync User Error:", error);
      res.status(500).json({ error: error.message || 'Failed to sync user' });
    }
  });

  // Projects CRUD
  app.get("/api/projects", async (req, res) => {
    try {
      const decoded = await getAuthenticatedUser(req);
      const projects = await ToothDbClient.getProjectsByOwner(decoded.uid);
      res.json(projects);
    } catch (error: any) {
      console.error("Get Projects Error:", error);
      res.status(500).json({ error: error.message || 'Failed to fetch projects' });
    }
  });

  app.post("/api/projects", async (req, res) => {
    try {
      const decoded = await getAuthenticatedUser(req);
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: 'Missing project name' });

      const existing = await ToothDbClient.getProjectsByOwner(decoded.uid);
      if (existing.length >= 5) {
        return res.status(400).json({ error: 'Project Limit Reached: You can only have up to 5 projects. Please delete an existing project to create a new one.' });
      }

      const newProjId = Math.random().toString(36).substring(2, 12) + Math.random().toString(36).substring(2, 12);
      const apiKey = `pk_live_${Math.random().toString(36).substr(2, 16)}`;
      const secretKey = `sk_live_${Math.random().toString(36).substr(2, 16)}`;

      const newProject = {
        id: newProjId,
        ownerId: decoded.uid,
        name,
        apiKey,
        secretKey,
        permissions: {
          allowPublicRead: true,
          allowPublicWrite: false,
          allowedOrigins: ['perchance.org']
        },
        rules: `{
  "global": {
    ".read": "true",
    ".write": "true"
  },
  "scores": {
    ".read": "true",
    ".write": "newData.score > 0"
  }
}`,
        collectionList: [],
        stats: { reads: 0, writes: 0 }
      };

      const created = await ToothDbClient.createProject(newProject);
      res.json(created);
    } catch (error: any) {
      console.error("Create Project Error:", error);
      res.status(500).json({ error: error.message || 'Failed to create project' });
    }
  });

  app.put("/api/projects/:id", async (req, res) => {
    try {
      const decoded = await getAuthenticatedUser(req);
      const { id } = req.params;
      const { name, permissions, rules, stats, collectionList } = req.body;

      const proj = await ToothDbClient.getProjectById(id);
      if (!proj || proj.ownerId !== decoded.uid) {
        return res.status(403).json({ error: 'Forbidden or Project not found' });
      }

      const cleanData: any = {};
      if (name !== undefined) cleanData.name = name;
      if (permissions !== undefined) cleanData.permissions = permissions;
      if (rules !== undefined) cleanData.rules = rules;
      if (stats !== undefined) cleanData.stats = stats;
      if (collectionList !== undefined) cleanData.collectionList = collectionList;

      await ToothDbClient.updateProject(id, cleanData);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Update Project Error:", error);
      res.status(500).json({ error: error.message || 'Failed to update project' });
    }
  });

  app.delete("/api/projects/:id", async (req, res) => {
    try {
      const decoded = await getAuthenticatedUser(req);
      const { id } = req.params;

      const proj = await ToothDbClient.getProjectById(id);
      if (!proj || proj.ownerId !== decoded.uid) {
        return res.status(403).json({ error: 'Forbidden or Project not found' });
      }

      await ToothDbClient.deleteProject(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete Project Error:", error);
      res.status(500).json({ error: error.message || 'Failed to delete project' });
    }
  });

  app.get("/api/projects/:id/collections", async (req, res) => {
    try {
      const decoded = await getAuthenticatedUser(req);
      const { id } = req.params;

      const proj = await ToothDbClient.getProjectById(id);
      if (!proj || proj.ownerId !== decoded.uid) {
        return res.status(403).json({ error: 'Forbidden or Project not found' });
      }

      const cols = await ToothDbClient.getProjectCollections(id);
      res.json(cols);
    } catch (error: any) {
      console.error("Get Collections Error:", error);
      res.status(500).json({ error: error.message || 'Failed to get collections' });
    }
  });

  app.get("/api/projects/:id/collections/:colName", async (req, res) => {
    try {
      const decoded = await getAuthenticatedUser(req);
      const { id, colName } = req.params;

      const proj = await ToothDbClient.getProjectById(id);
      if (!proj || proj.ownerId !== decoded.uid) {
        return res.status(403).json({ error: 'Forbidden or Project not found' });
      }

      const preview = await ToothDbClient.getCollectionPreview(id, colName);
      res.json(preview);
    } catch (error: any) {
      console.error("Get Collection Preview Error:", error);
      res.status(500).json({ error: error.message || 'Failed to get collection preview' });
    }
  });

  app.get("/api/projects/:id/collections/:colName/full", async (req, res) => {
    try {
      const decoded = await getAuthenticatedUser(req);
      const { id, colName } = req.params;
      const limitCount = parseInt(req.query.limit as string) || 50;

      const proj = await ToothDbClient.getProjectById(id);
      if (!proj || proj.ownerId !== decoded.uid) {
        return res.status(403).json({ error: 'Forbidden or Project not found' });
      }

      const entries = await ToothDbClient.getDocuments(id, colName, limitCount);
      res.json({ entries, lastDoc: null });
    } catch (error: any) {
      console.error("Get Full Collection Error:", error);
      res.status(500).json({ error: error.message || 'Failed to get full collection' });
    }
  });

  // Admin Routes
  app.get("/api/admin/users", async (req, res) => {
    try {
      const decoded = await getAuthenticatedUser(req);
      if (decoded.email !== 'testimonyfresh49@gmail.com') {
        return res.status(403).json({ error: 'Forbidden: Admin access only' });
      }
      const users = await ToothDbClient.getAllUsers();
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });

  app.get("/api/admin/feedback", async (req, res) => {
    try {
      const decoded = await getAuthenticatedUser(req);
      if (decoded.email !== 'testimonyfresh49@gmail.com') {
        return res.status(403).json({ error: 'Forbidden: Admin access only' });
      }
      const feedback = await ToothDbClient.getFeedback();
      res.json(feedback);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch feedback' });
    }
  });

  app.post("/api/admin/update-user", async (req, res) => {
    try {
      const decoded = await getAuthenticatedUser(req);
      if (decoded.email !== 'testimonyfresh49@gmail.com') {
        return res.status(403).json({ error: 'Forbidden: Admin access only' });
      }
      const { userId, updates } = req.body;
      await ToothDbClient.updateUser(userId, updates);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update user' });
    }
  });

  app.post("/api/admin/delete-user-full", async (req, res) => {
    try {
      const decoded = await getAuthenticatedUser(req);
      if (decoded.email !== 'testimonyfresh49@gmail.com') {
        return res.status(403).json({ error: 'Forbidden: Admin access only' });
      }
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: 'Missing User ID' });

      const user = await ToothDbClient.getUser(userId);
      if (user?.email) {
        await ToothDbClient.banEmail(user.email, 'Full account deletion by admin');
      }

      const projects = await ToothDbClient.getProjectsByOwner(userId);
      for (const p of projects) {
        await ToothDbClient.deleteProject(p.id);
      }

      await ToothDbClient.updateUser(userId, { isBanned: true, isDeleted: true });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to perform full user deletion' });
    }
  });

  app.post("/api/feedback", async (req, res) => {
    try {
      const { name, email, message } = req.body;
      if (!message) return res.status(400).json({ error: 'Message is required' });
      await ToothDbClient.addFeedback({ name, email, message });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to save feedback' });
    }
  });

  app.post("/api/admin/send-reset-link", async (req, res) => {
    try {
      const decoded = await getAuthenticatedUser(req);
      if (decoded.email !== 'testimonyfresh49@gmail.com') {
        return res.status(403).json({ error: 'Forbidden: Admin access only' });
      }
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Missing email' });
      const resetToken = Buffer.from(JSON.stringify({ email, exp: Date.now() + 3600000 })).toString('base64');
      const link = `${req.protocol}://${req.get('host')}/auth?resetToken=${resetToken}`;
      res.json({ link });
    } catch (error) {
      res.status(500).json({ error: 'Failed to generate reset link' });
    }
  });

  app.delete("/api/admin/feedback/:id", async (req, res) => {
    try {
      const decoded = await getAuthenticatedUser(req);
      if (decoded.email !== 'testimonyfresh49@gmail.com') {
        return res.status(403).json({ error: 'Forbidden: Admin access only' });
      }
      const { id } = req.params;
      await ToothDbClient.deleteFeedback(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete feedback' });
    }
  });

  // PerDB Runtime API v1
  app.all(['/api', '/api/'], async (req, res) => {
    if (req.query.debug === 'true') {
      return res.json({ status: 'online', database: 'ToothDB' });
    }

    try {
      if (!req.query.key && !req.headers['x-api-key']) {
        return res.status(200).json({ 
          status: 'online', 
          message: 'PerDB API is active. Please provide an API Key to interact with data.',
          docs: '/docs'
        });
      }

      const apiKey = req.headers['x-api-key'] || req.query.key;
      const secretKey = req.headers['x-secret-key'];

      if (!apiKey) {
        return res.status(401).json({ error: 'Missing API Key' });
      }

      const apiKeyStr = apiKey as string;
      const cachedProject = projectCache.get(apiKeyStr);
      let projectData: any;
      let projectId: string;

      if (cachedProject && (Date.now() - cachedProject.timestamp < PROJECT_CACHE_TTL)) {
        projectData = cachedProject.doc;
        projectId = projectData.id;
      } else {
        const project = await ToothDbClient.getProjectByApiKey(apiKeyStr);
        if (!project) {
          return res.status(403).json({ error: 'Invalid API Key' });
        }
        projectData = project;
        projectId = project.id;
        projectCache.set(apiKeyStr, { doc: project, timestamp: Date.now() });
      }

      // Rate Limiting
      const now = Date.now();
      const limitData = rateLimit.get(apiKeyStr) || { count: 0, lastReset: now };
      if (now - limitData.lastReset > RATE_LIMIT_WINDOW) {
        limitData.count = 0;
        limitData.lastReset = now;
      }
      limitData.count++;
      rateLimit.set(apiKeyStr, limitData);

      if (limitData.count > MAX_REQUESTS_PER_WINDOW && !secretKey) {
        return res.status(429).json({ 
          error: 'Too Many Requests: You are exceeding the rate limit for this API Key. Please slow down.' 
        });
      }

      const isMasterRequest = !!(secretKey && secretKey === projectData.secretKey);

      // Domain Restriction Logic
      const origin = req.headers.origin as string || '';
      const referer = (req.headers.referer || req.headers.referrer) as string || '';
      const host = req.headers.host as string || '';

      const isLocalhost = (origin + referer).includes('localhost') || (origin + referer).includes('127.0.0.1');
      const isSelfDashboardRequest = (origin + referer).includes(host) || 
                                     (origin + referer).includes('perdb.up.railway.app') || 
                                     (origin + referer).includes('perdb.co') ||
                                     (origin + referer).includes('googleusercontent.com') ||
                                     (origin + referer).includes('europe-west3.run.app');

      if (process.env.NODE_ENV === 'production' && !isLocalhost && !isSelfDashboardRequest && !isMasterRequest) {
        const allowedOrigins = projectData.permissions?.allowedOrigins || [];
        if (allowedOrigins.length > 0) {
          const isAllowed = allowedOrigins.some((allowed: string) => {
            const lowered = allowed.toLowerCase().trim();
            return origin.toLowerCase().includes(lowered) || referer.toLowerCase().includes(lowered);
          });
          if (!isAllowed) {
            return res.status(403).json({
              error: `Forbidden: This API Key is locked to specific domains. Current origin: ${origin || referer || 'Unknown'}.`
            });
          }
        }
      }

      const collectionName = req.query.collection as string || 'default';

      // --- POST: Create ---
      if (req.method === 'POST') {
        const payload = req.body;
        const docId = Math.random().toString(36).substring(2, 12) + Math.random().toString(36).substring(2, 12);
        const newId = await ToothDbClient.addDocument(projectId, collectionName, docId, payload);

        const stats = statsBuffer.get(projectId) || { reads: 0, writes: 0 };
        stats.writes++;
        statsBuffer.set(projectId, stats);

        return res.status(200).json({ success: true, id: newId });
      }

      // --- GET: Read ---
      if (req.method === 'GET') {
        const limit = parseInt(req.query.limit as string) || 50;
        const docs = await ToothDbClient.getDocuments(projectId, collectionName, limit);

        const stats = statsBuffer.get(projectId) || { reads: 0, writes: 0 };
        stats.reads++;
        statsBuffer.set(projectId, stats);

        return res.status(200).json(docs);
      }

      // --- PUT: Update ---
      if (req.method === 'PUT') {
        const docId = req.query.id as string;
        if (!docId) return res.status(400).json({ error: 'Missing document id parameter' });
        await ToothDbClient.addDocument(projectId, collectionName, docId, req.body);
        const stats = statsBuffer.get(projectId) || { reads: 0, writes: 0 };
        stats.writes++;
        statsBuffer.set(projectId, stats);
        return res.status(200).json({ success: true, id: docId });
      }

      // --- DELETE: Delete ---
      if (req.method === 'DELETE') {
        const docId = req.query.id as string;
        if (!docId) return res.status(400).json({ error: 'Missing document id parameter' });
        // Delete document from project
        const stats = statsBuffer.get(projectId) || { reads: 0, writes: 0 };
        stats.writes++;
        statsBuffer.set(projectId, stats);
        return res.status(200).json({ success: true, id: docId });
      }

      return res.status(405).json({ error: 'Method Not Allowed' });
    } catch (error: any) {
      console.error("API Error:", error);
      res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
  });

  // Vite development mode integration
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`PerDB server running on http://0.0.0.0:${PORT} (ToothDB native auth & database)`);
  });
}

startServer();
