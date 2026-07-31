import test from "node:test";
import assert from "node:assert/strict";
import { createCampaignRepository } from "../js/firebase/campaign-repository.js";

function createFakeContext({ baseCampaign = null, documents = {}, user = { uid: "auth-1", email: "ana@example.com" } } = {}) {
  const writes = [];
  const storedDocuments = new Map(Object.entries(documents).map(([key, value]) => [key, structuredClone(value)]));
  const snapshot = ref => {
    const data = storedDocuments.get(ref);
    return {
      exists: () => Boolean(data),
      id: String(ref).split("/").pop(),
      data: () => structuredClone(data)
    };
  };
  const api = {
    arrayRemove(value) { return { __op: "arrayRemove", value }; },
    arrayUnion(value) { return [value]; },
    collection(...segments) { return segments.join("/"); },
    deleteField() { return "__DELETE_FIELD__"; },
    doc(...segments) { return segments.join("/"); },
    async deleteDoc(ref) { writes.push({ method: "delete", ref }); },
    async enableNetwork() {},
    async getDoc() {
      return {
        exists: () => Boolean(baseCampaign),
        id: baseCampaign?.id,
        data: () => ({ ...baseCampaign })
      };
    },
    async getDocs() { return { docs: [] }; },
    async runTransaction(_db, operation) {
      const pending = [];
      const result = await operation({
        async get(ref) { return snapshot(ref); },
        update(ref, data) { pending.push({ method: "update", ref, data }); },
        delete(ref) { pending.push({ method: "delete", ref }); }
      });
      pending.forEach(({ method, ref, data }) => {
        if (method === "delete") {
          storedDocuments.delete(ref);
          writes.push({ method: "transaction-delete", ref });
          return;
        }
        const current = storedDocuments.get(ref) || {};
        const next = { ...current };
        Object.entries(data).forEach(([key, value]) => {
          if (value?.__op === "arrayRemove") {
            next[key] = (next[key] || []).filter(entry => entry !== value.value);
          } else {
            next[key] = structuredClone(value);
          }
        });
        storedDocuments.set(ref, next);
        writes.push({ method: "transaction-update", ref, data });
      });
      return result;
    },
    async setDoc(ref, data, options) { writes.push({ method: "set", ref, data, options }); },
    async updateDoc(ref, data) { writes.push({ method: "update", ref, data }); }
  };
  return {
    context: { api, auth: { currentUser: user }, db: "db", projectId: "demo" },
    documents: storedDocuments,
    writes
  };
}

function campaignFixture() {
  return {
    id: "campaign-1",
    masterId: "master-1",
    members: ["master-1"],
    players: [
      { id: "player-1", email: "ANA@EXAMPLE.COM", characterId: "char-1" },
      { id: "player-2", email: "waiting@example.com", characterId: null }
    ],
    characters: [
      { id: "char-1", controllerPlayerId: "player-1", health: 10, sanity: 8, skills: [], inventory: [{ id: "inv-1", name: "Pocao" }], evidence: [{ id: "owned-1" }] }
    ],
    cases: [], creatures: [], items: [], evidence: [], marks: [], diceLogs: [], messages: [], itemTransfers: []
  };
}

test("master persistence records only linked player emails as ready", async () => {
  const { context, writes } = createFakeContext();
  const repository = createCampaignRepository(context);

  await repository.saveCampaign(campaignFixture(), { role: "master" });

  const baseWrite = writes.find(write => write.ref === "db/campaigns/campaign-1");
  assert.deepEqual(baseWrite.data.readyPlayerEmails, ["ana@example.com"]);
});

test("player persistence never writes inventory or master-owned character fields", async () => {
  const { context, writes } = createFakeContext();
  const repository = createCampaignRepository(context);

  await repository.saveCampaign(campaignFixture(), { role: "player", playerId: "player-1" });

  const characterWrite = writes.find(write => write.ref === "db/campaigns/campaign-1/characters/char-1");
  assert.deepEqual(Object.keys(characterWrite.data).sort(), ["controllerPlayerId", "health", "sanity", "skills"]);
  assert.equal("inventory" in characterWrite.data, false);
  assert.equal("evidence" in characterWrite.data, false);
});

