import test from "node:test";
import assert from "node:assert/strict";
import { createCampaignRepository } from "../js/firebase/campaign-repository.js";

function createFakeContext({
  baseCampaign = null,
  documents = {},
  user = { uid: "auth-1", email: "ana@example.com" },
  withBatch = false,
  listDocuments = false
} = {}) {
  const writes = [];
  const storedDocuments = new Map(Object.entries(documents).map(([key, value]) => [key, structuredClone(value)]));
  const snapshot = ref => {
    const data = storedDocuments.get(ref);
    return {
      exists: () => Boolean(data),
      id: String(ref).split("/").pop(),
      ref,
      data: () => structuredClone(data)
    };
  };
  const applyUpdate = (ref, data) => {
    const current = storedDocuments.get(ref) || {};
    const next = { ...current };
    Object.entries(data).forEach(([key, value]) => {
      if (value === "__DELETE_FIELD__") delete next[key];
      else next[key] = structuredClone(value);
    });
    storedDocuments.set(ref, next);
  };
  const api = {
    arrayRemove(value) { return { __op: "arrayRemove", value }; },
    arrayUnion(value) { return [value]; },
    collection(...segments) { return segments.join("/"); },
    deleteField() { return "__DELETE_FIELD__"; },
    doc(...segments) { return segments.join("/"); },
    async deleteDoc(ref) { writes.push({ method: "delete", ref }); },
    async enableNetwork() {},
    async getDoc(ref) {
      if (storedDocuments.has(ref)) return snapshot(ref);
      return {
        exists: () => Boolean(baseCampaign),
        id: baseCampaign?.id,
        data: () => ({ ...baseCampaign })
      };
    },
    async getDocs(ref) {
      if (!listDocuments) return { docs: [] };
      const prefix = `${ref}/`;
      const docs = [...storedDocuments.keys()]
        .filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
        .map(snapshot);
      return { docs };
    },
    async runTransaction(_db, operation) {
      const pending = [];
      const result = await operation({
        async get(ref) { return snapshot(ref); },
        set(ref, data, options) { pending.push({ method: "set", ref, data, options }); },
        update(ref, data) { pending.push({ method: "update", ref, data }); },
        delete(ref) { pending.push({ method: "delete", ref }); }
      });
      pending.forEach(({ method, ref, data, options }) => {
        if (method === "delete") {
          storedDocuments.delete(ref);
          writes.push({ method: "transaction-delete", ref });
          return;
        }
        if (method === "set") {
          storedDocuments.set(ref, structuredClone(data));
          writes.push({ method: "transaction-set", ref, data, options });
          return;
        }
        const current = storedDocuments.get(ref) || {};
        const next = { ...current };
        Object.entries(data).forEach(([key, value]) => {
          if (value === "__DELETE_FIELD__") {
            delete next[key];
          } else if (value?.__op === "arrayRemove") {
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
  if (withBatch) {
    api.writeBatch = () => {
      const pending = [];
      return {
        set(ref, data, options) { pending.push({ method: "set", ref, data, options }); },
        update(ref, data) { pending.push({ method: "update", ref, data }); },
        delete(ref) { pending.push({ method: "delete", ref }); },
        async commit() {
          pending.forEach(operation => {
            if (operation.method === "delete") {
              storedDocuments.delete(operation.ref);
            } else if (operation.method === "set") {
              if (operation.options?.merge) applyUpdate(operation.ref, operation.data);
              else storedDocuments.set(operation.ref, structuredClone(operation.data));
            } else {
              applyUpdate(operation.ref, operation.data);
            }
            writes.push({ ...operation, method: `batch-${operation.method}` });
          });
          writes.push({ method: "batch-commit", operations: pending.length });
        }
      };
    };
  }
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

test("adjusts one character vital transactionally without touching campaign, login or player data", async () => {
  const characterPath = "db/campaigns/campaign-1/characters/char-1";
  const playerPath = "db/campaigns/campaign-1/players/player-1";
  const { context, documents, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    documents: {
      [characterPath]: {
        id: "char-1",
        controllerPlayerId: "player-1",
        name: "Morgana",
        health: 10,
        healthMax: 12,
        sanity: 8,
        sanityMax: 10,
        inventory: [{ id: "inv-1", name: "Pocao" }]
      },
      [playerPath]: { id: "player-1", authUid: "auth-1", characterId: "char-1" }
    }
  });
  const repository = createCampaignRepository(context);

  const health = await repository.adjustCharacterVital("campaign-1", "char-1", "health", -1);
  const sanity = await repository.adjustCharacterVital("campaign-1", "char-1", "sanity", 1);

  assert.deepEqual(health, {
    campaignId: "campaign-1",
    characterId: "char-1",
    key: "health",
    value: 9,
    max: 12
  });
  assert.equal(sanity.value, 9);
  assert.deepEqual(writes.map(write => ({ method: write.method, ref: write.ref, data: write.data })), [
    { method: "transaction-update", ref: characterPath, data: { health: 9 } },
    { method: "transaction-update", ref: characterPath, data: { sanity: 9 } }
  ]);
  assert.equal(documents.get(characterPath).name, "Morgana");
  assert.deepEqual(documents.get(characterPath).inventory, [{ id: "inv-1", name: "Pocao" }]);
  assert.deepEqual(documents.get(playerPath), { id: "player-1", authUid: "auth-1", characterId: "char-1" });
  assert.equal(writes.some(write => write.ref === "db/campaigns/campaign-1"), false);
});

test("master persistence writes only fields changed from its captured baseline", async () => {
  const { context, writes } = createFakeContext();
  const repository = createCampaignRepository(context);
  const baseline = campaignFixture();
  const newerRemote = structuredClone(baseline);
  newerRemote.characters[0].health = 4;
  await repository.saveCampaign(newerRemote, { role: "master" });
  writes.length = 0;

  const local = structuredClone(baseline);
  local.name = "Nome editado pelo mestre";
  await repository.saveCampaign(local, {
    role: "master",
    baseCampaign: baseline,
    mutationId: "mutation-1",
    mutationRevision: 3
  });

  assert.equal(writes.some(write => write.ref.endsWith("/characters/char-1")), false);
  const campaignWrites = writes.filter(write => write.ref === "db/campaigns/campaign-1");
  assert.equal(campaignWrites[0].data.name, "Nome editado pelo mestre");
  assert.equal(campaignWrites.at(-1).data.lastClientMutation.id, "mutation-1");
  assert.equal(campaignWrites.at(-1).data.lastClientMutation.revision, 3);
});

test("baseline saves allow untouched legacy images but reject a changed external image before writing", async () => {
  const { context, writes } = createFakeContext();
  const repository = createCampaignRepository(context);
  const baseline = campaignFixture();
  baseline.characters[0].image = "/legacy/portrait.png";

  const safeEdit = structuredClone(baseline);
  safeEdit.name = "Edicao sem tocar no retrato";
  safeEdit.characters[0].health = 9;
  await repository.saveCampaign(safeEdit, { role: "master", baseCampaign: baseline });

  const characterWrite = writes.find(write => write.ref.endsWith("/characters/char-1"));
  assert.equal(characterWrite.data.health, 9);
  assert.equal("image" in characterWrite.data, false);

  writes.length = 0;
  const unsafeEdit = structuredClone(baseline);
  unsafeEdit.name = "Este campo nao deve ser gravado parcialmente";
  unsafeEdit.characters[0].image = "https://images.example.com/new-portrait.png";
  await assert.rejects(
    repository.saveCampaign(unsafeEdit, { role: "master", baseCampaign: baseline }),
    error => error.code === "campaign/unmanaged-image-not-allowed"
  );
  assert.equal(writes.length, 0);
});

test("creates an empty campaign with its durable acknowledgement in the first write", async () => {
  const { context, writes } = createFakeContext({ user: { uid: "master-1", email: "master@example.com" } });
  const repository = createCampaignRepository(context);
  const campaign = {
    id: "new-campaign",
    masterId: "master-1",
    members: ["master-1"],
    name: "Nova mesa",
    players: [], characters: [], cases: [], creatures: [], items: [], marks: [],
    diceLogs: [], messages: [], itemTransfers: [], scenes: [], evidence: []
  };

  await repository.saveCampaign(campaign, {
    role: "master",
    isCreation: true,
    mutationId: "new-campaign:mutation-1",
    mutationRevision: 1
  });

  const campaignWrites = writes.filter(write => write.ref === "db/campaigns/new-campaign");
  assert.equal(campaignWrites.length, 1);
  assert.equal(campaignWrites[0].method, "set");
  assert.equal(campaignWrites[0].data.lastClientMutation.id, "new-campaign:mutation-1");
  assert.equal(campaignWrites[0].data.lastClientMutation.authUid, "master-1");
});

test("stores 40 scenes with ordering and live state in one atomic batch", async () => {
  const { context, documents, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    withBatch: true
  });
  const repository = createCampaignRepository(context);
  const scenes = Array.from({ length: 40 }, (_, index) => ({
    id: `scene-${index + 1}`,
    title: `Cena ${index + 1}`,
    caption: `Legenda ${index + 1}`,
    masterNotes: `Nota ${index + 1}`,
    image: `https://res.cloudinary.com/demo/image/upload/scene-${index + 1}.jpg`,
    futureField: "deve ser preservado"
  }));

  const result = await repository.updateCampaignScenes("campaign-1", scenes, {
    liveScene: {
      active: true,
      sceneId: "scene-25",
      image: scenes[0].image,
      index: 0,
      total: 1,
      unexpected: "remover"
    }
  });

  const commits = writes.filter(write => write.method === "batch-commit");
  const sceneWrites = writes.filter(write => write.method === "batch-set" && write.ref.includes("/scenes/"));
  const baseWrite = writes.find(write => write.method === "batch-update" && write.ref === "db/campaigns/campaign-1");
  assert.equal(commits.length, 1);
  assert.equal(commits[0].operations, 41);
  assert.equal(sceneWrites.length, 40);
  assert.deepEqual(sceneWrites.map(write => write.data._order), Array.from({ length: 40 }, (_, index) => index));
  assert.equal(sceneWrites.every(write => write.data.futureField === "deve ser preservado"), true);
  assert.equal(writes.some(write => /\/(characters|players|evidence|items|messages)\//.test(write.ref || "")), false);
  assert.equal(baseWrite.data.liveScene.sceneId, "scene-25");
  assert.equal(baseWrite.data.liveScene.image, scenes[24].image);
  assert.equal(baseWrite.data.liveScene.index, 24);
  assert.equal(baseWrite.data.liveScene.total, 40);
  assert.equal("unexpected" in baseWrite.data.liveScene, false);
  assert.equal(result.scenes.length, 40);
  assert.equal("_order" in result.scenes[0], false);
  assert.equal(documents.get("db/campaigns/campaign-1/scenes/scene-40")._order, 39);
});

test("rejects a 41st active scene before writing campaign data", async () => {
  const { context, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    withBatch: true
  });
  const repository = createCampaignRepository(context);
  const scenes = Array.from({ length: 41 }, (_, index) => ({
    id: `scene-${index + 1}`,
    image: `https://res.cloudinary.com/demo/image/upload/scene-${index + 1}.jpg`
  }));

  await assert.rejects(
    repository.updateCampaignScenes("campaign-1", scenes),
    error => error?.code === "campaign/scene-limit-reached"
  );
  assert.equal(writes.length, 0);
});

test("moves a scene to private trash and restores it without changing players or characters", async () => {
  const player = { id: "player-1", email: "ana@example.com", characterId: "char-1", progress: 7 };
  const character = { id: "char-1", health: 6, healthMax: 10, sanity: 4, sanityMax: 8 };
  const scene = {
    id: "scene-safe",
    _order: 0,
    title: "Arquivo secreto",
    caption: "Legenda preservada",
    masterNotes: "Notas privadas preservadas",
    image: "https://res.cloudinary.com/demo/image/upload/v7/site-rpg/scene-safe.png",
    imagePublicId: "site-rpg/scene-safe",
    futureField: { preserved: true }
  };
  const { context, documents, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    listDocuments: true,
    documents: {
      "db/campaigns/campaign-1": {
        id: "campaign-1",
        masterId: "master-1",
        liveScene: { active: true, sceneId: "scene-safe", image: scene.image, index: 0, total: 1 }
      },
      "db/campaigns/campaign-1/scenes/scene-safe": scene,
      "db/campaigns/campaign-1/players/player-1": player,
      "db/campaigns/campaign-1/characters/char-1": character
    }
  });
  const repository = createCampaignRepository(context);

  const trashed = await repository.trashCampaignScene("campaign-1", "scene-safe");
  assert.equal(documents.has("db/campaigns/campaign-1/scenes/scene-safe"), false);
  assert.equal(documents.get("db/campaigns/campaign-1/sceneTrash/scene-safe").masterNotes, scene.masterNotes);
  assert.equal(documents.get("db/campaigns/campaign-1/sceneTrash/scene-safe").imagePublicId, scene.imagePublicId);
  assert.equal(documents.get("db/campaigns/campaign-1").liveScene.active, false);
  assert.equal(trashed.wasLive, true);

  const restored = await repository.restoreCampaignScene("campaign-1", "scene-safe");
  const restoredDocument = documents.get("db/campaigns/campaign-1/scenes/scene-safe");
  assert.equal(documents.has("db/campaigns/campaign-1/sceneTrash/scene-safe"), false);
  assert.equal(restoredDocument.title, scene.title);
  assert.equal(restoredDocument.caption, scene.caption);
  assert.equal(restoredDocument.masterNotes, scene.masterNotes);
  assert.equal(restoredDocument.image, scene.image);
  assert.equal(restoredDocument.imagePublicId, scene.imagePublicId);
  assert.deepEqual(restoredDocument.futureField, scene.futureField);
  assert.equal(restored.scene.id, "scene-safe");
  assert.deepEqual(documents.get("db/campaigns/campaign-1/players/player-1"), player);
  assert.deepEqual(documents.get("db/campaigns/campaign-1/characters/char-1"), character);
  assert.equal(writes.some(write => /\/(players|characters)\//.test(write.ref || "")), false);
});

test("a stale general campaign save cannot delete or overwrite private scene trash", async () => {
  const trashDocument = {
    id: "scene-protected",
    title: "Cena recuperavel",
    image: "legacy-scene.jpg",
    masterNotes: "Nao perder",
    deletedAt: "2026-08-05T12:00:00.000Z",
    _order: -1
  };
  const { context, documents, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    listDocuments: true,
    documents: {
      "db/campaigns/campaign-1/sceneTrash/scene-protected": trashDocument
    }
  });
  const repository = createCampaignRepository(context);
  const baseline = campaignFixture();
  const staleCampaign = structuredClone(baseline);
  staleCampaign.name = "Alteracao segura";
  staleCampaign.sceneTrash = [];

  await repository.saveCampaign(staleCampaign, {
    role: "master",
    baseCampaign: baseline
  });

  assert.deepEqual(documents.get("db/campaigns/campaign-1/sceneTrash/scene-protected"), trashDocument);
  assert.equal(writes.some(write => String(write.ref || "").includes("/sceneTrash/")), false);
});

test("deletes and reorders scenes atomically without touching other subcollections", async () => {
  const { context, documents, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    withBatch: true
  });
  const repository = createCampaignRepository(context);
  const scenes = Array.from({ length: 40 }, (_, index) => ({
    id: `scene-${index + 1}`,
    title: `Cena ${index + 1}`,
    image: `https://res.cloudinary.com/demo/image/upload/scene-${index + 1}.jpg`
  }));
  await repository.updateCampaignScenes("campaign-1", scenes);
  writes.length = 0;

  await repository.updateCampaignScenes("campaign-1", scenes.slice(1).reverse());

  assert.equal(writes.filter(write => write.method === "batch-commit").length, 1);
  assert.equal(writes.filter(write => write.method === "batch-delete").length, 1);
  assert.equal(writes.find(write => write.method === "batch-delete").ref, "db/campaigns/campaign-1/scenes/scene-1");
  assert.equal(writes.filter(write => write.method === "batch-update" && write.ref.includes("/scenes/")).length, 39);
  assert.equal(documents.has("db/campaigns/campaign-1/scenes/scene-1"), false);
  assert.equal(documents.get("db/campaigns/campaign-1/scenes/scene-40")._order, 0);
  assert.equal(writes.some(write => /\/(characters|players|evidence|items|messages)\//.test(write.ref || "")), false);
  const baseWrite = writes.find(write => write.method === "batch-update" && write.ref === "db/campaigns/campaign-1");
  assert.deepEqual(Object.keys(baseWrite.data), ["updatedAt"]);
});

test("updates only the campaign live scene with sanitized public fields", async () => {
  const { context, writes } = createFakeContext({ user: { uid: "master-1", email: "master@example.com" } });
  const repository = createCampaignRepository(context);

  const liveScene = await repository.updateLiveScene("campaign-1", {
    active: true,
    sceneId: "scene-7",
    image: "https://res.cloudinary.com/demo/image/upload/scene-7.jpg",
    index: 6,
    total: 50,
    masterNotes: "nao publicar",
    arbitrary: { secret: true }
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "update");
  assert.equal(writes[0].ref, "db/campaigns/campaign-1");
  assert.deepEqual(Object.keys(writes[0].data).sort(), ["liveScene", "updatedAt"]);
  assert.deepEqual(Object.keys(writes[0].data.liveScene).sort(), ["active", "image", "index", "sceneId", "total", "updatedAt"]);
  assert.equal(liveScene.sceneId, "scene-7");
  assert.equal("masterNotes" in liveScene, false);
  assert.equal(writes.some(write => write.ref.includes("/scenes/")), false);
});

test("rejects every non-Cloudinary scene and active live image before any Firestore write", async () => {
  const { context, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    withBatch: true
  });
  const repository = createCampaignRepository(context);

  await assert.rejects(
    repository.updateCampaignScenes("campaign-1", [{
      id: "scene-base64",
      title: "Cena local",
      image: "  DATA:image/png;base64,AAAA"
    }]),
    error => error.code === "campaign/base64-image-not-allowed"
  );
  await assert.rejects(
    repository.updateLiveScene("campaign-1", {
      active: true,
      sceneId: "scene-base64",
      image: "data:image/jpeg;base64,BBBB",
      index: 0,
      total: 1
    }),
    error => error.code === "campaign/base64-image-not-allowed"
  );
  await assert.rejects(
    repository.updateCampaignScenes("campaign-1", [{
      id: "scene-external",
      title: "Cena externa",
      image: "https://images.example.com/scene.jpg"
    }]),
    error => error.code === "campaign/cloudinary-image-required"
  );
  await assert.rejects(
    repository.updateLiveScene("campaign-1", {
      active: true,
      sceneId: "scene-relative",
      image: "/uploads/scene-relative.jpg",
      index: 0,
      total: 1
    }),
    error => error.code === "campaign/cloudinary-image-required"
  );
  await assert.rejects(
    repository.updateLiveScene("campaign-1", {
      active: true,
      sceneId: "scene-empty",
      image: "",
      index: 0,
      total: 1
    }),
    error => error.code === "campaign/cloudinary-image-required"
  );
  await assert.rejects(
    repository.updateLiveScene("campaign-1", {
      active: false,
      sceneId: null,
      image: "https://images.example.com/hidden-scene.jpg",
      index: 0,
      total: 0
    }),
    error => error.code === "campaign/cloudinary-image-required"
  );
  assert.equal(writes.length, 0);
});

test("allows an empty live image only while scene transmission is inactive", async () => {
  const { context, writes } = createFakeContext({ user: { uid: "master-1", email: "master@example.com" } });
  const repository = createCampaignRepository(context);

  const liveScene = await repository.updateLiveScene("campaign-1", {
    active: false,
    sceneId: null,
    image: "",
    index: 0,
    total: 0
  });

  assert.equal(liveScene.active, false);
  assert.equal(liveScene.image, "");
  assert.equal(writes.length, 1);
});

test("commits a board and several visual documents in one atomic media batch", async () => {
  const prefix = "db/campaigns/campaign-1";
  const boardUrl = "https://res.cloudinary.com/demo/image/upload/v1/board.png";
  const previousBoardUrl = "https://res.cloudinary.com/demo/image/upload/v1/board-previous.png";
  const characterUrl = "https://res.cloudinary.com/demo/image/upload/v1/character.png";
  const caseUrl = "https://res.cloudinary.com/demo/image/upload/v1/case.png";
  const evidenceUrl = "https://res.cloudinary.com/demo/image/upload/v1/evidence.png";
  const { context, documents, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    baseCampaign: { id: "campaign-1", masterId: "master-1" },
    withBatch: true,
    documents: {
      [prefix]: {
        id: "campaign-1",
        masterId: "master-1",
        title: "Campo concorrente preservado",
        gameBoard: { image: "https://example.com/old-board.png", zoom: 1.2 }
      },
      [`${prefix}/characters/char-1`]: { id: "char-1", name: "Ana", health: 9, image: "https://example.com/old-character.png" },
      [`${prefix}/cases/case-1`]: { id: "case-1", title: "Arquivo", notes: "preservar" },
      [`${prefix}/evidence/evidence-1`]: { id: "evidence-1", title: "Fotografia", ownerId: "char-1" }
    }
  });
  const repository = createCampaignRepository(context);

  const result = await repository.commitCampaignMediaMutation("campaign-1", {
    basePatch: {
      gameBoard: {
        image: boardUrl,
        imageMeta: { publicId: "boards/main", width: 2400, height: 1600 },
        updatedAt: "2026-08-02T15:00:00.000Z"
      },
      previousGameBoard: {
        image: previousBoardUrl,
        imageMeta: { publicId: "boards/previous", width: 1920, height: 1080 },
        updatedAt: "2026-08-01T15:00:00.000Z"
      }
    },
    documents: [
      {
        collection: "characters",
        id: "char-1",
        data: { image: characterUrl, imageMeta: { publicId: "characters/char-1" } }
      },
      {
        collection: "cases",
        id: "case-1",
        patch: { image: caseUrl, imageMeta: { publicId: "cases/case-1" } }
      },
      {
        collection: "evidence",
        id: "evidence-1",
        data: { image: evidenceUrl, imageMeta: { publicId: "evidence/evidence-1" } }
      }
    ],
    cloudinaryUrls: [boardUrl, previousBoardUrl, characterUrl, caseUrl, evidenceUrl, boardUrl]
  });

  assert.equal(result.status, "committed");
  assert.equal(result.verified, true);
  assert.equal(result.campaignId, "campaign-1");
  assert.equal(result.documents, 3);
  assert.equal(result.operations, 4);
  assert.equal(result.cloudinaryUrls, 5);
  assert.equal(typeof result.updatedAt, "string");
  assert.equal(writes.filter(write => write.method === "batch-commit").length, 1);
  assert.equal(writes.find(write => write.method === "batch-commit").operations, 4);
  assert.equal(writes.filter(write => write.method === "batch-set").every(write => write.options?.merge === true), true);

  const base = documents.get(prefix);
  assert.equal(base.title, "Campo concorrente preservado");
  assert.equal(base.masterId, "master-1");
  assert.equal(base.gameBoard.image, boardUrl);
  assert.equal(base.gameBoard.imageMeta.publicId, "boards/main");
  assert.equal(base.previousGameBoard.image, previousBoardUrl);
  assert.equal(base.previousGameBoard.imageMeta.publicId, "boards/previous");
  assert.equal(base.updatedAt, result.updatedAt);
  const character = documents.get(`${prefix}/characters/char-1`);
  assert.equal(character.name, "Ana");
  assert.equal(character.health, 9);
  assert.equal(character.image, characterUrl);
  assert.equal(character.imageMeta.publicId, "characters/char-1");
  const caseDocument = documents.get(`${prefix}/cases/case-1`);
  assert.equal(caseDocument.title, "Arquivo");
  assert.equal(caseDocument.notes, "preservar");
  assert.equal(caseDocument.image, caseUrl);
  const evidence = documents.get(`${prefix}/evidence/evidence-1`);
  assert.equal(evidence.title, "Fotografia");
  assert.equal(evidence.ownerId, "char-1");
  assert.equal(evidence.image, evidenceUrl);
});

test("rejects invalid campaign media mutations before creating any write", async () => {
  const url = "https://res.cloudinary.com/demo/image/upload/v1/image.png";
  const { context, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    baseCampaign: { id: "campaign-1", masterId: "master-1" },
    withBatch: true
  });
  const repository = createCampaignRepository(context);

  await assert.rejects(
    repository.commitCampaignMediaMutation("campaign-1", {
      basePatch: { password: "nao alterar" },
      documents: [],
      cloudinaryUrls: [url]
    }),
    error => error.code === "campaign/media-base-field-not-allowed"
  );
  await assert.rejects(
    repository.commitCampaignMediaMutation("campaign-1", {
      basePatch: {},
      documents: [{ collection: "scenes", id: "scene-1", data: { image: url } }],
      cloudinaryUrls: [url]
    }),
    error => error.code === "campaign/media-collection-not-allowed"
  );
  await assert.rejects(
    repository.commitCampaignMediaMutation("campaign-1", {
      basePatch: {},
      documents: [{ collection: "characters", id: "bad/id", data: { image: url } }],
      cloudinaryUrls: [url]
    }),
    error => error.code === "campaign/media-document-id-invalid"
  );
  await assert.rejects(
    repository.commitCampaignMediaMutation("campaign-1", {
      basePatch: {},
      documents: [{
        collection: "characters",
        id: "char-1",
        data: { inventory: [{ id: "inv-1", details: { image: "data:image/png;base64,AAAA" } }] }
      }],
      cloudinaryUrls: [url]
    }),
    error => error.code === "campaign/media-base64-not-allowed"
  );
  await assert.rejects(
    repository.commitCampaignMediaMutation("campaign-1", {
      basePatch: { gameBoard: { image: url } },
      documents: [],
      cloudinaryUrls: ["http://res.cloudinary.com/demo/image/upload/image.png"]
    }),
    error => error.code === "campaign/media-cloudinary-url-invalid"
  );
  await assert.rejects(
    repository.commitCampaignMediaMutation("campaign-1", {
      basePatch: { gameBoard: { image: url } },
      documents: Array.from({ length: 500 }, (_, index) => ({
        collection: "characters",
        id: `char-${index}`,
        data: { image: url }
      })),
      cloudinaryUrls: [url]
    }),
    error => error.code === "campaign/media-operation-limit"
  );
  assert.equal(writes.length, 0);
});

test("accepts media only from the configured Cloudinary account", async () => {
  const { context, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    baseCampaign: { id: "campaign-1", masterId: "master-1" },
    withBatch: true
  });
  context.cloudinaryCloudName = "sbyfm34m";
  const repository = createCampaignRepository(context);
  const foreignUrl = "https://res.cloudinary.com/another-cloud/image/upload/v1/board.png";

  await assert.rejects(
    repository.commitCampaignMediaMutation("campaign-1", {
      basePatch: { gameBoard: { image: foreignUrl } },
      documents: [],
      cloudinaryUrls: [foreignUrl]
    }),
    error => error.code === "campaign/media-cloudinary-url-invalid"
  );
  assert.equal(writes.length, 0);
});

test("rejects an unmanaged image hidden beside a valid media URL", async () => {
  const validUrl = "https://res.cloudinary.com/demo/image/upload/v1/valid.png";
  const { context, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    baseCampaign: { id: "campaign-1", masterId: "master-1" },
    withBatch: true
  });
  const repository = createCampaignRepository(context);

  await assert.rejects(
    repository.commitCampaignMediaMutation("campaign-1", {
      basePatch: {},
      documents: [{
        collection: "characters",
        id: "char-1",
        data: { image: "https://example.com/portrait.png" }
      }],
      cloudinaryUrls: [validUrl]
    }),
    error => error.code === "campaign/unmanaged-image-not-allowed"
  );
  assert.equal(writes.length, 0);
});

test("rejects unmanaged images in dedicated and generic campaign writes", async () => {
  const { context, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" }
  });
  const repository = createCampaignRepository(context);

  await assert.rejects(
    repository.updateCharacterInventory("campaign-1", "char-1", [{
      id: "inv-1",
      image: "data:image/png;base64,AAAA"
    }]),
    error => error.code === "campaign/unmanaged-image-not-allowed"
  );
  const campaign = campaignFixture();
  campaign.characters[0].expressions = [{ id: "exp-1", image: "https://example.com/expression.png" }];
  await assert.rejects(
    repository.saveCampaign(campaign, { role: "master" }),
    error => error.code === "campaign/unmanaged-image-not-allowed"
  );
  assert.equal(writes.length, 0);
});

test("requires the authenticated campaign master for atomic media commits", async () => {
  const url = "https://res.cloudinary.com/demo/image/upload/v1/board.png";
  const mutation = {
    basePatch: { gameBoard: { image: url } },
    documents: [],
    cloudinaryUrls: [url]
  };
  const unauthorized = createFakeContext({
    user: { uid: "other-master", email: "other@example.com" },
    baseCampaign: { id: "campaign-1", masterId: "master-1" },
    withBatch: true
  });
  const unauthorizedRepository = createCampaignRepository(unauthorized.context);
  await assert.rejects(
    unauthorizedRepository.commitCampaignMediaMutation("campaign-1", mutation),
    error => error.code === "campaign/media-master-required"
  );
  assert.equal(unauthorized.writes.length, 0);

  const anonymous = createFakeContext({ user: null, withBatch: true });
  const anonymousRepository = createCampaignRepository(anonymous.context);
  await assert.rejects(
    anonymousRepository.commitCampaignMediaMutation("campaign-1", mutation),
    error => error.code === "campaign/media-master-required"
  );
  assert.equal(anonymous.writes.length, 0);
});

test("migrates duplicate Base64 images transactionally while preserving concurrent fields", async () => {
  const prefix = "db/campaigns/campaign-1";
  const source = "data:image/png;base64,AAAA";
  const url = "https://res.cloudinary.com/demo/image/upload/v1/campaign/image.png";
  const metadata = { publicId: "campaign/image", width: 1920, height: 1080, format: "png" };
  const unchangedItem = {
    id: "item-1",
    title: "Lanterna",
    image: "https://res.cloudinary.com/demo/image/upload/lanterna.jpg",
    quantity: 1
  };
  const unchangedCreature = { id: "creature-1", name: "Corvo", stats: { health: 3 } };
  const unchangedMark = { id: "mark-1", label: "Runa", icon: source };
  const expectedCampaign = {
    id: "campaign-1",
    title: "Campanha preservada",
    gameBoard: { image: source, zoom: 1.25, offsetX: 40 },
    characters: [{
      id: "char-1",
      name: "Ana",
      image: source,
      inventory: [{ id: "inv-1", name: "Mapa", quantity: 2, image: source }],
      expressions: [{ id: "expression-1", label: "Assustada", image: source }]
    }],
    cases: [{ id: "case-1", title: "Arquivo", attachments: [{ id: "attachment-1", image: source, notes: "intactas" }] }],
    evidence: [{ id: "evidence-1", title: "Foto", image: source, discovered: true }],
    itemTransfers: [{ id: "transfer-1", status: "pending", payload: { image: source, quantity: 1 } }],
    scenes: [{ id: "scene-1", title: "Entrada", image: source }]
  };
  const { context, documents, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    listDocuments: true,
    documents: {
      [prefix]: {
        id: "campaign-1",
        title: "Campanha preservada",
        concurrentField: { revision: 17, owner: "outro fluxo" },
        gameBoard: { image: source, zoom: 1.25, offsetX: 40 },
        legacyPreview: source
      },
      [`${prefix}/characters/char-1`]: {
        id: "char-1",
        name: "Ana",
        health: 9,
        concurrentStatus: "preservar",
        image: source,
        inventory: [{ id: "inv-1", name: "Mapa", quantity: 2, image: source }],
        expressions: [{ id: "expression-1", label: "Assustada", image: source }]
      },
      [`${prefix}/cases/case-1`]: {
        id: "case-1",
        title: "Arquivo",
        attachments: [{ id: "attachment-1", image: source, notes: "intactas" }]
      },
      [`${prefix}/creatures/creature-1`]: unchangedCreature,
      [`${prefix}/items/item-1`]: unchangedItem,
      [`${prefix}/evidence/evidence-1`]: { id: "evidence-1", title: "Foto", image: source, discovered: true },
      [`${prefix}/marks/mark-1`]: unchangedMark,
      [`${prefix}/itemTransfers/transfer-1`]: {
        id: "transfer-1",
        status: "pending",
        payload: { image: source, quantity: 1 }
      },
      [`${prefix}/scenes/scene-1`]: { id: "scene-1", title: "Entrada", image: source, _order: 0 }
    }
  });
  const repository = createCampaignRepository(context);

  const result = await repository.migrateCampaignImages("campaign-1", [
    { source, url, metadata },
    { source, url, metadata }
  ], { expectedCampaign, expectedCount: 8 });

  assert.deepEqual(result, {
    status: "committed",
    verified: true,
    count: 8,
    expectedCount: 8,
    documents: 6,
    createdDocuments: 0
  });
  assert.equal(writes.filter(write => write.method === "transaction-update").length, 6);

  const baseWrite = writes.find(write => write.ref === prefix);
  assert.deepEqual(Object.keys(baseWrite.data), ["gameBoard", "imageMigration", "updatedAt"]);
  assert.equal(baseWrite.data.imageMigration.provider, "cloudinary");
  assert.equal(baseWrite.data.imageMigration.migratedReferences, 8);
  assert.deepEqual(documents.get(prefix).concurrentField, { revision: 17, owner: "outro fluxo" });
  assert.equal(documents.get(prefix).title, "Campanha preservada");
  assert.equal(documents.get(prefix).legacyPreview, source);
  assert.equal(documents.get(prefix).gameBoard.image, url);
  assert.deepEqual(documents.get(prefix).gameBoard.imageMeta, metadata);

  const character = documents.get(`${prefix}/characters/char-1`);
  assert.equal(character.health, 9);
  assert.equal(character.concurrentStatus, "preservar");
  assert.equal(character.image, url);
  assert.deepEqual(character.imageMeta, metadata);
  assert.equal(character.inventory[0].quantity, 2);
  assert.equal(character.inventory[0].image, url);
  assert.deepEqual(character.inventory[0].imageMeta, metadata);
  assert.equal(character.expressions[0].image, url);

  assert.deepEqual(documents.get(`${prefix}/items/item-1`), unchangedItem);
  assert.deepEqual(documents.get(`${prefix}/creatures/creature-1`), unchangedCreature);
  assert.deepEqual(documents.get(`${prefix}/marks/mark-1`), unchangedMark);
  assert.equal(writes.some(write => write.ref === `${prefix}/items/item-1`), false);
  assert.equal(writes.some(write => write.ref === `${prefix}/creatures/creature-1`), false);
  assert.equal(writes.some(write => write.ref === `${prefix}/marks/mark-1`), false);
  assert.equal(documents.get(`${prefix}/cases/case-1`).attachments[0].notes, "intactas");
  assert.equal(documents.get(`${prefix}/itemTransfers/transfer-1`).payload.quantity, 1);
  assert.equal(documents.get(`${prefix}/scenes/scene-1`)._order, 0);
});

test("image migration writes nothing when no image property matches", async () => {
  const prefix = "db/campaigns/campaign-1";
  const { context, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    listDocuments: true,
    documents: {
      [prefix]: { id: "campaign-1", preview: "data:image/png;base64,AAAA", title: "Sem imagem migravel" },
      [`${prefix}/scenes/scene-1`]: {
        id: "scene-1",
        image: "https://res.cloudinary.com/demo/image/upload/already-managed.jpg"
      }
    }
  });
  const repository = createCampaignRepository(context);

  const result = await repository.migrateCampaignImages("campaign-1", [], {
    expectedCampaign: {
      id: "campaign-1",
      title: "Sem imagem migravel",
      scenes: [{ id: "scene-1", image: "https://res.cloudinary.com/demo/image/upload/already-managed.jpg" }]
    },
    expectedCount: 0
  });

  assert.deepEqual(result, {
    status: "noop",
    verified: true,
    count: 0,
    expectedCount: 0,
    documents: 0,
    createdDocuments: 0
  });
  assert.equal(writes.length, 0);
});

test("migrates external and relative image sources with exact snapshot coverage", async () => {
  const prefix = "db/campaigns/campaign-1";
  const externalSource = "https://legacy.example.com/boards/main.jpg";
  const relativeSource = "/uploads/characters/ana.png";
  const boardUrl = "https://res.cloudinary.com/demo/image/upload/v7/boards/main.jpg";
  const characterUrl = "https://res.cloudinary.com/demo/image/upload/v7/characters/ana.png";
  const expectedCampaign = {
    id: "campaign-1",
    gameBoard: { image: externalSource, zoom: 1.4 },
    characters: [{ id: "char-1", name: "Ana", image: relativeSource }]
  };
  const { context, documents, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    listDocuments: true,
    documents: {
      [prefix]: { id: "campaign-1", masterId: "master-1", gameBoard: { image: externalSource, zoom: 1.4 } },
      [`${prefix}/characters/char-1`]: { id: "char-1", name: "Ana", health: 8, image: relativeSource }
    }
  });
  const repository = createCampaignRepository(context);

  const result = await repository.migrateCampaignImages("campaign-1", [
    { source: externalSource, url: boardUrl, metadata: { publicId: "boards/main", width: 1920, height: 1080 } },
    { source: relativeSource, url: characterUrl, metadata: { publicId: "characters/ana", width: 800, height: 800 } }
  ], { expectedCampaign, expectedCount: 2 });

  assert.deepEqual(result, {
    status: "committed",
    verified: true,
    count: 2,
    expectedCount: 2,
    documents: 2,
    createdDocuments: 0
  });
  assert.equal(documents.get(prefix).gameBoard.image, boardUrl);
  assert.equal(documents.get(prefix).gameBoard.zoom, 1.4);
  assert.equal(documents.get(`${prefix}/characters/char-1`).image, characterUrl);
  assert.equal(documents.get(`${prefix}/characters/char-1`).health, 8);
  assert.equal(writes.filter(write => write.method === "transaction-update").length, 2);
});

