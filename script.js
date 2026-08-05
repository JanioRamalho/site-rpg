/**
 * CRÔNICAS DO INFINITO - SCRIPT PRINCIPAL
 * Versão Completa com Gerenciamento de Fotos, Permissões de Trocas e Exclusão/Limpeza no Painel do Mestre
 */

const ATTR = ["Físico", "Agilidade", "Inteligência", "Percepção", "Vontade", "Presença"];
const RES = ["Física", "Mental", "Sobrenatural"];
const ORIGINS = ["Policial", "Médico", "Padre", "Caçador", "Jornalista", "Cientista", "Engenheiro", "Professor"];

const OFFICIAL_SKILLS = [
  "🗣️ Detectar Mentiras", "📑 Burocracia", "🥷 Furtividade", "🏹 Conhecimento da Presa",
  "🌲 Sobrevivencia", "🩺 Medicina", "🧬 Ciências", "⚙️ Engenharia",
  "💻 Tecnologia", "📰 Jornalismo", "🧠 História", "🔮 Ocultismo",
  "👁️ Percepção", "🗣️ Manipulação"
];

const ICONS_LIST = ["🗡️", "🛡️", "🔮", "🔥", "⚡", "📜", "🗝️", "🎯", "🧬", "🧪", "🕵️", "💣", "🩸", "🕯️", "👻"];
const CHAT_AUTHOR_COLORS = [
  "#7dd3fc", "#f9a8d4", "#86efac", "#c4b5fd", "#fdba74",
  "#fca5a5", "#fde68a", "#67e8f9", "#bef264", "#d8b4fe"
];
const tabletop = window.CDITabletop;

// Estado Global
let state = JSON.parse(localStorage.getItem("cdi_fase1_full")) || { masters: [], campaigns: [] };

state.masters ??= [];
state.campaigns?.forEach(c => {
  c.masterId ??= "m1";
  c.diceLogs ??= [];
  c.customSkills ??= [...OFFICIAL_SKILLS];
  c.items ??= [];
  c.originLoadouts ??= {};
  c.evidence ??= [];
  c.itemTransfers ??= [];
  c.gameBoard ??= { image: "", updatedAt: null };
  c.previousGameBoard ??= { image: "", updatedAt: null };
});

let session = { role: null, campaign: null, player: null, currentMaster: null, view: "home" };
let firebaseUser = null;
let firebaseProfile = null;
let firebaseReady = false;
let unsubscribeCampaigns = null;
let isApplyingRemoteState = false;
let lastSavedCampaignJson = "";
let lastRemoteCampaignJson = "";
const campaignSaveStates = new Map();
const campaignRemoteBaselines = new Map();
let syncStatus = "Carregando Firebase...";
let presenceTimer = null;
let presenceContext = null;
let sessionRestoreCompleted = false;
const resolvingTransfers = new Set();
const linkingPlayers = new Set();
const selectedSceneIds = new Map();
let sceneUploadInProgress = false;
let sceneMutationInProgress = false;
let sceneUploadProgress = { total: 0, completed: 0, failed: 0, phase: "" };
const pendingSceneCommits = new Map();
const sceneOutboxLoads = new Set();
const sceneOutboxErrors = new Map();
let boardUploadInProgress = false;
let chatSendInProgress = false;
let privateMessages = [];
let unsubscribePrivateMessages = null;
let privateMessageWatchKey = "";
let lastPrivateMessagesJson = "";
let activeChatChannel = { campaignId: "", type: "public", threadId: "" };
const chatDrafts = new Map();
const chatScrollStates = new Map();
const chatForceScrollKeys = new Set();
let traumaAudioContext = null;
let traumaAlertAudioBuffer = null;
let traumaAlertAudioPromise = null;
let activeTraumaAudioSource = null;
const traumaMutations = new Set();
const expressionMutations = new Set();
const evidenceMutations = new Set();
const vitalMutationStates = new Map();
const fullscreenImageErrorHandlers = new WeakMap();
let renderDeferredByModal = false;
let imageMigrationInProgress = false;
let imageMigrationProgress = { total: 0, completed: 0, phase: "" };
let localStorageWarningShown = false;
const uploadedImageMetadata = new Map();

const SESSION_STORAGE_KEY = "cdi_session_context_v2";
const TRAUMA_ALERT_SOUND_URL = "assets/audio/trauma-alert-dark-fantasy.mp3";
const TRAUMA_SEEN_STORAGE_KEY = "cdi_seen_trauma_events_v1";
const TRAUMA_EVENT_MAX_AGE_MS = 60 * 1000;
const DICE_ROLL_SEEN_STORAGE_KEY = "cdi_seen_dice_rolls_v1";
const DICE_ROLL_EVENT_MAX_AGE_MS = 60 * 1000;
const CHAT_MESSAGE_LIMIT = 100;
const PRIVATE_CHAT_STORAGE_KEY = "cdi_private_messages_v1";
const MEDIA_OUTBOX_DB_NAME = "cdi_media_outbox_v1";
const MEDIA_OUTBOX_STORE = "sceneCommitsV2";
const LEGACY_MEDIA_OUTBOX_STORE = "sceneCommits";
const CAMPAIGN_SAVE_OUTBOX_STORE = "campaignSaves";
const MEDIA_MUTATION_OUTBOX_STORE = "mediaMutations";
const CAMPAIGN_SAVE_MARKERS_KEY = "cdi_pending_campaign_saves_v1";
const CAMPAIGN_SAVE_FALLBACK_KEY = "cdi_pending_campaign_payloads_v1";
const MEDIA_MUTATION_FALLBACK_KEY = "cdi_pending_media_mutations_v1";
const MAX_IMAGE_FILE_BYTES = 25 * 1024 * 1024;
const IMAGE_UPLOAD_CONCURRENCY = 3;
const MAX_ACTIVE_SCENES = 40;
const MASTER_VIEWS = new Set([
  "messages", "room", "scenes", "home", "campaigns", "campaign", "characters",
  "expressions", "traumas", "skills", "diceLogs", "cases", "creatures", "items", "evidence", "marks",
  "transfers", "players", "settings"
]);
const PLAYER_VIEWS = new Set(["messages", "room", "scenes", "sheet", "traumas", "inventory", "evidencePlayer", "transferPlayer"]);

const root = document.getElementById("root");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const campaignSaveClientId = uid();
const usingFirebase = () => Boolean(window.CDIFirebase?.enabled);
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const jsArg = value => esc(JSON.stringify(String(value ?? "")));

function isBase64Image(value) {
  return typeof value === "string" && /^data:image\//i.test(value);
}

function isCloudinaryImage(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "res.cloudinary.com") return false;
    const expectedCloudName = String(window.CDI_CLOUDINARY_CONFIG?.cloudName || "").trim().toLowerCase();
    if (!expectedCloudName) return true;
    return String(url.pathname.split("/").filter(Boolean)[0] || "").toLowerCase() === expectedCloudName;
  } catch {
    return false;
  }
}

function isUnmanagedImage(value) {
  const image = String(value || "").trim();
  return Boolean(image) && !isCloudinaryImage(image);
}

const CLOUDINARY_DELIVERY_PRESETS = {
  thumb: "c_limit,w_360,h_360/f_auto,fl_preserve_transparency/q_auto:good",
  icon: "c_limit,w_1000,h_1000/f_auto,fl_preserve_transparency/q_auto:good",
  stage: "c_limit,w_1920,h_1920/f_auto,fl_preserve_transparency/q_auto:best",
  board: "c_limit,w_2400,h_2400/f_auto,fl_preserve_transparency/q_auto:best",
  full: "c_limit,w_2560,h_2560/f_auto,fl_preserve_transparency/q_auto:best"
};

function cloudinaryDeliveryUrl(src, preset = "icon") {
  const value = String(src || "");
  const transformation = CLOUDINARY_DELIVERY_PRESETS[preset];
  if (!transformation || !isCloudinaryImage(value)) return value;
  const uploadSuffix = value.split("/image/upload/")[1] || "";
  const versionIndex = uploadSuffix.split("/").findIndex(segment => /^v\d+$/.test(segment));
  const deliveryPrefix = versionIndex >= 0
    ? uploadSuffix.split("/").slice(0, versionIndex)
    : [];
  const alreadyTransformed = deliveryPrefix.some(segment => segment.split(",").some(token => (
    /^(?:c|w|h|f|fl|ar|g|e|dpr|x|y|r|a|b|bo|co)_/.test(token) || /^q_auto(?::|$)/.test(token)
  )));
  if (alreadyTransformed) return value;
  return value.replace("/image/upload/", `/image/upload/${transformation}/`);
}

function imageSourceAttrs(src, preset = "icon") {
  const original = String(src || "");
  const delivered = cloudinaryDeliveryUrl(original, preset);
  const fallback = delivered !== original
    ? ` data-original-image="${esc(original)}" onerror="if(this.dataset.originalImage){this.onerror=null;this.src=this.dataset.originalImage;delete this.dataset.originalImage}"`
    : "";
  return `src="${esc(delivered)}"${fallback}`;
}

function imageMetadataFor(url) {
  return uploadedImageMetadata.get(String(url || "")) || null;
}

function applyImageAsset(target, url, field = "image") {
  if (!target || !url) return target;
  target[field] = url;
  const metadata = imageMetadataFor(url);
  if (metadata) target[`${field}Meta`] = { ...metadata };
  return target;
}

async function commitCampaignMediaMutation(campaignId, mutation) {
  const normalizedId = String(campaignId || "");
  if (!usingFirebase()) return { status: "local", verified: true };
  if (typeof window.CDIFirebase?.commitCampaignMediaMutation !== "function") {
    throw new Error("O servico de persistencia atomica de imagens ainda nao esta disponivel.");
  }
  const releaseSnapshotProtection = protectCampaignFromSnapshots(normalizedId);
  try {
    await flushBeforeAtomicCampaignMutation(normalizedId);
    const result = await window.CDIFirebase.commitCampaignMediaMutation(normalizedId, mutation);
    if (result?.verified !== true || result?.status !== "committed") {
      throw new Error("O Firebase nao confirmou integralmente a vinculacao da imagem.");
    }
    return result;
  } finally {
    releaseSnapshotProtection();
  }
}

function entityVisual(src, label, className = "avatar") {
  const name = String(label || "Imagem");
  if (src) {
    return `<img class="${className} entity-visual-image" ${imageSourceAttrs(src, "icon")} alt="${esc(name)}" loading="lazy" decoding="async" style="cursor:pointer;" onclick="openImageModal(${jsArg(src)}, ${jsArg(name)})">`;
  }
  const initial = name.trim().slice(0, 1).toUpperCase() || "?";
  return `<div class="${className} entity-visual-fallback" role="img" aria-label="${esc(name)}"><span>${esc(initial)}</span></div>`;
}

function imgInput(id, label, currentImage = "", required = false) {
  return `
    <div class="image-upload-field">
      <label>${esc(label)}${required ? `<span class="required-marker"> *</span>` : ""}</label>
      <div id="${id}Preview" class="image-upload-preview">${entityVisual(currentImage, label, "image-preview-visual")}</div>
      <input id="${id}" type="file" accept="image/*" ${required && !currentImage ? "required" : ""} ${required ? `aria-required="true"` : ""} onchange="previewImageInput(this, '${id}Preview')">
    </div>`;
}

function previewImageInput(input, previewId) {
  const file = input?.files?.[0];
  const preview = document.getElementById(previewId);
  if (!file || !preview) return;
  if (preview.dataset?.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
  const objectUrl = URL.createObjectURL(file);
  if (preview.dataset) preview.dataset.objectUrl = objectUrl;
  const image = document.createElement("img");
  image.className = "image-preview-visual entity-visual-image";
  image.alt = "Previa da imagem selecionada";
  image.onload = () => {
    URL.revokeObjectURL(objectUrl);
    if (preview.dataset?.objectUrl === objectUrl) delete preview.dataset.objectUrl;
  };
  image.src = objectUrl;
  preview.replaceChildren(image);
}

function readSessionContext() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || "null");
    return saved && typeof saved === "object" ? saved : null;
  } catch (_err) {
    return null;
  }
}

function clearSessionContext() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

function allowedSessionView(role, view) {
  const allowed = role === "master" ? MASTER_VIEWS : PLAYER_VIEWS;
  const fallback = role === "master" ? "home" : "sheet";
  return allowed.has(view) ? view : fallback;
}

function persistSessionContext() {
  if (!session.role) return;
  const authUid = firebaseUser?.uid || window.CDIFirebase?.currentUser?.uid || null;
  if (usingFirebase() && !authUid) return;
  const context = {
    mode: usingFirebase() ? "firebase" : "local",
    authUid,
    role: session.role,
    campaignId: session.campaign?.id ? String(session.campaign.id) : null,
    playerId: session.player?.id ? String(session.player.id) : null,
    masterId: session.currentMaster?.id || null,
    view: allowedSessionView(session.role, session.view),
    savedAt: new Date().toISOString()
  };
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(context));
}

function restoreFirebaseSession(user, profile) {
  if (!user || session.role) return false;
  const saved = readSessionContext();
  const savedBelongsToUser = saved?.mode === "firebase" && saved.authUid === user.uid;
  const role = savedBelongsToUser ? saved.role : profile?.role;
  const savedCampaignId = savedBelongsToUser && saved?.campaignId ? String(saved.campaignId) : null;
  const savedPlayerId = savedBelongsToUser && saved?.playerId ? String(saved.playerId) : null;

  if (role === "master") {
    const campaigns = state.campaigns.filter(campaign => campaign.masterId === user.uid);
    const campaign = savedCampaignId
      ? campaigns.find(entry => String(entry.id) === savedCampaignId) || null
      : campaigns[0] || null;
    if (savedCampaignId && !campaign) return false;
    session = {
      role: "master",
      campaign,
      player: null,
      currentMaster: profile || { id: user.uid, name: user.displayName || user.email, email: user.email, role: "master" },
      view: allowedSessionView("master", savedBelongsToUser ? saved.view : "home")
    };
    if (!campaign && !["home", "campaigns", "settings"].includes(session.view)) session.view = "home";
    persistSessionContext();
    return true;
  }

  if (role === "player") {
    const candidates = state.campaigns.filter(campaign => campaign.players?.some(player => player.authUid === user.uid));
    const campaign = savedCampaignId
      ? candidates.find(entry => String(entry.id) === savedCampaignId) || null
      : candidates[0] || null;
    if (savedCampaignId && !campaign) return false;
    const player = campaign?.players.find(entry => (
      entry.authUid === user.uid && (!savedPlayerId || String(entry.id) === savedPlayerId)
    )) || campaign?.players.find(entry => entry.authUid === user.uid) || null;
    if (!campaign || !player) return false;
    session = {
      role: "player",
      campaign,
      player,
      currentMaster: null,
      view: allowedSessionView("player", savedBelongsToUser ? saved.view : "sheet")
    };
    persistSessionContext();
    startPlayerPresence();
    return true;
  }

  return false;
}

function restoreLocalSession() {
  if (session.role) return true;
  const saved = readSessionContext();
  if (saved?.mode !== "local") return false;

  if (saved.role === "master") {
    const master = state.masters.find(entry => entry.id === saved.masterId);
    if (!master) return false;
    const campaigns = state.campaigns.filter(campaign => campaign.masterId === master.id);
    session = {
      role: "master",
      campaign: campaigns.find(entry => entry.id === saved.campaignId) || campaigns[0] || null,
      player: null,
      currentMaster: master,
      view: allowedSessionView("master", saved.view)
    };
    return true;
  }

  if (saved.role === "player") {
    const campaign = state.campaigns.find(entry => entry.id === saved.campaignId);
    const player = campaign?.players.find(entry => entry.id === saved.playerId);
    if (!campaign || !player) return false;
    session = {
      role: "player",
      campaign,
      player,
      currentMaster: null,
      view: allowedSessionView("player", saved.view)
    };
    updateLocalPlayerPresence(true);
    return true;
  }

  return false;
}

function normalizeCampaign(c) {
  if (!c) return c;
  tabletop?.normalizeCampaign(c, uid);
  c.masterId ??= "m1";
  c.players ??= [];
  c.characters ??= [];
  c.cases ??= [];
  c.creatures ??= [];
  c.items ??= [];
  c.originLoadouts ??= {};
  c.evidence ??= [];
  c.marks ??= [];
  c.diceLogs ??= [];
  c.scenes ??= [];
  c.sceneTrash ??= [];
  c.messages ??= [];
  c.traumaCatalog ??= [];
  c.customSkills ??= [...OFFICIAL_SKILLS];
  c.itemTransfers ??= [];
  c.gameBoard ??= { image: "", updatedAt: null };
  c.previousGameBoard ??= { image: "", updatedAt: null };
  c.members ??= [c.masterId, ...c.players.map(p => p.authUid).filter(Boolean)];
  ["players", "characters", "cases", "creatures", "items", "evidence", "marks", "diceLogs", "messages", "itemTransfers"].forEach(key => {
    c[key].forEach(item => item.id ??= uid());
  });
  return c;
}

function normalizeState() {
  state.masters ??= [];
  state.campaigns ??= [];
  state.campaigns.forEach(normalizeCampaign);
}

function persistLocal() {
  try {
    localStorage.setItem("cdi_fase1_full", JSON.stringify(state));
    localStorageWarningShown = false;
    return true;
  } catch (err) {
    console.error("Nao foi possivel atualizar o cache local.", err);
    setSyncStatus(usingFirebase() ? "Online; cache local cheio" : "Armazenamento local cheio");
    if (!localStorageWarningShown) {
      localStorageWarningShown = true;
      toast(usingFirebase()
        ? "O cache local esta cheio. A sincronizacao online continuara; migre as imagens antigas nas Configuracoes."
        : "O armazenamento local esta cheio. Migre as imagens antigas antes de continuar.");
    }
    return false;
  }
}

function setSyncStatus(status) {
  syncStatus = status;
  const el = document.getElementById("syncStatus");
  if (el) el.textContent = status;
}

function campaignSaveState(campaignId) {
  const normalizedId = String(campaignId || "");
  if (!campaignSaveStates.has(normalizedId)) {
    campaignSaveStates.set(normalizedId, {
      timer: null,
      queued: null,
      inFlight: null,
      flushPromise: null,
      durabilityPromise: Promise.resolve(),
      revision: 0,
      deferredRemote: null,
      atomicDepth: 0,
      retryCount: 0,
      baseCampaign: null
    });
  }
  return campaignSaveStates.get(normalizedId);
}

function campaignHasPendingSave(campaignId) {
  const pending = campaignSaveStates.get(String(campaignId || ""));
  return Boolean(pending?.queued || pending?.inFlight || pending?.flushPromise || pending?.atomicDepth);
}

function protectCampaignFromSnapshots(campaignId) {
  const normalizedId = String(campaignId || "");
  const pending = campaignSaveState(normalizedId);
  pending.atomicDepth += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pending.atomicDepth = Math.max(0, pending.atomicDepth - 1);
    if (!pending.atomicDepth && pending.queued && !pending.flushPromise && !pending.timer) {
      pending.timer = setTimeout(() => {
        pending.timer = null;
        flushCampaignSave(normalizedId).catch(reportBackgroundSaveFailure);
      }, 150);
    }
    if (!pending.atomicDepth && !pending.queued && !pending.inFlight && !pending.flushPromise && pending.deferredRemote) {
      refreshCampaignAfterDeferredSnapshot(normalizedId, pending);
    }
  };
}

function cloneCampaignForSave(campaign) {
  return JSON.parse(JSON.stringify(campaign));
}

function sameJsonValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeLocalChangesOntoRemote(base, local, remote) {
  if (sameJsonValue(local, base)) return remote === undefined ? undefined : cloneCampaignForSave(remote);
  if (local === undefined) return undefined;
  if (base === null || local === null || remote === null
    || typeof base !== "object" || typeof local !== "object" || typeof remote !== "object") {
    return cloneCampaignForSave(local);
  }

  if (Array.isArray(base) || Array.isArray(local) || Array.isArray(remote)) {
    if (!Array.isArray(base) || !Array.isArray(local) || !Array.isArray(remote)) return cloneCampaignForSave(local);
    const combinedEntries = [...base, ...local, ...remote];
    const hasStableIds = combinedEntries.length > 0 && combinedEntries.every(entry => (
      entry && typeof entry === "object" && !Array.isArray(entry) && entry.id !== undefined && entry.id !== null
    ));
    if (!hasStableIds) {
      return cloneCampaignForSave(local);
    }

    const baseById = new Map(base.map(entry => [String(entry.id), entry]));
    const localById = new Map(local.map(entry => [String(entry.id), entry]));
    const remoteById = new Map(remote.map(entry => [String(entry.id), entry]));
    const orderedIds = [...new Set([
      ...local.map(entry => String(entry.id)),
      ...remote.map(entry => String(entry.id))
    ])];
    return orderedIds.flatMap(id => {
      const baseEntry = baseById.get(id);
      const localEntry = localById.get(id);
      const remoteEntry = remoteById.get(id);
      if (baseEntry && !localEntry) return [];
      if (!localEntry) return remoteEntry ? [cloneCampaignForSave(remoteEntry)] : [];
      if (!baseEntry) {
        return [remoteEntry
          ? mergeLocalChangesOntoRemote({}, localEntry, remoteEntry)
          : cloneCampaignForSave(localEntry)];
      }
      if (!remoteEntry) {
        return sameJsonValue(localEntry, baseEntry) ? [] : [cloneCampaignForSave(localEntry)];
      }
      return [mergeLocalChangesOntoRemote(baseEntry, localEntry, remoteEntry)];
    });
  }

  const output = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  keys.forEach(key => {
    const merged = mergeLocalChangesOntoRemote(base[key], local[key], remote[key]);
    if (merged !== undefined) output[key] = merged;
  });
  return output;
}

function campaignSaveOutboxKey(authUid, campaignId) {
  return `${String(authUid || "anonymous")}:${String(campaignId || "")}`;
}

function isNewerCampaignSaveRecord(candidate, current) {
  if (!current) return true;
  const candidateRevision = Number(candidate?.revision || 0);
  const currentRevision = Number(current?.revision || 0);
  if (String(candidate?.clientId || "") && String(candidate?.clientId || "") === String(current?.clientId || "")) {
    if (candidateRevision !== currentRevision) return candidateRevision > currentRevision;
  }
  const candidateTime = Date.parse(candidate?.queuedAt || candidate?.updatedAt || "") || 0;
  const currentTime = Date.parse(current?.queuedAt || current?.updatedAt || "") || 0;
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  if (candidateRevision !== currentRevision) return candidateRevision > currentRevision;
  return String(candidate?.mutationId || "") > String(current?.mutationId || "");
}

function readCampaignSaveMarkers() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CAMPAIGN_SAVE_MARKERS_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeCampaignSaveMarkers(markers) {
  try {
    localStorage.setItem(CAMPAIGN_SAVE_MARKERS_KEY, JSON.stringify([...markers]));
    return true;
  } catch (err) {
    console.warn("Nao foi possivel atualizar o marcador da fila de campanhas.", err);
    return false;
  }
}

function readCampaignSaveFallbacks() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CAMPAIGN_SAVE_FALLBACK_KEY) || "[]");
    return new Map((Array.isArray(parsed) ? parsed : [])
      .filter(record => record?.key && record?.campaign?.id)
      .map(record => [String(record.key), record]));
  } catch {
    return new Map();
  }
}

function writeCampaignSaveFallbacks(records) {
  try {
    if (records.size) localStorage.setItem(CAMPAIGN_SAVE_FALLBACK_KEY, JSON.stringify([...records.values()]));
    else localStorage.removeItem(CAMPAIGN_SAVE_FALLBACK_KEY);
    return true;
  } catch (err) {
    console.warn("Nao foi possivel preservar o conteudo da fila de campanhas no fallback local.", err);
    return false;
  }
}

async function persistCampaignSaveJob(job) {
  const key = campaignSaveOutboxKey(job.authUid, job.campaign.id);
  const record = {
    key,
    authUid: String(job.authUid || ""),
    campaignId: String(job.campaign.id),
    campaign: cloneCampaignForSave(job.campaign),
    role: job.role || null,
    playerId: job.playerId || null,
    revision: Number(job.revision || 0),
    mutationId: String(job.mutationId || ""),
    baseCampaign: job.baseCampaign ? cloneCampaignForSave(job.baseCampaign) : null,
    clientId: String(job.clientId || ""),
    queuedAt: String(job.queuedAt || ""),
    isCreation: job.isCreation === true,
    updatedAt: new Date().toISOString()
  };

  const db = await openMediaOutboxDb();
  let storedInIndexedDb = false;
  let indexedDbRecord = null;
  if (db) {
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(CAMPAIGN_SAVE_OUTBOX_STORE, "readwrite");
        const store = transaction.objectStore(CAMPAIGN_SAVE_OUTBOX_STORE);
        const request = store.get(key);
        request.onsuccess = () => {
          const stored = request.result;
          if (!stored || isNewerCampaignSaveRecord(record, stored)) {
            indexedDbRecord = record;
            store.put(record);
          } else {
            indexedDbRecord = stored;
          }
        };
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error("A fila local abortou a gravacao da campanha."));
      });
      storedInIndexedDb = true;
    } catch (err) {
      console.warn("O IndexedDB falhou ao preservar a campanha; usando o fallback local.", err);
    } finally {
      db.close();
    }
  }

  const fallbacks = readCampaignSaveFallbacks();
  if (storedInIndexedDb) {
    const fallback = fallbacks.get(key);
    if (fallback && !isNewerCampaignSaveRecord(fallback, indexedDbRecord)) {
      fallbacks.delete(key);
      if (!writeCampaignSaveFallbacks(fallbacks)) {
        throw new Error("Nao foi possivel consolidar a fila duravel da campanha.");
      }
    }
  } else {
    const fallback = fallbacks.get(key);
    if (!fallback || isNewerCampaignSaveRecord(record, fallback)) fallbacks.set(key, record);
    if (!writeCampaignSaveFallbacks(fallbacks)) {
      throw new Error("O navegador nao disponibilizou armazenamento duravel para preservar a campanha.");
    }
  }
  const markers = readCampaignSaveMarkers();
  markers.add(key);
  writeCampaignSaveMarkers(markers);
}

async function clearPersistedCampaignSave(authUid, campaignId, mutationId) {
  const key = campaignSaveOutboxKey(authUid, campaignId);
  const db = await openMediaOutboxDb();
  let indexedDbHasAnotherMutation = false;
  if (db) {
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(CAMPAIGN_SAVE_OUTBOX_STORE, "readwrite");
        const store = transaction.objectStore(CAMPAIGN_SAVE_OUTBOX_STORE);
        const request = store.get(key);
        request.onsuccess = () => {
          const stored = request.result;
          if (!stored) return;
          if (String(stored.mutationId || "") === String(mutationId || "")) store.delete(key);
          else indexedDbHasAnotherMutation = true;
        };
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error("A fila local abortou a limpeza da campanha."));
      });
    } finally {
      db.close();
    }
  } else if (window.indexedDB) {
    throw new Error("Nao foi possivel conferir a fila duravel antes de limpar a campanha.");
  }
  const fallbacks = readCampaignSaveFallbacks();
  const fallback = fallbacks.get(key);
  let fallbackHasAnotherMutation = false;
  if (fallback && String(fallback.mutationId || "") === String(mutationId || "")) {
    fallbacks.delete(key);
    if (!writeCampaignSaveFallbacks(fallbacks)) {
      throw new Error("Nao foi possivel limpar o fallback duravel da campanha.");
    }
  } else if (fallback) {
    fallbackHasAnotherMutation = true;
  }
  const markers = readCampaignSaveMarkers();
  if (!indexedDbHasAnotherMutation && !fallbackHasAnotherMutation) {
    markers.delete(key);
    writeCampaignSaveMarkers(markers);
  }
}

async function readPersistedCampaignSaves(authUid) {
  const normalizedUid = String(authUid || "");
  const recordsByKey = new Map();
  const db = await openMediaOutboxDb();
  if (db) {
    let stored = [];
    try {
      stored = await new Promise((resolve, reject) => {
        const transaction = db.transaction(CAMPAIGN_SAVE_OUTBOX_STORE, "readonly");
        const request = transaction.objectStore(CAMPAIGN_SAVE_OUTBOX_STORE).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
        transaction.onabort = () => reject(transaction.error || new Error("A fila local abortou a leitura das campanhas."));
      });
    } catch (err) {
      console.warn("O IndexedDB falhou ao ler campanhas pendentes; tentando o fallback local.", err);
    } finally {
      db.close();
    }
    stored
      .filter(record => String(record.authUid || "") === normalizedUid)
      .forEach(record => recordsByKey.set(String(record.key), record));
  }

  readCampaignSaveFallbacks().forEach((record, key) => {
    if (String(record.authUid || "") !== normalizedUid) return;
    const prior = recordsByKey.get(key);
    if (isNewerCampaignSaveRecord(record, prior)) recordsByKey.set(key, record);
  });

  const knownKeys = new Set(recordsByKey.keys());
  readCampaignSaveMarkers().forEach(key => {
    if (!key.startsWith(`${normalizedUid}:`) || knownKeys.has(key)) return;
    const campaignId = key.slice(normalizedUid.length + 1);
    const campaign = findCampaign(campaignId);
    if (campaign) recordsByKey.set(key, {
      key,
      authUid: normalizedUid,
      campaignId,
      campaign: cloneCampaignForSave(campaign),
      role: campaign.masterId === normalizedUid ? "master" : "player",
      playerId: null,
      revision: 1,
      mutationId: "",
      baseCampaign: null,
      clientId: "legacy",
      queuedAt: "",
      isCreation: false
    });
  });
  return [...recordsByKey.values()];
}

async function hydrateCampaignSaveOutbox(authUid) {
  const records = await readPersistedCampaignSaves(authUid);
  records.forEach(record => {
    if (!record?.campaign?.id) return;
    const campaign = normalizeCampaign(record.campaign);
    const campaignId = String(campaign.id);
    state.campaigns = [campaign, ...state.campaigns.filter(entry => String(entry.id) !== campaignId)];
    if (String(session.campaign?.id || "") === campaignId) session.campaign = campaign;
    const pending = campaignSaveState(campaignId);
    pending.revision = Math.max(pending.revision, Number(record.revision || 0));
    pending.baseCampaign = record.baseCampaign ? cloneCampaignForSave(record.baseCampaign) : null;
    pending.queued = {
      campaign: cloneCampaignForSave(campaign),
      role: record.role || (campaign.masterId === authUid ? "master" : "player"),
      playerId: record.playerId || null,
      revision: pending.revision,
      authUid: String(authUid || ""),
      mutationId: String(record.mutationId || `${campaignId}:${uid()}`),
      baseCampaign: pending.baseCampaign ? cloneCampaignForSave(pending.baseCampaign) : null,
      clientId: String(record.clientId || "legacy"),
      queuedAt: String(record.queuedAt || record.updatedAt || ""),
      isCreation: record.isCreation === true,
      needsRebase: true
    };
  });
  if (records.length) persistLocal();
  return records.map(record => String(record.campaignId || record.campaign?.id || "")).filter(Boolean);
}

function applyReplayAuthoritativeCampaign(campaignId, authoritative) {
  const normalizedId = String(campaignId || "");
  if (!authoritative) {
    campaignRemoteBaselines.delete(normalizedId);
    state.campaigns = state.campaigns.filter(campaign => String(campaign.id) !== normalizedId);
    if (String(session.campaign?.id || "") === normalizedId) {
      session.campaign = null;
      session.player = null;
      session.view = session.role === "master" ? "campaigns" : "home";
    }
    persistLocal();
    return;
  }
  const normalized = normalizeCampaign(authoritative);
  campaignRemoteBaselines.set(normalizedId, cloneCampaignForSave(normalized));
  state.campaigns = [normalized, ...state.campaigns.filter(campaign => String(campaign.id) !== normalizedId)];
  if (String(session.campaign?.id || "") === normalizedId) session.campaign = normalized;
  persistLocal();
}

async function prepareReplayedCampaignSave(job, pending) {
  if (!job.needsRebase || typeof window.CDIFirebase?.getCampaign !== "function") return { skip: false };
  const authoritative = await withOperationTimeout(
    window.CDIFirebase.getCampaign(job.campaign.id),
    30000,
    "O Firebase demorou demais para reconciliar a campanha pendente."
  );
  const acknowledged = authoritative?.lastClientMutation
    && String(authoritative.lastClientMutation.id || "") === String(job.mutationId || "")
    && String(authoritative.lastClientMutation.authUid || "") === String(job.authUid || "");
  if (acknowledged || (!authoritative && job.baseCampaign)) {
    applyReplayAuthoritativeCampaign(job.campaign.id, authoritative);
    return { skip: true };
  }

  if (!job.baseCampaign) {
    if (!authoritative && job.isCreation) {
      job.needsRebase = false;
      return { skip: false };
    }
    const error = new Error("A alteracao pendente e de uma versao antiga e nao possui uma base segura para reconciliacao. Ela foi preservada neste navegador e nao sera reaplicada automaticamente.");
    error.code = "campaign/replay-baseline-missing";
    throw error;
  }

  if (authoritative) {
    job.campaign = normalizeCampaign(mergeLocalChangesOntoRemote(
      job.baseCampaign,
      job.campaign,
      authoritative
    ));
    job.baseCampaign = cloneCampaignForSave(authoritative);
    pending.baseCampaign = cloneCampaignForSave(authoritative);
    campaignRemoteBaselines.set(String(job.campaign.id), cloneCampaignForSave(authoritative));
    if (!pending.queued || Number(pending.queued.revision || 0) <= Number(job.revision || 0)) {
      pending.durabilityPromise = pending.durabilityPromise
        .catch(() => null)
        .then(() => persistCampaignSaveJob(job));
      job.durabilityPromise = pending.durabilityPromise;
      await job.durabilityPromise;
    }
  }
  job.needsRebase = false;
  return { skip: false };
}

async function refreshCampaignAfterDeferredSnapshot(campaignId, pending) {
  if (!pending.deferredRemote || pending.queued || pending.inFlight || pending.flushPromise || pending.atomicDepth) return;
  const deferred = pending.deferredRemote;
  lastRemoteCampaignJson = "";
  if (typeof window.CDIFirebase?.getCampaign !== "function") return;
  try {
    const authoritative = await withOperationTimeout(
      window.CDIFirebase.getCampaign(campaignId),
      30000,
      "O Firebase demorou demais para atualizar a campanha adiada."
    );
    if (campaignHasPendingSave(campaignId)) return;
    if (!authoritative) {
      if (deferred.present !== false) return;
      state.campaigns = state.campaigns.filter(campaign => String(campaign.id) !== String(campaignId));
      if (String(session.campaign?.id || "") === String(campaignId)) {
        session.campaign = null;
        session.player = null;
        session.view = session.role === "master" ? "campaigns" : "home";
      }
      if (pending.deferredRemote === deferred) pending.deferredRemote = null;
      persistLocal();
      requestPassiveRender();
      return;
    }
    const normalized = normalizeCampaign(authoritative);
    campaignRemoteBaselines.set(String(campaignId), cloneCampaignForSave(normalized));
    state.campaigns = state.campaigns.map(campaign => String(campaign.id) === String(campaignId) ? normalized : campaign);
    if (String(session.campaign?.id || "") === String(campaignId)) session.campaign = normalized;
    if (pending.deferredRemote === deferred) pending.deferredRemote = null;
    persistLocal();
    requestPassiveRender();
  } catch (err) {
    console.warn("Nao foi possivel atualizar o snapshot adiado da campanha.", err);
  }
}

function reportBackgroundSaveFailure(err) {
  console.error(err);
  setSyncStatus("Falha de sincronizacao");
  toast("Nao foi possivel sincronizar com o Firebase. A alteracao continua pendente para uma nova tentativa.");
}

function withOperationTimeout(promise, timeoutMs, message, code = "operation/timeout") {
  let timeout;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timeout = setTimeout(() => {
        const error = new Error(message);
        error.code = code;
        reject(error);
      }, timeoutMs);
    })
  ]).finally(() => clearTimeout(timeout));
}

function scheduleCampaignSaveRetry(campaignId, pending = campaignSaveState(campaignId)) {
  if (!pending.queued || pending.timer || pending.flushPromise || pending.atomicDepth) return;
  const delay = Math.min(1000 * (2 ** Math.min(pending.retryCount, 5)), 30000);
  pending.timer = setTimeout(() => {
    pending.timer = null;
    flushCampaignSave(campaignId).catch(reportBackgroundSaveFailure);
  }, delay);
}

async function flushCampaignSave(campaignId = session.campaign?.id) {
  const normalizedId = String(campaignId || "");
  if (!usingFirebase() || !normalizedId) return;
  const pending = campaignSaveState(normalizedId);
  if (pending.timer) {
    clearTimeout(pending.timer);
    pending.timer = null;
  }

  if (pending.flushPromise) {
    await pending.flushPromise;
    if (pending.queued) return flushCampaignSave(normalizedId);
    return;
  }
  if (!pending.queued) return;

  const flushPromise = (async () => {
    let lastCompletedJob = null;
    while (pending.queued) {
      const job = pending.queued;
      pending.queued = null;
      pending.inFlight = job;
      setSyncStatus("Sincronizando...");
      try {
        await job.durabilityPromise;
        const preparation = await prepareReplayedCampaignSave(job, pending);
        if (preparation.skip) {
          lastCompletedJob = job;
          pending.retryCount = 0;
          continue;
        }
        await window.CDIFirebase.saveCampaign(job.campaign, {
          role: job.role,
          playerId: job.playerId,
        baseCampaign: job.baseCampaign,
        mutationId: job.mutationId,
        mutationRevision: job.revision,
        isCreation: job.isCreation === true
        });
        lastCompletedJob = job;
        pending.retryCount = 0;
        campaignRemoteBaselines.set(normalizedId, cloneCampaignForSave(job.campaign));
        if (String(session.campaign?.id || "") === normalizedId) {
          lastSavedCampaignJson = JSON.stringify(job.campaign);
        }
        setSyncStatus("Online em tempo real");
      } catch (err) {
        job.needsRebase = true;
        const queuedRevision = Number(pending.queued?.revision || 0);
        if (!pending.queued || queuedRevision < job.revision) {
          pending.durabilityPromise = pending.durabilityPromise
            .catch(() => null)
            .then(() => persistCampaignSaveJob(job));
          job.durabilityPromise = pending.durabilityPromise;
          pending.queued = job;
        }
        pending.retryCount += 1;
        throw err;
      } finally {
        pending.inFlight = null;
      }
    }
    if (lastCompletedJob && !pending.queued) {
      pending.durabilityPromise = pending.durabilityPromise
        .catch(() => null)
        .then(() => clearPersistedCampaignSave(
          lastCompletedJob.authUid,
          normalizedId,
          lastCompletedJob.mutationId
        ));
      try {
        await pending.durabilityPromise;
        pending.baseCampaign = null;
      } catch (err) {
        if (!pending.queued || Number(pending.queued.revision || 0) < lastCompletedJob.revision) {
          lastCompletedJob.needsRebase = true;
          pending.queued = lastCompletedJob;
        }
        pending.retryCount += 1;
        throw err;
      }
    }
  })();
  pending.flushPromise = flushPromise;
  let failed = false;
  let failure = null;
  try {
    await flushPromise;
  } catch (err) {
    failed = true;
    failure = err;
    throw err;
  } finally {
    if (pending.flushPromise === flushPromise) pending.flushPromise = null;
    if (failed && failure?.code !== "campaign/replay-baseline-missing") {
      scheduleCampaignSaveRetry(normalizedId, pending);
    }
  }
  if (pending.queued) return flushCampaignSave(normalizedId);
  await refreshCampaignAfterDeferredSnapshot(normalizedId, pending);
}

function queueCampaignSave(campaign = session.campaign, context = {}) {
  if (!usingFirebase() || isApplyingRemoteState || !campaign?.id) return;
  normalizeCampaign(campaign);
  const normalizedId = String(campaign.id);
  const pending = campaignSaveState(normalizedId);
  pending.revision += 1;
  const hasExplicitBase = Object.prototype.hasOwnProperty.call(context, "baseCampaign");
  const explicitBase = hasExplicitBase && context.baseCampaign
    ? cloneCampaignForSave(context.baseCampaign)
    : null;
  const inheritedBase = hasExplicitBase
    ? explicitBase
    : (pending.queued?.baseCampaign
      || pending.inFlight?.baseCampaign
      || pending.baseCampaign
      || campaignRemoteBaselines.get(normalizedId)
      || null);
  if (hasExplicitBase) pending.baseCampaign = explicitBase;
  else if (!pending.baseCampaign && inheritedBase) pending.baseCampaign = cloneCampaignForSave(inheritedBase);
  const job = {
    campaign: cloneCampaignForSave(campaign),
    role: context.role ?? session.role,
    playerId: context.playerId ?? session.player?.id ?? null,
    revision: pending.revision,
    authUid: String(window.CDIFirebase?.currentUser?.uid || firebaseUser?.uid || ""),
    mutationId: `${normalizedId}:${uid()}`,
    baseCampaign: inheritedBase ? cloneCampaignForSave(inheritedBase) : null,
    clientId: campaignSaveClientId,
    queuedAt: new Date().toISOString(),
    isCreation: context.isCreation === true,
    needsRebase: false
  };
  pending.durabilityPromise = pending.durabilityPromise
    .catch(() => null)
    .then(() => persistCampaignSaveJob(job));
  job.durabilityPromise = pending.durabilityPromise;
  pending.queued = job;
  if (pending.timer) clearTimeout(pending.timer);
  if (pending.atomicDepth > 0) {
    pending.timer = null;
    return;
  }
  pending.timer = setTimeout(() => {
    pending.timer = null;
    flushCampaignSave(normalizedId).catch(reportBackgroundSaveFailure);
  }, 150);
}

async function flushBeforeAtomicCampaignMutation(campaignId = session.campaign?.id) {
  const normalizedId = String(campaignId || "");
  if (!usingFirebase() || !normalizedId) return;
  await withOperationTimeout(
    flushCampaignSave(normalizedId),
    15000,
    "Uma alteracao anterior continua pendente no Firebase. Ela esta preservada e seguira sincronizando; tente esta operacao novamente quando a conexao estabilizar.",
    "campaign/pending-save-timeout"
  );
}

function clearCampaignSaveStates() {
  campaignSaveStates.forEach(pending => {
    if (pending.timer) clearTimeout(pending.timer);
  });
  campaignSaveStates.clear();
  campaignRemoteBaselines.clear();
}

async function ensurePendingCampaignSavesAreDurable() {
  const durabilityPromises = new Set();
  campaignSaveStates.forEach(pending => {
    if (pending.durabilityPromise) durabilityPromises.add(pending.durabilityPromise);
    if (pending.queued?.durabilityPromise) durabilityPromises.add(pending.queued.durabilityPromise);
    if (pending.inFlight?.durabilityPromise) durabilityPromises.add(pending.inFlight.durabilityPromise);
  });
  await Promise.all([...durabilityPromises].map(promise => Promise.resolve(promise)));
}

const save = () => {
  normalizeState();
  const persisted = persistLocal();
  queueCampaignSave(session.campaign);
  return persisted;
};

function firebaseStatusText() {
  if (!window.CDIFirebase) return "Firebase carregando...";
  return usingFirebase() ? syncStatus : "Modo local: configure firebase-config.js";
}

function findCampaign(id) {
  return state.campaigns.find(c => c.id === id);
}

function openCampaign(id) {
  const campaign = findCampaign(id);
  if (!campaign) return alert("Campanha nao encontrada.");
  session.campaign = campaign;
  session.view = "campaign";
  render();
}

async function copyCampaignId(id) {
  try {
    await navigator.clipboard.writeText(id);
    toast("ID da campanha copiado!");
  } catch (err) {
    prompt("Copie o ID da campanha:", id);
  }
}

function getMasterCampaigns() {
  return session.currentMaster ? state.campaigns.filter(c => c.masterId === session.currentMaster.id) : [];
}

function toast(msg) {
  const area = document.getElementById("toast-area") || (() => {
    let div = document.createElement("div");
    div.id = "toast-area";
    document.body.appendChild(div);
    return div;
  })();
  
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  area.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function profileCanUseRole(profile, role) {
  return !profile?.role || profile.role === role;
}

function addSystemMessage(c, text) {
  c.messages ??= [];
  const now = new Date();
  c.messages.unshift({
    id: uid(),
    author: "Sistema",
    authorId: "system",
    text,
    time: `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`
  });
  if (c.messages.length > 100) c.messages.pop();
}

function firebaseErrorMessage(err) {
  const code = String(err?.code || "").replace("firestore/", "");
  const rawMessage = String(err?.message || "").toLowerCase();
  if (rawMessage.includes("client is offline") || rawMessage.includes("failed to get document")) {
    return "Nao foi possivel conectar ao Firestore agora. Verifique a internet, bloqueadores/extensoes do navegador e tente novamente em alguns segundos.";
  }
  const messages = {
    "auth/email-already-in-use": "Este e-mail ja possui uma conta.",
    "auth/invalid-email": "E-mail invalido.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
    "auth/requires-recent-login": "Entre novamente antes de executar esta acao.",
    "campaign/player-not-ready": "O Mestre ainda nao preparou e vinculou um personagem para este e-mail.",
    "permission-denied": "Permissao negada no Firebase. Publique as regras atualizadas do Firestore e tente novamente.",
    "unavailable": "Nao foi possivel conectar ao Firestore. Verifique sua internet, bloqueadores do navegador e se o Firestore esta ativo no Firebase Console."
  };
  return messages[code] || err?.message || "Erro ao acessar o Firebase.";
}

function updateLocalPlayerPresence(online) {
  if (!session.campaign || !session.player) return;
  const player = session.campaign.players.find(p => p.id === session.player.id) || session.player;
  player.online = Boolean(online);
  player.lastSeen = new Date().toISOString();
  session.player = player;
}

async function publishPlayerPresence(online, context = presenceContext) {
  if (!context || !usingFirebase() || !window.CDIFirebase?.setPlayerPresence) return;
  if (session.player?.id === context.playerId) updateLocalPlayerPresence(online);
  try {
    await window.CDIFirebase.setPlayerPresence(context.campaignId, context.playerId, online);
  } catch (err) {
    console.warn("Nao foi possivel atualizar a presenca do jogador.", err);
  }
}

function startPlayerPresence() {
  clearInterval(presenceTimer);
  presenceTimer = null;
  if (!usingFirebase() || session.role !== "player" || !session.campaign?.id || !session.player?.id) return;
  presenceContext = { campaignId: session.campaign.id, playerId: session.player.id };
  publishPlayerPresence(true);
  presenceTimer = setInterval(() => publishPlayerPresence(true), 45000);
}

async function stopPlayerPresence(markOffline = false) {
  clearInterval(presenceTimer);
  presenceTimer = null;
  const context = presenceContext;
  presenceContext = null;
  if (markOffline && context) await publishPlayerPresence(false, context);
}

document.addEventListener("visibilitychange", () => {
  if (!presenceContext) return;
  publishPlayerPresence(document.visibilityState === "visible");
});

window.addEventListener("pagehide", () => {
  if (presenceContext) publishPlayerPresence(false, presenceContext);
});

setInterval(() => {
  if (session.role && session.view === "room") requestPassiveRender();
}, 30000);

function playerRegisterModal() {
  if (!usingFirebase()) return playerLogin();
  root.innerHTML = `
    <div class="modal home-screen auth-screen"><div class="modalbox auth-panel">
      <h2>Novo Jogador</h2>
      <label>Nome</label><input id="newPName" placeholder="Seu nome na mesa">
      <label>E-mail</label><input id="newPEmail" type="email" placeholder="jogador@email.com">
      <label>Senha</label><input id="newPPass" type="password" placeholder="Senha com pelo menos 6 caracteres">
      <br><br>
      <button onclick="createPlayerAccount()">Cadastrar</button>
      <button class="secondary" onclick="playerLogin()">Voltar</button>
    </div></div>`;
}

async function createPlayerAccount() {
  const name = document.getElementById("newPName").value.trim();
  const email = document.getElementById("newPEmail").value.trim();
  const password = document.getElementById("newPPass").value.trim();
  if (!name || !email || !password) return alert("Preencha todos os campos.");
  try {
    firebaseProfile = await window.CDIFirebase.signUp(email, password, name, "player");
    toast("Conta de jogador criada!");
    playerLogin();
  } catch (err) {
    alert(firebaseErrorMessage(err));
  }
}

function campaignViewerKey(campaign = session.campaign) {
  const viewerId = firebaseUser?.uid
    || (session.role === "master" ? session.currentMaster?.id : session.player?.authUid || session.player?.id)
    || "anonymous";
  return `${campaign?.id || "campaign"}:${session.role || "guest"}:${viewerId}`;
}

function traumaAlertMessage(event) {
  return `[${String(event?.origin || "Sem origem")}] - Adquiriu um trauma: [${String(event?.traumaTitle || "Trauma")}]`;
}

function readSeenTraumaEvents() {
  try {
    const stored = JSON.parse(localStorage.getItem(TRAUMA_SEEN_STORAGE_KEY) || "{}");
    return stored && typeof stored === "object" ? stored : {};
  } catch (_err) {
    return {};
  }
}

function shouldAnnounceTraumaEvent(event, campaign = session.campaign) {
  if (!event?.id || !campaign?.id) return false;
  const createdAt = Date.parse(event.createdAt);
  if (!Number.isFinite(createdAt)) return false;
  const age = Date.now() - createdAt;
  if (age > TRAUMA_EVENT_MAX_AGE_MS || age < -5 * 60 * 1000) return false;
  const stored = readSeenTraumaEvents()[campaignViewerKey(campaign)];
  const seenIds = Array.isArray(stored) ? stored.map(String) : (stored ? [String(stored)] : []);
  return !seenIds.includes(String(event.id));
}

function markTraumaEventSeen(event, campaign = session.campaign) {
  if (!event?.id || !campaign?.id) return;
  const seen = readSeenTraumaEvents();
  const key = campaignViewerKey(campaign);
  const stored = seen[key];
  const seenIds = Array.isArray(stored) ? stored.map(String) : (stored ? [String(stored)] : []);
  seen[key] = [String(event.id), ...seenIds.filter(id => id !== String(event.id))].slice(0, 20);
  localStorage.setItem(TRAUMA_SEEN_STORAGE_KEY, JSON.stringify(seen));
}

function ensureTraumaAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  try {
    traumaAudioContext ??= new AudioContextClass();
    return traumaAudioContext;
  } catch (_err) {
    return null;
  }
}

async function loadTraumaAlertAudio(audioContext = ensureTraumaAudioContext()) {
  if (!audioContext) return null;
  if (traumaAlertAudioBuffer) return traumaAlertAudioBuffer;
  if (traumaAlertAudioPromise) return traumaAlertAudioPromise;

  traumaAlertAudioPromise = fetch(TRAUMA_ALERT_SOUND_URL, { cache: "force-cache" })
    .then(response => {
      if (!response.ok) throw new Error(`Falha ao carregar som de trauma: ${response.status}`);
      return response.arrayBuffer();
    })
    .then(data => audioContext.decodeAudioData(data))
    .then(buffer => {
      traumaAlertAudioBuffer = buffer;
      return buffer;
    })
    .catch(err => {
      console.warn("O efeito sonoro de trauma nao pode ser carregado.", err);
      traumaAlertAudioPromise = null;
      return null;
    });

  return traumaAlertAudioPromise;
}

function unlockTraumaAudio() {
  const audioContext = ensureTraumaAudioContext();
  if (!audioContext) return;
  const ready = audioContext.state === "suspended"
    ? audioContext.resume()
    : Promise.resolve();
  ready.then(() => loadTraumaAlertAudio(audioContext)).catch(() => {});
}

function playTraumaAlertSound() {
  const audioContext = ensureTraumaAudioContext();
  if (!audioContext) return;

  const play = async () => {
    const buffer = await loadTraumaAlertAudio(audioContext);
    if (!buffer) return;

    try {
      activeTraumaAudioSource?.stop();
    } catch (_err) {
      // The previous source may already have ended.
    }

    const source = audioContext.createBufferSource();
    const volume = audioContext.createGain();
    source.buffer = buffer;
    volume.gain.setValueAtTime(0.78, audioContext.currentTime);
    source.connect(volume);
    volume.connect(audioContext.destination);
    source.onended = () => {
      if (activeTraumaAudioSource === source) activeTraumaAudioSource = null;
    };
    activeTraumaAudioSource = source;
    source.start();
  };

  if (audioContext.state === "suspended") {
    audioContext.resume().then(play).catch(() => {});
  } else {
    play().catch(() => {});
  }
}

function showTraumaAlert(event) {
  document.querySelector(".trauma-global-alert")?.remove();
  const alertElement = document.createElement("aside");
  alertElement.className = "trauma-global-alert";
  alertElement.setAttribute("role", "alert");
  alertElement.setAttribute("aria-live", "assertive");
  alertElement.innerHTML = `
    <div class="trauma-global-alert-mark" aria-hidden="true">&#9888;</div>
    <div>
      <span>Trauma adquirido</span>
      <p>${esc(traumaAlertMessage(event))}</p>
    </div>`;
  document.body.appendChild(alertElement);
  playTraumaAlertSound();
  setTimeout(() => alertElement.remove(), 5000);
}

function announceTraumaEvent(event, campaign = session.campaign) {
  if (!shouldAnnounceTraumaEvent(event, campaign)) return false;
  markTraumaEventSeen(event, campaign);
  showTraumaAlert(event);
  return true;
}

function diceRollAlertMessage(roll) {
  const origin = String(roll?.origin || "Sem origem");
  const total = Number.isFinite(Number(roll?.total)) ? Math.trunc(Number(roll.total)) : "?";
  return `[${origin}] : GIROU DADO E DEU [${total}!]`;
}

function readSeenDiceRolls() {
  try {
    const stored = JSON.parse(localStorage.getItem(DICE_ROLL_SEEN_STORAGE_KEY) || "{}");
    return stored && typeof stored === "object" ? stored : {};
  } catch (_err) {
    return {};
  }
}

function diceRollTimestamp(roll) {
  const timestamp = Date.parse(roll?.createdAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function diceLogsNewestFirst(logs = []) {
  return [...logs].sort((a, b) => diceRollTimestamp(b) - diceRollTimestamp(a));
}

function latestPlayerDiceRoll(campaign = session.campaign) {
  return diceLogsNewestFirst(campaign?.diceLogs || [])
    .find(roll => roll?.rollerRole === "player" && diceRollTimestamp(roll) > 0) || null;
}

function shouldAnnounceDiceRoll(roll, campaign = session.campaign) {
  if (!roll?.id || roll.rollerRole !== "player" || !campaign?.id) return false;
  const createdAt = diceRollTimestamp(roll);
  if (!createdAt) return false;
  const age = Date.now() - createdAt;
  if (age > DICE_ROLL_EVENT_MAX_AGE_MS || age < -5 * 60 * 1000) return false;
  const stored = readSeenDiceRolls()[campaignViewerKey(campaign)];
  const seenIds = Array.isArray(stored) ? stored.map(String) : (stored ? [String(stored)] : []);
  return !seenIds.includes(String(roll.id));
}

function markDiceRollSeen(roll, campaign = session.campaign) {
  if (!roll?.id || !campaign?.id) return;
  const seen = readSeenDiceRolls();
  const key = campaignViewerKey(campaign);
  const stored = seen[key];
  const seenIds = Array.isArray(stored) ? stored.map(String) : (stored ? [String(stored)] : []);
  seen[key] = [String(roll.id), ...seenIds.filter(id => id !== String(roll.id))].slice(0, 30);
  localStorage.setItem(DICE_ROLL_SEEN_STORAGE_KEY, JSON.stringify(seen));
}

function showDiceRollAlert(roll) {
  document.querySelector(".dice-roll-global-alert")?.remove();
  const alertElement = document.createElement("aside");
  alertElement.className = "dice-roll-global-alert";
  alertElement.setAttribute("role", "alert");
  alertElement.setAttribute("aria-live", "assertive");
  alertElement.innerHTML = `
    <div class="dice-roll-global-alert-mark" aria-hidden="true">&#9861;</div>
    <div>
      <span>Rolagem na mesa</span>
      <p>${esc(diceRollAlertMessage(roll))}</p>
    </div>`;
  (document.fullscreenElement || document.body).appendChild(alertElement);
  setTimeout(() => alertElement.remove(), 5000);
}

function announceDiceRoll(roll, campaign = session.campaign) {
  if (!shouldAnnounceDiceRoll(roll, campaign)) return false;
  markDiceRollSeen(roll, campaign);
  showDiceRollAlert(roll);
  return true;
}

window.addEventListener("pointerdown", unlockTraumaAudio, { passive: true });
window.addEventListener("keydown", unlockTraumaAudio);

function flushDeferredRenderAfterModalClose() {
  if (!renderDeferredByModal || document.querySelector(".modal")) return false;
  renderDeferredByModal = false;
  render();
  return true;
}

function requestPassiveRender() {
  if (session.role && document.querySelector(".modal")) {
    renderDeferredByModal = true;
    return false;
  }
  render();
  return true;
}

window.addEventListener("click", () => {
  if (renderDeferredByModal) setTimeout(flushDeferredRenderAfterModalClose, 0);
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const modals = document.querySelectorAll(".modal");
    if (modals.length > 0) {
      modals[modals.length - 1].remove();
      flushDeferredRenderAfterModalClose();
    }
  }

  const target = e.target;
  const isEditing = target?.matches?.("input, textarea, select, [contenteditable='true']");
  if (isEditing || document.querySelector(".modal") || session.role !== "master" || session.view !== "scenes") return;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    stepMasterScene(e.key === "ArrowLeft" ? -1 : 1);
  }
});

window.addEventListener("cdi-firebase-ready", initFirebaseBridge);
window.addEventListener("online", () => {
  campaignSaveStates.forEach((pending, campaignId) => {
    if (!pending.queued || pending.flushPromise || pending.atomicDepth) return;
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = null;
    flushCampaignSave(campaignId).catch(reportBackgroundSaveFailure);
  });
});

function applyRemoteCampaignSnapshot(campaigns, meta = {}, user = firebaseUser) {
  const syncText = meta.hasPendingWrites
    ? "Sincronizando..."
    : (meta.fromCache ? "Usando cache local" : "Online em tempo real");
  const remoteJson = JSON.stringify(campaigns);
  if (remoteJson === lastRemoteCampaignJson) {
    setSyncStatus(syncText);
    return false;
  }

  const activeCampaignId = session.campaign?.id ? String(session.campaign.id) : null;
  const activePlayerId = session.player?.id ? String(session.player.id) : null;
  let pendingTraumaEvent = null;
  let pendingDiceRoll = null;
  lastRemoteCampaignJson = remoteJson;
  isApplyingRemoteState = true;

  try {
    const localById = new Map(state.campaigns.map(campaign => [String(campaign.id), campaign]));
    const nextCampaigns = campaigns.map(remoteCampaign => {
      const normalizedId = String(remoteCampaign.id || "");
      if (!meta.hasPendingWrites) {
        campaignRemoteBaselines.set(normalizedId, cloneCampaignForSave(remoteCampaign));
      }
      const localCampaign = localById.get(normalizedId);
      if (localCampaign && campaignHasPendingSave(normalizedId)) {
        campaignSaveState(normalizedId).deferredRemote = { present: true, campaign: remoteCampaign };
        localById.delete(normalizedId);
        return localCampaign;
      }
      localById.delete(normalizedId);
      const pending = campaignSaveStates.get(normalizedId);
      if (pending) pending.deferredRemote = null;
      return normalizeCampaign(remoteCampaign);
    });
    localById.forEach((localCampaign, campaignId) => {
      if (campaignHasPendingSave(campaignId)) {
        campaignSaveState(campaignId).deferredRemote = { present: false, campaign: null };
        nextCampaigns.push(localCampaign);
      } else if (!meta.hasPendingWrites) {
        campaignRemoteBaselines.delete(String(campaignId));
      }
    });
    state.campaigns = nextCampaigns;
    persistLocal();

    if (!session.role) restoreFirebaseSession(user, firebaseProfile);
    sessionRestoreCompleted = true;

    if (session.campaign) {
      const targetCampaignId = activeCampaignId || String(session.campaign.id);
      const updated = findCampaign(targetCampaignId);
      if (updated) {
        session.campaign = updated;
        pendingTraumaEvent = updated.latestTraumaEvent || null;
        pendingDiceRoll = latestPlayerDiceRoll(updated);
        if (session.player) {
          session.player = updated.players.find(player => (
            String(player.id) === activePlayerId && player.authUid === user?.uid
          )) || updated.players.find(player => player.authUid === user?.uid) || session.player;
        }
      }
    }
  } finally {
    isApplyingRemoteState = false;
  }

  if (session.campaign) lastSavedCampaignJson = JSON.stringify(session.campaign);
  setSyncStatus(syncText);
  requestPassiveRender();
  if (pendingTraumaEvent) announceTraumaEvent(pendingTraumaEvent, session.campaign);
  if (pendingDiceRoll) announceDiceRoll(pendingDiceRoll, session.campaign);
  return true;
}

async function initFirebaseBridge() {
  if (firebaseReady || !window.CDIFirebase) return;
  firebaseReady = true;
  if (!usingFirebase()) {
    normalizeState();
    persistLocal();
    restoreLocalSession();
    sessionRestoreCompleted = true;
    return render();
  }

  window.CDIFirebase.onAuthChanged(async user => {
    firebaseUser = user;
    try {
      firebaseProfile = user ? await window.CDIFirebase.getUserProfile(user.uid) : null;
    } catch (err) {
      console.warn(err);
      firebaseProfile = user ? {
        id: user.uid,
        name: user.displayName || user.email,
        email: user.email,
        role: "",
        offlineProfile: true
      } : null;
    }
    if (unsubscribeCampaigns) unsubscribeCampaigns();
    unsubscribeCampaigns = null;

    if (!user) {
      await stopPlayerPresence(false);
      session = { role: null, campaign: null, player: null, currentMaster: null, view: "home" };
      state.campaigns = [];
      persistLocal();
      lastSavedCampaignJson = "";
      lastRemoteCampaignJson = "";
      sessionRestoreCompleted = true;
      return render();
    }

    try {
      const pendingCampaignIds = await hydrateCampaignSaveOutbox(user.uid);
      await Promise.all(pendingCampaignIds.map(campaignId => (
        flushCampaignSave(campaignId).catch(err => {
          reportBackgroundSaveFailure(err);
          return null;
        })
      )));
    } catch (err) {
      console.warn("Nao foi possivel restaurar integralmente a fila local de campanhas.", err);
    }

    unsubscribeCampaigns = window.CDIFirebase.watchCampaigns(user.uid, (campaigns, meta = {}) => {
      applyRemoteCampaignSnapshot(campaigns, meta, user);
    }, err => {
      console.error(err);
      setSyncStatus("Falha de conexao");
      toast("Falha ao acompanhar campanhas em tempo real.");
    });

    if (!session.role && sessionRestoreCompleted) render();
  });
}

function validateImageFile(file) {
  if (!file) return Promise.resolve(null);
  if (!String(file.type || "").startsWith("image/")) {
    return Promise.reject(new Error("O arquivo selecionado nao e uma imagem valida."));
  }
  if (Number(file.size || 0) > MAX_IMAGE_FILE_BYTES) {
    return Promise.reject(new Error("A imagem ultrapassa o limite de 25 MB por arquivo."));
  }
  if (Number(file.size || 0) <= 0) {
    return Promise.reject(new Error("A imagem selecionada esta vazia."));
  }
  return Promise.resolve(true);
}

async function uploadImageAsset(blob, options = {}) {
  if (!blob) return null;
  if (!window.CDIFirebase?.uploadImage) {
    throw new Error("O servico de imagens ainda nao esta pronto. Aguarde alguns segundos e tente novamente.");
  }
  if (window.CDIFirebase.mediaConfigured === false) {
    throw new Error("Cloudinary nao configurado. O arquivo nao foi salvo para evitar perda de dados.");
  }

  const campaignId = String(options.campaignId || session.campaign?.id || "shared");
  const kind = String(options.kind || "images").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
  const entityId = String(options.entityId || uid()).replace(/[^a-z0-9_-]/gi, "-");
  const path = `site-rpg/${campaignId}/${kind}/${entityId}`;
  const result = await window.CDIFirebase.uploadImage(path, blob, {
    folder: "",
    assetFolder: `site-rpg/${campaignId}/${kind}`,
    tags: ["site-rpg", kind],
    context: { campaignId, kind, entityId }
  });
  const asset = typeof result === "string" ? { secureUrl: result } : result;
  if (!asset?.secureUrl || !isCloudinaryImage(asset.secureUrl)) {
    throw new Error("O Cloudinary nao confirmou uma URL valida. Nenhuma alteracao foi salva.");
  }
  const metadata = {
    provider: "cloudinary",
    assetId: asset.assetId || null,
    publicId: asset.publicId || null,
    version: asset.version || null,
    versionId: asset.versionId || null,
    format: asset.format || null,
    width: Number(asset.width || options.width || 0) || null,
    height: Number(asset.height || options.height || 0) || null,
    bytes: Number(asset.bytes || blob.size || 0) || null,
    etag: asset.etag || null
  };
  uploadedImageMetadata.set(asset.secureUrl, metadata);
  return { ...asset, secureUrl: asset.secureUrl, metadata };
}

async function readImg(file, maxSize = 800, options = {}) {
  if (!file) return "";
  if (imageMigrationInProgress && options.kind !== "legacy-migration") {
    throw new Error("Aguarde a migracao de imagens terminar antes de iniciar outro envio.");
  }
  await validateImageFile(file);
  const asset = await uploadImageAsset(file, {
    ...options,
    displayMaxSize: maxSize
  });
  return asset.secureUrl;
}

function openImageModal(imgSrc, title = "Visualizar Imagem") {
  if (!imgSrc) return;
  root.insertAdjacentHTML("beforeend", `
    <div class="modal" onclick="this.remove()">
      <div class="modalbox" style="text-align:center; max-width:90vw;" onclick="event.stopPropagation()">
        <h3>${esc(title)}</h3>
        <img ${imageSourceAttrs(imgSrc, "full")} alt="${esc(title)}" style="max-width:100%; max-height:70vh; border-radius:8px; object-fit:contain; margin-top:10px; cursor:pointer;" onclick="this.closest('.modal').remove()">
        <br><br>
        <button class="secondary" onclick="this.closest('.modal').remove()">Fechar</button>
      </div>
    </div>`);
}

// --- TELAS DE AUTENTICAÇÃO E HOME ---
function home() {
  root.innerHTML = `
    <div class="modal home-screen"><main class="modalbox home-gateway">
      <header class="gateway-heading">
        <span class="gateway-sigil" aria-hidden="true">◉</span>
        <span class="gateway-eyebrow">Arquivos do desconhecido</span>
        <h1>Crônicas do Infinito</h1>
        <p>Gerenciador de RPG de Mesa Online</p>
      </header>
      <div class="home-access-grid">
        <article class="card access-card">
          <span class="access-card-icon" aria-hidden="true">♛</span>
          <div><span class="access-card-eyebrow">Conduzir a investigação</span><h2>Painel do Mestre</h2><p>Controle campanhas, fichas, criaturas e mistérios.</p></div>
          <button onclick="masterLoginModal()">Entrar como Mestre</button>
        </article>
        <article class="card access-card">
          <span class="access-card-icon" aria-hidden="true">◈</span>
          <div><span class="access-card-eyebrow">Abrir o seu dossiê</span><h2>Painel do Jogador</h2><p>Acesse seu personagem, inventário e atributos.</p></div>
          <button onclick="playerLogin()">Entrar como Jogador</button>
        </article>
      </div>
    </main></div>`;
}

function masterLoginModal() {
  if (usingFirebase()) {
    root.innerHTML = `
      <div class="modal home-screen auth-screen"><div class="modalbox auth-panel">
        <h2>Acesso do Mestre</h2>
        <label>E-mail</label><input id="memail" type="email" placeholder="mestre@email.com">
        <label>Senha</label><input id="mpass" type="password" placeholder="Sua senha">
        <br><br>
        <button onclick="doMasterLogin()">Entrar</button>
        <button class="secondary" onclick="newMasterModal()">Criar conta</button>
        <button class="secondary" onclick="home()">Voltar</button>
      </div></div>`;
    return;
  }
  if (state.masters.length === 0) return newMasterModal();
  root.innerHTML = `
    <div class="modal home-screen auth-screen"><div class="modalbox auth-panel">
      <h2>Acesso do Mestre</h2>
      <label>Selecione o Mestre</label>
      <select id="msel">${state.masters.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join("")}</select>
      <label>Senha do Mestre</label>
      <input id="mpass" type="password" placeholder="Sua senha">
      <br><br>
      <button onclick="doMasterLogin()">Entrar</button>
      <button class="secondary" onclick="newMasterModal()">➕ Novo Mestre</button>
      <button class="secondary" onclick="home()">Voltar</button>
    </div></div>`;
}

function newMasterModal() {
  if (usingFirebase()) {
    root.innerHTML = `
      <div class="modal home-screen auth-screen"><div class="modalbox auth-panel">
        <h2>Novo Mestre</h2>
        <label>Nome do Mestre</label><input id="newMName" placeholder="Ex: Mestre Gabriel">
        <label>E-mail</label><input id="newMEmail" type="email" placeholder="mestre@email.com">
        <label>Senha de Acesso</label><input id="newMPass" type="password" placeholder="Senha com pelo menos 6 caracteres">
        <br><br>
        <button onclick="createMaster()">Cadastrar</button>
        <button class="secondary" onclick="masterLoginModal()">Voltar</button>
      </div></div>`;
    return;
  }
  root.innerHTML = `
    <div class="modal home-screen auth-screen"><div class="modalbox auth-panel">
      <h2>Novo Mestre</h2>
      <label>Nome do Mestre</label><input id="newMName" placeholder="Ex: Mestre Gabriel">
      <label>Senha de Acesso</label><input id="newMPass" type="password" placeholder="Senha">
      <br><br>
      <button onclick="createMaster()">Cadastrar</button>
      <button class="secondary" onclick="${state.masters.length > 0 ? 'masterLoginModal()' : 'home()'}">Voltar</button>
    </div></div>`;
}

async function createMaster() {
  if (usingFirebase()) {
    const name = document.getElementById("newMName").value.trim();
    const email = document.getElementById("newMEmail").value.trim();
    const password = document.getElementById("newMPass").value.trim();
    if (!name || !email || !password) return alert("Preencha todos os campos.");
    try {
      const profile = await window.CDIFirebase.signUp(email, password, name, "master");
      firebaseProfile = profile;
      session = { role: "master", currentMaster: profile, campaign: null, player: null, view: "home" };
      toast("Mestre cadastrado no Firebase!");
      masterMenu();
    } catch (err) {
      alert(firebaseErrorMessage(err));
    }
    return;
  }
  const name = document.getElementById("newMName").value.trim();
  const password = document.getElementById("newMPass").value.trim();
  if (!name || !password) return alert("Preencha todos os campos.");

  state.masters.push({ id: uid(), name, password });
  save();
  toast("Mestre cadastrado!");
  masterLoginModal();
}

async function doMasterLogin() {
  if (usingFirebase()) {
    const email = document.getElementById("memail").value.trim();
    const pass = document.getElementById("mpass").value;
    if (!email || !pass) return alert("Informe e-mail e senha.");
    try {
      let profile = await window.CDIFirebase.signIn(email, pass, "master");
      if (!profile) profile = await window.CDIFirebase.saveUserProfile(window.CDIFirebase.currentUser, "master", email);
      if (!profileCanUseRole(profile, "master")) return alert("Esta conta foi cadastrada como Jogador. Use uma conta de Mestre para acessar este painel.");
      firebaseProfile = profile;
      session = { role: "master", currentMaster: profile, campaign: null, player: null, view: "home" };
      masterMenu();
    } catch (err) {
      alert(firebaseErrorMessage(err));
    }
    return;
  }
  const mid = document.getElementById("msel").value;
  const pass = document.getElementById("mpass").value;
  const target = state.masters.find(m => m.id === mid);

  if (!target || target.password !== pass) return alert("Senha incorreta!");

  session = { role: "master", currentMaster: target, campaign: null, player: null, view: "home" };
  masterMenu();
}

function playerLogin() {
  if (usingFirebase()) {
    root.innerHTML = `
      <div class="modal home-screen auth-screen"><div class="modalbox auth-panel">
        <h2>Acesso do Jogador</h2>
        <label>E-mail</label><input id="pemail" type="email" placeholder="jogador@email.com">
        <label>Senha</label><input id="ppass" type="password" placeholder="Sua senha">
        <label>ID da Campanha</label><input id="pcid" placeholder="Cole o ID informado pelo Mestre">
        <label>Senha da Campanha</label><input id="pw" type="password">
        <label>Nome na mesa</label><input id="pname" placeholder="Ex: Ana">
        <br><br>
        <button onclick="doPlayerLogin()">Entrar</button>
        <button class="secondary" onclick="playerRegisterModal()">Criar conta de jogador</button>
        <button class="secondary" onclick="home()">Voltar</button>
      </div></div>`;
    return;
  }
  if (!state.campaigns.length) return alert("Nenhuma campanha criada.");
  root.innerHTML = `
    <div class="modal home-screen auth-screen"><div class="modalbox auth-panel">
      <h2>Acesso do Jogador</h2>
      <label>Campanha</label><select id="pc">${state.campaigns.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
      <label>Senha da Campanha</label><input id="pw" type="password">
      <label>Senha do Jogador</label><input id="pp" type="password">
      <br><br>
      <button onclick="doPlayerLogin()">Entrar</button>
      <button class="secondary" onclick="home()">Voltar</button>
    </div></div>`;
}

async function doPlayerLogin() {
  if (usingFirebase()) {
    const email = document.getElementById("pemail").value.trim();
    const pass = document.getElementById("ppass").value;
    const campaignId = document.getElementById("pcid").value.trim();
    const campaignPass = document.getElementById("pw").value;
    const name = document.getElementById("pname").value.trim();
    if (!email || !pass || !campaignId || !campaignPass) return alert("Preencha e-mail, senha e dados da campanha.");
    const loginBtn = document.querySelector('button[onclick="doPlayerLogin()"]');
    if (loginBtn) {
      loginBtn.disabled = true;
      loginBtn.textContent = "Entrando...";
    }
    const resetPlayerLoginButton = () => {
      if (!loginBtn) return;
      loginBtn.disabled = false;
      loginBtn.textContent = "Entrar";
    };

    try {
      let profile = await window.CDIFirebase.signIn(email, pass, "player");
      if (!profile) profile = await window.CDIFirebase.saveUserProfile(window.CDIFirebase.currentUser, "player", name || email);
      if (!profileCanUseRole(profile, "player")) {
        resetPlayerLoginButton();
        return alert("Esta conta foi cadastrada como Mestre. Use uma conta de Jogador para entrar na campanha.");
      }
      firebaseProfile = profile;

      const joined = await window.CDIFirebase.joinCampaign(campaignId, campaignPass, profile, name);
      if (!joined?.campaign || !joined?.player) {
        resetPlayerLoginButton();
        return alert("Campanha ou senha inválida.");
      }
      const c = normalizeCampaign(joined.campaign);
      const p = joined.player;

      state.campaigns = [c, ...state.campaigns.filter(x => x.id !== c.id)];
      session = { role: "player", campaign: c, player: p, currentMaster: null, view: "sheet" };
      lastSavedCampaignJson = JSON.stringify(c);
      persistSessionContext();
      startPlayerPresence();
      toast(`Voce entrou na campanha ${c.name}.`);
      render();
    } catch (err) {
      resetPlayerLoginButton();
      alert(firebaseErrorMessage(err));
    }
    return;
  }
  const pc = document.getElementById("pc").value;
  const pw = document.getElementById("pw").value;
  const pp = document.getElementById("pp").value;
  const c = state.campaigns.find(x => x.id === pc);
  const p = c?.players.find(x => x.password === pp);

  if (!c || c.password !== pw || !p) return alert("Acesso inválido.");
  p.authUid ??= `local-${p.id}`;
  p.status = "claimed";
  p.online = true;
  p.lastSeen = new Date().toISOString();
  session = { role: "player", campaign: c, player: p, currentMaster: null, view: "sheet" };
  save();
  render();
}

function masterMenu() {
  const myCampaigns = getMasterCampaigns();
  if (usingFirebase() && !myCampaigns.length) {
    session.campaign = null;
    session.view = "home";
    return render();
  }
  if (!myCampaigns.length) return newCampaign(true);
  session.campaign = myCampaigns[0];
  session.view = "home";
  render();
}

// --- NAVEGAÇÃO E LAYOUT ---
function nav() {
  const m = session.role === "master";
  const items = m ? [
    ["messages","✉ Mensagens"],
    ["room","◉ Game"],
    ["scenes","▣ Cenas"],
    ["home","⌂ Visão Geral"], ["campaigns","▤ Campanhas"], ["characters","♙ Personagens"],
    ["skills","✦ Habilidades"], ["diceLogs","◷ Histórico"], ["cases","▱ Casos"],
    ["creatures","☠ Criaturas"], ["items","▦ Itens"], ["evidence","⌕ Evidências"],
    ["marks","◇ Marcas"], ["transfers", "⇄ Permissões / Trocas"], ["players","♟ Jogadores"], ["settings","⚙ Configurações"]
  ] : [
    ["messages","✉ Mensagens"],
    ["room","◉ Game"],
    ["scenes","▣ Cenas"],
    ["sheet","♙ Meu Personagem"], ["inventory","▦ Inventário"], ["evidencePlayer","⌕ Evidências"], ["transferPlayer","⇄ Dar Item/Evidência"]
  ];

  const traumaPosition = items.findIndex(([view]) => view === (m ? "skills" : "inventory"));
  items.splice(traumaPosition < 0 ? items.length : traumaPosition, 0, ["traumas", "⚠ Traumas"]);
  if (m) {
    const expressionsPosition = items.findIndex(([view]) => view === "traumas");
    items.splice(expressionsPosition < 0 ? items.length : expressionsPosition, 0, ["expressions", "◒ Expressões"]);
  }

  return `
    <div class="side">
      <div class="brand"><span class="brand-sigil" aria-hidden="true">◉</span><span class="brand-copy"><b>Crônicas</b><small>do Infinito</small></span></div>
      <div class="role">${m ? `Mestre: ${esc(session.currentMaster?.name)}` : "Jogador"}</div>
      <div class="nav">${items.map(([v, t]) => `<button class="${session.view === v ? "active" : ""}" onclick="session.view='${v}';render()">${t}</button>`).join("")}</div>
      <div class="side-footer">
        <button class="dice-btn" onclick="openDiceRoller()">✦ Rolador</button>
        <button class="secondary" onclick="logout()">Sair</button>
      </div>
    </div>`;
}

async function logout() {
  if (!usingFirebase() && session.role === "player" && session.player) {
    updateLocalPlayerPresence(false);
    save();
  }
  if (usingFirebase()) {
    try {
      await ensurePendingCampaignSavesAreDurable();
    } catch (err) {
      console.error("Nao foi possivel preservar as alteracoes pendentes antes de sair.", err);
      alert("Nao foi possivel preservar as alteracoes pendentes neste navegador. A sessao continuara aberta para evitar perda de progresso.");
      return;
    }
  }
  await stopPlayerPresence(true);
  stopPrivateMessageSubscription();
  if (unsubscribeCampaigns) unsubscribeCampaigns();
  unsubscribeCampaigns = null;
  lastSavedCampaignJson = "";
  lastRemoteCampaignJson = "";
  clearCampaignSaveStates();
  clearSessionContext();
  if (usingFirebase()) {
    await window.CDIFirebase.signOut();
  }
  session = { role: null, campaign: null, player: null, currentMaster: null, view: "home" };
  home();
}

function render() {
  captureChatViewState();
  renderDeferredByModal = false;
  if (!session.role) {
    stopPrivateMessageSubscription();
    return home();
  }
  persistSessionContext();
  const c = session.campaign;
  if (c) {
    c.scenes ??= [];
    c.diceLogs ??= [];
    c.customSkills ??= [...OFFICIAL_SKILLS];
    c.items ??= [];
    c.evidence ??= [];
    c.itemTransfers ??= [];
    c.gameBoard ??= { image: "", updatedAt: null };
    c.previousGameBoard ??= { image: "", updatedAt: null };
    c.chatSettings = tabletop?.normalizeChatSettings
      ? tabletop.normalizeChatSettings(c.chatSettings)
      : {
        publicEnabled: c.chatSettings?.publicEnabled !== false,
        privateEnabled: c.chatSettings?.privateEnabled !== false,
        privateThreads: c.chatSettings?.privateThreads && typeof c.chatSettings.privateThreads === "object"
          ? { ...c.chatSettings.privateThreads }
          : {},
        updatedAt: c.chatSettings?.updatedAt || null
      };
  }
  syncPrivateMessageSubscription();
  root.innerHTML = `
    <div class="app">
      ${nav()}
      <section class="content">
        <div class="top">
          <div class="campaign-heading"><span class="campaign-kicker">${session.role === "master" ? "Mestre" : "Jogador"}</span><h1>${esc(c ? c.name : "Configurações")}</h1></div>
          <button class="secondary" onclick="logout()">Trocar Acesso</button>
        </div>
        ${session.role === "master" ? masterBody() : playerBody()}
      </section>
    </div>`;
  if (session.view === "messages") restoreChatViewState();
  if (session.view === "scenes" && session.role === "master") setTimeout(() => preloadAdjacentSceneImages(c), 0);
}

// --- PAINEL DO MESTRE ---
function masterBody() {
  const v = session.view, c = session.campaign, myCampaigns = getMasterCampaigns();
  if (v === "settings") return masterSettingsPage();
  if (v === "campaigns") return campaignsPage();
  if (v === "campaign") return campaignPage();
  if (v === "transfers") return masterTransfersPage();
  if (!c) return `<h2>Visão Geral</h2><p class="muted">Nenhuma campanha criada.</p><button onclick="newCampaign()">➕ Criar Campanha</button>`;

  const views = {
    messages: messagesPage, room: roomPage, scenes: masterScenesPage, characters: charactersPage, expressions: masterExpressionsPage, traumas: masterTraumasPage, skills: masterSkillsManagerPage, diceLogs: masterDiceLogsPage,
    cases: () => recordsPage("cases", "📁 Casos"), creatures: creaturesPage,
    items: itemsMasterPage, evidence: evidencePage, marks: marksPage, players: playersPage
  };

  if (views[v]) return views[v]();

  return `
    <h2>Visão Geral</h2>
    <div class="grid" style="margin-top:15px;">
      <div class="card"><h3>📚 Campanhas</h3><h2>${myCampaigns.length}</h2></div>
      <div class="card"><h3>👤 Personagens</h3><h2>${c.characters.length}</h2></div>
      <div class="card"><h3>👹 Criaturas</h3><h2>${c.creatures.length}</h2></div>
      <div class="card"><h3>🔎 Evidências</h3><h2>${c.evidence.length}</h2></div>
    </div>`;
}

function masterTransfersPage() {
  const c = session.campaign;
  c.itemTransfers ??= [];
  const pending = c.itemTransfers.filter(t => t.status === "pending");
  const history = c.itemTransfers.filter(t => t.status !== "pending");

  return `
    <h2>🤝 Gerenciamento de Permissões e Trocas</h2>
    <p class="muted">Aprove ou rejeite solicitações de jogadores que desejam entregar itens ou evidências entre si ou para o grupo.</p>
    
    <h3>⏳ Solicitações Pendentes</h3>
    <div class="grid" style="margin-top:15px;">
      ${pending.length === 0 ? '<p class="muted">Nenhuma solicitação pendente no momento.</p>' : ''}
      ${pending.map(t => {
        const resolving = resolvingTransfers.has(String(t.id));
        return `
          <div class="card" style="border-left: 4px solid var(--accent);">
            ${entityVisual(t.image, t.itemName)}
            <h3>${esc(t.itemName)}</h3>
            <p class="muted">Tipo: <b>${t.type === 'item' ? 'Item' : 'Evidência'}</b>${t.type === "item" ? ` · Quantidade: <b>${Math.max(1, Number(t.quantity) || 1)}</b>` : ""}</p>
            <p>De: <b>${esc(t.fromName)}</b> ➡️ Para: <b>${esc(t.toName)}</b></p>
            <p style="font-size:13px; margin: 8px 0;"><i>"${esc(t.message || 'Sem observações')}"</i></p>
            <div style="display:flex; gap:8px; margin-top:10px;">
              <button ${resolving ? "disabled" : ""} onclick="resolveTransfer('${t.id}', 'approved')">${resolving ? "Processando..." : "✅ Aprovar"}</button>
              <button class="danger" ${resolving ? "disabled" : ""} onclick="resolveTransfer('${t.id}', 'rejected')">❌ Rejeitar</button>
            </div>
          </div>`;
      }).join("")}
    </div>

    <h3 style="margin-top:30px;">📜 Histórico de Transferências</h3>
    <div class="grid" style="margin-top:15px;">
      ${history.length === 0 ? '<p class="muted">Nenhum histórico registrado.</p>' : ''}
      ${history.map(t => `
        <div class="card" style="opacity: 0.8;">
          ${entityVisual(t.image, t.itemName)}
          <h3>${esc(t.itemName)} (${t.status === 'approved' ? '✅ Aprovado' : '❌ Rejeitado'})</h3>
          <p>De: <b>${esc(t.fromName)}</b> ➡️ Para: <b>${esc(t.toName)}</b></p>
          <span class="muted" style="font-size:11px;">${t.time}</span>
        </div>`).join("")}
    </div>`;
}

async function resolveTransfer(transferId, status) {
  const c = session.campaign;
  const t = c.itemTransfers.find(x => String(x.id) === String(transferId));
  if (!t || t.status !== "pending" || resolvingTransfers.has(String(transferId))) return;
  if (!['approved', 'rejected'].includes(status)) return;

  resolvingTransfers.add(String(transferId));
  render();
  let resolvedStatus = status;
  let wasAlreadyResolved = false;
  try {
    if (usingFirebase() && window.CDIFirebase?.resolveItemTransfer) {
      const result = await window.CDIFirebase.resolveItemTransfer(c.id, transferId, status);
      if (result?.transfer) Object.assign(t, result.transfer);
      resolvedStatus = result?.transfer?.status || status;
      wasAlreadyResolved = Boolean(result?.alreadyResolved);
      if (result?.sourceCharacter) {
        const sourceCharacter = c.characters.find(entry => entry.id === result.sourceCharacter.id);
        if (sourceCharacter && result.sourceCharacter.inventory) sourceCharacter.inventory = result.sourceCharacter.inventory;
        if (sourceCharacter && result.sourceCharacter.evidence) sourceCharacter.evidence = result.sourceCharacter.evidence;
      }
      if (result?.targetCharacter) {
        const targetCharacter = c.characters.find(entry => entry.id === result.targetCharacter.id);
        if (targetCharacter && result.targetCharacter.inventory) targetCharacter.inventory = result.targetCharacter.inventory;
        if (targetCharacter && result.targetCharacter.evidence) targetCharacter.evidence = result.targetCharacter.evidence;
      }
      persistLocal();
    } else {
      if (status === 'approved' && t.type === 'item' && t.fromCharacterId && t.toCharacterId && t.inventoryId) {
        tabletop.transferInventoryItem(
          c,
          t.fromCharacterId,
          t.toCharacterId,
          t.inventoryId,
          t.quantity || 1,
          uid
        );
      } else if (status === 'approved' && t.type === 'item') {
        let targetItem = c.items.find(i => i.name.toLowerCase() === t.itemName.toLowerCase());
        if (!targetItem) {
          c.items.push({ id: uid(), name: t.itemName, description: t.description || "Item transferido.", revealed: true, image: t.image || "" });
        } else {
          targetItem.revealed = true;
        }
      } else if (status === 'approved' && t.type === 'evidence') {
        tabletop.transferCharacterEvidence(
          c,
          t.fromCharacterId,
          t.toCharacterId,
          t.evidenceEntryId,
          uid
        );
      }

      t.status = status;
      t.resolvedAt = new Date().toISOString();
      t.resolvedBy = session.currentMaster?.id || "local-master";
      t.time = new Date().toLocaleString("pt-BR");
      save();
    }
    toast(wasAlreadyResolved
      ? `A solicitacao ja estava ${resolvedStatus === "approved" ? "aprovada" : "rejeitada"}.`
      : (resolvedStatus === "approved" ? "Transferencia aprovada e aplicada!" : "Transferencia rejeitada."));
  } catch (err) {
    console.error(err);
    alert(`Nao foi possivel concluir a transferencia: ${err.message}`);
  } finally {
    resolvingTransfers.delete(String(transferId));
    render();
  }
}

function masterSkillsManagerPage() {
  const c = session.campaign;
  return `
    <h2>🎯 Gerenciamento de Habilidades</h2>
    <button onclick="openCreateSkillModal()">➕ Adicionar Habilidade</button>
    <div class="grid" style="margin-top:15px;">
      ${c.customSkills.map((sk, i) => `
        <div class="card" style="display:flex; justify-content:space-between; align-items:center; padding:15px; margin:0;">
          <span><b>${esc(sk)}</b></span>
          <button class="danger" style="padding:4px 8px; font-size:11px;" onclick="deleteCampaignSkill(${i})">Excluir</button>
        </div>`).join("")}
    </div>`;
}

function openCreateSkillModal() {
  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2>➕ Nova Habilidade</h2>
      <label>Ícone</label><select id="newSkIcon">${ICONS_LIST.map(ic => `<option value="${ic}">${ic}</option>`).join("")}</select>
      <label>Nome</label><input id="newSkName">
      <br><br>
      <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
      <button onclick="saveNewCampaignSkill()">Salvar</button>
    </div></div>`);
}

function saveNewCampaignSkill() {
  const icon = document.getElementById("newSkIcon").value;
  const name = document.getElementById("newSkName").value.trim();
  if (!name) return alert("Digite o nome.");
  
  const c = session.campaign;
  const fullName = `${icon} ${name}`;
  if (c.customSkills.includes(fullName)) return alert("Já existe.");

  c.customSkills.push(fullName);
  save(); document.querySelector(".modal").remove(); render(); toast("Habilidade adicionada!");
}

function deleteCampaignSkill(i) {
  if (confirm("Excluir habilidade?")) {
    session.campaign.customSkills.splice(i, 1);
    save(); render(); toast("Removida!");
  }
}

function masterDiceLogsPage() {
  const logs = diceLogsNewestFirst(session.campaign.diceLogs || []);
  return `
    <h2>🎲 Histórico de Rolagens</h2>
    <div style="display:flex; gap:10px; margin-bottom:15px;">
      <button class="danger" onclick="clearCampaignDiceLogs()">🧹 Limpar Histórico desta Campanha</button>
      <button class="danger" onclick="clearAllMastersDiceLogs()">🔥 Limpar Histórico Global (Todas as Campanhas)</button>
    </div>
    <div class="card">
      ${logs.length === 0 ? '<p class="muted">Nenhuma rolagem registrada.</p>' : ''}
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${logs.map(l => `
          <div style="padding:10px; border-bottom:1px solid var(--card-border); display:flex; justify-content:space-between;">
            <div><b>${esc(l.author)}</b> rolou <i>${esc(l.label || 'dado')}</i>: <span style="color:var(--accent); font-weight:bold;">${l.total}</span> <span class="muted" style="font-size:12px;">(d${l.sides}${l.bonusText})</span></div>
            <span class="muted" style="font-size:11px;">${l.time}</span>
          </div>`).join("")}
      </div>
    </div>`;
}

function clearCampaignDiceLogs() {
  if (confirm("Apagar histórico desta campanha?")) { 
    session.campaign.diceLogs = []; 
    save(); 
    render(); 
    toast("Histórico da campanha limpo!"); 
  }
}

function clearAllMastersDiceLogs() {
  if (confirm("ATENÇÃO: Deseja apagar o histórico de rolagens de TODAS as campanhas deste Mestre?")) {
    state.campaigns.forEach(c => {
      if (c.masterId === session.currentMaster.id) {
        c.diceLogs = [];
      }
    });
    save();
    render();
    toast("Todo o histórico de dados foi limpo!");
  }
}

function collectLegacyImageReferences(value, path = [], output = [], seen = new WeakSet()) {
  if (!value || typeof value !== "object") return output;
  if (seen.has(value)) return output;
  seen.add(value);
  Object.entries(value).forEach(([key, child]) => {
    const nextPath = [...path, key];
    if (key === "image" && isUnmanagedImage(child)) {
      output.push({ parent: value, key, source: child, path: nextPath.join(".") });
      return;
    }
    if (child && typeof child === "object") collectLegacyImageReferences(child, nextPath, output, seen);
  });
  return output;
}

function legacyImageSummary(campaigns = getMasterCampaigns()) {
  const references = campaigns.flatMap(campaign => collectLegacyImageReferences(campaign, [`campaigns.${campaign.id}`]));
  return {
    references: references.length,
    unique: new Set(references.map(reference => reference.source)).size,
    campaigns: new Set(references.map(reference => reference.path.split(".")[1])).size
  };
}

function dataUriToBlob(dataUri) {
  const match = String(dataUri || "").match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match || !match[1].startsWith("image/")) throw new Error("Imagem Base64 invalida encontrada na campanha.");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1] });
}

async function mediaFingerprint(blob) {
  const payload = typeof blob === "string"
    ? new TextEncoder().encode(blob).buffer
    : await blob.arrayBuffer();
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", payload);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
  }
  return uid();
}

async function imageMigrationUploadSource(source) {
  const value = String(source || "").trim();
  if (isBase64Image(value)) return dataUriToBlob(value);

  let url;
  try {
    url = new URL(value, window.location?.href || document.baseURI);
  } catch {
    throw new Error(`Referencia de imagem invalida: ${value.slice(0, 120)}`);
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error(`A imagem ${value.slice(0, 120)} nao usa um endereco HTTP valido.`);
  }

  const currentOrigin = window.location?.origin || "";
  if (currentOrigin && url.origin !== currentOrigin) return url.href;
  const response = await fetch(url.href, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`Nao foi possivel abrir a imagem antiga (${response.status}).`);
  const blob = await response.blob();
  if (!String(blob.type || "").startsWith("image/")) throw new Error("Uma referencia antiga nao devolveu um arquivo de imagem.");
  if (Number(blob.size || 0) > MAX_IMAGE_FILE_BYTES) throw new Error("Uma imagem antiga ultrapassa o limite de 25 MB.");
  return blob;
}

async function backupSha256(value) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Este navegador nao oferece verificacao SHA-256 para confirmar o backup.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function campaignProgressManifest(campaign) {
  const characters = campaign.characters || [];
  return {
    id: String(campaign.id || ""),
    name: String(campaign.name || ""),
    players: (campaign.players || []).length,
    characters: characters.length,
    scenes: (campaign.scenes || []).length,
    sceneTrash: (campaign.sceneTrash || []).length,
    items: (campaign.items || []).length,
    evidence: (campaign.evidence || []).length,
    traumaCatalog: (campaign.traumaCatalog || []).length,
    inventoryEntries: characters.reduce((total, character) => total + (character.inventory || []).length, 0),
    assignedEvidence: characters.reduce((total, character) => total + (character.evidence || []).length, 0),
    assignedTraumas: characters.reduce((total, character) => total + (character.traumas || []).length, 0),
    legacyImageReferences: collectLegacyImageReferences(campaign).length
  };
}

async function buildMasterImageBackup(campaigns = getMasterCampaigns()) {
  const snapshot = JSON.parse(JSON.stringify(campaigns || []));
  const snapshotJson = JSON.stringify(snapshot);
  return {
    format: "site-rpg-cloudinary-migration-backup",
    version: 2,
    exportedAt: new Date().toISOString(),
    reason: "backup-before-cloudinary-migration",
    masterId: session.currentMaster?.id || null,
    integrity: {
      algorithm: "SHA-256",
      campaignsDigest: await backupSha256(snapshotJson)
    },
    manifest: snapshot.map(campaignProgressManifest),
    campaigns: snapshot
  };
}

async function verifyMasterImageBackupPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || payload.format !== "site-rpg-cloudinary-migration-backup"
    || Number(payload.version) !== 2
    || !Array.isArray(payload.campaigns)
    || !Array.isArray(payload.manifest)) {
    throw new Error("Este arquivo nao e um backup de migracao compativel com o site.");
  }
  if (payload.integrity?.algorithm !== "SHA-256" || !/^[a-f0-9]{64}$/i.test(String(payload.integrity?.campaignsDigest || ""))) {
    throw new Error("O backup nao possui uma assinatura SHA-256 valida.");
  }
  const actualDigest = await backupSha256(JSON.stringify(payload.campaigns));
  if (actualDigest !== String(payload.integrity.campaignsDigest).toLowerCase()) {
    throw new Error("A integridade do backup falhou: o conteudo foi alterado ou esta incompleto.");
  }
  const expectedManifest = payload.campaigns.map(campaignProgressManifest);
  if (!sameJsonValue(expectedManifest, payload.manifest)) {
    throw new Error("O manifesto do backup nao corresponde ao progresso armazenado.");
  }
  return {
    verified: true,
    campaigns: payload.campaigns.length,
    references: expectedManifest.reduce((total, campaign) => total + campaign.legacyImageReferences, 0),
    digest: actualDigest
  };
}

async function verifyMasterImageBackupFile(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const result = await verifyMasterImageBackupPayload(payload);
    toast(`Backup verificado: ${result.campaigns} campanha(s), assinatura SHA-256 valida.`);
  } catch (err) {
    console.error(err);
    alert(`O backup nao passou na verificacao.\n\n${firebaseErrorMessage(err)}`);
  } finally {
    const input = document.getElementById("imageMigrationBackupFile");
    if (input) input.value = "";
  }
}

async function saveMasterImageBackup(campaigns = getMasterCampaigns(), { requireConfirmation = false } = {}) {
  const payload = await buildMasterImageBackup(campaigns);
  const fileName = `site-rpg-backup-imagens-${payload.exportedAt.replace(/[:.]/g, "-")}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });

  if (typeof window.showSaveFilePicker === "function") {
    const handle = await window.showSaveFilePicker({
      suggestedName: fileName,
      types: [{ description: "Backup JSON da campanha", accept: { "application/json": [".json"] } }]
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  } else {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (requireConfirmation && !confirm(`Confirme que o arquivo ${fileName} apareceu na pasta Downloads. Sem essa confirmacao a migracao nao continuara.`)) {
      throw new Error("A migracao foi cancelada porque o backup nao foi confirmado.");
    }
  }
  toast("Backup JSON salvo e identificado por SHA-256.");
  return payload;
}

async function downloadMasterImageBackup() {
  try {
    await saveMasterImageBackup(getMasterCampaigns());
  } catch (err) {
    if (err?.name === "AbortError") return toast("O backup foi cancelado.");
    console.error(err);
    alert(firebaseErrorMessage(err));
  }
}

function replaceLegacyImagesLocally(target, replacementBySource) {
  const references = collectLegacyImageReferences(target);
  let replaced = 0;
  references.forEach(reference => {
    const replacement = replacementBySource.get(reference.source);
    if (!replacement) return;
    reference.parent[reference.key] = replacement.url;
    if (reference.path === "liveScene.image") delete reference.parent.imageMeta;
    else reference.parent.imageMeta = { ...replacement.metadata };
    replaced += 1;
  });
  return replaced;
}

function updateImageMigrationProgress() {
  const text = document.getElementById("imageMigrationProgressText");
  const bar = document.getElementById("imageMigrationProgressBar");
  const lockText = document.getElementById("imageMigrationLockText");
  const lockBar = document.getElementById("imageMigrationLockBar");
  const phase = imageMigrationProgress.phase || `Migrando ${imageMigrationProgress.completed} de ${imageMigrationProgress.total}`;
  const percentage = imageMigrationProgress.total ? Math.round((imageMigrationProgress.completed / imageMigrationProgress.total) * 100) : 0;
  if (text) text.textContent = phase;
  if (lockText) lockText.textContent = phase;
  if (bar) bar.style.width = `${percentage}%`;
  if (lockBar) lockBar.style.width = `${percentage}%`;
}

async function migrateLegacyImages() {
  if (imageMigrationInProgress) return;
  const campaigns = getMasterCampaigns();
  const summary = legacyImageSummary(campaigns);
  if (!summary.references) return toast("Todas as imagens ja estao vinculadas ao Cloudinary.");
  if (!window.CDIFirebase?.uploadImage || window.CDIFirebase.mediaConfigured === false) {
    return alert("Cloudinary nao configurado. A migracao nao foi iniciada.");
  }
  if (!confirm(`Migrar ${summary.unique} imagem${summary.unique === 1 ? "" : "s"} do Mestre para o Cloudinary? Um backup JSON sera baixado antes e os dados antigos so serao substituidos depois da confirmacao do Firebase.`)) return;

  try {
    await saveMasterImageBackup(campaigns, { requireConfirmation: true });
  } catch (err) {
    if (err?.name === "AbortError") return toast("Migracao cancelada: nenhum dado foi alterado.");
    return alert(firebaseErrorMessage(err));
  }
  imageMigrationInProgress = true;
  imageMigrationProgress = { total: summary.unique, completed: 0, phase: "Preparando migracao segura..." };
  render();

  try {
    for (const campaignId of campaigns.map(campaign => String(campaign.id))) {
      if (usingFirebase()) await flushBeforeAtomicCampaignMutation(campaignId);
      const releaseSnapshotProtection = protectCampaignFromSnapshots(campaignId);
      try {
        const pendingSave = campaignSaveState(campaignId);
        const initial = findCampaign(campaignId);
        if (!initial) continue;
        if (usingFirebase()) {
          if (typeof window.CDIFirebase.upgradeLegacyCampaignStorageLayout !== "function") {
            throw new Error("O servico de compatibilidade das campanhas antigas ainda nao esta disponivel.");
          }
          imageMigrationProgress.phase = `Preparando com seguranca ${initial.name || "campanha"}...`;
          updateImageMigrationProgress();
          await window.CDIFirebase.upgradeLegacyCampaignStorageLayout(campaignId);
        }
        const remoteBaseline = usingFirebase()
          ? await withOperationTimeout(
            window.CDIFirebase.getCampaign(campaignId),
            30000,
            "O Firebase demorou demais para preparar a migracao."
          )
          : cloneCampaignForSave(initial);
        if (!remoteBaseline) throw new Error("O Firebase nao devolveu a campanha antes da migracao.");
        if (usingFirebase()) {
          if (typeof window.CDIFirebase.preflightCampaignImageMigration !== "function") {
            throw new Error("O servico de preflight da migracao ainda nao esta disponivel.");
          }
          imageMigrationProgress.phase = `Auditando ${initial.name || "campanha"} sem alterar dados...`;
          updateImageMigrationProgress();
          const preflight = await window.CDIFirebase.preflightCampaignImageMigration(campaignId, initial);
          const localReferenceCount = collectLegacyImageReferences(initial).length;
          if (preflight?.verified !== true || Number(preflight.expectedCount) !== localReferenceCount) {
            throw new Error(`O preflight confirmou ${Number(preflight?.expectedCount || 0)} de ${localReferenceCount} referencias. Nenhum upload foi iniciado.`);
          }
        }
        const sources = [...new Set(collectLegacyImageReferences(initial).map(reference => reference.source))];
        if (!sources.length) continue;
        const replacementBySource = new Map();
        const uploads = await mapWithConcurrency(sources, IMAGE_UPLOAD_CONCURRENCY, async source => {
          const uploadSource = await imageMigrationUploadSource(source);
          const fingerprint = await mediaFingerprint(uploadSource);
          imageMigrationProgress.phase = `Migrando imagens de ${initial.name || "campanha"}...`;
          updateImageMigrationProgress();
          const asset = await uploadImageAsset(uploadSource, {
            campaignId,
            kind: "legacy-migration",
            entityId: `legacy-${fingerprint.slice(0, 32)}`
          });
          const replacement = { source, url: asset.secureUrl, metadata: asset.metadata };
          replacementBySource.set(source, replacement);
          imageMigrationProgress.completed += 1;
          updateImageMigrationProgress();
          return replacement;
        });
        const failed = uploads.find(result => result?.status === "rejected");
        if (failed) throw failed.reason;

        const latest = findCampaign(campaignId);
        if (!latest) throw new Error("Campanha nao encontrada ao confirmar a migracao.");
        const expectedCampaign = cloneCampaignForSave(latest);
        const expectedReferences = collectLegacyImageReferences(expectedCampaign);
        const expectedSources = new Set(expectedReferences.map(reference => reference.source));
        const replacements = [...replacementBySource.values()].filter(replacement => expectedSources.has(replacement.source));
        const expectedCount = expectedReferences.length;
        imageMigrationProgress.phase = `Confirmando ${expectedCampaign.name || "campanha"} no Firebase...`;
        updateImageMigrationProgress();

        if (usingFirebase()) {
          if (typeof window.CDIFirebase.migrateCampaignImages !== "function") {
            throw new Error("O servico de migracao segura ainda nao esta disponivel.");
          }
          const migrationResult = await window.CDIFirebase.migrateCampaignImages(campaignId, replacements, {
            expectedCampaign,
            expectedCount
          });
          if (migrationResult?.verified !== true || Number(migrationResult.count) !== expectedCount) {
            throw new Error(`O Firebase confirmou ${Number(migrationResult?.count || 0)} de ${expectedCount} referencias.`);
          }
        }

        if (usingFirebase()) {
          let authoritative = await withOperationTimeout(
            window.CDIFirebase.getCampaign(campaignId),
            30000,
            "O Firebase demorou demais para verificar a migracao."
          );
          if (!authoritative) throw new Error("O Firebase nao devolveu a campanha para verificacao final.");
          const latestLocal = findCampaign(campaignId);
          if (!latestLocal) throw new Error("A campanha local desapareceu durante a verificacao.");
          let reconciled = mergeLocalChangesOntoRemote(remoteBaseline, latestLocal, authoritative);
          replaceLegacyImagesLocally(reconciled, replacementBySource);
          reconciled.imageMigration = {
            ...(authoritative.imageMigration || {}),
            provider: "cloudinary",
            migratedReferences: expectedCount,
            verified: true
          };
          const remainingReconciled = collectLegacyImageReferences(reconciled).length;
          if (remainingReconciled) {
            throw new Error(`A reconciliacao encontrou ${remainingReconciled} referencia(s) nova(s) fora do Cloudinary. Execute a migracao novamente.`);
          }
          state.campaigns = state.campaigns.map(campaign => String(campaign.id) === campaignId ? normalizeCampaign(reconciled) : campaign);
          if (String(session.campaign?.id) === campaignId) session.campaign = findCampaign(campaignId);
          if (!persistLocal()) throw new Error("Nao foi possivel preservar a campanha reconciliada no cache local.");

          if (!sameJsonValue(reconciled, authoritative)) {
            queueCampaignSave(reconciled, {
              role: "master",
              playerId: null,
              baseCampaign: authoritative
            });
            await flushBeforeAtomicCampaignMutation(campaignId);
            authoritative = await withOperationTimeout(
              window.CDIFirebase.getCampaign(campaignId),
              30000,
              "O Firebase demorou demais para verificar a reconciliacao."
            );
            if (!authoritative) throw new Error("O Firebase nao devolveu a campanha depois da reconciliacao.");
          }
          const normalizedAuthoritative = normalizeCampaign(authoritative);
          const remainingRemote = collectLegacyImageReferences(normalizedAuthoritative).length;
          if (remainingRemote) throw new Error(`O Firebase ainda devolveu ${remainingRemote} referencia(s) fora do Cloudinary.`);
          state.campaigns = state.campaigns.map(campaign => String(campaign.id) === campaignId ? normalizedAuthoritative : campaign);
          if (String(session.campaign?.id) === campaignId) session.campaign = normalizedAuthoritative;
          pendingSave.deferredRemote = null;
          if (!persistLocal()) throw new Error("Nao foi possivel atualizar o cache local depois da verificacao.");
        } else {
          const convertedCampaign = cloneCampaignForSave(expectedCampaign);
          replaceLegacyImagesLocally(convertedCampaign, replacementBySource);
          convertedCampaign.imageMigration = {
            provider: "cloudinary",
            completedAt: new Date().toISOString(),
            migratedReferences: expectedCount,
            verified: true
          };
          if (collectLegacyImageReferences(convertedCampaign).length) {
            throw new Error("A verificacao local ainda encontrou imagens fora do Cloudinary.");
          }
          state.campaigns = state.campaigns.map(campaign => String(campaign.id) === campaignId ? convertedCampaign : campaign);
          if (String(session.campaign?.id) === campaignId) session.campaign = convertedCampaign;
          if (!persistLocal()) throw new Error("Nao foi possivel preservar a campanha migrada no cache local.");
        }
      } finally {
        releaseSnapshotProtection();
      }
    }

    const remaining = legacyImageSummary().references;
    if (remaining) throw new Error(`A verificacao final encontrou ${remaining} imagem(ns) ainda fora do Cloudinary. Nenhum dado restante foi removido.`);
    toast("Migracao concluida: todas as imagens agora usam URLs do Cloudinary.");
  } catch (err) {
    console.error(err);
    alert(`A migracao foi interrompida com seguranca. O backup permanece disponivel e nenhum arquivo foi excluido.\n\n${firebaseErrorMessage(err)}`);
  } finally {
    imageMigrationInProgress = false;
    imageMigrationProgress = { total: 0, completed: 0, phase: "" };
    render();
  }
}

function masterSettingsPage() {
  const legacy = legacyImageSummary();
  const cloudinaryReady = window.CDIFirebase?.mediaConfigured !== false && Boolean(window.CDI_CLOUDINARY_CONFIG?.cloudName && window.CDI_CLOUDINARY_CONFIG?.uploadPreset);
  return `
    <h2>⚙️ Configurações</h2>
    ${imageMigrationInProgress ? `
      <div class="image-migration-lock" role="alert" aria-live="assertive">
        <div class="image-migration-lock-card">
          <strong>Migracao segura em andamento</strong>
          <span id="imageMigrationLockText">${esc(imageMigrationProgress.phase)}</span>
          <div class="scene-upload-track"><span id="imageMigrationLockBar" style="width:${imageMigrationProgress.total ? Math.round((imageMigrationProgress.completed / imageMigrationProgress.total) * 100) : 0}%"></span></div>
          <small>Nao feche esta aba. As edicoes ficam pausadas ate a verificacao terminar.</small>
        </div>
      </div>` : ""}
    <div class="card media-migration-card" style="margin-bottom:20px;">
      <div class="media-migration-heading">
        <div><h3>☁️ Imagens no Cloudinary</h3><p class="muted">Arquivos originais preservados; o site entrega versões leves sem cortar ou deformar.</p></div>
        <span class="status-chip ${cloudinaryReady ? "status-online" : "status-offline"}">${cloudinaryReady ? "Configurado" : "Nao configurado"}</span>
      </div>
      <div class="media-migration-summary">
        <div><strong>${legacy.references}</strong><span>referencias fora do Cloudinary</span></div>
        <div><strong>${legacy.unique}</strong><span>imagens unicas</span></div>
        <div><strong>${legacy.campaigns}</strong><span>campanhas afetadas</span></div>
      </div>
      ${imageMigrationInProgress ? `
        <div class="media-migration-progress" role="status" aria-live="polite">
          <strong id="imageMigrationProgressText">${esc(imageMigrationProgress.phase)}</strong>
          <div class="scene-upload-track"><span id="imageMigrationProgressBar" style="width:${imageMigrationProgress.total ? Math.round((imageMigrationProgress.completed / imageMigrationProgress.total) * 100) : 0}%"></span></div>
        </div>` : `
        <p class="muted">A migracao cria um backup antes de substituir referencias. Nenhuma imagem antiga e removida do Cloudinary durante este processo.</p>`}
      <div class="row-actions">
        <button class="secondary" onclick="downloadMasterImageBackup()" ${imageMigrationInProgress ? "disabled" : ""}>Baixar backup JSON</button>
        <input id="imageMigrationBackupFile" type="file" accept="application/json,.json" hidden onchange="verifyMasterImageBackupFile(this.files?.[0])">
        <button class="secondary" onclick="document.getElementById('imageMigrationBackupFile')?.click()" ${imageMigrationInProgress ? "disabled" : ""}>Verificar backup JSON</button>
        <button onclick="migrateLegacyImages()" ${!legacy.references || !cloudinaryReady || imageMigrationInProgress ? "disabled" : ""}>Migrar imagens antigas</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:20px;">
      <h3>🔑 Alterar Senha</h3>
      <label>Nova Senha</label><input id="newMasterPass" type="password">
      <br><br><button onclick="saveMasterPassword()">Salvar</button>
    </div>

    <div class="card" style="border-color: var(--danger, #ff4d4d); background: rgba(255, 77, 77, 0.03);">
      <h3 style="color: var(--danger, #ff4d4d);">⚠️ Zona de Perigo</h3>
      <p class="muted" style="margin-bottom: 15px;">Apagar sua conta de Mestre removerá permanentemente seu perfil e todas as campanhas, fichas e dados associados a ele.</p>
      <button class="danger" onclick="deleteMasterAccountModal()">🗑️ Apagar Conta de Mestre</button>
    </div>`;
}

function deleteMasterAccountModal() {
  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2 style="color: var(--danger, #ff4d4d);">⚠️ Excluir Conta de Mestre</h2>
      <p class="muted">Para confirmar a exclusão definitiva da sua conta e de todas as suas campanhas, digite sua senha atual:</p>
      <label>Senha Atual</label>
      <input id="confirmMasterDelPass" type="password" placeholder="Sua senha">
      <br><br>
      <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
      <button class="danger" onclick="executeDeleteMasterAccount()">Confirmar Exclusão</button>
    </div></div>`);
}

async function executeDeleteMasterAccount() {
  if (usingFirebase()) {
    if (!confirm("Confirmar exclusao da conta Firebase e campanhas deste mestre?")) return;
    try {
      const ids = getMasterCampaigns().map(c => c.id);
      for (const id of ids) await window.CDIFirebase.deleteCampaign(id);
      await window.CDIFirebase.deleteCurrentUser();
      state.campaigns = [];
      persistLocal();
      document.querySelectorAll(".modal").forEach(m => m.remove());
      toast("Conta de Mestre excluida com sucesso.");
      home();
    } catch (err) {
      alert(firebaseErrorMessage(err));
    }
    return;
  }
  const pass = document.getElementById("confirmMasterDelPass").value;
  const target = state.masters.find(m => m.id === session.currentMaster.id);

  if (!target || target.password !== pass) {
    alert("Senha incorreta! A exclusão foi cancelada.");
    return;
  }

  // Remove campanhas do mestre
  state.campaigns = state.campaigns.filter(c => c.masterId !== session.currentMaster.id);
  // Remove o mestre
  state.masters = state.masters.filter(m => m.id !== session.currentMaster.id);

  save();
  document.querySelectorAll(".modal").forEach(m => m.remove());
  toast("Conta de Mestre excluída com sucesso.");
  home();
}

function saveMasterPassword() {
  const pass = document.getElementById("newMasterPass").value.trim();
  if (!pass) return alert("Vazio.");
  if (usingFirebase()) {
    window.CDIFirebase.updateCurrentPassword(pass)
      .then(() => toast("Senha alterada no Firebase!"))
      .catch(err => alert(firebaseErrorMessage(err)));
    return;
  }
  const m = state.masters.find(x => x.id === session.currentMaster.id);
  if (m) { m.password = pass; session.currentMaster.password = pass; save(); toast("Senha alterada!"); }
}

function campaignsPage() {
  return `
    <h2>📚 Campanhas</h2><button onclick="newCampaign()">➕ Nova Campanha</button>
    <div class="grid" style="margin-top:15px;">
      ${getMasterCampaigns().map(c => `
        <div class="card">
          <h3>${esc(c.name)}</h3>
          <p class="muted">👤 ${c.characters.length} personagens</p>
          <label>ID para jogadores</label>
          <input readonly value="${esc(c.id)}" onclick="this.select()">
          <button onclick="openCampaign('${esc(c.id)}')">Abrir</button>
          <button class="secondary" onclick="copyCampaignId('${esc(c.id)}')">Copiar ID</button>
          <button class="danger" onclick="deleteCampaign('${c.id}')">Excluir</button>
        </div>`).join("")}
    </div>`;
}

function campaignPage() {
  const c = session.campaign;
  return `
    <h2>📚 ${esc(c.name)}</h2>
    <div class="card">
      <label>ID da Campanha para jogadores</label><input readonly value="${esc(c.id)}" onclick="this.select()">
      <button class="secondary" onclick="copyCampaignId('${esc(c.id)}')">Copiar ID da Campanha</button>
      <label>Nome</label><input id="campName" value="${esc(c.name)}">
      <label>Senha</label><input id="campPass" value="${esc(c.password)}">
      <label>Descrição</label><textarea id="campDesc">${esc(c.description)}</textarea>
      <br><button onclick="cSave()">Salvar</button>
    </div>`;
}

function cSave() {
  const c = session.campaign;
  c.name = document.getElementById("campName").value;
  c.password = document.getElementById("campPass").value;
  c.description = document.getElementById("campDesc").value;
  save(); render(); toast("Salvo!");
}

function newCampaign(first = false) {
  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2>📚 Nova Campanha</h2>
      <label>Nome</label><input id="cn">
      <label>Senha</label><input id="cp" type="password">
      <label>Descrição</label><textarea id="cd"></textarea>
      <br><button onclick="createCampaign()">Criar</button>
      ${first ? "" : "<button class='secondary' onclick='this.closest(\".modal\").remove()'>Cancelar</button>"}
    </div></div>`);
}

async function createCampaign() {
  const c = {
    id: uid(), masterId: session.currentMaster.id,
    name: document.getElementById("cn").value || "Campanha",
    password: document.getElementById("cp").value || "123",
    description: document.getElementById("cd").value || "",
    members: [session.currentMaster.id],
    players: [], characters: [], cases: [], creatures: [], items: [], evidence: [], marks: [], diceLogs: [], messages: [], scenes: [], traumaCatalog: [],
    originLoadouts: {},
    itemTransfers: [], customSkills: [...OFFICIAL_SKILLS]
  };
  normalizeCampaign(c);
  state.campaigns.push(c);
  session.campaign = c;
  session.view = "campaign";
  persistLocal();

  if (usingFirebase()) {
    try {
      queueCampaignSave(c, {
        role: "master",
        playerId: null,
        baseCampaign: null,
        isCreation: true
      });
      await flushBeforeAtomicCampaignMutation(c.id);
      lastSavedCampaignJson = JSON.stringify(c);
    } catch (err) {
      document.querySelectorAll(".modal").forEach(m => m.remove());
      render();
      alert(`${firebaseErrorMessage(err)}\n\nA campanha e suas alteracoes continuam preservadas neste navegador e serao sincronizadas quando a conexao voltar.`);
      return;
    }
  } else {
    save();
  }

  document.querySelectorAll(".modal").forEach(m => m.remove());
  render();
  toast("Campanha criada! Compartilhe o ID com os jogadores.");
}

async function deleteCampaign(id) {
  if (confirm("Excluir campanha?")) {
    state.campaigns = state.campaigns.filter(c => c.id !== id);
    session.campaign = getMasterCampaigns()[0] || null;
    persistLocal();
    if (usingFirebase()) {
      try { await window.CDIFirebase.deleteCampaign(id); }
      catch (err) { alert(firebaseErrorMessage(err)); }
    }
    render();
  }
}

// --- PERSONAGENS ---
function charactersPage() {
  const c = session.campaign;
  return `
    <h2>👤 Personagens</h2><button onclick="characterModal()">➕ Criar Personagem</button>
    <div class="grid" style="margin-top:15px;">
      ${c.characters.map((x, i) => {
        const controller = c.players.find(player => player.id === x.controllerPlayerId && player.characterId === x.id);
        return `
        <div class="card">
          ${entityVisual(x.image, x.name)}
          <h3>${esc(x.name)}</h3><span class="tag">${esc(x.origin)}</span>
          <p style="margin-top:8px;">❤️ ${x.health}/${x.healthMax} · 🧠 ${x.sanity}/${x.sanityMax}</p><br>
          <p class="muted">${controller ? `Controlado por ${esc(controller.name)}` : "Sem jogador vinculado"} · ${x.inventory.length} item${x.inventory.length === 1 ? "" : "s"}</p>
          <button onclick="characterModal(${i})">Ficha</button>
          <button class="secondary" onclick="manageCharacterInventoryModal('${x.id}')">Inventario</button>
          <button class="danger" onclick="del('characters',${i})">Excluir</button>
        </div>`;
      }).join("")}
    </div>`;
}

function characterOriginLoadout(origin) {
  return tabletop.getOriginLoadout(session.campaign, origin);
}

function updateCharacterOriginKitState(origin) {
  const checkbox = document.getElementById("applyOriginKitOnCreate");
  const summary = document.getElementById("characterOriginKitSummary");
  if (!checkbox || !summary) return;
  const loadout = characterOriginLoadout(origin);
  checkbox.disabled = loadout.length === 0;
  checkbox.checked = loadout.length > 0;
  summary.textContent = loadout.length
    ? `${loadout.length} tipo${loadout.length === 1 ? "" : "s"} de item no kit`
    : "Nenhum kit configurado para esta origem";
}

function characterModal(index = null) {
  const c = session.campaign;
  const x = index === null ? { name: "", origin: ORIGINS[0], healthMax: 20, health: 20, sanityMax: 10, sanity: 10, defense: 10, attrs: {}, res: {}, skills: [], expressions: [], activeExpression: "", inventory: [], appliedOriginLoadouts: [], controllerPlayerId: null } : c.characters[index];
  x.skills ??= [];
  const initialLoadout = index === null ? characterOriginLoadout(x.origin) : [];

  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2>👑 Ficha (Mestre)</h2>
      <label>Nome</label><input id="cname" value="${esc(x.name)}">
      ${imgInput("photo", "Foto do rosto do personagem", x.image)}
      <label>Origem</label><select id="origin" ${index === null ? `onchange="updateCharacterOriginKitState(this.value)"` : ""}>${ORIGINS.map(o => `<option ${o === x.origin ? "selected" : ""}>${o}</option>`).join("")}</select>
      ${index === null ? `
        <div class="character-origin-kit">
          <label class="compact-checkbox"><input id="applyOriginKitOnCreate" type="checkbox" ${initialLoadout.length ? "checked" : "disabled"}> Aplicar kit inicial da origem</label>
          <span id="characterOriginKitSummary" class="muted">${initialLoadout.length ? `${initialLoadout.length} tipo${initialLoadout.length === 1 ? "" : "s"} de item no kit` : "Nenhum kit configurado para esta origem"}</span>
        </div>` : ""}
      <div class="two">
        <div><label>Saúde Máx</label><input id="hm" type="number" value="${x.healthMax}"></div>
        <div><label>Saúde Atual</label><input id="hv" type="number" value="${x.health}"></div>
        <div><label>Sanidade Máx</label><input id="sm" type="number" value="${x.sanityMax}"></div>
        <div><label>Sanidade Atual</label><input id="sv" type="number" value="${x.sanity}"></div>
      </div>
      <label>🛡️ Defesa</label><input id="cdef" type="number" value="${x.defense ?? 10}">
      <h3>📊 Atributos</h3><div class="two">${ATTR.map(a => `<div><label>${a}</label><input id="a_${a}" type="number" value="${x.attrs[a] ?? 0}"></div>`).join("")}</div>
      <h3>🛡️ Resistências</h3><div class="two">${RES.map(a => `<div><label>${a}</label><input id="r_${a}" type="number" value="${x.res[a] ?? 0}"></div>`).join("")}</div>
      
      <h3>🎯 Habilidades</h3>
      <div class="skills-selector">
        ${(c.customSkills || OFFICIAL_SKILLS).map(sk => `
          <label><input type="checkbox" class="master-sk-check" value="${esc(sk)}" ${x.skills.some(s => s.name === sk) ? "checked" : ""}> ${esc(sk)}</label>`).join("")}
      </div>

      <div style="margin-top:10px;">
        ${x.skills.map((s, idx) => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:6px; border-bottom:1px solid var(--card-border);">
            <span><b>${esc(s.name)}</b></span>
            <div style="display:flex; align-items:center; gap:5px;">
              <span>Máx:</span><input type="number" id="sk_max_${idx}" value="${s.maxUses ?? 2}" style="width:45px;">
              ${index !== null ? `<button class="danger" onclick="removeSkill('${x.id}', ${idx})">✕</button>` : ''}
            </div>
          </div>`).join("")}
      </div>

      <br><button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
      <button id="saveCharacterButton" onclick="saveCharacter(${index})">Salvar</button>
    </div></div>`);
}

async function saveCharacter(index) {
  const isNew = index === null;
  const campaignId = String(session.campaign?.id || "");
  const initial = isNew ? null : session.campaign?.characters?.[index];
  const characterId = String(initial?.id || uid());
  const button = document.getElementById("saveCharacterButton");
  const healthMax = +document.getElementById("hm").value;
  const sanityMax = +document.getElementById("sm").value;
  const attrs = {};
  const res = {};
  ATTR.forEach(attribute => { attrs[attribute] = +document.getElementById("a_" + attribute).value; });
  RES.forEach(resistance => { res[resistance] = +document.getElementById("r_" + resistance).value; });
  const checked = Array.from(document.querySelectorAll('.master-sk-check:checked')).map(cb => cb.value);
  const skills = checked.map(name => ({ ...(initial?.skills?.find(skill => skill.name === name) || { name, uses: 2, maxUses: 2, bonus: 0 }) }));
  skills.forEach((skill, idx) => {
    const maxInput = document.getElementById(`sk_max_${idx}`);
    if (maxInput) {
      skill.maxUses = parseInt(maxInput.value) || 0;
      if (skill.uses > skill.maxUses) skill.uses = skill.maxUses;
    }
  });
  const applyInitialLoadout = isNew && Boolean(document.getElementById("applyOriginKitOnCreate")?.checked);
  const changes = {
    name: document.getElementById("cname").value || "Personagem",
    origin: document.getElementById("origin").value,
    healthMax,
    health: Math.max(0, Math.min(healthMax, +document.getElementById("hv").value)),
    sanityMax,
    sanity: Math.max(0, Math.min(sanityMax, +document.getElementById("sv").value)),
    defense: +document.getElementById("cdef").value || 10,
    attrs,
    res,
    skills
  };

  if (button) {
    button.disabled = true;
    button.textContent = "Salvando...";
  }
  try {
    const file = document.getElementById("photo")?.files?.[0];
    const image = file ? await readImg(file, 1000, { campaignId, kind: "characters", entityId: characterId }) : "";
    let campaign = findCampaign(campaignId);
    if (!campaign) throw new Error("A campanha foi atualizada durante o envio. Tente novamente.");
    let currentCharacter = campaign.characters.find(entry => String(entry.id) === characterId);
    if (!isNew && !currentCharacter) throw new Error("Personagem nao encontrado.");

    const workingCampaign = cloneCampaignForSave(campaign);
    let nextCharacter = workingCampaign.characters.find(entry => String(entry.id) === characterId);
    if (!nextCharacter) {
      nextCharacter = {
        id: characterId,
        attrs: {}, res: {}, skills: [], expressions: [], activeExpression: "", inventory: [],
        appliedOriginLoadouts: [], controllerPlayerId: null
      };
      workingCampaign.characters.push(nextCharacter);
    }
    Object.assign(nextCharacter, changes);
    if (image) applyImageAsset(nextCharacter, image);
    if (applyInitialLoadout) tabletop.applyOriginLoadout(workingCampaign, nextCharacter.id, { origin: nextCharacter.origin }, uid);

    if (image) {
      const characterPatch = {
        id: characterId,
        ...changes,
        image: nextCharacter.image,
        ...(nextCharacter.imageMeta ? { imageMeta: { ...nextCharacter.imageMeta } } : {}),
        ...(isNew ? {
          expressions: nextCharacter.expressions || [],
          activeExpression: nextCharacter.activeExpression || "",
          inventory: nextCharacter.inventory || [],
          appliedOriginLoadouts: nextCharacter.appliedOriginLoadouts || [],
          controllerPlayerId: nextCharacter.controllerPlayerId ?? null
        } : {}),
        ...(applyInitialLoadout ? {
          inventory: nextCharacter.inventory || [],
          appliedOriginLoadouts: nextCharacter.appliedOriginLoadouts || []
        } : {})
      };
      await commitCampaignMediaMutation(campaignId, {
        basePatch: {},
        documents: [{
          collection: "characters",
          id: characterId,
          data: {
            ...characterPatch,
            _order: isNew ? campaign.characters.length : Math.max(0, campaign.characters.findIndex(entry => String(entry.id) === characterId))
          }
        }],
        cloudinaryUrls: [image]
      });
      campaign = findCampaign(campaignId);
      if (!campaign) throw new Error("Campanha nao encontrada depois da confirmacao da imagem.");
      currentCharacter = campaign.characters.find(entry => String(entry.id) === characterId);
      if (!currentCharacter) {
        currentCharacter = { id: characterId };
        campaign.characters.push(currentCharacter);
      }
      Object.assign(currentCharacter, characterPatch);
      persistLocal();
    } else {
      currentCharacter = currentCharacter || { id: characterId };
      if (!campaign.characters.includes(currentCharacter)) campaign.characters.push(currentCharacter);
      Object.assign(currentCharacter, changes);
      if (applyInitialLoadout) tabletop.applyOriginLoadout(campaign, currentCharacter.id, { origin: currentCharacter.origin }, uid);
      save();
    }
    session.campaign = campaign;
    document.querySelector(".modal")?.remove();
    render();
    toast(applyInitialLoadout ? "Personagem salvo com o kit inicial." : "Salvo!");
  } catch (err) {
    console.error(err);
    alert(firebaseErrorMessage(err));
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = "Salvar";
    }
  }
}

function removeSkill(charId, idx) {
  const ch = session.campaign.characters.find(x => x.id === charId);
  ch.skills.splice(idx, 1);
  save(); render();
}

function activeCharacterExpression(character) {
  const activeId = String(character?.activeExpression || "");
  if (!activeId) return null;
  return (character.expressions || []).find(expression => String(expression.id) === activeId) || null;
}

function gameCharacterImage(character) {
  return activeCharacterExpression(character)?.image || character?.image || "";
}

function expressionPlaylistCard(character, expression = null) {
  const expressionId = expression ? String(expression.id) : "";
  const isActive = String(character.activeExpression || "") === expressionId;
  const isUpdating = expressionMutations.has(String(character.id));
  const title = expression?.title || "Retrato original";
  const image = expression?.image || character.image || "";

  return `
    <article class="expression-card ${isActive ? "is-active" : ""}" data-expression-id="${esc(expressionId || "original")}" ${isActive ? `aria-current="true"` : ""}>
      <div class="expression-card-media">
        ${entityVisual(image, title, "expression-card-image")}
        ${isActive ? `<span class="expression-active-badge">Em uso</span>` : ""}
      </div>
      <div class="expression-card-body">
        <h4>${esc(title)}</h4>
        <div class="expression-card-actions">
          <button class="secondary expression-use-button" ${isUpdating ? "disabled" : ""} onclick="selectCharacterExpression(${jsArg(character.id)}, ${jsArg(expressionId)})">${isActive ? "↻ Reaplicar" : "Usar no Game"}</button>
          ${expression ? `<button class="danger expression-remove-button" title="Remover expressão" aria-label="Remover expressão ${esc(title)}" ${isUpdating ? "disabled" : ""} onclick="removeCharacterExpression(${jsArg(character.id)}, ${jsArg(expressionId)})">×</button>` : ""}
        </div>
      </div>
    </article>`;
}

function masterExpressionsPage() {
  const characters = session.campaign?.characters || [];
  characters.forEach(character => {
    character.expressions ??= [];
    character.activeExpression ??= "";
  });

  return `
    <div class="page-heading expression-page-heading">
      <div>
        <h2>◒ Expressões</h2>
        <p class="muted">Retratos disponíveis para cada personagem da campanha.</p>
      </div>
      <button onclick="expressionModal()" ${characters.length ? "" : "disabled"}>Adicionar expressão</button>
    </div>
    ${characters.length ? `
      <div class="expression-character-list">
        ${characters.map(character => {
          const activeExpression = activeCharacterExpression(character);
          const activeTitle = activeExpression?.title || "Retrato original";
          const isUpdating = expressionMutations.has(String(character.id));
          return `
            <section class="expression-character-section">
              <header class="expression-character-heading">
                <div class="expression-character-identity">
                  ${entityVisual(gameCharacterImage(character), character.name, "expression-character-portrait")}
                  <div>
                    <h3>${esc(character.name)}</h3>
                    <span class="tag">Origem: ${esc(character.origin || "Sem origem")}</span>
                  </div>
                </div>
                <div class="expression-character-actions">
                  <div class="expression-current-state">
                    <span>Em uso no Game</span>
                    <strong>${esc(activeTitle)}</strong>
                  </div>
                  <button onclick="expressionModal(${jsArg(character.id)})" ${isUpdating ? "disabled" : ""}>Adicionar expressão</button>
                </div>
              </header>
              <div class="expression-playlist" aria-label="Expressões de ${esc(character.name)}">
                ${expressionPlaylistCard(character)}
                ${character.expressions.map(expression => expressionPlaylistCard(character, expression)).join("")}
              </div>
            </section>`;
        }).join("")}
      </div>`
      : `<div class="empty-state"><h3>Nenhum personagem criado</h3><p>Crie um personagem antes de adicionar expressões.</p></div>`}`;
}

function expressionModal(characterId = "") {
  if (session.role !== "master") return;
  const characters = session.campaign?.characters || [];
  if (!characters.length) return alert("Crie um personagem antes de adicionar uma expressão.");
  const selectedId = characters.some(character => String(character.id) === String(characterId))
    ? String(characterId)
    : String(characters[0].id);

  root.insertAdjacentHTML("beforeend", `
    <div id="expressionModal" class="modal"><div class="modalbox expression-modalbox">
      <h2>Adicionar expressão</h2>
      <label>Personagem</label>
      <select id="expressionCharacter" required>
        ${characters.map(character => `<option value="${esc(character.id)}" ${String(character.id) === selectedId ? "selected" : ""}>${esc(character.name)} · ${esc(character.origin || "Sem origem")}</option>`).join("")}
      </select>
      <label>Título <span class="required-marker">*</span></label>
      <input id="expressionTitle" maxlength="60" required placeholder="Ex.: Tenso">
      ${imgInput("expressionImage", "Foto da expressão", "", true)}
      <div class="modal-actions">
        <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
        <button id="saveExpressionButton" onclick="saveCharacterExpression()">Adicionar e usar</button>
      </div>
    </div></div>`);
}

async function saveCharacterExpression() {
  if (session.role !== "master" || !session.campaign) return;
  const campaignId = String(session.campaign.id);
  const characterId = String(document.getElementById("expressionCharacter")?.value || "");
  const title = String(document.getElementById("expressionTitle")?.value || "").trim().slice(0, 60);
  const file = document.getElementById("expressionImage")?.files?.[0];
  const button = document.getElementById("saveExpressionButton");
  const initialCharacter = session.campaign.characters.find(entry => String(entry.id) === characterId);

  if (!initialCharacter || !title || !file) {
    return alert("Escolha o personagem e preencha o título e a foto da expressão.");
  }
  if (expressionMutations.has(characterId)) return;

  if (button) {
    button.disabled = true;
    button.textContent = "Adicionando...";
  }

  let campaign = null;
  let character = null;
  let previousExpressions = null;
  let previousActiveExpression = "";
  let previousUpdatedAt = null;
  let releaseSnapshotProtection = null;
  expressionMutations.add(characterId);

  try {
    const expressionId = uid();
    const image = await readImg(file, 1000, { campaignId, kind: "expressions", entityId: expressionId });
    if (!image) throw new Error("Nao foi possivel processar a foto da expressao.");
    releaseSnapshotProtection = protectCampaignFromSnapshots(campaignId);
    if (usingFirebase()) await flushBeforeAtomicCampaignMutation(campaignId);

    campaign = findCampaign(campaignId);
    character = campaign?.characters.find(entry => String(entry.id) === characterId);
    if (!character) throw new Error("Personagem nao encontrado.");
    previousExpressions = [...(character.expressions || [])];
    previousActiveExpression = String(character.activeExpression || "");
    previousUpdatedAt = character.expressionUpdatedAt || null;

    const expression = tabletop?.normalizeExpression
      ? tabletop.normalizeExpression({ id: expressionId, title, image, createdAt: new Date().toISOString() }, uid)
      : { id: expressionId, title, image, createdAt: new Date().toISOString() };
    applyImageAsset(expression, image);
    character.expressions = [expression, ...previousExpressions];
    character.activeExpression = expression.id;
    character.expressionUpdatedAt = new Date().toISOString();
    persistLocal();

    if (usingFirebase()) {
      const result = await window.CDIFirebase.updateCharacterExpressions(
        campaign.id,
        character.id,
        character.expressions,
        character.activeExpression
      );
      if (result?.expressionUpdatedAt) character.expressionUpdatedAt = result.expressionUpdatedAt;
      lastSavedCampaignJson = JSON.stringify(campaign);
    }

    document.getElementById("expressionModal")?.remove();
    expressionMutations.delete(characterId);
    render();
    toast("Expressão adicionada e aplicada no Game.");
  } catch (err) {
    console.error(err);
    if (character && previousExpressions) {
      character.expressions = previousExpressions;
      character.activeExpression = previousActiveExpression;
      character.expressionUpdatedAt = previousUpdatedAt;
      persistLocal();
    }
    alert(firebaseErrorMessage(err));
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = "Adicionar e usar";
    }
  } finally {
    releaseSnapshotProtection?.();
    expressionMutations.delete(characterId);
  }
}

async function selectCharacterExpression(characterId, expressionId = "") {
  if (session.role !== "master" || !session.campaign) return;
  const campaignId = String(session.campaign.id);
  const normalizedCharacterId = String(characterId);
  const normalizedExpressionId = String(expressionId || "");
  const initialCharacter = session.campaign.characters.find(entry => String(entry.id) === normalizedCharacterId);
  const expressionExists = !normalizedExpressionId
    || initialCharacter?.expressions?.some(expression => String(expression.id) === normalizedExpressionId);
  if (!initialCharacter || !expressionExists || expressionMutations.has(normalizedCharacterId)) return;

  let campaign = null;
  let character = null;
  let previousActiveExpression = "";
  let previousUpdatedAt = null;
  let releaseSnapshotProtection = null;
  expressionMutations.add(normalizedCharacterId);

  try {
    releaseSnapshotProtection = protectCampaignFromSnapshots(campaignId);
    if (usingFirebase()) await flushBeforeAtomicCampaignMutation(campaignId);
    campaign = findCampaign(campaignId);
    if (String(session.campaign?.id || "") !== campaignId) throw new Error("A campanha ativa mudou durante a operacao.");
    character = campaign?.characters.find(entry => String(entry.id) === normalizedCharacterId);
    const freshExpressionExists = !normalizedExpressionId
      || character?.expressions?.some(expression => String(expression.id) === normalizedExpressionId);
    if (!character || !freshExpressionExists) throw new Error("Expressao nao encontrada.");
    previousActiveExpression = String(character.activeExpression || "");
    previousUpdatedAt = character.expressionUpdatedAt || null;

    character.activeExpression = normalizedExpressionId;
    character.expressionUpdatedAt = new Date().toISOString();
    persistLocal();
    render();

    if (usingFirebase()) {
      const result = await window.CDIFirebase.updateCharacterExpressions(
        campaign.id,
        character.id,
        character.expressions || [],
        character.activeExpression
      );
      if (result?.expressionUpdatedAt) character.expressionUpdatedAt = result.expressionUpdatedAt;
      lastSavedCampaignJson = JSON.stringify(campaign);
    }
    toast(normalizedExpressionId ? "Expressão aplicada no Game." : "Retrato original aplicado no Game.");
  } catch (err) {
    console.error(err);
    if (character) {
      character.activeExpression = previousActiveExpression;
      character.expressionUpdatedAt = previousUpdatedAt;
      persistLocal();
    }
    alert(firebaseErrorMessage(err));
  } finally {
    releaseSnapshotProtection?.();
    expressionMutations.delete(normalizedCharacterId);
    render();
  }
}

async function removeCharacterExpression(characterId, expressionId) {
  if (session.role !== "master" || !session.campaign) return;
  const campaignId = String(session.campaign.id);
  const normalizedCharacterId = String(characterId);
  const normalizedExpressionId = String(expressionId);
  const initialCharacter = session.campaign.characters.find(entry => String(entry.id) === normalizedCharacterId);
  const initialExpression = initialCharacter?.expressions?.find(entry => String(entry.id) === normalizedExpressionId);
  if (!initialCharacter || !initialExpression || expressionMutations.has(normalizedCharacterId)) return;
  if (!confirm(`Remover a expressão "${initialExpression.title}" deste personagem?`)) return;

  let campaign = null;
  let character = null;
  let previousExpressions = null;
  let previousActiveExpression = "";
  let previousUpdatedAt = null;
  let releaseSnapshotProtection = null;
  expressionMutations.add(normalizedCharacterId);

  try {
    releaseSnapshotProtection = protectCampaignFromSnapshots(campaignId);
    if (usingFirebase()) await flushBeforeAtomicCampaignMutation(campaignId);
    campaign = findCampaign(campaignId);
    if (String(session.campaign?.id || "") !== campaignId) throw new Error("A campanha ativa mudou durante a operacao.");
    character = campaign?.characters.find(entry => String(entry.id) === normalizedCharacterId);
    const expression = character?.expressions?.find(entry => String(entry.id) === normalizedExpressionId);
    if (!character || !expression) throw new Error("Expressao nao encontrada.");
    previousExpressions = [...character.expressions];
    previousActiveExpression = String(character.activeExpression || "");
    previousUpdatedAt = character.expressionUpdatedAt || null;

    character.expressions = character.expressions.filter(entry => String(entry.id) !== normalizedExpressionId);
    if (character.activeExpression === normalizedExpressionId) character.activeExpression = "";
    character.expressionUpdatedAt = new Date().toISOString();
    persistLocal();
    render();

    if (usingFirebase()) {
      const result = await window.CDIFirebase.updateCharacterExpressions(
        campaign.id,
        character.id,
        character.expressions,
        character.activeExpression
      );
      if (result?.expressionUpdatedAt) character.expressionUpdatedAt = result.expressionUpdatedAt;
      lastSavedCampaignJson = JSON.stringify(campaign);
    }
    toast("Expressão removida.");
  } catch (err) {
    console.error(err);
    if (character && previousExpressions) {
      character.expressions = previousExpressions;
      character.activeExpression = previousActiveExpression;
      character.expressionUpdatedAt = previousUpdatedAt;
      persistLocal();
    }
    alert(firebaseErrorMessage(err));
  } finally {
    releaseSnapshotProtection?.();
    expressionMutations.delete(normalizedCharacterId);
    render();
  }
}

function formatTraumaDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function traumaLoadoutItem(trauma, characterId = "", canRemove = false) {
  const acquiredAt = formatTraumaDate(trauma.acquiredAt);
  const removing = traumaMutations.has(String(characterId));
  const visual = trauma.image
    ? `<img ${imageSourceAttrs(trauma.image, "thumb")} alt="${esc(trauma.title)}" loading="lazy" decoding="async">`
    : `<span aria-hidden="true">&#9888;</span>`;
  return `
    <article class="trauma-loadout-item" data-trauma-id="${esc(trauma.id)}" title="${esc(trauma.title)}">
      <button class="trauma-loadout-visual" title="Ver ${esc(trauma.title)}" aria-label="Ver imagem do trauma ${esc(trauma.title)}" onclick="openImageModal(${jsArg(trauma.image)}, ${jsArg(trauma.title)})" ${trauma.image ? "" : "disabled"}>
        ${visual}
      </button>
      <div class="trauma-loadout-copy">
        <strong>${esc(trauma.title)}</strong>
        ${acquiredAt ? `<time datetime="${esc(trauma.acquiredAt)}">${esc(acquiredAt)}</time>` : ""}
      </div>
      ${canRemove ? `<button class="danger trauma-unlink-button" title="Desvincular trauma" aria-label="Desvincular trauma ${esc(trauma.title)}" ${removing ? "disabled" : ""} onclick="removeCharacterTrauma(${jsArg(characterId)}, ${jsArg(trauma.id)})">&#10005;</button>` : ""}
    </article>`;
}

function traumaLibraryIcon(trauma) {
  const deleting = traumaMutations.has(`catalog:${String(trauma.id)}`);
  const visual = trauma.image
    ? `<img ${imageSourceAttrs(trauma.image, "thumb")} alt="" loading="lazy" decoding="async">`
    : `<span aria-hidden="true">&#9888;</span>`;
  return `
    <div class="trauma-library-icon-shell" role="listitem">
      <button class="trauma-library-icon" title="${esc(trauma.title)}" aria-label="Vincular trauma ${esc(trauma.title)}" onclick="traumaAssignmentModal('', ${jsArg(trauma.id)})">
        ${visual}
      </button>
      <button class="danger trauma-library-delete" type="button" title="Excluir trauma" aria-label="Excluir trauma ${esc(trauma.title)}" ${deleting ? "disabled" : ""} onclick="deleteTraumaCatalogEntry(${jsArg(trauma.id)})">&#10005;</button>
      <span class="trauma-library-tooltip" role="tooltip">${esc(trauma.title)}</span>
    </div>`;
}

function masterTraumasPage() {
  const campaign = session.campaign;
  const characters = campaign.characters || [];
  const catalog = campaign.traumaCatalog || [];
  characters.forEach(character => { character.traumas ??= []; });

  return `
    <div class="page-heading trauma-page-heading">
      <div>
        <h2>&#9888; Traumas</h2>
        <p class="muted">Biblioteca da campanha e vínculos ativos.</p>
      </div>
      <button onclick="traumaCatalogModal()">Cadastrar trauma</button>
    </div>

    <section class="trauma-library-section" aria-labelledby="traumaLibraryTitle">
      <header class="trauma-section-heading">
        <div>
          <span class="section-kicker">Traumas cadastrados</span>
          <h3 id="traumaLibraryTitle">Biblioteca</h3>
        </div>
        <span class="muted">${catalog.length} cadastrado${catalog.length === 1 ? "" : "s"}</span>
      </header>
      ${catalog.length
        ? `<div class="trauma-library-grid" role="list" aria-label="Traumas cadastrados">
            ${catalog.map(traumaLibraryIcon).join("")}
          </div>`
        : `<div class="trauma-library-empty"><span aria-hidden="true">&#9671;</span><p>Nenhum trauma cadastrado.</p></div>`}
    </section>

    <section class="trauma-assignments-section" aria-labelledby="traumaAssignmentsTitle">
      <header class="trauma-section-heading">
        <div>
          <span class="section-kicker">Personagens</span>
          <h3 id="traumaAssignmentsTitle">Traumas vinculados</h3>
        </div>
      </header>
    ${characters.length ? `
      <div class="trauma-character-list">
        ${characters.map(character => `
          <section class="trauma-character-section">
            <header class="trauma-character-heading">
              <div class="trauma-character-identity">
                ${entityVisual(character.image, character.name, "trauma-character-portrait")}
                <div>
                  <h3>${esc(character.name)}</h3>
                  <span class="tag">Origem: ${esc(character.origin || "Sem origem")}</span>
                </div>
              </div>
              <div class="trauma-character-actions">
                <span class="muted">${character.traumas.length} trauma${character.traumas.length === 1 ? "" : "s"}</span>
                <button onclick="traumaAssignmentModal(${jsArg(character.id)})" ${catalog.length ? "" : "disabled"}>Vincular trauma</button>
              </div>
            </header>
            ${character.traumas.length
              ? `<div class="trauma-loadout" role="list">${character.traumas.map(trauma => traumaLoadoutItem(trauma, character.id, true)).join("")}</div>`
              : `<p class="trauma-empty-character muted">Nenhum trauma vinculado.</p>`}
          </section>`).join("")}
      </div>`
      : `<div class="empty-state"><h3>Nenhum personagem criado</h3><p>Crie um personagem antes de vincular um trauma.</p></div>`}
    </section>`;
}

function playerTraumasPage(character) {
  character.traumas ??= [];
  return `
    <div class="page-heading trauma-page-heading">
      <div>
        <h2>&#9888; Meus Traumas</h2>
        <p class="muted">${esc(character.origin || "Personagem")} · ${character.traumas.length} trauma${character.traumas.length === 1 ? "" : "s"}</p>
      </div>
    </div>
    ${character.traumas.length
      ? `<div class="trauma-loadout trauma-player-loadout" role="list">${character.traumas.map(trauma => traumaLoadoutItem(trauma)).join("")}</div>`
      : `<div class="empty-state trauma-empty-state"><h3>Nenhum trauma</h3><p>Este personagem ainda não adquiriu traumas.</p></div>`}`;
}

function traumaCatalogModal() {
  if (session.role !== "master") return;
  root.insertAdjacentHTML("beforeend", `
    <div id="traumaCatalogModal" class="modal"><div class="modalbox trauma-modalbox">
      <h2>Cadastrar trauma</h2>
      <label>Título <span class="required-marker">*</span></label>
      <input id="traumaTitle" maxlength="80" required placeholder="Ex.: Aracnofobia">
      ${imgInput("traumaImage", "Miniatura do trauma", "", true)}
      <div class="modal-actions">
        <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
        <button id="saveTraumaCatalogButton" onclick="saveTraumaCatalogEntry()">Cadastrar trauma</button>
      </div>
    </div></div>`);
}

async function saveTraumaCatalogEntry() {
  if (session.role !== "master" || !session.campaign) return;
  const campaignId = String(session.campaign.id);
  const title = String(document.getElementById("traumaTitle")?.value || "").trim().slice(0, 80);
  const file = document.getElementById("traumaImage")?.files?.[0];
  const button = document.getElementById("saveTraumaCatalogButton");
  const initialCampaign = session.campaign;
  initialCampaign.traumaCatalog ??= [];

  if (!title || !file) return alert("Preencha o título e a miniatura do trauma.");
  if (initialCampaign.traumaCatalog.some(trauma => String(trauma.title).trim().toLowerCase() === title.toLowerCase())) {
    return alert("Já existe um trauma com este título na biblioteca.");
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Cadastrando...";
  }

  let campaign = null;
  let previousCatalog = null;
  let releaseSnapshotProtection = null;
  try {
    const traumaId = uid();
    const image = await readImg(file, 480, { campaignId, kind: "traumas", entityId: traumaId });
    if (!image) throw new Error("Nao foi possivel processar a miniatura do trauma.");
    releaseSnapshotProtection = protectCampaignFromSnapshots(campaignId);
    if (usingFirebase()) await flushBeforeAtomicCampaignMutation(campaignId);

    campaign = findCampaign(campaignId);
    campaign.traumaCatalog ??= [];
    if (campaign.traumaCatalog.some(trauma => String(trauma.title).trim().toLowerCase() === title.toLowerCase())) {
      throw new Error("Ja existe um trauma com este titulo na biblioteca.");
    }
    previousCatalog = [...campaign.traumaCatalog];
    const trauma = tabletop?.normalizeTraumaCatalogEntry
      ? tabletop.normalizeTraumaCatalogEntry({ id: traumaId, title, image, createdAt: new Date().toISOString() }, uid)
      : { id: traumaId, title, image, createdAt: new Date().toISOString() };
    applyImageAsset(trauma, image);
    campaign.traumaCatalog = [trauma, ...campaign.traumaCatalog];
    persistLocal();

    if (usingFirebase()) {
      await window.CDIFirebase.updateTraumaCatalog(campaign.id, campaign.traumaCatalog);
      lastSavedCampaignJson = JSON.stringify(campaign);
    }

    document.getElementById("traumaCatalogModal")?.remove();
    render();
    toast("Trauma cadastrado na biblioteca.");
  } catch (err) {
    console.error(err);
    if (campaign && previousCatalog) {
      campaign.traumaCatalog = previousCatalog;
      persistLocal();
    }
    alert(firebaseErrorMessage(err));
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = "Cadastrar trauma";
    }
  } finally {
    releaseSnapshotProtection?.();
  }
}

async function deleteTraumaCatalogEntry(traumaCatalogId) {
  if (session.role !== "master" || !session.campaign) return;
  const campaignId = String(session.campaign.id);
  const catalogId = String(traumaCatalogId || "");
  const mutationKey = `catalog:${catalogId}`;
  const initialTrauma = session.campaign.traumaCatalog?.find(entry => String(entry.id) === catalogId);
  if (!initialTrauma || traumaMutations.has(mutationKey)) return;

  const linkedCount = session.campaign.characters.reduce((total, character) => (
    total + (character.traumas || []).filter(trauma => String(trauma.catalogId) === catalogId).length
  ), 0);
  const warning = linkedCount
    ? `Excluir o trauma "${initialTrauma.title}" da biblioteca e desvincula-lo de ${linkedCount} personagem${linkedCount === 1 ? "" : "s"}?`
    : `Excluir o trauma "${initialTrauma.title}" da biblioteca?`;
  if (!confirm(warning)) return;

  let campaign = null;
  let previousCatalog = null;
  let previousCharacterTraumas = null;
  let releaseSnapshotProtection = null;
  traumaMutations.add(mutationKey);
  render();
  try {
    releaseSnapshotProtection = protectCampaignFromSnapshots(campaignId);
    if (usingFirebase()) await flushBeforeAtomicCampaignMutation(campaignId);
    campaign = findCampaign(campaignId);
    if (String(session.campaign?.id || "") !== campaignId) throw new Error("A campanha ativa mudou durante a operacao.");
    const trauma = campaign?.traumaCatalog?.find(entry => String(entry.id) === catalogId);
    if (!trauma) throw new Error("Trauma da biblioteca nao encontrado.");

    previousCatalog = JSON.parse(JSON.stringify(campaign.traumaCatalog || []));
    previousCharacterTraumas = new Map(campaign.characters.map(character => [
      String(character.id),
      JSON.parse(JSON.stringify(character.traumas || []))
    ]));
    campaign.traumaCatalog = campaign.traumaCatalog.filter(entry => String(entry.id) !== catalogId);
    const characterUpdates = [];
    campaign.characters.forEach(character => {
      const nextTraumas = (character.traumas || []).filter(entry => String(entry.catalogId) !== catalogId);
      if (nextTraumas.length !== (character.traumas || []).length) {
        character.traumas = nextTraumas;
        characterUpdates.push({ characterId: character.id, traumas: character.traumas });
      }
    });
    persistLocal();

    if (usingFirebase()) {
      await window.CDIFirebase.updateTraumaCatalogAndCharacters(
        campaign.id,
        campaign.traumaCatalog,
        characterUpdates
      );
      lastSavedCampaignJson = JSON.stringify(campaign);
    } else {
      save();
    }
    toast("Trauma excluido da biblioteca.");
  } catch (err) {
    console.error(err);
    if (campaign && previousCatalog && previousCharacterTraumas) {
      campaign.traumaCatalog = previousCatalog;
      campaign.characters.forEach(character => {
        const previous = previousCharacterTraumas.get(String(character.id));
        if (previous) character.traumas = previous;
      });
      persistLocal();
    }
    alert(firebaseErrorMessage(err));
  } finally {
    releaseSnapshotProtection?.();
    traumaMutations.delete(mutationKey);
    render();
  }
}

function traumaAssignmentModal(characterId = "", traumaCatalogId = "") {
  if (session.role !== "master" || !session.campaign) return;
  const characters = session.campaign.characters || [];
  const catalog = session.campaign.traumaCatalog || [];
  if (!characters.length) return alert("Crie um personagem antes de vincular um trauma.");
  if (!catalog.length) return alert("Cadastre um trauma na biblioteca antes de vinculá-lo.");

  const selectedCharacterId = characters.some(character => String(character.id) === String(characterId))
    ? String(characterId)
    : String(characters[0].id);
  const selectedTraumaId = catalog.some(trauma => String(trauma.id) === String(traumaCatalogId))
    ? String(traumaCatalogId)
    : String(catalog[0].id);
  const selectedCharacter = characters.find(character => String(character.id) === selectedCharacterId);
  const alreadyAssigned = selectedCharacter?.traumas?.some(trauma => String(trauma.catalogId) === selectedTraumaId);

  root.insertAdjacentHTML("beforeend", `
    <div id="traumaAssignmentModal" class="modal"><div class="modalbox trauma-modalbox trauma-assignment-modalbox">
      <h2>Vincular trauma</h2>
      <label>Personagem</label>
      <select id="traumaCharacter" required onchange="updateTraumaAssignmentAvailability()">
        ${characters.map(character => `<option value="${esc(character.id)}" ${String(character.id) === selectedCharacterId ? "selected" : ""}>${esc(character.name)} · ${esc(character.origin || "Sem origem")}</option>`).join("")}
      </select>
      <label>Trauma</label>
      <input id="traumaCatalogEntry" type="hidden" value="${esc(selectedTraumaId)}">
      <div class="trauma-picker-grid" role="listbox" aria-label="Traumas da biblioteca">
        ${catalog.map(trauma => `
          <button class="trauma-picker-option ${String(trauma.id) === selectedTraumaId ? "is-selected" : ""}" type="button" data-trauma-catalog-id="${esc(trauma.id)}" role="option" aria-selected="${String(trauma.id) === selectedTraumaId ? "true" : "false"}" onclick="selectTraumaForAssignment(${jsArg(trauma.id)})">
            ${trauma.image ? `<img ${imageSourceAttrs(trauma.image, "thumb")} alt="" loading="lazy" decoding="async">` : `<span aria-hidden="true">&#9888;</span>`}
            <strong>${esc(trauma.title)}</strong>
          </button>`).join("")}
      </div>
      <p id="traumaAssignmentStatus" class="trauma-assignment-status ${alreadyAssigned ? "is-warning" : ""}" aria-live="polite">${alreadyAssigned ? "Este trauma já está vinculado ao personagem." : ""}</p>
      <div class="modal-actions">
        <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
        <button id="applyTraumaButton" onclick="applyTrauma()" ${alreadyAssigned ? "disabled" : ""}>Vincular trauma</button>
      </div>
    </div></div>`);
}

function selectTraumaForAssignment(traumaCatalogId) {
  const selectedId = String(traumaCatalogId || "");
  if (!session.campaign?.traumaCatalog?.some(trauma => String(trauma.id) === selectedId)) return;
  const input = document.getElementById("traumaCatalogEntry");
  if (input) input.value = selectedId;
  document.querySelectorAll(".trauma-picker-option").forEach(option => {
    const selected = String(option.dataset.traumaCatalogId || "") === selectedId;
    option.classList.toggle("is-selected", selected);
    option.setAttribute("aria-selected", String(selected));
  });
  updateTraumaAssignmentAvailability();
}

function updateTraumaAssignmentAvailability() {
  const characterId = String(document.getElementById("traumaCharacter")?.value || "");
  const traumaCatalogId = String(document.getElementById("traumaCatalogEntry")?.value || "");
  const character = session.campaign?.characters?.find(entry => String(entry.id) === characterId);
  const alreadyAssigned = character?.traumas?.some(trauma => String(trauma.catalogId) === traumaCatalogId);
  const status = document.getElementById("traumaAssignmentStatus");
  const button = document.getElementById("applyTraumaButton");
  if (status) {
    status.textContent = alreadyAssigned ? "Este trauma já está vinculado ao personagem." : "";
    status.classList.toggle("is-warning", Boolean(alreadyAssigned));
  }
  if (button) button.disabled = Boolean(alreadyAssigned || traumaMutations.has(characterId));
}

async function applyTrauma() {
  if (session.role !== "master" || !session.campaign) return;
  const campaignId = String(session.campaign.id);
  const characterId = String(document.getElementById("traumaCharacter")?.value || "");
  const traumaCatalogId = String(document.getElementById("traumaCatalogEntry")?.value || "");
  const button = document.getElementById("applyTraumaButton");
  const initialCharacter = session.campaign.characters.find(entry => String(entry.id) === characterId);
  const initialCatalogTrauma = session.campaign.traumaCatalog?.find(entry => String(entry.id) === traumaCatalogId);

  if (!initialCharacter || !initialCatalogTrauma) return alert("Escolha o personagem e o trauma que será vinculado.");
  if (initialCharacter.traumas?.some(trauma => String(trauma.catalogId) === traumaCatalogId)) {
    return alert("Este trauma já está vinculado ao personagem.");
  }
  if (traumaMutations.has(characterId)) return;

  if (button) {
    button.disabled = true;
    button.textContent = "Vinculando...";
  }

  let campaign = null;
  let character = null;
  let previousTraumas = null;
  let previousEvent;
  let releaseSnapshotProtection = null;
  traumaMutations.add(characterId);
  try {
    releaseSnapshotProtection = protectCampaignFromSnapshots(campaignId);
    if (usingFirebase()) await flushBeforeAtomicCampaignMutation(campaignId);

    campaign = findCampaign(campaignId);
    if (String(session.campaign?.id || "") !== campaignId) throw new Error("A campanha ativa mudou durante a operacao.");
    character = campaign?.characters.find(entry => String(entry.id) === characterId);
    const catalogTrauma = campaign?.traumaCatalog?.find(entry => String(entry.id) === traumaCatalogId);
    if (!character || !catalogTrauma) throw new Error("Trauma da biblioteca nao encontrado.");
    if (character.traumas?.some(trauma => String(trauma.catalogId) === traumaCatalogId)) {
      throw new Error("Este trauma ja esta vinculado ao personagem.");
    }

    const acquiredAt = new Date().toISOString();
    const trauma = tabletop?.normalizeTrauma
      ? tabletop.normalizeTrauma({
        id: uid(),
        catalogId: catalogTrauma.id,
        title: catalogTrauma.title,
        image: catalogTrauma.image,
        acquiredAt
      }, uid)
      : {
        id: uid(),
        catalogId: catalogTrauma.id,
        title: catalogTrauma.title,
        description: "",
        image: catalogTrauma.image,
        acquiredAt
      };
    const event = {
      id: uid(),
      origin: String(character.origin || "Sem origem"),
      traumaTitle: trauma.title,
      createdAt: acquiredAt
    };
    previousTraumas = [...(character.traumas || [])];
    previousEvent = campaign.latestTraumaEvent;

    character.traumas = [trauma, ...previousTraumas];
    campaign.latestTraumaEvent = event;
    persistLocal();

    try {
      if (usingFirebase()) {
        await window.CDIFirebase.updateCharacterTraumas(campaign.id, character.id, character.traumas, event);
        lastSavedCampaignJson = JSON.stringify(campaign);
      }
    } catch (err) {
      character.traumas = previousTraumas;
      if (previousEvent === undefined) delete campaign.latestTraumaEvent;
      else campaign.latestTraumaEvent = previousEvent;
      persistLocal();
      throw err;
    }

    document.getElementById("traumaAssignmentModal")?.remove();
    traumaMutations.delete(characterId);
    render();
    announceTraumaEvent(event, campaign);
    toast("Trauma vinculado.");
  } catch (err) {
    console.error(err);
    if (character && previousTraumas) {
      character.traumas = previousTraumas;
      if (previousEvent === undefined) delete campaign.latestTraumaEvent;
      else campaign.latestTraumaEvent = previousEvent;
      persistLocal();
    }
    alert(firebaseErrorMessage(err));
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = "Vincular trauma";
    }
  } finally {
    releaseSnapshotProtection?.();
    traumaMutations.delete(characterId);
  }
}

async function removeCharacterTrauma(characterId, traumaId) {
  if (session.role !== "master" || !session.campaign) return;
  const campaignId = String(session.campaign.id);
  const normalizedCharacterId = String(characterId);
  const normalizedTraumaId = String(traumaId);
  const initialCharacter = session.campaign.characters.find(entry => String(entry.id) === normalizedCharacterId);
  const initialTrauma = initialCharacter?.traumas?.find(entry => String(entry.id) === normalizedTraumaId);
  if (!initialCharacter || !initialTrauma || traumaMutations.has(normalizedCharacterId)) return;
  if (!confirm(`Desvincular o trauma "${initialTrauma.title}" deste personagem?`)) return;

  let campaign = null;
  let character = null;
  let previousTraumas = null;
  let releaseSnapshotProtection = null;
  traumaMutations.add(normalizedCharacterId);
  try {
    releaseSnapshotProtection = protectCampaignFromSnapshots(campaignId);
    if (usingFirebase()) await flushBeforeAtomicCampaignMutation(campaignId);
    campaign = findCampaign(campaignId);
    if (String(session.campaign?.id || "") !== campaignId) throw new Error("A campanha ativa mudou durante a operacao.");
    character = campaign?.characters.find(entry => String(entry.id) === normalizedCharacterId);
    const trauma = character?.traumas?.find(entry => String(entry.id) === normalizedTraumaId);
    if (!character || !trauma) throw new Error("Vinculo de trauma nao encontrado.");
    previousTraumas = [...character.traumas];
    character.traumas = character.traumas.filter(entry => String(entry.id) !== normalizedTraumaId);
    persistLocal();
    render();

    if (usingFirebase()) {
      await window.CDIFirebase.updateCharacterTraumas(campaign.id, character.id, character.traumas);
      lastSavedCampaignJson = JSON.stringify(campaign);
    }
    toast("Trauma desvinculado.");
  } catch (err) {
    console.error(err);
    if (character && previousTraumas) {
      character.traumas = previousTraumas;
      persistLocal();
    }
    alert(firebaseErrorMessage(err));
  } finally {
    releaseSnapshotProtection?.();
    traumaMutations.delete(normalizedCharacterId);
    render();
  }
}

function chatMessageIdentity(message, campaign = session.campaign) {
  const authorId = String(message?.authorId || "");
  const rawAuthor = String(message?.author || "").trim();
  const isSystem = rawAuthor.toLowerCase() === "sistema";
  const isMaster = !isSystem && Boolean(authorId) && authorId === String(campaign?.masterId || "");
  let name = rawAuthor || (isMaster ? "Mestre" : "Jogador");

  if (isMaster) {
    const legacyMasterName = name.match(/^Mestre\s*\((.+)\)$/i);
    if (legacyMasterName) name = legacyMasterName[1].trim();
  } else if (!isSystem) {
    const player = campaign?.players?.find(entry => (
      String(entry.authUid || entry.id || "") === authorId
    ));
    if (player?.name) name = String(player.name).trim();
  }

  return { authorId, isMaster, isSystem, name: name || "Jogador" };
}

function chatAuthorColor(identity, campaign = session.campaign) {
  if (identity.isSystem) return "#aeb7b2";
  const participantIds = [
    String(campaign?.masterId || ""),
    ...(campaign?.players || []).map(player => String(player.authUid || player.id || ""))
  ].filter((id, index, ids) => id && ids.indexOf(id) === index);
  const participantIndex = participantIds.indexOf(identity.authorId);
  if (participantIndex >= 0) {
    if (participantIndex < CHAT_AUTHOR_COLORS.length) return CHAT_AUTHOR_COLORS[participantIndex];
    const hue = Math.round((participantIndex * 137.508 + 190) % 360);
    return `hsl(${hue} 72% 72%)`;
  }

  let hash = 0;
  const fallbackKey = identity.authorId || identity.name;
  for (let index = 0; index < fallbackKey.length; index += 1) {
    hash = ((hash << 5) - hash + fallbackKey.charCodeAt(index)) | 0;
  }
  return CHAT_AUTHOR_COLORS[Math.abs(hash) % CHAT_AUTHOR_COLORS.length];
}

function readLocalPrivateMessageStore() {
  try {
    const stored = JSON.parse(localStorage.getItem(PRIVATE_CHAT_STORAGE_KEY) || "{}");
    return stored && typeof stored === "object" ? stored : {};
  } catch (_err) {
    return {};
  }
}

function persistLocalPrivateMessages(campaignId, messages = privateMessages) {
  if (!campaignId) return;
  const stored = readLocalPrivateMessageStore();
  stored[campaignId] = messages.slice(0, 500);
  localStorage.setItem(PRIVATE_CHAT_STORAGE_KEY, JSON.stringify(stored));
}

function stopPrivateMessageSubscription(clearMessages = true) {
  if (unsubscribePrivateMessages) unsubscribePrivateMessages();
  unsubscribePrivateMessages = null;
  privateMessageWatchKey = "";
  lastPrivateMessagesJson = "";
  if (clearMessages) privateMessages = [];
}

function syncPrivateMessageSubscription() {
  const campaignId = String(session.campaign?.id || "");
  const userId = String(firebaseUser?.uid || window.CDIFirebase?.currentUser?.uid || "");
  const shouldWatch = Boolean(session.role && campaignId && session.view === "messages");
  if (!shouldWatch) {
    stopPrivateMessageSubscription(false);
    return;
  }

  if (activeChatChannel.campaignId !== campaignId) {
    activeChatChannel = { campaignId, type: "public", threadId: "" };
  }

  const watchKey = `${campaignId}:${session.role}:${usingFirebase() ? userId : "local"}`;
  if (watchKey === privateMessageWatchKey) return;
  stopPrivateMessageSubscription();
  privateMessageWatchKey = watchKey;

  if (!usingFirebase()) {
    privateMessages = readLocalPrivateMessageStore()[campaignId] || [];
    lastPrivateMessagesJson = JSON.stringify(privateMessages);
    return;
  }
  if (!userId || typeof window.CDIFirebase?.watchPrivateMessages !== "function") return;

  unsubscribePrivateMessages = window.CDIFirebase.watchPrivateMessages(
    campaignId,
    { role: session.role },
    messages => {
      const nextJson = JSON.stringify(messages || []);
      if (nextJson === lastPrivateMessagesJson) return;
      lastPrivateMessagesJson = nextJson;
      privateMessages = messages || [];
      if (session.view === "messages" && String(session.campaign?.id || "") === campaignId) {
        requestPassiveRender();
      }
    },
    err => {
      console.error(err);
      toast("Nao foi possivel acompanhar as mensagens particulares.");
    }
  );
}

function chatParticipants(campaign = session.campaign) {
  return (tabletop?.getControlledParticipants(campaign) || [])
    .slice()
    .sort((a, b) => String(a.player.id).localeCompare(String(b.player.id)));
}

function privateChatThreadId(firstPlayerId, secondPlayerId) {
  return [String(firstPlayerId), String(secondPlayerId)]
    .sort((a, b) => a.localeCompare(b))
    .join("::");
}

function makePrivateChatPair(first, second) {
  const participants = [first, second]
    .slice()
    .sort((a, b) => String(a.player.id).localeCompare(String(b.player.id)));
  return {
    threadId: privateChatThreadId(participants[0].player.id, participants[1].player.id),
    type: "players",
    participants
  };
}

function makeMasterPrivateChatPair(participant) {
  return {
    threadId: `master::${String(participant.player.id)}`,
    type: "master-player",
    participants: [participant]
  };
}

function availablePrivateChatPairs(campaign = session.campaign) {
  const participants = chatParticipants(campaign);
  if (session.role === "player") {
    const own = participants.find(entry => String(entry.player.id) === String(session.player?.id || ""));
    if (!own) return [];
    return [
      makeMasterPrivateChatPair(own),
      ...participants
        .filter(entry => String(entry.player.id) !== String(own.player.id))
        .map(entry => makePrivateChatPair(own, entry))
    ];
  }

  const pairs = participants.map(makeMasterPrivateChatPair);
  for (let firstIndex = 0; firstIndex < participants.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < participants.length; secondIndex += 1) {
      pairs.push(makePrivateChatPair(participants[firstIndex], participants[secondIndex]));
    }
  }
  return pairs;
}

function privateChatPairLabels(pair) {
  if (!pair) return [];
  if (pair.type === "master-player") {
    const character = pair.participants[0]?.character;
    return ["Mestre", String(character?.origin || character?.class || "Sem origem")];
  }
  return pair.participants.map(entry => String(entry.character.origin || entry.character.class || "Sem origem"));
}

function activePrivateChatPair(pairs = availablePrivateChatPairs()) {
  if (activeChatChannel.type !== "private") return null;
  return pairs.find(pair => pair.threadId === activeChatChannel.threadId) || null;
}

function chatContactVisual(character, extraClass = "") {
  const origin = String(character?.origin || character?.class || "Sem origem").trim() || "Sem origem";
  const image = gameCharacterImage(character);
  if (image) {
    return `<img class="chat-contact-portrait ${extraClass}" ${imageSourceAttrs(image, "thumb")} alt="Retrato de ${esc(origin)}" loading="lazy" decoding="async">`;
  }
  return `<span class="chat-contact-portrait chat-contact-fallback ${extraClass}" role="img" aria-label="Retrato de ${esc(origin)}">${esc(origin.slice(0, 1).toUpperCase() || "?")}</span>`;
}

function masterChatContactVisual() {
  return `<span class="chat-contact-portrait chat-master-contact" role="img" aria-label="Mestre da mesa">&#9819;</span>`;
}

function currentChatStateKey() {
  const campaignId = String(session.campaign?.id || activeChatChannel.campaignId || "");
  return activeChatChannel.type === "private"
    ? `${campaignId}:private:${activeChatChannel.threadId}`
    : `${campaignId}:public`;
}

function captureChatViewState() {
  const list = document.getElementById("chatList");
  if (list) {
    const key = String(list.dataset?.chatKey || currentChatStateKey());
    chatScrollStates.set(key, {
      scrollTop: Number(list.scrollTop) || 0,
      atBottom: list.scrollHeight - list.scrollTop - list.clientHeight <= 48
    });
  }
  const input = document.getElementById("msgText");
  if (input) chatDrafts.set(String(input.dataset?.chatKey || currentChatStateKey()), String(input.value || ""));
}

function updateChatJumpButton(list = document.getElementById("chatList")) {
  const button = document.getElementById("chatJumpLatest");
  if (!list || !button) return;
  const isAwayFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight > 48;
  button.classList.toggle("is-visible", isAwayFromBottom);
}

function restoreChatViewState() {
  const key = currentChatStateKey();
  const input = document.getElementById("msgText");
  if (input) input.value = chatDrafts.get(key) || "";
  setTimeout(() => {
    const list = document.getElementById("chatList");
    if (!list || String(list.dataset?.chatKey || "") !== key) return;
    const state = chatScrollStates.get(key);
    const forceLatest = chatForceScrollKeys.delete(key);
    if (forceLatest || !state || state.atBottom) list.scrollTop = list.scrollHeight;
    else list.scrollTop = Math.min(state.scrollTop, Math.max(0, list.scrollHeight - list.clientHeight));
    updateChatJumpButton(list);
  }, 0);
}

function rememberChatDraft(value) {
  chatDrafts.set(currentChatStateKey(), String(value || ""));
}

function onChatListScroll(list) {
  const key = String(list?.dataset?.chatKey || currentChatStateKey());
  chatScrollStates.set(key, {
    scrollTop: Number(list?.scrollTop) || 0,
    atBottom: Boolean(list) && list.scrollHeight - list.scrollTop - list.clientHeight <= 48
  });
  updateChatJumpButton(list);
}

function scrollChatToLatest(focusComposer = false) {
  const key = currentChatStateKey();
  chatForceScrollKeys.add(key);
  setTimeout(() => {
    const list = document.getElementById("chatList");
    if (list && String(list.dataset?.chatKey || "") === key) {
      list.scrollTop = list.scrollHeight;
      chatScrollStates.set(key, { scrollTop: list.scrollTop, atBottom: true });
      updateChatJumpButton(list);
    }
    if (focusComposer) document.getElementById("msgText")?.focus?.();
  }, 0);
}

function selectPublicChat() {
  activeChatChannel = {
    campaignId: String(session.campaign?.id || ""),
    type: "public",
    threadId: ""
  };
  chatForceScrollKeys.add(currentChatStateKey());
  render();
}

function selectPrivateChat(threadId) {
  const pair = availablePrivateChatPairs().find(entry => entry.threadId === String(threadId));
  if (!pair) return;
  activeChatChannel = {
    campaignId: String(session.campaign?.id || ""),
    type: "private",
    threadId: pair.threadId
  };
  chatForceScrollKeys.add(currentChatStateKey());
  render();
}

function isPrivateChatEnabled(threadId, campaign = session.campaign) {
  const settings = campaign?.chatSettings || {};
  const override = settings.privateThreads?.[String(threadId || "")];
  return typeof override === "boolean" ? override : settings.privateEnabled !== false;
}

function setChatAvailability(channel, enabled) {
  if (session.role !== "master" || !session.campaign || !["public", "private"].includes(channel)) return;
  session.campaign.chatSettings ??= { publicEnabled: true, privateEnabled: true, privateThreads: {}, updatedAt: null };
  session.campaign.chatSettings[`${channel}Enabled`] = Boolean(enabled);
  if (channel === "private") session.campaign.chatSettings.privateThreads = {};
  session.campaign.chatSettings.updatedAt = new Date().toISOString();
  save();
  render();
  toast(`${channel === "public" ? "Chat da mesa" : "Todas as conversas particulares"} ${enabled ? "habilitado" : "desabilitado"}.`);
}

function setPrivateChatAvailability(threadId, enabled) {
  if (session.role !== "master" || !session.campaign) return;
  const pair = availablePrivateChatPairs(session.campaign)
    .find(entry => entry.threadId === String(threadId));
  if (!pair) return;
  session.campaign.chatSettings ??= { publicEnabled: true, privateEnabled: true, privateThreads: {}, updatedAt: null };
  session.campaign.chatSettings.privateThreads ??= {};
  session.campaign.chatSettings.privateThreads[pair.threadId] = Boolean(enabled);
  session.campaign.chatSettings.updatedAt = new Date().toISOString();
  save();
  render();
  const origins = privateChatPairLabels(pair).join(" + ");
  toast(`Conversa ${origins} ${enabled ? "liberada" : "bloqueada"}.`);
}

function privateChatIdentity(message, campaign = session.campaign) {
  const authorId = String(message?.authorId || "");
  const isMaster = message?.authorRole === "master" || authorId === String(campaign?.masterId || "");
  return {
    authorId,
    isMaster,
    isSystem: false,
    name: isMaster ? "Mestre" : (String(message?.authorOrigin || "Sem origem").trim() || "Sem origem")
  };
}

function renderChatMessage(message, isPrivate, campaign) {
  const identity = isPrivate ? privateChatIdentity(message, campaign) : chatMessageIdentity(message, campaign);
  const color = chatAuthorColor(identity, campaign);
  return `
    <div class="chat-message ${identity.isMaster ? "is-master" : ""} ${identity.isSystem ? "is-system" : ""}" data-message-id="${esc(message.id)}">
      <p class="chat-message-line">
        <span class="chat-author" style="--chat-author-color:${color}">[${esc(identity.name)}${identity.isMaster ? ` <span class="chat-master-crown" title="Mestre da mesa" aria-label="Mestre da mesa">&#9819;</span>` : ""}]</span><span class="chat-colon">:</span>
        <span class="chat-message-text">${esc(message.text)}</span>
      </p>
      ${message.time ? `<time class="chat-message-time" ${message.sentAt ? `datetime="${esc(message.sentAt)}"` : ""}>${esc(message.time)}</time>` : ""}
    </div>`;
}

function chatContactButton(pair) {
  const isActive = activeChatChannel.type === "private" && activeChatChannel.threadId === pair.threadId;
  const isEnabled = isPrivateChatEnabled(pair.threadId);
  const accessIcon = isEnabled ? "&#128275;" : "&#128274;";
  const accessLabel = isEnabled ? "Conversa liberada" : "Conversa bloqueada";
  if (session.role === "player") {
    if (pair.type === "master-player") {
      return `
        <button class="chat-contact-card ${isActive ? "is-active" : ""} ${isEnabled ? "" : "is-locked"}" onclick="selectPrivateChat(${jsArg(pair.threadId)})" aria-label="Abrir conversa particular com o Mestre. ${accessLabel}">
          <span class="chat-contact-lock" title="${accessLabel}" aria-label="${accessLabel}">${accessIcon}</span>
          ${masterChatContactVisual()}
          <span class="chat-contact-origin">Mestre</span>
        </button>`;
    }
    const recipient = pair.participants.find(entry => String(entry.player.id) !== String(session.player?.id || ""));
    if (!recipient) return "";
    const origin = String(recipient.character.origin || recipient.character.class || "Sem origem");
    return `
      <button class="chat-contact-card ${isActive ? "is-active" : ""} ${isEnabled ? "" : "is-locked"}" onclick="selectPrivateChat(${jsArg(pair.threadId)})" aria-label="Abrir conversa particular com ${esc(origin)}. ${accessLabel}">
        <span class="chat-contact-lock" title="${accessLabel}" aria-label="${accessLabel}">${accessIcon}</span>
        ${chatContactVisual(recipient.character)}
        <span class="chat-contact-origin">${esc(origin)}</span>
      </button>`;
  }

  const origins = privateChatPairLabels(pair);
  const portraits = pair.type === "master-player"
    ? `${masterChatContactVisual()}${chatContactVisual(pair.participants[0].character)}`
    : pair.participants.map(entry => chatContactVisual(entry.character)).join("");
  return `
    <div class="chat-pair-control ${isEnabled ? "" : "is-locked"}">
      <button class="chat-contact-card chat-pair-card ${isActive ? "is-active" : ""}" onclick="selectPrivateChat(${jsArg(pair.threadId)})" aria-label="Abrir conversa particular entre ${esc(origins[0])} e ${esc(origins[1])}">
        <span class="chat-pair-portraits">${portraits}</span>
        <span class="chat-contact-origin">${esc(origins.join(" + "))}</span>
      </button>
      <button class="chat-thread-toggle ${isEnabled ? "is-enabled" : "is-locked"}" title="${isEnabled ? "Bloquear esta conversa" : "Liberar esta conversa"}" aria-label="${isEnabled ? "Bloquear" : "Liberar"} conversa entre ${esc(origins[0])} e ${esc(origins[1])}" onclick="setPrivateChatAvailability(${jsArg(pair.threadId)}, ${isEnabled ? "false" : "true"})">${accessIcon}</button>
    </div>`;
}

function messagesPage() {
  const campaign = session.campaign;
  campaign.messages ??= [];
  campaign.chatSettings ??= { publicEnabled: true, privateEnabled: true, privateThreads: {}, updatedAt: null };
  const pairs = availablePrivateChatPairs(campaign);
  let activePair = activePrivateChatPair(pairs);
  if (activeChatChannel.type === "private" && !activePair) {
    activeChatChannel = { campaignId: String(campaign.id), type: "public", threadId: "" };
  }
  activePair = activePrivateChatPair(pairs);

  const isPrivate = Boolean(activePair);
  const chatKey = currentChatStateKey();
  const messages = (isPrivate
    ? privateMessages.filter(message => String(message.threadId) === activePair.threadId)
    : campaign.messages
  ).slice(0, CHAT_MESSAGE_LIMIT).reverse();
  const channelEnabled = isPrivate
    ? isPrivateChatEnabled(activePair.threadId, campaign)
    : campaign.chatSettings.publicEnabled !== false;
  const conversationOrigins = privateChatPairLabels(activePair);
  const composerPlaceholder = channelEnabled
    ? (isPrivate ? "Escreva uma mensagem particular" : "Escreva uma mensagem para a mesa")
    : "Mensagens desabilitadas pelo Mestre";

  return `
    <div class="page-heading chat-page-heading">
      <div>
        <h2>💬 Mensagens</h2>
        <p class="muted">${isPrivate ? `Conversa particular · ${esc(conversationOrigins.join(" + "))}` : "Conversa da mesa"}</p>
      </div>
      ${session.role === "master" ? `
        <div class="chat-master-settings" aria-label="Controles de mensagens">
          <label class="chat-setting-toggle">
            <input type="checkbox" role="switch" ${campaign.chatSettings.publicEnabled !== false ? "checked" : ""} onchange="setChatAvailability('public', this.checked)">
            <span>Chat da mesa</span>
          </label>
          <label class="chat-setting-toggle">
            <input type="checkbox" role="switch" ${campaign.chatSettings.privateEnabled !== false ? "checked" : ""} onchange="setChatAvailability('private', this.checked)">
            <span>Todas particulares</span>
          </label>
        </div>` : ""}
    </div>

    <nav class="chat-channel-bar" aria-label="Conversas disponíveis">
      <button class="chat-public-channel ${!isPrivate ? "is-active" : ""}" onclick="selectPublicChat()">Mesa</button>
      <div class="chat-private-contacts">
        ${pairs.length
          ? pairs.map(chatContactButton).join("")
          : `<span class="chat-no-contacts muted">Nenhuma conversa particular disponível.</span>`}
      </div>
    </nav>

    <section class="chat-panel ${channelEnabled ? "" : "is-disabled"}">
      <header class="chat-conversation-heading">
        <strong>${isPrivate ? "Conversa particular" : "Chat da mesa"}</strong>
        <span>${messages.length}/${CHAT_MESSAGE_LIMIT} mensagens</span>
      </header>
      <div class="chat-list-wrap">
        <div id="chatList" class="chat-list" data-chat-key="${esc(chatKey)}" role="log" aria-live="polite" aria-relevant="additions text" onscroll="onChatListScroll(this)">
          ${messages.length === 0
            ? `<p class="chat-empty muted">${isPrivate ? "Nenhuma mensagem particular nesta conversa." : "Nenhuma mensagem enviada ainda."}</p>`
            : messages.map(message => renderChatMessage(message, isPrivate, campaign)).join("")}
        </div>
        <button id="chatJumpLatest" class="chat-jump-latest" title="Ir para as mensagens mais recentes" aria-label="Ir para as mensagens mais recentes" onclick="scrollChatToLatest(true)">↓</button>
      </div>
      ${channelEnabled ? "" : `<div class="chat-disabled-notice">${isPrivate ? "Esta conversa foi bloqueada pelo Mestre." : "Mensagens desabilitadas pelo Mestre."}</div>`}
      <div class="chat-compose">
        <input id="msgText" data-chat-key="${esc(chatKey)}" maxlength="500" autocomplete="off" placeholder="${esc(composerPlaceholder)}" ${channelEnabled ? "" : "disabled"} oninput="rememberChatDraft(this.value)" onkeydown="if(event.key==='Enter' && !event.isComposing) sendMessage()">
        <button id="chatSendButton" onclick="sendMessage()" ${chatSendInProgress || !channelEnabled ? "disabled" : ""}>${chatSendInProgress ? "Enviando..." : "Enviar"}</button>
      </div>
    </section>`;
}

async function sendPublicChatMessage(text) {
  const campaign = session.campaign;
  if (campaign.chatSettings?.publicEnabled === false) return toast("O chat da mesa esta desabilitado.");
  const now = new Date();
  const author = session.role === "master"
    ? (session.currentMaster?.name || firebaseProfile?.name || "Mestre")
    : (session.player?.name || firebaseProfile?.name || "Jogador");
  const message = {
    id: uid(),
    author,
    authorId: firebaseUser?.uid || session.currentMaster?.id || session.player?.id || "",
    playerId: session.role === "player" ? session.player?.id || "" : "",
    text,
    time: `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`,
    sentAt: now.toISOString()
  };

  campaign.messages ??= [];
  campaign.messages.unshift(message);
  if (campaign.messages.length > CHAT_MESSAGE_LIMIT) campaign.messages.length = CHAT_MESSAGE_LIMIT;
  persistLocal();

  if (!usingFirebase()) return true;
  try {
    await window.CDIFirebase.sendCampaignMessage(campaign.id, message);
    setSyncStatus("Online em tempo real");
    return true;
  } catch (err) {
    console.error(err);
    const activeCampaign = findCampaign(campaign.id) || campaign;
    activeCampaign.messages = (activeCampaign.messages || []).filter(entry => String(entry.id) !== message.id);
    persistLocal();
    setSyncStatus("Falha de sincronizacao");
    toast(firebaseErrorMessage(err));
    return false;
  }
}

async function sendPrivateChatMessage(text, pair) {
  const campaign = session.campaign;
  if (!pair || !isPrivateChatEnabled(pair.threadId, campaign)) {
    toast("Esta conversa particular esta bloqueada.");
    return false;
  }

  const now = new Date();
  const participants = pair.participants;
  const isMasterConversation = pair.type === "master-player";
  const ownParticipant = session.role === "player"
    ? participants.find(entry => String(entry.player.id) === String(session.player?.id || ""))
    : null;
  if (session.role === "player" && !ownParticipant) return false;

  const message = {
    id: uid(),
    threadId: pair.threadId,
    conversationType: isMasterConversation ? "master-player" : "players",
    participantPlayerIds: participants.map(entry => String(entry.player.id)),
    participantCharacterIds: participants.map(entry => String(entry.character.id)),
    participantAuthUids: isMasterConversation
      ? [String(campaign.masterId || ""), String(participants[0].player.authUid || "")]
      : participants.map(entry => String(entry.player.authUid || "")),
    participantOrigins: privateChatPairLabels(pair),
    authorId: firebaseUser?.uid || session.currentMaster?.id || session.player?.id || "",
    authorRole: session.role === "master" ? "master" : "player",
    authorPlayerId: ownParticipant?.player.id || "",
    authorCharacterId: ownParticipant?.character.id || "",
    authorOrigin: session.role === "master"
      ? "Mestre"
      : String(ownParticipant?.character.origin || ownParticipant?.character.class || "Sem origem"),
    text,
    time: `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`,
    sentAt: now.toISOString()
  };

  privateMessages = [message, ...privateMessages.filter(entry => String(entry.id) !== message.id)].slice(0, 500);
  lastPrivateMessagesJson = JSON.stringify(privateMessages);
  if (!usingFirebase()) {
    persistLocalPrivateMessages(campaign.id);
    return true;
  }

  try {
    await window.CDIFirebase.sendPrivateCampaignMessage(campaign.id, message);
    setSyncStatus("Online em tempo real");
    return true;
  } catch (err) {
    console.error(err);
    privateMessages = privateMessages.filter(entry => String(entry.id) !== message.id);
    lastPrivateMessagesJson = JSON.stringify(privateMessages);
    setSyncStatus("Falha de sincronizacao");
    toast(firebaseErrorMessage(err));
    return false;
  }
}

async function sendMessage() {
  const input = document.getElementById("msgText");
  const text = String(input?.value || "").trim().slice(0, 500);
  if (!text || chatSendInProgress || !session.campaign) return;
  const pairs = availablePrivateChatPairs();
  const pair = activePrivateChatPair(pairs);
  const isPrivate = Boolean(pair);
  const channelEnabled = isPrivate
    ? isPrivateChatEnabled(pair.threadId, session.campaign)
    : session.campaign.chatSettings?.publicEnabled !== false;
  if (!channelEnabled) return toast("As mensagens foram desabilitadas pelo Mestre.");

  const chatKey = currentChatStateKey();
  chatDrafts.delete(chatKey);
  chatForceScrollKeys.add(chatKey);
  if (input) input.value = "";
  chatSendInProgress = true;
  setSyncStatus("Sincronizando...");
  render();

  try {
    if (isPrivate) await sendPrivateChatMessage(text, pair);
    else await sendPublicChatMessage(text);
  } finally {
    chatSendInProgress = false;
    if (session.view === "messages") {
      render();
      scrollChatToLatest(true);
    }
  }
}

function formatLastSeen(value) {
  if (!value) return "Sem registro";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sem registro";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function boundedStat(value, maxValue) {
  const parsedValue = Math.max(0, Number(value) || 0);
  const max = Math.max(1, Number(maxValue) || parsedValue || 1);
  const current = Math.max(0, Math.min(max, parsedValue));
  return { current, max, percent: Math.round((current / max) * 100) };
}

function gameStatMeter(character, key, label, cssClass, canEdit) {
  const stat = boundedStat(character[key], character[`${key}Max`]);
  const decrease = canEdit
    ? `<button class="game-stat-step" title="Reduzir ${esc(label)}" aria-label="Reduzir ${esc(label)}" onclick="adjustGameCardStat(${jsArg(character.id)}, ${jsArg(key)}, -1)">-</button>`
    : "";
  const increase = canEdit
    ? `<button class="game-stat-step" title="Aumentar ${esc(label)}" aria-label="Aumentar ${esc(label)}" onclick="adjustGameCardStat(${jsArg(character.id)}, ${jsArg(key)}, 1)">+</button>`
    : "";

  return `
    <div class="game-stat-row">
      <div class="game-stat-head">
        <span>${esc(label)}</span>
        <strong>${stat.current}/${stat.max}</strong>
      </div>
      <div class="game-stat-track">
        ${decrease}
        <div class="bar game-stat-bar"><div class="fill ${cssClass}" style="width:${stat.percent}%"></div></div>
        ${increase}
      </div>
    </div>`;
}

function roomPage() {
  const c = session.campaign;
  const participants = tabletop?.getControlledParticipants(c) || [];
  const statusLabels = { online: "Online", away: "Ausente", offline: "Offline" };
  const claimedWithoutCharacter = c.players.filter(player => player.authUid && !player.characterId).length;
  const board = c.gameBoard || {};
  const previousBoard = c.previousGameBoard || {};
  const boardImage = String(board.image || "");
  const isMaster = session.role === "master";

  return `
    <div class="page-heading game-heading">
      <div>
        <h2>Game</h2>
        <p class="muted">${participants.length} carta${participants.length === 1 ? "" : "s"} de status em tempo real</p>
      </div>
      <div class="game-heading-actions">
        ${isMaster ? `
          <input id="gameBoardFile" class="visually-hidden" type="file" accept="image/*" onchange="uploadGameBoard(this.files)">
          <label class="button-label ${boardUploadInProgress ? "is-disabled" : ""}" for="gameBoardFile">${boardUploadInProgress ? "Enviando..." : "Trocar tabuleiro"}</label>
          ${previousBoard.image ? `<button class="secondary" onclick="restorePreviousGameBoard()" ${boardUploadInProgress ? "disabled" : ""}>Voltar ao tabuleiro anterior</button>` : ""}
        ` : ""}
        ${isMaster && claimedWithoutCharacter
          ? `<span class="notice-badge">${claimedWithoutCharacter} jogador${claimedWithoutCharacter === 1 ? "" : "es"} sem personagem</span>`
          : ""}
      </div>
    </div>

    <section class="game-board-area">
      <figure id="gameBoardStage" class="game-board-stage ${boardImage ? "" : "is-empty"}">
        ${boardImage
          ? `<div class="game-board-canvas">
              <img class="game-board-image" ${imageSourceAttrs(boardImage, "board")} alt="Tabuleiro compartilhado pelo Mestre" decoding="async" onclick="toggleGameBoardFullscreen()">
              ${participants.length ? `
                <section class="game-card-row" aria-label="Status dos personagens">
                  ${participants.map(({ character, presence }) => {
                    const label = String(character.origin || character.class || "Sem origem").trim() || "Sem origem";
                    const defense = Number(character.defense) || 10;
                    return `
                      <article class="game-character-card">
                        <div class="game-card-portrait-wrap">
                          ${entityVisual(gameCharacterImage(character), label, "game-card-portrait")}
                          <div class="game-card-topline">
                            <span class="game-card-label">${esc(label)}</span>
                            <span class="game-card-presence presence-${presence}" title="${esc(statusLabels[presence])}" aria-label="${esc(statusLabels[presence])}">
                              <span class="presence-dot"></span>
                            </span>
                          </div>
                          <div class="game-defense-pill" title="Defesa ${defense}" aria-label="Defesa ${defense}">
                            <span>DEF</span>
                            <strong>${defense}</strong>
                          </div>
                          <div class="game-card-body">
                            ${gameStatMeter(character, "health", "Saude", "health", isMaster)}
                            ${gameStatMeter(character, "sanity", "Sanidade", "sanity", isMaster)}
                          </div>
                        </div>
                      </article>`;
                  }).join("")}
                </section>` : ""}
            </div>`
          : `<div class="game-board-placeholder">
              <span aria-hidden="true">◎</span>
              <h3>${isMaster ? "Envie o tabuleiro da sessao" : "Aguardando o tabuleiro do Mestre"}</h3>
              <p class="muted">${isMaster ? "A imagem aparecera aqui para todos os jogadores." : "Quando o Mestre publicar uma imagem, ela aparece aqui em tempo real."}</p>
            </div>
          `}
      </figure>
    </section>`;
}

async function uploadGameBoard(fileList) {
  const file = Array.from(fileList || []).find(entry => String(entry.type || "").startsWith("image/"));
  if (!file || boardUploadInProgress || session.role !== "master" || !session.campaign) return;
  const campaignId = String(session.campaign.id);
  if (isUnmanagedImage(session.campaign.gameBoard?.image)) {
    return alert("Migre o tabuleiro atual para o Cloudinary nas Configuracoes antes de troca-lo. Assim ele podera ser restaurado sem perda.");
  }

  boardUploadInProgress = true;
  render();
  try {
    const image = await readImg(file, 2400, { campaignId, kind: "boards", entityId: `board-${uid()}` });
    if (!image) return alert("Nao foi possivel processar o tabuleiro selecionado.");
    const gameBoard = { image, updatedAt: new Date().toISOString() };
    applyImageAsset(gameBoard, image);
    const previousGameBoard = session.campaign.gameBoard?.image
      ? JSON.parse(JSON.stringify(session.campaign.gameBoard))
      : null;
    await commitCampaignMediaMutation(campaignId, {
      basePatch: { gameBoard, ...(previousGameBoard ? { previousGameBoard } : {}) },
      documents: [],
      cloudinaryUrls: [image, previousGameBoard?.image].filter(Boolean)
    });
    const campaign = findCampaign(campaignId);
    if (!campaign) throw new Error("Campanha nao encontrada depois do upload.");
    campaign.gameBoard = gameBoard;
    if (previousGameBoard) campaign.previousGameBoard = previousGameBoard;
    session.campaign = campaign;
    if (usingFirebase()) persistLocal();
    else save();
  } catch (err) {
    console.error(err);
    alert(firebaseErrorMessage(err));
  } finally {
    boardUploadInProgress = false;
    render();
  }
}

async function restorePreviousGameBoard() {
  if (boardUploadInProgress || session.role !== "master" || !session.campaign) return;
  const campaignId = String(session.campaign.id);
  const currentBoard = session.campaign.gameBoard || {};
  const previousBoard = session.campaign.previousGameBoard || {};
  if (!currentBoard.image || !previousBoard.image) return;
  if (isUnmanagedImage(currentBoard.image) || isUnmanagedImage(previousBoard.image)) {
    return alert("Migre os tabuleiros antigos para o Cloudinary antes de alternar entre eles.");
  }

  boardUploadInProgress = true;
  render();
  try {
    const gameBoard = JSON.parse(JSON.stringify(previousBoard));
    const previousGameBoard = JSON.parse(JSON.stringify(currentBoard));
    const switchedAt = new Date().toISOString();
    gameBoard.updatedAt = switchedAt;
    previousGameBoard.updatedAt = switchedAt;
    await commitCampaignMediaMutation(campaignId, {
      basePatch: { gameBoard, previousGameBoard },
      documents: [],
      cloudinaryUrls: [gameBoard.image, previousGameBoard.image]
    });
    const campaign = findCampaign(campaignId);
    if (!campaign) throw new Error("Campanha nao encontrada depois de restaurar o tabuleiro.");
    campaign.gameBoard = gameBoard;
    campaign.previousGameBoard = previousGameBoard;
    session.campaign = campaign;
    if (usingFirebase()) persistLocal();
    else save();
    toast("Tabuleiro anterior restaurado. O atual ficou disponivel para voltar.");
  } catch (err) {
    console.error(err);
    alert(firebaseErrorMessage(err));
  } finally {
    boardUploadInProgress = false;
    render();
  }
}

function vitalMutationKey(campaignId, characterId, key) {
  return `${String(campaignId)}:${String(characterId)}:${String(key)}`;
}

function applyConfirmedCharacterVital(campaignId, characterId, key, value) {
  const campaign = findCampaign(String(campaignId));
  const character = campaign?.characters?.find(entry => String(entry.id) === String(characterId));
  if (!character) return false;
  character[key] = Number(value);
  if (String(session.campaign?.id || "") === String(campaignId)) session.campaign = campaign;
  persistLocal();
  requestPassiveRender();
  return true;
}

function adjustCharacterVitalFromUi(characterId, key, delta) {
  const campaign = session.campaign;
  if (!campaign || !["health", "sanity"].includes(key)) return Promise.resolve(null);
  const normalizedCharacterId = String(characterId || "");
  const character = campaign.characters.find(entry => String(entry.id) === normalizedCharacterId);
  if (!character) return Promise.resolve(null);
  const max = Math.max(1, Number(character[`${key}Max`]) || Number(character[key]) || 1);
  const current = Math.max(0, Number(character[key]) || 0);
  const next = Math.max(0, Math.min(max, current + Number(delta || 0)));
  if (next === current) return Promise.resolve({ characterId: normalizedCharacterId, key, value: current, max });

  character[key] = next;
  if (!usingFirebase()) {
    save();
    render();
    return Promise.resolve({ characterId: normalizedCharacterId, key, value: next, max });
  }

  const campaignId = String(campaign.id);
  const mutationKey = vitalMutationKey(campaignId, normalizedCharacterId, key);
  let mutation = vitalMutationStates.get(mutationKey);
  if (!mutation) {
    mutation = { promise: Promise.resolve(), revision: 0, confirmedValue: current };
    vitalMutationStates.set(mutationKey, mutation);
  }
  const revision = ++mutation.revision;
  const releaseSnapshotProtection = protectCampaignFromSnapshots(campaignId);
  persistLocal();
  render();
  setSyncStatus("Sincronizando...");

  const operation = mutation.promise
    .catch(() => null)
    .then(async () => {
      await flushBeforeAtomicCampaignMutation(campaignId);
      if (typeof window.CDIFirebase?.adjustCharacterVital !== "function") {
        throw new Error("O servico de atualizacao de saude e sanidade ainda nao esta disponivel.");
      }
      const result = await window.CDIFirebase.adjustCharacterVital(
        campaignId,
        normalizedCharacterId,
        key,
        delta
      );
      mutation.confirmedValue = Number(result?.value);
      if (!Number.isFinite(mutation.confirmedValue)) mutation.confirmedValue = next;
      if (revision === mutation.revision) {
        applyConfirmedCharacterVital(campaignId, normalizedCharacterId, key, mutation.confirmedValue);
        setSyncStatus("Online em tempo real");
      }
      return result;
    })
    .catch(error => {
      if (revision === mutation.revision) {
        applyConfirmedCharacterVital(campaignId, normalizedCharacterId, key, mutation.confirmedValue);
        setSyncStatus("Falha de sincronizacao");
        toast("Nao foi possivel manter a alteracao no Firebase. O valor confirmado foi restaurado.");
      }
      throw error;
    })
    .finally(() => {
      releaseSnapshotProtection();
      if (revision === mutation.revision) vitalMutationStates.delete(mutationKey);
    });
  mutation.promise = operation.catch(() => null);
  return operation;
}

function adjustGameCardStat(characterId, key, delta) {
  if (session.role !== "master" || !session.campaign) return;
  if (!["health", "sanity"].includes(key)) return;
  return adjustCharacterVitalFromUi(characterId, key, delta);
}

function prepareOriginalForFullscreen(stage) {
  const image = stage?.querySelector?.("img");
  const original = String(image?.dataset?.originalImage || "");
  if (!image || !original || image.dataset.standardImage) return;
  image.dataset.standardImage = image.getAttribute("src") || image.src || "";
  fullscreenImageErrorHandlers.set(image, image.onerror || null);
  image.onerror = () => restoreImageAfterFullscreen(stage);
  image.src = original;
}

function restoreImageAfterFullscreen(stage) {
  const image = stage?.querySelector?.("img[data-standard-image]");
  const standard = String(image?.dataset?.standardImage || "");
  if (!image || !standard) return;
  if (fullscreenImageErrorHandlers.has(image)) {
    image.onerror = fullscreenImageErrorHandlers.get(image);
    fullscreenImageErrorHandlers.delete(image);
  }
  delete image.dataset.standardImage;
  image.src = standard;
}

function toggleImageStageFullscreen(stage) {
  if (!stage) return;
  const exiting = Boolean(document.fullscreenElement);
  if (!exiting) prepareOriginalForFullscreen(stage);
  const action = exiting ? document.exitFullscreen?.() : stage.requestFullscreen?.();
  if (!action?.catch) {
    if (exiting) restoreImageAfterFullscreen(stage);
    return;
  }
  action
    .catch(() => {
      restoreImageAfterFullscreen(stage);
      toast("O navegador nao permitiu abrir em tela cheia.");
    })
    .finally(() => {
      if (!document.fullscreenElement) restoreImageAfterFullscreen(stage);
    });
}

function toggleGameBoardFullscreen() {
  toggleImageStageFullscreen(document.getElementById("gameBoardStage"));
}

function openMediaOutboxDb() {
  return new Promise(resolve => {
    const indexedDb = window.indexedDB;
    if (!indexedDb) return resolve(null);
    let request;
    let settled = false;
    const finish = value => {
      if (settled) {
        try { value?.close?.(); } catch {}
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), 5000);
    try {
      request = indexedDb.open(MEDIA_OUTBOX_DB_NAME, 3);
    } catch (err) {
      console.warn("Nao foi possivel abrir a fila local de midia.", err);
      finish(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LEGACY_MEDIA_OUTBOX_STORE)) {
        db.createObjectStore(LEGACY_MEDIA_OUTBOX_STORE, { keyPath: "campaignId" });
      }
      if (!db.objectStoreNames.contains(MEDIA_OUTBOX_STORE)) {
        db.createObjectStore(MEDIA_OUTBOX_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(CAMPAIGN_SAVE_OUTBOX_STORE)) {
        db.createObjectStore(CAMPAIGN_SAVE_OUTBOX_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => finish(request.result);
    request.onblocked = () => {
      console.warn("A fila local de midia esta bloqueada por outra aba.");
      finish(null);
    };
    request.onerror = () => {
      console.warn("Nao foi possivel abrir a fila local de cenas.", request.error);
      finish(null);
    };
  });
}

async function writePendingSceneCommit(campaignId, scenes, liveScene = null) {
  const ownerUid = String(window.CDIFirebase?.currentUser?.uid || firebaseUser?.uid || "local");
  const record = {
    key: campaignSaveOutboxKey(ownerUid, campaignId),
    campaignId: String(campaignId),
    ownerUid,
    scenes: JSON.parse(JSON.stringify(scenes || [])),
    liveScene: liveScene ? JSON.parse(JSON.stringify(liveScene)) : null,
    createdAt: new Date().toISOString()
  };
  const db = await openMediaOutboxDb();
  if (!db) throw new Error("O navegador nao disponibilizou a fila duravel necessaria para enviar cenas com seguranca.");
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(MEDIA_OUTBOX_STORE, "readwrite");
      transaction.objectStore(MEDIA_OUTBOX_STORE).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("A fila local abortou o checkpoint das cenas."));
    });
  } finally {
    db.close();
  }
  pendingSceneCommits.set(record.campaignId, record);
}

async function assertSceneOutboxAvailable() {
  const db = await openMediaOutboxDb();
  if (!db) throw new Error("O navegador nao disponibilizou a fila duravel necessaria para enviar cenas com seguranca.");
  const ownerUid = String(window.CDIFirebase?.currentUser?.uid || firebaseUser?.uid || "local");
  const probeKey = `__probe__:${ownerUid}:${uid()}`;
  const transact = operation => new Promise((resolve, reject) => {
    const transaction = db.transaction(MEDIA_OUTBOX_STORE, "readwrite");
    operation(transaction.objectStore(MEDIA_OUTBOX_STORE));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("A fila local abortou o teste de gravacao das cenas."));
  });
  try {
    await transact(store => store.put({
      key: probeKey,
      campaignId: "__probe__",
      ownerUid,
      scenes: [],
      liveScene: null,
      createdAt: new Date().toISOString()
    }));
    await transact(store => store.delete(probeKey));
  } finally {
    db.close();
  }
}

async function readPendingSceneCommit(campaignId) {
  const normalizedId = String(campaignId || "");
  if (pendingSceneCommits.has(normalizedId)) return pendingSceneCommits.get(normalizedId);
  const db = await openMediaOutboxDb();
  if (!db) return null;
  let record;
  const expectedOwner = String(window.CDIFirebase?.currentUser?.uid || firebaseUser?.uid || "local");
  const readRecord = (storeName, key) => new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error || new Error("A fila local abortou a leitura das cenas."));
  });
  try {
    record = await readRecord(MEDIA_OUTBOX_STORE, campaignSaveOutboxKey(expectedOwner, normalizedId));
    if (!record) record = await readRecord(LEGACY_MEDIA_OUTBOX_STORE, normalizedId);
  } finally {
    db.close();
  }
  if (record && record.ownerUid && String(record.ownerUid) !== expectedOwner) return null;
  if (record) {
    if (!Array.isArray(record.scenes) || record.scenes.some(scene => !scene?.id || !isCloudinaryImage(scene.image))) {
      throw new Error("A fila local de cenas esta corrompida e precisa ser descartada antes de continuar.");
    }
    pendingSceneCommits.set(normalizedId, record);
  }
  return record;
}

async function clearPendingSceneCommit(campaignId) {
  const normalizedId = String(campaignId || "");
  const db = await openMediaOutboxDb();
  if (!db) throw new Error("Nao foi possivel confirmar a limpeza da fila local de cenas.");
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction([MEDIA_OUTBOX_STORE, LEGACY_MEDIA_OUTBOX_STORE], "readwrite");
      const ownerUid = String(window.CDIFirebase?.currentUser?.uid || firebaseUser?.uid || "local");
      transaction.objectStore(MEDIA_OUTBOX_STORE).delete(campaignSaveOutboxKey(ownerUid, normalizedId));
      transaction.objectStore(LEGACY_MEDIA_OUTBOX_STORE).delete(normalizedId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("A fila local abortou a limpeza das cenas."));
    });
  } finally {
    db.close();
  }
  pendingSceneCommits.delete(normalizedId);
}

function ensureSceneOutboxLoaded(campaignId) {
  const normalizedId = String(campaignId || "");
  if (!normalizedId || pendingSceneCommits.has(normalizedId) || sceneOutboxLoads.has(normalizedId)) return;
  sceneOutboxLoads.add(normalizedId);
  setTimeout(async () => {
    try {
      const pending = await readPendingSceneCommit(normalizedId);
      sceneOutboxErrors.delete(normalizedId);
      if (pending && session.view === "scenes" && String(session.campaign?.id) === normalizedId) render();
    } catch (err) {
      console.error(err);
      sceneOutboxErrors.set(normalizedId, firebaseErrorMessage(err));
      toast(firebaseErrorMessage(err));
      if (session.view === "scenes" && String(session.campaign?.id) === normalizedId) render();
    }
  }, 0);
}

function applySceneImageAsset(scene, image) {
  applyImageAsset(scene, image);
  const metadata = imageMetadataFor(image);
  if (!metadata) return scene;
  scene.imagePublicId = metadata.publicId || undefined;
  scene.imageAssetId = metadata.assetId || undefined;
  scene.imageFormat = metadata.format || undefined;
  scene.imageWidth = metadata.width || undefined;
  scene.imageHeight = metadata.height || undefined;
  scene.imageBytes = metadata.bytes || undefined;
  return scene;
}

function cloneSceneDeck(scenes) {
  return JSON.parse(JSON.stringify(scenes || []));
}

function liveSceneForDeck(campaign, scenes, sceneId, active = true) {
  const working = { ...campaign, scenes: cloneSceneDeck(scenes), liveScene: { ...(campaign.liveScene || {}) } };
  if (!active) tabletop.setScenePresentationActive(working, false);
  else tabletop.publishScene(working, String(sceneId), { active: true });
  return working.liveScene;
}

async function commitSceneDeck(campaignId, scenes, options = {}) {
  const normalizedId = String(campaignId || "");
  const nextScenes = cloneSceneDeck(scenes);
  if (nextScenes.length > MAX_ACTIVE_SCENES) {
    throw new Error(`O roteiro aceita no maximo ${MAX_ACTIVE_SCENES} cenas ativas. Mova cenas para a lixeira antes de adicionar outras.`);
  }
  const hasLiveScene = Object.prototype.hasOwnProperty.call(options, "liveScene");
  if (nextScenes.some(scene => isUnmanagedImage(scene.image)) || (hasLiveScene && isUnmanagedImage(options.liveScene?.image))) {
    throw new Error("Existem cenas fora do Cloudinary. Migre as imagens nas Configuracoes antes de alterar o roteiro.");
  }

  const releaseSnapshotProtection = usingFirebase() ? protectCampaignFromSnapshots(normalizedId) : null;
  try {
    if (usingFirebase()) {
      await flushBeforeAtomicCampaignMutation(normalizedId);
      const result = await window.CDIFirebase.updateCampaignScenes(normalizedId, nextScenes, {
        ...(hasLiveScene ? { liveScene: options.liveScene } : {})
      });
      const current = findCampaign(normalizedId);
      if (current) {
        current.scenes = cloneSceneDeck(result?.scenes || nextScenes);
        if (hasLiveScene) current.liveScene = { ...(result?.liveScene || options.liveScene) };
        if (String(session.campaign?.id) === normalizedId) session.campaign = current;
        persistLocal();
        lastSavedCampaignJson = JSON.stringify(current);
      }
      return current;
    }

    const current = findCampaign(normalizedId);
    if (!current) throw new Error("Campanha nao encontrada.");
    current.scenes = nextScenes;
    if (hasLiveScene) current.liveScene = { ...options.liveScene };
    if (String(session.campaign?.id) === normalizedId) session.campaign = current;
    if (!save()) throw new Error("Nao foi possivel confirmar as cenas no armazenamento local.");
    return current;
  } finally {
    releaseSnapshotProtection?.();
  }
}

async function commitLiveScene(campaignId, liveScene) {
  const normalizedId = String(campaignId || "");
  if (isUnmanagedImage(liveScene?.image)) {
    throw new Error("Esta cena ainda nao esta no Cloudinary. Migre as imagens nas Configuracoes antes de transmitir.");
  }
  const releaseSnapshotProtection = usingFirebase() ? protectCampaignFromSnapshots(normalizedId) : null;
  try {
    if (usingFirebase()) await flushBeforeAtomicCampaignMutation(normalizedId);
    const committed = usingFirebase()
      ? await window.CDIFirebase.updateLiveScene(normalizedId, liveScene)
      : { ...liveScene };
    const current = findCampaign(normalizedId);
    if (!current) throw new Error("Campanha nao encontrada.");
    current.liveScene = { ...committed };
    if (String(session.campaign?.id) === normalizedId) session.campaign = current;
    if (usingFirebase()) {
      persistLocal();
      lastSavedCampaignJson = JSON.stringify(current);
    } else {
      save();
    }
    return current.liveScene;
  } finally {
    releaseSnapshotProtection?.();
  }
}

function updateSceneUploadProgress() {
  const text = document.getElementById("sceneUploadProgressText");
  const bar = document.getElementById("sceneUploadProgressBar");
  const done = sceneUploadProgress.completed + sceneUploadProgress.failed;
  if (text) text.textContent = sceneUploadProgress.phase || `Enviando ${done} de ${sceneUploadProgress.total}`;
  if (bar) bar.style.width = `${sceneUploadProgress.total ? Math.round((done / sceneUploadProgress.total) * 100) : 0}%`;
}

function preloadAdjacentSceneImages(campaign = session.campaign) {
  if (!campaign?.scenes?.length || session.view !== "scenes" || session.role !== "master") return;
  const selected = selectedMasterScene(campaign);
  const index = campaign.scenes.findIndex(scene => scene.id === selected?.id);
  [campaign.scenes[index - 1], campaign.scenes[index + 1]].filter(Boolean).forEach(scene => {
    const image = new Image();
    image.decoding = "async";
    const delivered = cloudinaryDeliveryUrl(scene.image, "stage");
    if (delivered !== scene.image) {
      image.onerror = () => {
        image.onerror = null;
        image.src = scene.image;
      };
    }
    image.src = delivered;
  });
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function sceneUploadConcurrency(files) {
  const largestFile = Math.max(0, ...Array.from(files || [], file => Number(file?.size || 0)));
  if (largestFile > 16 * 1024 * 1024) return 1;
  if (largestFile > 8 * 1024 * 1024) return Math.min(2, IMAGE_UPLOAD_CONCURRENCY);
  return IMAGE_UPLOAD_CONCURRENCY;
}

function selectedMasterScene(campaign = session.campaign) {
  if (!campaign) return null;
  campaign.scenes ??= [];
  const rememberedId = selectedSceneIds.get(campaign.id);
  const scene = campaign.scenes.find(entry => entry.id === rememberedId)
    || campaign.scenes.find(entry => entry.id === campaign.liveScene?.sceneId)
    || campaign.scenes[0]
    || null;
  if (scene) selectedSceneIds.set(campaign.id, scene.id);
  return scene;
}

function sceneTrashSection(campaign, sceneBusy) {
  const trashedScenes = campaign.sceneTrash || [];
  if (!trashedScenes.length) return "";
  return `
    <details class="scene-trash">
      <summary>Lixeira privada (${trashedScenes.length})</summary>
      <p class="muted">Somente o Mestre ve esta area. Restaurar nao envia a imagem novamente e preserva titulo, legenda e notas.</p>
      <div class="scene-trash-grid">
        ${trashedScenes.map(scene => `
          <article class="scene-trash-item">
            <img ${imageSourceAttrs(scene.image, "thumb")} alt="" loading="lazy" decoding="async" width="164" height="104">
            <div>
              <strong>${esc(scene.title || "Cena sem titulo")}</strong>
              <button class="secondary" onclick="restoreSceneFromTrash(${jsArg(scene.id)})" ${sceneBusy ? "disabled" : ""}>Restaurar</button>
            </div>
          </article>`).join("")}
      </div>
    </details>`;
}

function masterScenesPage() {
  const campaign = session.campaign;
  const scenes = campaign.scenes || [];
  ensureSceneOutboxLoaded(campaign.id);
  const selected = selectedMasterScene(campaign);
  const selectedIndex = selected ? scenes.findIndex(scene => scene.id === selected.id) : -1;
  const isPresenting = Boolean(campaign.liveScene?.active);
  const pendingCommit = pendingSceneCommits.get(String(campaign.id));
  const outboxError = sceneOutboxErrors.get(String(campaign.id));
  const sceneOperationBusy = sceneUploadInProgress || sceneMutationInProgress;
  const sceneBusy = sceneOperationBusy || Boolean(pendingCommit) || Boolean(outboxError);
  const legacySceneCount = scenes.filter(scene => isUnmanagedImage(scene.image)).length;

  return `
    <div class="page-heading scenes-heading">
      <div>
        <h2>Cenas</h2>
        <p class="muted">${scenes.length} de ${MAX_ACTIVE_SCENES} imagens ativas no roteiro</p>
      </div>
      <div class="scene-heading-actions">
        <input id="sceneImageFiles" class="visually-hidden" type="file" accept="image/*" multiple onchange="addSceneImages(this.files)" ${sceneBusy ? "disabled" : ""}>
        <label class="button-label ${sceneBusy ? "is-disabled" : ""}" for="sceneImageFiles">${sceneUploadInProgress ? "Enviando..." : "Adicionar imagens"}</label>
      </div>
    </div>

    ${legacySceneCount ? `
      <div class="scene-notice scene-notice-warning">
        <div><strong>${legacySceneCount} cena${legacySceneCount === 1 ? " precisa" : "s precisam"} ser migrada${legacySceneCount === 1 ? "" : "s"}</strong><span>As imagens continuam preservadas, mas a transmissao fica bloqueada ate a migracao para o Cloudinary.</span></div>
        <button class="secondary" onclick="session.view='settings';render()">Abrir migracao</button>
      </div>` : ""}

    ${sceneUploadInProgress ? `
      <div class="scene-upload-status" role="status" aria-live="polite">
        <div class="scene-upload-status-row"><strong id="sceneUploadProgressText">${esc(sceneUploadProgress.phase || `Enviando 0 de ${sceneUploadProgress.total}`)}</strong><span>${sceneUploadProgress.failed ? `${sceneUploadProgress.failed} falha${sceneUploadProgress.failed === 1 ? "" : "s"}` : "Cloudinary"}</span></div>
        <div class="scene-upload-track"><span id="sceneUploadProgressBar" style="width:${sceneUploadProgress.total ? Math.round(((sceneUploadProgress.completed + sceneUploadProgress.failed) / sceneUploadProgress.total) * 100) : 0}%"></span></div>
      </div>` : ""}

    ${pendingCommit && !sceneUploadInProgress ? `
      <div class="scene-notice">
        <div><strong>${pendingCommit.scenes.length} cena${pendingCommit.scenes.length === 1 ? " pronta" : "s prontas"} para sincronizar</strong><span>Os uploads ja estao no Cloudinary; falta apenas confirmar o roteiro no Firebase.</span></div>
        <button onclick="retryPendingSceneCommit()" ${sceneOperationBusy ? "disabled" : ""}>Tentar novamente</button>
      </div>` : ""}

    ${outboxError ? `
      <div class="scene-notice scene-notice-warning">
        <div><strong>Fila local de cenas indisponivel</strong><span>${esc(outboxError)}</span></div>
        <button class="danger" onclick="discardSceneOutbox()" ${sceneOperationBusy ? "disabled" : ""}>Descartar fila corrompida</button>
      </div>` : ""}

    ${selected ? `
      <div class="scene-workspace">
        <section class="scene-presentation-panel">
          <figure id="sceneStage" class="scene-stage">
            <img ${imageSourceAttrs(selected.image, "stage")} alt="${esc(selected.title)}" decoding="async" fetchpriority="high">
          </figure>
          <div class="scene-controls" aria-label="Controles da apresentacao">
            <button class="icon-button secondary" title="Cena anterior" aria-label="Cena anterior" onclick="stepMasterScene(-1)" ${sceneBusy || selectedIndex <= 0 ? "disabled" : ""}>←</button>
            <span class="scene-counter">${selectedIndex + 1} / ${scenes.length}</span>
            <button class="icon-button secondary" title="Proxima cena" aria-label="Proxima cena" onclick="stepMasterScene(1)" ${sceneBusy || selectedIndex >= scenes.length - 1 ? "disabled" : ""}>→</button>
            <button onclick="toggleScenePresentation()" ${sceneBusy || legacySceneCount ? "disabled" : ""}>${isPresenting ? "Ocultar dos jogadores" : "Iniciar apresentacao"}</button>
            <button class="icon-button secondary" title="Tela cheia" aria-label="Tela cheia" onclick="toggleSceneFullscreen()">⛶</button>
            ${isPresenting ? `<span class="status-chip status-online"><span class="presence-dot"></span>Ao vivo</span>` : `<span class="status-chip status-offline">Oculta</span>`}
          </div>

          <div class="scene-editor">
            <input id="sceneEditorId" type="hidden" value="${esc(selected.id)}">
            <label>Titulo publico</label><input id="sceneTitle" value="${esc(selected.title)}">
            <label>Legenda publica</label><textarea id="sceneCaption">${esc(selected.caption)}</textarea>
            <label>Notas privadas do Mestre</label><textarea id="sceneMasterNotes">${esc(selected.masterNotes)}</textarea>
            <div class="row-actions"><button onclick="saveSceneDetails()" ${sceneBusy ? "disabled" : ""}>Salvar cena</button></div>
          </div>
        </section>

        <aside class="scene-deck" aria-label="Roteiro de cenas">
          <div class="scene-deck-heading"><h3>Roteiro</h3><span class="muted">${scenes.length}</span></div>
          <div class="scene-deck-list">
            ${scenes.map((scene, index) => `
              <article class="scene-deck-item ${scene.id === selected.id ? "is-selected" : ""} ${campaign.liveScene?.active && scene.id === campaign.liveScene.sceneId ? "is-live" : ""}" onclick="${sceneBusy ? "" : `selectMasterScene(${jsArg(scene.id)})`}">
                <img ${imageSourceAttrs(scene.image, "thumb")} alt="" loading="lazy" decoding="async" width="164" height="104">
                <div class="scene-deck-info">
                  <strong>${esc(scene.title)}</strong>
                  <span>${index + 1} / ${scenes.length}</span>
                </div>
                <div class="scene-deck-actions">
                  <button class="icon-button secondary" title="Mover para cima" aria-label="Mover para cima" onclick="event.stopPropagation();moveScene(${jsArg(scene.id)}, -1)" ${sceneBusy || index === 0 ? "disabled" : ""}>↑</button>
                  <button class="icon-button secondary" title="Mover para baixo" aria-label="Mover para baixo" onclick="event.stopPropagation();moveScene(${jsArg(scene.id)}, 1)" ${sceneBusy || index === scenes.length - 1 ? "disabled" : ""}>↓</button>
                  <button class="icon-button danger" title="Excluir cena" aria-label="Excluir cena" onclick="event.stopPropagation();deleteScene(${jsArg(scene.id)})" ${sceneBusy ? "disabled" : ""}>×</button>
                </div>
              </article>`).join("")}
          </div>
        </aside>
      </div>` : `
      <div class="scene-empty-state">
        <h3>Nenhuma cena adicionada</h3>
        <p class="muted">Adicione uma ou mais imagens para montar o roteiro.</p>
      </div>`}
    ${sceneTrashSection(campaign, sceneBusy)}`;
}

function playerScenesPage() {
  const live = session.campaign.liveScene || {};
  if (!live.active || !live.image) {
    return `
      <div class="page-heading"><div><h2>Cenas</h2><p class="muted">A apresentacao esta oculta.</p></div></div>
      <div class="scene-empty-state scene-waiting-state">
        <h3>Aguardando o Mestre</h3>
        <p class="muted">A cena aparecera aqui quando a apresentacao comecar.</p>
      </div>`;
  }

  return `
    <div class="page-heading">
      <div><h2>Cenas</h2><p class="muted">Apresentacao ao vivo</p></div>
      <span class="status-chip status-online"><span class="presence-dot"></span>Ao vivo</span>
    </div>
    <section class="player-scene-view">
      <figure id="sceneStage" class="scene-stage player-scene-stage" onclick="toggleSceneFullscreen()">
        <img ${imageSourceAttrs(live.image, "stage")} alt="Cena apresentada pelo Mestre" decoding="async" fetchpriority="high">
      </figure>
      <div class="player-scene-caption player-scene-toolbar">
        <div class="scene-player-actions">
          ${live.total ? `<span class="scene-counter">${Math.min(live.total, Number(live.index || 0) + 1)} / ${live.total}</span>` : ""}
          <button class="icon-button secondary" title="Tela cheia" aria-label="Tela cheia" onclick="event.stopPropagation();toggleSceneFullscreen()">⛶</button>
        </div>
      </div>
    </section>`;
}

async function addSceneImages(fileList) {
  const files = Array.from(fileList || []).filter(file => String(file.type || "").startsWith("image/"));
  if (!files.length || sceneUploadInProgress || sceneMutationInProgress || !session.campaign) return;
  const campaignId = String(session.campaign.id);
  const remainingSlots = Math.max(0, MAX_ACTIVE_SCENES - (session.campaign.scenes || []).length);
  if (files.length > remainingSlots) {
    return alert(`Voce pode adicionar ate ${remainingSlots} cena${remainingSlots === 1 ? "" : "s"} agora. O limite seguro e ${MAX_ACTIVE_SCENES} cenas ativas; mova as demais para a lixeira.`);
  }
  if ((session.campaign.scenes || []).some(scene => isUnmanagedImage(scene.image))) {
    return alert("Migre as cenas antigas para o Cloudinary nas Configuracoes antes de adicionar um novo lote.");
  }
  let pendingCommit;
  try {
    pendingCommit = await readPendingSceneCommit(campaignId);
  } catch (err) {
    sceneOutboxErrors.set(campaignId, firebaseErrorMessage(err));
    render();
    return alert(firebaseErrorMessage(err));
  }
  if (pendingCommit?.scenes?.length) {
    if (String(session.campaign?.id) === campaignId) render();
    return alert("Ja existem cenas enviadas aguardando sincronizacao. Use 'Tentar novamente' antes de adicionar outro lote.");
  }
  if (sceneUploadInProgress || sceneMutationInProgress || String(session.campaign?.id) !== campaignId) return;
  try {
    await assertSceneOutboxAvailable();
  } catch (err) {
    return alert(firebaseErrorMessage(err));
  }
  sceneUploadInProgress = true;
  sceneUploadProgress = { total: files.length, completed: 0, failed: 0, phase: `Preparando ${files.length} imagens...` };
  render();
  const uploadedScenes = new Array(files.length);
  let outboxWrite = Promise.resolve();
  let checkpointError = null;

  try {
    const results = await mapWithConcurrency(files, sceneUploadConcurrency(files), async (file, index) => {
      if (checkpointError) throw checkpointError;
      const sceneId = uid();
      sceneUploadProgress.phase = `Enviando ${sceneUploadProgress.completed + sceneUploadProgress.failed + 1} de ${files.length}`;
      updateSceneUploadProgress();
      let image;
      try {
        image = await readImg(file, 1920, { campaignId, kind: "scenes", entityId: sceneId });
      } catch (err) {
        sceneUploadProgress.failed += 1;
        sceneUploadProgress.phase = `Enviando ${sceneUploadProgress.completed + sceneUploadProgress.failed} de ${files.length}`;
        updateSceneUploadProgress();
        throw err;
      }
      const title = String(file.name || "")
        .replace(/\.[^.]+$/, "")
        .replace(/[_-]+/g, " ")
        .trim() || `Cena ${index + 1}`;
      const scene = tabletop.normalizeScene({ id: sceneId, title, image, caption: "", masterNotes: "", createdAt: new Date().toISOString() }, uid);
      applySceneImageAsset(scene, image);
      uploadedScenes[index] = scene;
      sceneUploadProgress.completed += 1;
      sceneUploadProgress.phase = `Enviando ${sceneUploadProgress.completed + sceneUploadProgress.failed} de ${files.length}`;
      updateSceneUploadProgress();
      outboxWrite = outboxWrite
        .then(() => writePendingSceneCommit(campaignId, uploadedScenes.filter(Boolean)));
      try {
        await outboxWrite;
      } catch (err) {
        checkpointError = err;
        throw err;
      }
      return scene;
    });
    await outboxWrite;
    if (checkpointError) throw checkpointError;
    await writePendingSceneCommit(campaignId, uploadedScenes.filter(Boolean));

    const failures = results
      .map((result, index) => ({ ...result, fileName: files[index]?.name || `arquivo ${index + 1}` }))
      .filter(result => result?.status === "rejected");
    sceneUploadProgress.failed = failures.length;
    const addedScenes = uploadedScenes.filter(Boolean);
    if (!addedScenes.length) {
      const detail = failures[0]?.reason?.message || "Nao foi possivel processar as imagens selecionadas.";
      throw new Error(detail);
    }

    sceneUploadProgress.phase = "Confirmando roteiro no Firebase...";
    updateSceneUploadProgress();
    const current = findCampaign(campaignId);
    if (!current) throw new Error("Campanha nao encontrada depois dos uploads.");
    const knownIds = new Set((current.scenes || []).map(scene => String(scene.id)));
    const nextScenes = [...cloneSceneDeck(current.scenes), ...addedScenes.filter(scene => !knownIds.has(String(scene.id)))];
    const liveScene = current.liveScene?.active
      ? liveSceneForDeck(current, nextScenes, current.liveScene.sceneId, true)
      : null;
    await commitSceneDeck(campaignId, nextScenes, {
      ...(liveScene ? { liveScene } : {})
    });
    await clearPendingSceneCommit(campaignId);
    if (!selectedSceneIds.has(campaignId) && addedScenes[0]) selectedSceneIds.set(campaignId, addedScenes[0].id);

    toast(`${addedScenes.length} cena${addedScenes.length === 1 ? " adicionada" : "s adicionadas"} e sincronizada${addedScenes.length === 1 ? "" : "s"}.`);
    if (failures.length) {
      const failedNames = failures.slice(0, 5).map(result => `${result.fileName}: ${result.reason?.message || "arquivo invalido"}`).join("\n");
      alert(`${failures.length} imagem${failures.length === 1 ? " nao foi enviada" : "s nao foram enviadas"}. As demais foram preservadas.\n\n${failedNames}`);
    }
  } catch (err) {
    console.error(err);
    alert(firebaseErrorMessage(err));
  } finally {
    sceneUploadInProgress = false;
    sceneUploadProgress = { total: 0, completed: 0, failed: 0, phase: "" };
    render();
  }
}

async function retryPendingSceneCommit() {
  if (!session.campaign || sceneMutationInProgress || sceneUploadInProgress) return;
  const campaignId = String(session.campaign.id);
  let pending;
  try {
    pending = await readPendingSceneCommit(campaignId);
  } catch (err) {
    sceneOutboxErrors.set(campaignId, firebaseErrorMessage(err));
    render();
    return alert(firebaseErrorMessage(err));
  }
  if (!pending?.scenes?.length) return;
  sceneMutationInProgress = true;
  render();
  try {
    const current = findCampaign(campaignId);
    if (!current) throw new Error("Campanha nao encontrada.");
    const knownIds = new Set((current.scenes || []).map(scene => String(scene.id)));
    const nextScenes = [...cloneSceneDeck(current.scenes), ...pending.scenes.filter(scene => !knownIds.has(String(scene.id)))];
    if (nextScenes.length > MAX_ACTIVE_SCENES) {
      throw new Error(`A fila ultrapassaria o limite de ${MAX_ACTIVE_SCENES} cenas ativas. Mova cenas para a lixeira e tente novamente.`);
    }
    const liveScene = current.liveScene?.active
      ? liveSceneForDeck(current, nextScenes, current.liveScene.sceneId, true)
      : null;
    await commitSceneDeck(campaignId, nextScenes, { ...(liveScene ? { liveScene } : {}) });
    await clearPendingSceneCommit(campaignId);
    toast("Cenas pendentes sincronizadas.");
  } catch (err) {
    console.error(err);
    alert(firebaseErrorMessage(err));
  } finally {
    sceneMutationInProgress = false;
    render();
  }
}

async function discardSceneOutbox() {
  if (!session.campaign || sceneMutationInProgress || sceneUploadInProgress) return;
  const campaignId = String(session.campaign.id);
  if (!confirm("Descartar somente a fila local corrompida desta campanha? As cenas ja confirmadas no Firebase nao serao removidas.")) return;
  sceneMutationInProgress = true;
  render();
  try {
    await clearPendingSceneCommit(campaignId);
    sceneOutboxErrors.delete(campaignId);
    toast("Fila local de cenas descartada.");
  } catch (err) {
    console.error(err);
    alert(firebaseErrorMessage(err));
  } finally {
    sceneMutationInProgress = false;
    render();
  }
}

async function selectMasterScene(sceneId) {
  if (sceneMutationInProgress || sceneUploadInProgress) return;
  const campaign = session.campaign;
  const scene = campaign.scenes.find(entry => entry.id === String(sceneId));
  if (!scene) return;
  selectedSceneIds.set(campaign.id, scene.id);
  if (!campaign.liveScene?.active) return render();
  sceneMutationInProgress = true;
  render();
  try {
    const liveScene = liveSceneForDeck(campaign, campaign.scenes, scene.id, true);
    await commitLiveScene(campaign.id, liveScene);
  } catch (err) {
    console.error(err);
    alert(firebaseErrorMessage(err));
  } finally {
    sceneMutationInProgress = false;
    render();
  }
}

async function stepMasterScene(delta) {
  if (sceneMutationInProgress || sceneUploadInProgress) return;
  const campaign = session.campaign;
  const selected = selectedMasterScene(campaign);
  if (!selected) return;
  const index = campaign.scenes.findIndex(scene => scene.id === selected.id);
  const nextIndex = Math.max(0, Math.min(campaign.scenes.length - 1, index + Number(delta || 0)));
  if (nextIndex === index) return;
  const nextScene = campaign.scenes[nextIndex];
  await selectMasterScene(nextScene.id);
}

async function toggleScenePresentation() {
  if (sceneMutationInProgress || sceneUploadInProgress) return;
  const campaign = session.campaign;
  const selected = selectedMasterScene(campaign);
  if (!campaign.liveScene?.active && !selected) return alert("Adicione uma cena antes de iniciar a apresentacao.");
  if (selected && isUnmanagedImage(selected.image)) return alert("Migre esta cena para o Cloudinary antes de transmitir.");
  const nextLiveScene = campaign.liveScene?.active
    ? liveSceneForDeck(campaign, campaign.scenes, null, false)
    : liveSceneForDeck(campaign, campaign.scenes, selected.id, true);
  sceneMutationInProgress = true;
  render();
  try {
    await commitLiveScene(campaign.id, nextLiveScene);
    toast(nextLiveScene.active ? "Apresentacao iniciada e sincronizada." : "Apresentacao ocultada.");
  } catch (err) {
    console.error(err);
    alert(firebaseErrorMessage(err));
  } finally {
    sceneMutationInProgress = false;
    render();
  }
}

async function saveSceneDetails() {
  if (sceneMutationInProgress || sceneUploadInProgress) return;
  const campaign = session.campaign;
  const sceneId = document.getElementById("sceneEditorId")?.value;
  const nextScenes = cloneSceneDeck(campaign.scenes);
  const scene = nextScenes.find(entry => entry.id === sceneId);
  if (!scene) return;
  scene.title = document.getElementById("sceneTitle").value.trim() || "Cena";
  scene.caption = document.getElementById("sceneCaption").value.trim();
  scene.masterNotes = document.getElementById("sceneMasterNotes").value.trim();
  const liveScene = campaign.liveScene?.active && campaign.liveScene.sceneId === scene.id
    ? liveSceneForDeck(campaign, nextScenes, scene.id, true)
    : null;
  sceneMutationInProgress = true;
  render();
  try {
    await commitSceneDeck(campaign.id, nextScenes, { ...(liveScene ? { liveScene } : {}) });
    toast("Cena salva e sincronizada.");
  } catch (err) {
    console.error(err);
    alert(firebaseErrorMessage(err));
  } finally {
    sceneMutationInProgress = false;
    render();
  }
}

async function moveScene(sceneId, direction) {
  if (sceneMutationInProgress || sceneUploadInProgress) return;
  const campaign = session.campaign;
  const nextScenes = cloneSceneDeck(campaign.scenes);
  const index = nextScenes.findIndex(scene => scene.id === String(sceneId));
  const nextIndex = index + Number(direction || 0);
  if (index < 0 || nextIndex < 0 || nextIndex >= nextScenes.length) return;
  const [scene] = nextScenes.splice(index, 1);
  nextScenes.splice(nextIndex, 0, scene);
  const liveScene = campaign.liveScene?.active
    ? liveSceneForDeck(campaign, nextScenes, campaign.liveScene.sceneId, true)
    : null;
  sceneMutationInProgress = true;
  render();
  try {
    await commitSceneDeck(campaign.id, nextScenes, { ...(liveScene ? { liveScene } : {}) });
  } catch (err) {
    console.error(err);
    alert(firebaseErrorMessage(err));
  } finally {
    sceneMutationInProgress = false;
    render();
  }
}

async function deleteScene(sceneId) {
  if (sceneMutationInProgress || sceneUploadInProgress) return;
  const campaign = session.campaign;
  const normalizedSceneId = String(sceneId);
  const nextScenes = cloneSceneDeck(campaign.scenes);
  const index = nextScenes.findIndex(scene => scene.id === normalizedSceneId);
  if (index < 0 || !confirm("Mover esta cena para a lixeira privada? Ela podera ser restaurada sem novo upload.")) return;
  const removedScene = nextScenes[index];
  const wasLive = campaign.liveScene?.active && campaign.liveScene.sceneId === String(sceneId);
  nextScenes.splice(index, 1);
  const fallback = nextScenes[Math.min(index, nextScenes.length - 1)] || null;
  sceneMutationInProgress = true;
  render();
  const releaseSnapshotProtection = usingFirebase() ? protectCampaignFromSnapshots(campaign.id) : null;
  try {
    if (usingFirebase()) {
      await flushBeforeAtomicCampaignMutation(campaign.id);
      const result = await window.CDIFirebase.trashCampaignScene(campaign.id, normalizedSceneId);
      const current = findCampaign(campaign.id);
      if (!current) throw new Error("Campanha nao encontrada depois de mover a cena.");
      current.scenes = nextScenes;
      current.sceneTrash = [
        result?.scene || removedScene,
        ...(current.sceneTrash || []).filter(scene => String(scene.id) !== normalizedSceneId)
      ];
      if (result?.wasLive || wasLive) current.liveScene = { ...(result?.liveScene || liveSceneForDeck(current, nextScenes, null, false)) };
      session.campaign = current;
      persistLocal();
      lastSavedCampaignJson = JSON.stringify(current);
    } else {
      campaign.scenes = nextScenes;
      campaign.sceneTrash = [
        { ...removedScene, deletedAt: new Date().toISOString(), previousOrder: index },
        ...(campaign.sceneTrash || []).filter(scene => String(scene.id) !== normalizedSceneId)
      ];
      if (wasLive) campaign.liveScene = liveSceneForDeck(campaign, nextScenes, null, false);
      if (!save()) throw new Error("Nao foi possivel salvar a lixeira local.");
    }
    if (fallback) selectedSceneIds.set(campaign.id, fallback.id);
    else selectedSceneIds.delete(campaign.id);
    toast("Cena movida para a lixeira privada.");
  } catch (err) {
    console.error(err);
    alert(firebaseErrorMessage(err));
  } finally {
    releaseSnapshotProtection?.();
    sceneMutationInProgress = false;
    render();
  }
}

async function restoreSceneFromTrash(sceneId) {
  if (sceneMutationInProgress || sceneUploadInProgress || !session.campaign) return;
  const campaign = session.campaign;
  const normalizedSceneId = String(sceneId);
  const trashedScene = (campaign.sceneTrash || []).find(scene => String(scene.id) === normalizedSceneId);
  if (!trashedScene) return;
  if ((campaign.scenes || []).length >= MAX_ACTIVE_SCENES) {
    return alert(`O roteiro ja possui ${MAX_ACTIVE_SCENES} cenas ativas. Mova uma delas para a lixeira antes de restaurar.`);
  }

  sceneMutationInProgress = true;
  render();
  const releaseSnapshotProtection = usingFirebase() ? protectCampaignFromSnapshots(campaign.id) : null;
  try {
    let restoredScene;
    if (usingFirebase()) {
      await flushBeforeAtomicCampaignMutation(campaign.id);
      const result = await window.CDIFirebase.restoreCampaignScene(campaign.id, normalizedSceneId);
      restoredScene = result?.scene || trashedScene;
      const current = findCampaign(campaign.id);
      if (!current) throw new Error("Campanha nao encontrada depois da restauracao.");
      current.sceneTrash = (current.sceneTrash || []).filter(scene => String(scene.id) !== normalizedSceneId);
      current.scenes = [...(current.scenes || []).filter(scene => String(scene.id) !== normalizedSceneId), restoredScene];
      session.campaign = current;
      persistLocal();
      lastSavedCampaignJson = JSON.stringify(current);
    } else {
      const { deletedAt, deletedBy, previousOrder, ...cleanScene } = trashedScene;
      restoredScene = cleanScene;
      campaign.sceneTrash = (campaign.sceneTrash || []).filter(scene => String(scene.id) !== normalizedSceneId);
      campaign.scenes = [...(campaign.scenes || []), restoredScene];
      if (!save()) throw new Error("Nao foi possivel restaurar a cena no armazenamento local.");
    }
    selectedSceneIds.set(campaign.id, restoredScene.id);
    toast("Cena restaurada sem novo upload.");
  } catch (err) {
    console.error(err);
    alert(firebaseErrorMessage(err));
  } finally {
    releaseSnapshotProtection?.();
    sceneMutationInProgress = false;
    render();
  }
}

function toggleSceneFullscreen() {
  toggleImageStageFullscreen(document.getElementById("sceneStage"));
}

// --- PAINEL DO JOGADOR ---
function playerBody() {
  const v = session.view;
  if (v === "messages") return messagesPage();
  if (v === "room") return roomPage();
  if (v === "scenes") return playerScenesPage();
  const ch = session.campaign.characters.find(x => x.id === session.player.characterId);
  if (!ch) {
    return `
      <h2>👤 Meu Personagem</h2>
      <p class="muted">Você ainda não está vinculado a nenhum personagem desta campanha. Peça ao Mestre para associá-lo.</p>`;
  }
  if (v === "traumas") return playerTraumasPage(ch);
  if (v === "inventory") return inventoryPlayer(ch);
  if (v === "evidencePlayer") return evidencePlayer(ch);
  if (v === "transferPlayer") return transferPlayerPage(ch);
  return sheetPlayer(ch);
}

function transferPlayerPage(ch) {
  const c = session.campaign;
  c.itemTransfers ??= [];
  const myTransfers = c.itemTransfers.filter(t => t.fromPlayerId === session.player.id);
  const otherParticipants = (tabletop?.getControlledParticipants(c) || []).filter(entry => entry.character.id !== ch.id);
  const inventory = ch.inventory || [];
  const inventoryAvailability = inventory.map(item => ({
    ...item,
    available: tabletop?.availableInventoryQuantity(c, ch.id, item.id) ?? item.quantity
  }));
  const hasTransferableItem = inventoryAvailability.some(item => item.available > 0);
  const evidenceAvailability = (ch.evidence || []).map(entry => ({
    ...entry,
    reserved: tabletop?.isEvidenceTransferPending(c, ch.id, entry.id) || false
  }));
  const hasTransferableEvidence = evidenceAvailability.some(entry => !entry.reserved);

  return `
    <h2>🤝 Entregar Item ou Evidência</h2>
    <p class="muted">As entregas ficam pendentes ate a aprovacao do Mestre.</p>

    <div class="card" style="margin-top:15px;">
      <h3>Nova solicitacao</h3>
      <label>Tipo de Objeto</label>
      <select id="trType" onchange="toggleTransferType()">
        <option value="item">Item do inventario</option>
        <option value="evidence">Evidencia</option>
      </select>

      <div id="trItemFields">
        <label>Item</label>
        <select id="trInventoryId" onchange="syncTransferQuantityLimit()" ${hasTransferableItem ? "" : "disabled"}>
          ${inventoryAvailability.map(item => `<option value="${item.id}" data-available="${item.available}" ${item.available > 0 ? "" : "disabled"}>${esc(item.name)} (${item.available} disponivel${item.available !== item.quantity ? ` de ${item.quantity}` : ""})</option>`).join("") || `<option value="">Inventario vazio</option>`}
        </select>
        <label>Quantidade</label><input id="trQuantity" type="number" min="1" max="${inventoryAvailability.find(item => item.available > 0)?.available || 1}" value="1" ${hasTransferableItem ? "" : "disabled"}>
        ${inventory.length && !hasTransferableItem ? `<p class="muted">Todos os itens estao reservados em solicitacoes pendentes.</p>` : ""}
      </div>

      <div id="trEvidenceFields" hidden>
        <label>Evidencia</label>
        <select id="trEvidenceId" ${hasTransferableEvidence ? "" : "disabled"}>
          ${evidenceAvailability.map(evidence => `<option value="${evidence.id}" ${evidence.reserved ? "disabled" : ""}>${esc(evidence.title)}${evidence.reserved ? " (solicitacao pendente)" : ""}</option>`).join("") || `<option value="">Nenhuma evidencia vinculada</option>`}
        </select>
        ${evidenceAvailability.length && !hasTransferableEvidence ? `<p class="muted">Todas as evidencias estao reservadas em solicitacoes pendentes.</p>` : ""}
      </div>

      <label>Entregar para:</label>
      <select id="trTarget" ${otherParticipants.length ? "" : "disabled"}>
        <option value="">Selecione um personagem</option>
        ${otherParticipants.map(({ character }) => `<option value="${character.id}">Origem: ${esc(character.origin || "Sem origem")}</option>`).join("")}
      </select>

      <label>Observacao para o Mestre</label>
      <input id="trMsg" placeholder="Detalhes da entrega">

      <br><br>
      <button onclick="submitPlayerTransfer('${ch.id}')">Enviar solicitacao</button>
    </div>

    <h3 style="margin-top:30px;">📋 Suas Solicitações Recentes</h3>
    <div class="grid" style="margin-top:10px;">
      ${myTransfers.length === 0 ? '<p class="muted">Nenhuma solicitação enviada.</p>' : ''}
      ${myTransfers.map(t => `
        <div class="card" style="margin:0; opacity: 0.9;">
          ${entityVisual(t.image, t.itemName)}
          <h3>${esc(t.itemName)} (${t.status === 'pending' ? '⏳ Pendente' : t.status === 'approved' ? '✅ Aprovado' : '❌ Rejeitado'})</h3>
          ${t.type === "item" ? `<p class="muted">Quantidade: <b>${Math.max(1, Number(t.quantity) || 1)}</b></p>` : ""}
          <p class="muted">Para: <b>${esc(t.toName)}</b></p>
          <p style="font-size:12px;">${esc(t.message || '')}</p>
        </div>`).join("")}
    </div>`;
}

function toggleTransferType() {
  const isItem = document.getElementById("trType")?.value === "item";
  const itemFields = document.getElementById("trItemFields");
  const evidenceFields = document.getElementById("trEvidenceFields");
  if (itemFields) itemFields.hidden = !isItem;
  if (evidenceFields) evidenceFields.hidden = isItem;
}

function syncTransferQuantityLimit() {
  const select = document.getElementById("trInventoryId");
  const quantity = document.getElementById("trQuantity");
  if (!select || !quantity) return;
  const available = Math.max(0, Number(select.selectedOptions[0]?.dataset.available) || 0);
  quantity.max = String(Math.max(1, available));
  quantity.value = String(Math.min(Math.max(1, Number.parseInt(quantity.value, 10) || 1), Math.max(1, available)));
}

async function submitPlayerTransfer(fromCharacterId) {
  const type = document.getElementById("trType").value;
  const fromCharacter = session.campaign.characters.find(entry => entry.id === fromCharacterId);
  const toCharacterId = document.getElementById("trTarget").value || null;
  const toCharacter = session.campaign.characters.find(entry => entry.id === toCharacterId);
  const message = document.getElementById("trMsg").value.trim();
  if (!fromCharacter) return alert("Personagem de origem nao encontrado.");
  if (!toCharacter) return alert("Escolha o personagem que recebera a entrega.");

  let source;
  let quantity = 1;
  if (type === "item") {
    source = fromCharacter.inventory.find(entry => entry.id === document.getElementById("trInventoryId").value);
    if (!source) return alert("Escolha um item do seu inventario.");
    quantity = Math.max(1, Number.parseInt(document.getElementById("trQuantity").value, 10) || 1);
    const available = tabletop?.availableInventoryQuantity(session.campaign, fromCharacter.id, source.id) ?? source.quantity;
    if (quantity > available) return alert("A quantidade informada e maior que a disponivel. Verifique as solicitacoes pendentes.");
  } else {
    source = (fromCharacter.evidence || []).find(entry => entry.id === document.getElementById("trEvidenceId").value);
    if (!source) return alert("Escolha uma evidencia vinculada ao seu personagem.");
    if (tabletop?.isEvidenceTransferPending(session.campaign, fromCharacter.id, source.id)) {
      return alert("Esta evidencia ja possui uma solicitacao pendente.");
    }
  }

  const targetPlayer = toCharacter
    ? session.campaign.players.find(player => player.characterId === toCharacter.id)
    : null;

  session.campaign.itemTransfers ??= [];
  session.campaign.itemTransfers.unshift({
    id: uid(),
    fromPlayerId: session.player.id,
    fromCharacterId: fromCharacter.id,
    fromName: fromCharacter.origin || "Sem origem",
    type,
    inventoryId: type === "item" ? source.id : null,
    evidenceEntryId: type === "evidence" ? source.id : null,
    evidenceId: type === "evidence" ? source.evidenceId : null,
    quantity,
    itemName: source.title || source.name,
    description: source.description || "",
    image: source.image || "",
    toCharacterId,
    toPlayerId: targetPlayer?.id || null,
    toName: toCharacter.origin || "Sem origem",
    message,
    status: "pending",
    time: "Pendente de aprovação"
  });

  save();
  toast("Solicitação enviada ao Mestre com sucesso!");
  render();
}

function sheetPlayer(ch) {
  ch.skills ??= [];
  return `
    <div class="character-sheet-profile">
      ${entityVisual(ch.image, ch.name, "character-sheet-portrait")}
      <div class="character-sheet-identity">
        <h2>${esc(ch.name)}</h2>
        <span class="tag">Origem: ${esc(ch.origin)}</span>
      </div>
    </div>
    <div class="grid vital-grid" style="margin-top:15px;">
      <div class="card vital-card vital-health"><h3>❤️ Saúde</h3><h2 id="val-health">${ch.health}/${ch.healthMax}</h2><div class="bar"><div id="bar-health" class="fill health" style="width:${(ch.health/ch.healthMax)*100}%"></div></div><button onclick="changeStatDirect('health',-1)">−</button><button onclick="changeStatDirect('health',1)">+</button></div>
      <div class="card vital-card vital-sanity"><h3>🧠 Sanidade</h3><h2 id="val-sanity">${ch.sanity}/${ch.sanityMax}</h2><div class="bar"><div id="bar-sanity" class="fill sanity" style="width:${(ch.sanity/ch.sanityMax)*100}%"></div></div><button onclick="changeStatDirect('sanity',-1)">−</button><button onclick="changeStatDirect('sanity',1)">+</button></div>
      <div class="card vital-card vital-defense"><h3>🛡️ Defesa</h3><h2>${ch.defense || 10}</h2></div>
    </div>
    <div class="grid" style="margin-top:15px;">
      <div class="card"><h3>📊 Atributos</h3>${Object.entries(ch.attrs).map(([k, v]) => `<div class="stat clickable-stat" onclick="rollAttribute(${jsArg(k)}, ${v})"><span>${esc(k)}</span><b>${v >= 0 ? '+' + v : v}</b></div>`).join("")}</div>
      <div class="card"><h3>🛡️ Resistências</h3>${Object.entries(ch.res).map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join("")}</div>
    </div>
    <div class="card" style="margin-top:15px;">
      <h3>🎯 Habilidades</h3>
      <div class="grid" style="margin-top:10px;">
        ${ch.skills.map((s, idx) => `
          <div class="card" style="margin:0; padding:10px;">
            <b class="clickable-stat" onclick="rollSkill(${jsArg(s.name)}, ${s.bonus || 0})">${esc(s.name)}</b>
            <div style="margin-top:8px; display:flex; align-items:center; gap:8px;">
              <span>Usos: <b>${s.uses}/${s.maxUses}</b></span>
              <button onclick="changeSkillUses('${ch.id}', ${idx}, -1)">−</button>
              <button onclick="changeSkillUses('${ch.id}', ${idx}, 1)">+</button>
            </div>
          </div>`).join("") || "<p class='muted'>Nenhuma habilidade.</p>"}
      </div>
    </div>`;
}

function changeSkillUses(charId, idx, delta) {
  const ch = session.campaign.characters.find(x => x.id === charId);
  const s = ch.skills[idx];
  s.uses = Math.max(0, Math.min(s.maxUses, s.uses + delta));
  save(); render();
}

function changeStatDirect(key, delta) {
  if (session.role !== "player" || !session.player?.characterId) return;
  return adjustCharacterVitalFromUi(session.player.characterId, key, delta);
}

// --- ITENS, CASOS E EVIDÊNCIAS ---
function missingItemPresentationFields(item) {
  const missing = [];
  if (!String(item?.name || "").trim()) missing.push("titulo");
  if (!String(item?.description || "").trim()) missing.push("descricao");
  if (!String(item?.image || "").trim()) missing.push("foto");
  return missing;
}

function requireCompleteItemPresentation(item) {
  const missing = missingItemPresentationFields(item);
  if (missing.length) {
    throw new Error(`Complete ${missing.join(", ")} antes de entregar este item.`);
  }
  return item;
}

function itemsMasterPage() {
  const items = session.campaign.items || [];
  return `
    <div class="page-heading item-catalog-heading">
      <div><h2>🎒 Itens</h2><p class="muted">Catalogo da campanha</p></div>
      <div class="item-catalog-heading-actions">
        <button class="secondary" onclick="originLoadoutsModal()">Kits de origem</button>
        <button onclick="itemModal()">Cadastrar item</button>
      </div>
    </div>
    ${items.length ? `
      <div class="item-catalog-toolbar">
        <label class="sr-only" for="itemCatalogSearch">Buscar item</label>
        <input id="itemCatalogSearch" type="search" placeholder="Buscar item" autocomplete="off" oninput="filterItemCatalog(this.value)">
        <span class="muted">${items.length} cadastrado${items.length === 1 ? "" : "s"}</span>
      </div>
      <div id="itemCatalogGrid" class="item-catalog-grid">
        ${items.map((item, index) => `
          <article class="item-catalog-card" data-item-search="${esc(`${item.name} ${item.description}`.toLowerCase())}">
            ${entityVisual(item.image, item.name, "item-catalog-thumbnail")}
            <div class="item-catalog-copy">
              <h3 title="${esc(item.name)}">${esc(item.name)}</h3>
              <p title="${esc(item.description)}">${esc(item.description)}</p>
            </div>
            <div class="item-catalog-actions">
              <button onclick="deliverItemModal(${index})">Adicionar</button>
              <button class="secondary" onclick="itemModal(${index})">Editar</button>
              <button class="danger" onclick="deleteCatalogItem(${jsArg(item.id)})">Excluir</button>
            </div>
          </article>`).join("")}
      </div>
      <p id="itemCatalogNoResults" class="empty-state muted" hidden>Nenhum item encontrado.</p>`
      : `<div class="empty-state"><h3>Catalogo vazio</h3><p class="muted">Cadastre o primeiro item da campanha.</p></div>`}`;
}

function filterItemCatalog(query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const cards = Array.from(document.querySelectorAll(".item-catalog-card"));
  let visible = 0;
  cards.forEach(card => {
    const matches = !normalizedQuery || String(card.dataset.itemSearch || "").includes(normalizedQuery);
    card.hidden = !matches;
    if (matches) visible += 1;
  });
  const empty = document.getElementById("itemCatalogNoResults");
  if (empty) empty.hidden = visible > 0;
}

function deleteCatalogItem(itemId) {
  if (session.role !== "master") return;
  const index = session.campaign.items.findIndex(item => String(item.id) === String(itemId));
  if (index < 0) return;
  const item = session.campaign.items[index];
  if (!confirm(`Excluir ${item.name} do catalogo? As copias que ja estao nos inventarios serao preservadas.`)) return;
  session.campaign.items.splice(index, 1);
  normalizeCampaign(session.campaign);
  save();
  render();
  toast("Item removido do catalogo.");
}

function itemModal(index = null) {
  const x = index === null ? { name: "", description: "", image: "" } : session.campaign.items[index];
  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox item-modalbox">
      <div class="modal-heading"><h2>🎒 ${index === null ? "Cadastrar item" : "Editar item"}</h2><button class="icon-button secondary" title="Fechar" aria-label="Fechar" onclick="this.closest('.modal').remove()">×</button></div>
      <label>Nome<span class="required-marker"> *</span></label><input id="itname" value="${esc(x.name)}" required>
      <label>Descrição<span class="required-marker"> *</span></label><textarea id="itdesc" required>${esc(x.description)}</textarea>
      ${imgInput("itimg", "Foto do Item", x.image, true)}
      <div class="modal-actions"><button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button><button onclick="saveItemModal(${index}, this)">Salvar</button></div>
    </div></div>`);
}

async function saveItemModal(index, button) {
  const isNew = index === null;
  const current = isNew ? null : session.campaign.items[index];
  const campaignId = String(session.campaign.id);
  const itemId = String(current?.id || uid());
  const name = document.getElementById("itname").value.trim();
  const description = document.getElementById("itdesc").value.trim();
  const imageFile = document.getElementById("itimg").files[0];
  if (!name) return alert("Informe o titulo do item.");
  if (!description) return alert("Informe a descricao do item.");
  if (!imageFile && !current?.image) return alert("Selecione uma foto para o item.");

  if (button) {
    button.disabled = true;
    button.textContent = "Salvando...";
  }
  try {
    const uploadedImage = imageFile ? await readImg(imageFile, 1200, { campaignId, kind: "items", entityId: itemId }) : "";
    const campaign = findCampaign(campaignId);
    if (!campaign) throw new Error("Campanha nao encontrada depois do upload.");
    const latest = isNew ? null : campaign.items.find(entry => String(entry.id) === itemId);
    if (!isNew && !latest) throw new Error("Item nao encontrado depois do upload.");
    const item = {
      ...(latest || {}),
      id: itemId,
      name,
      description,
      image: uploadedImage || latest?.image || current?.image || "",
      createdAt: latest?.createdAt || current?.createdAt || new Date().toISOString()
    };
    if (uploadedImage) applyImageAsset(item, uploadedImage);
    delete item.revealed;
    requireCompleteItemPresentation(item);

    if (usingFirebase()) {
      if (!isCloudinaryImage(item.image)) throw new Error("Migre a imagem antiga do item para o Cloudinary antes de salva-lo.");
      await commitCampaignMediaMutation(campaignId, {
        basePatch: {},
        documents: [{
          collection: "items",
          id: itemId,
          data: { ...item, _order: isNew ? campaign.items.length : Math.max(0, campaign.items.findIndex(entry => String(entry.id) === itemId)) }
        }],
        cloudinaryUrls: [item.image]
      });
      const confirmedCampaign = findCampaign(campaignId);
      if (!confirmedCampaign) throw new Error("Campanha nao encontrada depois da confirmacao do item.");
      const confirmedItem = confirmedCampaign.items.find(entry => String(entry.id) === itemId);
      if (confirmedItem) Object.assign(confirmedItem, item);
      else confirmedCampaign.items.push(item);
      session.campaign = confirmedCampaign;
      persistLocal();
    } else {
      if (isNew) campaign.items.push(item);
      else Object.assign(latest, item);
      session.campaign = campaign;
      save();
    }
    (button?.closest(".modal") || document.querySelector(".modal"))?.remove();
    render();
    toast("Item salvo!");
  } catch (err) {
    console.error(err);
    alert(err.message || "Nao foi possivel salvar o item.");
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = "Salvar";
    }
  }
}

function originLoadoutsModal(origin = ORIGINS[0]) {
  if (session.role !== "master") return;
  const selectedOrigin = ORIGINS.includes(origin) ? origin : ORIGINS[0];
  const loadoutByItem = new Map(characterOriginLoadout(selectedOrigin).map(entry => [String(entry.itemId), entry.quantity]));
  const catalog = session.campaign.items || [];
  document.getElementById("originLoadoutModal")?.remove();
  root.insertAdjacentHTML("beforeend", `
    <div class="modal" id="originLoadoutModal"><div class="modalbox modalbox-wide origin-loadout-modalbox">
      <div class="modal-heading">
        <div><h2>Kits iniciais por origem</h2><p class="muted">${esc(selectedOrigin)}</p></div>
        <button class="icon-button secondary" title="Fechar" aria-label="Fechar" onclick="this.closest('.modal').remove()">×</button>
      </div>
      <label>Origem</label>
      <select id="originLoadoutOrigin" onchange="originLoadoutsModal(this.value)">
        ${ORIGINS.map(option => {
          const count = characterOriginLoadout(option).length;
          return `<option value="${esc(option)}" ${option === selectedOrigin ? "selected" : ""}>${esc(option)}${count ? ` (${count})` : ""}</option>`;
        }).join("")}
      </select>
      <div class="origin-loadout-list">
        ${catalog.length ? catalog.map(item => {
          const complete = missingItemPresentationFields(item).length === 0;
          return `
            <label class="origin-loadout-item ${complete ? "" : "is-incomplete"}">
              ${entityVisual(item.image, item.name, "origin-loadout-thumbnail")}
              <span><strong>${esc(item.name)}</strong>${complete ? "" : `<small>Cadastro incompleto</small>`}</span>
              <input type="number" min="0" value="${loadoutByItem.get(String(item.id)) || 0}" data-origin-kit-item data-item-id="${esc(item.id)}" aria-label="Quantidade de ${esc(item.name)}" ${complete ? "" : "disabled"}>
            </label>`;
        }).join("") : `<div class="empty-state"><h3>Catalogo vazio</h3></div>`}
      </div>
      <div class="modal-actions">
        <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
        <button onclick="saveOriginLoadout(this)" ${catalog.length ? "" : "disabled"}>Salvar kit</button>
      </div>
    </div></div>`);
}

function saveOriginLoadout(button) {
  if (session.role !== "master") return;
  const origin = document.getElementById("originLoadoutOrigin")?.value;
  const entries = Array.from(document.querySelectorAll("[data-origin-kit-item]"))
    .map(input => ({ itemId: input.dataset.itemId, quantity: Number.parseInt(input.value, 10) || 0 }));
  try {
    tabletop.setOriginLoadout(session.campaign, origin, entries);
    save();
    button?.closest(".modal")?.remove();
    render();
    toast(`Kit de ${origin} salvo.`);
  } catch (err) {
    alert(err.message || "Nao foi possivel salvar o kit.");
  }
}

function openOriginLoadoutFromInventory(origin) {
  document.getElementById("inventoryManagerModal")?.remove();
  originLoadoutsModal(origin);
}

function deliverItemModal(itemIndex) {
  const item = session.campaign.items[itemIndex];
  const characters = session.campaign.characters;
  if (!item) return;
  try {
    requireCompleteItemPresentation(item);
  } catch (err) {
    return alert(err.message);
  }
  if (!characters.length) return alert("Crie um personagem antes de entregar itens.");

  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <div class="modal-heading"><h2>Adicionar ao inventario</h2><button class="icon-button secondary" title="Fechar" aria-label="Fechar" onclick="this.closest('.modal').remove()">×</button></div>
      <div class="item-delivery-preview">
        ${entityVisual(item.image, item.name, "item-delivery-image")}
        <div><h3>${esc(item.name)}</h3><p>${esc(item.description)}</p></div>
      </div>
      <label>Personagem</label>
      <select id="grantCharacterId">
        ${characters.map(character => {
          const player = session.campaign.players.find(entry => entry.characterId === character.id);
          return `<option value="${character.id}">${esc(character.name)}${player ? ` - ${esc(player.name)}` : ""}</option>`;
        }).join("")}
      </select>
      <div class="two">
        <div><label>Quantidade</label><input id="grantQuantity" type="number" min="1" value="1"></div>
        <div class="checkbox-field"><label><input id="grantEquipped" type="checkbox"> Entregar equipado</label></div>
      </div>
      <label>Observacoes</label><textarea id="grantNotes" placeholder="Carga, municao, estado ou detalhes especiais"></textarea>
      <div class="modal-actions">
        <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
        <button onclick="saveItemGrant(${itemIndex})">Adicionar ao inventario</button>
      </div>
    </div></div>`);
}

async function persistCharacterInventoryNow(campaignId, characterId, options = {}) {
  const campaign = findCampaign(String(campaignId || ""));
  const character = campaign?.characters.find(entry => entry.id === characterId);
  if (!character) throw new Error("Personagem nao encontrado.");
  normalizeState();
  persistLocal();
  if (!usingFirebase()) return true;

  setSyncStatus("Sincronizando inventario...");
  try {
    const result = await window.CDIFirebase.updateCharacterInventory(
      campaign.id,
      character.id,
      character.inventory || [],
      options.includeOriginLoadouts
        ? { appliedOriginLoadouts: character.appliedOriginLoadouts || [] }
        : {}
    );
    if (result?.inventoryUpdatedAt) character.inventoryUpdatedAt = result.inventoryUpdatedAt;
    if (result?.appliedOriginLoadouts) character.appliedOriginLoadouts = result.appliedOriginLoadouts;
    setSyncStatus("Online em tempo real");
    return true;
  } catch (err) {
    setSyncStatus("Falha de sincronizacao");
    throw err;
  }
}

async function commitCharacterInventoryMutation(characterId, mutation, options = {}) {
  const campaignId = String(options.campaignId || session.campaign?.id || "");
  if (!campaignId) throw new Error("Campanha nao encontrada.");
  const releaseSnapshotProtection = protectCampaignFromSnapshots(campaignId);
  let character = null;
  let previousInventory = null;
  let previousAppliedOriginLoadouts = null;
  try {
    if (usingFirebase()) await flushBeforeAtomicCampaignMutation(campaignId);
    const campaign = findCampaign(campaignId);
    character = campaign?.characters.find(entry => entry.id === characterId);
    if (!character) throw new Error("Personagem nao encontrado.");
    if (String(session.campaign?.id || "") !== campaignId) throw new Error("A campanha ativa mudou durante a operacao.");
    previousInventory = JSON.parse(JSON.stringify(character.inventory || []));
    previousAppliedOriginLoadouts = [...(character.appliedOriginLoadouts || [])];
    const result = mutation(character);
    await persistCharacterInventoryNow(campaignId, characterId, options);
    return result;
  } catch (err) {
    if (character && previousInventory && previousAppliedOriginLoadouts) {
      character.inventory = previousInventory;
      character.appliedOriginLoadouts = previousAppliedOriginLoadouts;
      persistLocal();
    }
    throw err;
  } finally {
    releaseSnapshotProtection();
  }
}

async function saveItemGrant(itemIndex) {
  if (session.role !== "master") return alert("Somente o Mestre pode entregar itens diretamente.");
  const item = session.campaign.items[itemIndex];
  const characterId = document.getElementById("grantCharacterId").value;
  const quantity = Number.parseInt(document.getElementById("grantQuantity").value, 10);
  if (!Number.isFinite(quantity) || quantity < 1) return alert("Informe uma quantidade valida.");
  try {
    requireCompleteItemPresentation(item);
    await commitCharacterInventoryMutation(characterId, () => tabletop.grantItem(session.campaign, characterId, item, {
        quantity,
        equipped: document.getElementById("grantEquipped").checked,
        notes: document.getElementById("grantNotes").value.trim()
      }, uid));
    document.querySelector(".modal").remove();
    render();
    toast("Item adicionado ao inventario.");
  } catch (err) {
    alert(firebaseErrorMessage(err));
  }
}

function manageCharacterInventoryModal(characterId) {
  if (session.role !== "master") return alert("Somente o Mestre pode gerenciar inventarios.");
  const character = session.campaign.characters.find(entry => entry.id === characterId);
  if (!character) return;
  character.inventory ??= [];
  const catalog = session.campaign.items || [];
  const characterOrigin = String(character.origin || "Sem origem");
  const originLoadout = characterOriginLoadout(characterOrigin);
  const catalogById = new Map(catalog.map(item => [String(item.id), item]));
  const loadoutApplied = tabletop.hasAppliedOriginLoadout(character, characterOrigin);

  root.insertAdjacentHTML("beforeend", `
    <div class="modal" id="inventoryManagerModal"><div class="modalbox modalbox-wide">
      <div class="modal-heading">
        <div><h2>Inventario de ${esc(character.name)}</h2><p class="muted">${character.inventory.length} tipo${character.inventory.length === 1 ? "" : "s"} de item</p></div>
        <button class="icon-button secondary" title="Fechar" aria-label="Fechar" onclick="this.closest('.modal').remove()">×</button>
      </div>

      <section class="origin-kit-band">
        <div class="origin-kit-band-heading">
          <div><span class="eyebrow">KIT DE ORIGEM</span><h3>${esc(characterOrigin)}</h3></div>
          ${loadoutApplied ? `<span class="status-chip status-online">Aplicado</span>` : ""}
        </div>
        ${originLoadout.length ? `
          <div class="origin-kit-preview-list">
            ${originLoadout.map(entry => {
              const item = catalogById.get(String(entry.itemId));
              return item ? `<span class="origin-kit-preview-item">${entityVisual(item.image, item.name, "origin-kit-preview-thumbnail")}<span>${esc(item.name)} <b>×${entry.quantity}</b></span></span>` : "";
            }).join("")}
          </div>
          <div class="origin-kit-band-actions">
            <button class="secondary" onclick="openOriginLoadoutFromInventory(${jsArg(characterOrigin)})">Editar kit</button>
            <button onclick="applyOriginLoadoutToCharacter(${jsArg(character.id)})">${loadoutApplied ? "Aplicar novamente" : "Aplicar kit inicial"}</button>
          </div>` : `
          <div class="origin-kit-band-actions">
            <span class="muted">Nenhum kit configurado.</span>
            <button class="secondary" onclick="openOriginLoadoutFromInventory(${jsArg(characterOrigin)})">Configurar kit</button>
          </div>`}
      </section>

      <section class="inventory-add-band">
        <h3>Adicionar do catalogo</h3>
        ${catalog.length ? `
          <div class="inventory-add-grid">
            <select id="inventoryCatalogItem">${catalog.map(item => {
              const complete = missingItemPresentationFields(item).length === 0;
              return `<option value="${item.id}" ${complete ? "" : "disabled"}>${esc(item.name)}${complete ? "" : " - cadastro incompleto"}</option>`;
            }).join("")}</select>
            <input id="inventoryCatalogQuantity" type="number" min="1" value="1" aria-label="Quantidade">
            <button onclick="grantCatalogItemToCharacter('${character.id}')">Adicionar</button>
          </div>
          <label>Observacoes</label><input id="inventoryCatalogNotes" placeholder="Detalhes opcionais">`
          : `<p class="muted">Nenhum item cadastrado no catalogo.</p>`}

        <div class="inventory-freeform">
          <h3>Adicionar item livremente</h3>
          <div class="inventory-freeform-grid">
            <div><label>Nome<span class="required-marker"> *</span></label><input id="inventoryCustomName" placeholder="Nome do item" required></div>
            <div><label>Quantidade<span class="required-marker"> *</span></label><input id="inventoryCustomQuantity" type="number" min="1" value="1" required></div>
          </div>
          <label>Descricao<span class="required-marker"> *</span></label><textarea id="inventoryCustomDescription" placeholder="Efeito, historia ou detalhes do item" required></textarea>
          ${imgInput("inventoryCustomImage", "Foto do item", "", true)}
          <label>Observacoes</label><input id="inventoryCustomNotes" placeholder="Carga, municao, estado ou detalhes especiais">
          <div class="inventory-freeform-actions">
            <label class="checkbox-field compact-checkbox"><input id="inventoryCustomEquipped" type="checkbox"> Entregar equipado</label>
            <button onclick="grantCustomItemToCharacter('${character.id}', this)">Adicionar ao inventario</button>
          </div>
        </div>
      </section>

      <div class="inventory-manager-list">
        ${character.inventory.map(entry => `
          <div class="inventory-manager-row">
            <div class="inventory-manager-media">
              ${imgInput(`invImage_${entry.id}`, "Foto do item", entry.image, true)}
            </div>
            <div class="inventory-manager-main">
              <div class="card-title-row"><h3>${esc(entry.name)}</h3>${entry.equipped ? `<span class="status-chip status-online">Equipado</span>` : ""}</div>
              <div class="inventory-primary-fields">
                <div><label>Titulo<span class="required-marker"> *</span></label><input id="invName_${entry.id}" value="${esc(entry.name)}" required></div>
                <div><label>Quantidade<span class="required-marker"> *</span></label><input id="invQty_${entry.id}" type="number" min="1" value="${entry.quantity}" required></div>
              </div>
              <label>Descricao<span class="required-marker"> *</span></label><textarea id="invDescription_${entry.id}" class="inventory-manager-description" required>${esc(entry.description)}</textarea>
              <div class="inventory-notes-field">
                <div><label>Observacoes</label><input id="invNotes_${entry.id}" value="${esc(entry.notes)}"></div>
              </div>
              <div class="row-actions">
                <button onclick="saveInventoryEntry('${character.id}','${entry.id}', this)">Salvar</button>
                <button class="secondary" onclick="toggleInventoryEquipped('${character.id}','${entry.id}')">${entry.equipped ? "Desequipar" : "Equipar"}</button>
                <button class="danger" onclick="removeCharacterInventoryItem('${character.id}','${entry.id}')">Remover</button>
              </div>
            </div>
          </div>`).join("") || `<div class="empty-state"><h3>Inventario vazio</h3></div>`}
      </div>
    </div></div>`);
}

function reopenInventoryManager(characterId, message) {
  render();
  manageCharacterInventoryModal(characterId);
  if (message) toast(message);
}

async function grantCatalogItemToCharacter(characterId) {
  if (session.role !== "master") return alert("Somente o Mestre pode gerenciar inventarios.");
  const itemId = document.getElementById("inventoryCatalogItem")?.value;
  const item = session.campaign.items.find(entry => entry.id === itemId);
  const quantity = Number.parseInt(document.getElementById("inventoryCatalogQuantity")?.value, 10);
  if (!item) return alert("Selecione um item do catalogo.");
  if (!Number.isFinite(quantity) || quantity < 1) return alert("Informe uma quantidade valida.");
  try {
    requireCompleteItemPresentation(item);
    await commitCharacterInventoryMutation(characterId, () => tabletop.grantItem(session.campaign, characterId, item, {
        quantity,
        notes: document.getElementById("inventoryCatalogNotes").value.trim()
      }, uid));
    reopenInventoryManager(characterId, "Item adicionado.");
  } catch (err) {
    alert(firebaseErrorMessage(err));
  }
}

async function applyOriginLoadoutToCharacter(characterId) {
  if (session.role !== "master") return alert("Somente o Mestre pode gerenciar inventarios.");
  const character = session.campaign.characters.find(entry => String(entry.id) === String(characterId));
  if (!character) return alert("Personagem nao encontrado.");
  const origin = String(character.origin || "");
  const alreadyApplied = tabletop.hasAppliedOriginLoadout(character, origin);
  if (alreadyApplied && !confirm(`Aplicar novamente o kit de ${origin}? As quantidades serao somadas ao inventario atual.`)) return;

  try {
    await commitCharacterInventoryMutation(character.id, () => (
      tabletop.applyOriginLoadout(session.campaign, character.id, { origin, force: alreadyApplied }, uid)
    ), { includeOriginLoadouts: true });
    reopenInventoryManager(character.id, alreadyApplied ? "Kit aplicado novamente." : "Kit inicial aplicado.");
  } catch (err) {
    alert(firebaseErrorMessage(err));
  }
}

async function grantCustomItemToCharacter(characterId, button) {
  if (session.role !== "master") return alert("Somente o Mestre pode gerenciar inventarios.");
  const campaignId = String(session.campaign?.id || "");
  const name = document.getElementById("inventoryCustomName")?.value.trim();
  const description = document.getElementById("inventoryCustomDescription")?.value.trim();
  const quantity = Number.parseInt(document.getElementById("inventoryCustomQuantity")?.value, 10);
  const imageFile = document.getElementById("inventoryCustomImage")?.files?.[0];
  const equipped = Boolean(document.getElementById("inventoryCustomEquipped")?.checked);
  const notes = document.getElementById("inventoryCustomNotes")?.value.trim() || "";
  if (!name) return alert("Informe o nome do item.");
  if (!description) return alert("Informe a descricao do item.");
  if (!Number.isFinite(quantity) || quantity < 1) return alert("Informe uma quantidade valida.");
  if (!imageFile) return alert("Selecione uma foto para o item.");

  if (button) {
    button.disabled = true;
    button.textContent = "Adicionando...";
  }
  try {
    const inventoryEntryId = uid();
    const image = await readImg(imageFile, 1200, { campaignId, kind: "inventory", entityId: inventoryEntryId });
    if (String(session.campaign?.id || "") !== campaignId) throw new Error("A campanha ativa mudou durante o envio.");
    const item = {
      name,
      description,
      image
    };
    applyImageAsset(item, image);
    requireCompleteItemPresentation(item);
    await commitCharacterInventoryMutation(characterId, () => tabletop.grantItem(session.campaign, characterId, item, {
        quantity,
        equipped,
        notes,
        stack: false
      }, uid), { campaignId });
    reopenInventoryManager(characterId, "Item personalizado adicionado.");
  } catch (err) {
    console.error(err);
    alert(err.message || "Nao foi possivel adicionar o item.");
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = "Adicionar ao inventario";
    }
  }
}

async function saveInventoryEntry(characterId, inventoryId, button) {
  if (session.role !== "master") return alert("Somente o Mestre pode gerenciar inventarios.");
  const campaignId = String(session.campaign?.id || "");
  const character = session.campaign.characters.find(entry => entry.id === characterId);
  const item = character?.inventory.find(entry => entry.id === inventoryId);
  if (!item) return alert("Item do inventario nao encontrado.");

  const name = document.getElementById(`invName_${inventoryId}`)?.value.trim();
  const description = document.getElementById(`invDescription_${inventoryId}`)?.value.trim();
  const quantity = Number.parseInt(document.getElementById(`invQty_${inventoryId}`)?.value, 10);
  const imageFile = document.getElementById(`invImage_${inventoryId}`)?.files?.[0];
  const notes = document.getElementById(`invNotes_${inventoryId}`)?.value.trim() || "";
  if (!name) return alert("Informe o titulo do item.");
  if (!description) return alert("Informe a descricao do item.");
  if (!Number.isFinite(quantity) || quantity < 1) return alert("Informe uma quantidade valida.");
  if (!imageFile && !item.image) return alert("Selecione uma foto para o item.");

  if (button) {
    button.disabled = true;
    button.textContent = "Salvando...";
  }
  try {
    const uploadedImage = imageFile ? await readImg(imageFile, 1200, { campaignId, kind: "inventory", entityId: `${inventoryId}-${uid()}` }) : "";
    if (String(session.campaign?.id || "") !== campaignId) throw new Error("A campanha ativa mudou durante o envio.");
    const latestCampaign = findCampaign(campaignId);
    const latestCharacter = latestCampaign?.characters.find(entry => String(entry.id) === String(characterId));
    const latestItem = latestCharacter?.inventory.find(entry => String(entry.id) === String(inventoryId));
    if (!latestItem) throw new Error("Item do inventario nao encontrado depois do envio.");
    const changes = {
      name,
      description,
      image: uploadedImage || latestItem.image || "",
      quantity,
      notes
    };
    if (uploadedImage) applyImageAsset(changes, uploadedImage);
    requireCompleteItemPresentation(changes);
    await commitCharacterInventoryMutation(characterId, () => (
      tabletop.updateInventoryEntry(session.campaign, characterId, inventoryId, changes)
    ), { campaignId });
    reopenInventoryManager(characterId, "Inventario atualizado.");
  } catch (err) {
    console.error(err);
    alert(err.message || "Nao foi possivel atualizar o item.");
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = "Salvar";
    }
  }
}

async function toggleInventoryEquipped(characterId, inventoryId) {
  if (session.role !== "master") return alert("Somente o Mestre pode gerenciar inventarios.");
  const character = session.campaign.characters.find(entry => entry.id === characterId);
  const item = character?.inventory.find(entry => entry.id === inventoryId);
  if (!item) return;
  try {
    await commitCharacterInventoryMutation(characterId, () => (
      tabletop.updateInventoryEntry(session.campaign, characterId, inventoryId, { equipped: !item.equipped })
    ));
    reopenInventoryManager(characterId, item.equipped ? "Item equipado." : "Item desequipado.");
  } catch (err) {
    alert(firebaseErrorMessage(err));
  }
}

async function removeCharacterInventoryItem(characterId, inventoryId) {
  if (session.role !== "master") return alert("Somente o Mestre pode gerenciar inventarios.");
  if (!confirm("Remover este item do inventario?")) return;
  try {
    await commitCharacterInventoryMutation(characterId, () => (
      tabletop.removeInventoryEntry(session.campaign, characterId, inventoryId)
    ));
    reopenInventoryManager(characterId, "Item removido.");
  } catch (err) {
    alert(firebaseErrorMessage(err));
  }
}

function recordsPage(key, title) {
  return `
    <h2>${title}</h2>
    <button onclick="recordModal('${key}')">➕ Criar</button>
    <div class="grid" style="margin-top:15px;">
      ${session.campaign[key].map((x, i) => `
        <div class="card">
          ${entityVisual(x.image, x.name)}
          <h3>${esc(x.name)}</h3>
          <p>${esc(x.description)}</p>
          <button onclick="recordModal('${key}', ${i})">Editar</button>
          <button class="danger" onclick="del('${key}', ${i})">Excluir</button>
        </div>`).join("")}
    </div>`;
}

function recordModal(key, index = null) {
  const x = index === null ? { name: "", description: "", image: "" } : session.campaign[key][index];
  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2>📁 Registro</h2>
      <label>Nome</label><input id="rn" value="${esc(x.name)}">
      <label>Descrição</label><textarea id="rd">${esc(x.description)}</textarea>
      ${imgInput("ri", "Foto / Documento", x.image)}
      <br><br>
      <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
      <button id="saveRecordButton" onclick="saveRecordModal('${key}', ${index})">Salvar</button>
    </div></div>`);
}

async function saveRecordModal(key, index) {
  const isNew = index === null;
  const campaignId = String(session.campaign.id);
  const initial = isNew ? null : session.campaign[key][index];
  const recordId = String(initial?.id || uid());
  const name = document.getElementById("rn").value || "Registro";
  const description = document.getElementById("rd").value || "";
  const file = document.getElementById("ri")?.files?.[0];
  const button = document.getElementById("saveRecordButton");
  if (button) { button.disabled = true; button.textContent = "Salvando..."; }
  try {
    const image = file ? await readImg(file, 1600, { campaignId, kind: key, entityId: recordId }) : "";
    const campaign = findCampaign(campaignId);
    if (!campaign) throw new Error("Campanha nao encontrada depois do upload.");
    const current = isNew ? null : campaign[key].find(entry => String(entry.id) === recordId);
    if (!isNew && !current) throw new Error("Registro nao encontrado depois do upload.");
    const record = { ...(current || {}), id: recordId, name, description, image: image || current?.image || initial?.image || "" };
    if (image) applyImageAsset(record, image);
    if (usingFirebase() && record.image) {
      if (!isCloudinaryImage(record.image)) throw new Error("Migre a imagem antiga do registro para o Cloudinary antes de salva-lo.");
      await commitCampaignMediaMutation(campaignId, {
        basePatch: {},
        documents: [{
          collection: key,
          id: recordId,
          data: { ...record, _order: isNew ? campaign[key].length : Math.max(0, campaign[key].findIndex(entry => String(entry.id) === recordId)) }
        }],
        cloudinaryUrls: [record.image]
      });
      const confirmedCampaign = findCampaign(campaignId);
      if (!confirmedCampaign) throw new Error("Campanha nao encontrada depois da confirmacao do registro.");
      const confirmedRecord = confirmedCampaign[key].find(entry => String(entry.id) === recordId);
      if (confirmedRecord) Object.assign(confirmedRecord, record);
      else confirmedCampaign[key].push(record);
      session.campaign = confirmedCampaign;
      persistLocal();
    } else {
      if (isNew) campaign[key].push(record);
      else Object.assign(current, record);
      session.campaign = campaign;
      save();
    }
    document.querySelector(".modal")?.remove();
    render();
    toast("Salvo!");
  } catch (err) {
    console.error(err);
    alert(firebaseErrorMessage(err));
    if (button?.isConnected) { button.disabled = false; button.textContent = "Salvar"; }
  }
}

function creaturesPage() {
  return `
    <h2>👹 Criaturas</h2>
    <button onclick="creatureModal()">➕ Criar</button>
    <div class="grid" style="margin-top:15px;">
      ${session.campaign.creatures.map((x, i) => `
        <div class="card">
          ${entityVisual(x.image, x.name)}
          <h3>${esc(x.name)}</h3>
          <p>${esc(x.appearance)}</p>
          <button onclick="creatureModal(${i})">Editar</button>
          <button class="danger" onclick="del('creatures', ${i})">Excluir</button>
        </div>`).join("")}
    </div>`;
}

function creatureModal(index = null) {
  const x = index === null ? { name: "", appearance: "", image: "" } : session.campaign.creatures[index];
  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2>👹 Criatura</h2>
      <label>Nome</label><input id="crname" value="${esc(x.name)}">
      <label>Aparência / Detalhes</label><textarea id="crapp">${esc(x.appearance)}</textarea>
      ${imgInput("crim", "Foto da Criatura", x.image)}
      <br><br>
      <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
      <button id="saveCreatureButton" onclick="saveCreatureModal(${index})">Salvar</button>
    </div></div>`);
}

async function saveCreatureModal(index) {
  const isNew = index === null;
  const campaignId = String(session.campaign.id);
  const initial = isNew ? null : session.campaign.creatures[index];
  const creatureId = String(initial?.id || uid());
  const name = document.getElementById("crname").value || "Criatura";
  const appearance = document.getElementById("crapp").value || "";
  const file = document.getElementById("crim")?.files?.[0];
  const button = document.getElementById("saveCreatureButton");
  if (button) { button.disabled = true; button.textContent = "Salvando..."; }
  try {
    const image = file ? await readImg(file, 1600, { campaignId, kind: "creatures", entityId: creatureId }) : "";
    const campaign = findCampaign(campaignId);
    if (!campaign) throw new Error("Campanha nao encontrada depois do upload.");
    const current = isNew ? null : campaign.creatures.find(entry => String(entry.id) === creatureId);
    if (!isNew && !current) throw new Error("Criatura nao encontrada depois do upload.");
    const creature = { ...(current || {}), id: creatureId, name, appearance, image: image || current?.image || initial?.image || "" };
    if (image) applyImageAsset(creature, image);
    if (usingFirebase() && creature.image) {
      if (!isCloudinaryImage(creature.image)) throw new Error("Migre a imagem antiga da criatura para o Cloudinary antes de salva-la.");
      await commitCampaignMediaMutation(campaignId, {
        basePatch: {},
        documents: [{
          collection: "creatures",
          id: creatureId,
          data: { ...creature, _order: isNew ? campaign.creatures.length : Math.max(0, campaign.creatures.findIndex(entry => String(entry.id) === creatureId)) }
        }],
        cloudinaryUrls: [creature.image]
      });
      const confirmedCampaign = findCampaign(campaignId);
      if (!confirmedCampaign) throw new Error("Campanha nao encontrada depois da confirmacao da criatura.");
      const confirmedCreature = confirmedCampaign.creatures.find(entry => String(entry.id) === creatureId);
      if (confirmedCreature) Object.assign(confirmedCreature, creature);
      else confirmedCampaign.creatures.push(creature);
      session.campaign = confirmedCampaign;
      persistLocal();
    } else {
      if (isNew) campaign.creatures.push(creature);
      else Object.assign(current, creature);
      session.campaign = campaign;
      save();
    }
    document.querySelector(".modal")?.remove();
    render();
    toast("Salvo!");
  } catch (err) {
    console.error(err);
    alert(firebaseErrorMessage(err));
    if (button?.isConnected) { button.disabled = false; button.textContent = "Salvar"; }
  }
}

function evidencePage() {
  const catalog = session.campaign.evidence || [];
  return `
    <div class="page-heading evidence-page-heading">
      <div>
        <h2>🔎 Evidências</h2>
        <p class="muted">Biblioteca da campanha e posse atual.</p>
      </div>
      <button onclick="evidenceModal()">Cadastrar evidência</button>
    </div>
    <section class="evidence-library-section" aria-label="Biblioteca de evidências">
      ${catalog.length ? `<div class="evidence-library-grid">
        ${catalog.map(evidence => {
          const owner = tabletop?.findEvidenceOwner(session.campaign, evidence.id)?.character || null;
          const mutating = evidenceMutations.has(String(evidence.id));
          return `
            <article class="card evidence-library-card">
              ${entityVisual(evidence.image, evidence.title, "evidence-library-image")}
              <div class="evidence-library-copy">
                <h3 title="${esc(evidence.title)}">${esc(evidence.title)}</h3>
                <p title="${esc(evidence.description)}">${esc(evidence.description)}</p>
              </div>
              <div class="evidence-owner-status ${owner ? "is-linked" : ""}">
                <span>${owner ? "Vinculada a" : "Sem vínculo"}</span>
                ${owner ? `<strong title="${esc(owner.name)} · ${esc(owner.origin || "Sem origem")}">${esc(owner.name)} · ${esc(owner.origin || "Sem origem")}</strong>` : ""}
              </div>
              <div class="evidence-library-actions">
                <button class="secondary" ${mutating ? "disabled" : ""} onclick="evidenceModal(${jsArg(evidence.id)})">Editar</button>
                <button ${mutating ? "disabled" : ""} onclick="evidenceAssignmentModal(${jsArg(evidence.id)})">${owner ? "Alterar vínculo" : "Vincular"}</button>
                ${owner ? `<button class="secondary" ${mutating ? "disabled" : ""} onclick="unlinkEvidence(${jsArg(evidence.id)})">Desvincular</button>` : ""}
                <button class="danger" ${mutating ? "disabled" : ""} onclick="deleteEvidenceCatalogEntry(${jsArg(evidence.id)})">Excluir</button>
              </div>
            </article>`;
        }).join("")}
      </div>` : `
        <div class="empty-state evidence-library-empty">
          <h3>Nenhuma evidência cadastrada</h3>
          <p>Cadastre a primeira evidência da campanha.</p>
        </div>`}
    </section>`;
}

function evidenceModal(evidenceId = "") {
  const normalizedId = String(evidenceId || "");
  const x = normalizedId
    ? session.campaign.evidence.find(entry => String(entry.id) === normalizedId)
    : { title: "", description: "", image: "" };
  if (!x) return alert("Evidência não encontrada.");
  root.insertAdjacentHTML("beforeend", `
    <div id="evidenceModal" class="modal"><div class="modalbox evidence-modalbox">
      <h2>🔎 ${normalizedId ? "Editar evidência" : "Cadastrar evidência"}</h2>
      <label>Título <span class="required-marker">*</span></label>
      <input id="evtitle" maxlength="100" value="${esc(x.title || x.name || "")}" required>
      <label>Descrição <span class="required-marker">*</span></label>
      <textarea id="evdesc" maxlength="1200" required>${esc(x.description)}</textarea>
      ${imgInput("evimg", "Imagem da evidência", x.image, true)}
      <div class="modal-actions">
        <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
        <button id="saveEvidenceButton" onclick="saveEvidenceModal(${jsArg(normalizedId)})">Salvar</button>
      </div>
    </div></div>`);
}

async function saveEvidenceModal(evidenceId = "") {
  if (session.role !== "master" || !session.campaign) return;
  const normalizedId = String(evidenceId || "");
  const title = String(document.getElementById("evtitle")?.value || "").trim().slice(0, 100);
  const description = String(document.getElementById("evdesc")?.value || "").trim().slice(0, 1200);
  const file = document.getElementById("evimg")?.files?.[0];
  const current = normalizedId
    ? session.campaign.evidence.find(entry => String(entry.id) === normalizedId)
    : null;
  const campaignId = String(session.campaign.id);
  const targetEvidenceId = String(current?.id || uid());
  const button = document.getElementById("saveEvidenceButton");
  if (!title || !description || (!file && !current?.image)) {
    return alert("Preencha o título, a descrição e a imagem da evidência.");
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Salvando...";
  }
  try {
    const image = file
      ? await readImg(file, 1600, { campaignId, kind: "evidence", entityId: targetEvidenceId })
      : current.image;
    if (!image) throw new Error("Não foi possível processar a imagem da evidência.");
    const campaign = findCampaign(campaignId);
    if (!campaign) throw new Error("Campanha nao encontrada depois do upload.");
    const latest = normalizedId
      ? campaign.evidence.find(entry => String(entry.id) === normalizedId)
      : null;
    if (normalizedId && !latest) throw new Error("Evidencia nao encontrada depois do upload.");
    const evidence = tabletop?.normalizeEvidenceCatalogEntry
      ? tabletop.normalizeEvidenceCatalogEntry({
        ...(latest || {}),
        id: targetEvidenceId,
        title,
        description,
        image,
        createdAt: latest?.createdAt || new Date().toISOString()
      }, uid)
      : {
        ...(latest || {}),
        id: targetEvidenceId,
        title,
        name: title,
        description,
        image,
        createdAt: latest?.createdAt || new Date().toISOString()
      };
    if (file) applyImageAsset(evidence, image);
    delete evidence.revealed;
    const characterEvidenceUpdates = campaign.characters.map(character => ({
      characterId: character.id,
      evidence: (character.evidence || []).map(entry => (
        String(entry.evidenceId) === String(evidence.id)
          ? { ...entry, title, name: title, description, image, ...(evidence.imageMeta ? { imageMeta: { ...evidence.imageMeta } } : {}) }
          : entry
      ))
    })).filter(update => {
      const character = campaign.characters.find(entry => String(entry.id) === String(update.characterId));
      return JSON.stringify(character?.evidence || []) !== JSON.stringify(update.evidence);
    });

    if (usingFirebase()) {
      if (!isCloudinaryImage(evidence.image)) throw new Error("Migre a imagem antiga da evidencia para o Cloudinary antes de salva-la.");
      await commitCampaignMediaMutation(campaignId, {
        basePatch: {},
        documents: [
          {
            collection: "evidence",
            id: targetEvidenceId,
            data: {
              ...evidence,
              _order: latest ? Math.max(0, campaign.evidence.findIndex(entry => String(entry.id) === targetEvidenceId)) : -1
            }
          },
          ...characterEvidenceUpdates.map(update => ({
            collection: "characters",
            id: update.characterId,
            data: { evidence: update.evidence }
          }))
        ],
        cloudinaryUrls: [evidence.image]
      });
      const confirmedCampaign = findCampaign(campaignId);
      if (!confirmedCampaign) throw new Error("Campanha nao encontrada depois da confirmacao da evidencia.");
      const confirmedEvidence = confirmedCampaign.evidence.find(entry => String(entry.id) === targetEvidenceId);
      if (confirmedEvidence) Object.assign(confirmedEvidence, evidence);
      else confirmedCampaign.evidence.unshift(evidence);
      characterEvidenceUpdates.forEach(update => {
        const character = confirmedCampaign.characters.find(entry => String(entry.id) === String(update.characterId));
        if (character) character.evidence = update.evidence;
      });
      session.campaign = confirmedCampaign;
      persistLocal();
    } else {
      if (latest) Object.assign(latest, evidence);
      else campaign.evidence.unshift(evidence);
      characterEvidenceUpdates.forEach(update => {
        const character = campaign.characters.find(entry => String(entry.id) === String(update.characterId));
        if (character) character.evidence = update.evidence;
      });
      session.campaign = campaign;
      save();
    }
    document.getElementById("evidenceModal")?.remove();
    render();
    toast("Evidência salva na biblioteca.");
  } catch (err) {
    console.error(err);
    alert(firebaseErrorMessage(err));
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = "Salvar";
    }
  }
}

function evidenceAssignmentModal(evidenceId) {
  if (session.role !== "master" || !session.campaign) return;
  const normalizedId = String(evidenceId || "");
  const evidence = session.campaign.evidence.find(entry => String(entry.id) === normalizedId);
  if (!evidence) return alert("Evidência não encontrada.");
  if (!session.campaign.characters.length) return alert("Crie um personagem antes de vincular uma evidência.");
  const owner = tabletop?.findEvidenceOwner(session.campaign, normalizedId)?.character || null;

  root.insertAdjacentHTML("beforeend", `
    <div id="evidenceAssignmentModal" class="modal"><div class="modalbox evidence-modalbox">
      <h2>Vincular evidência</h2>
      <div class="evidence-assignment-preview">
        ${entityVisual(evidence.image, evidence.title, "evidence-assignment-image")}
        <div><strong>${esc(evidence.title)}</strong><p>${esc(evidence.description)}</p></div>
      </div>
      <label>Personagem portador</label>
      <select id="evidenceOwnerCharacter">
        <option value="" ${owner ? "" : "selected"}>Sem vínculo</option>
        ${session.campaign.characters.map(character => `
          <option value="${esc(character.id)}" ${String(character.id) === String(owner?.id || "") ? "selected" : ""}>${esc(character.name)} - ${esc(character.origin || "Sem origem")}</option>
        `).join("")}
      </select>
      <div class="modal-actions">
        <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
        <button id="saveEvidenceAssignmentButton" onclick="saveEvidenceAssignment(${jsArg(normalizedId)})">Salvar vínculo</button>
      </div>
    </div></div>`);
}

async function saveEvidenceAssignment(evidenceId) {
  const targetCharacterId = String(document.getElementById("evidenceOwnerCharacter")?.value || "");
  await updateEvidenceOwner(evidenceId, targetCharacterId || null, true);
}

async function unlinkEvidence(evidenceId) {
  const evidence = session.campaign?.evidence?.find(entry => String(entry.id) === String(evidenceId));
  if (!evidence || !confirm(`Desvincular a evidência "${evidence.title}" do personagem atual?`)) return;
  await updateEvidenceOwner(evidenceId, null, false);
}

async function updateEvidenceOwner(evidenceId, targetCharacterId = null, closeModal = false) {
  if (session.role !== "master" || !session.campaign) return;
  const campaignId = String(session.campaign.id);
  const normalizedId = String(evidenceId || "");
  if (evidenceMutations.has(normalizedId)) return;
  const button = document.getElementById("saveEvidenceAssignmentButton");
  if (button) {
    button.disabled = true;
    button.textContent = "Salvando...";
  }

  let campaign = null;
  let previousEvidence = null;
  let releaseSnapshotProtection = null;
  evidenceMutations.add(normalizedId);
  try {
    releaseSnapshotProtection = protectCampaignFromSnapshots(campaignId);
    if (usingFirebase()) await flushBeforeAtomicCampaignMutation(campaignId);
    campaign = findCampaign(campaignId);
    if (String(session.campaign?.id || "") !== campaignId) throw new Error("A campanha ativa mudou durante a operacao.");
    previousEvidence = new Map(campaign.characters.map(character => [
      String(character.id),
      JSON.parse(JSON.stringify(character.evidence || []))
    ]));
    tabletop.assignEvidence(campaign, normalizedId, targetCharacterId, uid);
    const characterUpdates = campaign.characters
      .filter(character => JSON.stringify(previousEvidence.get(String(character.id)) || []) !== JSON.stringify(character.evidence || []))
      .map(character => ({ characterId: character.id, evidence: character.evidence }));
    persistLocal();

    if (usingFirebase() && characterUpdates.length) {
      await window.CDIFirebase.updateCharacterEvidenceAssignments(campaign.id, characterUpdates);
      lastSavedCampaignJson = JSON.stringify(campaign);
    } else if (!usingFirebase()) {
      save();
    }
    if (closeModal) document.getElementById("evidenceAssignmentModal")?.remove();
    toast(targetCharacterId ? "Evidência vinculada ao personagem." : "Evidência desvinculada.");
  } catch (err) {
    console.error(err);
    if (campaign && previousEvidence) {
      campaign.characters.forEach(character => {
        const previous = previousEvidence.get(String(character.id));
        if (previous) character.evidence = previous;
      });
      persistLocal();
    }
    alert(firebaseErrorMessage(err));
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = "Salvar vínculo";
    }
  } finally {
    releaseSnapshotProtection?.();
    evidenceMutations.delete(normalizedId);
    render();
  }
}

async function deleteEvidenceCatalogEntry(evidenceId) {
  if (session.role !== "master" || !session.campaign) return;
  const campaignId = String(session.campaign.id);
  const normalizedId = String(evidenceId || "");
  const evidence = session.campaign.evidence.find(entry => String(entry.id) === normalizedId);
  if (!evidence || evidenceMutations.has(normalizedId)) return;
  const owner = tabletop?.findEvidenceOwner(session.campaign, normalizedId)?.character || null;
  const warning = owner
    ? `Excluir a evidência "${evidence.title}" e removê-la de ${owner.name}?`
    : `Excluir a evidência "${evidence.title}" da biblioteca?`;
  if (!confirm(warning)) return;

  let campaign = null;
  let previousCatalog = null;
  let previousEvidence = null;
  let releaseSnapshotProtection = null;
  evidenceMutations.add(normalizedId);
  render();
  try {
    releaseSnapshotProtection = protectCampaignFromSnapshots(campaignId);
    if (usingFirebase()) await flushBeforeAtomicCampaignMutation(campaignId);
    campaign = findCampaign(campaignId);
    if (String(session.campaign?.id || "") !== campaignId) throw new Error("A campanha ativa mudou durante a operacao.");
    previousCatalog = JSON.parse(JSON.stringify(campaign.evidence || []));
    previousEvidence = new Map(campaign.characters.map(character => [
      String(character.id),
      JSON.parse(JSON.stringify(character.evidence || []))
    ]));
    campaign.evidence = campaign.evidence.filter(entry => String(entry.id) !== normalizedId);
    const characterUpdates = [];
    campaign.characters.forEach(character => {
      const nextEvidence = (character.evidence || []).filter(entry => String(entry.evidenceId) !== normalizedId);
      if (nextEvidence.length !== (character.evidence || []).length) {
        character.evidence = nextEvidence;
        characterUpdates.push({ characterId: character.id, evidence: character.evidence });
      }
    });
    persistLocal();

    if (usingFirebase()) {
      await window.CDIFirebase.deleteEvidenceCatalogEntry(campaign.id, normalizedId, characterUpdates);
      lastSavedCampaignJson = JSON.stringify(campaign);
    } else {
      save();
    }
    toast("Evidência excluída da biblioteca.");
  } catch (err) {
    console.error(err);
    if (campaign && previousCatalog && previousEvidence) {
      campaign.evidence = previousCatalog;
      campaign.characters.forEach(character => {
        const previous = previousEvidence.get(String(character.id));
        if (previous) character.evidence = previous;
      });
      persistLocal();
    }
    alert(firebaseErrorMessage(err));
  } finally {
    releaseSnapshotProtection?.();
    evidenceMutations.delete(normalizedId);
    render();
  }
}

function marksPage() {
  return `
    <h2>🏷️ Marcas</h2>
    <button onclick="markModal()">➕ Criar</button>
    <div class="grid" style="margin-top:15px;">
      ${session.campaign.marks.map((x, i) => `
        <div class="card">
          ${entityVisual(x.image, x.name)}
          <h3>${esc(x.name)}</h3>
          <p>${esc(x.description)}</p>
          <button onclick="markModal(${i})">Editar</button>
          <button class="danger" onclick="del('marks', ${i})">Excluir</button>
        </div>`).join("")}
    </div>`;
}

function markModal(index = null) {
  const x = index === null ? { name: "", description: "", image: "" } : session.campaign.marks[index];
  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2>🏷️ Marca</h2>
      <label>Nome</label><input id="mkname" value="${esc(x.name)}">
      <label>Descrição</label><textarea id="mkdesc">${esc(x.description)}</textarea>
      ${imgInput("mkimg", "Foto da Marca", x.image)}
      <br><br>
      <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
      <button id="saveMarkButton" onclick="saveMarkModal(${index})">Salvar</button>
    </div></div>`);
}

async function saveMarkModal(index) {
  const isNew = index === null;
  const campaignId = String(session.campaign.id);
  const initial = isNew ? null : session.campaign.marks[index];
  const markId = String(initial?.id || uid());
  const name = document.getElementById("mkname").value || "Marca";
  const description = document.getElementById("mkdesc").value || "";
  const file = document.getElementById("mkimg")?.files?.[0];
  const button = document.getElementById("saveMarkButton");
  if (button) { button.disabled = true; button.textContent = "Salvando..."; }
  try {
    const image = file ? await readImg(file, 1200, { campaignId, kind: "marks", entityId: markId }) : "";
    const campaign = findCampaign(campaignId);
    if (!campaign) throw new Error("Campanha nao encontrada depois do upload.");
    const current = isNew ? null : campaign.marks.find(entry => String(entry.id) === markId);
    if (!isNew && !current) throw new Error("Marca nao encontrada depois do upload.");
    const mark = { ...(current || {}), id: markId, name, description, image: image || current?.image || initial?.image || "" };
    if (image) applyImageAsset(mark, image);
    if (usingFirebase() && mark.image) {
      if (!isCloudinaryImage(mark.image)) throw new Error("Migre a imagem antiga da marca para o Cloudinary antes de salva-la.");
      await commitCampaignMediaMutation(campaignId, {
        basePatch: {},
        documents: [{
          collection: "marks",
          id: markId,
          data: { ...mark, _order: isNew ? campaign.marks.length : Math.max(0, campaign.marks.findIndex(entry => String(entry.id) === markId)) }
        }],
        cloudinaryUrls: [mark.image]
      });
      const confirmedCampaign = findCampaign(campaignId);
      if (!confirmedCampaign) throw new Error("Campanha nao encontrada depois da confirmacao da marca.");
      const confirmedMark = confirmedCampaign.marks.find(entry => String(entry.id) === markId);
      if (confirmedMark) Object.assign(confirmedMark, mark);
      else confirmedCampaign.marks.push(mark);
      session.campaign = confirmedCampaign;
      persistLocal();
    } else {
      if (isNew) campaign.marks.push(mark);
      else Object.assign(current, mark);
      session.campaign = campaign;
      save();
    }
    document.querySelector(".modal")?.remove();
    render();
    toast("Salvo!");
  } catch (err) {
    console.error(err);
    alert(firebaseErrorMessage(err));
    if (button?.isConnected) { button.disabled = false; button.textContent = "Salvar"; }
  }
}

function toggleReveal(key, i, val) {
  session.campaign[key][i].revealed = val;
  save(); toast("Atualizado!");
}

function playersPage() {
  const c = session.campaign;
  return `
    <h2>🔐 Jogadores</h2>
    <button onclick="newPlayerModal()">➕ Novo Jogador</button>
    <div class="grid" style="margin-top:15px;">
      ${c.players.map((p, i) => {
        const character = c.characters.find(ch => ch.id === p.characterId);
        const presence = tabletop?.presenceState(p) || "offline";
        return `
        <div class="card">
          ${entityVisual(character?.image, character?.name || p.name, "player-card-image")}
          <div class="card-title-row">
            <h3>${esc(p.name)}</h3>
            <span class="status-chip ${p.authUid ? `status-${presence}` : "status-pending"}">${p.authUid ? (presence === "online" ? "Online" : presence === "away" ? "Ausente" : "Offline") : "Convite pendente"}</span>
          </div>
          ${p.email ? `<p class="muted">${esc(p.email)}</p>` : ""}
          <p class="player-character-line">Personagem: <b>${character ? esc(character.name) : "Nenhum"}</b></p>
          <button onclick="linkPlayerModal(${i})">Vincular Personagem</button>
          ${character ? `<button class="secondary" onclick="manageCharacterInventoryModal('${character.id}')">Gerenciar Inventario</button>` : ""}
          <button class="danger" onclick="delPlayer(${i})">Remover</button>
        </div>`;
      }).join("") || `<div class="empty-state"><h3>Nenhum jogador configurado</h3></div>`}
    </div>`;
}

function newPlayerModal() {
  if (usingFirebase()) {
    root.insertAdjacentHTML("beforeend", `
      <div class="modal"><div class="modalbox">
        <h2>🔐 Jogador</h2>
        <label>Nome</label><input id="jn">
        <label>E-mail da conta Firebase</label><input id="je" type="email" placeholder="jogador@email.com">
        <br><br>
        <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
        <button onclick="saveNewPlayer()">Salvar</button>
      </div></div>`);
    return;
  }
  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2>🔐 Jogador</h2>
      <label>Nome</label><input id="jn">
      <label>Senha</label><input id="jp" type="password">
      <br><br>
      <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
      <button onclick="saveNewPlayer()">Salvar</button>
    </div></div>`);
}

function saveNewPlayer() {
  const name = document.getElementById("jn").value.trim();
  if (usingFirebase()) {
    const email = document.getElementById("je").value.trim();
    if (!name || !email) return alert("Preencha nome e e-mail.");
    const emailNormalized = tabletop.normalizeEmail(email);
    if (session.campaign.players.some(player => tabletop.normalizeEmail(player.emailNormalized || player.email) === emailNormalized)) {
      return alert("Ja existe um jogador configurado com este e-mail.");
    }
    session.campaign.players.push({
      id: uid(),
      name,
      email,
      emailNormalized,
      authUid: null,
      characterId: null,
      status: "pending",
      online: false,
      lastSeen: null,
      joinedAt: null
    });
    save(); document.querySelector(".modal").remove(); render(); toast("Jogador adicionado!");
    return;
  }
  const password = document.getElementById("jp").value;
  if (!name || !password) return alert("Preencha tudo.");
  session.campaign.players.push({ id: uid(), name, password, characterId: null });
  save(); document.querySelector(".modal").remove(); render(); toast("Jogador adicionado!");
}

function linkPlayerModal(playerIndex) {
  const p = session.campaign.players[playerIndex];
  const chars = session.campaign.characters;
  const assignedByCharacter = new Map(session.campaign.players
    .filter(player => player.id !== p.id && player.characterId)
    .map(player => [player.characterId, player.name]));
  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2>🔗 Vincular Personagem a ${esc(p.name)}</h2>
      <label>Personagem</label>
      <select id="linkCharSel">
        <option value="">Nenhum</option>
        ${chars.map(ch => {
          const assignedTo = assignedByCharacter.get(ch.id);
          return `<option value="${ch.id}" ${p.characterId === ch.id ? "selected" : ""} ${assignedTo ? "disabled" : ""}>${esc(ch.name)}${assignedTo ? ` - vinculado a ${esc(assignedTo)}` : ""}</option>`;
        }).join("")}
      </select>
      <br><br>
      <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
      <button onclick="saveLinkPlayer(${playerIndex}, this)">Salvar</button>
    </div></div>`);
}

async function saveLinkPlayer(playerIndex, button) {
  const chId = document.getElementById("linkCharSel").value;
  const player = session.campaign.players[playerIndex];
  const campaignId = session.campaign?.id;
  const linkKey = `${campaignId}:${player?.id || ""}`;
  if (!campaignId || !player || linkingPlayers.has(linkKey)) return;
  const releaseSnapshotProtection = protectCampaignFromSnapshots(campaignId);

  linkingPlayers.add(linkKey);
  if (button) {
    button.disabled = true;
    button.textContent = "Salvando...";
  }
  try {
    if (usingFirebase()) {
      await flushBeforeAtomicCampaignMutation(campaignId);
      const result = await window.CDIFirebase.assignPlayerCharacter(campaignId, player.id, chId || null);
      const currentCampaign = findCampaign(campaignId)
        || (session.campaign?.id === campaignId ? session.campaign : null);
      const currentPlayer = currentCampaign?.players.find(entry => entry.id === player.id);
      if (currentCampaign && currentPlayer) {
        const previousCharacter = currentCampaign.characters.find(character => character.id === result.previousCharacterId);
        if (previousCharacter?.controllerPlayerId === currentPlayer.id && result.previousCharacterId !== result.player.characterId) {
          previousCharacter.controllerPlayerId = null;
        }
        Object.assign(currentPlayer, result.player);
        const nextCharacter = result.player.characterId
          ? currentCampaign.characters.find(character => character.id === result.player.characterId)
          : null;
        if (nextCharacter) nextCharacter.controllerPlayerId = currentPlayer.id;
        normalizeCampaign(currentCampaign);
        persistLocal();
        persistSessionContext();
        if (session.campaign?.id === campaignId) lastSavedCampaignJson = JSON.stringify(currentCampaign);
      }
    } else {
      tabletop.assignCharacter(session.campaign, player.id, chId || null);
      save();
    }
    button?.closest(".modal")?.remove();
    render();
    toast(chId ? "Vinculado com sucesso!" : "Vinculo removido.");
  } catch (err) {
    console.error(err);
    alert(err.message);
  } finally {
    releaseSnapshotProtection();
    linkingPlayers.delete(linkKey);
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = "Salvar";
    }
  }
}

function delPlayer(i) {
  const player = session.campaign.players[i];
  if (!player || !confirm(`Remover ${player.name} da campanha?`)) return;
  tabletop.releasePlayer(session.campaign, player.id);
  if (player.authUid) session.campaign.members = (session.campaign.members || []).filter(id => id !== player.authUid);
  session.campaign.players.splice(i, 1);
  save(); render();
}

function del(key, i) {
  const target = session.campaign[key]?.[i];
  if (!target) return;
  const assignedPlayers = key === "characters"
    ? session.campaign.players.filter(player => player.characterId === target.id)
    : [];
  const warning = assignedPlayers.length
    ? `Excluir este personagem? O vinculo com ${assignedPlayers.map(player => player.name).join(", ")} tambem sera removido.`
    : "Excluir item?";
  if (!confirm(warning)) return;
  assignedPlayers.forEach(player => tabletop.releasePlayer(session.campaign, player.id));
  session.campaign[key].splice(i, 1);
  save(); render();
}

const INVENTORY_BASE_SLOTS = 24;
const INVENTORY_COLUMNS = 6;

function inventorySlotVisual(item) {
  if (item.image) {
    return `<img class="inventory-slot-image" ${imageSourceAttrs(item.image, "thumb")} alt="" loading="lazy" decoding="async">`;
  }
  const initial = String(item.name || "?").trim().slice(0, 1).toUpperCase() || "?";
  return `<span class="inventory-slot-fallback" aria-hidden="true">${esc(initial)}</span>`;
}

function inventoryItemDetails(item) {
  if (!item) {
    return `
      <div class="inventory-detail-empty">
        <span aria-hidden="true"><b>?</b></span>
        <h3>Mochila vazia</h3>
        <p>Nenhum item carregado.</p>
      </div>`;
  }

  const quantity = Math.max(1, Number(item.quantity) || 1);
  return `
    <div class="inventory-detail-visual">
      ${entityVisual(item.image, item.name, "inventory-detail-image")}
      ${item.equipped ? `<span class="inventory-equipped-badge">Equipado</span>` : ""}
    </div>
    <div class="inventory-detail-copy">
      <div class="inventory-detail-title">
        <h3>${esc(item.name)}</h3>
        <span>${quantity}x</span>
      </div>
      <p class="inventory-detail-description">${esc(item.description || "Sem descricao.")}</p>
      ${item.notes ? `
        <div class="inventory-detail-notes">
          <strong>Observacoes</strong>
          <p>${esc(item.notes)}</p>
        </div>` : ""}
    </div>`;
}

function inspectInventoryItem(inventoryId, button) {
  if (session.role !== "player") return;
  const character = session.campaign?.characters.find(entry => entry.id === session.player?.characterId);
  const item = character?.inventory?.find(entry => String(entry.id) === String(inventoryId));
  const details = document.getElementById("inventoryItemDetails");
  if (!item || !details) return;

  details.innerHTML = inventoryItemDetails(item);
  document.querySelectorAll(".inventory-slot.is-selected").forEach(slot => slot.classList.remove("is-selected"));
  button?.classList.add("is-selected");
}

function inventoryPlayer(ch) {
  const items = ch.inventory || [];
  const slotCount = Math.max(INVENTORY_BASE_SLOTS, Math.ceil(items.length / INVENTORY_COLUMNS) * INVENTORY_COLUMNS);
  const emptySlots = Math.max(0, slotCount - items.length);
  const totalUnits = items.reduce((total, item) => total + Math.max(1, Number(item.quantity) || 1), 0);
  const equippedItems = items.filter(item => item.equipped).length;

  return `
    <section class="rpg-inventory-page" aria-label="Inventario de ${esc(ch.name)}">
      <header class="inventory-page-heading">
        <div class="inventory-title-lockup">
          <span class="inventory-eyebrow">Mochila pessoal</span>
          <h2>Inventario</h2>
          <p>${esc(ch.name)}</p>
        </div>
        <div class="inventory-summary" aria-label="Resumo do inventario">
          <span><strong>${items.length}/${slotCount}</strong><small>espacos</small></span>
          <span><strong>${totalUnits}</strong><small>unidades</small></span>
          <span><strong>${equippedItems}</strong><small>equipados</small></span>
        </div>
      </header>

      <div class="inventory-frame">
        <div class="inventory-frame-heading">
          <div>
            <span class="inventory-frame-mark" aria-hidden="true"></span>
            <h3>Mochila de ${esc(ch.name)}</h3>
          </div>
          <span>${items.length ? `${items.length} tipo${items.length === 1 ? "" : "s"} de item` : "Vazia"}</span>
        </div>

        <div class="inventory-workspace">
          <div class="inventory-grid-panel">
            <div class="inventory-slot-grid" role="list" aria-label="Itens carregados">
              ${items.map((item, index) => {
                const quantity = Math.max(1, Number(item.quantity) || 1);
                return `
                  <button type="button"
                    class="inventory-slot is-filled${index === 0 ? " is-selected" : ""}${item.equipped ? " is-equipped" : ""}"
                    role="listitem"
                    title="${esc(item.name)} (${quantity}x)"
                    aria-label="${esc(item.name)}, quantidade ${quantity}${item.equipped ? ", equipado" : ""}"
                    onclick="inspectInventoryItem(${jsArg(item.id)}, this)">
                    ${inventorySlotVisual(item)}
                    ${quantity > 1 ? `<span class="inventory-slot-quantity">${quantity}</span>` : ""}
                    ${item.equipped ? `<span class="inventory-slot-equipped" title="Equipado" aria-hidden="true">&#10003;</span>` : ""}
                  </button>`;
              }).join("")}
              ${Array.from({ length: emptySlots }, () => `<span class="inventory-slot is-empty" aria-hidden="true"></span>`).join("")}
            </div>
          </div>

          <aside class="inventory-detail" id="inventoryItemDetails" aria-live="polite">
            ${inventoryItemDetails(items[0])}
          </aside>
        </div>
      </div>
    </section>`;
}

function evidencePlayer(ch) {
  const evidence = ch.evidence || [];
  const slotCount = Math.max(INVENTORY_BASE_SLOTS, Math.ceil(evidence.length / INVENTORY_COLUMNS) * INVENTORY_COLUMNS);
  const emptySlots = Math.max(0, slotCount - evidence.length);
  return `
    <section class="rpg-inventory-page evidence-player-page" aria-label="Arquivo de evidencias">
      <header class="inventory-page-heading">
        <div class="inventory-title-lockup">
          <span class="inventory-eyebrow">Arquivo pessoal</span>
          <h2>Evidências</h2>
          <p>Origem: ${esc(ch.origin || "Sem origem")}</p>
        </div>
        <div class="inventory-summary" aria-label="Resumo das evidencias">
          <span><strong>${evidence.length}/${slotCount}</strong><small>espaços</small></span>
          <span><strong>${evidence.length}</strong><small>evidências</small></span>
        </div>
      </header>

      <div class="inventory-frame evidence-archive-frame">
        <div class="inventory-frame-heading">
          <div>
            <span class="inventory-frame-mark" aria-hidden="true"></span>
            <h3>Arquivo de evidências</h3>
          </div>
          <span>${evidence.length ? `${evidence.length} registro${evidence.length === 1 ? "" : "s"}` : "Vazio"}</span>
        </div>

        <div class="inventory-workspace">
          <div class="inventory-grid-panel">
            <div class="inventory-slot-grid" role="list" aria-label="Evidencias vinculadas">
              ${evidence.map((entry, index) => `
                <button type="button"
                  class="inventory-slot evidence-slot is-filled${index === 0 ? " is-selected" : ""}"
                  role="listitem"
                  title="${esc(entry.title)}"
                  aria-label="Evidencia ${esc(entry.title)}"
                  onclick="inspectCharacterEvidence(${jsArg(entry.id)}, this)">
                  ${inventorySlotVisual({ ...entry, name: entry.title })}
                </button>`).join("")}
              ${Array.from({ length: emptySlots }, () => `<span class="inventory-slot evidence-slot is-empty" aria-hidden="true"></span>`).join("")}
            </div>
          </div>

          <aside class="inventory-detail evidence-detail" id="characterEvidenceDetails" aria-live="polite">
            ${characterEvidenceDetails(evidence[0])}
          </aside>
        </div>
      </div>
    </section>`;
}

function characterEvidenceDetails(evidence) {
  if (!evidence) {
    return `
      <div class="inventory-detail-empty">
        <span aria-hidden="true"><b>?</b></span>
        <h3>Arquivo vazio</h3>
        <p>Nenhuma evidência vinculada.</p>
      </div>`;
  }
  return `
    <div class="inventory-detail-visual">
      ${entityVisual(evidence.image, evidence.title, "inventory-detail-image evidence-detail-image")}
    </div>
    <div class="inventory-detail-copy">
      <div class="inventory-detail-title">
        <h3>${esc(evidence.title)}</h3>
        <span>Evidência</span>
      </div>
      <p class="inventory-detail-description">${esc(evidence.description || "Sem descrição.")}</p>
    </div>`;
}

function inspectCharacterEvidence(evidenceEntryId, button) {
  if (session.role !== "player") return;
  const character = session.campaign?.characters.find(entry => entry.id === session.player?.characterId);
  const evidence = character?.evidence?.find(entry => String(entry.id) === String(evidenceEntryId));
  const details = document.getElementById("characterEvidenceDetails");
  if (!evidence || !details) return;
  details.innerHTML = characterEvidenceDetails(evidence);
  document.querySelectorAll(".evidence-slot.is-selected").forEach(slot => slot.classList.remove("is-selected"));
  button?.classList.add("is-selected");
}

// --- ROLADOR DE DADOS ---
function openDiceRoller() {
  const c = session.campaign;
  const logs = diceLogsNewestFirst(c?.diceLogs || []);
  root.insertAdjacentHTML("beforeend", `
    <div class="modal ritual-modal" id="diceModal"><div class="modalbox dice-modalbox">
      <div class="dice-modal-heading"><span class="ritual-sigil" aria-hidden="true">✦</span><h2>Rolador de Dados</h2></div>
      <div class="dice-grid">
        ${[4, 6, 8, 10, 12, 20, 100].map(s => `<button onclick="rollDice(${s})">d${s}</button>`).join("")}
      </div>
      <div class="dice-result" id="diceResult">Escolha um dado</div>
      <div id="diceHistory" class="dice-history">${diceHistoryPreview(logs)}</div>
      <div class="modal-actions"><button class="secondary" onclick="document.getElementById('diceModal').remove()">Fechar</button></div>
    </div></div>`);
}

function diceHistoryPreview(logs = session.campaign?.diceLogs || []) {
  return diceLogsNewestFirst(logs).slice(0, 5)
    .map(roll => `<b>${esc(roll.author || roll.origin || "Mestre")}</b>: ${Number(roll.total)}`)
    .join("<br>") || "Sem rolagens.";
}

function updateDiceRollerResult(roll) {
  let resEl = document.getElementById("diceResult");
  if (!resEl) {
    openDiceRoller();
    resEl = document.getElementById("diceResult");
  }
  if (resEl) {
    resEl.innerHTML = `${roll.label ? `<b>${esc(roll.label)}</b>: ` : ""}Resultado: <span class="dice-total">${roll.total}</span>${esc(roll.bonusText)}`;
    resEl.classList.remove("is-revealed");
    void resEl.offsetWidth;
    resEl.classList.add("is-revealed");
  }
  const historyEl = document.getElementById("diceHistory");
  if (historyEl) historyEl.innerHTML = diceHistoryPreview();
}

async function rollDice(sides, bonus = 0, label = "") {
  const campaign = session.campaign;
  if (!campaign) {
    toast("Entre em uma campanha para rolar dados.");
    return null;
  }

  const parsedSides = Math.max(2, Math.trunc(Number(sides) || 20));
  const parsedBonus = Math.trunc(Number(bonus) || 0);
  const die = Math.floor(Math.random() * parsedSides) + 1;
  const total = die + parsedBonus;
  const bonusText = parsedBonus !== 0 ? ` (${die} ${parsedBonus >= 0 ? "+" : ""}${parsedBonus})` : "";
  const now = new Date();
  const isPlayerRoll = session.role === "player";
  const character = isPlayerRoll
    ? campaign.characters.find(entry => String(entry.id) === String(session.player?.characterId || ""))
    : null;
  const origin = isPlayerRoll
    ? (String(character?.origin || character?.class || "Sem origem").trim() || "Sem origem")
    : "Mestre";
  const roll = {
    id: uid(),
    author: origin,
    authorId: firebaseUser?.uid || (isPlayerRoll ? session.player?.authUid || session.player?.id : session.currentMaster?.id) || "",
    playerId: isPlayerRoll ? session.player?.id : undefined,
    characterId: isPlayerRoll ? character?.id : undefined,
    rollerRole: isPlayerRoll ? "player" : "master",
    origin,
    sides: parsedSides,
    die,
    bonus: parsedBonus,
    bonusText,
    total,
    label: String(label || ""),
    time: `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`,
    createdAt: now.toISOString()
  };

  campaign.diceLogs ??= [];
  campaign.diceLogs.unshift(roll);
  if (campaign.diceLogs.length > 50) campaign.diceLogs.length = 50;
  persistLocal();
  updateDiceRollerResult(roll);

  try {
    if (usingFirebase()) {
      const stored = await window.CDIFirebase.recordDiceRoll(campaign.id, roll);
      Object.assign(roll, stored);
      lastSavedCampaignJson = JSON.stringify(campaign);
    } else {
      save();
    }
    announceDiceRoll(roll, campaign);
    return roll;
  } catch (err) {
    console.error(err);
    campaign.diceLogs = campaign.diceLogs.filter(entry => String(entry.id) !== String(roll.id));
    persistLocal();
    const historyEl = document.getElementById("diceHistory");
    if (historyEl) historyEl.innerHTML = diceHistoryPreview();
    toast("O resultado saiu, mas nao foi salvo no historico.");
    return null;
  }
}

function rollAttribute(name, mod) { return rollDice(20, mod, `Atributo: ${name}`); }
function rollSkill(name, mod) { return rollDice(20, mod, `Habilidade: ${name}`); }

normalizeState();
document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement) return;
  document.querySelectorAll("#sceneStage, #gameBoardStage").forEach(restoreImageAfterFullscreen);
});
if (window.CDIFirebase) initFirebaseBridge();
render();
            