test("chat sends one isolated message document with the authenticated author", async () => {
  const { context, writes } = createFakeContext();
  const repository = createCampaignRepository(context);

  const message = await repository.sendCampaignMessage("campaign-1", {
    id: "message-1",
    author: "Ana",
    authorId: "master-forged",
    playerId: "player-1",
    text: "Ola, mesa!",
    time: "21:30",
    sentAt: "2026-07-30T21:30:00.000Z"
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "set");
  assert.equal(writes[0].ref, "db/campaigns/campaign-1/messages/message-1");
  assert.equal(writes[0].data.authorId, "auth-1");
  assert.equal(writes[0].data.text, "Ola, mesa!");
  assert.equal(writes[0].data.playerId, "player-1");
  assert.equal(writes[0].data._order < 0, true);
  assert.equal(message.authorId, "auth-1");
});

test("dice roll is stored immediately with the authenticated player and origin", async () => {
  const { context, writes } = createFakeContext();
  const repository = createCampaignRepository(context);

  const roll = await repository.recordDiceRoll("campaign-1", {
    id: "roll-1",
    author: "Nome que nao deve aparecer",
    authorId: "forged-author",
    playerId: "player-1",
    characterId: "char-1",
    rollerRole: "player",
    origin: "Medica",
    sides: 20,
    die: 14,
    bonus: 2,
    bonusText: " (14 +2)",
    total: 16,
    label: "Percepcao",
    time: "21:32",
    createdAt: "2026-07-31T21:32:00.000Z"
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "set");
  assert.equal(writes[0].ref, "db/campaigns/campaign-1/diceLogs/roll-1");
  assert.equal(writes[0].data.authorId, "auth-1");
  assert.equal(writes[0].data.author, "Medica");
  assert.equal(writes[0].data.origin, "Medica");
  assert.equal(writes[0].data.total, 16);
  assert.equal(writes[0].data._order < 0, true);
  assert.equal(roll.authorId, "auth-1");
  assert.equal(roll.author, "Medica");
});

test("private chat stores only the two participants and the authenticated sender", async () => {
  const { context, writes } = createFakeContext();
  const repository = createCampaignRepository(context);
  const message = await repository.sendPrivateCampaignMessage("campaign-1", {
    id: "private-1",
    threadId: "player-1::player-2",
    participantPlayerIds: ["player-1", "player-2"],
    participantCharacterIds: ["char-1", "char-2"],
    participantAuthUids: ["auth-1", "auth-2"],
    participantOrigins: ["Medica", "Cacador"],
    authorId: "forged-author",
    authorRole: "player",
    authorPlayerId: "player-1",
    authorCharacterId: "char-1",
    authorOrigin: "Medica",
    text: "Encontre-me na floresta.",
    sentAt: "2026-07-31T12:00:00.000Z"
  });

  const privateWrites = writes.filter(entry => entry.ref.includes("/privateMessages/private-1--"));
  assert.equal(privateWrites.length, 2);
  assert.deepEqual(privateWrites.map(write => write.data.accessUid).sort(), ["auth-1", "auth-2"]);
  privateWrites.forEach(write => {
    assert.equal(write.method, "set");
    assert.equal(write.data.authorId, "auth-1");
    assert.equal(write.data.conversationType, "players");
    assert.deepEqual(write.data.participantAuthUids, ["auth-1", "auth-2"]);
    assert.equal(write.data.threadId, "player-1::player-2");
    assert.equal("author" in write.data, false);
    assert.equal("playerName" in write.data, false);
  });
  assert.equal(message.authorId, "auth-1");
});

test("master-player chat stores one character participant and both access identities", async () => {
  const { context, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" }
  });
  const repository = createCampaignRepository(context);

  await repository.sendPrivateCampaignMessage("campaign-1", {
    id: "master-private-1",
    threadId: "master::player-1",
    conversationType: "master-player",
    participantPlayerIds: ["player-1"],
    participantCharacterIds: ["char-1"],
    participantAuthUids: ["master-1", "auth-1"],
    participantOrigins: ["Mestre", "Medica"],
    authorRole: "master",
    authorOrigin: "Mestre",
    text: "Voce percebeu algo na sala."
  });

  const privateWrites = writes.filter(entry => entry.ref.includes("/privateMessages/master-private-1--"));
  assert.equal(privateWrites.length, 2);
  assert.deepEqual(privateWrites.map(write => write.data.accessUid).sort(), ["auth-1", "master-1"]);
  privateWrites.forEach(write => {
    assert.equal(write.data.conversationType, "master-player");
    assert.deepEqual(write.data.participantPlayerIds, ["player-1"]);
    assert.deepEqual(write.data.participantCharacterIds, ["char-1"]);
    assert.equal(write.data.authorId, "master-1");
  });
});

test("private chat watcher scopes players by access and deduplicates the master feed", () => {
  const listeners = [];
  const api = {
    collection(...segments) { return segments.join("/"); },
    where(field, operator, value) { return { field, operator, value }; },
    query(ref, condition) { return { ref, condition }; },
    onSnapshot(source, _options, next) {
      const listener = { source, next, active: true };
      listeners.push(listener);
      return () => { listener.active = false; };
    }
  };
  const repository = createCampaignRepository({
    api,
    auth: { currentUser: { uid: "auth-1" } },
    db: "db",
    projectId: "demo"
  });

  let playerMessages = [];
  const unsubscribePlayer = repository.watchPrivateMessages(
    "campaign-1",
    { role: "player" },
    messages => { playerMessages = messages; }
  );
  assert.deepEqual(listeners[0].source.condition, {
    field: "accessUid",
    operator: "==",
    value: "auth-1"
  });
  listeners[0].next({
    docs: [{
      id: "private-1--auth-1",
      data: () => ({ id: "private-1", text: "Segredo", accessUid: "auth-1", _order: -2 })
    }],
    metadata: { fromCache: false, hasPendingWrites: false }
  });
  assert.deepEqual(playerMessages.map(message => message.id), ["private-1"]);
  unsubscribePlayer();
  assert.equal(listeners[0].active, false);

  let masterMessages = [];
  repository.watchPrivateMessages(
    "campaign-1",
    { role: "master" },
    messages => { masterMessages = messages; }
  );
  assert.equal(listeners[1].source, "db/campaigns/campaign-1/privateMessages");
  listeners[1].next({
    docs: [
      {
        id: "private-1--auth-1",
        data: () => ({ id: "private-1", text: "Segredo", accessUid: "auth-1", _order: -2 })
      },
      {
        id: "private-1--auth-2",
        data: () => ({ id: "private-1", text: "Segredo", accessUid: "auth-2", _order: -2 })
      }
    ],
    metadata: { fromCache: false, hasPendingWrites: false }
  });
  assert.deepEqual(masterMessages.map(message => message.id), ["private-1"]);
});

test("master inventory delivery writes the character document immediately", async () => {
  const { context, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" }
  });
  const repository = createCampaignRepository(context);
  const inventory = [{
    id: "inv-live",
    name: "Lanterna",
    description: "Ilumina o caminho",
    image: "lanterna.jpg",
    quantity: 1,
    equipped: false
  }];

  const result = await repository.updateCharacterInventory("campaign-1", "char-1", inventory);

  const write = writes.find(entry => entry.ref === "db/campaigns/campaign-1/characters/char-1");
  assert.equal(write.method, "update");
  assert.deepEqual(write.data.inventory, inventory);
  assert.equal(typeof write.data.inventoryUpdatedAt, "string");
  assert.deepEqual(result.inventory, inventory);
});

