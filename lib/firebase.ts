import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore } from 'firebase/firestore';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Initialize Firestore with long polling to avoid connection issues in some environments
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, (firebaseConfig as any).firestoreDatabaseId);

// Initialize App Check
if (typeof window !== 'undefined') {
  // Use the provided reCAPTCHA v3 site key
  const siteKey = '6LdfubAsAAAAAFRer5_eMishZi6oLIdl_j-uQGzf';
  
  try {
    /* Temporarily disabling App Check to troubleshoot "Connection failed" error 
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true
    });
    */
    console.log("App Check is currently disabled for troubleshooting.");
  } catch (e) {
    console.warn("App Check failed to initialize:", e);
  }
}

// Connection test as per integration guidelines
import { getDocFromServer, doc } from 'firebase/firestore';

async function testConnection() {
  if (typeof window === 'undefined') return;
  
  try {
    // Try to get a dummy doc to verify connection
    await getDocFromServer(doc(db, '_connection_test_', 'ping'));
    console.log("Firestore connection verified.");
  } catch (error) {
    if (error instanceof Error && (error.message.includes('the client is offline') || error.message.includes('Connection failed'))) {
      console.error("Firestore connectivity issue detected. Please check your network or Firebase configuration.");
      console.error("Error details:", error.message);
    } else {
      console.warn("Firestore connection check produced an error (this might be normal if rules deny read):", error);
    }
  }
}

testConnection();