test("requires replacements for every external or relative image in the local snapshot", async () => {
  const externalSource = "https://legacy.example.com/board.jpg";
  const relativeSource = "./assets/portrait.png";
  const { context, writes } = createFakeContext({ user: { uid: "master-1", email: "master@example.com" } });
  const repository = createCampaignRepository(context);

  await assert.rejects(
    repository.migrateCampaignImages("campaign-1", [{
      source: externalSource,
      url: "https://res.cloudinary.com/demo/image/upload/board.jpg"
    }], {
      expectedCampaign: {
        id: "campaign-1",
        gameBoard: { image: externalSource },
        characters: [{ id: "char-1", image: relativeSource }]
      },
      expectedCount: 2
    }),
    error => error.code === "campaign/migration-replacements-incomplete"
  );
  assert.equal(writes.length, 0);
});

test("image migration aborts without writes when a document or nested entry disappeared remotely", async () => {
  const prefix = "db/campaigns/campaign-1";
  const source = "data:image/png;base64,LOCAL";
  const url = "https://res.cloudinary.com/demo/image/upload/v4/local.png";
  const metadata = { publicId: "local", width: 1600, height: 900 };
  const { context, documents, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    listDocuments: true,
    documents: {
      [prefix]: { id: "campaign-1", title: "Remoto" },
      [`${prefix}/characters/char-1`]: {
        id: "char-1",
        name: "Nome remoto concorrente",
        image: source,
        health: 7,
        inventory: [{ id: "inv-existing", quantity: 9, notes: "preservar", image: source }]
      }
    }
  });
  const repository = createCampaignRepository(context);
  const expectedCampaign = {
    id: "campaign-1",
    title: "Snapshot local",
    characters: [{
      id: "char-1",
      name: "Nome local antigo",
      image: source,
      inventory: [
        { id: "inv-existing", quantity: 1, image: source },
        { id: "inv-local", name: "Mapa local", quantity: 2, image: source }
      ]
    }],
    scenes: [{ id: "scene-local", title: "Cena recuperada", image: source }]
  };

  await assert.rejects(
    repository.migrateCampaignImages(
      "campaign-1",
      [{ source, url, metadata }],
      { expectedCampaign, expectedCount: 4 }
    ),
    error => error.code === "campaign/migration-remote-data-missing"
  );

  const character = documents.get(`${prefix}/characters/char-1`);
  assert.equal(character.name, "Nome remoto concorrente");
  assert.equal(character.health, 7);
  assert.equal(character.inventory[0].quantity, 9);
  assert.equal(character.inventory[0].notes, "preservar");
  assert.equal(character.image, source);
  assert.equal(character.inventory.length, 1);
  assert.equal(documents.has(`${prefix}/scenes/scene-local`), false);
  assert.equal(writes.length, 0);
  assert.equal(documents.get(prefix).imageMigration, undefined);
});