test("persists the applied origin kit marker with an inventory update", async () => {
  const { context, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" }
  });
  const repository = createCampaignRepository(context);

  const result = await repository.updateCharacterInventory(
    "campaign-1",
    "char-1",
    [{ id: "inv-1", itemId: "lanterna", name: "Lanterna", quantity: 1 }],
    { appliedOriginLoadouts: ["Padre", "Padre", ""] }
  );

  const write = writes.find(entry => entry.ref === "db/campaigns/campaign-1/characters/char-1");
  assert.deepEqual(write.data.appliedOriginLoadouts, ["Padre"]);
  assert.deepEqual(result.appliedOriginLoadouts, ["Padre"]);
});

test("updates evidence ownership for all affected characters in one transaction", async () => {
  const prefix = "db/campaigns/campaign-1";
  const sourceEvidence = [];
  const targetEvidence = [{
    id: "owned-1",
    evidenceId: "evidence-1",
    title: "Carta",
    description: "Carta rasgada",
    image: "carta.jpg"
  }];
  const { context, documents, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    documents: {
      [prefix]: { id: "campaign-1", masterId: "master-1" },
      [`${prefix}/characters/char-1`]: { evidence: [{ id: "old-owner" }] },
      [`${prefix}/characters/char-2`]: { evidence: [] }
    }
  });
  const repository = createCampaignRepository(context);

  const result = await repository.updateCharacterEvidenceAssignments("campaign-1", [
    { characterId: "char-1", evidence: sourceEvidence },
    { characterId: "char-2", evidence: targetEvidence }
  ]);

  assert.deepEqual(documents.get(`${prefix}/characters/char-1`).evidence, sourceEvidence);
  assert.deepEqual(documents.get(`${prefix}/characters/char-2`).evidence, targetEvidence);
  assert.equal(typeof documents.get(`${prefix}/characters/char-2`).evidenceUpdatedAt, "string");
  assert.equal(result.characters.length, 2);
  assert.equal(writes.filter(write => write.method === "transaction-update").length, 3);
});

