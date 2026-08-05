const test = require("node:test");
const assert = require("node:assert/strict");
const tabletop = require("../js/game/tabletop-model.js");

function sequentialIds() {
  let value = 0;
  return () => `generated-${++value}`;
}

test("normalizes legacy links without losing the prepared character", () => {
  const campaign = {
    players: [{ id: "player-1", name: "Ana", email: "ANA@EXAMPLE.COM", characterId: "char-1" }],
    characters: [{ id: "char-1", name: "Morgana" }]
  };

  tabletop.normalizeCampaign(campaign, sequentialIds());

  assert.equal(campaign.schemaVersion, 5);
  assert.equal(campaign.players[0].emailNormalized, "ana@example.com");
  assert.equal(campaign.players[0].status, "pending");
  assert.equal(campaign.players[0].characterId, "char-1");
  assert.equal(campaign.characters[0].controllerPlayerId, "player-1");
  assert.deepEqual(campaign.characters[0].inventory, []);
  assert.deepEqual(campaign.characters[0].appliedOriginLoadouts, []);
  assert.deepEqual(campaign.originLoadouts, {});
  assert.deepEqual(campaign.characters[0].evidence, []);
  assert.deepEqual(campaign.characters[0].traumas, []);
  assert.deepEqual(campaign.traumaCatalog, []);
  assert.deepEqual(campaign.characters[0].expressions, []);
  assert.equal(campaign.characters[0].activeExpression, "");
  assert.deepEqual(campaign.chatSettings, {
    publicEnabled: true,
    privateEnabled: true,
    privateThreads: {},
    updatedAt: null
  });
});

test("keeps the master chat availability settings", () => {
  const settings = tabletop.normalizeChatSettings({
    publicEnabled: false,
    privateEnabled: true,
    privateThreads: {
      "player-1::player-2": false,
      "player-1::player-3": true,
      invalid: "yes"
    },
    updatedAt: "2026-07-31T12:00:00.000Z"
  });

  assert.deepEqual(settings, {
    publicEnabled: false,
    privateEnabled: true,
    privateThreads: {
      "player-1::player-2": false,
      "player-1::player-3": true
    },
    updatedAt: "2026-07-31T12:00:00.000Z"
  });
});

test("normalizes reusable character expressions and discards an invalid active selection", () => {
  const character = {
    id: "char-1",
    expressions: [{
      id: "expression-tense",
      title: "Tenso",
      image: "tenso.jpg",
      createdAt: "2026-07-31T10:00:00.000Z"
    }],
    activeExpression: "expression-tense"
  };

  tabletop.normalizeCharacter(character, sequentialIds());

  assert.deepEqual(character.expressions[0], {
    id: "expression-tense",
    title: "Tenso",
    image: "tenso.jpg",
    createdAt: "2026-07-31T10:00:00.000Z"
  });
  assert.equal(character.activeExpression, "expression-tense");

  character.activeExpression = "expression-missing";
  tabletop.normalizeCharacter(character, sequentialIds());
  assert.equal(character.activeExpression, "");
});

test("preserves image metadata and unknown properties while normalizing visual assets", () => {
  const campaign = {
    players: [],
    gameBoard: {
      image: "board.jpg",
      imageMeta: { assetId: "board-asset", width: 2400, height: 1600 },
      viewportMode: "contain"
    },
    previousGameBoard: {
      image: "board-previous.jpg",
      imageMeta: { assetId: "previous-board-asset", width: 1920, height: 1080 },
      viewportMode: "contain"
    },
    traumaCatalog: [],
    characters: [{
      id: "char-1",
      expressions: [{
        id: "expression-1",
        title: "Tenso",
        image: "expression.jpg",
        imageMeta: { assetId: "expression-asset" },
        focusPoint: "center"
      }],
      traumas: [{
        id: "trauma-1",
        title: "Escuro",
        image: "trauma.jpg",
        imageMeta: { assetId: "trauma-asset" },
        visualVariant: "night"
      }]
    }],
    scenes: [{
      id: "scene-1",
      title: "Entrada",
      image: "scene.jpg",
      imageMeta: { assetId: "scene-asset", publicId: "scenes/entry" },
      assetAuditId: "private-audit-1"
    }]
  };

  tabletop.normalizeCampaign(campaign, sequentialIds());

  assert.deepEqual(campaign.gameBoard.imageMeta, { assetId: "board-asset", width: 2400, height: 1600 });
  assert.equal(campaign.gameBoard.viewportMode, "contain");
  assert.deepEqual(campaign.previousGameBoard.imageMeta, { assetId: "previous-board-asset", width: 1920, height: 1080 });
  assert.equal(campaign.characters[0].expressions[0].focusPoint, "center");
  assert.equal(campaign.characters[0].expressions[0].imageMeta.assetId, "expression-asset");
  assert.equal(campaign.characters[0].traumas[0].visualVariant, "night");
  assert.equal(campaign.traumaCatalog[0].visualVariant, "night");
  assert.equal(campaign.traumaCatalog[0].imageMeta.assetId, "trauma-asset");
  assert.equal(campaign.scenes[0].assetAuditId, "private-audit-1");
  assert.equal(campaign.scenes[0].imageMeta.publicId, "scenes/entry");
});

