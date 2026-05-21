import { getApps, initializeApp } from "firebase/app";
import type { FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp | null = null;

function validateFirebaseConfig() {
  const missingKeys = Object.entries(firebaseConfig)
    .filter(([, value]) => !value || String(value).trim().length === 0)
    .map(([key]) => key);

  if (missingKeys.length > 0) {
    throw new Error(
      `Firebase client config is missing: ${missingKeys.join(", ")}. Check NEXT_PUBLIC_FIREBASE_* environment variables and rebuild the app.`
    );
  }

  if (!String(firebaseConfig.apiKey).startsWith("AIza")) {
    throw new Error(
      "Firebase client config has an invalid apiKey format. Check NEXT_PUBLIC_FIREBASE_API_KEY and rebuild the app."
    );
  }
}

function getFirebaseApp(): FirebaseApp {
  if (typeof window === "undefined") {
    throw new Error("Firebase client is only available in the browser");
  }
  if (!app) {
    if (getApps().length > 0) {
      app = getApps()[0] as FirebaseApp;
    } else {
      validateFirebaseConfig();
      app = initializeApp(firebaseConfig);
    }
  }
  return app;
}

export function getClientFirestore(): Firestore {
  return getFirestore(getFirebaseApp());
}

export function getClientAuth(): Auth {
  return getAuth(getFirebaseApp());
}
