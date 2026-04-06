import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import admin from 'firebase-admin';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Firebase Admin Singleton
let db: admin.firestore.Firestore | null = null;

function getDb() {
  if (db) return db;

  if (admin.apps.length === 0) {
    try {
      const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (!saEnv) {
        console.warn("FIREBASE_SERVICE_ACCOUNT is missing. API will be limited.");
        return null;
      }
      const serviceAccount = JSON.parse(saEnv);
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

async function startServer() {
  console.log("--- Starting PerDB Server ---");
  console.log(`Node Version: ${process.version}`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
  
  const app = express();
  const PORT = process.env.PORT || 3000;
  console.log(`Target Port: ${PORT}`);

  // Middleware
  app.use(cors({ origin: true }));
  app.use(bodyParser.json());

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

      // --- Domain Restriction ---
      const origin = req.headers.origin || req.headers.referer || '';
      const isPerchance = origin.includes('perchance.org');
      const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');

      if (!isPerchance && !isLocalhost && process.env.NODE_ENV === 'production') {
        return res.status(403).json({ 
          error: 'Forbidden: PerDB is currently restricted to perchance.org projects during beta.' 
        });
      }

      // 2. Lookup Project by API Key
      const projectsSnap = await firestore.collection('projects')
        .where('apiKey', '==', apiKey)
        .limit(1)
        .get();

      if (projectsSnap.empty) {
        return res.status(403).json({ error: 'Invalid API Key' });
      }

      const projectDoc = projectsSnap.docs[0];
      const projectId = projectDoc.id;
      const projectData = projectDoc.data();
      
      // Bypass rules if secret key matches
      const isMasterRequest = secretKey === projectData.secretKey;

      const projectRules = typeof projectData.rules === 'string' 
        ? JSON.parse(projectData.rules) 
        : (projectData.rules || {});

      const collectionName = req.query.collection as string || 'default';
      const docPath = `projects/${projectId}/collections/${collectionName}/docs`;

      // Helper to evaluate rules
      const evaluateRule = (ruleStr: any, context: any) => {
        if (ruleStr === 'true' || ruleStr === true) return true;
        if (ruleStr === 'false' || ruleStr === false) return false;
        if (!ruleStr) return false;
        try {
          const { auth, newData, data } = context;
          const fn = new Function('auth', 'newData', 'data', `return ${ruleStr};`);
          return fn(auth, newData, data);
        } catch (e) {
          console.error("Rule Evaluation Error:", e);
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

        // Update collection list metadata and stats
        const updateData: any = {
          'stats.writes': admin.firestore.FieldValue.increment(1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (!projectData.collectionList?.includes(collectionName)) {
           updateData.collectionList = admin.firestore.FieldValue.arrayUnion(collectionName);
        }

        await projectDoc.ref.update(updateData);

        return res.status(200).json({ success: true, id: docRef.id });
      }

      // --- GET: Read ---
      if (req.method === 'GET') {
        const readRule = projectRules[collectionName]?.['.read'];
        const isAllowed = isMasterRequest || evaluateRule(readRule, { auth: authContext, newData: null, data: null });

        if (!isAllowed && readRule !== undefined && !isMasterRequest) {
          return res.status(403).json({ error: 'Permission Denied' });
        }

        // Update stats
        await projectDoc.ref.update({
          'stats.reads': admin.firestore.FieldValue.increment(1)
        });

        const limit = parseInt(req.query.limit as string) || 50;
        const snapshot = await firestore.collection(docPath)
          .orderBy('_created', 'desc')
          .limit(limit)
          .get();

        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          _created: doc.data()._created?.toDate?.()?.toISOString()
        }));

        return res.status(200).json(data);
      }

      // --- PUT: Update ---
      if (req.method === 'PUT') {
        const docId = req.query.id as string || req.body.id;
        if (!docId) return res.status(400).json({ error: 'Missing Document ID' });

        const payload = req.body;
        const writeRule = projectRules[collectionName]?.['.write'];
        
        // Fetch current data for rule evaluation
        const docRef = firestore.collection(docPath).doc(docId);
        const docSnap = await docRef.get();
        if (!docSnap.exists) return res.status(404).json({ error: 'Document not found' });

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

        // Update stats
        await projectDoc.ref.update({
          'stats.writes': admin.firestore.FieldValue.increment(1)
        });

        return res.status(200).json({ success: true });
      }

      // --- DELETE: Delete ---
      if (req.method === 'DELETE') {
        const docId = req.query.id as string;
        if (!docId) return res.status(400).json({ error: 'Missing Document ID' });

        const writeRule = projectRules[collectionName]?.['.write'];
        const docRef = firestore.collection(docPath).doc(docId);
        const docSnap = await docRef.get();
        if (!docSnap.exists) return res.status(404).json({ error: 'Document not found' });

        const isAllowed = isMasterRequest || evaluateRule(writeRule, { 
          auth: authContext, 
          newData: null, 
          data: docSnap.data() 
        });

        if (!isAllowed && writeRule !== undefined && !isMasterRequest) {
          return res.status(403).json({ error: 'Permission Denied' });
        }

        await docRef.delete();

        // Update stats
        await projectDoc.ref.update({
          'stats.writes': admin.firestore.FieldValue.increment(1)
        });

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
    const distPath = path.join(process.cwd(), 'dist');
    const indexPath = path.join(distPath, 'index.html');
    
    console.log(`Production mode: Serving static files from ${distPath}`);
    
    app.use(express.static(distPath));
    
    // Express 5 requires (.*) for a catch-all wildcard
    app.get('(.*)', (req, res) => {
      res.sendFile(indexPath, (err) => {
        if (err) {
          console.error(`Failed to send index.html from ${indexPath}:`, err);
          res.status(500).send("Internal Server Error: Missing build artifacts. Please ensure 'npm run build' was successful and the 'dist' folder exists.");
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
