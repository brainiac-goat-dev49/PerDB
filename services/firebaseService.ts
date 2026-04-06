
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
const mapDocToProject = async (docSnap: any): Promise<Project> => {
  const data = docSnap.data();
  // We need to fetch collections manually since they are subcollections
  // Note: listing subcollections is not possible directly in client SDK without knowing names
  // For this architecture, we will store a metadata array of collection names on the parent project doc
  // OR we just query the known collections. 
  
  // Strategy: For the dashboard to be fast, we will store a 'collectionNames' array on the Project document.
  // When we fetch a project, we iterate those names to fetch the data.
  
  const colNames: string[] = data.collectionList || [];
  const collections: Collection[] = [];

  for (const name of colNames) {
    const colRef = collection(db, `projects/${docSnap.id}/collections/${name}/docs`);
    const snapshot = await getDocs(colRef);
    const entries = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    collections.push({ name, entries });
  }

  return {
    id: docSnap.id,
    ownerId: data.ownerId,
    name: data.name,
    apiKey: data.apiKey,
    secretKey: data.secretKey,
    permissions: data.permissions,
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
    collections,
    createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
    updatedAt: data.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
  };
};

export const FirebaseService = {
  // --- Management API ---

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
    
    const projects = await Promise.all(querySnapshot.docs.map(mapDocToProject));
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
    const res = await fetch(`/api?collection=${collectionName}&key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (result.error) throw new Error(result.error);
    return result;
  },

  runtimeGet: async (apiKey: string, collectionName: string): Promise<DBEntry[]> => {
    const res = await fetch(`/api?collection=${collectionName}&key=${apiKey}`, {
      method: 'GET'
    });
    const result = await res.json();
    if (result.error) throw new Error(result.error);
    return result;
  },

  runtimeUpdate: async (apiKey: string, collectionName: string, docId: string, data: any): Promise<void> => {
    const res = await fetch(`/api?collection=${collectionName}&key=${apiKey}&id=${docId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (result.error) throw new Error(result.error);
  },

  runtimeDelete: async (apiKey: string, collectionName: string, docId: string): Promise<void> => {
    const res = await fetch(`/api?collection=${collectionName}&key=${apiKey}&id=${docId}`, {
      method: 'DELETE'
    });
    const result = await res.json();
    if (result.error) throw new Error(result.error);
  }
};