test("expression selection writes immediately and can reapply the same portrait", async () => {
  const { context, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" }
  });
  const repository = createCampaignRepository(context);
  const expressions = [{
    id: "expression-tense",
    title: "Tenso",
    image: "tenso.jpg",
    createdAt: "2026-07-31T10:00:00.000Z"
  }];

  await repository.updateCharacterExpressions(
    "campaign-1",
    "char-1",
    expressions,
    "expression-tense"
  );
  await repository.updateCharacterExpressions(
    "campaign-1",
    "char-1",
    expressions,
    "expression-tense"
  );

  const expressionWrites = writes.filter(entry => (
    entry.method === "update"
    && entry.ref === "db/campaigns/campaign-1/characters/char-1"
  ));
  assert.equal(expressionWrites.length, 2);
  assert.deepEqual(expressionWrites[0].data.expressions, expressions);
  assert.equal(expressionWrites[0].data.activeExpression, "expression-tense");
  assert.equal(typeof expressionWrites[0].data.expressionUpdatedAt, "string");
  assert.equal(typeof expressionWrites[1].data.expressionUpdatedAt, "string");
});

test("stores the reusable trauma catalog on the campaign without applying it", async () => {
  const prefix = "db/campaigns/campaign-1";
  const { context, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    documents: {
      [prefix]: { id: "campaign-1", masterId: "master-1", traumaCatalog: [] }
    }
  });
  const repository = createCampaignRepository(context);
  const traumaCatalog = [{
    id: "catalog-trauma-1",
    title: "Aracnofobia",
    image: "aranha.jpg",
    createdAt: "2026-07-31T12:00:00.000Z"
  }];

  const result = await repository.updateTraumaCatalog("campaign-1", traumaCatalog);
  const catalogWrite = writes.find(write => write.method === "update" && write.ref === prefix);

  assert.deepEqual(catalogWrite.data.traumaCatalog, traumaCatalog);
  assert.deepEqual(result.traumaCatalog, traumaCatalog);
  assert.equal(typeof catalogWrite.data.updatedAt, "string");
  assert.equal("latestTraumaEvent" in catalogWrite.data, false);
});

test("applies a trauma and its anonymous public event in one transaction", async () => {
  const prefix = "db/campaigns/campaign-1";
  const { context, documents, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    documents: {
      [`${prefix}`]: { id: "campaign-1", masterId: "master-1" },
      [`${prefix}/characters/char-1`]: { id: "char-1", traumas: [] }
    }
  });
  const repository = createCampaignRepository(context);
  const traumas = [{
    id: "trauma-1",
    title: "Aracnofobia",
    description: "Medo intenso de aranhas.",
    image: "aranha.jpg",
    acquiredAt: "2026-07-30T21:45:00.000Z"
  }];
  const event = {
    id: "event-1",
    origin: "Medica",
    traumaTitle: "Aracnofobia",
    createdAt: "2026-07-30T21:45:00.000Z"
  };

  const result = await repository.updateCharacterTraumas("campaign-1", "char-1", traumas, event);

  assert.deepEqual(documents.get(`${prefix}/characters/char-1`).traumas, traumas);
  assert.deepEqual(documents.get(prefix).latestTraumaEvent, event);
  assert.equal("characterName" in documents.get(prefix).latestTraumaEvent, false);
  assert.equal("playerName" in documents.get(prefix).latestTraumaEvent, false);
  assert.deepEqual(result.latestTraumaEvent, event);
  assert.equal(writes.filter(write => write.method === "transaction-update").length, 2);
});

