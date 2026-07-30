import { createAuthService } from "./js/firebase/auth-service.js";
import { createCampaignRepository } from "./js/firebase/campaign-repository.js";
import { createFirebaseClient, isPlaceholderConfig } from "./js/firebase/client.js";
import { createCloudinaryService } from "./js/media/cloudinary-service.js";

const cfg = window.CDI_FIREBASE_CONFIG || {};

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
    getCampaignForJoin: () => Promise.resolve(null),
    joinCampaign: () => Promise.resolve(null),
    saveCampaign: () => Promise.resolve(),
    setPlayerPresence: () => Promise.resolve(),
    updateCharacterInventory: () => Promise.reject(new Error("Firebase nao configurado.")),
    assignPlayerCharacter: () => Promise.reject(new Error("Firebase nao configurado.")),
    resolveItemTransfer: () => Promise.reject(new Error("Firebase nao configurado.")),
    addCampaignMember: () => Promise.resolve(),
    deleteCampaign: () => Promise.resolve(),
    uploadImage: () => Promise.resolve("")
  };
}

function composeService(ctx) {
  const auth = createAuthService(ctx);
  const campaigns = createCampaignRepository(ctx);
  const media = createCloudinaryService(window.CDI_CLOUDINARY_CONFIG || {});

  return {
    enabled: true,
    get currentUser() { return auth.currentUser; },
    onAuthChanged: auth.onAuthChanged,
    signUp: auth.signUp,
    signIn: auth.signIn,
    signOut: auth.signOut,
    sendPasswordReset: auth.sendPasswordReset,
    updateCurrentPassword: auth.updateCurrentPassword,
    deleteCurrentUser: auth.deleteCurrentUser,
    saveUserProfile: auth.saveUserProfile,
    getUserProfile: auth.getUserProfile,
    watchCampaigns: campaigns.watchCampaigns,
    getCampaign: campaigns.getCampaign,
    getCampaignForJoin: campaigns.getCampaignForJoin,
    joinCampaign: campaigns.joinCampaign,
    saveCampaign: campaigns.saveCampaign,
    setPlayerPresence: campaigns.setPlayerPresence,
    updateCharacterInventory: campaigns.updateCharacterInventory,
    assignPlayerCharacter: campaigns.assignPlayerCharacter,
    resolveItemTransfer: campaigns.resolveItemTransfer,
    addCampaignMember: campaigns.addCampaignMember,
    deleteCampaign: campaigns.deleteCampaign,
    uploadImage: (_path, blob) => media.uploadImage(blob, { tags: "site-rpg" })
  };
}

async function boot() {
  if (isPlaceholderConfig(cfg)) {
    window.CDIFirebase = disabledService();
    window.dispatchEvent(new CustomEvent("cdi-firebase-ready"));
    return;
  }

  try {
    const ctx = await createFirebaseClient(cfg);
    window.CDIFirebase = composeService(ctx);
  } catch (err) {
    console.warn("Firebase nao foi inicializado.", err);
    window.CDIFirebase = disabledService();
  }

  window.dispatchEvent(new CustomEvent("cdi-firebase-ready"));
}

boot();
