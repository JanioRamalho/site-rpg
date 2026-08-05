export function isPlaceholderConfig(cfg) {
  return !cfg.apiKey
    || String(cfg.apiKey).includes("COLE_")
    || String(cfg.projectId || "").includes("SEU_");
}

export async function createFirebaseClient(cfg) {
  const firebaseApp = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js");
  const firebaseAuth = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js");
  const firebaseFirestore = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js");

  const app = firebaseApp.initializeApp(cfg);
  const auth = firebaseAuth.getAuth(app);
  await firebaseAuth.setPersistence(auth, firebaseAuth.browserLocalPersistence);
  const db = firebaseFirestore.initializeFirestore(app, {
    experimentalForceLongPolling: true,
    useFetchStreams: false,
    localCache: firebaseFirestore.persistentLocalCache({
      tabManager: firebaseFirestore.persistentMultipleTabManager()
    })
  });
  const api = { ...firebaseAuth, ...firebaseFirestore };

  await firebaseFirestore.enableNetwork(db);
  return { api, app, auth, db, projectId: cfg.projectId };
}
