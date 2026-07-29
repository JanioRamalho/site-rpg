import { withRetry } from "./utils.js";

export function createAuthService(ctx) {
  const { api, auth, db } = ctx;

  function fallbackProfile(user, role = "", name = "") {
    if (!user) return null;
    return {
      id: user.uid,
      name: name || user.displayName || user.email,
      email: user.email,
      role,
      offlineProfile: true
    };
  }

  async function saveUserProfile(user, role, name) {
    if (!user) return null;
    const profile = {
      id: user.uid,
      name: name || user.displayName || user.email,
      email: user.email,
      role,
      updatedAt: api.serverTimestamp()
    };
    try {
      await withRetry(() => api.setDoc(api.doc(db, "users", user.uid), profile, { merge: true }), ctx);
    } catch (err) {
      console.warn("Nao foi possivel salvar o perfil no Firestore.", err);
      return fallbackProfile(user, role, name);
    }
    return profile;
  }

  async function getUserProfile(uid) {
    if (!uid) return null;
    try {
      const snap = await withRetry(() => api.getDoc(api.doc(db, "users", uid)), ctx);
      return snap.exists() ? { id: uid, ...snap.data() } : null;
    } catch (err) {
      console.warn("Nao foi possivel buscar o perfil no Firestore.", err);
      const user = auth.currentUser;
      return user && user.uid === uid ? fallbackProfile(user) : null;
    }
  }

  async function signUp(email, password, name, role) {
    const cred = await api.createUserWithEmailAndPassword(auth, email, password);
    await api.updateProfile(cred.user, { displayName: name });
    const profile = fallbackProfile(cred.user, role, name);
    saveUserProfile(cred.user, role, name).catch(err => {
      console.warn("Perfil sera usado localmente ate o Firestore responder.", err);
    });
    return profile;
  }

  async function signIn(email, password, roleHint = "") {
    const cred = await api.signInWithEmailAndPassword(auth, email, password);
    const profile = await getUserProfile(cred.user.uid);
    if (profile) return profile;
    if (roleHint) return saveUserProfile(cred.user, roleHint, cred.user.displayName || email);
    return fallbackProfile(cred.user, roleHint);
  }

  return {
    fallbackProfile,
    get currentUser() { return auth.currentUser || null; },
    onAuthChanged: cb => api.onAuthStateChanged(auth, cb),
    signOut: () => api.signOut(auth),
    sendPasswordReset: email => api.sendPasswordResetEmail(auth, email),
    updateCurrentPassword: password => api.updatePassword(auth.currentUser, password),
    deleteCurrentUser: () => api.deleteUser(auth.currentUser),
    saveUserProfile,
    getUserProfile,
    signUp,
    signIn
  };
}
