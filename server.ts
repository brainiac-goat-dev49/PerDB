import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import firebaseConfig from './firebase-applet-config.json';
import { PostgresService, initializePostgres } from './services/postgresService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Firebase Admin Singleton
let db: admin.firestore.Firestore | null = null;

/**
 * Safely parses the Firebase Service Account JSON string.
 * Handles common issues like literal newlines, wrapping quotes, missing commas, and smart quotes.
 */
function parseServiceAccount(saEnv: string) {
  let cleaned = saEnv.trim();
  
  // 1. Handle smart quotes (common copy-paste artifact)
  cleaned = cleaned.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");

  // 2. Handle wrapping quotes (sometimes env vars are stored as "{"key": "val"}")
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  // Attempt 1: Standard parse
  try {
    return JSON.parse(cleaned);
  } catch (e) {}

  // Attempt 2: Handle literal newlines
  try {
    const fixed = cleaned.replace(/\n/g, '\\n');
    return JSON.parse(fixed);
  } catch (e) {}

  // Attempt 3: Aggressive fix for missing commas between properties
  // This regex finds "value" "key": and inserts a comma
  try {
    const withCommas = cleaned
      .replace(/("(?:\\.|[^"])*")\s*("(?:\\.|[^"])*"\s*:)/g, '$1, $2')
      .replace(/(\d+|true|false|null)\s*("(?:\\.|[^"])*"\s*:)/g, '$1, $2');
    return JSON.parse(withCommas.replace(/\n/g, '\\n'));
  } catch (e) {}

  // Attempt 4: Handle escaped newlines that were double-escaped
  try {
    const fixed = cleaned.replace(/\\\\n/g, '\\n');
    return JSON.parse(fixed);
  } catch (e) {}

  // If all fails, throw the original error with detailed context
  try {
    JSON.parse(cleaned);
  } catch (e: any) {
    const posMatch = e.message.match(/at position (\d+)/);
    const pos = posMatch ? parseInt(posMatch[1]) : -1;
    
    if (pos !== -1) {
      const start = Math.max(0, pos - 50);
      const end = Math.min(cleaned.length, pos + 50);
      const context = cleaned.substring(start, end);
      const pointer = " ".repeat(Math.min(pos, 50)) + "^";
      console.error(`\n--- JSON Parse Error Details ---`);
      console.error(`Error: ${e.message}`);
      console.error(`Position: ${pos}`);
      console.error(`Context: ...${context}...`);
      console.error(`          ${pointer}`);
      console.error(`Raw Char at position: ${JSON.stringify(cleaned[pos])}`);
      console.error(`Hint: Check for missing commas, extra quotes, or unescaped newlines around this position.`);
      console.error(`--------------------------------\n`);
    }
    throw e;
  }
}

function getDb() {
  try {
    if (db) return db;

    if (admin.apps.length === 0) {
      const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (!saEnv) {
        console.warn("FIREBASE_SERVICE_ACCOUNT is missing. API will be limited.");
        return null;
      }

      const serviceAccount = parseServiceAccount(saEnv);

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log("Firebase Admin initialized");
      
      const dbId = (firebaseConfig as any).firestoreDatabaseId;
      db = dbId ? getFirestore(dbId) : getFirestore();
    } else {
      const dbId = (firebaseConfig as any).firestoreDatabaseId;
      db = dbId ? getFirestore(dbId) : getFirestore();
    }
    return db;
  } catch (error) {
    console.error("Firebase Admin/Firestore Init Error:", error);
    return null;
  }
}

// Simple in-memory cache for GET requests
const getCache = new Map<string, { data: any, timestamp: number }>();
const CACHE_TTL = 30000; // 30 seconds cache for same collection/limit

// Project Metadata Cache (to avoid lookup on every request)
const projectCache = new Map<string, { doc: any, timestamp: number }>();
const PROJECT_CACHE_TTL = 300000; // 5 minutes