test("migrates legacy character traumas into the reusable campaign catalog", () => {
  const campaign = {
    players: [],
    characters: [{
      id: "char-1",
      traumas: [{
        id: "trauma-1",
        title: "Aracnofobia",
        description: "Medo intenso de aranhas.",
        image: "aranha.jpg",
        acquiredAt: "2026-07-30T21:45:00.000Z"
      }]
    }]
  };

  tabletop.normalizeCampaign(campaign, sequentialIds());

  assert.equal(campaign.characters[0].traumas.length, 1);
  assert.deepEqual(campaign.characters[0].traumas[0], {
    id: "trauma-1",
    catalogId: "trauma-1",
    title: "Aracnofobia",
    description: "Medo intenso de aranhas.",
    image: "aranha.jpg",
    acquiredAt: "2026-07-30T21:45:00.000Z"
  });
  assert.deepEqual(campaign.traumaCatalog, [{
    id: "trauma-1",
    title: "Aracnofobia",
    image: "aranha.jpg",
    createdAt: "2026-07-30T21:45:00.000Z"
  }]);
  assert.equal("traumas" in campaign, false);
});

test("reuses one catalog entry for matching legacy traumas on different characters", () => {
  const campaign = {
    players: [],
    characters: [
      { id: "char-1", traumas: [{ id: "owned-1", title: "Aracnofobia", image: "aranha.jpg" }] },
      { id: "char-2", traumas: [{ id: "owned-2", title: "Aracnofobia", image: "aranha.jpg" }] }
    ]
  };

  tabletop.normalizeCampaign(campaign, sequentialIds());

  assert.equal(campaign.traumaCatalog.length, 1);
  assert.equal(campaign.characters[0].traumas[0].catalogId, campaign.traumaCatalog[0].id);
  assert.equal(campaign.characters[1].traumas[0].catalogId, campaign.traumaCatalog[0].id);
});

test("prevents the same character from being assigned to two players", () => {
  const campaign = {
    players: [
      { id: "player-1", name: "Ana" },
      { id: "player-2", name: "Bruno" }
    ],
    characters: [{ id: "char-1", name: "Morgana" }]
  };

  tabletop.assignCharacter(campaign, "player-1", "char-1");
  assert.throws(
    () => tabletop.assignCharacter(campaign, "player-2", "char-1"),
    /ja esta vinculado/
  );

  tabletop.assignCharacter(campaign, "player-1", null);
  tabletop.assignCharacter(campaign, "player-2", "char-1");
  assert.equal(campaign.players[1].characterId, "char-1");
  assert.equal(campaign.characters[0].controllerPlayerId, "player-2");
});

test("keeps a character link when the player becomes offline", () => {
  const campaign = {
    players: [{
      id: "player-1",
      name: "Ana",
      authUid: "auth-1",
      characterId: "char-1",
      online: false,
      lastSeen: "2026-07-30T00:00:00.000Z"
    }],
    characters: [{ id: "char-1", name: "Morgana", controllerPlayerId: "player-1" }]
  };

  tabletop.normalizeCampaign(campaign, sequentialIds());

  assert.equal(campaign.players[0].characterId, "char-1");
  assert.equal(campaign.characters[0].controllerPlayerId, "player-1");
  assert.equal(tabletop.presenceState(campaign.players[0], Date.parse("2026-07-30T01:00:00.000Z")), "offline");
});

