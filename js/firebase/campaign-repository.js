import { SUBCOLLECTION_KEYS } from "./constants.js";
import { makeId, stripUndefined, withRetry } from "./utils.js";

export function createCampaignRepository(ctx) {
  const { api, auth, db, projectId } = ctx;
  const campaignSaveCache = new Map();
  const restBaseUrl = projectId
    ? `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`
    : "";

  function splitCampaign(campaign) {
    const base = { ...campaign };
    const collections = {};
    SUBCOLLECTION_KEYS.forEach(key => {
      collections[key] = Array.isArray(base[key]) ? base[key] : [];
      delete base[key];
    });
    return { base, collections };
  }

  function mergeCampaign(base, collections = {}) {
    const campaign = { ...base };
    SUBCOLLECTION_KEYS.forEach(key => {
      const splitItems = collections[key] || [];
      campaign[key] = splitItems.length ? splitItems : (Array.isArray(base[key]) ? base[key] : []);
    });
    return campaign;
  }

  function cleanSubDoc(item, order) {
    return stripUndefined({ ...item, id: String(item.id), _order: order });
  }

  function sortSubDocs(docs) {
    return docs
      .map(d => {
        const { _order, ...data } = d;
        return { data, order: Number.isFinite(_order) ? _order : Number.MAX_SAFE_INTEGER };
      })
      .sort((a, b) => a.order - b.order || String(a.data.id).localeCompare(String(b.data.id)))
      .map(x => x.data);
  }

  function cloneCollections(collections = {}) {
    return Object.fromEntries(SUBCOLLECTION_KEYS.map(key => [
      key,
      JSON.parse(JSON.stringify(collections[key] || []))
    ]));
  }

  async function authHeaders() {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error("Usuario nao autenticado.");
    return { Authorization: `Bearer ${token}` };
  }

  function decodeFirestoreValue(value) {
    if (!value) return null;
    if ("stringValue" in value) return value.stringValue;
    if ("integerValue" in value) return Number(value.integerValue);
    if ("doubleValue" in value) return Number(value.doubleValue);
    if ("booleanValue" in value) return Boolean(value.booleanValue);
    if ("nullValue" in value) return null;
    if ("timestampValue" in value) return value.timestampValue;
    if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeFirestoreValue);
    if ("mapValue" in value) return decodeFirestoreFields(value.mapValue.fields || {});
    return null;
  }

  function decodeFirestoreFields(fields = {}) {
    return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]));
  }

  function decodeFirestoreDocument(doc) {
    if (!doc) return null;
    const id = String(doc.name || "").split("/").pop();
    return { id, ...decodeFirestoreFields(doc.fields || {}) };
  }

  function encodeFirestoreValue(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreValue) } };
    if (typeof value === "boolean") return { booleanValue: value };
    if (typeof value === "number") {
      return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    }
    if (typeof value === "object") {
      return { mapValue: { fields: encodeFirestoreFields(value) } };
    }
    return { stringValue: String(value) };
  }

  function encodeFirestoreFields(data = {}) {
    return Object.fromEntries(Object.entries(stripUndefined(data)).map(([key, value]) => [key, encodeFirestoreValue(value)]));
  }

  async function restFetch(path, options = {}) {
    if (!restBaseUrl) throw new Error("Firebase projectId nao configurado.");
    const headers = {
      ...(await authHeaders()),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    };
    const response = await fetch(`${restBaseUrl}/${path}`, { ...options, headers });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error?.message || "Falha ao acessar Firestore REST.");
    return body;
  }

  async function restGetDoc(path) {
    try {
      return decodeFirestoreDocument(await restFetch(path));
    } catch (err) {
      if (String(err.message || "").includes("NOT_FOUND")) return null;
      throw err;
    }
  }

  async function restListCollection(path) {
    const body = await restFetch(path);
    return (body.documents || []).map(decodeFirestoreDocument);
  }

  async function restPatchDoc(path, data) {
    const fields = encodeFirestoreFields(data);
    const mask = Object.keys(fields).map(key => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join("&");
    const suffix = mask ? `?${mask}` : "";
    return decodeFirestoreDocument(await restFetch(`${path}${suffix}`, {
      method: "PATCH",
      body: JSON.stringify({ fields })
    }));
  }

  async function getSubcollection(campaignId, key) {
    try {
      const snap = await withRetry(() => api.getDocs(api.collection(db, "campaigns", campaignId, key)), ctx);
      return sortSubDocs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.warn(`SDK Firestore falhou ao ler ${key}; usando REST.`, err);
      return sortSubDocs(await restListCollection(`campaigns/${campaignId}/${key}`));
    }
  }

  async function syncSubcollection(campaignId, key, items) {
    const previous = campaignSaveCache.get(campaignId)?.[key] || [];
    const previousIds = new Set(previous.map(item => String(item.id)));
    const nextIds = new Set(items.map(item => String(item.id)));
    const previousJsonById = new Map(previous.map(item => [String(item.id), JSON.stringify(item)]));
    const writes = [];

    items.forEach((item, index) => {
      const id = String(item.id);
      const comparable = JSON.stringify({ ...item, id });
      if (previousJsonById.get(id) !== comparable) {
        writes.push(() => api.setDoc(
          api.doc(db, "campaigns", campaignId, key, id),
          cleanSubDoc(item, index),
          { merge: false }
        ));
      }
    });

    previousIds.forEach(id => {
      if (!nextIds.has(id)) {
        writes.push(() => api.deleteDoc(api.doc(db, "campaigns", campaignId, key, id)));
      }
    });

    for (let i = 0; i < writes.length; i += 400) {
      const chunk = writes.slice(i, i + 400);
      await withRetry(() => Promise.all(chunk.map(write => write())), ctx);
    }
  }

  async function deleteSubcollection(campaignId, key) {
    const snap = await withRetry(() => api.getDocs(api.collection(db, "campaigns", campaignId, key)), ctx);
    const deletes = snap.docs.map(d => () => api.deleteDoc(d.ref));
    for (let i = 0; i < deletes.length; i += 400) {
      const chunk = deletes.slice(i, i + 400);
      await withRetry(() => Promise.all(chunk.map(del => del())), ctx);
    }
  }

  function watchCampaigns(userId, callback, onError) {
    if (!userId) return () => {};
    const q = api.query(api.collection(db, "campaigns"), api.where("members", "array-contains", userId));
    const bases = new Map();
    const subcollections = new Map();
    const subUnsubs = new Map();
    let latestMeta = { fromCache: false, hasPendingWrites: false };
    let lastPayload = "";

    function emit() {
      const campaigns = Array.from(bases.values()).map(base => mergeCampaign(base, subcollections.get(base.id) || {}));
      const payload = JSON.stringify(campaigns);
      if (payload === lastPayload) return;
      lastPayload = payload;
      campaigns.forEach(c => campaignSaveCache.set(c.id, cloneCollections(subcollections.get(c.id))));
      callback(campaigns, latestMeta);
    }

    function watchCampaignSubcollections(campaignId) {
      if (subUnsubs.has(campaignId)) return;
      subcollections.set(campaignId, Object.fromEntries(SUBCOLLECTION_KEYS.map(key => [key, []])));
      const unsubs = SUBCOLLECTION_KEYS.map(key => api.onSnapshot(
        api.collection(db, "campaigns", campaignId, key),
        { includeMetadataChanges: true },
        snap => {
          latestMeta = { fromCache: snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites };
          const current = subcollections.get(campaignId) || {};
          current[key] = sortSubDocs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
          subcollections.set(campaignId, current);
          emit();
        },
        onError
      ));
      subUnsubs.set(campaignId, unsubs);
    }

    const unsubBase = api.onSnapshot(q, { includeMetadataChanges: true }, snapshot => {
      latestMeta = { fromCache: snapshot.metadata.fromCache, hasPendingWrites: snapshot.metadata.hasPendingWrites };
      const activeIds = new Set();
      snapshot.docs.forEach(d => {
        const campaign = { id: d.id, ...d.data() };
        activeIds.add(campaign.id);
        bases.set(campaign.id, campaign);
        watchCampaignSubcollections(campaign.id);
      });

      Array.from(bases.keys()).forEach(id => {
        if (!activeIds.has(id)) {
          bases.delete(id);
          subcollections.delete(id);
          campaignSaveCache.delete(id);
          (subUnsubs.get(id) || []).forEach(unsub => unsub());
          subUnsubs.delete(id);
        }
      });
      emit();
    }, onError);

    return () => {
      unsubBase();
      subUnsubs.forEach(unsubs => unsubs.forEach(unsub => unsub()));
      subUnsubs.clear();
    };
  }

  async function getCampaign(campaignId) {
    if (!campaignId) return null;
    let base = null;
    try {
      const snap = await withRetry(() => api.getDoc(api.doc(db, "campaigns", campaignId)), ctx);
      if (!snap.exists()) return null;
      base = { id: snap.id, ...snap.data() };
    } catch (err) {
      console.warn("SDK Firestore falhou ao buscar campanha; usando REST.", err);
      base = await restGetDoc(`campaigns/${campaignId}`);
      if (!base) return null;
    }
    const collections = {};
    for (const key of SUBCOLLECTION_KEYS) collections[key] = await getSubcollection(campaignId, key);
    const campaign = mergeCampaign(base, collections);
    campaignSaveCache.set(campaign.id, cloneCollections(collections));
    return campaign;
  }

  async function getCampaignForJoin(campaignId) {
    if (!campaignId) return null;
    try {
      const snap = await withRetry(() => api.getDoc(api.doc(db, "campaigns", campaignId)), ctx);
      return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    } catch (err) {
      console.warn("SDK Firestore falhou ao buscar campanha para entrada; usando REST.", err);
      return restGetDoc(`campaigns/${campaignId}`);
    }
  }

  async function addCampaignMember(campaignId, userId) {
    if (!campaignId || !userId) return;
    try {
      await withRetry(() => api.updateDoc(api.doc(db, "campaigns", campaignId), {
        members: api.arrayUnion(userId),
        updatedAt: new Date().toISOString()
      }), ctx);
    } catch (err) {
      console.warn("SDK Firestore falhou ao adicionar membro; usando REST.", err);
      const campaign = await restGetDoc(`campaigns/${campaignId}`);
      const members = Array.from(new Set([...(campaign?.members || []), userId]));
      await restPatchDoc(`campaigns/${campaignId}`, { members, updatedAt: new Date().toISOString() });
    }
  }

  async function joinCampaign(campaignId, campaignPass, profile, name = "") {
    if (!campaignId || !auth.currentUser) return null;
    const user = auth.currentUser;
    const base = await getCampaignForJoin(campaignId);
    if (!base || base.password !== campaignPass) return null;

    await addCampaignMember(campaignId, user.uid);
    let players = [];
    try {
      const playersSnap = await withRetry(() => api.getDocs(api.collection(db, "campaigns", campaignId, "players")), ctx);
      players = sortSubDocs(playersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.warn("SDK Firestore falhou ao listar jogadores; usando REST.", err);
      players = sortSubDocs(await restListCollection(`campaigns/${campaignId}/players`));
    }
    let player = players.find(p => p.authUid === user.uid || p.email === user.email);
    const isNewPlayer = !player;

    player = player ? {
      ...player,
      name: name || player.name || profile?.name || user.displayName || user.email,
      email: user.email,
      authUid: user.uid
    } : {
      id: makeId(),
      name: name || profile?.name || user.displayName || user.email,
      email: user.email,
      authUid: user.uid,
      characterId: null
    };

    const playerOrder = isNewPlayer ? players.length : Math.max(0, players.findIndex(p => p.id === player.id));
    try {
      await withRetry(() => api.setDoc(
        api.doc(db, "campaigns", campaignId, "players", String(player.id)),
        cleanSubDoc(player, playerOrder),
        { merge: true }
      ), ctx);
    } catch (err) {
      console.warn("SDK Firestore falhou ao salvar jogador; usando REST.", err);
      await restPatchDoc(`campaigns/${campaignId}/players/${String(player.id)}`, cleanSubDoc(player, playerOrder));
    }

    if (isNewPlayer) {
      const now = new Date();
      const message = {
        id: makeId(),
        author: "Sistema",
        authorId: "system",
        text: `${player.name} entrou na campanha.`,
        time: `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`
      };
      try {
        await withRetry(() => api.setDoc(
          api.doc(db, "campaigns", campaignId, "messages", String(message.id)),
          cleanSubDoc(message, 0),
          { merge: false }
        ), ctx);
      } catch (err) {
        console.warn("SDK Firestore falhou ao salvar mensagem de entrada; usando REST.", err);
        await restPatchDoc(`campaigns/${campaignId}/messages/${String(message.id)}`, cleanSubDoc(message, 0));
      }
    }

    return { campaign: await getCampaign(campaignId), player };
  }

  async function saveCampaign(campaign) {
    if (!campaign?.id) return;
    const { base, collections } = splitCampaign(campaign);
    const cleaned = {
      ...stripUndefined({ ...base, updatedAt: new Date().toISOString() })
    };
    SUBCOLLECTION_KEYS.forEach(key => { cleaned[key] = api.deleteField(); });
    await withRetry(() => api.setDoc(api.doc(db, "campaigns", campaign.id), cleaned, { merge: true }), ctx);
    for (const key of SUBCOLLECTION_KEYS) await syncSubcollection(campaign.id, key, collections[key]);
    campaignSaveCache.set(campaign.id, cloneCollections(collections));
  }

  async function deleteCampaign(campaignId) {
    if (!campaignId) return;
    for (const key of SUBCOLLECTION_KEYS) await deleteSubcollection(campaignId, key);
    campaignSaveCache.delete(campaignId);
    await withRetry(() => api.deleteDoc(api.doc(db, "campaigns", campaignId)), ctx);
  }

  return {
    addCampaignMember,
    deleteCampaign,
    getCampaign,
    getCampaignForJoin,
    joinCampaign,
    saveCampaign,
    watchCampaigns
  };
}
