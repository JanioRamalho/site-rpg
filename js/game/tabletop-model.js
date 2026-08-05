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

  function hasOwn(target, property) {
    return Boolean(target) && Object.prototype.hasOwnProperty.call(target, property);
  }

  function cloneImageMeta(imageMeta) {
    if (!imageMeta || typeof imageMeta !== "object" || Array.isArray(imageMeta)) return imageMeta;
    return { ...imageMeta };
  }

  function unknownProperties(source, knownProperties) {
    if (!source || typeof source !== "object") return {};
    const known = new Set(knownProperties);
    return Object.fromEntries(Object.entries(source).filter(([property]) => !known.has(property)));
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

  function normalizeItemCatalogEntry(item, makeId = defaultId) {
    const target = item && typeof item === "object" ? item : {};
    target.id = String(target.id || makeId());
    target.name = String(target.name || "Item");
    target.description = String(target.description || "");
    target.image = String(target.image || "");
    target.createdAt = target.createdAt || new Date().toISOString();
    delete target.revealed;
    return target;
  }

  function normalizeOriginLoadouts(loadouts, catalog = []) {
    if (!loadouts || typeof loadouts !== "object" || Array.isArray(loadouts)) return {};
    const catalogIds = new Set(catalog.map(item => String(item.id)));
    const normalized = {};

    Object.entries(loadouts).forEach(([origin, entries]) => {
      const normalizedOrigin = String(origin || "").trim();
      if (!normalizedOrigin || !Array.isArray(entries)) return;
      const quantities = new Map();
      entries.forEach(entry => {
        const itemId = String(entry?.itemId || "");
        const quantity = Number.parseInt(entry?.quantity, 10);
        if (!itemId || !catalogIds.has(itemId) || !Number.isFinite(quantity) || quantity <= 0) return;
        quantities.set(itemId, (quantities.get(itemId) || 0) + quantity);
      });
      const normalizedEntries = Array.from(quantities, ([itemId, quantity]) => ({ itemId, quantity }));
      if (normalizedEntries.length) normalized[normalizedOrigin] = normalizedEntries;
    });

    return normalized;
  }

  function normalizeEvidenceCatalogEntry(evidence, makeId = defaultId) {
    const target = evidence && typeof evidence === "object" ? evidence : {};
    target.id = String(target.id || makeId());
    target.title = String(target.title || target.name || "Evidencia");
    target.name = target.title;
    target.description = String(target.description || "");
    target.image = String(target.image || "");
    target.createdAt = target.createdAt || new Date().toISOString();
    return target;
  }

  function normalizeCharacterEvidenceEntry(evidence, makeId = defaultId) {
    const target = evidence && typeof evidence === "object" ? evidence : {};
    target.id = String(target.id || makeId());
    target.evidenceId = String(target.evidenceId || target.catalogId || target.id);
    target.title = String(target.title || target.name || "Evidencia");
    target.name = target.title;
    target.description = String(target.description || "");
    target.image = String(target.image || "");
    target.grantedAt = target.grantedAt || target.acquiredAt || new Date().toISOString();
    return target;
  }

  function normalizeTrauma(trauma, makeId = defaultId) {
    const target = trauma && typeof trauma === "object" ? trauma : {};
    target.id = String(target.id || makeId());
    target.catalogId = target.catalogId ? String(target.catalogId) : null;
    target.title = String(target.title || "Trauma");
    target.description = String(target.description || "");
    target.image = String(target.image || "");
    target.acquiredAt = target.acquiredAt || new Date().toISOString();
    return target;
  }

  function normalizeTraumaCatalogEntry(trauma, makeId = defaultId) {
    const target = trauma && typeof trauma === "object" ? trauma : {};
    target.id = String(target.id || makeId());
    target.title = String(target.title || "Trauma");
    target.image = String(target.image || "");
    target.createdAt = target.createdAt || new Date().toISOString();
    return target;
  }

  function traumaCatalogSignature(trauma) {
    return `${String(trauma?.title || "").trim().toLowerCase()}\u0000${String(trauma?.image || "")}`;
  }

  function normalizeExpression(expression, makeId = defaultId) {
    const target = expression && typeof expression === "object" ? expression : {};
    target.id = String(target.id || makeId());
    target.title = String(target.title || "Expressao");
    target.image = String(target.image || "");
    target.createdAt = target.createdAt || new Date().toISOString();
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
    target.evidence = Array.isArray(target.evidence)
      ? target.evidence.map(entry => normalizeCharacterEvidenceEntry(entry, makeId))
      : [];
    target.traumas = Array.isArray(target.traumas)
      ? target.traumas.map(trauma => normalizeTrauma(trauma, makeId))
      : [];
    target.expressions = Array.isArray(target.expressions)
      ? target.expressions.map(expression => normalizeExpression(expression, makeId))
      : [];
    const activeExpression = String(target.activeExpression || "");
    target.activeExpression = target.expressions.some(expression => expression.id === activeExpression)
      ? activeExpression
      : "";
    target.expressionUpdatedAt = target.expressionUpdatedAt || null;
    target.appliedOriginLoadouts = Array.isArray(target.appliedOriginLoadouts)
      ? Array.from(new Set(target.appliedOriginLoadouts.map(origin => String(origin || "").trim()).filter(Boolean)))
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
    const normalized = {
      ...target,
      image: String(target.image || ""),
      updatedAt: target.updatedAt || null
    };
    if (hasOwn(target, "imageMeta")) normalized.imageMeta = cloneImageMeta(target.imageMeta);
    return normalized;
  }

  function normalizeChatSettings(settings) {
    const target = settings && typeof settings === "object" ? settings : {};
    const privateThreads = target.privateThreads && typeof target.privateThreads === "object"
      ? Object.fromEntries(Object.entries(target.privateThreads)
        .filter(([threadId, enabled]) => String(threadId).trim() && typeof enabled === "boolean")
        .map(([threadId, enabled]) => [String(threadId), enabled]))
      : {};
    return {
      publicEnabled: target.publicEnabled !== false,
      privateEnabled: target.privateEnabled !== false,
      privateThreads,
      updatedAt: target.updatedAt || null
    };
  }

  function normalizeCampaign(campaign, makeId = defaultId) {
    if (!campaign || typeof campaign !== "object") return campaign;

    campaign.schemaVersion = Math.max(Number(campaign.schemaVersion) || 0, 5);
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
    campaign.items = Array.isArray(campaign.items)
      ? campaign.items.map(item => normalizeItemCatalogEntry(item, makeId))
      : [];
    const itemCatalogIds = new Set();
    campaign.items.forEach(item => {
      if (itemCatalogIds.has(item.id)) item.id = String(makeId());
      itemCatalogIds.add(item.id);
    });
    campaign.originLoadouts = normalizeOriginLoadouts(campaign.originLoadouts, campaign.items);
    campaign.traumaCatalog = Array.isArray(campaign.traumaCatalog)
      ? campaign.traumaCatalog.map(trauma => normalizeTraumaCatalogEntry(trauma, makeId))
      : [];
    campaign.evidence = Array.isArray(campaign.evidence)
      ? campaign.evidence.map(entry => normalizeEvidenceCatalogEntry(entry, makeId))
      : [];

    const evidenceCatalogIds = new Set();
    campaign.evidence.forEach(entry => {
      if (evidenceCatalogIds.has(entry.id)) entry.id = String(makeId());
      evidenceCatalogIds.add(entry.id);
    });
    const evidenceCatalogById = new Map(campaign.evidence.map(entry => [entry.id, entry]));
    const ownedEvidenceIds = new Set();
    campaign.characters.forEach(character => {
      character.evidence = character.evidence.filter(entry => {
        const evidenceId = String(entry.evidenceId || "");
        if (!evidenceId || ownedEvidenceIds.has(evidenceId)) return false;
        ownedEvidenceIds.add(evidenceId);
        const catalogEntry = evidenceCatalogById.get(evidenceId);
        if (catalogEntry) {
          entry.title = catalogEntry.title;
          entry.name = catalogEntry.title;
          entry.description = catalogEntry.description;
          entry.image = catalogEntry.image;
          if (hasOwn(catalogEntry, "imageMeta")) entry.imageMeta = cloneImageMeta(catalogEntry.imageMeta);
        }
        return true;
      });
    });

    const catalogIds = new Set();
    campaign.traumaCatalog.forEach(trauma => {
      if (catalogIds.has(trauma.id)) trauma.id = String(makeId());
      catalogIds.add(trauma.id);
    });
    const traumaCatalogById = new Map(campaign.traumaCatalog.map(trauma => [trauma.id, trauma]));
    const traumaCatalogBySignature = new Map(campaign.traumaCatalog.map(trauma => [traumaCatalogSignature(trauma), trauma]));

    campaign.characters.forEach(character => {
      character.traumas.forEach(trauma => {
        let catalogTrauma = trauma.catalogId ? traumaCatalogById.get(trauma.catalogId) : null;
        if (!catalogTrauma) catalogTrauma = traumaCatalogBySignature.get(traumaCatalogSignature(trauma));
        if (!catalogTrauma) {
          let catalogId = String(trauma.catalogId || trauma.id || makeId());
          if (traumaCatalogById.has(catalogId)) catalogId = String(makeId());
          catalogTrauma = normalizeTraumaCatalogEntry({
            ...unknownProperties(trauma, ["id", "catalogId", "title", "description", "image", "acquiredAt"]),
            id: catalogId,
            title: trauma.title,
            image: trauma.image,
            createdAt: trauma.acquiredAt
          }, makeId);
          campaign.traumaCatalog.push(catalogTrauma);
          traumaCatalogById.set(catalogTrauma.id, catalogTrauma);
          traumaCatalogBySignature.set(traumaCatalogSignature(catalogTrauma), catalogTrauma);
        }
        trauma.catalogId = catalogTrauma.id;
      });
    });
    campaign.scenes = Array.isArray(campaign.scenes)
      ? campaign.scenes.map(scene => normalizeScene(scene, makeId))
      : [];
    campaign.sceneTrash = Array.isArray(campaign.sceneTrash)
      ? campaign.sceneTrash.map(scene => normalizeScene(scene, makeId))
      : [];
    campaign.liveScene = normalizeLiveScene(campaign.liveScene);
    campaign.gameBoard = normalizeGameBoard(campaign.gameBoard);
    campaign.previousGameBoard = normalizeGameBoard(campaign.previousGameBoard);
    campaign.chatSettings = normalizeChatSettings(campaign.chatSettings);

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
      ? character.inventory.find(entry => entry.itemId === itemId)
      : null;

    if (existing) {
      existing.quantity += quantity;
      if (String(item?.name || "").trim()) existing.name = String(item.name).trim();
      if (String(item?.description || "").trim()) existing.description = String(item.description).trim();
      if (String(item?.image || "").trim()) existing.image = String(item.image).trim();
      if (hasOwn(item, "imageMeta")) existing.imageMeta = cloneImageMeta(item.imageMeta);
      if (options.equipped === true) existing.equipped = true;
      if (!existing.notes && String(options.notes || "").trim()) existing.notes = String(options.notes).trim();
      return existing;
    }

    const entryData = {
      id: makeId(),
      itemId,
      name: item?.name || "Item",
      description: item?.description || "",
      image: item?.image || "",
      quantity,
      equipped: Boolean(options.equipped),
      notes: options.notes || "",
      grantedAt: new Date().toISOString()
    };
    if (hasOwn(item, "imageMeta")) entryData.imageMeta = cloneImageMeta(item.imageMeta);
    const entry = normalizeInventoryEntry(entryData, makeId);
    character.inventory.push(entry);
    return entry;
  }

  function setOriginLoadout(campaign, origin, entries = []) {
    normalizeCampaign(campaign);
    const normalizedOrigin = String(origin || "").trim();
    if (!normalizedOrigin) throw new Error("Selecione uma origem.");
    const catalogIds = new Set(campaign.items.map(item => String(item.id)));
    const quantities = new Map();

    entries.forEach(entry => {
      const itemId = String(entry?.itemId || "");
      const quantity = Number.parseInt(entry?.quantity, 10);
      if (!itemId || !catalogIds.has(itemId) || !Number.isFinite(quantity) || quantity <= 0) return;
      quantities.set(itemId, (quantities.get(itemId) || 0) + quantity);
    });

    campaign.originLoadouts ??= {};
    const normalizedEntries = Array.from(quantities, ([itemId, quantity]) => ({ itemId, quantity }));
    if (normalizedEntries.length) campaign.originLoadouts[normalizedOrigin] = normalizedEntries;
    else delete campaign.originLoadouts[normalizedOrigin];
    return normalizedEntries;
  }

  function getOriginLoadout(campaign, origin) {
    normalizeCampaign(campaign);
    return campaign.originLoadouts[String(origin || "").trim()] || [];
  }

  function hasAppliedOriginLoadout(character, origin) {
    return (character?.appliedOriginLoadouts || []).includes(String(origin || "").trim());
  }

  function applyOriginLoadout(campaign, characterId, options = {}, makeId = defaultId) {
    normalizeCampaign(campaign, makeId);
    const character = campaign.characters.find(entry => entry.id === String(characterId));
    if (!character) throw new Error("Personagem nao encontrado.");

    const origin = String(options.origin || character.origin || "").trim();
    const loadout = campaign.originLoadouts[origin] || [];
    if (!loadout.length) throw new Error("Nenhum kit inicial foi configurado para esta origem.");
    if (hasAppliedOriginLoadout(character, origin) && !options.force) {
      throw new Error("O kit inicial desta origem ja foi aplicado ao personagem.");
    }

    const catalogById = new Map(campaign.items.map(item => [String(item.id), item]));
    const granted = loadout.map(entry => {
      const item = catalogById.get(String(entry.itemId));
      if (!item) throw new Error("Um item do kit nao existe mais no catalogo.");
      return grantItem(campaign, character.id, item, { quantity: entry.quantity }, makeId);
    });

    if (!hasAppliedOriginLoadout(character, origin)) character.appliedOriginLoadouts.push(origin);
    return { character, granted, origin, reapplied: Boolean(options.force) };
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
    if (hasOwn(changes, "imageMeta")) normalizedChanges.imageMeta = cloneImageMeta(changes.imageMeta);
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

  function findEvidenceOwner(campaign, evidenceId) {
    normalizeCampaign(campaign);
    const normalizedEvidenceId = String(evidenceId || "");
    for (const character of campaign.characters) {
      const evidence = character.evidence.find(entry => String(entry.evidenceId) === normalizedEvidenceId);
      if (evidence) return { character, evidence };
    }
    return null;
  }

  function assignEvidence(campaign, evidenceId, characterId = null, makeId = defaultId) {
    normalizeCampaign(campaign, makeId);
    const normalizedEvidenceId = String(evidenceId || "");
    const catalogEntry = campaign.evidence.find(entry => String(entry.id) === normalizedEvidenceId);
    if (!catalogEntry) throw new Error("Evidencia nao encontrada na biblioteca.");

    const normalizedCharacterId = characterId ? String(characterId) : null;
    const targetCharacter = normalizedCharacterId
      ? campaign.characters.find(entry => String(entry.id) === normalizedCharacterId)
      : null;
    if (normalizedCharacterId && !targetCharacter) throw new Error("Personagem nao encontrado.");

    const existingOwnerEntry = campaign.characters
      .flatMap(character => character.evidence)
      .find(entry => String(entry.evidenceId) === normalizedEvidenceId);
    const existingTargetEntry = targetCharacter?.evidence.find(entry => String(entry.evidenceId) === normalizedEvidenceId);
    campaign.characters.forEach(character => {
      character.evidence = character.evidence.filter(entry => String(entry.evidenceId) !== normalizedEvidenceId);
    });
    if (!targetCharacter) return null;

    const previousEntry = existingTargetEntry || existingOwnerEntry;
    const knownEvidenceProperties = [
      "id", "evidenceId", "catalogId", "title", "name", "description", "image", "imageMeta",
      "grantedAt", "acquiredAt", "createdAt"
    ];
    const assignedData = {
      ...unknownProperties(catalogEntry, knownEvidenceProperties),
      ...unknownProperties(previousEntry, knownEvidenceProperties),
      id: existingTargetEntry?.id || makeId(),
      evidenceId: catalogEntry.id,
      title: catalogEntry.title,
      description: catalogEntry.description,
      image: catalogEntry.image,
      grantedAt: existingTargetEntry?.grantedAt || new Date().toISOString()
    };
    if (hasOwn(catalogEntry, "imageMeta")) assignedData.imageMeta = cloneImageMeta(catalogEntry.imageMeta);
    else if (hasOwn(previousEntry, "imageMeta")) assignedData.imageMeta = cloneImageMeta(previousEntry.imageMeta);
    const assigned = normalizeCharacterEvidenceEntry(assignedData, makeId);
    targetCharacter.evidence = [assigned, ...targetCharacter.evidence];
    return assigned;
  }

  function transferCharacterEvidence(campaign, fromCharacterId, toCharacterId, evidenceEntryId, makeId = defaultId) {
    normalizeCampaign(campaign, makeId);
    if (String(fromCharacterId) === String(toCharacterId)) throw new Error("Escolha outro personagem.");

    const sourceCharacter = campaign.characters.find(entry => String(entry.id) === String(fromCharacterId));
    const targetCharacter = campaign.characters.find(entry => String(entry.id) === String(toCharacterId));
    if (!sourceCharacter || !targetCharacter) throw new Error("Um dos personagens nao existe mais.");

    const sourceIndex = sourceCharacter.evidence.findIndex(entry => String(entry.id) === String(evidenceEntryId));
    if (sourceIndex < 0) throw new Error("A evidencia nao esta mais com o personagem de origem.");
    const sourceEvidence = sourceCharacter.evidence[sourceIndex];
    if (targetCharacter.evidence.some(entry => String(entry.evidenceId) === String(sourceEvidence.evidenceId))) {
      throw new Error("O personagem de destino ja possui esta evidencia.");
    }

    sourceCharacter.evidence.splice(sourceIndex, 1);
    const transferred = normalizeCharacterEvidenceEntry({
      ...sourceEvidence,
      id: makeId(),
      grantedAt: new Date().toISOString()
    }, makeId);
    targetCharacter.evidence = [transferred, ...targetCharacter.evidence];
    return transferred;
  }

  function isEvidenceTransferPending(campaign, characterId, evidenceEntryId, exceptTransferId = null) {
    normalizeCampaign(campaign);
    return (campaign.itemTransfers || []).some(transfer => (
      transfer.status === "pending"
      && transfer.type === "evidence"
      && String(transfer.fromCharacterId || "") === String(characterId)
      && String(transfer.evidenceEntryId || "") === String(evidenceEntryId)
      && (!exceptTransferId || String(transfer.id) !== String(exceptTransferId))
    ));
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
    applyOriginLoadout,
    assignCharacter,
    assignEvidence,
    findEvidenceOwner,
    getControlledParticipants,
    getOriginLoadout,
    grantItem,
    hasAppliedOriginLoadout,
    normalizeCampaign,
    normalizeChatSettings,
    normalizeCharacter,
    normalizeCharacterEvidenceEntry,
    normalizeEmail,
    normalizeEvidenceCatalogEntry,
    normalizeExpression,
    normalizeInventoryEntry,
    normalizeItemCatalogEntry,
    normalizeLiveScene,
    normalizeGameBoard,
    normalizePlayer,
    normalizeOriginLoadouts,
    normalizeScene,
    normalizeTrauma,
    normalizeTraumaCatalogEntry,
    publishScene,
    presenceState,
    releasePlayer,
    removeInventoryEntry,
    reservedTransferQuantity,
    isEvidenceTransferPending,
    setScenePresentationActive,
    setOriginLoadout,
    stepScene,
    transferInventoryItem,
    transferCharacterEvidence,
    updateInventoryEntry
  };

  globalScope.CDITabletop = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