test("image migration preflight verifies the exact remote snapshot without writing", async () => {
  const prefix = "db/campaigns/campaign-1";
  const boardSource = "/legacy/board.webp";
  const portraitSource = "data:image/png;base64,PORTRAIT";
  const { context, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    listDocuments: true,
    documents: {
      [prefix]: {
        id: "campaign-1",
        masterId: "master-1",
        name: "Campanha ativa",
        gameBoard: { image: boardSource, zoom: 1.25 },
        updatedAt: "2026-08-05T10:00:00.000Z"
      },
      [`${prefix}/characters/char-1`]: {
        id: "char-1",
        name: "Investigadora",
        image: portraitSource,
        health: 7
      }
    }
  });
  const repository = createCampaignRepository(context);
  const expectedCampaign = {
    id: "campaign-1",
    masterId: "master-1",
    name: "Campanha ativa",
    gameBoard: { image: boardSource, zoom: 1.25 },
    updatedAt: "2026-08-05T10:00:00.000Z",
    characters: [{ id: "char-1", name: "Investigadora", image: portraitSource, health: 7 }]
  };

  const result = await repository.preflightCampaignImageMigration("campaign-1", expectedCampaign);

  assert.deepEqual(result, {
    status: "ready",
    verified: true,
    campaignId: "campaign-1",
    expectedCount: 2,
    documents: 2,
    updatedAt: "2026-08-05T10:00:00.000Z"
  });
  assert.equal(writes.length, 0);
});

