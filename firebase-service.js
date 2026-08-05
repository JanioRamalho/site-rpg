import { createAuthService } from "./js/firebase/auth-service.js";
import { createCampaignRepository } from "./js/firebase/campaign-repository.js";
import { createFirebaseClient, isPlaceholderConfig } from "./js/firebase/client.js";
import { createCloudinaryService } from "./js/media/cloudinary-service.js";

const cfg = window.CDI_FIREBASE_CONFIG || {};
const media = createCloudinaryService(window.CDI_CLOUDINARY_CONFIG || {});

function mediaTags(tags) {
  const values = Array.isArray(tags) ? tags : String(tags || "").split(",");
  return [...new Set(["site-rpg", ...values].map(tag => String(tag).trim()).filter(Boolean))];
}

function uploadMedia(pathOrBlob, blobOrOptions, maybeOptions) {
  const hasLegacyPath = typeof pathOrBlob === "string";
  const blob = hasLegacyPath ? blobOrOptions : pathOrBlob;
  const options = (hasLegacyPath ? maybeOptions : blobOrOptions) || {};
  return media.uploadImage(blob, { ...options, tags: mediaTags(options.tags) });
}

function disabledService() {
  return {
    enabled: false,
    get mediaConfigured() { return media.isConfigured(); },
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
    adjustCharacterVital: () => Promise.reject(new Error("Firebase nao configurado.")),
    updateCharacterExpressions: () => Promise.reject(new Error("Firebase nao configurado.")),
    updateTraumaCatalog: () => Promise.reject(new Error("Firebase nao configurado.")),
    updateCharacterTraumas: () => Promise.reject(new Error("Firebase nao configurado.")),
    updateCharacterInventory: () => Promise.reject(new Error("Firebase nao configurado.")),
    updateCharacterEvidenceAssignments: () => Promise.reject(new Error("Firebase nao configurado.")),
    commitCampaignMediaMutation: () => Promise.reject(new Error("Firebase nao configurado.")),
    migrateCampaignImages: () => Promise.reject(new Error("Firebase nao configurado.")),
    preflightCampaignImageMigration: () => Promise.reject(new Error("Firebase nao configurado.")),
    upgradeLegacyCampaignStorageLayout: () => Promise.reject(new Error("Firebase nao configurado.")),
    updateCampaignScenes: () => Promise.reject(new Error("Firebase nao configurado.")),
    updateLiveScene: () => Promise.reject(new Error("Firebase nao configurado.")),
    updateTraumaCatalogAndCharacters: () => Promise.reject(new Error("Firebase nao configurado.")),
    assignPlayerCharacter: () => Promise.reject(new Error("Firebase nao configurado.")),
    resolveItemTransfer: () => Promise.reject(new Error("Firebase nao configurado.")),
    restoreCampaignScene: () => Promise.reject(new Error("Firebase nao configurado.")),
    trashCampaignScene: () => Promise.reject(new Error("Firebase nao configurado.")),
    addCampaignMember: () => Promise.resolve(),
    deleteCampaign: () => Promise.resolve(),
    uploadImage: uploadMedia
  };
}

function composeService(ctx) {
  const auth = createAuthService(ctx);
  const campaigns = createCampaignRepository({
    ...ctx,
    cloudinaryCloudName: window.CDI_CLOUDINARY_CONFIG?.cloudName || ""
  });
  return {
    enabled: true,
    get mediaConfigured() { return media.isConfigured(); },
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
    adjustCharacterVital: campaigns.adjustCharacterVital,
    updateCharacterExpressions: campaigns.updateCharacterExpressions,
    updateTraumaCatalog: campaigns.updateTraumaCatalog,
    updateCharacterTraumas: campaigns.updateCharacterTraumas,
    updateCharacterInventory: campaigns.updateCharacterInventory,
    updateCharacterEvidenceAssignments: campaigns.updateCharacterEvidenceAssignments,
    commitCampaignMediaMutation: campaigns.commitCampaignMediaMutation,
    migrateCampaignImages: campaigns.migrateCampaignImages,
    preflightCampaignImageMigration: campaigns.preflightCampaignImageMigration,
    upgradeLegacyCampaignStorageLayout: campaigns.upgradeLegacyCampaignStorageLayout,
    updateCampaignScenes: campaigns.updateCampaignScenes,
    updateLiveScene: campaigns.updateLiveScene,
    updateTraumaCatalogAndCharacters: campaigns.updateTraumaCatalogAndCharacters,
    assignPlayerCharacter: campaigns.assignPlayerCharacter,
    resolveItemTransfer: campaigns.resolveItemTransfer,
    restoreCampaignScene: campaigns.restoreCampaignScene,
    trashCampaignScene: campaigns.trashCampaignScene,
    addCampaignMember: campaigns.addCampaignMember,
    deleteCampaign: campaigns.deleteCampaign,
    uploadImage: uploadMedia
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
