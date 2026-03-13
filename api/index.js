const admin = require('firebase-admin');
const cors = require('cors')({ origin: true }); // Allows requests from perchance.org

// Initialize Firebase Admin (Server-Side)
// You must set FIREBASE_SERVICE_ACCOUNT in your Vercel Environment Variables
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

// Main API Handler
module.exports = async (req, res) => {
  // Wrap in CORS handler
  return new Promise((resolve, reject) => {
    cors(req, res, async (result) => {
      if (result instanceof Error) return reject(result);

      try {
        // 1. Validate API Key
        const apiKey = req.headers['x-api-key'] || req.query.key;
        
        if (!apiKey) {
          return res.status(401).json({ error: 'Missing API Key' });
        }

        // 2. Lookup Project by API Key
        // Note: In production, consider caching this lookup for performance
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

        // 3. Routing & Logic
        const collectionName = req.query.collection || 'default';
        const docPath = `projects/${projectId}/collections/${collectionName}/docs`;

        // Helper to evaluate rules
        const evaluateRule = (ruleStr, context) => {
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

        // Parse Auth Context from headers (if any)
        let auth = null;
        const authHeader = req.headers['x-perdb-auth'];
        if (authHeader) {
          try {
            auth = JSON.parse(authHeader);
          } catch (e) {
            auth = { id: authHeader }; // Fallback to string if not JSON
          }
        }

        // --- POST: Write Data ---
        if (req.method === 'POST') {
          const payload = req.body;
          
          // Apply Security Rules
          const writeRule = projectRules[collectionName]?.['.write'];
          const isAllowed = evaluateRule(writeRule, { 
            auth,
            newData: payload,
            data: null 
          });

          if (!isAllowed && writeRule !== undefined) {
            return res.status(403).json({ error: 'Permission Denied by Security Rules' });
          }
          
          const docRef = await db.collection(docPath).add({
            ...payload,
            _created: admin.firestore.FieldValue.serverTimestamp()
          });

          // Metadata: Keep track of which collections exist for the dashboard
          // We use arrayUnion so we don't duplicate names
          if (!projectData.collectionList?.includes(collectionName)) {
             await projectDoc.ref.update({
               collectionList: admin.firestore.FieldValue.arrayUnion(collectionName)
             });
          }

          res.status(200).json({ success: true, id: docRef.id });
          return resolve();
        }

        // --- GET: Read Data ---
        if (req.method === 'GET') {
          // Apply Security Rules
          const readRule = projectRules[collectionName]?.['.read'];
          const isAllowed = evaluateRule(readRule, { 
            auth,
            newData: null,
            data: null // Future: Support per-document data check if needed
          });

          if (!isAllowed && readRule !== undefined) {
            return res.status(403).json({ error: 'Permission Denied by Security Rules' });
          }

          const limit = parseInt(req.query.limit) || 50;
          
          // Simple query: Get most recent items
          const snapshot = await db.collection(docPath)
            .orderBy('_created', 'desc')
            .limit(limit)
            .get();

          const data = snapshot.docs.map(doc => {
            const d = doc.data();
            // Convert timestamps to string for JSON compatibility
            if (d._created && d._created.toDate) {
              d._created = d._created.toDate().toISOString();
            }
            return {
              id: doc.id,
              ...d
            };
          });

          res.status(200).json(data);
          return resolve();
        }

        res.status(405).json({ error: 'Method Not Allowed' });
        resolve();

      } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
        resolve();
      }
    });
  });
};