import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// ------------------------------------------------------------------
// CONFIGURATION:
// Live connection to Project: studio-4900347069-1bc24
// ------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyC-xMfx2NmJGXxEKGIttsND8Dlyr-kSkpQ",
  authDomain: "sample-firebase-ai-app-7946d.firebaseapp.com",
  projectId: "sample-firebase-ai-app-7946d",
  storageBucket: "sample-firebase-ai-app-7946d.firebasestorage.app",
  messagingSenderId: "889021229266",
  appId: "1:889021229266:web:bebf57996e90939c70650b"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);