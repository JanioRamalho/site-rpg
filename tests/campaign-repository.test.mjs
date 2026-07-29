import test from "node:test";
import assert from "node:assert/strict";
import { createCampaignRepository } from "../js/firebase/campaign-repository.js";

function createFakeContext({ baseCampaign = null, user = { uid: "auth-1", email: "ana@example.com" } } = {}) {
  const writes = [];
  const api = {
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
    async setDoc(ref, data, options) { writes.push({ method: "set", ref, data, options }); },
    async updateDoc(ref, data) { writes.push({ method: "update", ref, data }); }
  };
  return {
    context: { api, auth: { currentUser: user }, db: "db", projectId: "demo" },
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