test("image migration preflight blocks missing remote documents without writing", async () => {
  const prefix = "db/campaigns/campaign-1";
  const source = "data:image/png;base64,MISSING";
  const { context, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    listDocuments: true,
    documents: {
      [prefix]: { id: "campaign-1", masterId: "master-1" }
    }
  });
  const repository = createCampaignRepository(context);

  await assert.rejects(
    repository.preflightCampaignImageMigration("campaign-1", {
      id: "campaign-1",
      masterId: "master-1",
      scenes: [{ id: "scene-removed", image: source }]
    }),
    error => error.code === "campaign/migration-remote-data-missing"
  );
  assert.equal(writes.length, 0);
});

test("legacy storage preparation moves exact remote image records atomically without changing progress", async () => {
  const prefix = "db/campaigns/campaign-1";
  const sceneSource = "/legacy/scene.jpg";
  const portraitSource = "data:image/png;base64,CHARACTER";
  const { context, documents, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    listDocuments: true,
    documents: {
      [prefix]: {
        id: "campaign-1",
        masterId: "master-1",
        name: "Campanha em andamento",
        members: ["master-1", "player-1"],
        players: [{ id: "player-1", authUid: "player-1", characterId: "char-1" }],
        characters: [{ id: "char-1", name: "Morgana", health: 6, sanity: 4, image: portraitSource }],
        scenes: [{ id: "scene-1", title: "Portao", masterNotes: "Nao perder", image: sceneSource }]
      }
    }
  });
  const repository = createCampaignRepository(context);

  const result = await repository.upgradeLegacyCampaignStorageLayout("campaign-1");

  assert.equal(result.status, "committed");
  assert.equal(result.verified, true);
  assert.equal(result.documents, 2);
  const base = documents.get(prefix);
  assert.equal("characters" in base, false);
  assert.equal("scenes" in base, false);
  assert.deepEqual(base.players, [{ id: "player-1", authUid: "player-1", characterId: "char-1" }]);
  assert.deepEqual(base.members, ["master-1", "player-1"]);
  assert.equal(base.name, "Campanha em andamento");
  assert.deepEqual(documents.get(`${prefix}/characters/char-1`), {
    id: "char-1",
    name: "Morgana",
    health: 6,
    sanity: 4,
    image: portraitSource,
    _order: 0
  });
  assert.deepEqual(documents.get(`${prefix}/scenes/scene-1`), {
    id: "scene-1",
    title: "Portao",
    masterNotes: "Nao perder",
    image: sceneSource,
    _order: 0
  });
  assert.equal(writes.filter(write => write.method === "transaction-set").length, 2);
  assert.equal(writes.filter(write => write.method === "transaction-update").length, 1);

  const preflight = await repository.preflightCampaignImageMigration("campaign-1", {
    id: "campaign-1",
    masterId: "master-1",
    name: "Campanha em andamento",
    members: ["master-1", "player-1"],
    players: [{ id: "player-1", authUid: "player-1", characterId: "char-1" }],
    characters: [{ id: "char-1", name: "Morgana", health: 6, sanity: 4, image: portraitSource }],
    scenes: [{ id: "scene-1", title: "Portao", masterNotes: "Nao perder", image: sceneSource }]
  });
  assert.equal(preflight.verified, true);
  assert.equal(preflight.expectedCount, 2);
});

