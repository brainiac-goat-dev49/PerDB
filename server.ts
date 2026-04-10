import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

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
  if (db) return db;

  if (admin.apps.length === 0) {
    try {
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
      db = admin.firestore();
    } catch (error) {
      console.error("Firebase Admin Init Error:", error);
      return null;
    }
  } else {
    db = admin.firestore();
  }
  return db;
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
  const firestore = getDb();
  if (!firestore || statsBuffer.size === 0) return;

  console.log(`[Stats] Flushing buffered stats for ${statsBuffer.size} projects...`);
  
  statsBuffer.forEach(async (stats, projectId) => {
    try {
      await firestore.collection('projects').doc(projectId).update({
        'stats.reads': admin.firestore.FieldValue.increment(stats.reads),
        'stats.writes': admin.firestore.FieldValue.increment(stats.writes),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      console.error(`[Stats] Failed to flush stats for project ${projectId}:`, e);
    }
  });
  
  statsBuffer.clear();
}

// Start the flush interval
setInterval(flushStats, STATS_FLUSH_INTERVAL);

async function startServer() {
  console.log("--- Starting PerDB Server ---");
  console.log(`Node Version: ${process.version}`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  
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

  // --- Admin API ---
  app.get("/api/admin/users", async (req, res) => {
    try {
      const firestore = getDb();
      if (!firestore) return res.status(500).json({ error: 'Firebase Admin not initialized' });

      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
      
      const token = authHeader.split('Bearer ')[1];
      const decodedToken = await admin.auth().verifyIdToken(token);
      
      if (decodedToken.email !== 'brainiacgoatdev@gmail.com') {
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
      
      if (decodedToken.email !== 'brainiacgoatdev@gmail.com') {
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
      
      if (decodedToken.email !== 'brainiacgoatdev@gmail.com') {
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

  app.delete("/api/admin/feedback/:id", async (req, res) => {
    try {
      const firestore = getDb();
      if (!firestore) return res.status(500).json({ error: 'Firebase Admin not initialized' });

      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
      
      const token = authHeader.split('Bearer ')[1];
      const decodedToken = await admin.auth().verifyIdToken(token);
      
      if (decodedToken.email !== 'brainiacgoatdev@gmail.com') {
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
  app.all('/api', async (req, res) => {
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
      if (!firestore) {
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
      let projectDoc;

      if (cachedProject && (Date.now() - cachedProject.timestamp < PROJECT_CACHE_TTL)) {
        projectDoc = cachedProject.doc;
      } else {
        const projectsSnap = await firestore.collection('projects')
          .where('apiKey', '==', apiKeyStr)
          .limit(1)
          .get();

        if (projectsSnap.empty) {
          return res.status(403).json({ error: 'Invalid API Key' });
        }
        projectDoc = projectsSnap.docs[0];
        projectCache.set(apiKeyStr, { doc: projectDoc, timestamp: Date.now() });
      }

      const projectId = projectDoc.id;
      const projectData = projectDoc.data();
      
      // --- Rate Limiting ---
      const now = Date.now();
      const limitData = rateLimit.get(apiKey) || { count: 0, lastReset: now };
      
      if (now - limitData.lastReset > RATE_LIMIT_WINDOW) {
        limitData.count = 0;
        limitData.lastReset = now;
      }
      
      limitData.count++;
      rateLimit.set(apiKey, limitData);
      
      if (limitData.count > MAX_REQUESTS_PER_WINDOW && !secretKey) {
        return res.status(429).json({ 
          error: 'Too Many Requests: You are exceeding the rate limit for this API Key. Please slow down.' 
        });
      }

      // Bypass rules if secret key matches
      const isMasterRequest = !!(secretKey && secretKey === projectData.secretKey);

      // --- Domain Restriction (Enforced per project) ---
      const origin = req.headers.origin || req.headers.referer || '';
      const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
      
      // If in production, check allowed origins (Master Key bypasses this)
      if (process.env.NODE_ENV === 'production' && !isLocalhost && !isMasterRequest) {
        const allowedOrigins = projectData.permissions?.allowedOrigins || [];
        
        // If no origins specified, we default to allowing all perchance.org for backward compatibility 
        const isAllowed = allowedOrigins.length === 0 
          ? origin.includes('perchance.org') 
          : allowedOrigins.some((allowed: string) => origin.includes(allowed));

        if (!isAllowed) {
          console.warn(`Domain Restricted: Origin ${origin} not in ${allowedOrigins.join(', ')}`);
          return res.status(403).json({ 
            error: `Forbidden: This API Key is locked to specific domains. Current origin: ${origin || 'unknown'}` 
          });
        }
      }
      
      let projectRules = {};
      try {
        projectRules = typeof projectData.rules === 'string' 
          ? JSON.parse(projectData.rules) 
          : (projectData.rules || {});
      } catch (e) {
        console.error("Rules Parse Error:", e);
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

      // --- POST: Create ---
      if (req.method === 'POST') {
        const payload = req.body;
        const writeRule = projectRules[collectionName]?.['.write'];
        const isAllowed = isMasterRequest || evaluateRule(writeRule, { auth: authContext, newData: payload, data: null });

        if (!isAllowed && writeRule !== undefined && !isMasterRequest) {
          return res.status(403).json({ error: 'Permission Denied' });
        }
        
        const docRef = await firestore.collection(docPath).add({
          ...payload,
          _created: admin.firestore.FieldValue.serverTimestamp()
        });

        // Update collection list metadata and stats (Buffered)
        const stats = statsBuffer.get(projectId) || { reads: 0, writes: 0 };
        stats.writes++;
        statsBuffer.set(projectId, stats);

        if (!projectData.collectionList?.includes(collectionName)) {
           await projectDoc.ref.update({
             collectionList: admin.firestore.FieldValue.arrayUnion(collectionName),
             updatedAt: admin.firestore.FieldValue.serverTimestamp()
           });
           // Clear project cache to reflect new collection list
           projectCache.delete(apiKeyStr);
        }

        return res.status(200).json({ success: true, id: docRef.id });
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

        const snapshot = await firestore.collection(docPath)
          .orderBy('_created', 'desc')
          .limit(limit)
          .get();

        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          _created: doc.data()._created?.toDate?.()?.toISOString()
        }));

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
        
        // Fetch current data for rule evaluation
        const docRef = firestore.collection(docPath).doc(docId);
        console.log(`[API] PUT Request: Path=${docPath}, ID=${docId}`);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
          console.warn(`[API] PUT Document not found: ${docPath}/${docId}`);
          return res.status(404).json({ error: 'Document not found' });
        }

        const isAllowed = isMasterRequest || evaluateRule(writeRule, { 
          auth: authContext, 
          newData: payload, 
          data: docSnap.data() 
        });

        if (!isAllowed && writeRule !== undefined && !isMasterRequest) {
          return res.status(403).json({ error: 'Permission Denied' });
        }

        await docRef.update({
          ...payload,
          _updated: admin.firestore.FieldValue.serverTimestamp()
        });

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
        const docRef = firestore.collection(docPath).doc(docId);
        console.log(`[API] DELETE Request: Path=${docPath}, ID=${docId}`);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
          console.warn(`[API] DELETE Document not found: ${docPath}/${docId}`);
          return res.status(404).json({ error: 'Document not found' });
        }

        const isAllowed = isMasterRequest || evaluateRule(writeRule, { 
          auth: authContext, 
          newData: null, 
          data: docSnap.data() 
        });

        if (!isAllowed && writeRule !== undefined && !isMasterRequest) {
          return res.status(403).json({ error: 'Permission Denied' });
        }

        await docRef.delete();

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
