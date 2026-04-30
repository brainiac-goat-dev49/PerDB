import express from 'express';
import cors from 'cors';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = express();

// Middleware
app.use(cors({ origin: true }));
app.use(express.json());

// Initialize Firebase Admin
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
        console.error("FIREBASE_SERVICE_ACCOUNT is missing");
        return null;
      }

      const serviceAccount = parseServiceAccount(saEnv);

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log("Firebase Admin initialized");
      db = getFirestore((firebaseConfig as any).firestoreDatabaseId);
    } catch (error) {
      console.error("Firebase Admin Init Error:", error);
      return null;
    }
  } else {
    db = getFirestore((firebaseConfig as any).firestoreDatabaseId);
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

// Simple in-memory cache for GET requests
const getCache = new Map<string, { data: any, timestamp: number }>();
const CACHE_TTL = 30000; // 30 seconds

// Project Metadata Cache
const projectCache = new Map<string, { doc: any, timestamp: number }>();
const PROJECT_CACHE_TTL = 300000; // 5 minutes

// Simple rate limiter
const rateLimit = new Map<string, { count: number, lastReset: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 60;

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
    const secretKey = req.headers['x-secret-key'] as string;
    
    // 2. Lookup Project (with Cache)
    const cachedProject = projectCache.get(apiKey);
    let projectDoc;

    if (cachedProject && (Date.now() - cachedProject.timestamp < PROJECT_CACHE_TTL)) {
      projectDoc = cachedProject.doc;
    } else {
      const projectsSnap = await firestore.collection('projects')
        .where('apiKey', '==', apiKey)
        .limit(1)
        .get();

      if (projectsSnap.empty) {
        return res.status(403).json({ error: 'Invalid API Key' });
      }
      projectDoc = projectsSnap.docs[0];
      projectCache.set(apiKey, { doc: projectDoc, timestamp: Date.now() });
    }

    const projectId = projectDoc.id;
    const projectData = projectDoc.data();

    // Rate Limiting
    const now = Date.now();
    const limitData = rateLimit.get(apiKey) || { count: 0, lastReset: now };
    if (now - limitData.lastReset > RATE_LIMIT_WINDOW) {
      limitData.count = 0;
      limitData.lastReset = now;
    }
    limitData.count++;
    rateLimit.set(apiKey, limitData);
    
    if (limitData.count > MAX_REQUESTS_PER_WINDOW && !secretKey) {
      return res.status(429).json({ error: 'Too Many Requests' });
    }

    const isMasterRequest = !!(secretKey && secretKey === projectData.secretKey);

    // Domain Check
    const referer = (req.headers.referer || req.headers.referrer) as string || '';
    const origin = req.headers.origin as string || '';
    const isLocal = process.env.NODE_ENV !== 'production';
    const isOurDomain = referer && (referer.includes('koyeb.app') || referer.includes('run.app') || referer.includes('ai.studio'));
    
    if (!isLocal && !isOurDomain && !isMasterRequest) {
      const allowedOrigins = projectData.permissions?.allowedOrigins || [];
      
      // Helper to extract perchance slug
      const getPerchanceSlug = (url: string) => {
        if (!url) return null;
        try {
          // Remove protocol and trailing slashes
          let clean = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
          if (!clean.includes('perchance.org')) return null;
          
          // Format: [subdomain].perchance.org/[slug]... or perchance.org/[slug]
          const parts = clean.split('/');
          
          // 1. If it's the main domain perchance.org/slug
          if (parts[0] === 'perchance.org') {
            return parts.length >= 2 ? parts[1].split(/[?#]/)[0].toLowerCase() : null;
          }
          
          // 2. If it's a subdomain [slug].perchance.org
          if (parts[0].endsWith('.perchance.org')) {
            const sub = parts[0].replace('.perchance.org', '');
            
            // Perchance uses 32-char hex subdomains for random URLs
            // If it's NOT a 32-char hex, the subdomain is likely the slug
            const isRandomSubdomain = sub.length === 32 && /^[a-f0-9]+$/.test(sub);
            
            if (isRandomSubdomain) {
              // Look in the path for the real slug
              return parts.length >= 2 ? parts[1].split(/[?#]/)[0].toLowerCase() : null;
            }
            
            // Otherwise, the subdomain is the slug
            return sub.toLowerCase();
          }

          return parts.length >= 2 ? parts[1].split(/[?#]/)[0].toLowerCase() : null;
        } catch (e) {
          return null;
        }
      };

      const refererSlug = getPerchanceSlug(referer) || getPerchanceSlug(origin);
      const originSlug = getPerchanceSlug(origin);
      
      const isAllowed = allowedOrigins.length === 0 
        ? (referer || origin || '').includes('perchance.org')
        : allowedOrigins.some((allowed: string) => {
            const lowered = allowed.toLowerCase().trim();
            if (!lowered) return false;

            // 1. Direct match (for non-perchance or exact origins)
            if (origin.toLowerCase().includes(lowered) || referer.toLowerCase().includes(lowered)) return true;
            
            // 2. Smart Perchance Matching
            const allowedSlug = lowered.includes('perchance.org') 
              ? getPerchanceSlug(lowered) 
              : lowered; // If user just entered "my-generator"
            
            if (allowedSlug) {
              // Match against referer slug, origin slug, or direct URL inclusion
              if (refererSlug === allowedSlug || originSlug === allowedSlug) return true;
              if (referer.includes(`/${allowedSlug}/`) || referer.endsWith(`/${allowedSlug}`)) return true;
            }
            
            // 3. Fallback: If they just added "perchance.org", allow all perchance
            if (lowered === 'perchance.org' && (origin + referer).includes('perchance.org')) return true;
            
            return false;
          });

      if (!isAllowed) {
        return res.status(403).json({ 
          error: `Forbidden: This API Key is locked to specific domains. Current origin: ${origin || referer || 'Unknown'}. Ensure your generator name is added to the allowed list.`,
          hint: `If using Perchance, try adding '${refererSlug || 'your-generator-name'}' or just 'perchance.org' to the allowed domains.`
        });
      }
    }

    // Increment Analytics (Atomic for Vercel since we can't buffer easily)
    if (req.method === 'GET') {
       await projectDoc.ref.update({
         'stats.reads': admin.firestore.FieldValue.increment(1),
         updatedAt: admin.firestore.FieldValue.serverTimestamp()
       });
    } else if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
       await projectDoc.ref.update({
         'stats.writes': admin.firestore.FieldValue.increment(1),
         updatedAt: admin.firestore.FieldValue.serverTimestamp()
       });
    }

    let projectRules = {};
    const rawRules = projectData.rules;
    try {
      if (typeof rawRules === 'string') {
        const trimmed = rawRules.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          projectRules = JSON.parse(trimmed);
        } else {
          projectRules = {};
        }
      } else {
        projectRules = rawRules || {};
      }
    } catch (e) {
      if (typeof rawRules === 'string' && rawRules.trim().startsWith('{')) {
        console.error("Rules Parse Error:", e);
      }
      projectRules = {};
    }

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
      const limit = parseInt(req.query.limit as string) || 50;
      
      // Cache check
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
        
        const docRef = firestore.collection(docPath).doc(docId);
        console.log(`[API] PUT Request: Path=${docPath}, ID=${docId}`);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
          console.warn(`[API] PUT Document not found: ${docPath}/${docId}`);
          return res.status(404).json({ error: 'Document not found' });
        }

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
