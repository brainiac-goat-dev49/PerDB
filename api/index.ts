import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { ToothDbService } from '../services/toothDbService.js';

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

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", database: "ToothDB" });
});

app.get("/api/config", (req, res) => {
  res.json({ usePostgres: false, useToothDb: true });
});

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
    const isBanned = await ToothDbService.isUserBanned('', cleanEmail);
    if (isBanned) {
      return res.status(403).json({ error: 'This email is permanently banned from PerDB.' });
    }
    const users = await ToothDbService.getAllUsers();
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
    await ToothDbService.syncUser(newUser);
    const tokenPayload = { uid, email: cleanEmail, displayName, role };
    const token = Buffer.from(JSON.stringify(tokenPayload)).toString('base64');
    res.json({ token, user: tokenPayload });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Registration failed' });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const cleanEmail = email.toLowerCase().trim();
    const users = await ToothDbService.getAllUsers();
    const user = users.find((u: any) => u.email?.toLowerCase() === cleanEmail);
    if (!user || (user.password && user.password !== password)) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }
    const uid = user.id || user._id;
    const isBanned = await ToothDbService.isUserBanned(uid, cleanEmail);
    if (isBanned || user.isBanned) {
      return res.status(403).json({ error: 'This account has been permanently banned from PerDB.' });
    }
    const role = cleanEmail === 'testimonyfresh49@gmail.com' ? 'admin' : (user.role || 'user');
    const displayName = user.displayName || 'User';
    await ToothDbService.updateUser(uid, { lastLogin: new Date().toISOString() });
    const tokenPayload = { uid, email: cleanEmail, displayName, role };
    const token = Buffer.from(JSON.stringify(tokenPayload)).toString('base64');
    res.json({ token, user: tokenPayload });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Login failed' });
  }
});

