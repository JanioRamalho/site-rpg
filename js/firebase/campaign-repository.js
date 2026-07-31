import {
  MASTER_ONLY_SUBCOLLECTION_KEYS,
  SHARED_SUBCOLLECTION_KEYS,
  SUBCOLLECTION_KEYS
} from "./constants.js";
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

  function mergeCampaign(base, collections = {}, options = {}) {
    const campaign = { ...base };
    SHARED_SUBCOLLECTION_KEYS.forEach(key => {
      const splitItems = collections[key] || [];
      campaign[key] = splitItems.length ? splitItems : (Array.isArray(base[key]) ? base[key] : []);
    });
    MASTER_ONLY_SUBCOLLECTION_KEYS.forEach(key => {
      if (options.includeMasterOnly === false) {
        campaign[key] = [];
        return;
      }
      const splitItems = collections[key] || [];
      campaign[key] = splitItems.length ? splitItems : (Array.isArray(base[key]) ? base[key] : []);
    });
    return campaign;
  }

  function readableSubcollectionKeys(base, userId) {
    return base?.masterId === userId ? SUBCOLLECTION_KEYS : SHARED_SUBCOLLECTION_KEYS;
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

  async function syncSubcollection(campaignId, key, items, options = {}) {
    const previous = campaignSaveCache.get(campaignId)?.[key] || [];
    const canWrite = options.canWrite || (() => true);
    const canDelete = options.canDelete || (() => true);
    const previousIds = new Set(previous.map(item => String(item.id)));
    const nextIds = new Set(items.map(item => String(item.id)));
    const previousById = new Map(previous.map((item, index) => [String(item.id), {
      clean: cleanSubDoc(item, index),
      item
    }]));
    const writes = [];

    items.forEach((item, index) => {
      const id = String(item.id);
      const nextClean = cleanSubDoc(item, index);
      const previousEntry = previousById.get(id);
      if (canWrite(item, previousEntry?.item) && JSON.stringify(previousEntry?.clean) !== JSON.stringify(nextClean)) {
        if (!previousEntry) {
          writes.push(() => api.setDoc(
            api.doc(db, "campaigns", campaignId, key, id),
            nextClean,
            { merge: false }
          ));
          return;
        }

        const changedFields = {};
        const fieldNames = new Set([...Object.keys(previousEntry.clean), ...Object.keys(nextClean)]);
        fieldNames.forEach(field => {
          if (JSON.stringify(previousEntry.clean[field]) === JSON.stringify(nextClean[field])) return;
          changedFields[field] = field in nextClean ? nextClean[field] : api.deleteField();
        });
        writes.push(() => api.updateDoc(
          api.doc(db, "campaigns", campaignId, key, id),
          changedFields
        ));
      }
    });

    previousIds.forEach(id => {
      const previousItem = previousById.get(id)?.item;
      if (!nextIds.has(id) && canDelete(previousItem)) {
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
    const subReady = new Map();
    const subKeys = new Map();
    let latestMeta = { fromCache: false, hasPendingWrites: false };
    let lastPayload = "";
    let lastMetaPayload = "";

    function emit() {
      const baseCampaigns = Array.from(bases.values());
      if (baseCampaigns.some(base => subReady.get(base.id)?.size !== (subKeys.get(base.id)?.length || 0))) return;
      const campaigns = baseCampaigns.map(base => mergeCampaign(
        base,
        subcollections.get(base.id) || {},
        { includeMasterOnly: base.masterId === userId }
      ));
      const payload = JSON.stringify(campaigns);
      const metaPayload = JSON.stringify(latestMeta);
      if (payload === lastPayload && metaPayload === lastMetaPayload) return;
      lastPayload = payload;
      lastMetaPayload = metaPayload;
      campaigns.forEach(c => campaignSaveCache.set(c.id, cloneCollections(subcollections.get(c.id))));
      callback(campaigns, latestMeta);
    }

    function watchCampaignSubcollections(campaignId, keys) {
      if (subUnsubs.has(campaignId)) return;
      subcollections.set(campaignId, Object.fromEntries(keys.map(key => [key, []])));
      subReady.set(campaignId, new Set());
      subKeys.set(campaignId, keys);
      const unsubs = keys.map(key => api.onSnapshot(
        api.collection(db, "campaigns", campaignId, key),
        { includeMetadataChanges: true },
        snap => {
          latestMeta = { fromCache: snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites };
          const current = subcollections.get(campaignId) || {};
          current[key] = sortSubDocs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
          subcollections.set(campaignId, current);
          subReady.get(campaignId)?.add(key);
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
        watchCampaignSubcollections(campaign.id, readableSubcollectionKeys(campaign, userId));
      });

      Array.from(bases.keys()).forEach(id => {
        if (!activeIds.has(id)) {
          bases.delete(id);
          subcollections.delete(id);
          subReady.delete(id);
          subKeys.delete(id);
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
      subReady.clear();
      subKeys.clear();
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
    const includeMasterOnly = base.masterId === auth.currentUser?.uid;
    const readableKeys = readableSubcollectionKeys(base, auth.currentUser?.uid);
    const collectionEntries = await Promise.all(readableKeys.map(async key => [
      key,
      await getSubcollection(campaignId, key)
    ]));
    const collections = Object.fromEntries(collectionEntries);
    const campaign = mergeCampaign(base, collections, { includeMasterOnly });
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
    const normalizedEmail = String(user.email || profile?.email || "").trim().toLowerCase();
    if (Array.isArray(base.readyPlayerEmails) && !base.readyPlayerEmails.includes(normalizedEmail)) {
      const error = new Error("O Mestre ainda nao preparou e vinculou um personagem para este e-mail.");
      error.code = "campaign/player-not-ready";
      throw error;
    }

    await addCampaignMember(campaignId, user.uid);
    let players = [];
    try {
      const playersSnap = await withRetry(() => api.getDocs(api.collection(db, "campaigns", campaignId, "players")), ctx);
      players = sortSubDocs(playersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.warn("SDK Firestore falhou ao listar jogadores; usando REST.", err);
      players = sortSubDocs(await restListCollection(`campaigns/${campaignId}/players`));
    }
    let player = players.find(p => p.authUid === user.uid)
      || players.find(p => !p.authUid && String(p.emailNormalized || p.email || "").trim().toLowerCase() === normalizedEmail);
    const isNewPlayer = !player;
    const isFirstJoin = !player?.authUid;
    const nowIso = new Date().toISOString();

    player = player ? {
      ...player,
      name: player.name || name || profile?.name || user.displayName || user.email,
      email: user.email,
      emailNormalized: normalizedEmail,
      authUid: user.uid,
      status: "claimed",
      joinedAt: player.joinedAt || nowIso,
      lastSeen: nowIso,
      online: true
    } : {
      id: makeId(),
      name: name || profile?.name || user.displayName || user.email,
      email: user.email,
      emailNormalized: normalizedEmail,
      authUid: user.uid,
      characterId: null,
      status: "claimed",
      joinedAt: nowIso,
      lastSeen: nowIso,
      online: true
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

    if (isFirstJoin) {
      const now = new Date();
      const message = {
        id: makeId(),
        author: "Sistema",
        authorId: user.uid,
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

  async function setPlayerPresence(campaignId, playerId, online) {
    if (!campaignId || !playerId || !auth.currentUser) return;
    const presence = {
      online: Boolean(online),
      lastSeen: new Date().toISOString()
    };
    try {
      await withRetry(() => api.updateDoc(
        api.doc(db, "campaigns", campaignId, "players", String(playerId)),
        presence
      ), ctx);
    } catch (err) {
      console.warn("SDK Firestore falhou ao atualizar presenca; usando REST.", err);
      await restPatchDoc(`campaigns/${campaignId}/players/${String(playerId)}`, presence);
    }
  }

  async function sendCampaignMessage(campaignId, message) {
    if (!campaignId || !auth.currentUser) throw new Error("Mensagem sem campanha ou usuario autenticado.");

    const now = new Date();
    const sentAt = String(message?.sentAt || now.toISOString());
    const text = String(message?.text || "").trim().slice(0, 500);
    if (!text) throw new Error("A mensagem esta vazia.");

    const outgoing = stripUndefined({
      id: String(message?.id || makeId()),
      author: String(message?.author || "Jogador").trim().slice(0, 60) || "Jogador",
      authorId: auth.currentUser.uid,
      playerId: message?.playerId ? String(message.playerId) : undefined,
      text,
      time: String(message?.time || `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`),
      sentAt
    });
    const sentAtMs = Date.parse(sentAt);
    const order = -(Number.isFinite(sentAtMs) ? sentAtMs : Date.now());
    const stored = cleanSubDoc(outgoing, order);

    try {
      await withRetry(() => api.setDoc(
        api.doc(db, "campaigns", campaignId, "messages", outgoing.id),
        stored,
        { merge: false }
      ), ctx);
    } catch (err) {
      console.warn("SDK Firestore falhou ao enviar mensagem; usando REST.", err);
      await restPatchDoc(`campaigns/${campaignId}/messages/${outgoing.id}`, stored);
    }

    const cachedMessages = campaignSaveCache.get(campaignId)?.messages;
    if (cachedMessages && !cachedMessages.some(entry => String(entry.id) === outgoing.id)) {
      cachedMessages.unshift({ ...outgoing });
    }
    return outgoing;
  }

  async function updateCharacterInventory(campaignId, characterId, inventory) {
    if (!campaignId || !characterId || !auth.currentUser) {
      throw new Error("Inventario de personagem invalido.");
    }

    const cleanInventory = stripUndefined(Array.isArray(inventory) ? inventory : []);
    const inventoryUpdatedAt = new Date().toISOString();
    const update = { inventory: cleanInventory, inventoryUpdatedAt };
    try {
      await withRetry(() => api.updateDoc(
        api.doc(db, "campaigns", campaignId, "characters", String(characterId)),
        update
      ), ctx);
    } catch (err) {
      console.warn("SDK Firestore falhou ao atualizar inventario; usando REST.", err);
      await restPatchDoc(`campaigns/${campaignId}/characters/${String(characterId)}`, update);
    }

    const cachedCharacter = campaignSaveCache.get(campaignId)?.characters
      ?.find(character => String(character.id) === String(characterId));
    if (cachedCharacter) Object.assign(cachedCharacter, stripUndefined(update));
    return update;
  }

  async function assignPlayerCharacter(campaignId, playerId, characterId) {
    if (!campaignId || !playerId || !auth.currentUser) throw new Error("Vinculo de personagem invalido.");

    const normalizedPlayerId = String(playerId);
    const nextCharacterId = characterId ? String(characterId) : null;
    const campaignRef = api.doc(db, "campaigns", campaignId);
    const playerRef = api.doc(db, "campaigns", campaignId, "players", normalizedPlayerId);
    const updatedAt = new Date().toISOString();
    const updatedBy = auth.currentUser.uid;

    const result = await withRetry(() => api.runTransaction(db, async transaction => {
      const playerSnap = await transaction.get(playerRef);
      if (!playerSnap.exists()) throw new Error("Jogador nao encontrado.");

      const playerData = playerSnap.data();
      const previousCharacterId = playerData.characterId ? String(playerData.characterId) : null;
      const characterIds = Array.from(new Set([previousCharacterId, nextCharacterId].filter(Boolean)));
      const characterEntries = [];

      for (const id of characterIds) {
        const ref = api.doc(db, "campaigns", campaignId, "characters", id);
        characterEntries.push([id, ref, await transaction.get(ref)]);
      }

      const charactersById = new Map(characterEntries.map(([id, ref, snap]) => [id, { ref, snap }]));
      const nextEntry = nextCharacterId ? charactersById.get(nextCharacterId) : null;
      if (nextCharacterId && !nextEntry?.snap.exists()) throw new Error("Personagem nao encontrado.");

      const nextController = nextEntry?.snap.data()?.controllerPlayerId;
      if (nextController && String(nextController) !== normalizedPlayerId) {
        throw new Error("Este personagem ja esta vinculado a outro jogador.");
      }

      const playerUpdate = {
        characterId: nextCharacterId,
        characterLinkUpdatedAt: updatedAt,
        characterLinkUpdatedBy: updatedBy
      };
      transaction.update(playerRef, playerUpdate);

      const previousEntry = previousCharacterId ? charactersById.get(previousCharacterId) : null;
      if (previousEntry?.snap.exists() && previousCharacterId !== nextCharacterId) {
        const previousController = previousEntry.snap.data()?.controllerPlayerId;
        if (!previousController || String(previousController) === normalizedPlayerId) {
          transaction.update(previousEntry.ref, { controllerPlayerId: null });
        }
      }
      if (nextEntry) transaction.update(nextEntry.ref, { controllerPlayerId: normalizedPlayerId });

      const normalizedEmail = String(playerData.emailNormalized || playerData.email || "").trim().toLowerCase();
      const campaignUpdate = { updatedAt };
      if (normalizedEmail) {
        campaignUpdate.readyPlayerEmails = nextCharacterId
          ? api.arrayUnion(normalizedEmail)
          : api.arrayRemove(normalizedEmail);
      }
      transaction.update(campaignRef, campaignUpdate);

      return {
        player: { id: playerSnap.id, ...playerData, ...playerUpdate },
        previousCharacterId,
        character: nextEntry ? {
          id: nextEntry.snap.id,
          ...nextEntry.snap.data(),
          controllerPlayerId: normalizedPlayerId
        } : null
      };
    }), ctx);

    const cached = campaignSaveCache.get(campaignId);
    if (cached) {
      const cachedPlayer = cached.players?.find(player => String(player.id) === normalizedPlayerId);
      if (cachedPlayer) Object.assign(cachedPlayer, result.player);
      if (result.previousCharacterId && result.previousCharacterId !== nextCharacterId) {
        const previousCharacter = cached.characters?.find(character => String(character.id) === result.previousCharacterId);
        if (String(previousCharacter?.controllerPlayerId || "") === normalizedPlayerId) previousCharacter.controllerPlayerId = null;
      }
      if (nextCharacterId) {
        const nextCharacter = cached.characters?.find(character => String(character.id) === nextCharacterId);
        if (nextCharacter) nextCharacter.controllerPlayerId = normalizedPlayerId;
      }
    }

    return result;
  }

  async function resolveItemTransfer(campaignId, transferId, decision) {
    if (!campaignId || !transferId || !auth.currentUser) throw new Error("Transferencia invalida.");
    if (!["approved", "rejected"].includes(decision)) throw new Error("Decisao de transferencia invalida.");

    const transferRef = api.doc(db, "campaigns", campaignId, "itemTransfers", String(transferId));
    const resolvedDate = new Date();
    const resolvedAt = resolvedDate.toISOString();
    const resolvedBy = auth.currentUser.uid;

    return withRetry(() => api.runTransaction(db, async transaction => {
      const transferSnap = await transaction.get(transferRef);
      if (!transferSnap.exists()) throw new Error("Solicitacao de transferencia nao encontrada.");
      const transfer = { id: transferSnap.id, ...transferSnap.data() };

      if (transfer.status !== "pending") {
        return { transfer, alreadyResolved: true };
      }

      const resolution = {
        status: decision,
        resolvedAt,
        resolvedBy,
        time: resolvedDate.toLocaleString("pt-BR")
      };
      if (decision === "rejected" || transfer.type !== "item") {
        transaction.update(transferRef, resolution);
        return { transfer: { ...transfer, ...resolution } };
      }

      if (!transfer.fromCharacterId || !transfer.toCharacterId || !transfer.inventoryId) {
        throw new Error("A solicitacao nao possui os vinculos de inventario necessarios.");
      }
      if (String(transfer.fromCharacterId) === String(transfer.toCharacterId)) {
        throw new Error("Origem e destino da transferencia sao iguais.");
      }

      const sourceRef = api.doc(db, "campaigns", campaignId, "characters", String(transfer.fromCharacterId));
      const targetRef = api.doc(db, "campaigns", campaignId, "characters", String(transfer.toCharacterId));
      const sourceSnap = await transaction.get(sourceRef);
      const targetSnap = await transaction.get(targetRef);
      if (!sourceSnap.exists() || !targetSnap.exists()) throw new Error("Um dos personagens nao existe mais.");

      const sourceData = sourceSnap.data();
      const targetData = targetSnap.data();
      const sourceInventory = JSON.parse(JSON.stringify(sourceData.inventory || []));
      const targetInventory = JSON.parse(JSON.stringify(targetData.inventory || []));
      const sourceIndex = sourceInventory.findIndex(entry => String(entry.id) === String(transfer.inventoryId));
      if (sourceIndex < 0) throw new Error("O item nao esta mais no inventario de origem.");

      const amount = Math.max(1, Number.parseInt(transfer.quantity, 10) || 1);
      const sourceItem = sourceInventory[sourceIndex];
      if ((Number(sourceItem.quantity) || 0) < amount) throw new Error("Quantidade indisponivel no inventario de origem.");

      const targetEntry = sourceItem.itemId
        ? targetInventory.find(entry => String(entry.itemId || "") === String(sourceItem.itemId) && String(entry.notes || "") === String(sourceItem.notes || ""))
        : null;
      if (targetEntry) {
        targetEntry.quantity = Math.max(0, Number(targetEntry.quantity) || 0) + amount;
        if (String(sourceItem.name || "").trim()) targetEntry.name = String(sourceItem.name).trim();
        if (String(sourceItem.description || "").trim()) targetEntry.description = String(sourceItem.description).trim();
        if (String(sourceItem.image || "").trim()) targetEntry.image = String(sourceItem.image).trim();
      } else {
        targetInventory.push(stripUndefined({
          ...sourceItem,
          id: makeId(),
          quantity: amount,
          equipped: false,
          grantedAt: resolvedAt
        }));
      }

      sourceItem.quantity = Math.max(0, Number(sourceItem.quantity) || 0) - amount;
      if (sourceItem.quantity === 0) sourceInventory.splice(sourceIndex, 1);

      transaction.update(sourceRef, { inventory: sourceInventory });
      transaction.update(targetRef, { inventory: targetInventory });
      transaction.update(transferRef, resolution);

      return {
        transfer: { ...transfer, ...resolution },
        sourceCharacter: { id: sourceSnap.id, inventory: sourceInventory },
        targetCharacter: { id: targetSnap.id, inventory: targetInventory }
      };
    }), ctx);
  }

  async function syncPlayerSubcollection(campaignId, key, items, playerId, userId) {
    const previous = campaignSaveCache.get(campaignId)?.[key] || [];
    const previousById = new Map(previous.map(item => [String(item.id), item]));

    if (key === "characters") {
      const character = items.find(item => String(item.controllerPlayerId || "") === String(playerId));
      if (!character) return;
      const prior = previousById.get(String(character.id)) || {};
      const writable = {
        controllerPlayerId: String(playerId),
        health: character.health,
        sanity: character.sanity,
        skills: character.skills || []
      };
      const priorWritable = {
        controllerPlayerId: prior.controllerPlayerId || null,
        health: prior.health,
        sanity: prior.sanity,
        skills: prior.skills || []
      };
      if (JSON.stringify(writable) !== JSON.stringify(priorWritable)) {
        await withRetry(() => api.setDoc(
          api.doc(db, "campaigns", campaignId, key, String(character.id)),
          stripUndefined(writable),
          { merge: true }
        ), ctx);
      }
      return;
    }

    if (!["messages", "diceLogs", "itemTransfers"].includes(key)) return;
    const newItems = items.filter(item => {
      if (previousById.has(String(item.id))) return false;
      if (key === "itemTransfers") return String(item.fromPlayerId || "") === String(playerId);
      return item.authorId === userId;
    });

    for (const item of newItems) {
      const order = Math.max(0, items.findIndex(entry => String(entry.id) === String(item.id)));
      await withRetry(() => api.setDoc(
        api.doc(db, "campaigns", campaignId, key, String(item.id)),
        cleanSubDoc(item, order),
        { merge: false }
      ), ctx);
    }
  }

  async function saveCampaign(campaign, options = {}) {
    if (!campaign?.id) return;
    const { base, collections } = splitCampaign(campaign);
    const updatedAt = new Date().toISOString();
    const isPlayer = options.role === "player";

    if (isPlayer) {
      await withRetry(() => api.updateDoc(api.doc(db, "campaigns", campaign.id), { updatedAt }), ctx);
    } else {
      base.readyPlayerEmails = Array.from(new Set(collections.players
        .filter(player => player.characterId && (player.emailNormalized || player.email))
        .map(player => String(player.emailNormalized || player.email).trim().toLowerCase())
        .filter(Boolean)));
      const cleaned = {
        ...stripUndefined({ ...base, updatedAt })
      };
      SUBCOLLECTION_KEYS.forEach(key => { cleaned[key] = api.deleteField(); });
      await withRetry(() => api.setDoc(api.doc(db, "campaigns", campaign.id), cleaned, { merge: true }), ctx);
    }

    for (const key of SUBCOLLECTION_KEYS) {
      if (isPlayer) {
        await syncPlayerSubcollection(campaign.id, key, collections[key], options.playerId, auth.currentUser?.uid);
      } else {
        await syncSubcollection(campaign.id, key, collections[key]);
      }
    }
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
    assignPlayerCharacter,
    deleteCampaign,
    getCampaign,
    getCampaignForJoin,
    joinCampaign,
    resolveItemTransfer,
    saveCampaign,
    sendCampaignMessage,
    setPlayerPresence,
    updateCharacterInventory,
    watchCampaigns
  };
}
