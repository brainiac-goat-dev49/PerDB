
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

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

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
    const colPath = `projects/${docSnap.id}/collections/${name}/docs`;
    const colRef = collection(db, colPath);
    try {
      const snapshot = await getDocs(colRef);
      const entries = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      collections.push({ name, entries });
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, colPath);
    }
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
    collections,
    totalReads: data.totalReads || 0,
    totalWrites: data.totalWrites || 0,
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

    const colPath = 'projects';
    try {
      const docRef = await addDoc(collection(db, colPath), newProject);
      
      // Return formatted project
      return {
        id: docRef.id,
        ...newProject,
        collections: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      } as Project;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, colPath);
      throw error; // unreachable but for TS
    }
  },

  getAllProjects: async (): Promise<Project[]> => {
    const user = auth.currentUser;
    if (!user) return [];

    const colPath = 'projects';
    const q = query(collection(db, colPath), where('ownerId', '==', user.uid));
    try {
      const querySnapshot = await getDocs(q);
      const projects = await Promise.all(querySnapshot.docs.map(mapDocToProject));
      return projects;
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, colPath);
      return [];
    }
  },

  deleteProject: async (projectId: string): Promise<void> => {
    const docPath = `projects/${projectId}`;
    try {
      await deleteDoc(doc(db, 'projects', projectId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, docPath);
    }
  },

  updateProject: async (projectId: string, data: Partial<Project>): Promise<void> => {
    // We strip out the ID and complex types that shouldn't be saved directly if passed by accident
    const { id, collections, ...cleanData } = data as any;
    
    const docPath = `projects/${projectId}`;
    try {
      await updateDoc(doc(db, 'projects', projectId), {
        ...cleanData,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, docPath);
    }
  },

  // --- Runtime API (Used by Playground & eventually the Vercel API) ---
  
  runtimeAdd: async (apiKey: string, collectionName: string, data: any): Promise<any> => {
    // 1. Find Project by API Key (This requires a global query, strictly needs an index in Firestore)
    // Note: In a real high-scale app, we'd use the Project ID directly, but per user request we look up by key.
    const q = query(collection(db, 'projects'), where('apiKey', '==', apiKey));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) throw new Error("Invalid API Key");
    const projectDoc = querySnapshot.docs[0];
    const projectId = projectDoc.id;

    // 2. Ensure collection name is in the list
    const projectData = projectDoc.data();
    const currentList: string[] = projectData.collectionList || [];
    
    if (!currentList.includes(collectionName)) {
      try {
        await updateDoc(doc(db, 'projects', projectId), {
          collectionList: [...currentList, collectionName],
          updatedAt: serverTimestamp()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `projects/${projectId}`);
      }
    }

    // 3. Add Data
    const colPath = `projects/${projectId}/collections/${collectionName}/docs`;
    const colRef = collection(db, colPath);
    try {
      const docRef = await addDoc(colRef, {
        ...data,
        _created: serverTimestamp()
      });
      return { id: docRef.id, ...data };
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, colPath);
      throw error;
    }
  },

  runtimeGet: async (apiKey: string, collectionName: string): Promise<DBEntry[]> => {
    const q = query(collection(db, 'projects'), where('apiKey', '==', apiKey));
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) throw new Error("Invalid API Key");
    
    const projectId = querySnapshot.docs[0].id;
    const colPath = `projects/${projectId}/collections/${collectionName}/docs`;
    const colRef = collection(db, colPath);
    try {
      const snapshot = await getDocs(colRef);
      return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, colPath);
      return [];
    }
  },

  runtimeUpdate: async (apiKey: string, collectionName: string, docId: string, data: any): Promise<void> => {
    const q = query(collection(db, 'projects'), where('apiKey', '==', apiKey));
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) throw new Error("Invalid API Key");
    
    const projectId = querySnapshot.docs[0].id;
    const docPath = `projects/${projectId}/collections/${collectionName}/docs/${docId}`;
    const docRef = doc(db, `projects/${projectId}/collections/${collectionName}/docs`, docId);
    
    try {
      await updateDoc(docRef, data);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, docPath);
    }
  },

  runtimeDelete: async (apiKey: string, collectionName: string, docId: string): Promise<void> => {
    const q = query(collection(db, 'projects'), where('apiKey', '==', apiKey));
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) throw new Error("Invalid API Key");
    
    const projectId = querySnapshot.docs[0].id;
    const docPath = `projects/${projectId}/collections/${collectionName}/docs/${docId}`;
    const docRef = doc(db, `projects/${projectId}/collections/${collectionName}/docs`, docId);
    
    try {
      await deleteDoc(docRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, docPath);
    }
  }
};