test("shows only characters controlled by authenticated players in the room", () => {
  const now = Date.now();
  const campaign = {
    players: [
      {
        id: "player-online",
        name: "Ana",
        authUid: "auth-1",
        characterId: "char-1",
        online: true,
        lastSeen: new Date(now - 1000).toISOString()
      },
      {
        id: "player-pending",
        name: "Bruno",
        authUid: null,
        characterId: "char-2"
      }
    ],
    characters: [
      { id: "char-1", name: "Morgana" },
      { id: "char-2", name: "Orion" },
      { id: "char-3", name: "Sem dono" }
    ]
  };

  const participants = tabletop.getControlledParticipants(campaign, now);

  assert.equal(participants.length, 1);
  assert.equal(participants[0].character.name, "Morgana");
  assert.equal(participants[0].presence, "online");
});

test("grants, stacks and edits items in an individual inventory", () => {
  const ids = sequentialIds();
  const campaign = {
    players: [],
    characters: [{ id: "char-1", name: "Morgana", inventory: [] }]
  };
  const item = { id: "item-1", name: "Pocao", description: "Recupera vida", image: "pocao.jpg" };

  const first = tabletop.grantItem(campaign, "char-1", item, { quantity: 2 }, ids);
  const stacked = tabletop.grantItem(campaign, "char-1", {
    ...item,
    name: "Pocao reforcada",
    description: "Recupera ainda mais vida",
    image: "pocao-reforcada.jpg"
  }, { quantity: 3 }, ids);
  assert.equal(stacked.name, "Pocao reforcada");
  assert.equal(stacked.description, "Recupera ainda mais vida");
  assert.equal(stacked.image, "pocao-reforcada.jpg");

  tabletop.updateInventoryEntry(campaign, "char-1", first.id, {
    name: "Pocao maior",
    description: "Recupera muita vida",
    image: "pocao-maior.jpg",
    equipped: true,
    notes: "No cinto"
  });

  assert.equal(first.id, stacked.id);
  assert.equal(stacked.quantity, 5);
  assert.equal(stacked.name, "Pocao maior");
  assert.equal(stacked.description, "Recupera muita vida");
  assert.equal(stacked.image, "pocao-maior.jpg");
  assert.equal(stacked.equipped, true);
  assert.equal(stacked.notes, "No cinto");

  assert.throws(
    () => tabletop.updateInventoryEntry(campaign, "char-1", first.id, { name: "", image: "" }),
    /titulo/
  );
  assert.equal(stacked.name, "Pocao maior");
});

test("copies and refreshes item image metadata when granting or stacking", () => {
  const ids = sequentialIds();
  const campaign = { players: [], characters: [{ id: "char-1", inventory: [] }] };
  const originalMeta = { assetId: "asset-old", publicId: "items/potion", width: 800, height: 800 };

  const first = tabletop.grantItem(campaign, "char-1", {
    id: "item-1",
    name: "Pocao",
    image: "old.jpg",
    imageMeta: originalMeta
  }, {}, ids);

  assert.deepEqual(first.imageMeta, originalMeta);
  assert.notEqual(first.imageMeta, originalMeta);

  const refreshedMeta = { assetId: "asset-new", publicId: "items/potion-v2", width: 1200, height: 900 };
  const stacked = tabletop.grantItem(campaign, "char-1", {
    id: "item-1",
    name: "Pocao",
    image: "new.jpg",
    imageMeta: refreshedMeta
  }, {}, ids);

  assert.equal(stacked.id, first.id);
  assert.equal(stacked.image, "new.jpg");
  assert.deepEqual(stacked.imageMeta, refreshedMeta);
  assert.notEqual(stacked.imageMeta, refreshedMeta);

  const editedMeta = { assetId: "asset-edited", publicId: "items/potion-v3", width: 1600, height: 1200 };
  tabletop.updateInventoryEntry(campaign, "char-1", first.id, {
    image: "edited.jpg",
    imageMeta: editedMeta
  });
  assert.equal(first.image, "edited.jpg");
  assert.deepEqual(first.imageMeta, editedMeta);
  assert.notEqual(first.imageMeta, editedMeta);
});

