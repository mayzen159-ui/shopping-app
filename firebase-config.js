// Firebase Configuration
// You'll need to replace this with your own Firebase config from console.firebase.google.com

const firebaseConfig = {
    apiKey: "AIzaSyDWCGUeog9lNDLUoszMWl6dduDDMQuJfZQ",
    authDomain: "momo-snuf-grocery-list.firebaseapp.com",
    databaseURL: "https://momo-snuf-grocery-list-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "momo-snuf-grocery-list",
    storageBucket: "momo-snuf-grocery-list.firebasestorage.app",
    messagingSenderId: "267138296967",
    appId: "1:267138296967:web:03612f8bc79d0f0f665c22"
};

// Initialize Firebase
let db = null;
let isFirebaseEnabled = false;

try {
    if (firebaseConfig.apiKey !== "YOUR_API_KEY") {
        firebase.initializeApp(firebaseConfig);
        db = firebase.database();
        isFirebaseEnabled = true;
        console.log('✅ Firebase initialized successfully');
    } else {
        console.log('⚠️ Firebase not configured - using localStorage only');
    }
} catch (error) {
    console.error('❌ Firebase initialization error:', error);
    console.log('⚠️ Falling back to localStorage');
}
