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
        update(ref, data) { pending.push({ ref, data }); }
      });
      pending.forEach(({ ref, data }) => {
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
      { id: "char-1", controllerPlayerId: "player-1", health: 10, sanity: 8, skills: [], inventory: [{ id: "inv-1", name: "Pocao" }] }
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

test("does not expose legacy master-only scenes when a player loads a campaign", async () => {
  const baseCampaign = {
    id: "campaign-1",
    masterId: "master-1",
    members: ["master-1", "auth-1"],
    scenes: [{ id: "scene-secret", masterNotes: "Segredo" }]
  };
  const { context } = createFakeContext({ baseCampaign });
  const repository = createCampaignRepository(context);

  const campaign = await repository.getCampaign("campaign-1");

  assert.deepEqual(campaign.scenes, []);
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
