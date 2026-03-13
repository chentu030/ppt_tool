import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyDMHyOpFTc8JwMim4-mB5Tb79fEzwj_-tw",
  authDomain: "project-d70e7.firebaseapp.com",
  databaseURL: "https://project-d70e7-default-rtdb.firebaseio.com",
  projectId: "project-d70e7",
  storageBucket: "project-d70e7.firebasestorage.app",
  messagingSenderId: "260921428694",
  appId: "1:260921428694:web:0d4a4f238106d6b3191777",
  measurementId: "G-K8M3Q76TQR"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
