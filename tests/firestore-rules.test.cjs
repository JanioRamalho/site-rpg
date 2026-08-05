const fs = require("node:fs");
const assert = require("node:assert/strict");
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
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  writeBatch,
  where
} = require("firebase/firestore");

async function waitUntil(predicate, label, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`Tempo esgotado: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function run() {
  const emulatorPort = Number(process.env.FIRESTORE_EMULATOR_PORT || 8086);
  const testEnv = await initializeTestEnvironment({
    projectId: "demo-site-rpg",
    firestore: {
      host: "127.0.0.1",
      port: emulatorPort,
      rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8")
    }
  });

  try {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, "campaigns", "room-1"), {
        masterId: "master-auth",
        members: ["master-auth", "second-auth", "observer-auth"],
        name: "Mesa",
        password: "secret",
        readyPlayerEmails: ["ana@example.com"],
        chatSettings: { publicEnabled: true, privateEnabled: true, privateThreads: {} },
        scenes: [{
          id: "legacy-scene",
          title: "Cena antiga",
          image: "data:image/png;base64,LEGACY",
          masterNotes: "Preservar"
        }],
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
        origin: "Medica",
        controllerPlayerId: "player-1",
        health: 10,
        healthMax: 10,
        sanity: 8,
        sanityMax: 8,
        skills: [],
        inventory: [],
        evidence: [{
          id: "owned-evidence-1",
          evidenceId: "evidence-1",
          title: "Fotografia",
          description: "Uma silhueta",
          image: "foto.jpg"
        }],
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
        evidence: [],
        _order: 1
      });
      await setDoc(doc(db, "campaigns", "room-1", "players", "player-private"), {
        id: "player-private",
        name: "Bruno",
        email: "bruno@example.com",
        emailNormalized: "bruno@example.com",
        authUid: "second-auth",
        characterId: "char-private",
        status: "claimed",
        online: true,
        lastSeen: new Date().toISOString(),
        joinedAt: new Date().toISOString(),
        _order: 1
      });
      await setDoc(doc(db, "campaigns", "room-1", "characters", "char-private"), {
        id: "char-private",
        name: "Orion",
        origin: "Cacador",
        controllerPlayerId: "player-private",
        health: 10,
        healthMax: 10,
        sanity: 8,
        sanityMax: 8,
        skills: [],
        inventory: [],
        evidence: [],
        _order: 2
      });
      await setDoc(doc(db, "campaigns", "room-1", "evidence", "evidence-1"), {
        id: "evidence-1",
        title: "Fotografia",
        description: "Uma silhueta",
        image: "foto.jpg",
        _order: 0
      });
    });

    const prepared = testEnv.authenticatedContext("player-auth", { email: "ana@example.com" }).firestore();
    const outsider = testEnv.authenticatedContext("outsider-auth", { email: "outsider@example.com" }).firestore();
    const master = testEnv.authenticatedContext("master-auth", { email: "master@example.com" }).firestore();
    const second = testEnv.authenticatedContext("second-auth", { email: "bruno@example.com" }).firestore();
    const observer = testEnv.authenticatedContext("observer-auth", { email: "observer@example.com" }).firestore();

    await assertSucceeds(runTransaction(master, async transaction => {
      const campaignRef = doc(master, "campaigns", "room-1");
      const legacySceneRef = doc(master, "campaigns", "room-1", "scenes", "legacy-scene");
      const campaignSnapshot = await transaction.get(campaignRef);
      const legacySceneSnapshot = await transaction.get(legacySceneRef);
      if (!campaignSnapshot.exists() || legacySceneSnapshot.exists()) throw new Error("Fixture de compatibilidade invalida.");
      const legacyScene = campaignSnapshot.data().scenes[0];
      transaction.set(legacySceneRef, { ...legacyScene, _order: 0 });
      transaction.update(campaignRef, {
        scenes: deleteField(),
        storageLayoutMigration: {
          version: 1,
          completedAt: new Date().toISOString(),
          movedCollections: ["scenes"],
          movedDocuments: 1,
          verified: true
        },
        updatedAt: new Date().toISOString()
      });
    }));
    await assertSucceeds(getDoc(doc(master, "campaigns", "room-1", "scenes", "legacy-scene")));
    await assertFails(getDoc(doc(prepared, "campaigns", "room-1", "scenes", "legacy-scene")));

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

    const traumaCatalog = [{
      id: "catalog-trauma-1",
      title: "Aracnofobia",
      image: "aranha.jpg",
      createdAt: new Date().toISOString()
    }];
    await assertFails(updateDoc(doc(prepared, "campaigns", "room-1"), {
      traumaCatalog,
      updatedAt: new Date().toISOString()
    }));
    await assertSucceeds(updateDoc(doc(master, "campaigns", "room-1"), {
      traumaCatalog,
      updatedAt: new Date().toISOString()
    }));

    const privateMessage = {
      id: "private-message-1",
      threadId: "player-1::player-private",
      conversationType: "players",
      participantPlayerIds: ["player-1", "player-private"],
      participantCharacterIds: ["char-1", "char-private"],
      participantAuthUids: ["player-auth", "second-auth"],
      participantOrigins: ["Medica", "Cacador"],
      authorId: "player-auth",
      authorRole: "player",
      authorPlayerId: "player-1",
      authorCharacterId: "char-1",
      authorOrigin: "Medica",
      text: "Encontre-me na floresta.",
      time: "12:00",
      sentAt: new Date().toISOString(),
      _order: -1
    };
    const senderCopy = { ...privateMessage, accessUid: "player-auth" };
    const recipientCopy = { ...privateMessage, accessUid: "second-auth" };
    const senderCopyId = `${privateMessage.id}--player-auth`;
    const recipientCopyId = `${privateMessage.id}--second-auth`;
    await assertSucceeds(setDoc(
      doc(prepared, "campaigns", "room-1", "privateMessages", senderCopyId),
      senderCopy
    ));
    await assertSucceeds(setDoc(
      doc(prepared, "campaigns", "room-1", "privateMessages", recipientCopyId),
      recipientCopy
    ));
    await assertSucceeds(getDoc(doc(second, "campaigns", "room-1", "privateMessages", recipientCopyId)));
    await assertSucceeds(getDoc(doc(master, "campaigns", "room-1", "privateMessages", senderCopyId)));
    await assertFails(getDoc(doc(observer, "campaigns", "room-1", "privateMessages", senderCopyId)));
    await assertSucceeds(getDocs(query(
      collection(prepared, "campaigns", "room-1", "privateMessages"),
      where("accessUid", "==", "player-auth")
    )));
    await assertSucceeds(getDocs(query(
      collection(second, "campaigns", "room-1", "privateMessages"),
      where("accessUid", "==", "second-auth")
    )));
    await assertSucceeds(getDocs(collection(master, "campaigns", "room-1", "privateMessages")));
    await assertFails(getDocs(collection(observer, "campaigns", "room-1", "privateMessages")));

    const masterPrivateMessage = {
      id: "master-private-message-1",
      threadId: "master::player-1",
      conversationType: "master-player",
      participantPlayerIds: ["player-1"],
      participantCharacterIds: ["char-1"],
      participantAuthUids: ["master-auth", "player-auth"],
      participantOrigins: ["Mestre", "Medica"],
      accessUid: "player-auth",
      authorId: "master-auth",
      authorRole: "master",
      authorPlayerId: "",
      authorCharacterId: "",
      authorOrigin: "Mestre",
      text: "Somente voce percebeu a criatura.",
      time: "12:00",
      sentAt: new Date().toISOString(),
      _order: -1
    };
    const masterPrivateMessageId = `${masterPrivateMessage.id}--player-auth`;
    await assertSucceeds(setDoc(
      doc(master, "campaigns", "room-1", "privateMessages", masterPrivateMessageId),
      masterPrivateMessage
    ));
    await assertSucceeds(getDoc(doc(prepared, "campaigns", "room-1", "privateMessages", masterPrivateMessageId)));
    await assertFails(getDoc(doc(second, "campaigns", "room-1", "privateMessages", masterPrivateMessageId)));

    const playerReply = {
      ...masterPrivateMessage,
      id: "master-private-message-reply",
      authorId: "player-auth",
      authorRole: "player",
      authorPlayerId: "player-1",
      authorCharacterId: "char-1",
      authorOrigin: "Medica",
      text: "Vou observar com cuidado."
    };
    await assertSucceeds(setDoc(
      doc(prepared, "campaigns", "room-1", "privateMessages", `${playerReply.id}--player-auth`),
      playerReply
    ));

    await assertSucceeds(setDoc(doc(prepared, "campaigns", "room-1", "messages", "public-message-1"), {
      id: "public-message-1",
      author: "Ana",
      authorId: "player-auth",
      playerId: "player-1",
      text: "Mensagem publica",
      time: "12:00",
      sentAt: new Date().toISOString(),
      _order: -1
    }));

    const diceRoll = {
      id: "dice-roll-1",
      author: "Medica",
      authorId: "player-auth",
      playerId: "player-1",
      characterId: "char-1",
      rollerRole: "player",
      origin: "Medica",
      sides: 20,
      die: 17,
      bonus: 0,
      bonusText: "",
      total: 17,
      label: "",
      time: "12:00",
      createdAt: new Date().toISOString(),
      _order: -1
    };
    await assertSucceeds(setDoc(
      doc(prepared, "campaigns", "room-1", "diceLogs", diceRoll.id),
      diceRoll
    ));
    await assertSucceeds(getDoc(doc(master, "campaigns", "room-1", "diceLogs", diceRoll.id)));
    await assertSucceeds(getDoc(doc(second, "campaigns", "room-1", "diceLogs", diceRoll.id)));
    await assertFails(getDoc(doc(outsider, "campaigns", "room-1", "diceLogs", diceRoll.id)));
    await assertFails(setDoc(
      doc(prepared, "campaigns", "room-1", "diceLogs", "dice-roll-forged"),
      { ...diceRoll, id: "dice-roll-forged", authorId: "master-auth" }
    ));

    await assertSucceeds(updateDoc(doc(master, "campaigns", "room-1"), {
      chatSettings: {
        publicEnabled: false,
        privateEnabled: false,
        privateThreads: { [masterPrivateMessage.threadId]: true }
      },
      updatedAt: new Date().toISOString()
    }));
    await assertFails(setDoc(doc(prepared, "campaigns", "room-1", "messages", "public-message-blocked"), {
      id: "public-message-blocked",
      author: "Ana",
      authorId: "player-auth",
      playerId: "player-1",
      text: "Nao deve entrar",
      time: "12:01",
      sentAt: new Date().toISOString(),
      _order: -2
    }));
    await assertSucceeds(setDoc(doc(master, "campaigns", "room-1", "privateMessages", "master-private-message-released--player-auth"), {
      ...masterPrivateMessage,
      id: "master-private-message-released",
      accessUid: "player-auth",
      text: "Somente esta conversa foi liberada"
    }));
    await assertFails(setDoc(doc(prepared, "campaigns", "room-1", "privateMessages", "private-message-still-blocked--player-auth"), {
      ...privateMessage,
      id: "private-message-still-blocked",
      accessUid: "player-auth",
      text: "As conversas entre jogadores continuam bloqueadas"
    }));
    await assertFails(setDoc(doc(master, "campaigns", "room-1", "privateMessages", "master-second-player-blocked--second-auth"), {
      ...masterPrivateMessage,
      id: "master-second-player-blocked",
      threadId: "master::player-private",
      participantPlayerIds: ["player-private"],
      participantCharacterIds: ["char-private"],
      participantAuthUids: ["master-auth", "second-auth"],
      participantOrigins: ["Mestre", "Cacador"],
      accessUid: "second-auth",
      text: "A outra conversa com o Mestre continua bloqueada"
    }));
    await assertSucceeds(updateDoc(doc(master, "campaigns", "room-1"), {
      chatSettings: {
        publicEnabled: true,
        privateEnabled: true,
        privateThreads: { [masterPrivateMessage.threadId]: false }
      },
      updatedAt: new Date().toISOString()
    }));
    await assertFails(setDoc(doc(master, "campaigns", "room-1", "privateMessages", "master-private-message-blocked--player-auth"), {
      ...masterPrivateMessage,
      id: "master-private-message-blocked",
      accessUid: "player-auth",
      text: "Esta conversa individual foi bloqueada"
    }));
    await assertSucceeds(setDoc(doc(prepared, "campaigns", "room-1", "privateMessages", "private-message-default-enabled--player-auth"), {
      ...privateMessage,
      id: "private-message-default-enabled",
      accessUid: "player-auth",
      text: "As demais conversas seguem a configuracao geral"
    }));
    await assertSucceeds(updateDoc(doc(master, "campaigns", "room-1"), {
      chatSettings: { publicEnabled: true, privateEnabled: true, privateThreads: {} },
      updatedAt: new Date().toISOString()
    }));

    await assertFails(updateDoc(doc(prepared, "campaigns", "room-1", "characters", "char-1"), {
      inventory: [{ id: "forged", name: "Item forjado", quantity: 1 }]
    }));

    await assertFails(updateDoc(doc(prepared, "campaigns", "room-1", "characters", "char-1"), {
      appliedOriginLoadouts: ["Medica"]
    }));

    await assertFails(updateDoc(doc(prepared, "campaigns", "room-1", "characters", "char-1"), {
      evidence: [{ id: "forged-evidence", evidenceId: "evidence-1", title: "Evidencia forjada" }]
    }));

    await assertFails(updateDoc(doc(prepared, "campaigns", "room-1", "characters", "char-1"), {
      traumas: [{ id: "forged-trauma", title: "Trauma forjado" }]
    }));

    await assertFails(updateDoc(doc(prepared, "campaigns", "room-1", "characters", "char-1"), {
      expressions: [{ id: "forged-expression", title: "Furioso", image: "furioso.jpg" }],
      activeExpression: "forged-expression"
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

    await assertSucceeds(setDoc(doc(prepared, "campaigns", "room-1", "itemTransfers", "evidence-transfer-1"), {
      id: "evidence-transfer-1",
      fromPlayerId: "player-1",
      fromCharacterId: "char-1",
      toCharacterId: "char-2",
      type: "evidence",
      evidenceEntryId: "owned-evidence-1",
      evidenceId: "evidence-1",
      itemName: "Fotografia",
      status: "pending",
      _order: 2
    }));

    await assertFails(setDoc(doc(prepared, "campaigns", "room-1", "itemTransfers", "evidence-transfer-legacy"), {
      id: "evidence-transfer-legacy",
      fromPlayerId: "player-1",
      fromCharacterId: "char-1",
      toCharacterId: "char-2",
      type: "evidence",
      itemName: "Sem vinculo comprovado",
      status: "pending",
      _order: 3
    }));

    await assertFails(setDoc(doc(prepared, "campaigns", "room-1", "itemTransfers", "evidence-transfer-self"), {
      id: "evidence-transfer-self",
      fromPlayerId: "player-1",
      fromCharacterId: "char-1",
      toCharacterId: "char-1",
      type: "evidence",
      evidenceEntryId: "owned-evidence-1",
      evidenceId: "evidence-1",
      itemName: "Fotografia",
      status: "pending",
      _order: 4
    }));

    await assertFails(updateDoc(doc(prepared, "campaigns", "room-1", "itemTransfers", "transfer-1"), {
      status: "approved"
    }));

    await assertSucceeds(updateDoc(doc(master, "campaigns", "room-1", "itemTransfers", "transfer-1"), {
      status: "approved",
      resolvedBy: "master-auth"
    }));

    await assertSucceeds(updateDoc(doc(master, "campaigns", "room-1", "characters", "char-1"), {
      inventory: [{ id: "inv-1", name: "Pocao", quantity: 1 }],
      appliedOriginLoadouts: ["Medica"]
    }));

    await assertSucceeds(updateDoc(doc(master, "campaigns", "room-1", "characters", "char-1"), {
      expressions: [{ id: "expression-tense", title: "Tenso", image: "tenso.jpg" }],
      activeExpression: "expression-tense",
      expressionUpdatedAt: new Date().toISOString()
    }));

    await assertSucceeds(runTransaction(master, async transaction => {
      const eventTime = new Date().toISOString();
      transaction.update(doc(master, "campaigns", "room-1", "characters", "char-1"), {
        traumas: [{
          id: "trauma-1",
          catalogId: "catalog-trauma-1",
          title: "Aracnofobia",
          description: "Medo intenso de aranhas.",
          image: "aranha.jpg",
          acquiredAt: eventTime
        }],
        traumasUpdatedAt: eventTime
      });
      transaction.update(doc(master, "campaigns", "room-1"), {
        updatedAt: eventTime,
        latestTraumaEvent: {
          id: "event-1",
          origin: "Medica",
          traumaTitle: "Aracnofobia",
          createdAt: eventTime
        }
      });
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
    await assertSucceeds(setDoc(doc(master, "campaigns", "room-1", "sceneTrash", "scene-trash-1"), {
      id: "scene-trash-1",
      title: "Cena removida",
      image: "https://example.com/scene-trash.jpg",
      masterNotes: "Continua privada",
      deletedAt: new Date().toISOString(),
      _order: -1
    }));

    await assertFails(getDoc(doc(prepared, "campaigns", "room-1", "scenes", "scene-1")));
    await assertSucceeds(getDoc(doc(master, "campaigns", "room-1", "scenes", "scene-1")));
    await assertFails(getDoc(doc(prepared, "campaigns", "room-1", "sceneTrash", "scene-trash-1")));
    await assertSucceeds(getDoc(doc(master, "campaigns", "room-1", "sceneTrash", "scene-trash-1")));
    await assertFails(getDoc(doc(prepared, "campaigns", "room-1", "evidence", "evidence-1")));
    await assertSucceeds(getDoc(doc(master, "campaigns", "room-1", "evidence", "evidence-1")));

    const loadCampaignId = "six-client-room";
    const loadPlayerUids = Array.from({ length: 5 }, (_, index) => `load-player-${index + 1}`);
    const cloudinaryBase = "https://res.cloudinary.com/sbyfm34m/image/upload/v1/site-rpg-teste";
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      const batch = writeBatch(db);
      batch.set(doc(db, "campaigns", loadCampaignId), {
        id: loadCampaignId,
        masterId: "master-auth",
        members: ["master-auth", ...loadPlayerUids],
        name: "Mesa com seis clientes",
        gameBoard: { image: `${cloudinaryBase}/boards/board-0.jpg`, revision: 0 },
        previousGameBoard: null,
        liveScene: { active: false, sceneId: null, image: "", index: -1, total: 40, revision: 0 },
        updatedAt: new Date().toISOString()
      });
      loadPlayerUids.forEach((uid, index) => {
        const playerId = `player-${index + 1}`;
        const characterId = `character-${index + 1}`;
        batch.set(doc(db, "campaigns", loadCampaignId, "players", playerId), {
          id: playerId,
          authUid: uid,
          email: `${uid}@example.com`,
          emailNormalized: `${uid}@example.com`,
          characterId,
          status: "claimed",
          online: true,
          _order: index
        });
        batch.set(doc(db, "campaigns", loadCampaignId, "characters", characterId), {
          id: characterId,
          controllerPlayerId: playerId,
          name: `Personagem ${index + 1}`,
          health: 10,
          healthMax: 10,
          sanity: 8,
          sanityMax: 8,
          inventory: [],
          evidence: [],
          traumas: [],
          expressions: [],
          _order: index
        });
      });
      Array.from({ length: 40 }, (_, index) => {
        batch.set(doc(db, "campaigns", loadCampaignId, "scenes", `scene-${index + 1}`), {
          id: `scene-${index + 1}`,
          title: `Cena ${index + 1}`,
          image: `${cloudinaryBase}/scenes/scene-${index + 1}.jpg`,
          masterNotes: `Nota privada ${index + 1}`,
          _order: index
        });
      });
      await batch.commit();
    });

    const loadMaster = testEnv.authenticatedContext("master-auth", { email: "master@example.com" }).firestore();
    const loadPlayers = loadPlayerUids.map(uid => (
      testEnv.authenticatedContext(uid, { email: `${uid}@example.com` }).firestore()
    ));
    const seenScenes = loadPlayers.map(() => new Set());
    const seenBoards = loadPlayers.map(() => new Set());
    const seenVitals = loadPlayers.map(() => new Set());
    const listenerErrors = [];
    const unsubs = [];

    loadPlayers.forEach((playerDb, index) => {
      unsubs.push(onSnapshot(doc(playerDb, "campaigns", loadCampaignId), snapshot => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();
        if (Number.isInteger(data.liveScene?.index) && data.liveScene.index >= 0) {
          seenScenes[index].add(data.liveScene.index);
        }
        if (data.gameBoard?.image) seenBoards[index].add(data.gameBoard.image);
      }, error => listenerErrors.push(error)));
      unsubs.push(onSnapshot(
        doc(playerDb, "campaigns", loadCampaignId, "characters", `character-${index + 1}`),
        snapshot => {
          if (!snapshot.exists()) return;
          const data = snapshot.data();
          seenVitals[index].add(`${data.health}:${data.sanity}`);
        },
        error => listenerErrors.push(error)
      ));
    });

    try {
      await waitUntil(
        () => seenBoards.every(entries => entries.has(`${cloudinaryBase}/boards/board-0.jpg`)),
        "os cinco jogadores receberem o tabuleiro inicial"
      );
      assert.equal((await getDocs(collection(loadMaster, "campaigns", loadCampaignId, "scenes"))).size, 40);
      for (const playerDb of loadPlayers) {
        await assertFails(getDocs(collection(playerDb, "campaigns", loadCampaignId, "scenes")));
      }

      for (let index = 0; index < 40; index += 1) {
        await updateDoc(doc(loadMaster, "campaigns", loadCampaignId), {
          liveScene: {
            active: true,
            sceneId: `scene-${index + 1}`,
            image: `${cloudinaryBase}/scenes/scene-${index + 1}.jpg`,
            index,
            total: 40,
            revision: index + 1,
            updatedAt: new Date().toISOString()
          },
          updatedAt: new Date().toISOString()
        });
        await waitUntil(
          () => seenScenes.every(entries => entries.has(index)),
          `os cinco jogadores receberem a cena ${index + 1}`
        );
      }
      assert.ok(seenScenes.every(entries => entries.size === 40));

      for (let revision = 1; revision <= 25; revision += 1) {
        const nextBoard = `${cloudinaryBase}/boards/board-${revision}.jpg`;
        await runTransaction(loadMaster, async transaction => {
          const campaignRef = doc(loadMaster, "campaigns", loadCampaignId);
          const snapshot = await transaction.get(campaignRef);
          transaction.update(campaignRef, {
            previousGameBoard: snapshot.data().gameBoard,
            gameBoard: { image: nextBoard, revision },
            updatedAt: new Date().toISOString()
          });
        });
        await waitUntil(
          () => seenBoards.every(entries => entries.has(nextBoard)),
          `os cinco jogadores receberem o tabuleiro ${revision}`
        );
      }

      for (let index = 0; index < 5; index += 1) {
        const characterRef = doc(loadMaster, "campaigns", loadCampaignId, "characters", `character-${index + 1}`);
        const health = 9 - index;
        const sanity = 7 - index;
        await updateDoc(characterRef, {
          health,
          sanity,
          inventory: [{
            id: `inventory-${index + 1}`,
            name: "Lanterna",
            quantity: 1,
            image: `${cloudinaryBase}/items/lanterna.jpg`
          }],
          evidence: [{
            id: `owned-evidence-${index + 1}`,
            evidenceId: "evidence-1",
            title: "Fotografia",
            image: `${cloudinaryBase}/evidence/fotografia.jpg`
          }],
          traumas: [{
            id: `owned-trauma-${index + 1}`,
            catalogId: "trauma-1",
            title: "Aracnofobia",
            image: `${cloudinaryBase}/traumas/aranha.jpg`
          }],
          expressions: [{
            id: `expression-${index + 1}`,
            title: "Tenso",
            image: `${cloudinaryBase}/expressions/tenso.jpg`
          }]
        });
        await waitUntil(
          () => seenVitals[index].has(`${health}:${sanity}`),
          `o jogador ${index + 1} receber saude e sanidade`
        );
      }

      for (let index = 0; index < 5; index += 1) {
        const refreshed = await getDoc(doc(
          loadPlayers[index],
          "campaigns",
          loadCampaignId,
          "characters",
          `character-${index + 1}`
        ));
        const data = refreshed.data();
        assert.equal(data.health, 9 - index);
        assert.equal(data.sanity, 7 - index);
        assert.equal(data.inventory.length, 1);
        assert.equal(data.evidence.length, 1);
        assert.equal(data.traumas.length, 1);
        assert.equal(data.expressions.length, 1);
        assert.match(data.inventory[0].image, /^https:\/\/res\.cloudinary\.com\/sbyfm34m\//);
      }

      const finalCampaign = (await getDoc(doc(loadMaster, "campaigns", loadCampaignId))).data();
      assert.equal(finalCampaign.masterId, "master-auth");
      assert.deepEqual(finalCampaign.members, ["master-auth", ...loadPlayerUids]);
      assert.equal(finalCampaign.liveScene.index, 39);
      assert.equal(finalCampaign.gameBoard.revision, 25);
      assert.equal(finalCampaign.previousGameBoard.revision, 24);
      assert.equal(listenerErrors.length, 0);
      console.log("Six-client session: 40 scenes, 25 boards and persistent progress passed.");
    } finally {
      unsubs.forEach(unsubscribe => unsubscribe());
    }

    console.log("Firestore rules: permission checks passed.");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
