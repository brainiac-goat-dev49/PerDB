import express from 'express';
import cors from 'cors';
import admin from 'firebase-admin';

const app = express();

// Middleware
app.use(cors({ origin: true }));
app.use(express.json());

// Initialize Firebase Admin
let db: admin.firestore.Firestore | null = null;

function getDb() {
  if (db) return db;

  if (admin.apps.length === 0) {
    try {
      const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (!saEnv) {
        console.error("FIREBASE_SERVICE_ACCOUNT is missing");
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

// API Handler
app.all('*all', async (req, res) => {
  // Debug endpoint
  if (req.path === '/api/debug' || req.path === '/debug') {
    return res.json({
      status: 'online',
      hasServiceAccount: !!process.env.FIREBASE_SERVICE_ACCOUNT,
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      nodeEnv: process.env.NODE_ENV,
      adminApps: admin.apps.length
    });
  }

  // 0. Health Check (no DB needed yet)
  if (!req.query.key && !req.headers['x-api-key']) {
      return res.status(200).json({ 
        status: 'online', 
        message: 'PerDB API is active. Please provide an API Key to interact with data.',
        docs: '/docs'
      });
  }

  try {
    const firestore = getDb();
    if (!firestore) {
      return res.status(500).json({ error: 'Firebase Admin not initialized. Check your environment variables (FIREBASE_SERVICE_ACCOUNT).' });
    }

    const apiKey = (req.headers['x-api-key'] || req.query.key) as string;
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
    const projectRules = typeof projectData.rules === 'string' 
      ? JSON.parse(projectData.rules) 
      : (projectData.rules || {});

    const collectionName = (req.query.collection as string) || 'default';
    const docPath = `projects/${projectId}/collections/${collectionName}/docs`;

    let authContext = null;
    const authHeader = req.headers['x-perdb-auth'] as string;
    if (authHeader) {
      try {
        authContext = JSON.parse(authHeader);
      } catch (e) {
        authContext = { id: authHeader };
      }
    }

    // POST: Create
    if (req.method === 'POST') {
      const payload = req.body;
      const writeRule = projectRules[collectionName]?.['.write'];
      const isAllowed = evaluateRule(writeRule, { auth: authContext, newData: payload, data: null });

      if (!isAllowed && writeRule !== undefined) {
        return res.status(403).json({ error: 'Permission Denied' });
      }
      
      const docRef = await firestore.collection(docPath).add({
        ...payload,
        _created: admin.firestore.FieldValue.serverTimestamp()
      });

      if (!projectData.collectionList?.includes(collectionName)) {
         await projectDoc.ref.update({
           collectionList: admin.firestore.FieldValue.arrayUnion(collectionName)
         });
      }

      return res.status(200).json({ success: true, id: docRef.id });
    }

    // GET: Read
    if (req.method === 'GET') {
      const readRule = projectRules[collectionName]?.['.read'];
      const isAllowed = evaluateRule(readRule, { auth: authContext, newData: null, data: null });

      if (!isAllowed && readRule !== undefined) {
        return res.status(403).json({ error: 'Permission Denied' });
      }

      const limit = parseInt(req.query.limit as string) || 50;
      const snapshot = await firestore.collection(docPath)
        .orderBy('_created', 'desc')
        .limit(limit)
        .get();

      const data = snapshot.docs.map(doc => {
        const d = doc.data();
        if (d._created && d._created.toDate) {
          d._created = d._created.toDate().toISOString();
        }
        return { id: doc.id, ...d };
      });

      return res.status(200).json(data);
    }

    // PUT: Update
    if (req.method === 'PUT') {
      const docId = (req.query.id as string) || req.body.id;
      if (!docId) return res.status(400).json({ error: 'Missing Document ID' });

      const payload = req.body;
      const writeRule = projectRules[collectionName]?.['.write'];
      
      const docRef = firestore.collection(docPath).doc(docId);
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

    // DELETE: Delete
    if (req.method === 'DELETE') {
      const docId = req.query.id as string;
      if (!docId) return res.status(400).json({ error: 'Missing Document ID' });

      const writeRule = projectRules[collectionName]?.['.write'];
      const docRef = firestore.collection(docPath).doc(docId);
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

    return res.status(405).json({ error: 'Method Not Allowed' });

  } catch (error: any) {
    console.error("API Error:", error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

export default app;
