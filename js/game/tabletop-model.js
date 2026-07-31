(function attachTabletopModel(globalScope) {
  "use strict";

  const PRESENCE_ONLINE_MS = 90 * 1000;
  const PRESENCE_AWAY_MS = 5 * 60 * 1000;

  function defaultId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function positiveInteger(value, fallback = 1) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  function normalizeInventoryEntry(entry, makeId = defaultId) {
    const target = entry && typeof entry === "object" ? entry : {};
    target.id = String(target.id || makeId());
    target.itemId = target.itemId ? String(target.itemId) : null;
    target.name = String(target.name || "Item");
    target.description = String(target.description || "");
    target.image = String(target.image || "");
    target.quantity = positiveInteger(target.quantity);
    target.equipped = Boolean(target.equipped);
    target.notes = String(target.notes || "");
    target.grantedAt = target.grantedAt || new Date().toISOString();
    return target;
  }

  function normalizePlayer(player, makeId = defaultId) {
    const target = player && typeof player === "object" ? player : {};
    const email = String(target.email || "").trim();
    const authUid = target.authUid ? String(target.authUid) : null;
    Object.assign(target, {
      id: String(target.id || makeId()),
      name: String(target.name || email || "Jogador"),
      email,
      emailNormalized: normalizeEmail(target.emailNormalized || email),
      authUid,
      characterId: target.characterId ? String(target.characterId) : null,
      status: authUid ? "claimed" : "pending",
      online: Boolean(target.online),
      lastSeen: target.lastSeen || null,
      joinedAt: target.joinedAt || null
    });
    return target;
  }

  function normalizeCharacter(character, makeId = defaultId) {
    const target = character && typeof character === "object" ? character : {};
    target.id = String(target.id || makeId());
    target.controllerPlayerId = target.controllerPlayerId ? String(target.controllerPlayerId) : null;
    target.inventory = Array.isArray(target.inventory)
        ? target.inventory.map(entry => normalizeInventoryEntry(entry, makeId))
        : [];
    return target;
  }

  function normalizeScene(scene, makeId = defaultId) {
    const target = scene && typeof scene === "object" ? scene : {};
    target.id = String(target.id || makeId());
    target.title = String(target.title || "Cena");
    target.caption = String(target.caption || "");
    target.masterNotes = String(target.masterNotes || "");
    target.image = String(target.image || "");
    target.createdAt = target.createdAt || new Date().toISOString();
    return target;
  }

  function normalizeLiveScene(liveScene) {
    const target = liveScene && typeof liveScene === "object" ? liveScene : {};
    return {
      active: Boolean(target.active),
      sceneId: target.sceneId ? String(target.sceneId) : null,
      image: String(target.image || ""),
      index: Math.max(0, Number.parseInt(target.index, 10) || 0),
      total: Math.max(0, Number.parseInt(target.total, 10) || 0),
      updatedAt: target.updatedAt || null
    };
  }

  function normalizeGameBoard(board) {
    const target = board && typeof board === "object" ? board : {};
    return {
      image: String(target.image || ""),
      updatedAt: target.updatedAt || null
    };
  }

  function normalizeCampaign(campaign, makeId = defaultId) {
    if (!campaign || typeof campaign !== "object") return campaign;

    campaign.schemaVersion = Math.max(Number(campaign.schemaVersion) || 0, 2);
    campaign.players = Array.isArray(campaign.players)
      ? campaign.players.map(player => Object.assign(
        player && typeof player === "object" ? player : {},
        normalizePlayer(player, makeId)
      ))
      : [];
    campaign.characters = Array.isArray(campaign.characters)
      ? campaign.characters.map(character => Object.assign(
        character && typeof character === "object" ? character : {},
        normalizeCharacter(character, makeId)
      ))
      : [];
    campaign.scenes = Array.isArray(campaign.scenes)
      ? campaign.scenes.map(scene => normalizeScene(scene, makeId))
      : [];
    campaign.liveScene = normalizeLiveScene(campaign.liveScene);
    campaign.gameBoard = normalizeGameBoard(campaign.gameBoard);

    const playersById = new Map(campaign.players.map(player => [player.id, player]));
    const charactersById = new Map(campaign.characters.map(character => [character.id, character]));
    const assignedCharacters = new Set();

    campaign.characters.forEach(character => {
      const controller = character.controllerPlayerId
        ? playersById.get(character.controllerPlayerId)
        : null;
      if (!controller || controller.characterId !== character.id) {
        character.controllerPlayerId = null;
      }
    });

    campaign.players.forEach(player => {
      if (!player.characterId) return;
      const character = charactersById.get(player.characterId);
      if (!character || assignedCharacters.has(character.id)) {
        player.characterId = null;
        return;
      }
      assignedCharacters.add(character.id);
      character.controllerPlayerId = player.id;
    });

    return campaign;
  }

  function assignCharacter(campaign, playerId, characterId) {
    normalizeCampaign(campaign);
    const player = campaign.players.find(entry => entry.id === String(playerId));
    if (!player) throw new Error("Jogador nao encontrado.");

    const nextCharacterId = characterId ? String(characterId) : null;
    const previousCharacter = campaign.characters.find(entry => entry.id === player.characterId);
    const nextCharacter = nextCharacterId
      ? campaign.characters.find(entry => entry.id === nextCharacterId)
      : null;

    if (nextCharacterId && !nextCharacter) throw new Error("Personagem nao encontrado.");

    const otherController = nextCharacterId
      ? campaign.players.find(entry => entry.id !== player.id && entry.characterId === nextCharacterId)
      : null;
    if (otherController || (nextCharacter?.controllerPlayerId && nextCharacter.controllerPlayerId !== player.id)) {
      throw new Error("Este personagem ja esta vinculado a outro jogador.");
    }

    if (previousCharacter?.controllerPlayerId === player.id) previousCharacter.controllerPlayerId = null;
    player.characterId = nextCharacterId;
    if (nextCharacter) nextCharacter.controllerPlayerId = player.id;
    return { player, character: nextCharacter };
  }

  function releasePlayer(campaign, playerId) {
    normalizeCampaign(campaign);
    const player = campaign.players.find(entry => entry.id === String(playerId));
    if (!player) return null;
    const character = campaign.characters.find(entry => entry.id === player.characterId);
    if (character?.controllerPlayerId === player.id) character.controllerPlayerId = null;
    player.characterId = null;
    return player;
  }

  function presenceState(player, now = Date.now()) {
    const lastSeen = player?.lastSeen ? Date.parse(player.lastSeen) : Number.NaN;
    const age = Number.isFinite(lastSeen) ? Math.max(0, now - lastSeen) : Number.POSITIVE_INFINITY;
    if (player?.online && age <= PRESENCE_ONLINE_MS) return "online";
    if (age <= PRESENCE_AWAY_MS) return "away";
    return "offline";
  }

  function getControlledParticipants(campaign, now = Date.now()) {
    normalizeCampaign(campaign);
    return campaign.players.flatMap(player => {
      if (!player.authUid || !player.characterId) return [];
      const character = campaign.characters.find(entry => entry.id === player.characterId);
      if (!character || character.controllerPlayerId !== player.id) return [];
      return [{ player, character, presence: presenceState(player, now) }];
    });
  }

  function grantItem(campaign, characterId, item, options = {}, makeId = defaultId) {
    normalizeCampaign(campaign, makeId);
    const character = campaign.characters.find(entry => entry.id === String(characterId));
    if (!character) throw new Error("Personagem nao encontrado.");

    const quantity = positiveInteger(options.quantity);
    const itemId = (item?.itemId || item?.id) ? String(item.itemId || item.id) : null;
    const existing = itemId && options.stack !== false
      ? character.inventory.find(entry => entry.itemId === itemId && entry.notes === String(options.notes || ""))
      : null;

    if (existing) {
      existing.quantity += quantity;
      if (String(item?.name || "").trim()) existing.name = String(item.name).trim();
      if (String(item?.description || "").trim()) existing.description = String(item.description).trim();
      if (String(item?.image || "").trim()) existing.image = String(item.image).trim();
      if (options.equipped !== undefined) existing.equipped = Boolean(options.equipped);
      return existing;
    }

    const entry = normalizeInventoryEntry({
      id: makeId(),
      itemId,
      name: item?.name || "Item",
      description: item?.description || "",
      image: item?.image || "",
      quantity,
      equipped: Boolean(options.equipped),
      notes: options.notes || "",
      grantedAt: new Date().toISOString()
    }, makeId);
    character.inventory.push(entry);
    return entry;
  }

  function updateInventoryEntry(campaign, characterId, inventoryId, changes = {}) {
    normalizeCampaign(campaign);
    const character = campaign.characters.find(entry => entry.id === String(characterId));
    const inventoryEntry = character?.inventory.find(entry => entry.id === String(inventoryId));
    if (!inventoryEntry) throw new Error("Item do inventario nao encontrado.");

    const normalizedChanges = {};
    if (changes.name !== undefined) {
      const name = String(changes.name || "").trim();
      if (!name) throw new Error("Informe o titulo do item.");
      normalizedChanges.name = name;
    }
    if (changes.description !== undefined) {
      const description = String(changes.description || "").trim();
      if (!description) throw new Error("Informe a descricao do item.");
      normalizedChanges.description = description;
    }
    if (changes.image !== undefined) {
      const image = String(changes.image || "").trim();
      if (!image) throw new Error("Selecione uma foto para o item.");
      normalizedChanges.image = image;
    }
    if (changes.quantity !== undefined) normalizedChanges.quantity = positiveInteger(changes.quantity);
    if (changes.equipped !== undefined) normalizedChanges.equipped = Boolean(changes.equipped);
    if (changes.notes !== undefined) normalizedChanges.notes = String(changes.notes || "");
    Object.assign(inventoryEntry, normalizedChanges);
    return inventoryEntry;
  }

  function removeInventoryEntry(campaign, characterId, inventoryId) {
    normalizeCampaign(campaign);
    const character = campaign.characters.find(entry => entry.id === String(characterId));
    if (!character) throw new Error("Personagem nao encontrado.");
    const index = character.inventory.findIndex(entry => entry.id === String(inventoryId));
    if (index < 0) return null;
    return character.inventory.splice(index, 1)[0];
  }

  function transferInventoryItem(campaign, fromCharacterId, toCharacterId, inventoryId, quantity, makeId = defaultId) {
    normalizeCampaign(campaign, makeId);
    if (String(fromCharacterId) === String(toCharacterId)) throw new Error("Escolha outro personagem.");

    const fromCharacter = campaign.characters.find(entry => entry.id === String(fromCharacterId));
    const source = fromCharacter?.inventory.find(entry => entry.id === String(inventoryId));
    if (!source) throw new Error("O item nao esta mais no inventario de origem.");

    const amount = positiveInteger(quantity);
    if (amount > source.quantity) throw new Error("Quantidade indisponivel no inventario de origem.");
    const targetEntry = grantItem(campaign, toCharacterId, source, {
      quantity: amount,
      equipped: false,
      notes: source.notes
    }, makeId);

    source.quantity -= amount;
    if (source.quantity <= 0) removeInventoryEntry(campaign, fromCharacterId, inventoryId);
    return targetEntry;
  }

  function reservedTransferQuantity(campaign, characterId, inventoryId, exceptTransferId = null) {
    normalizeCampaign(campaign);
    return (campaign.itemTransfers || []).reduce((total, transfer) => {
      if (transfer.status !== "pending" || transfer.type !== "item") return total;
      if (String(transfer.fromCharacterId || "") !== String(characterId)) return total;
      if (String(transfer.inventoryId || "") !== String(inventoryId)) return total;
      if (exceptTransferId && String(transfer.id) === String(exceptTransferId)) return total;
      return total + positiveInteger(transfer.quantity);
    }, 0);
  }

  function availableInventoryQuantity(campaign, characterId, inventoryId) {
    normalizeCampaign(campaign);
    const character = campaign.characters.find(entry => entry.id === String(characterId));
    const inventoryEntry = character?.inventory.find(entry => entry.id === String(inventoryId));
    if (!inventoryEntry) return 0;
    return Math.max(0, inventoryEntry.quantity - reservedTransferQuantity(campaign, characterId, inventoryId));
  }

  function publishScene(campaign, sceneId, options = {}) {
    normalizeCampaign(campaign);
    const scene = campaign.scenes.find(entry => entry.id === String(sceneId || ""));
    if (!scene) throw new Error("Cena nao encontrada.");
    const index = campaign.scenes.findIndex(entry => entry.id === scene.id);
    campaign.liveScene = {
      active: options.active === undefined ? Boolean(campaign.liveScene.active) : Boolean(options.active),
      sceneId: scene.id,
      image: scene.image,
      index,
      total: campaign.scenes.length,
      updatedAt: new Date().toISOString()
    };
    return campaign.liveScene;
  }

  function setScenePresentationActive(campaign, active) {
    normalizeCampaign(campaign);
    if (!active || !campaign.scenes.length) {
      campaign.liveScene = normalizeLiveScene({
        active: false,
        updatedAt: new Date().toISOString()
      });
      return campaign.liveScene;
    }
    const sceneId = campaign.liveScene.sceneId || campaign.scenes[0].id;
    return publishScene(campaign, sceneId, { active });
  }

  function stepScene(campaign, delta) {
    normalizeCampaign(campaign);
    if (!campaign.scenes.length) throw new Error("Adicione uma cena primeiro.");
    const currentIndex = campaign.scenes.findIndex(entry => entry.id === campaign.liveScene.sceneId);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = Math.max(0, Math.min(campaign.scenes.length - 1, baseIndex + Number(delta || 0)));
    return publishScene(campaign, campaign.scenes[nextIndex].id, { active: campaign.liveScene.active });
  }

  const api = {
    PRESENCE_AWAY_MS,
    PRESENCE_ONLINE_MS,
    availableInventoryQuantity,
    assignCharacter,
    getControlledParticipants,
    grantItem,
    normalizeCampaign,
    normalizeCharacter,
    normalizeEmail,
    normalizeInventoryEntry,
    normalizeLiveScene,
    normalizeGameBoard,
    normalizePlayer,
    normalizeScene,
    publishScene,
    presenceState,
    releasePlayer,
    removeInventoryEntry,
    reservedTransferQuantity,
    setScenePresentationActive,
    stepScene,
    transferInventoryItem,
    updateInventoryEntry
  };

  globalScope.CDITabletop = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
