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
      itemName: "Pocao",
      status: "pending",
      _order: 0
    }));

    await assertSucceeds(updateDoc(doc(master, "campaigns", "room-1", "characters", "char-1"), {
      inventory: [{ id: "inv-1", name: "Pocao", quantity: 1 }]
    }));

    console.log("Firestore rules: 8 permission checks passed.");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
