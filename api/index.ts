import admin from 'firebase-admin';
import corsLib from 'cors';
import { VercelRequest, VercelResponse } from '@vercel/node';

const cors = corsLib({ origin: true });

// Initialize Firebase Admin (Server-Side)
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
      console.warn("No FIREBASE_SERVICE_ACCOUNT env var found. Trying default init.");
      admin.initializeApp();
    }
  } catch (e) {
    console.error("Firebase Admin Init Error:", e);
  }
}

const db = admin.firestore();

// Helper to evaluate rules
const evaluateRule = (ruleStr: any, context: any) => {
  if (ruleStr === 'true' || ruleStr === true) return true;
  if (ruleStr === 'false' || ruleStr === false) return false;
  if (!ruleStr) return false;
  try {
    const { auth, newData, data } = context;
    // Simple evaluator using Function constructor
    const fn = new Function('auth', 'newData', 'data', `return ${ruleStr};`);
    return fn(auth, newData, data);
  } catch (e) {
    console.error("Rule Evaluation Error:", e);
    return false;
  }
};

// Main API Handler
export default async (req: VercelRequest, res: VercelResponse) => {
  // Wrap in CORS handler
  return new Promise<void>((resolve, reject) => {
    cors(req as any, res as any, async (result: any) => {
      if (result instanceof Error) return reject(result);

      try {
        // 0. Health Check / Root Response
        if (!req.query.key && !req.headers['x-api-key']) {
          res.status(200).json({ 
            status: 'online', 
            message: 'PerDB API is active. Please provide an API Key to interact with data.',
            docs: 'https://perdb.vercel.app/docs'
          });
          return resolve();
        }

        // 1. Validate API Key
        const apiKey = req.headers['x-api-key'] || req.query.key;
        
        if (!apiKey) {
          res.status(401).json({ error: 'Missing API Key' });
          return resolve();
        }

        // 2. Lookup Project by API Key
        const projectsSnap = await db.collection('projects')
          .where('apiKey', '==', apiKey)
          .limit(1)
          .get();

        if (projectsSnap.empty) {
          res.status(403).json({ error: 'Invalid API Key' });
          return resolve();
        }

        const projectDoc = projectsSnap.docs[0];
        const projectId = projectDoc.id;
        const projectData = projectDoc.data();
        const projectRules = typeof projectData.rules === 'string' 
          ? JSON.parse(projectData.rules) 
          : (projectData.rules || {});

        // 3. Routing & Logic
        const collectionName = (req.query.collection as string) || 'default';
        const docPath = `projects/${projectId}/collections/${collectionName}/docs`;

        // Parse Auth Context from headers (if any)
        let authContext = null;
        const authHeader = req.headers['x-perdb-auth'] as string;
        if (authHeader) {
          try {
            authContext = JSON.parse(authHeader);
          } catch (e) {
            authContext = { id: authHeader }; // Fallback to string if not JSON
          }
        }

        // --- POST: Create ---
        if (req.method === 'POST') {
          const payload = req.body;
          const writeRule = projectRules[collectionName]?.['.write'];
          const isAllowed = evaluateRule(writeRule, { auth: authContext, newData: payload, data: null });

          if (!isAllowed && writeRule !== undefined) {
            res.status(403).json({ error: 'Permission Denied' });
            return resolve();
          }
          
          const docRef = await db.collection(docPath).add({
            ...payload,
            _created: admin.firestore.FieldValue.serverTimestamp()
          });

          if (!projectData.collectionList?.includes(collectionName)) {
             await projectDoc.ref.update({
               collectionList: admin.firestore.FieldValue.arrayUnion(collectionName)
             });
          }

          res.status(200).json({ success: true, id: docRef.id });
          return resolve();
        }

        // --- GET: Read ---
        if (req.method === 'GET') {
          const readRule = projectRules[collectionName]?.['.read'];
          const isAllowed = evaluateRule(readRule, { auth: authContext, newData: null, data: null });

          if (!isAllowed && readRule !== undefined) {
            res.status(403).json({ error: 'Permission Denied' });
            return resolve();
          }

          const limit = parseInt(req.query.limit as string) || 50;
          const snapshot = await db.collection(docPath)
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

          res.status(200).json(data);
          return resolve();
        }

        // --- PUT: Update ---
        if (req.method === 'PUT') {
          const docId = (req.query.id as string) || req.body.id;
          if (!docId) {
            res.status(400).json({ error: 'Missing Document ID' });
            return resolve();
          }

          const payload = req.body;
          const writeRule = projectRules[collectionName]?.['.write'];
          
          const docRef = db.collection(docPath).doc(docId);
          const docSnap = await docRef.get();
          if (!docSnap.exists) {
            res.status(404).json({ error: 'Document not found' });
            return resolve();
          }

          const isAllowed = evaluateRule(writeRule, { 
            auth: authContext, 
            newData: payload, 
            data: docSnap.data() 
          });

          if (!isAllowed && writeRule !== undefined) {
            res.status(403).json({ error: 'Permission Denied' });
            return resolve();
          }

          await docRef.update({
            ...payload,
            _updated: admin.firestore.FieldValue.serverTimestamp()
          });

          res.status(200).json({ success: true });
          return resolve();
        }

        // --- DELETE: Delete ---
        if (req.method === 'DELETE') {
          const docId = req.query.id as string;
          if (!docId) {
            res.status(400).json({ error: 'Missing Document ID' });
            return resolve();
          }

          const writeRule = projectRules[collectionName]?.['.write'];
          const docRef = db.collection(docPath).doc(docId);
          const docSnap = await docRef.get();
          if (!docSnap.exists) {
            res.status(404).json({ error: 'Document not found' });
            return resolve();
          }

          const isAllowed = evaluateRule(writeRule, { 
            auth: authContext, 
            newData: null, 
            data: docSnap.data() 
          });

          if (!isAllowed && writeRule !== undefined) {
            res.status(403).json({ error: 'Permission Denied' });
            return resolve();
          }

          await docRef.delete();
          res.status(200).json({ success: true });
          return resolve();
        }

        res.status(405).json({ error: 'Method Not Allowed' });
        resolve();

      } catch (error: any) {
        console.error("API Error:", error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
        resolve();
      }
    });
  });
};
