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
    deleteEvidenceCatalogEntry: () => Promise.reject(new Error("Firebase nao configurado.")),
    saveUserProfile: () => Promise.resolve(null),
    getUserProfile: () => Promise.resolve(null),
    watchCampaigns: () => () => {},
    watchPrivateMessages: () => () => {},
    getCampaign: () => Promise.resolve(null),
    getCampaignForJoin: () => Promise.resolve(null),
    joinCampaign: () => Promise.resolve(null),
    recordDiceRoll: () => Promise.reject(new Error("Firebase nao configurado.")),
    saveCampaign: () => Promise.resolve(),
    sendCampaignMessage: () => Promise.reject(new Error("Firebase nao configurado.")),
    sendPrivateCampaignMessage: () => Promise.reject(new Error("Firebase nao configurado.")),
    setPlayerPresence: () => Promise.resolve(),
    updateCharacterExpressions: () => Promise.reject(new Error("Firebase nao configurado.")),
    updateTraumaCatalog: () => Promise.reject(new Error("Firebase nao configurado.")),
    updateCharacterTraumas: () => Promise.reject(new Error("Firebase nao configurado.")),
    updateCharacterInventory: () => Promise.reject(new Error("Firebase nao configurado.")),
    updateCharacterEvidenceAssignments: () => Promise.reject(new Error("Firebase nao configurado.")),
    updateTraumaCatalogAndCharacters: () => Promise.reject(new Error("Firebase nao configurado.")),
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
    deleteEvidenceCatalogEntry: campaigns.deleteEvidenceCatalogEntry,
    saveUserProfile: auth.saveUserProfile,
    getUserProfile: auth.getUserProfile,
    watchCampaigns: campaigns.watchCampaigns,
    watchPrivateMessages: campaigns.watchPrivateMessages,
    getCampaign: campaigns.getCampaign,
    getCampaignForJoin: campaigns.getCampaignForJoin,
    joinCampaign: campaigns.joinCampaign,
    recordDiceRoll: campaigns.recordDiceRoll,
    saveCampaign: campaigns.saveCampaign,
    sendCampaignMessage: campaigns.sendCampaignMessage,
    sendPrivateCampaignMessage: campaigns.sendPrivateCampaignMessage,
    setPlayerPresence: campaigns.setPlayerPresence,
    updateCharacterExpressions: campaigns.updateCharacterExpressions,
    updateTraumaCatalog: campaigns.updateTraumaCatalog,
    updateCharacterTraumas: campaigns.updateCharacterTraumas,
    updateCharacterInventory: campaigns.updateCharacterInventory,
    updateCharacterEvidenceAssignments: campaigns.updateCharacterEvidenceAssignments,
    updateTraumaCatalogAndCharacters: campaigns.updateTraumaCatalogAndCharacters,
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