test("removes a trauma without publishing another acquisition event", async () => {
  const prefix = "db/campaigns/campaign-1";
  const previousEvent = {
    id: "event-1",
    origin: "Medica",
    traumaTitle: "Aracnofobia",
    createdAt: "2026-07-30T21:45:00.000Z"
  };
  const { context, documents } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    documents: {
      [`${prefix}`]: { id: "campaign-1", latestTraumaEvent: previousEvent },
      [`${prefix}/characters/char-1`]: { id: "char-1", traumas: [{ id: "trauma-1" }] }
    }
  });
  const repository = createCampaignRepository(context);

  const result = await repository.updateCharacterTraumas("campaign-1", "char-1", []);

  assert.deepEqual(documents.get(`${prefix}/characters/char-1`).traumas, []);
  assert.deepEqual(documents.get(prefix).latestTraumaEvent, previousEvent);
  assert.equal(result.latestTraumaEvent, null);
});

test("deletes a trauma from the catalog and all character links atomically", async () => {
  const prefix = "db/campaigns/campaign-1";
  const remainingCatalog = [{ id: "catalog-2", title: "Claustrofobia", image: "cela.jpg" }];
  const { context, documents, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    documents: {
      [prefix]: { traumaCatalog: [{ id: "catalog-1" }, ...remainingCatalog] },
      [`${prefix}/characters/char-1`]: { traumas: [{ id: "owned-1", catalogId: "catalog-1" }] },
      [`${prefix}/characters/char-2`]: { traumas: [] }
    }
  });
  const repository = createCampaignRepository(context);

  await repository.updateTraumaCatalogAndCharacters("campaign-1", remainingCatalog, [
    { characterId: "char-1", traumas: [] }
  ]);

  assert.deepEqual(documents.get(prefix).traumaCatalog, remainingCatalog);
  assert.deepEqual(documents.get(`${prefix}/characters/char-1`).traumas, []);
  assert.equal(typeof documents.get(`${prefix}/characters/char-1`).traumasUpdatedAt, "string");
  assert.equal(writes.filter(write => write.method === "transaction-update").length, 2);
});

test("join rejects an account without a character prepared by the master", async () => {
  const baseCampaign = {
    id: "campaign-1",
    password: "secret",
    readyPlayerEmails: ["another@example.com"]
  };
  const { context, writes } = createFakeContext({ baseCampaign });
  const repository = createCampaignRepository(context);

  await assert.rejects(
    repository.joinCampaign("campaign-1", "secret", { email: "ana@example.com" }, "Ana"),
    error => error.code === "campaign/player-not-ready"
  );
  assert.equal(writes.length, 0);
});

test("does not expose legacy master-only scenes or evidence when a player loads a campaign", async () => {
  const baseCampaign = {
    id: "campaign-1",
    masterId: "master-1",
    members: ["master-1", "auth-1"],
    scenes: [{ id: "scene-secret", masterNotes: "Segredo" }],
    evidence: [{ id: "evidence-secret", title: "Segredo do mestre" }]
  };
  const { context } = createFakeContext({ baseCampaign });
  const repository = createCampaignRepository(context);

  const campaign = await repository.getCampaign("campaign-1");

  assert.deepEqual(campaign.scenes, []);
  assert.deepEqual(campaign.evidence, []);
});

test("persists a character link atomically and keeps it after presence changes", async () => {
  const prefix = "db/campaigns/campaign-1";
  const { context, documents, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    documents: {
      [`${prefix}`]: { readyPlayerEmails: ["ana@example.com"] },
      [`${prefix}/players/player-1`]: {
        id: "player-1",
        emailNormalized: "ana@example.com",
        characterId: "char-old",
        online: false
      },
      [`${prefix}/characters/char-old`]: { id: "char-old", controllerPlayerId: "player-1" },
      [`${prefix}/characters/char-new`]: { id: "char-new", controllerPlayerId: null }
    }
  });
  const repository = createCampaignRepository(context);

  const result = await repository.assignPlayerCharacter("campaign-1", "player-1", "char-new");

  assert.equal(result.player.characterId, "char-new");
  assert.equal(documents.get(`${prefix}/players/player-1`).characterId, "char-new");
  assert.equal(documents.get(`${prefix}/characters/char-old`).controllerPlayerId, null);
  assert.equal(documents.get(`${prefix}/characters/char-new`).controllerPlayerId, "player-1");
  assert.equal(documents.get(`${prefix}/players/player-1`).online, false);
  assert.equal(writes.filter(write => write.method === "transaction-update").length, 4);
});