test("legacy storage preparation blocks mixed old and new collection layouts without writing", async () => {
  const prefix = "db/campaigns/campaign-1";
  const source = "/legacy/scene.jpg";
  const { context, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    listDocuments: true,
    documents: {
      [prefix]: {
        id: "campaign-1",
        masterId: "master-1",
        scenes: [{ id: "scene-old", image: source }]
      },
      [`${prefix}/scenes/scene-new`]: {
        id: "scene-new",
        image: "https://res.cloudinary.com/demo/image/upload/v1/new.jpg"
      }
    }
  });
  const repository = createCampaignRepository(context);

  await assert.rejects(
    repository.upgradeLegacyCampaignStorageLayout("campaign-1"),
    error => error.code === "campaign/migration-legacy-storage-mixed"
  );
  assert.equal(writes.length, 0);
});

test("legacy storage preparation blocks unsafe or repeated document ids without writing", async () => {
  const prefix = "db/campaigns/campaign-1";
  const source = "/legacy/scene.jpg";
  const { context, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    listDocuments: true,
    documents: {
      [prefix]: {
        id: "campaign-1",
        masterId: "master-1",
        scenes: [
          { id: "repeated", image: source },
          { id: "repeated", image: `${source}?second=1` }
        ]
      }
    }
  });
  const repository = createCampaignRepository(context);

  await assert.rejects(
    repository.upgradeLegacyCampaignStorageLayout("campaign-1"),
    error => error.code === "campaign/migration-array-id-conflict"
  );
  assert.equal(writes.length, 0);
});

