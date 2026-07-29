const cfg = window.CDI_FIREBASE_CONFIG || {};
const isPlaceholder = !cfg.apiKey || String(cfg.apiKey).includes("COLE_") || String(cfg.projectId || "").includes("SEU_");

let auth = null;
let db = null;
let enabled = false;
let api = null;

const stripUndefined = value => JSON.parse(JSON.stringify(value ?? null));

function disabledService() {
  return {
    enabled: false,
    get currentUser() { return null; },
    onAuthChanged: () => () => {},
    signUp: () => Promise.reject(new Error("Firebase nao configurado.")),
    signIn: () => Promise.reject(new Error("Firebase nao configurado.")),
    signOut: () => Promise.resolve(),
    sendPasswordReset: () => Promise.reject(new Error("Firebase nao configurado.")),
    updateCurrentPassword: () => Promise.reject(new Error("Firebase nao configurado.")),
    deleteCurrentUser: () => Promise.reject(new Error("Firebase nao configurado.")),
    saveUserProfile: () => Promise.resolve(null),
    getUserProfile: () => Promise.resolve(null),
    watchCampaigns: () => () => {},
    getCampaign: () => Promise.resolve(null),
    saveCampaign: () => Promise.resolve(),
    addCampaignMember: () => Promise.resolve(),
    deleteCampaign: () => Promise.resolve()
  };
}

async function boot() {
  if (isPlaceholder) {
    window.CDIFirebase = disabledService();
    window.dispatchEvent(new CustomEvent("cdi-firebase-ready"));
    return;
  }

  try {
    const firebaseApp = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js");
    const firebaseAuth = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js");
    const firebaseFirestore = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js");

    api = { ...firebaseAuth, ...firebaseFirestore };
    const app = firebaseApp.initializeApp(cfg);
    auth = firebaseAuth.getAuth(app);
    db = firebaseFirestore.getFirestore(app);
    enabled = true;

    window.CDIFirebase = service();
  } catch (err) {
    console.warn("Firebase nao foi inicializado.", err);
    window.CDIFirebase = disabledService();
  }

  window.dispatchEvent(new CustomEvent("cdi-firebase-ready"));
}

function service() {
  return {
    enabled,
    get currentUser() { return auth?.currentUser || null; },
    onAuthChanged: cb => api.onAuthStateChanged(auth, cb),
    signUp,
    signIn,
    signOut: () => api.signOut(auth),
    sendPasswordReset: email => api.sendPasswordResetEmail(auth, email),
    updateCurrentPassword: password => api.updatePassword(auth.currentUser, password),
    deleteCurrentUser: () => api.deleteUser(auth.currentUser),
    saveUserProfile,
    getUserProfile,
    watchCampaigns,
    getCampaign,
    saveCampaign,
    addCampaignMember,
    deleteCampaign
  };
}

async function saveUserProfile(user, role, name) {
  if (!enabled || !user) return null;
  const profile = {
    id: user.uid,
    name: name || user.displayName || user.email,
    email: user.email,
    role,
    updatedAt: api.serverTimestamp()
  };
  await api.setDoc(api.doc(db, "users", user.uid), profile, { merge: true });
  return profile;
}

async function getUserProfile(uid) {
  if (!enabled || !uid) return null;
  const snap = await api.getDoc(api.doc(db, "users", uid));
  return snap.exists() ? { id: uid, ...snap.data() } : null;
}

async function signUp(email, password, name, role) {
  const cred = await api.createUserWithEmailAndPassword(auth, email, password);
  await api.updateProfile(cred.user, { displayName: name });
  return saveUserProfile(cred.user, role, name);
}

async function signIn(email, password) {
  const cred = await api.signInWithEmailAndPassword(auth, email, password);
  return getUserProfile(cred.user.uid);
}

function watchCampaigns(userId, callback, onError) {
  if (!enabled || !userId) return () => {};
  const q = api.query(api.collection(db, "campaigns"), api.where("members", "array-contains", userId));
  return api.onSnapshot(q, snapshot => {
    const campaigns = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(campaigns);
  }, onError);
}

async function getCampaign(campaignId) {
  if (!enabled || !campaignId) return null;
  const snap = await api.getDoc(api.doc(db, "campaigns", campaignId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function saveCampaign(campaign) {
  if (!enabled || !campaign?.id) return;
  const cleaned = stripUndefined({
    ...campaign,
    updatedAt: new Date().toISOString()
  });
  await api.setDoc(api.doc(db, "campaigns", campaign.id), cleaned, { merge: true });
}

async function addCampaignMember(campaignId, userId) {
  if (!enabled || !campaignId || !userId) return;
  await api.updateDoc(api.doc(db, "campaigns", campaignId), {
    members: api.arrayUnion(userId),
    updatedAt: new Date().toISOString()
  });
}

async function deleteCampaign(campaignId) {
  if (!enabled || !campaignId) return;
  await api.deleteDoc(api.doc(db, "campaigns", campaignId));
}

boot();