test("keeps catalog items reusable and stacks one slot per character", () => {
  const campaign = {
    players: [],
    items: [{ id: "item-lanterna", name: "Lanterna", description: "Ilumina", image: "lanterna.jpg", revealed: true }],
    characters: [
      { id: "char-padre", origin: "Padre", inventory: [] },
      { id: "char-cacador", origin: "Cacador", inventory: [] }
    ]
  };

  tabletop.normalizeCampaign(campaign);
  assert.equal(campaign.items[0].revealed, undefined);

  tabletop.grantItem(campaign, "char-padre", campaign.items[0], { quantity: 1, notes: "Na mochila" });
  tabletop.grantItem(campaign, "char-padre", campaign.items[0], { quantity: 2, notes: "Na cintura" });
  tabletop.grantItem(campaign, "char-cacador", campaign.items[0], { quantity: 4 });

  assert.equal(campaign.characters[0].inventory.length, 1);
  assert.equal(campaign.characters[0].inventory[0].quantity, 3);
  assert.equal(campaign.characters[0].inventory[0].notes, "Na mochila");
  assert.equal(campaign.characters[1].inventory.length, 1);
  assert.equal(campaign.characters[1].inventory[0].quantity, 4);
  assert.notEqual(campaign.characters[0].inventory[0], campaign.characters[1].inventory[0]);
});

test("configures and applies an origin kit without accidental duplication", () => {
  const ids = sequentialIds();
  const campaign = {
    players: [],
    items: [
      { id: "crossbow", name: "Besta", description: "Arma", image: "besta.jpg" },
      { id: "arrows", name: "Flechas", description: "Municao", image: "flechas.jpg" },
      { id: "knife", name: "Faca de cacada", description: "Lamina", image: "faca.jpg" }
    ],
    characters: [{ id: "char-1", origin: "Cacador", inventory: [] }]
  };

  const loadout = tabletop.setOriginLoadout(campaign, "Cacador", [
    { itemId: "crossbow", quantity: 1 },
    { itemId: "arrows", quantity: 10 },
    { itemId: "arrows", quantity: 5 },
    { itemId: "knife", quantity: 1 },
    { itemId: "missing", quantity: 99 }
  ]);
  assert.deepEqual(loadout, [
    { itemId: "crossbow", quantity: 1 },
    { itemId: "arrows", quantity: 15 },
    { itemId: "knife", quantity: 1 }
  ]);

  tabletop.applyOriginLoadout(campaign, "char-1", {}, ids);
  assert.deepEqual(campaign.characters[0].inventory.map(item => [item.itemId, item.quantity]), [
    ["crossbow", 1],
    ["arrows", 15],
    ["knife", 1]
  ]);
  assert.deepEqual(campaign.characters[0].appliedOriginLoadouts, ["Cacador"]);
  assert.throws(() => tabletop.applyOriginLoadout(campaign, "char-1", {}, ids), /ja foi aplicado/);

  tabletop.applyOriginLoadout(campaign, "char-1", { force: true }, ids);
  assert.deepEqual(campaign.characters[0].inventory.map(item => [item.itemId, item.quantity]), [
    ["crossbow", 2],
    ["arrows", 30],
    ["knife", 2]
  ]);
  assert.deepEqual(campaign.characters[0].appliedOriginLoadouts, ["Cacador"]);
});

test("adds a freeform item directly to a character inventory", () => {
  const campaign = {
    players: [],
    characters: [{ id: "char-1", name: "Morgana", inventory: [] }]
  };

  const item = tabletop.grantItem(campaign, "char-1", {
    name: "Chave improvisada",
    description: "Abre a porta do arquivo",
    image: "chave.jpg"
  }, {
    quantity: 2,
    equipped: true,
    notes: "Presa ao cinto",
    stack: false
  }, sequentialIds());

  assert.equal(item.itemId, null);
  assert.equal(item.name, "Chave improvisada");
  assert.equal(item.description, "Abre a porta do arquivo");
  assert.equal(item.image, "chave.jpg");
  assert.equal(item.quantity, 2);
  assert.equal(item.equipped, true);
  assert.equal(item.notes, "Presa ao cinto");
});