test("image migration preflight blocks embedded legacy collections for a compatibility procedure", async () => {
  const prefix = "db/campaigns/campaign-1";
  const source = "/legacy/scene.jpg";
  const { context, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    listDocuments: true,
    documents: {
      [prefix]: {
        id: "campaign-1",
        masterId: "master-1",
        scenes: [{ id: "scene-legacy", image: source }]
      }
    }
  });
  const repository = createCampaignRepository(context);

  await assert.rejects(
    repository.preflightCampaignImageMigration("campaign-1", {
      id: "campaign-1",
      masterId: "master-1",
      scenes: [{ id: "scene-legacy", image: source }]
    }),
    error => error.code === "campaign/migration-legacy-storage-layout"
  );
  assert.equal(writes.length, 0);
});

test("image migration preflight requires the authenticated campaign master", async () => {
  const prefix = "db/campaigns/campaign-1";
  const source = "/legacy/board.jpg";
  const { context, writes } = createFakeContext({
    user: { uid: "player-1", email: "player@example.com" },
    listDocuments: true,
    documents: {
      [prefix]: { id: "campaign-1", masterId: "master-1", gameBoard: { image: source } }
    }
  });
  const repository = createCampaignRepository(context);

  await assert.rejects(
    repository.preflightCampaignImageMigration("campaign-1", {
      id: "campaign-1",
      masterId: "master-1",
      gameBoard: { image: source }
    }),
    error => error.code === "campaign/migration-master-required"
  );
  assert.equal(writes.length, 0);
});