// Simple rate limiter
const rateLimit = new Map<string, { count: number, lastReset: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 60; // 1 request per second average

// Stats Buffering (to reduce write operations)
const statsBuffer = new Map<string, { reads: number, writes: number }>();
const STATS_FLUSH_INTERVAL = 60000; // Flush every 1 minute

function flushStats() {
  if (statsBuffer.size === 0) return;

  console.log(`[Stats] Flushing buffered stats for ${statsBuffer.size} projects...`);
  
  if (PostgresService.isActive()) {
    statsBuffer.forEach(async (stats, projectId) => {
      try {
        await PostgresService.incrementStats(projectId, stats.reads, stats.writes);
      } catch (e) {
        console.error(`[Stats] Failed to flush Postgres stats for project ${projectId}:`, e);
      }
    });
  } else {
    const firestore = getDb();
    if (!firestore) return;

    statsBuffer.forEach(async (stats, projectId) => {
      try {
        await firestore.collection('projects').doc(projectId).update({
          'stats.reads': admin.firestore.FieldValue.increment(stats.reads),
          'stats.writes': admin.firestore.FieldValue.increment(stats.writes),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (e) {
        console.error(`[Stats] Failed to flush Firestore stats for project ${projectId}:`, e);
      }
    });
  }
  
  statsBuffer.clear();
}

// Start the flush interval
setInterval(flushStats, STATS_FLUSH_INTERVAL);

async function startServer() {
  console.log("--- Starting PerDB Server ---");
  console.log(`Node Version: ${process.version}`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);

  if (PostgresService.isActive()) {
    console.log("[Postgres] Database URL detected. Initializing PostgreSQL...");
    const ok = await initializePostgres();
    if (ok) {
      console.log("[Postgres] Successfully connected and initialized Postgres!");
    } else {
      console.warn("[Postgres] Failed to initialize Postgres. Falling back to Firebase.");
    }
  } else {
    console.log("[Postgres] No DATABASE_URL detected. Running in standard Firebase mode.");
  }
  
  const app = express();
  const PORT = process.env.PORT || 3000;
  console.log(`Target Port: ${PORT}`);
  console.log(`__dirname: ${__dirname}`);
  console.log(`distPath: ${path.resolve(__dirname, 'dist')}`);

  // Middleware
  app.use(cors({ origin: true }));
  app.use(bodyParser.json());

  // API routes go here
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", env: process.env.NODE_ENV });
  });

  // Helper to authenticate client Firebase user on the server
  async function getAuthenticatedUser(req: any) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new Error('Unauthorized: Missing token');
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    return decodedToken;
  }

  // --- Configuration and Dashboard Proxies ---
  app.get("/api/config", (req, res) => {
    res.json({ usePostgres: PostgresService.isActive() });
  });

  app.post("/api/user/sync", async (req, res) => {
    try {
      const decoded = await getAuthenticatedUser(req);
      const { uid, email, display_name, name, displayName, photo_url, photoURL } = decoded;
      const userEmail = email || '';
      const userDisplayName = displayName || name || display_name || '';
      const userPhotoURL = photoURL || photo_url || '';

      if (PostgresService.isActive()) {
        const isBanned = await PostgresService.isUserBanned(uid);
        if (isBanned) {
          return res.status(403).json({ error: 'This account has been permanently banned from PerDB.' });
        }
        await PostgresService.syncUser({
          id: uid,
          email: userEmail,
          displayName: userDisplayName,
          photoURL: userPhotoURL,
          role: userEmail === 'testimonyfresh49@gmail.com' ? 'admin' : 'user'
        });
      } else {
        const firestore = getDb();
        if (!firestore) return res.status(500).json({ error: 'Firestore not initialized' });

        const bannedSnap = await firestore.collection('banned_emails').doc(userEmail).get();
        if (bannedSnap.exists) {
          return res.status(403).json({ error: 'This account has been permanently banned from PerDB.' });
        }

        const userRef = firestore.collection('users').doc(uid);
        const userSnap = await userRef.get();
        if (!userSnap.exists) {
          await userRef.set({
            email: userEmail,
            displayName: userDisplayName,
            photoURL: userPhotoURL,
            role: userEmail === 'testimonyfresh49@gmail.com' ? 'admin' : 'user',
            isBanned: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastLogin: admin.firestore.FieldValue.serverTimestamp()
          });
        } else {
          await userRef.update({
            lastLogin: admin.firestore.FieldValue.serverTimestamp(),
            email: userEmail,
            displayName: userDisplayName,
            photoURL: userPhotoURL
          });
        }
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("Sync User Error:", error);
      res.status(500).json({ error: error.message || 'Failed to sync user' });
    }
  });

  app.get("/api/projects", async (req, res) => {
    try {
      const decoded = await getAuthenticatedUser(req);
      if (PostgresService.isActive()) {
        const projects = await PostgresService.getProjectsByOwner(decoded.uid);
        res.json(projects);
      } else {
        const firestore = getDb();
        if (!firestore) return res.status(500).json({ error: 'Firestore not initialized' });

        const q = await firestore.collection('projects').where('ownerId', '==', decoded.uid).get();
        const projects = q.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ownerId: data.ownerId,
            name: data.name,
            apiKey: data.apiKey,
            secretKey: data.secretKey,
            permissions: data.permissions || { allowPublicRead: true, allowPublicWrite: false, allowedOrigins: [] },
            rules: typeof data.rules === 'string' ? data.rules : JSON.stringify(data.rules || {}, null, 2),
            stats: data.stats || { reads: 0, writes: 0 },
            collections: [],
            collectionList: data.collectionList || [],
            createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
            updatedAt: data.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString()
          };
        });
        res.json(projects);
      }
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

      if (PostgresService.isActive()) {
        const existing = await PostgresService.getProjectsByOwner(decoded.uid);
        if (existing.length >= 5) {
          return res.status(400).json({ error: 'Project Limit Reached: You can only have up to 5 projects. Please delete an existing project to create a new one.' });
        }
        const created = await PostgresService.createProject(newProject);
        res.json(created);
      } else {
        const firestore = getDb();
        if (!firestore) return res.status(500).json({ error: 'Firestore not initialized' });

        const existing = await firestore.collection('projects').where('ownerId', '==', decoded.uid).get();
        if (existing.size >= 5) {
          return res.status(400).json({ error: 'Project Limit Reached: You can only have up to 5 projects. Please delete an existing project to create a new one.' });
        }

        await firestore.collection('projects').doc(newProjId).set({
          ...newProject,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({
          ...newProject,
          collections: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
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

      const cleanData: any = {};
      if (name !== undefined) cleanData.name = name;
      if (permissions !== undefined) cleanData.permissions = permissions;
      if (rules !== undefined) cleanData.rules = rules;
      if (stats !== undefined) cleanData.stats = stats;
      if (collectionList !== undefined) cleanData.collectionList = collectionList;

      if (PostgresService.isActive()) {
        const proj = await PostgresService.getProjectById(id);
        if (!proj || proj.ownerId !== decoded.uid) {
          return res.status(403).json({ error: 'Forbidden or Project not found' });
        }
        await PostgresService.updateProject(id, cleanData);
      } else {
        const firestore = getDb();
        if (!firestore) return res.status(500).json({ error: 'Firestore not initialized' });

        const docRef = firestore.collection('projects').doc(id);
        const snap = await docRef.get();
        if (!snap.exists || snap.data()?.ownerId !== decoded.uid) {
          return res.status(403).json({ error: 'Forbidden or Project not found' });
        }
        await docRef.update({
          ...cleanData,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
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

      if (PostgresService.isActive()) {
        const proj = await PostgresService.getProjectById(id);
        if (!proj || proj.ownerId !== decoded.uid) {
          return res.status(403).json({ error: 'Forbidden or Project not found' });
        }
        await PostgresService.deleteProject(id);
      } else {
        const firestore = getDb();
        if (!firestore) return res.status(500).json({ error: 'Firestore not initialized' });

        const docRef = firestore.collection('projects').doc(id);
        const snap = await docRef.get();
        if (!snap.exists || snap.data()?.ownerId !== decoded.uid) {
          return res.status(403).json({ error: 'Forbidden or Project not found' });
        }
        await docRef.delete();
      }
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

      let collectionList: string[] = [];

      if (PostgresService.isActive()) {
        const proj = await PostgresService.getProjectById(id);
        if (!proj || proj.ownerId !== decoded.uid) {
          return res.status(403).json({ error: 'Forbidden or Project not found' });
        }
        collectionList = proj.collectionList || [];
      } else {
        const firestore = getDb();
        if (!firestore) return res.status(500).json({ error: 'Firestore not initialized' });

        const snap = await firestore.collection('projects').doc(id).get();
        if (!snap.exists || snap.data()?.ownerId !== decoded.uid) {
          return res.status(403).json({ error: 'Forbidden or Project not found' });
        }
        collectionList = snap.data()?.collectionList || [];
      }

      const colNames = Array.from(new Set(collectionList));
      const cols = colNames.map(name => ({
        name,
        entries: [],
        totalCount: 0,
        hasLoaded: false,
        isLoading: false
      }));
      res.json(cols);
    } catch (error: any) {
      console.error("Get Project Collections Error:", error);
      res.status(500).json({ error: error.message || 'Failed to get collections' });
    }
  });

  app.get("/api/projects/:id/collections/:colName", async (req, res) => {
    try {
      const decoded = await getAuthenticatedUser(req);
      const { id, colName } = req.params;

      if (PostgresService.isActive()) {
        const proj = await PostgresService.getProjectById(id);
        if (!proj || proj.ownerId !== decoded.uid) {
          return res.status(403).json({ error: 'Forbidden or Project not found' });
        }
        const entries = await PostgresService.getDocuments(id, colName, 10);
        const totalCount = await PostgresService.getCollectionCount(id, colName);
        res.json({
          entries,
          totalCount,
          hasLoaded: true
        });
      } else {
        const firestore = getDb();
        if (!firestore) return res.status(500).json({ error: 'Firestore not initialized' });

        const snap = await firestore.collection('projects').doc(id).get();
        if (!snap.exists || snap.data()?.ownerId !== decoded.uid) {
          return res.status(403).json({ error: 'Forbidden or Project not found' });
        }

        const colRef = firestore.collection(`projects/${id}/collections/${colName}/docs`);
        const snapshot = await colRef.orderBy('_created', 'desc').limit(10).get();
        const countSnap = await colRef.count().get();
        
        const entries = snapshot.docs.map(doc => {
          const d = doc.data();
          if (d._created && d._created.toDate) {
            d._created = d._created.toDate().toISOString();
          }
          return { id: doc.id, ...d };
        });

        res.json({
          entries,
          totalCount: countSnap.data().count,
          hasLoaded: true
        });
      }
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

      if (PostgresService.isActive()) {
        const proj = await PostgresService.getProjectById(id);
        if (!proj || proj.ownerId !== decoded.uid) {
          return res.status(403).json({ error: 'Forbidden or Project not found' });
        }
        const entries = await PostgresService.getDocuments(id, colName, limitCount);
        res.json({
          entries,
          lastDoc: null
        });
      } else {
        const firestore = getDb();
        if (!firestore) return res.status(500).json({ error: 'Firestore not initialized' });

        const snap = await firestore.collection('projects').doc(id).get();
        if (!snap.exists || snap.data()?.ownerId !== decoded.uid) {
          return res.status(403).json({ error: 'Forbidden or Project not found' });
        }

        const colRef = firestore.collection(`projects/${id}/collections/${colName}/docs`);
        const snapshot = await colRef.orderBy('_created', 'desc').limit(limitCount).get();
        
        const entries = snapshot.docs.map(doc => {
          const d = doc.data();
          if (d._created && d._created.toDate) {
            d._created = d._created.toDate().toISOString();
          }
          return { id: doc.id, ...d };
        });

        res.json({
          entries,
          lastDoc: null
        });
      }
    } catch (error: any) {
      console.error("Get Full Collection Error:", error);
      res.status(500).json({ error: error.message || 'Failed to get full collection' });
    }
  });

  // --- Admin API ---
  app.get("/api/admin/users", async (req, res) => {
    try {
      const firestore = getDb();
      if (!firestore) return res.status(500).json({ error: 'Firebase Admin not initialized' });

      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
      
      const token = authHeader.split('Bearer ')[1];
      const decodedToken = await admin.auth().verifyIdToken(token);
      
      if (decodedToken.email !== 'testimonyfresh49@gmail.com') {
        return res.status(403).json({ error: 'Forbidden: Admin access only' });
      }

      const snapshot = await firestore.collection('users').orderBy('lastLogin', 'desc').get();
      const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(users);
    } catch (error) {
      console.error("Admin Users Error:", error);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });

  app.get("/api/admin/feedback", async (req, res) => {
    try {
      const firestore = getDb();
      if (!firestore) return res.status(500).json({ error: 'Firebase Admin not initialized' });

      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
      
      const token = authHeader.split('Bearer ')[1];
      const decodedToken = await admin.auth().verifyIdToken(token);
      
      if (decodedToken.email !== 'testimonyfresh49@gmail.com') {
        return res.status(403).json({ error: 'Forbidden: Admin access only' });
      }

      const snapshot = await firestore.collection('feedback').orderBy('timestamp', 'desc').get();
      const feedback = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(feedback);
    } catch (error) {
      console.error("Admin Feedback Error:", error);
      res.status(500).json({ error: 'Failed to fetch feedback' });
    }
  });

  app.post("/api/admin/update-user", async (req, res) => {
    try {
      const firestore = getDb();
      if (!firestore) return res.status(500).json({ error: 'Firebase Admin not initialized' });

      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
      
      const token = authHeader.split('Bearer ')[1];
      const decodedToken = await admin.auth().verifyIdToken(token);
      
      if (decodedToken.email !== 'testimonyfresh49@gmail.com') {
        return res.status(403).json({ error: 'Forbidden: Admin access only' });
      }

      const { userId, updates } = req.body;
      await firestore.collection('users').doc(userId).update(updates);
      res.json({ success: true });
    } catch (error) {
      console.error("Admin Update User Error:", error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  });

  app.post("/api/admin/delete-user-full", async (req, res) => {
    try {
      const firestore = getDb();
      if (!firestore) return res.status(500).json({ error: 'Firebase Admin not initialized' });

      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
      
      const token = authHeader.split('Bearer ')[1];
      const decodedToken = await admin.auth().verifyIdToken(token);
      
      if (decodedToken.email !== 'testimonyfresh49@gmail.com') {
        return res.status(403).json({ error: 'Forbidden: Admin access only' });
      }

      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: 'Missing User ID' });

      const userDoc = await firestore.collection('users').doc(userId).get();
      if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
      
      const userData = userDoc.data() || {};
      const userEmail = userData.email;

      // 1. Add to banned_emails
      if (userEmail) {
        await firestore.collection('banned_emails').doc(userEmail).set({
          email: userEmail,
          bannedAt: admin.firestore.FieldValue.serverTimestamp(),
          reason: 'Full account deletion by admin'
        });
      }

      // 2. Delete all projects and their data
      const projectsSnap = await firestore.collection('projects').where('ownerId', '==', userId).get();
      
      for (const projectDoc of projectsSnap.docs) {
        const projectId = projectDoc.id;
        
        // Delete all collections under this project
        // We use a manual approach since recursiveDelete might be tricky in some environments
        const collectionsSnap = await projectDoc.ref.collection('collections').get();
        for (const colDoc of collectionsSnap.docs) {
          const docsSnap = await colDoc.ref.collection('docs').get();
          const batch = firestore.batch();
          docsSnap.docs.forEach(d => batch.delete(d.ref));
          await batch.commit();
          await colDoc.ref.delete();
        }
        
        await projectDoc.ref.delete();
      }

      // 3. Delete from Firebase Auth
      try {
        await admin.auth().deleteUser(userId);
      } catch (e) {
        console.warn("Auth user already deleted or not found:", e);
      }

      // 4. Delete user doc
      await firestore.collection('users').doc(userId).delete();

      res.json({ success: true });
    } catch (error) {
      console.error("Admin Full Delete Error:", error);
      res.status(500).json({ error: 'Failed to perform full user deletion' });
    }
  });

  app.post("/api/admin/send-reset-link", async (req, res) => {
    try {
      const firestore = getDb();
      if (!firestore) return res.status(500).json({ error: 'Firebase Admin not initialized' });

      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
      
      const token = authHeader.split('Bearer ')[1];
      const decodedToken = await admin.auth().verifyIdToken(token);
      
      if (decodedToken.email !== 'testimonyfresh49@gmail.com') {
        return res.status(403).json({ error: 'Forbidden: Admin access only' });
      }

      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Missing Email' });

      const link = await admin.auth().generatePasswordResetLink(email);
      res.json({ success: true, link });
    } catch (error) {
      console.error("Admin Reset Link Error:", error);
      res.status(500).json({ error: 'Failed to generate reset link' });
    }
  });

  app.delete("/api/admin/feedback/:id", async (req, res) => {
    try {
      const firestore = getDb();
      if (!firestore) return res.status(500).json({ error: 'Firebase Admin not initialized' });

      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
      
      const token = authHeader.split('Bearer ')[1];
      const decodedToken = await admin.auth().verifyIdToken(token);
      
      if (decodedToken.email !== 'testimonyfresh49@gmail.com') {
        return res.status(403).json({ error: 'Forbidden: Admin access only' });
      }

      const { id } = req.params;
      await firestore.collection('feedback').doc(id).delete();
      res.json({ success: true });
    } catch (error) {
      console.error("Admin Delete Feedback Error:", error);
      res.status(500).json({ error: 'Failed to delete feedback' });
    }
  });

  // --- PerDB API v1 ---
  app.all(['/api', '/api/'], async (req, res) => {
    // Debug endpoint
    if (req.query.debug === 'true') {
      return res.json({
        status: 'online',
        hasServiceAccount: !!process.env.FIREBASE_SERVICE_ACCOUNT,
        adminApps: admin.apps.length
      });
    }

    try {
      // 0. Health Check / Root Response
      if (!req.query.key && !req.headers['x-api-key']) {
        return res.status(200).json({ 
          status: 'online', 
          message: 'PerDB API is active. Please provide an API Key to interact with data.',
          docs: '/docs'
        });
      }

      const firestore = getDb();
      if (!firestore && !PostgresService.isActive()) {
        return res.status(500).json({ 
          error: 'Firebase Admin not initialized. Check your environment variables (FIREBASE_SERVICE_ACCOUNT).' 
        });
      }

      // 1. Validate API Key
      const apiKey = req.headers['x-api-key'] || req.query.key;
      const secretKey = req.headers['x-secret-key'];
      
      if (!apiKey) {
        return res.status(401).json({ error: 'Missing API Key' });
      }

      // 2. Lookup Project by API Key (with Cache)
      const apiKeyStr = apiKey as string;
      const cachedProject = projectCache.get(apiKeyStr);
      let projectData: any;
      let projectId: string;

      if (cachedProject && (Date.now() - cachedProject.timestamp < PROJECT_CACHE_TTL)) {
        projectData = cachedProject.doc;
        projectId = projectData.id;
      } else {
        if (PostgresService.isActive()) {
          const project = await PostgresService.getProjectByApiKey(apiKeyStr);
          if (!project) {
            return res.status(403).json({ error: 'Invalid API Key' });
          }
          projectData = project;
          projectId = project.id;
          projectCache.set(apiKeyStr, { doc: project, timestamp: Date.now() });
        } else {
          const projectsSnap = await firestore!.collection('projects')
            .where('apiKey', '==', apiKeyStr)
            .limit(1)
            .get();

          if (projectsSnap.empty) {
            return res.status(403).json({ error: 'Invalid API Key' });
          }
          const doc = projectsSnap.docs[0];
          projectData = { id: doc.id, ...doc.data() };
          projectId = doc.id;
          projectCache.set(apiKeyStr, { doc: projectData, timestamp: Date.now() });
        }
      }
      
      // --- Rate Limiting ---
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

      // Bypass rules if secret key matches
      const isMasterRequest = !!(secretKey && secretKey === projectData.secretKey);

      // --- Domain Restriction (Enforced per project) ---
      const origin = req.headers.origin as string || '';
      const referer = (req.headers.referer || req.headers.referrer) as string || '';
      const host = req.headers.host as string || '';
      
      const isLocalhost = (origin + referer).includes('localhost') || (origin + referer).includes('127.0.0.1');
      const isSelfDashboardRequest = (origin + referer).includes(host) || 
                                     (origin + referer).includes('perdb.up.railway.app') || 
                                     (origin + referer).includes('perdb.co') ||
                                     (origin + referer).includes('googleusercontent.com') ||
                                     (origin + referer).includes('europe-west3.run.app');

      // Helper to extract all potential Perchance slugs or subdomains
      const getPerchanceIdentifiers = (url: string): string[] => {
        if (!url) return [];
        const identifiers: string[] = [];
        try {
          let clean = url.toLowerCase().trim();
          
          // Remove protocol
          clean = clean.replace(/^https?:\/\//, '');
          
          // Split into host and path
          const slashIdx = clean.indexOf('/');
          const hostPart = slashIdx === -1 ? clean : clean.substring(0, slashIdx);
          const pathPart = slashIdx === -1 ? '' : clean.substring(slashIdx + 1);
          
          if (hostPart.includes('perchance.org')) {
            // 1. Extract subdomain
            if (hostPart.endsWith('.null.perchance.org')) {
              const sub = hostPart.replace('.null.perchance.org', '');
              if (sub && sub !== 'null') {
                identifiers.push(sub);
              }
            } else if (hostPart.endsWith('.perchance.org')) {
              const sub = hostPart.replace('.perchance.org', '');
              if (sub && sub !== 'www') {
                identifiers.push(sub);
              }
            }
            
            // 2. Extract path segments
            if (pathPart) {
              const firstSegment = pathPart.split(/[/?#]/)[0];
              if (firstSegment && firstSegment !== 'api') {
                identifiers.push(firstSegment);
              }
            }
          }
        } catch (e) {
          // Ignore error
        }
        return identifiers.map(id => id.trim().toLowerCase()).filter(Boolean);
      };

      // If in production, check allowed origins (Master Key bypasses this)
      if (process.env.NODE_ENV === 'production' && !isLocalhost && !isSelfDashboardRequest && !isMasterRequest) {
        const allowedOrigins = projectData.permissions?.allowedOrigins || [];
        
        const refererIdentifiers = getPerchanceIdentifiers(referer);
        const originIdentifiers = getPerchanceIdentifiers(origin);
        const requestIdentifiers = Array.from(new Set([...refererIdentifiers, ...originIdentifiers]));
        
        const isAllowed = allowedOrigins.length === 0 
          ? (origin + referer).includes('perchance.org') 
          : allowedOrigins.some((allowed: string) => {
              const lowered = allowed.toLowerCase().trim();
              if (!lowered) return false;

              // 1. Direct match (for non-perchance or exact origins)
              if (origin.toLowerCase().includes(lowered) || referer.toLowerCase().includes(lowered)) return true;
              
              // 2. Smart Perchance Matching
              const allowedIdentifiers = [
                lowered,
                ...getPerchanceIdentifiers(lowered)
              ];

              // Check for intersection
              const hasIntersection = requestIdentifiers.some(reqId => 
                allowedIdentifiers.includes(reqId)
              );

              if (hasIntersection) return true;
              
              // 3. Fallback: If they just added "perchance.org", allow all perchance
              if (lowered === 'perchance.org' && (origin + referer).includes('perchance.org')) return true;
              
              return false;
            });

        if (!isAllowed) {
          console.warn(`Domain Restricted: Origin=${origin}, Referer=${referer} not in ${allowedOrigins.join(', ')}`);
          return res.status(403).json({ 
            error: `Forbidden: This API Key is locked to specific domains. Current origin: ${origin || referer || 'Unknown'}. Ensure your generator name is added to the allowed list.`,
            hint: `If using Perchance, try adding '${requestIdentifiers[0] || 'your-generator-name'}' or just 'perchance.org' to the allowed domains.`
          });
        }
      }
      
      let projectRules = {};
      const rawRules = projectData.rules;
      try {
        if (typeof rawRules === 'string') {
          const trimmed = rawRules.trim();
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            projectRules = JSON.parse(trimmed);
          } else {
            // Not a JSON string, likely a legacy format or corrupted data
            // We'll treat it as empty rules rather than throwing
            projectRules = {};
          }
        } else {
          projectRules = rawRules || {};
        }
      } catch (e) {
        // Only log if it really looks like it should have been JSON but failed
        if (typeof rawRules === 'string' && rawRules.trim().startsWith('{')) {
          console.error("Rules Parse Error:", e);
        }
        projectRules = {};
      }

      const collectionName = req.query.collection as string || 'default';
      const docPath = `projects/${projectId}/collections/${collectionName}/docs`;

      // Helper to evaluate rules
      const evaluateRule = (ruleStr: any, context: any) => {
        if (ruleStr === 'true' || ruleStr === true) return true;
        if (ruleStr === 'false' || ruleStr === false) return false;
        if (!ruleStr) return true; // Default to allow if no rule for this collection

        try {
          const { auth, newData, data } = context;
          const fn = new Function('auth', 'newData', 'data', `return ${ruleStr};`);
          return fn(auth, newData, data);
        } catch (e) {
          console.error("Rule Evaluation Error:", e, "Rule:", ruleStr);
          return false;
        }
      };

      // Parse Auth Context
      let authContext = null;
      const authHeader = req.headers['x-perdb-auth'] as string;
      if (authHeader) {
        try {
          authContext = JSON.parse(authHeader);
        } catch (e) {
          authContext = { id: authHeader };
        }
      }

      // Helper to invalidate cache
      const invalidateCache = (projId: string, colName: string) => {
        const prefix = `${projId}:${colName}:`;
        for (const key of getCache.keys()) {
          if (key.startsWith(prefix)) {
            getCache.delete(key);
          }
        }
      };

      // --- POST: Create ---
      if (req.method === 'POST') {
        const payload = req.body;
        const writeRule = projectRules[collectionName]?.['.write'];
        const isAllowed = isMasterRequest || evaluateRule(writeRule, { auth: authContext, newData: payload, data: null });

        if (!isAllowed && writeRule !== undefined && !isMasterRequest) {
          return res.status(403).json({ error: 'Permission Denied' });
        }
        
        let docId;
        if (PostgresService.isActive()) {
          docId = Math.random().toString(36).substring(2, 12) + Math.random().toString(36).substring(2, 12);
          await PostgresService.addDocument(projectId, collectionName, docId, payload);
          projectCache.delete(apiKeyStr);
        } else {
          const docRef = await firestore!.collection(docPath).add({
            ...payload,
            _created: admin.firestore.FieldValue.serverTimestamp()
          });
          docId = docRef.id;

          if (!projectData.collectionList?.includes(collectionName) || (new Set(projectData.collectionList || []).size !== (projectData.collectionList || []).length)) {
             const currentList = projectData.collectionList || [];
             const newList = Array.from(new Set([...currentList, collectionName]));
             
             // Update project metadata
             await firestore!.collection('projects').doc(projectId).update({
               collectionList: newList,
               updatedAt: admin.firestore.FieldValue.serverTimestamp()
             });

             // Explicitly create the collection document so it's not a "phantom" in Firestore console
             await firestore!.doc(`projects/${projectId}/collections/${collectionName}`).set({
               name: collectionName,
               updatedAt: admin.firestore.FieldValue.serverTimestamp()
             }, { merge: true });

             // Clear project cache to reflect new collection list
             projectCache.delete(apiKeyStr);
          }
        }

        // Invalidate cache
        invalidateCache(projectId, collectionName);

        // Update stats (Buffered)
        const stats = statsBuffer.get(projectId) || { reads: 0, writes: 0 };
        stats.writes++;
        statsBuffer.set(projectId, stats);

        return res.status(200).json({ success: true, id: docId });
      }

      // --- GET: Read ---
      if (req.method === 'GET') {
        const limit = parseInt(req.query.limit as string) || 50;
        
        // Check Cache first
        const cacheKey = `${projectId}:${collectionName}:${limit}`;
        const cached = getCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < CACHE_TTL) && !isMasterRequest) {
           return res.status(200).json(cached.data);
        }

        const readRule = projectRules[collectionName]?.['.read'];
        const isAllowed = isMasterRequest || evaluateRule(readRule, { auth: authContext, newData: null, data: null });

        if (!isAllowed && readRule !== undefined && !isMasterRequest) {
          return res.status(403).json({ error: 'Permission Denied' });
        }

        // Update stats (Buffered)
        const stats = statsBuffer.get(projectId) || { reads: 0, writes: 0 };
        stats.reads++;
        statsBuffer.set(projectId, stats);

        let data;
        if (PostgresService.isActive()) {
          data = await PostgresService.getDocuments(projectId, collectionName, limit);
        } else {
          const snapshot = await firestore!.collection(docPath)
            .orderBy('_created', 'desc')
            .limit(limit)
            .get();

          data = snapshot.docs.map(doc => ({
            ...doc.data(),
            id: doc.id,
            _created: doc.data()._created?.toDate?.()?.toISOString()
          }));
        }

        // Store in cache
        if (!isMasterRequest) {
          getCache.set(cacheKey, { data, timestamp: Date.now() });
        }

        return res.status(200).json(data);
      }

      // --- PUT: Update ---
      if (req.method === 'PUT') {
        const docId = (req.query.id as string || req.body.id || '').trim();
        if (!docId) return res.status(400).json({ error: 'Missing Document ID' });

        const payload = req.body;
        const writeRule = projectRules[collectionName]?.['.write'];
        
        let existingData = null;
        if (PostgresService.isActive()) {
          existingData = await PostgresService.getDocument(projectId, collectionName, docId);
        } else {
          const docRef = firestore!.collection(docPath).doc(docId);
          const docSnap = await docRef.get();
          if (docSnap.exists) {
            existingData = docSnap.data();
          }
        }

        if (!existingData) {
          console.warn(`[API] PUT Document not found: ${collectionName}/${docId}`);
          return res.status(404).json({ error: 'Document not found' });
        }

        const isAllowed = isMasterRequest || evaluateRule(writeRule, { 
          auth: authContext, 
          newData: payload, 
          data: existingData 
        });

        if (!isAllowed && writeRule !== undefined && !isMasterRequest) {
          return res.status(403).json({ error: 'Permission Denied' });
        }

        if (PostgresService.isActive()) {
          await PostgresService.updateDocument(projectId, collectionName, docId, payload);
        } else {
          const docRef = firestore!.collection(docPath).doc(docId);
          await docRef.update({
            ...payload,
            _updated: admin.firestore.FieldValue.serverTimestamp()
          });
        }

        // Invalidate cache
        invalidateCache(projectId, collectionName);

        // Update stats (Buffered)
        const stats = statsBuffer.get(projectId) || { reads: 0, writes: 0 };
        stats.writes++;
        statsBuffer.set(projectId, stats);

        return res.status(200).json({ success: true });
      }

      // --- DELETE: Delete ---
      if (req.method === 'DELETE') {
        const docId = (req.query.id as string || '').trim();
        if (!docId) return res.status(400).json({ error: 'Missing Document ID' });

        const writeRule = projectRules[collectionName]?.['.write'];
        let existingData = null;

        if (PostgresService.isActive()) {
          existingData = await PostgresService.getDocument(projectId, collectionName, docId);
        } else {
          const docRef = firestore!.collection(docPath).doc(docId);
          const docSnap = await docRef.get();
          if (docSnap.exists) {
            existingData = docSnap.data();
          }
        }

        if (!existingData) {
          console.warn(`[API] DELETE Document not found: ${collectionName}/${docId}`);
          return res.status(404).json({ error: 'Document not found' });
        }

        const isAllowed = isMasterRequest || evaluateRule(writeRule, { 
          auth: authContext, 
          newData: null, 
          data: existingData 
        });

        if (!isAllowed && writeRule !== undefined && !isMasterRequest) {
          return res.status(403).json({ error: 'Permission Denied' });
        }

        if (PostgresService.isActive()) {
          await PostgresService.deleteDocument(projectId, collectionName, docId);
          
          // Check if collection is empty
          const count = await PostgresService.getCollectionCount(projectId, collectionName);
          if (count === 0) {
            const list = projectData.collectionList || [];
            const newList = list.filter((name: string) => name !== collectionName);
            await PostgresService.updateProject(projectId, { collectionList: newList });
            projectCache.delete(apiKeyStr);
          }
        } else {
          const docRef = firestore!.collection(docPath).doc(docId);
          await docRef.delete();

          // Check if collection is now empty
          const remainingSnap = await firestore!.collection(docPath).limit(1).get();
          if (remainingSnap.empty) {
            await firestore!.collection('projects').doc(projectId).update({
              collectionList: admin.firestore.FieldValue.arrayRemove(collectionName),
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            // Also delete the collection document
            await firestore!.doc(`projects/${projectId}/collections/${collectionName}`).delete();
            
            // Clear project cache to reflect removed collection
            projectCache.delete(apiKeyStr);
          }
        }

        // Invalidate cache
        invalidateCache(projectId, collectionName);

        // Update stats (Buffered)
        const stats = statsBuffer.get(projectId) || { reads: 0, writes: 0 };
        stats.writes++;
        statsBuffer.set(projectId, stats);

        return res.status(200).json({ success: true });
      }

      res.status(405).json({ error: 'Method Not Allowed' });

    } catch (error: any) {
      console.error("API Error:", error);
      res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
  });

  // API error handler - ensure all errors under /api are returned as JSON, not HTML
  app.use('/api', (err: any, req: any, res: any, next: any) => {
    console.error("API Internal Error:", err);
    res.status(err.status || 500).json({
      error: err.message || 'Internal Server Error',
      details: err.details || undefined
    });
  });

  // API 404 handler - handle unmatched /api paths with JSON, instead of falling through to Vite/static wildcard
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    console.log("Starting Vite dev server...");
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.error("Failed to load Vite:", e);
    }
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    const indexPath = path.resolve(distPath, 'index.html');
    
    console.log(`Production mode: Serving static files from ${distPath}`);
    
    if (!fs.existsSync(distPath)) {
      console.error(`CRITICAL ERROR: dist directory not found at ${distPath}`);
    } else {
      const files = fs.readdirSync(distPath);
      console.log(`Files in dist: ${files.join(', ')}`);
      if (fs.existsSync(path.join(distPath, 'assets'))) {
        const assets = fs.readdirSync(path.join(distPath, 'assets'));
        console.log(`Files in dist/assets: ${assets.join(', ')}`);
      }
    }

    if (!fs.existsSync(indexPath)) {
      console.error(`CRITICAL ERROR: index.html not found at ${indexPath}`);
    }
    
    // Request logger for debugging production issues
    app.use((req, res, next) => {
      if (!req.url.startsWith('/api')) {
        console.log(`[Static] Request: ${req.method} ${req.url}`);
      }
      next();
    });

    app.use(express.static(distPath, {
      index: false,
      maxAge: '1d'
    }));
    
    // Express 5 requires a named parameter for wildcards
    app.get('*all', (req, res, next) => {
      // Skip API routes (should be handled above)
      if (req.path.startsWith('/api')) return next();
      
      // If it's a request for a file that doesn't exist in dist, don't serve index.html
      // This prevents serving index.html for missing JS/CSS files which causes blank screens
      if (req.path.includes('.') && !req.path.endsWith('.html')) {
        console.log(`[Static] 404 for file: ${req.path}`);
        return res.status(404).end();
      }

      console.log(`[Static] Serving index.html for SPA route: ${req.url}`);
      res.sendFile(indexPath, (err) => {
        if (err) {
          console.error(`[Static] Failed to send index.html:`, err);
          res.status(500).send("Internal Server Error: Missing build artifacts.");
        }
      });
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("CRITICAL: Failed to start server:", err);
  process.exit(1);
});
