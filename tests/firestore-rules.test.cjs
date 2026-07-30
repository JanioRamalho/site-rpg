const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

process.env.NODE_PATH = path.join(os.tmpdir(), "site-rpg-rules-test", "node_modules");
Module._initPaths();

const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} = require("@firebase/rules-unit-testing");
const {
  arrayUnion,
  doc,
  getDoc,
  runTransaction,
  setDoc,
  updateDoc
} = require("firebase/firestore");

async function run() {
  const testEnv = await initializeTestEnvironment({
    projectId: "demo-site-rpg",
    firestore: {
      host: "127.0.0.1",
      port: 8085,
      rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8")
    }
  });

  try {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, "campaigns", "room-1"), {
        masterId: "master-auth",
        members: ["master-auth"],
        name: "Mesa",
        password: "secret",
        readyPlayerEmails: ["ana@example.com"],
        updatedAt: new Date().toISOString()
      });
      await setDoc(doc(db, "campaigns", "room-1", "players", "player-1"), {
        id: "player-1",
        name: "Ana",
        email: "ana@example.com",
        emailNormalized: "ana@example.com",
        authUid: null,
        characterId: "char-1",
        status: "pending",
        online: false,
        lastSeen: null,
        joinedAt: null,
        _order: 0
      });
      await setDoc(doc(db, "campaigns", "room-1", "characters", "char-1"), {
        id: "char-1",
        name: "Morgana",
        controllerPlayerId: "player-1",
        health: 10,
        healthMax: 10,
        sanity: 8,
        sanityMax: 8,
        skills: [],
        inventory: [],
        _order: 0
      });
      await setDoc(doc(db, "campaigns", "room-1", "characters", "char-2"), {
        id: "char-2",
        name: "Orion",
        controllerPlayerId: null,
        health: 10,
        healthMax: 10,
        sanity: 8,
        sanityMax: 8,
        skills: [],
        inventory: [],
        _order: 1
      });
    });

    const prepared = testEnv.authenticatedContext("player-auth", { email: "ana@example.com" }).firestore();
    const outsider = testEnv.authenticatedContext("outsider-auth", { email: "outsider@example.com" }).firestore();
    const master = testEnv.authenticatedContext("master-auth", { email: "master@example.com" }).firestore();

    await assertFails(updateDoc(doc(outsider, "campaigns", "room-1"), {
      members: arrayUnion("outsider-auth"),
      updatedAt: new Date().toISOString()
    }));

    await assertSucceeds(updateDoc(doc(prepared, "campaigns", "room-1"), {
      members: arrayUnion("player-auth"),
      updatedAt: new Date().toISOString()
    }));

    await assertSucceeds(updateDoc(doc(prepared, "campaigns", "room-1", "players", "player-1"), {
      authUid: "player-auth",
      email: "ana@example.com",
      emailNormalized: "ana@example.com",
      status: "claimed",
      online: true,
      lastSeen: new Date().toISOString(),
      joinedAt: new Date().toISOString()
    }));

    await assertSucceeds(updateDoc(doc(prepared, "campaigns", "room-1", "characters", "char-1"), {
      controllerPlayerId: "player-1",
      health: 9,
      sanity: 7,
      skills: []
    }));

    await assertFails(updateDoc(doc(prepared, "campaigns", "room-1", "characters", "char-1"), {
      inventory: [{ id: "forged", name: "Item forjado", quantity: 1 }]
    }));

    await assertFails(updateDoc(doc(prepared, "campaigns", "room-1", "players", "player-1"), {
      characterId: "another-character"
    }));

    await assertSucceeds(setDoc(doc(prepared, "campaigns", "room-1", "itemTransfers", "transfer-1"), {
      id: "transfer-1",
      fromPlayerId: "player-1",
      fromCharacterId: "char-1",
      toCharacterId: "char-2",
      type: "item",
      inventoryId: "inv-1",
      quantity: 1,
      itemName: "Pocao",
      status: "pending",
      _order: 0
    }));

    await assertFails(setDoc(doc(prepared, "campaigns", "room-1", "itemTransfers", "transfer-forged"), {
      id: "transfer-forged",
      fromPlayerId: "player-1",
      fromCharacterId: "another-character",
      toCharacterId: "char-2",
      type: "item",
      inventoryId: "inv-1",
      quantity: 1,
      itemName: "Item alheio",
      status: "pending",
      _order: 1
    }));

    await assertFails(updateDoc(doc(prepared, "campaigns", "room-1", "itemTransfers", "transfer-1"), {
      status: "approved"
    }));

    await assertSucceeds(updateDoc(doc(master, "campaigns", "room-1", "itemTransfers", "transfer-1"), {
      status: "approved",
      resolvedBy: "master-auth"
    }));

    await assertSucceeds(updateDoc(doc(master, "campaigns", "room-1", "characters", "char-1"), {
      inventory: [{ id: "inv-1", name: "Pocao", quantity: 1 }]
    }));

    await assertSucceeds(runTransaction(master, async transaction => {
      const campaignRef = doc(master, "campaigns", "room-1");
      const playerRef = doc(master, "campaigns", "room-1", "players", "player-1");
      const previousCharacterRef = doc(master, "campaigns", "room-1", "characters", "char-1");
      const nextCharacterRef = doc(master, "campaigns", "room-1", "characters", "char-2");
      await transaction.get(playerRef);
      await transaction.get(previousCharacterRef);
      await transaction.get(nextCharacterRef);
      transaction.update(playerRef, {
        characterId: "char-2",
        characterLinkUpdatedAt: new Date().toISOString(),
        characterLinkUpdatedBy: "master-auth"
      });
      transaction.update(previousCharacterRef, { controllerPlayerId: null });
      transaction.update(nextCharacterRef, { controllerPlayerId: "player-1" });
      transaction.update(campaignRef, { updatedAt: new Date().toISOString() });
    }));

    await assertSucceeds(updateDoc(doc(prepared, "campaigns", "room-1", "players", "player-1"), {
      online: false,
      lastSeen: new Date().toISOString()
    }));

    await assertSucceeds(updateDoc(doc(prepared, "campaigns", "room-1", "characters", "char-2"), {
      health: 9
    }));

    await assertSucceeds(setDoc(doc(master, "campaigns", "room-1", "scenes", "scene-1"), {
      id: "scene-1",
      title: "Entrada",
      image: "https://example.com/scene.jpg",
      masterNotes: "Informacao privada",
      _order: 0
    }));

    await assertFails(getDoc(doc(prepared, "campaigns", "room-1", "scenes", "scene-1")));
    await assertSucceeds(getDoc(doc(master, "campaigns", "room-1", "scenes", "scene-1")));

    console.log("Firestore rules: 17 permission checks passed.");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