test("image migration preflight leaves Firestore headroom before the transaction limit", async () => {
  const prefix = "db/campaigns/campaign-1";
  const source = "/legacy/scene.jpg";
  const documents = {
    [prefix]: { id: "campaign-1", masterId: "master-1" }
  };
  const scenes = Array.from({ length: 450 }, (_, index) => {
    const scene = { id: `scene-${index}`, image: `${source}?id=${index}` };
    documents[`${prefix}/scenes/${scene.id}`] = scene;
    return scene;
  });
  const { context, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    listDocuments: true,
    documents
  });
  const repository = createCampaignRepository(context);

  await assert.rejects(
    repository.preflightCampaignImageMigration("campaign-1", {
      id: "campaign-1",
      masterId: "master-1",
      scenes
    }),
    error => error.code === "campaign/migration-operation-limit"
  );
  assert.equal(writes.length, 0);
});

test("image migration aborts atomically when a remote image was explicitly removed", async () => {
  const prefix = "db/campaigns/campaign-1";
  const source = "data:image/png;base64,REMOVED";
  const target = "https://res.cloudinary.com/demo/image/upload/v9/removed.png";
  const { context, writes } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    listDocuments: true,
    documents: {
      [prefix]: { id: "campaign-1", masterId: "master-1" },
      [`${prefix}/characters/char-1`]: { id: "char-1", name: "Sem retrato", image: "", health: 8 }
    }
  });
  const repository = createCampaignRepository(context);

  await assert.rejects(
    repository.migrateCampaignImages(
      "campaign-1",
      [{ source, url: target, metadata: { publicId: "removed" } }],
      {
        expectedCampaign: {
          id: "campaign-1",
          masterId: "master-1",
          characters: [{ id: "char-1", name: "Retrato antigo", image: source, health: 8 }]
        },
        expectedCount: 1
      }
    ),
    error => error.code === "campaign/migration-image-conflict"
  );
  assert.equal(writes.length, 0);
});

