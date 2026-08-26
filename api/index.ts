import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { ToothDbClient } from '../lib/toothdb.js';

const app = express();

app.use(cors({ origin: true }));
app.use(bodyParser.json());

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

const router = express.Router();

// Health check & Config
router.get("/health", (req, res) => {
  res.json({ status: "ok", database: "ToothDB" });
});

router.get("/config", (req, res) => {
  res.json({ usePostgres: false, useToothDb: true });
});

// Auth Routes
router.post("/auth/register", async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    if (!email || !password || !displayName) {
      return res.status(400).json({ error: 'Email, password, and display name are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password should be at least 6 characters' });
    }
    const cleanEmail = email.toLowerCase().trim();
    
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
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };
    await ToothDbClient.syncUser(newUser);
    const tokenPayload = { uid, email: cleanEmail, displayName, role };
    const token = Buffer.from(JSON.stringify(tokenPayload)).toString('base64');
    res.json({ token, user: tokenPayload });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Registration failed' });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const cleanEmail = email.toLowerCase().trim();
    const users = await ToothDbClient.getAllUsers();
    const user = users.find((u: any) => u.email?.toLowerCase() === cleanEmail);
    if (!user || (user.password && user.password !== password)) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }
    const uid = user.id || user._id;

    const role = cleanEmail === 'testimonyfresh49@gmail.com' ? 'admin' : (user.role || 'user');
    const displayName = user.displayName || 'User';
    await ToothDbClient.updateUser(uid, { lastLogin: new Date().toISOString() });
    const tokenPayload = { uid, email: cleanEmail, displayName, role };
    const token = Buffer.from(JSON.stringify(tokenPayload)).toString('base64');
    res.json({ token, user: tokenPayload });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Login failed' });
  }
});

router.post("/user/sync", async (req, res) => {
  try {
    const decoded = await getAuthenticatedUser(req);
    const { uid, email, displayName } = decoded;
    const userEmail = email || '';

    await ToothDbClient.syncUser({
      id: uid,
      email: userEmail,
      displayName: displayName || 'User',
      role: userEmail === 'testimonyfresh49@gmail.com' ? 'admin' : 'user'
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to sync user' });
  }
});

// Project Routes
router.get("/projects", async (req, res) => {
  try {
    const decoded = await getAuthenticatedUser(req);
    const projects = await ToothDbClient.getProjectsByOwner(decoded.uid);
    res.json(projects);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch projects' });
  }
});

router.post("/projects", async (req, res) => {
  try {
    const decoded = await getAuthenticatedUser(req);
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing project name' });
    const existing = await ToothDbClient.getProjectsByOwner(decoded.uid);
    if (existing.length >= 5) {
      return res.status(400).json({ error: 'Project Limit Reached: You can only have up to 5 projects.' });
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
      permissions: { allowPublicRead: true, allowPublicWrite: false, allowedOrigins: ['perchance.org'] },
      rules: `{\n  "global": {\n    ".read": "true",\n    ".write": "true"\n  }\n}`,
      collectionList: [],
      stats: { reads: 0, writes: 0 }
    };
    const created = await ToothDbClient.createProject(newProject);
    res.json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create project' });
  }
});

router.put("/projects/:id", async (req, res) => {
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
    res.status(500).json({ error: error.message || 'Failed to update project' });
  }
});

router.delete("/projects/:id", async (req, res) => {
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
    res.status(500).json({ error: error.message || 'Failed to delete project' });
  }
});

router.get("/projects/:id/collections", async (req, res) => {
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
    res.status(500).json({ error: error.message || 'Failed to get collections' });
  }
});

router.get("/projects/:id/collections/:colName", async (req, res) => {
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
    res.status(500).json({ error: error.message || 'Failed to get collection preview' });
  }
});

router.get("/projects/:id/collections/:colName/full", async (req, res) => {
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
    res.status(500).json({ error: error.message || 'Failed to get full collection' });
  }
});

router.post("/feedback", async (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });
    await ToothDbClient.addFeedback({ name, email, message });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to save feedback' });
  }
});

// Admin Routes
router.get("/admin/users", async (req, res) => {
  try {
    const decoded = await getAuthenticatedUser(req);
    if (decoded.email !== 'testimonyfresh49@gmail.com') {
      return res.status(403).json({ error: 'Forbidden: Admin access only' });
    }
    const users = await ToothDbClient.getAllUsers();
    res.json(users);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch users' });
  }
});

router.get("/admin/feedback", async (req, res) => {
  try {
    const decoded = await getAuthenticatedUser(req);
    if (decoded.email !== 'testimonyfresh49@gmail.com') {
      return res.status(403).json({ error: 'Forbidden: Admin access only' });
    }
    const feedback = await ToothDbClient.getFeedback();
    res.json(feedback);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch feedback' });
  }
});

router.post("/admin/update-user", async (req, res) => {
  try {
    const decoded = await getAuthenticatedUser(req);
    if (decoded.email !== 'testimonyfresh49@gmail.com') {
      return res.status(403).json({ error: 'Forbidden: Admin access only' });
    }
    const { userId, updates } = req.body;
    await ToothDbClient.updateUser(userId, updates);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update user' });
  }
});

router.post("/admin/delete-user-full", async (req, res) => {
  try {
    const decoded = await getAuthenticatedUser(req);
    if (decoded.email !== 'testimonyfresh49@gmail.com') {
      return res.status(403).json({ error: 'Forbidden: Admin access only' });
    }
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing User ID' });
    
    const projects = await ToothDbClient.getProjectsByOwner(userId);
    for (const p of projects) {
      await ToothDbClient.deleteProject(p.id);
    }
    await ToothDbClient.updateUser(userId, { isDeleted: true });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to perform full user deletion' });
  }
});

router.delete("/admin/feedback/:id", async (req, res) => {
  try {
    const decoded = await getAuthenticatedUser(req);
    if (decoded.email !== 'testimonyfresh49@gmail.com') {
      return res.status(403).json({ error: 'Forbidden: Admin access only' });
    }
    const { id } = req.params;
    await ToothDbClient.deleteFeedback(id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete feedback' });
  }
});

// Runtime API (POST, GET, PUT, DELETE)
router.all(['/', ''], async (req, res) => {
  try {
    const apiKey = (req.headers['x-api-key'] || req.query.key) as string;
    if (!apiKey) {
      return res.status(200).json({ status: 'online', message: 'PerDB API is active.' });
    }
    const project = await ToothDbClient.getProjectByApiKey(apiKey);
    if (!project) return res.status(403).json({ error: 'Invalid API Key' });

    const collectionName = (req.query.collection as string) || 'default';
    if (req.method === 'POST') {
      const docId = Math.random().toString(36).substring(2, 12);
      const newId = await ToothDbClient.addDocument(project.id, collectionName, docId, req.body);
      return res.json({ success: true, id: newId });
    }
    if (req.method === 'GET') {
      const limit = parseInt(req.query.limit as string) || 50;
      const docs = await ToothDbClient.getDocuments(project.id, collectionName, limit);
      return res.json(docs);
    }
    if (req.method === 'PUT') {
      const docId = req.query.id as string || Math.random().toString(36).substring(2, 12);
      await ToothDbClient.addDocument(project.id, collectionName, docId, req.body);
      return res.json({ success: true, id: docId });
    }
    if (req.method === 'DELETE') {
      return res.json({ success: true });
    }
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Internal Server Error' });
  }
});

// Mount router on both '/api' and '/' for universal Vercel and standalone compatibility
app.use('/api', router);
app.use('/', router);

export default app;
