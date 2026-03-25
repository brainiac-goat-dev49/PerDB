import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import admin from 'firebase-admin';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Initialize Firebase Admin
  if (!admin.apps.length) {
    try {
      const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) 
        : null;

      if (serviceAccount) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
      } else {
        console.warn("No FIREBASE_SERVICE_ACCOUNT env var found. API will likely fail.");
        // Fallback to default if running in an environment with implicit credentials
        admin.initializeApp();
      }
    } catch (e) {
      console.error("Firebase Admin Init Error:", e);
    }
  }

  const db = admin.firestore();

  // Middleware
  app.use(cors({ origin: true })); // Allow all origins for the API, including perchance.org
  app.use(bodyParser.json());

  // --- PerDB API v1 ---
  app.all('/api', async (req, res) => {
    try {
      // 1. Validate API Key
      const apiKey = req.headers['x-api-key'] || req.query.key;
      
      if (!apiKey) {
        return res.status(401).json({ error: 'Missing API Key' });
      }

      // 2. Lookup Project by API Key
      const projectsSnap = await db.collection('projects')
        .where('apiKey', '==', apiKey)
        .limit(1)
        .get();

      if (projectsSnap.empty) {
        return res.status(403).json({ error: 'Invalid API Key' });
      }

      const projectDoc = projectsSnap.docs[0];
      const projectId = projectDoc.id;
      const projectData = projectDoc.data();
      const projectRules = typeof projectData.rules === 'string' 
        ? JSON.parse(projectData.rules) 
        : (projectData.rules || {});

      const collectionName = req.query.collection || 'default';
      const docPath = `projects/${projectId}/collections/${collectionName}/docs`;

      // Helper to evaluate rules
      const evaluateRule = (ruleStr, context) => {
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
      const authHeader = req.headers['x-perdb-auth'];
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
        const isAllowed = evaluateRule(writeRule, { auth: authContext, newData: payload, data: null });

        if (!isAllowed && writeRule !== undefined) {
          return res.status(403).json({ error: 'Permission Denied' });
        }
        
        const docRef = await db.collection(docPath).add({
          ...payload,
          _created: admin.firestore.FieldValue.serverTimestamp()
        });

        // Update collection list metadata
        if (!projectData.collectionList?.includes(collectionName)) {
           await projectDoc.ref.update({
             collectionList: admin.firestore.FieldValue.arrayUnion(collectionName)
           });
        }

        return res.status(200).json({ success: true, id: docRef.id });
      }

      // --- GET: Read ---
      if (req.method === 'GET') {
        const readRule = projectRules[collectionName]?.['.read'];
        const isAllowed = evaluateRule(readRule, { auth: authContext, newData: null, data: null });

        if (!isAllowed && readRule !== undefined) {
          return res.status(403).json({ error: 'Permission Denied' });
        }

        const limit = parseInt(req.query.limit as string) || 50;
        const snapshot = await db.collection(docPath)
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
        const docRef = db.collection(docPath).doc(docId);
        const docSnap = await docRef.get();
        if (!docSnap.exists) return res.status(404).json({ error: 'Document not found' });

        const isAllowed = evaluateRule(writeRule, { 
          auth: authContext, 
          newData: payload, 
          data: docSnap.data() 
        });

        if (!isAllowed && writeRule !== undefined) {
          return res.status(403).json({ error: 'Permission Denied' });
        }

        await docRef.update({
          ...payload,
          _updated: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.status(200).json({ success: true });
      }

      // --- DELETE: Delete ---
      if (req.method === 'DELETE') {
        const docId = req.query.id as string;
        if (!docId) return res.status(400).json({ error: 'Missing Document ID' });

        const writeRule = projectRules[collectionName]?.['.write'];
        const docRef = db.collection(docPath).doc(docId);
        const docSnap = await docRef.get();
        if (!docSnap.exists) return res.status(404).json({ error: 'Document not found' });

        const isAllowed = evaluateRule(writeRule, { 
          auth: authContext, 
          newData: null, 
          data: docSnap.data() 
        });

        if (!isAllowed && writeRule !== undefined) {
          return res.status(403).json({ error: 'Permission Denied' });
        }

        await docRef.delete();
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
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