test("image migration keeps liveScene public and never stores Cloudinary metadata or master fields there", async () => {
  const prefix = "db/campaigns/campaign-1";
  const source = "data:image/jpeg;base64,LIVE";
  const url = "https://res.cloudinary.com/demo/image/upload/v5/live.jpg";
  const { context, documents } = createFakeContext({
    user: { uid: "master-1", email: "master@example.com" },
    listDocuments: true,
    documents: {
      [prefix]: {
        id: "campaign-1",
        title: "Campanha",
        liveScene: {
          active: true,
          sceneId: "scene-1",
          image: source,
          index: 0,
          total: 1,
          updatedAt: "2026-08-02T12:00:00.000Z",
          caption: "nao publicar",
          masterNotes: "segredo",
          imageMeta: { publicId: "legacy-private" }
        }
      }
    }
  });
  const repository = createCampaignRepository(context);
  const expectedCampaign = {
    id: "campaign-1",
    liveScene: {
      active: true,
      sceneId: "scene-1",
      image: source,
      index: 0,
      total: 1,
      updatedAt: "2026-08-02T12:00:00.000Z",
      masterNotes: "segredo local"
    }
  };

  const result = await repository.migrateCampaignImages(
    "campaign-1",
    [{ source, url, metadata: { assetId: "private-asset", publicId: "private/public-id", bytes: 1234 } }],
    { expectedCampaign, expectedCount: 1 }
  );

  assert.equal(result.verified, true);
  assert.equal(result.count, 1);
  const liveScene = documents.get(prefix).liveScene;
  assert.deepEqual(Object.keys(liveScene).sort(), ["active", "image", "index", "sceneId", "total", "updatedAt"]);
  assert.equal(liveScene.image, url);
  assert.equal("imageMeta" in liveScene, false);
  assert.equal("masterNotes" in liveScene, false);
  assert.equal("caption" in liveScene, false);
});

test("image migration rejects an incorrect expected reference count before any Firestore write", async () => {
  const source = "data:image/png;base64,COUNT";
  const { context, writes } = createFakeContext({ user: { uid: "master-1", email: "master@example.com" } });
  const repository = createCampaignRepository(context);

  await assert.rejects(
    repository.migrateCampaignImages(
      "campaign-1",
      [{ source, url: "https://res.cloudinary.com/demo/image/upload/count.png", metadata: {} }],
      {
        expectedCampaign: { id: "campaign-1", gameBoard: { image: source } },
        expectedCount: 2
      }
    ),
    error => error.code === "campaign/migration-expected-count-mismatch"
  );
  assert.equal(writes.length, 0);
});

test("image migration aborts atomically for every unrepresented remote unmanaged image", async () => {
  const prefix = "db/campaigns/campaign-1";
  const expectedSource = "data:image/png;base64,EXPECTED";
  for (const remoteOnlySource of ["https://remote.example.com/trauma.jpg", "../legacy/trauma.jpg"]) {
    const { context, writes } = createFakeContext({
      user: { uid: "master-1", email: "master@example.com" },
      listDocuments: true,
      documents: {
        [prefix]: {
          id: "campaign-1",
          gameBoard: { image: expectedSource },
          traumaCatalog: [{ id: "remote-trauma", image: remoteOnlySource }]
        }
      }
    });
    const repository = createCampaignRepository(context);

    await assert.rejects(
      repository.migrateCampaignImages(
        "campaign-1",
        [{
          source: expectedSource,
          url: "https://res.cloudinary.com/demo/image/upload/expected.png",
          metadata: {}
        }],
        {
          expectedCampaign: { id: "campaign-1", gameBoard: { image: expectedSource } },
          expectedCount: 1
        }
      ),
      error => error.code === "campaign/migration-snapshot-stale"
    );
    assert.equal(writes.length, 0);
  }
});

test("rejects invalid and conflicting image migration destinations before reading Firestore", async () => {
  const { context, writes } = createFakeContext({ user: { uid: "master-1", email: "master@example.com" } });
  const repository = createCampaignRepository(context);
  const source = "data:image/jpeg;base64,AAAA";

  await assert.rejects(
    repository.migrateCampaignImages("campaign-1", [{
      source: "https://res.cloudinary.com/demo/image/upload/already-managed.jpg",
      url: "https://res.cloudinary.com/demo/image/upload/source.jpg"
    }]),
    error => error.code === "campaign/migration-source-invalid"
  );
  await assert.rejects(
    repository.migrateCampaignImages("campaign-1", [{ source, url: "data:image/jpeg;base64,BBBB" }]),
    error => error.code === "campaign/migration-url-invalid"
  );
  await assert.rejects(
    repository.migrateCampaignImages("campaign-1", [{ source, url: "http://res.cloudinary.com/demo/image/upload/source.jpg" }]),
    error => error.code === "campaign/migration-url-invalid"
  );
  await assert.rejects(
    repository.migrateCampaignImages("campaign-1", [{ source, url: "https://example.com/not-cloudinary.jpg" }]),
    error => error.code === "campaign/migration-url-invalid"
  );
  await assert.rejects(
    repository.migrateCampaignImages("campaign-1", [
      { source, url: "https://res.cloudinary.com/demo/image/upload/one.jpg" },
      { source, url: "https://res.cloudinary.com/demo/image/upload/two.jpg" }
    ]),
    error => error.code === "campaign/migration-source-conflict"
  );
  assert.equal(writes.length, 0);
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
    image: "https://res.cloudinary.com/demo/image/upload/lanterna.jpg",
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
    image: "https://res.cloudinary.com/demo/image/upload/carta.jpg"
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
    image: "https://res.cloudinary.com/demo/image/upload/tenso.jpg",
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
    image: "https://res.cloudinary.com/demo/image/upload/aranha.jpg",
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
    image: "https://res.cloudinary.com/demo/image/upload/aranha.jpg",
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
  const remainingCatalog = [{ id: "catalog-2", title: "Claustrofobia", image: "https://res.cloudinary.com/demo/image/upload/cela.jpg" }];
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
        inventory: [{ id: "inv-1", itemId: "item-1", name: "Flecha de prata", description: "Contra criaturas", image: "https://res.cloudinary.com/demo/image/upload/flecha.jpg", notes: "", quantity: 3 }]
      },
      [`${prefix}/characters/char-2`]: {
        inventory: [{ id: "inv-old", itemId: "item-1", name: "Flecha antiga", description: "Antiga", image: "https://res.cloudinary.com/demo/image/upload/antiga.jpg", notes: "", quantity: 1 }]
      }
    }
  });
  const repository = createCampaignRepository(context);

  const result = await repository.resolveItemTransfer("campaign-1", "transfer-1", "approved");

  assert.equal(documents.get(`${prefix}/characters/char-1`).inventory[0].quantity, 1);
  assert.equal(documents.get(`${prefix}/characters/char-2`).inventory[0].quantity, 3);
  assert.equal(documents.get(`${prefix}/characters/char-2`).inventory[0].name, "Flecha de prata");
  assert.equal(documents.get(`${prefix}/characters/char-2`).inventory[0].description, "Contra criaturas");
  assert.equal(documents.get(`${prefix}/characters/char-2`).inventory[0].image, "https://res.cloudinary.com/demo/image/upload/flecha.jpg");
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
    image: "https://res.cloudinary.com/demo/image/upload/foto.jpg"
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
