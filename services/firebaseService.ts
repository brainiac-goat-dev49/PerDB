
import { 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  where, 
  doc, 
  deleteDoc, 
  updateDoc, 
  getDoc,
  serverTimestamp
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { Project, DBEntry, Collection } from '../types';

// Helper to convert Firestore snapshots to our App types
const mapDocToProject = (docSnap: any): Project => {
  const data = docSnap.data();
  
  return {
    id: docSnap.id,
    ownerId: data.ownerId,
    name: data.name,
    apiKey: data.apiKey,
    secretKey: data.secretKey,
    permissions: data.permissions || {
      allowPublicRead: true,
      allowPublicWrite: false,
      allowedOrigins: []
    },
    rules: data.rules || `{
  "global": {
    ".read": "true",
    ".write": "true"
  },
  "scores": {
    ".read": "true",
    ".write": "newData.score > 0"
  }
}`,
    stats: data.stats || { reads: 0, writes: 0, activeUsers: 0 },
    collections: [], // We fetch these on demand now
    createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
    updatedAt: data.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
  };
};

export const FirebaseService = {
  // --- Management API ---

  getProjectCollections: async (projectId: string): Promise<Collection[]> => {
    const docRef = doc(db, 'projects', projectId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) return [];
    
    const data = docSnap.data();
    const colNames: string[] = data.collectionList || [];
    const collections: Collection[] = [];

    for (const name of colNames) {
      const colRef = collection(db, `projects/${projectId}/collections/${name}/docs`);
      const q = query(colRef, serverTimestamp() ? where('_created', '!=', null) : where('id', '!=', '')); // Dummy query to allow ordering if needed, but let's keep it simple
      const snapshot = await getDocs(colRef);
      const entries = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      collections.push({ name, entries });
    }
    return collections;
  },

  createProject: async (name: string): Promise<Project> => {
    const user = auth.currentUser;
    if (!user) throw new Error("Must be logged in");

    const newProject = {
      ownerId: user.uid,
      name,
      apiKey: `pk_live_${Math.random().toString(36).substr(2, 16)}`,
      secretKey: `sk_live_${Math.random().toString(36).substr(2, 16)}`,
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
      collectionList: [], // Metadata to track subcollections
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    const docRef = await addDoc(collection(db, 'projects'), newProject);
    
    // Return formatted project
    return {
      id: docRef.id,
      ...newProject,
      collections: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } as Project;
  },

  getAllProjects: async (): Promise<Project[]> => {
    const user = auth.currentUser;
    if (!user) return [];

    const q = query(collection(db, 'projects'), where('ownerId', '==', user.uid));
    const querySnapshot = await getDocs(q);
    
    const projects = querySnapshot.docs.map(mapDocToProject);
    return projects;
  },

  deleteProject: async (projectId: string): Promise<void> => {
    await deleteDoc(doc(db, 'projects', projectId));
  },

  updateProject: async (projectId: string, data: Partial<Project>): Promise<void> => {
    // We strip out the ID and complex types that shouldn't be saved directly if passed by accident
    const { id, collections, ...cleanData } = data as any;
    
    await updateDoc(doc(db, 'projects', projectId), {
      ...cleanData,
      updatedAt: serverTimestamp()
    });
  },

  // --- Runtime API (Uses the Server API to bypass Firestore rules) ---
  
  runtimeAdd: async (apiKey: string, collectionName: string, data: any): Promise<any> => {
    const res = await fetch(`https://perdb.koyeb.app/api?collection=${collectionName}`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (result.error) throw new Error(result.error);
    return result;
  },

  runtimeGet: async (apiKey: string, collectionName: string): Promise<DBEntry[]> => {
    const res = await fetch(`https://perdb.koyeb.app/api?collection=${collectionName}`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey
      }
    });
    const result = await res.json();
    if (result.error) throw new Error(result.error);
    return result;
  },

  runtimeUpdate: async (apiKey: string, collectionName: string, docId: string, data: any, secretKey?: string): Promise<void> => {
    const res = await fetch(`https://perdb.koyeb.app/api?collection=${collectionName}&id=${docId}`, {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        ...(secretKey ? { 'x-secret-key': secretKey } : {})
      },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (result.error) throw new Error(result.error);
  },

  runtimeDelete: async (apiKey: string, collectionName: string, docId: string, secretKey?: string): Promise<void> => {
    const res = await fetch(`https://perdb.koyeb.app/api?collection=${collectionName}&id=${docId}`, {
      method: 'DELETE',
      headers: {
        'x-api-key': apiKey,
        ...(secretKey ? { 'x-secret-key': secretKey } : {})
      }
    });
    const result = await res.json();
    if (result.error) throw new Error(result.error);
  }
};