test("moves only the approved quantity between character inventories", () => {
  const ids = sequentialIds();
  const campaign = {
    players: [],
    characters: [
      {
        id: "char-1",
        name: "Morgana",
        inventory: [{ id: "inv-1", itemId: "item-1", name: "Flecha", quantity: 3 }]
      },
      { id: "char-2", name: "Orion", inventory: [] }
    ]
  };

  tabletop.transferInventoryItem(campaign, "char-1", "char-2", "inv-1", 2, ids);

  assert.equal(campaign.characters[0].inventory[0].quantity, 1);
  assert.equal(campaign.characters[1].inventory[0].quantity, 2);
  assert.throws(
    () => tabletop.transferInventoryItem(campaign, "char-1", "char-2", "inv-1", 2, ids),
    /Quantidade indisponivel/
  );
});

test("reserves quantities while item transfer requests are pending", () => {
  const campaign = {
    players: [],
    characters: [{
      id: "char-1",
      inventory: [{ id: "inv-1", itemId: "item-1", name: "Flecha", quantity: 5 }]
    }],
    itemTransfers: [
      { id: "transfer-1", type: "item", status: "pending", fromCharacterId: "char-1", inventoryId: "inv-1", quantity: 2 },
      { id: "transfer-2", type: "item", status: "rejected", fromCharacterId: "char-1", inventoryId: "inv-1", quantity: 4 }
    ]
  };

  assert.equal(tabletop.reservedTransferQuantity(campaign, "char-1", "inv-1"), 2);
  assert.equal(tabletop.availableInventoryQuantity(campaign, "char-1", "inv-1"), 3);
  assert.equal(tabletop.reservedTransferQuantity(campaign, "char-1", "inv-1", "transfer-1"), 0);
});

test("normalizes legacy evidence titles and keeps a single character owner", () => {
  const campaign = {
    players: [],
    evidence: [{ id: "evidence-1", name: "Fotografia", description: "Uma pista", image: "pista.jpg" }],
    characters: [
      {
        id: "char-1",
        evidence: [{ id: "owned-1", evidenceId: "evidence-1", name: "Nome antigo", image: "old.jpg" }]
      },
      {
        id: "char-2",
        evidence: [{ id: "owned-2", evidenceId: "evidence-1", title: "Duplicada" }]
      }
    ]
  };

  tabletop.normalizeCampaign(campaign, sequentialIds());

  assert.equal(campaign.evidence[0].title, "Fotografia");
  assert.equal(campaign.evidence[0].name, "Fotografia");
  assert.equal(campaign.characters[0].evidence[0].title, "Fotografia");
  assert.equal(campaign.characters[0].evidence[0].description, "Uma pista");
  assert.equal(campaign.characters[0].evidence[0].image, "pista.jpg");
  assert.equal(campaign.characters[1].evidence.length, 0);
});

test("links, moves and unlinks one catalog evidence without duplicating ownership", () => {
  const ids = sequentialIds();
  const campaign = {
    players: [],
    evidence: [{ id: "evidence-1", title: "Carta", description: "Carta rasgada", image: "carta.jpg" }],
    characters: [
      { id: "char-1", evidence: [] },
      { id: "char-2", evidence: [] }
    ]
  };

  const first = tabletop.assignEvidence(campaign, "evidence-1", "char-1", ids);
  assert.equal(first.evidenceId, "evidence-1");
  assert.equal(tabletop.findEvidenceOwner(campaign, "evidence-1").character.id, "char-1");

  tabletop.assignEvidence(campaign, "evidence-1", "char-2", ids);
  assert.equal(campaign.characters[0].evidence.length, 0);
  assert.equal(campaign.characters[1].evidence.length, 1);

  tabletop.assignEvidence(campaign, "evidence-1", null, ids);
  assert.equal(tabletop.findEvidenceOwner(campaign, "evidence-1"), null);
});

