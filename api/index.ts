import express from 'express';
import cors from 'cors';
import { ToothDbService } from '../services/toothDbService.js';

const app = express();

app.use(cors({ origin: true }));
app.use(express.json());

async function getAuthenticatedUser(req: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Unauthorized: Missing token');
  }
  const token = authHeader.split('Bearer ')[1];

  try {
    const payloadStr = Buffer.from(token, 'base64').toString('utf-8');
    const payload = JSON.parse(payloadStr);
    return {
      uid: payload.uid || payload.id,
      email: payload.email || '',
      displayName: payload.displayName || payload.name || ''
    };
  } catch (e) {
    throw new Error('Unauthorized: Invalid token');
  }
}

app.get("/api/config", (req, res) => {
  res.json({ usePostgres: false, useToothDb: true, firebase: false });
});

app.post("/api/user/sync", async (req, res) => {
  try {
    const decoded = await getAuthenticatedUser(req);
    const { uid, email, displayName } = decoded as any;
    const userEmail = email || '';
    const userDisplayName = displayName || '';

    const isBanned = await ToothDbService.isUserBanned(uid, userEmail);
    if (isBanned) {
      return res.status(403).json({ error: 'This account has been permanently banned from PerDB.' });
    }

    await ToothDbService.syncUser({
      id: uid,
      email: userEmail,
      displayName: userDisplayName,
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

export default app;
