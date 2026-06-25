
import { 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  where, 
  doc, 
  setDoc,
  deleteDoc, 
  updateDoc, 
  getDoc,
  serverTimestamp,
  orderBy,
  limit,
  getCountFromServer,
  startAfter,
  QueryDocumentSnapshot
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { Project, DBEntry, Collection } from '../types';

let cachedUsePostgres: boolean | null = null;
async function shouldUsePostgres(): Promise<boolean> {
  if (cachedUsePostgres !== null) return cachedUsePostgres;
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    cachedUsePostgres = !!data.usePostgres;
  } catch (e) {
    cachedUsePostgres = false;
  }
  return cachedUsePostgres;
}

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
    rules: typeof data.rules === 'string' 
      ? data.rules 
      : JSON.stringify(data.rules || {
          "global": { ".read": "true", ".write": "true" },
          "scores": { ".read": "true", ".write": "newData.score > 0" }
        }, null, 2),
    stats: data.stats || { reads: 0, writes: 0 },
    collections: [], // We fetch these on demand now
    collectionList: data.collectionList || [],
    createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
    updatedAt: data.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
  };
};

export const FirebaseService = {
  // --- Management API ---

  getProjectCollections: async (projectId: string): Promise<Collection[]> => {
    if (await shouldUsePostgres()) {
      const user = auth.currentUser;
      if (!user) return [];
      const token = await user.getIdToken();
      const res = await fetch(`/api/projects/${projectId}/collections`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch collections');
      return await res.json();
    }

    const docRef = doc(db, 'projects', projectId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) return [];
    
    const data = docSnap.data();
    const rawColNames: string[] = data.collectionList || [];
    // Deduplicate names to prevent duplicate React keys in the UI
    const colNames = Array.from(new Set(rawColNames));
    // Return skeletons first to save reads. Data will be fetched on demand by CollectionViewer.
    return colNames.map(name => ({
      name,
      entries: [],
      totalCount: 0,
      hasLoaded: false,
      isLoading: false
    }));
  },

  getCollectionPreview: async (projectId: string, collectionName: string): Promise<Partial<Collection>> => {
    if (await shouldUsePostgres()) {
      const user = auth.currentUser;
      if (!user) return {};
      const token = await user.getIdToken();
      const res = await fetch(`/api/projects/${projectId}/collections/${collectionName}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch collection preview');
      return await res.json();
    }

    const colRef = collection(db, `projects/${projectId}/collections/${collectionName}/docs`);
    const q = query(colRef, orderBy('_created', 'desc'), limit(10));
    const [snapshot, countSnapshot] = await Promise.all([
      getDocs(q),
      getCountFromServer(colRef)
    ]);
    const entries = snapshot.docs.map(d => ({ ...d.data(), id: d.id }));
    return {
      entries,
      totalCount: countSnapshot.data().count,
      hasLoaded: true
    };
  },

  getFullCollection: async (
    projectId: string, 
    collectionName: string, 
    limitCount: number = 50,
    lastVisible: QueryDocumentSnapshot | null = null
  ): Promise<{ entries: DBEntry[], lastDoc: QueryDocumentSnapshot | null }> => {
    if (await shouldUsePostgres()) {
      const user = auth.currentUser;
      if (!user) return { entries: [], lastDoc: null };
      const token = await user.getIdToken();
      const res = await fetch(`/api/projects/${projectId}/collections/${collectionName}/full?limit=${limitCount}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch full collection');
      const data = await res.json();
      return {
        entries: data.entries,
        lastDoc: null
      };
    }

    const colRef = collection(db, `projects/${projectId}/collections/${collectionName}/docs`);
    
    let q;
    if (lastVisible) {
      q = query(colRef, orderBy('_created', 'desc'), startAfter(lastVisible), limit(limitCount));
    } else {
      q = query(colRef, orderBy('_created', 'desc'), limit(limitCount));
    }
    
    const snapshot = await getDocs(q);
    const entries = snapshot.docs.map(d => ({ ...(d.data() as object), id: d.id })) as DBEntry[];
    
    return {
      entries,
      lastDoc: snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null
    };
  },

  createProject: async (name: string): Promise<Project> => {
    if (await shouldUsePostgres()) {
      const user = auth.currentUser;
      if (!user) throw new Error("Must be logged in");
      const token = await user.getIdToken();
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create project');
      }
      return await res.json();
    }

    const user = auth.currentUser;
    if (!user) throw new Error("Must be logged in");

    // Check project limit (Max 5)
    const existingProjects = await FirebaseService.getAllProjects();
    if (existingProjects.length >= 5) {
      throw new Error("Project Limit Reached: You can only have up to 5 projects. Please delete an existing project to create a new one.");
    }

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
    if (await shouldUsePostgres()) {
      const user = auth.currentUser;
      if (!user) return [];
      const token = await user.getIdToken();
      const res = await fetch('/api/projects', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch projects');
      return await res.json();
    }

    const user = auth.currentUser;
    if (!user) return [];

    const q = query(collection(db, 'projects'), where('ownerId', '==', user.uid));
    const querySnapshot = await getDocs(q);
    
    const projects = querySnapshot.docs.map(mapDocToProject);
    return projects;
  },

  deleteProject: async (projectId: string): Promise<void> => {
    if (await shouldUsePostgres()) {
      const user = auth.currentUser;
      if (!user) throw new Error("Must be logged in");
      const token = await user.getIdToken();
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to delete project');
      }
      return;
    }

    await deleteDoc(doc(db, 'projects', projectId));
  },

  updateProject: async (projectId: string, data: Partial<Project>): Promise<void> => {
    if (await shouldUsePostgres()) {
      const user = auth.currentUser;
      if (!user) throw new Error("Must be logged in");
      const token = await user.getIdToken();
      const { id, collections, ...cleanData } = data as any;
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(cleanData)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update project');
      }
      return;
    }

    // We strip out the ID and complex types that shouldn't be saved directly if passed by accident
    const { id, collections, ...cleanData } = data as any;
    
    await updateDoc(doc(db, 'projects', projectId), {
      ...cleanData,
      updatedAt: serverTimestamp()
    });
  },

  saveFeedback: async (feedback: { name: string; email: string; message: string; timestamp: string }): Promise<void> => {
    await addDoc(collection(db, 'feedback'), feedback);
  },

  getAllFeedback: async (): Promise<any[]> => {
    const user = auth.currentUser;
    if (!user) throw new Error("Unauthorized");
    const token = await user.getIdToken();

    const res = await fetch('/api/admin/feedback', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch feedback');
    }
    return await res.json();
  },

  deleteFeedback: async (id: string): Promise<void> => {
    const user = auth.currentUser;
    if (!user) throw new Error("Unauthorized");
    const token = await user.getIdToken();

    const res = await fetch(`/api/admin/feedback/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to delete feedback');
    }
  },

  // --- User Management ---

  syncUser: async (): Promise<void> => {
    if (await shouldUsePostgres()) {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();
      const res = await fetch('/api/user/sync', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      if (!res.ok) {
        const err = await res.json();
        if (res.status === 403) {
          await auth.signOut();
        }
        throw new Error(err.error || 'Failed to sync user');
      }
      return;
    }

    const user = auth.currentUser;
    if (!user) return;

    // Check if banned
    const bannedRef = doc(db, 'banned_emails', user.email || '');
    const bannedSnap = await getDoc(bannedRef);
    if (bannedSnap.exists()) {
      await auth.signOut();
      throw new Error("This account has been permanently banned from PerDB.");
    }

    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      await setDoc(userRef, {
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        role: user.email === 'testimonyfresh49@gmail.com' ? 'admin' : 'user',
        isBanned: false,
        createdAt: serverTimestamp(),
        lastLogin: serverTimestamp()
      });
    } else {
      const existingData = userSnap.data();
      await updateDoc(userRef, {
        lastLogin: serverTimestamp(),
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        // Only auto-upgrade to admin if not already set and email matches
        ...(existingData.role !== 'admin' && user.email === 'testimonyfresh49@gmail.com' ? { role: 'admin' } : {})
      });
    }
  },


  getAllUsers: async (): Promise<any[]> => {
    const user = auth.currentUser;
    if (!user) throw new Error("Unauthorized");
    const token = await user.getIdToken();

    const res = await fetch('/api/admin/users', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to fetch users');
    }
    return await res.json();
  },

  updateUserStatus: async (userId: string, isBanned: boolean): Promise<void> => {
    const user = auth.currentUser;
    if (!user) throw new Error("Unauthorized");
    const token = await user.getIdToken();

    const res = await fetch('/api/admin/update-user', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ userId, updates: { isBanned } })
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update user status');
    }
  },

  deleteUser: async (userId: string): Promise<void> => {
    await deleteDoc(doc(db, 'users', userId));
  },

  deleteUserFull: async (userId: string): Promise<void> => {
    const user = auth.currentUser;
    if (!user) throw new Error("Unauthorized");
    const token = await user.getIdToken();

    const res = await fetch('/api/admin/delete-user-full', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ userId })
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to delete user and data');
    }
  },

  sendResetLink: async (email: string): Promise<string> => {
    const user = auth.currentUser;
    if (!user) throw new Error("Unauthorized");
    const token = await user.getIdToken();

    const res = await fetch('/api/admin/send-reset-link', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email })
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to generate reset link');
    }
    const data = await res.json();
    return data.link;
  },

  // --- Runtime API (Uses the Server API to bypass Firestore rules) ---
  
  runtimeAdd: async (apiKey: string, collectionName: string, data: any): Promise<any> => {
    const params = new URLSearchParams({ collection: collectionName });
    const res = await fetch(`/api?${params.toString()}`, {
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
    const params = new URLSearchParams({ collection: collectionName });
    const res = await fetch(`/api?${params.toString()}`, {
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
    const params = new URLSearchParams({ collection: collectionName, id: docId });
    const res = await fetch(`/api?${params.toString()}`, {
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
    const params = new URLSearchParams({ collection: collectionName, id: docId });
    const res = await fetch(`/api?${params.toString()}`, {
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