test("unlinks only when explicitly requested and rejects an occupied character", async () => {
  const prefix = "db/campaigns/campaign-1";
  const { context, documents, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    documents: {
      [`${prefix}`]: { readyPlayerEmails: ["ana@example.com"] },
      [`${prefix}/players/player-1`]: {
        id: "player-1",
        emailNormalized: "ana@example.com",
        characterId: "char-1"
      },
      [`${prefix}/characters/char-1`]: { id: "char-1", controllerPlayerId: "player-1" },
      [`${prefix}/characters/char-2`]: { id: "char-2", controllerPlayerId: "player-2" }
    }
  });
  const repository = createCampaignRepository(context);

  await assert.rejects(
    repository.assignPlayerCharacter("campaign-1", "player-1", "char-2"),
    /ja esta vinculado/
  );
  assert.equal(writes.length, 0);
  assert.equal(documents.get(`${prefix}/players/player-1`).characterId, "char-1");

  await repository.assignPlayerCharacter("campaign-1", "player-1", null);
  assert.equal(documents.get(`${prefix}/players/player-1`).characterId, null);
  assert.equal(documents.get(`${prefix}/characters/char-1`).controllerPlayerId, null);
  assert.deepEqual(documents.get(`${prefix}`).readyPlayerEmails, []);
});

test("approves an item transfer by moving both inventories in one transaction", async () => {
  const prefix = "db/campaigns/campaign-1";
  const { context, documents, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    documents: {
      [`${prefix}/itemTransfers/transfer-1`]: {
        id: "transfer-1",
        type: "item",
        status: "pending",
        fromCharacterId: "char-1",
        toCharacterId: "char-2",
        inventoryId: "inv-1",
        quantity: 2
      },
      [`${prefix}/characters/char-1`]: {
        inventory: [{ id: "inv-1", itemId: "item-1", name: "Flecha de prata", description: "Contra criaturas", image: "flecha.jpg", notes: "", quantity: 3 }]
      },
      [`${prefix}/characters/char-2`]: {
        inventory: [{ id: "inv-old", itemId: "item-1", name: "Flecha antiga", description: "Antiga", image: "antiga.jpg", notes: "", quantity: 1 }]
      }
    }
  });
  const repository = createCampaignRepository(context);

  const result = await repository.resolveItemTransfer("campaign-1", "transfer-1", "approved");

  assert.equal(documents.get(`${prefix}/characters/char-1`).inventory[0].quantity, 1);
  assert.equal(documents.get(`${prefix}/characters/char-2`).inventory[0].quantity, 3);
  assert.equal(documents.get(`${prefix}/characters/char-2`).inventory[0].name, "Flecha de prata");
  assert.equal(documents.get(`${prefix}/characters/char-2`).inventory[0].description, "Contra criaturas");
  assert.equal(documents.get(`${prefix}/characters/char-2`).inventory[0].image, "flecha.jpg");
  assert.equal(documents.get(`${prefix}/itemTransfers/transfer-1`).status, "approved");
  assert.equal(result.transfer.resolvedBy, "master-1");
  assert.equal(writes.filter(write => write.method === "transaction-update").length, 3);

  const repeated = await repository.resolveItemTransfer("campaign-1", "transfer-1", "rejected");
  assert.equal(repeated.alreadyResolved, true);
  assert.equal(repeated.transfer.status, "approved");
  assert.equal(writes.filter(write => write.method === "transaction-update").length, 3);
});

test("rejects an item transfer without changing either inventory", async () => {
  const prefix = "db/campaigns/campaign-1";
  const sourceInventory = [{ id: "inv-1", itemId: "item-1", name: "Flecha", quantity: 3 }];
  const { context, documents } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    documents: {
      [`${prefix}/itemTransfers/transfer-1`]: {
        id: "transfer-1",
        type: "item",
        status: "pending",
        fromCharacterId: "char-1",
        toCharacterId: "char-2",
        inventoryId: "inv-1",
        quantity: 2
      },
      [`${prefix}/characters/char-1`]: { inventory: sourceInventory },
      [`${prefix}/characters/char-2`]: { inventory: [] }
    }
  });
  const repository = createCampaignRepository(context);

  await repository.resolveItemTransfer("campaign-1", "transfer-1", "rejected");

  assert.deepEqual(documents.get(`${prefix}/characters/char-1`).inventory, sourceInventory);
  assert.deepEqual(documents.get(`${prefix}/characters/char-2`).inventory, []);
  assert.equal(documents.get(`${prefix}/itemTransfers/transfer-1`).status, "rejected");
});