app.post("/api/user/sync", async (req, res) => {
  try {
    const decoded = await getAuthenticatedUser(req);
    const { uid, email, displayName } = decoded;
    const userEmail = email || '';
    const isBanned = await ToothDbService.isUserBanned(uid, userEmail);
    if (isBanned) {
      return res.status(403).json({ error: 'This account has been permanently banned from PerDB.' });
    }
    await ToothDbService.syncUser({
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

app.get("/api/projects", async (req, res) => {
  try {
    const decoded = await getAuthenticatedUser(req);
    const projects = await ToothDbService.getProjectsByOwner(decoded.uid);
    res.json(projects);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch projects' });
  }
});

app.post("/api/projects", async (req, res) => {
  try {
    const decoded = await getAuthenticatedUser(req);
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing project name' });
    const existing = await ToothDbService.getProjectsByOwner(decoded.uid);
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
    const created = await ToothDbService.createProject(newProject);
    res.json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create project' });
  }
});

app.put("/api/projects/:id", async (req, res) => {
  try {
    const decoded = await getAuthenticatedUser(req);
    const { id } = req.params;
    const { name, permissions, rules, stats, collectionList } = req.body;
    const proj = await ToothDbService.getProjectById(id);
    if (!proj || proj.ownerId !== decoded.uid) {
      return res.status(403).json({ error: 'Forbidden or Project not found' });
    }
    const cleanData: any = {};
    if (name !== undefined) cleanData.name = name;
    if (permissions !== undefined) cleanData.permissions = permissions;
    if (rules !== undefined) cleanData.rules = rules;
    if (stats !== undefined) cleanData.stats = stats;
    if (collectionList !== undefined) cleanData.collectionList = collectionList;
    await ToothDbService.updateProject(id, cleanData);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update project' });
  }
});

app.delete("/api/projects/:id", async (req, res) => {
  try {
    const decoded = await getAuthenticatedUser(req);
    const { id } = req.params;
    const proj = await ToothDbService.getProjectById(id);
    if (!proj || proj.ownerId !== decoded.uid) {
      return res.status(403).json({ error: 'Forbidden or Project not found' });
    }
    await ToothDbService.deleteProject(id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete project' });
  }
});

app.get("/api/projects/:id/collections", async (req, res) => {
  try {
    const decoded = await getAuthenticatedUser(req);
    const { id } = req.params;
    const proj = await ToothDbService.getProjectById(id);
    if (!proj || proj.ownerId !== decoded.uid) {
      return res.status(403).json({ error: 'Forbidden or Project not found' });
    }
    const cols = await ToothDbService.getProjectCollections(id);
    res.json(cols);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to get collections' });
  }
});

app.get("/api/projects/:id/collections/:colName", async (req, res) => {
  try {
    const decoded = await getAuthenticatedUser(req);
    const { id, colName } = req.params;
    const proj = await ToothDbService.getProjectById(id);
    if (!proj || proj.ownerId !== decoded.uid) {
      return res.status(403).json({ error: 'Forbidden or Project not found' });
    }
    const preview = await ToothDbService.getCollectionPreview(id, colName);
    res.json(preview);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to get collection preview' });
  }
});

app.get("/api/projects/:id/collections/:colName/full", async (req, res) => {
  try {
    const decoded = await getAuthenticatedUser(req);
    const { id, colName } = req.params;
    const limitCount = parseInt(req.query.limit as string) || 50;
    const proj = await ToothDbService.getProjectById(id);
    if (!proj || proj.ownerId !== decoded.uid) {
      return res.status(403).json({ error: 'Forbidden or Project not found' });
    }
    const entries = await ToothDbService.getDocuments(id, colName, limitCount);
    res.json({ entries, lastDoc: null });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to get full collection' });
  }
});

app.post("/api/feedback", async (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });
    await ToothDbService.addFeedback({ name, email, message });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

// Admin Routes
app.get("/api/admin/users", async (req, res) => {
  try {
    const decoded = await getAuthenticatedUser(req);
    if (decoded.email !== 'testimonyfresh49@gmail.com') {
      return res.status(403).json({ error: 'Forbidden: Admin access only' });
    }
    const users = await ToothDbService.getAllUsers();
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
    const feedback = await ToothDbService.getFeedback();
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
    await ToothDbService.updateUser(userId, updates);
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
    const user = await ToothDbService.getUser(userId);
    if (user?.email) {
      await ToothDbService.banEmail(user.email, 'Full account deletion by admin');
    }
    const projects = await ToothDbService.getProjectsByOwner(userId);
    for (const p of projects) {
      await ToothDbService.deleteProject(p.id);
    }
    await ToothDbService.updateUser(userId, { isBanned: true, isDeleted: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to perform full user deletion' });
  }
});

app.delete("/api/admin/feedback/:id", async (req, res) => {
  try {
    const decoded = await getAuthenticatedUser(req);
    if (decoded.email !== 'testimonyfresh49@gmail.com') {
      return res.status(403).json({ error: 'Forbidden: Admin access only' });
    }
    const { id } = req.params;
    await ToothDbService.deleteFeedback(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete feedback' });
  }
});

// Runtime API
app.all(['/api', '/api/'], async (req, res) => {
  try {
    const apiKey = (req.headers['x-api-key'] || req.query.key) as string;
    if (!apiKey) {
      return res.status(200).json({ status: 'online', message: 'PerDB API is active.' });
    }
    const project = await ToothDbService.getProjectByApiKey(apiKey);
    if (!project) return res.status(403).json({ error: 'Invalid API Key' });

    const collectionName = (req.query.collection as string) || 'default';
    if (req.method === 'POST') {
      const docId = Math.random().toString(36).substring(2, 12);
      const newId = await ToothDbService.addDocument(project.id, collectionName, docId, req.body);
      return res.json({ success: true, id: newId });
    }
    if (req.method === 'GET') {
      const limit = parseInt(req.query.limit as string) || 50;
      const docs = await ToothDbService.getDocuments(project.id, collectionName, limit);
      return res.json(docs);
    }
    if (req.method === 'PUT') {
      const docId = req.query.id as string || Math.random().toString(36).substring(2, 12);
      await ToothDbService.addDocument(project.id, collectionName, docId, req.body);
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

export default app;