test("keeps evidence metadata and unknown properties across assignment and transfer", () => {
  const ids = sequentialIds();
  const campaign = {
    players: [],
    evidence: [{
      id: "evidence-1",
      title: "Carta",
      image: "carta.jpg",
      imageMeta: { assetId: "evidence-asset", publicId: "evidence/letter" },
      catalogMarker: "catalog-value"
    }],
    characters: [
      {
        id: "char-1",
        evidence: [{
          id: "owned-1",
          evidenceId: "evidence-1",
          title: "Carta",
          image: "old.jpg",
          ownerMarker: "owner-value"
        }]
      },
      { id: "char-2", evidence: [] }
    ]
  };

  const assigned = tabletop.assignEvidence(campaign, "evidence-1", "char-2", ids);
  assert.deepEqual(assigned.imageMeta, { assetId: "evidence-asset", publicId: "evidence/letter" });
  assert.equal(assigned.catalogMarker, "catalog-value");
  assert.equal(assigned.ownerMarker, "owner-value");

  const transferred = tabletop.transferCharacterEvidence(campaign, "char-2", "char-1", assigned.id, ids);
  assert.deepEqual(transferred.imageMeta, assigned.imageMeta);
  assert.equal(transferred.catalogMarker, "catalog-value");
  assert.equal(transferred.ownerMarker, "owner-value");
});

test("moves an owned evidence only after approval and reserves pending requests", () => {
  const ids = sequentialIds();
  const campaign = {
    players: [],
    evidence: [{ id: "evidence-1", title: "Gravacao", description: "Audio", image: "audio.jpg" }],
    characters: [
      {
        id: "char-1",
        evidence: [{ id: "owned-1", evidenceId: "evidence-1", title: "Gravacao", description: "Audio", image: "audio.jpg" }]
      },
      { id: "char-2", evidence: [] }
    ],
    itemTransfers: [{
      id: "transfer-1",
      type: "evidence",
      status: "pending",
      fromCharacterId: "char-1",
      evidenceEntryId: "owned-1"
    }]
  };

  assert.equal(tabletop.isEvidenceTransferPending(campaign, "char-1", "owned-1"), true);
  assert.equal(tabletop.isEvidenceTransferPending(campaign, "char-1", "owned-1", "transfer-1"), false);

  const moved = tabletop.transferCharacterEvidence(campaign, "char-1", "char-2", "owned-1", ids);
  assert.equal(moved.evidenceId, "evidence-1");
  assert.equal(campaign.characters[0].evidence.length, 0);
  assert.equal(campaign.characters[1].evidence.length, 1);
});

test("publishes only public scene fields and clears them when hidden", () => {
  const campaign = {
    players: [],
    characters: [],
    scenes: [
      {
        id: "scene-1",
        title: "Entrada",
        caption: "A porta se abre",
        masterNotes: "Emboscada",
        image: "one.jpg",
        imageMeta: { assetId: "private-asset", publicId: "scenes/one" },
        assetAuditId: "private-audit"
      },
      { id: "scene-2", title: "Sala", caption: "Uma sala vazia", masterNotes: "Teste secreto", image: "two.jpg" }
    ]
  };

  const live = tabletop.publishScene(campaign, "scene-1", { active: true });
  assert.equal(live.active, true);
  assert.equal(live.image, "one.jpg");
  assert.equal("title" in live, false);
  assert.equal("caption" in live, false);
  assert.equal("masterNotes" in live, false);
  assert.equal("imageMeta" in live, false);
  assert.equal("assetAuditId" in live, false);
  assert.equal(campaign.scenes[0].imageMeta.assetId, "private-asset");
  assert.equal(campaign.scenes[0].assetAuditId, "private-audit");

  tabletop.stepScene(campaign, 1);
  assert.equal(campaign.liveScene.sceneId, "scene-2");
  assert.equal(campaign.liveScene.index, 1);

  tabletop.setScenePresentationActive(campaign, false);
  assert.equal(campaign.liveScene.active, false);
  assert.equal(campaign.liveScene.image, "");
  assert.equal(campaign.liveScene.sceneId, null);
});

test("releases a character when its player is removed", () => {
  const campaign = {
    players: [{ id: "player-1", name: "Ana", characterId: "char-1" }],
    characters: [{ id: "char-1", name: "Morgana" }]
  };

  tabletop.releasePlayer(campaign, "player-1");

  assert.equal(campaign.players[0].characterId, null);
  assert.equal(campaign.characters[0].controllerPlayerId, null);
});