test("approves an evidence transfer by moving exclusive ownership", async () => {
  const prefix = "db/campaigns/campaign-1";
  const ownedEvidence = {
    id: "owned-1",
    evidenceId: "evidence-1",
    title: "Fotografia",
    description: "Uma figura ao fundo",
    image: "foto.jpg"
  };
  const { context, documents, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    documents: {
      [`${prefix}/itemTransfers/transfer-evidence`]: {
        id: "transfer-evidence",
        type: "evidence",
        status: "pending",
        fromCharacterId: "char-1",
        toCharacterId: "char-2",
        evidenceEntryId: "owned-1",
        evidenceId: "evidence-1"
      },
      [`${prefix}/characters/char-1`]: { evidence: [ownedEvidence] },
      [`${prefix}/characters/char-2`]: { evidence: [] }
    }
  });
  const repository = createCampaignRepository(context);

  const result = await repository.resolveItemTransfer("campaign-1", "transfer-evidence", "approved");

  assert.deepEqual(documents.get(`${prefix}/characters/char-1`).evidence, []);
  assert.equal(documents.get(`${prefix}/characters/char-2`).evidence.length, 1);
  assert.equal(documents.get(`${prefix}/characters/char-2`).evidence[0].evidenceId, "evidence-1");
  assert.notEqual(documents.get(`${prefix}/characters/char-2`).evidence[0].id, "owned-1");
  assert.equal(documents.get(`${prefix}/itemTransfers/transfer-evidence`).status, "approved");
  assert.deepEqual(result.sourceCharacter.evidence, []);
  assert.equal(writes.filter(write => write.method === "transaction-update").length, 3);
});

test("rejects an evidence transfer without changing ownership", async () => {
  const prefix = "db/campaigns/campaign-1";
  const ownedEvidence = [{ id: "owned-1", evidenceId: "evidence-1", title: "Fotografia" }];
  const { context, documents } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    documents: {
      [`${prefix}/itemTransfers/transfer-evidence`]: {
        id: "transfer-evidence",
        type: "evidence",
        status: "pending",
        fromCharacterId: "char-1",
        toCharacterId: "char-2",
        evidenceEntryId: "owned-1",
        evidenceId: "evidence-1"
      },
      [`${prefix}/characters/char-1`]: { evidence: ownedEvidence },
      [`${prefix}/characters/char-2`]: { evidence: [] }
    }
  });
  const repository = createCampaignRepository(context);

  await repository.resolveItemTransfer("campaign-1", "transfer-evidence", "rejected");

  assert.deepEqual(documents.get(`${prefix}/characters/char-1`).evidence, ownedEvidence);
  assert.deepEqual(documents.get(`${prefix}/characters/char-2`).evidence, []);
  assert.equal(documents.get(`${prefix}/itemTransfers/transfer-evidence`).status, "rejected");
});

test("deletes a catalog evidence and removes its character snapshot in one transaction", async () => {
  const prefix = "db/campaigns/campaign-1";
  const { context, documents, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    documents: {
      [prefix]: { id: "campaign-1" },
      [`${prefix}/evidence/evidence-1`]: { id: "evidence-1", title: "Fotografia" },
      [`${prefix}/characters/char-1`]: { evidence: [{ id: "owned-1", evidenceId: "evidence-1" }] }
    }
  });
  const repository = createCampaignRepository(context);

  await repository.deleteEvidenceCatalogEntry("campaign-1", "evidence-1", [
    { characterId: "char-1", evidence: [] }
  ]);

  assert.equal(documents.has(`${prefix}/evidence/evidence-1`), false);
  assert.deepEqual(documents.get(`${prefix}/characters/char-1`).evidence, []);
  assert.equal(writes.filter(write => write.method === "transaction-delete").length, 1);
  assert.equal(writes.filter(write => write.method === "transaction-update").length, 2);
});
