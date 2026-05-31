import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDZc15m22TmIJpAIjMe4JGoACmzmfqski8",
  authDomain: "jeeptrack-f5d61.firebaseapp.com",
  databaseURL: "https://jeeptrack-f5d61-default-rtdb.firebaseio.com",
  projectId: "jeeptrack-f5d61",
  storageBucket: "jeeptrack-f5d61.firebasestorage.app",
  messagingSenderId: "307448153017",
  appId: "1:307448153017:web:64cc6fc240ec0a6e2cec68"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

export { db, auth };
