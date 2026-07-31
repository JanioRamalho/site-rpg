const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const tabletop = require("../js/game/tabletop-model.js");

function createAppContext() {
  const bodyChildren = [];
  const timeouts = [];
  const root = {
    innerHTML: "",
    insertAdjacentHTML(_position, html) {
      this.innerHTML += html;
    }
  };
  const storage = new Map();
  const createElement = tagName => {
    const element = {
      tagName: String(tagName).toUpperCase(),
      children: [],
      className: "",
      id: "",
      innerHTML: "",
      textContent: "",
      isConnected: false,
      attributes: {},
      appendChild(child) {
        child.isConnected = true;
        this.children.push(child);
      },
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
      remove() {
        this.isConnected = false;
        const index = bodyChildren.indexOf(this);
        if (index >= 0) bodyChildren.splice(index, 1);
      }
    };
    return element;
  };
  const document = {
    body: {
      appendChild(element) {
        element.isConnected = true;
        bodyChildren.push(element);
      }
    },
    addEventListener() {},
    createElement,
    getElementById(id) {
      return id === "root" ? root : null;
    },
    querySelector(selector) {
      if (/^\.[a-z0-9-]+$/i.test(selector)) {
        const className = selector.slice(1);
        return bodyChildren.find(element => String(element.className).split(/\s+/).includes(className)) || null;
      }
      return null;
    },
    querySelectorAll() { return []; }
  };
  const window = {
    CDIFirebase: null,
    CDITabletop: tabletop,
    addEventListener() {}
  };
  const context = vm.createContext({
    window,
    document,
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    },
    navigator: {},
    console,
    alert() {},
    confirm() { return true; },
    prompt() {},
    setTimeout(_callback, delay) {
      timeouts.push(delay);
      return timeouts.length;
    },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    Date,
    Map,
    Set,
    Math,
    JSON,
    Number,
    String,
    Array,
    Object,
    Boolean,
    Promise
  });
  window.window = window;
  const source = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
  vm.runInContext(source, context, { filename: "script.js" });
  return { bodyChildren, context, root, storage, timeouts };
}

function seedCampaign(context) {
  vm.runInContext(`
    state = {
      masters: [{ id: "master-1", name: "Mestre" }],
      campaigns: [{
        id: "campaign-1",
        masterId: "master-1",
        name: "Mesa de teste",
        password: "secret",
        members: ["master-1", "auth-1"],
        players: [
          { id: "player-1", name: "Ana", email: "ana@example.com", authUid: "auth-1", characterId: "char-1", online: true, lastSeen: new Date().toISOString() },
          { id: "player-2", name: "Bruno", email: "bruno@example.com", authUid: null, characterId: "char-2" }
        ],
        characters: [
          { id: "char-1", name: "Morgana", origin: "Medica", image: "portrait-1.jpg", health: 10, healthMax: 10, sanity: 8, sanityMax: 8, attrs: {}, res: {}, skills: [], inventory: [{ id: "inv-1", itemId: "item-1", name: "Pocao", description: "Recupera vida", image: "pocao.jpg", quantity: 2 }], evidence: [{ id: "owned-evidence-1", evidenceId: "evidence-1", title: "Fotografia antiga", description: "Uma silhueta aparece ao fundo.", image: "evidence-photo.jpg", grantedAt: "2026-07-31T12:00:00.000Z" }], traumas: [{ id: "trauma-1", catalogId: "catalog-trauma-1", title: "Aracnofobia", description: "Medo intenso de aranhas.", image: "aranha.jpg", acquiredAt: "2026-07-30T21:45:00.000Z" }], expressions: [{ id: "expression-happy", title: "Felicidade", image: "happy.jpg", createdAt: "2026-07-31T10:00:00.000Z" }, { id: "expression-tense", title: "Tenso", image: "tense.jpg", createdAt: "2026-07-31T10:01:00.000Z" }], activeExpression: "expression-tense" },
          { id: "char-2", name: "Orion", origin: "Cacador", health: 10, healthMax: 10, sanity: 8, sanityMax: 8, attrs: {}, res: {}, skills: [], inventory: [], evidence: [], traumas: [{ id: "trauma-2", catalogId: "catalog-trauma-2", title: "Claustrofobia", description: "Medo de lugares fechados.", image: "tunel.jpg", acquiredAt: "2026-07-30T21:46:00.000Z" }], expressions: [], activeExpression: "" }
        ],
        traumaCatalog: [
          { id: "catalog-trauma-1", title: "Aracnofobia", image: "aranha.jpg", createdAt: "2026-07-30T20:00:00.000Z" },
          { id: "catalog-trauma-2", title: "Claustrofobia", image: "tunel.jpg", createdAt: "2026-07-30T20:01:00.000Z" }
        ],
        items: [{ id: "shared-1", name: "Mapa da mesa", description: "Compartilhado", revealed: true }],
        evidence: [
          { id: "evidence-1", title: "Fotografia antiga", description: "Uma silhueta aparece ao fundo.", image: "evidence-photo.jpg", createdAt: "2026-07-31T11:00:00.000Z" },
          { id: "evidence-2", title: "Bilhete cifrado", description: "Uma mensagem ainda não decifrada.", image: "evidence-note.jpg", createdAt: "2026-07-31T11:01:00.000Z" }
        ], messages: [], diceLogs: [], itemTransfers: [], cases: [], creatures: [], marks: [],
        gameBoard: { image: "board.jpg", updatedAt: "2026-07-30T00:00:00.000Z" },
        scenes: [
          { id: "scene-1", title: "Portao", caption: "O portao se abre", masterNotes: "Armadilha privada", image: "scene-1.jpg" },
          { id: "scene-2", title: "Corredor futuro", caption: "Ainda oculto", masterNotes: "Monstro escondido", image: "scene-2.jpg" }
        ],
        liveScene: { active: true, sceneId: "scene-1", image: "scene-1.jpg", title: "Portao", caption: "O portao se abre", index: 0, total: 2 }
      }]
    };
    normalizeState();
  `, context);
}

test("renders the master controls for links and individual inventories", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    session = { role: "master", campaign: state.campaigns[0], player: null, currentMaster: state.masters[0], view: "players" };
    render();
  `, context);

  assert.match(root.innerHTML, /Game/);
  assert.match(root.innerHTML, /Morgana/);
  assert.match(root.innerHTML, /Convite pendente/);
  assert.match(root.innerHTML, /Gerenciar Inventario/);

  vm.runInContext(`manageCharacterInventoryModal("char-1")`, context);
  assert.match(root.innerHTML, /Adicionar item livremente/);
  assert.match(root.innerHTML, /inventoryCustomName/);
  assert.match(root.innerHTML, /id="inventoryCustomImage"[^>]*required/);
  assert.match(root.innerHTML, /cadastro incompleto/);
  assert.match(root.innerHTML, /Adicionar ao inventario/);
});

test("requires title, description and image when the master creates an item", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    session = { role: "master", campaign: state.campaigns[0], player: null, currentMaster: state.masters[0], view: "items" };
    itemModal();
  `, context);

  assert.match(root.innerHTML, /id="itname"[^>]*required/);
  assert.match(root.innerHTML, /id="itdesc"[^>]*required/);
  assert.match(root.innerHTML, /id="itimg"[^>]*required/);
  assert.doesNotMatch(root.innerHTML, /id="itrev"|Visível para Jogadores/);
});

test("renders a compact reusable item catalog without categories", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    state.campaigns[0].items = [
      { id: "lanterna", name: "Lanterna", description: "Ilumina corredores escuros", image: "lanterna.jpg" },
      { id: "faca", name: "Faca de cacada", description: "Lamina resistente", image: "faca.jpg" }
    ];
    normalizeState();
    session = { role: "master", campaign: state.campaigns[0], player: null, currentMaster: state.masters[0], view: "items" };
    render();
  `, context);

  assert.match(root.innerHTML, /item-catalog-grid/);
  assert.equal((root.innerHTML.match(/item-catalog-card/g) || []).length, 2);
  assert.match(root.innerHTML, /item-catalog-thumbnail entity-visual-image" src="lanterna.jpg"/);
  assert.match(root.innerHTML, /Kits de origem/);
  assert.match(root.innerHTML, /Cadastrar item/);
  assert.match(root.innerHTML, /Adicionar/);
  assert.doesNotMatch(root.innerHTML, /categoria|arremessavel|Visível para jogadores/i);

  const css = fs.readFileSync(path.join(__dirname, "..", "style.css"), "utf8");
  assert.match(css, /\.item-catalog-grid\s*\{[^}]*minmax\(230px, 250px\)/s);
  assert.match(css, /\.item-catalog-thumbnail\s*\{[^}]*width:\s*72px;[^}]*height:\s*72px/s);
});

test("configures origin kit quantities and applies them from the inventory manager", async () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    state.campaigns[0].items = [
      { id: "lanterna", name: "Lanterna", description: "Ilumina corredores", image: "lanterna.jpg" },
      { id: "agua-benta", name: "Agua benta", description: "Protecao ritual", image: "agua.jpg" }
    ];
    state.campaigns[0].originLoadouts = {
      Padre: [
        { itemId: "lanterna", quantity: 1 },
        { itemId: "agua-benta", quantity: 2 }
      ]
    };
    state.campaigns[0].characters.find(character => character.id === "char-2").origin = "Padre";
    normalizeState();
    session = { role: "master", campaign: state.campaigns[0], player: null, currentMaster: state.masters[0], view: "characters" };
    originLoadoutsModal("Padre");
  `, context);

  assert.match(root.innerHTML, /Kits iniciais por origem/);
  assert.match(root.innerHTML, /data-item-id="lanterna"[^>]*value="1"|value="1"[^>]*data-item-id="lanterna"/);
  assert.match(root.innerHTML, /data-item-id="agua-benta"[^>]*value="2"|value="2"[^>]*data-item-id="agua-benta"/);

  vm.runInContext(`manageCharacterInventoryModal("char-2")`, context);
  assert.match(root.innerHTML, /KIT DE ORIGEM/);
  assert.match(root.innerHTML, /Aplicar kit inicial/);
  assert.match(root.innerHTML, /Lanterna/);

  await vm.runInContext(`applyOriginLoadoutToCharacter("char-2")`, context);
  const result = JSON.parse(vm.runInContext(`JSON.stringify({
    inventory: state.campaigns[0].characters.find(character => character.id === "char-2").inventory,
    applied: state.campaigns[0].characters.find(character => character.id === "char-2").appliedOriginLoadouts
  })`, context));
  assert.deepEqual(result.inventory.map(item => [item.itemId, item.quantity]), [
    ["lanterna", 1],
    ["agua-benta", 2]
  ]);
  assert.deepEqual(result.applied, ["Padre"]);
  assert.match(root.innerHTML, /Aplicar novamente/);
});

test("offers and applies the configured origin kit when creating a character", async () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    state.campaigns[0].items = [
      { id: "radio", name: "Radio", description: "Comunicacao de campo", image: "radio.jpg" }
    ];
    state.campaigns[0].originLoadouts = { Policial: [{ itemId: "radio", quantity: 1 }] };
    normalizeState();
    session = { role: "master", campaign: state.campaigns[0], player: null, currentMaster: state.masters[0], view: "characters" };
    characterModal();
  `, context);

  assert.match(root.innerHTML, /id="applyOriginKitOnCreate"[^>]*checked/);
  assert.match(root.innerHTML, /Aplicar kit inicial da origem/);

  await vm.runInContext(`
    (() => {
      const originalGetElementById = document.getElementById.bind(document);
      const originalQuerySelector = document.querySelector.bind(document);
      const fields = {
        cname: { value: "Nova personagem" },
        origin: { value: "Policial" },
        hm: { value: "20" }, hv: { value: "20" },
        sm: { value: "10" }, sv: { value: "10" },
        cdef: { value: "10" },
        photo: { files: [] },
        applyOriginKitOnCreate: { checked: true }
      };
      ATTR.forEach(name => { fields["a_" + name] = { value: "0" }; });
      RES.forEach(name => { fields["r_" + name] = { value: "0" }; });
      document.getElementById = id => fields[id] || originalGetElementById(id);
      document.querySelector = selector => selector === ".modal" ? { remove() {} } : originalQuerySelector(selector);
      return saveCharacter(null);
    })()
  `, context);

  const created = JSON.parse(vm.runInContext(`JSON.stringify(state.campaigns[0].characters.at(-1))`, context));
  assert.equal(created.name, "Nova personagem");
  assert.deepEqual(created.inventory.map(item => [item.itemId, item.quantity]), [["radio", 1]]);
  assert.deepEqual(created.appliedOriginLoadouts, ["Policial"]);
});

test("renders the shared chat as colored name lines with a crown only for the master", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    state.campaigns[0].messages = [
      { id: "message-master", author: "Janio", authorId: "master-1", text: "Todos prontos?", time: "21:31", sentAt: "2026-07-30T21:31:00.000Z" },
      { id: "message-player", author: "Nome antigo", authorId: "auth-1", playerId: "player-1", text: "Pronta!", time: "21:30", sentAt: "2026-07-30T21:30:00.000Z" }
    ];
    session = { role: "player", campaign: state.campaigns[0], player: state.campaigns[0].players[0], currentMaster: null, view: "messages" };
    render();
  `, context);

  assert.match(root.innerHTML, /\[Ana\]<\/span><span class="chat-colon">:<\/span>\s*<span class="chat-message-text">Pronta!<\/span>/);
  assert.match(root.innerHTML, /\[Janio <span class="chat-master-crown"[^>]*>&#9819;<\/span>\]<\/span><span class="chat-colon">:<\/span>/);
  assert.equal((root.innerHTML.match(/chat-master-crown/g) || []).length, 1);

  const authorColors = Array.from(root.innerHTML.matchAll(/class="chat-author" style="--chat-author-color:([^"]+)"/g), match => match[1]);
  assert.equal(authorColors.length, 2);
  assert.equal(new Set(authorColors).size, 2);

  vm.runInContext(`
    session.view = "room";
    render();
  `, context);
  assert.doesNotMatch(root.innerHTML, /Todos prontos\?|Pronta!/);
});

test("sends chat text through the dedicated realtime message API", async () => {
  const { context } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    const originalGetElementById = document.getElementById.bind(document);
    document.getElementById = id => id === "msgText"
      ? { value: "  Ola, mesa!  ", focus() {} }
      : originalGetElementById(id);
    window.CDIFirebase = {
      enabled: true,
      currentUser: { uid: "auth-1" },
      async sendCampaignMessage(campaignId, message) {
        window.__chatWrite = { campaignId, message };
        return message;
      }
    };
    firebaseUser = { uid: "auth-1", email: "ana@example.com" };
    session = { role: "player", campaign: state.campaigns[0], player: state.campaigns[0].players[0], currentMaster: null, view: "messages" };
    window.__chatSendPromise = sendMessage();
  `, context);

  await context.window.__chatSendPromise;
  assert.equal(context.window.__chatWrite.campaignId, "campaign-1");
  assert.equal(context.window.__chatWrite.message.author, "Ana");
  assert.equal(context.window.__chatWrite.message.authorId, "auth-1");
  assert.equal(context.window.__chatWrite.message.text, "Ola, mesa!");
  assert.equal(context.window.__chatWrite.message.playerId, "player-1");
});

test("keeps the chat inside a fixed scrollable viewport with a message limit", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    state.campaigns[0].messages = Array.from({ length: 120 }, (_, index) => ({
      id: "message-" + index,
      author: "Ana",
      authorId: "auth-1",
      text: index === 100 ? "OUTSIDE_LIMIT" : "Mensagem " + index,
      time: "12:00",
      sentAt: new Date(Date.now() - index * 1000).toISOString()
    }));
    session = { role: "player", campaign: state.campaigns[0], player: state.campaigns[0].players[0], currentMaster: null, view: "messages" };
    render();
  `, context);

  assert.match(root.innerHTML, /chat-list-wrap/);
  assert.match(root.innerHTML, /id="chatJumpLatest"/);
  assert.match(root.innerHTML, /100\/100 mensagens/);
  assert.doesNotMatch(root.innerHTML, /OUTSIDE_LIMIT/);

  const css = fs.readFileSync(path.join(__dirname, "..", "style.css"), "utf8");
  assert.match(css, /\.chat-panel\s*\{[\s\S]*?height:\s*clamp\(420px, 62vh, 700px\)/);
  assert.match(css, /\.chat-list\s*\{[\s\S]*?overflow-y:\s*auto/);
});

test("shows private contacts by portrait and origin without player or character names", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    const campaign = state.campaigns[0];
    campaign.players[1].authUid = "auth-2";
    campaign.players[1].status = "claimed";
    campaign.players[1].online = true;
    campaign.players[1].lastSeen = new Date().toISOString();
    campaign.characters[1].controllerPlayerId = "player-2";
    campaign.characters[1].image = "portrait-2.jpg";
    campaign.members.push("auth-2");
    session = { role: "player", campaign, player: campaign.players[0], currentMaster: null, view: "messages" };
    render();
  `, context);

  assert.match(root.innerHTML, /chat-contact-card/);
  assert.match(root.innerHTML, /portrait-2\.jpg/);
  assert.match(root.innerHTML, />Cacador<\/span>/);
  assert.doesNotMatch(root.innerHTML, /Orion|Bruno/);

  vm.runInContext(`selectPrivateChat("player-1::player-2")`, context);
  assert.match(root.innerHTML, /Conversa particular · Medica \+ Cacador/);
  assert.match(root.innerHTML, /Escreva uma mensagem particular/);
});

test("sends a private message only with the two character participants", async () => {
  const { context } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    const campaign = state.campaigns[0];
    campaign.players[1].authUid = "auth-2";
    campaign.players[1].status = "claimed";
    campaign.players[1].online = true;
    campaign.players[1].lastSeen = new Date().toISOString();
    campaign.characters[1].controllerPlayerId = "player-2";
    campaign.members.push("auth-2");
    window.CDIFirebase = {
      enabled: true,
      currentUser: { uid: "auth-1" },
      watchPrivateMessages() { return () => {}; },
      async sendPrivateCampaignMessage(campaignId, message) {
        window.__privateChatWrite = { campaignId, message };
        return message;
      }
    };
    firebaseUser = { uid: "auth-1", email: "ana@example.com" };
    session = { role: "player", campaign, player: campaign.players[0], currentMaster: null, view: "messages" };
    render();
    selectPrivateChat("player-1::player-2");
    const originalGetElementById = document.getElementById.bind(document);
    document.getElementById = id => id === "msgText"
      ? { value: "Segredo na floresta", dataset: { chatKey: "campaign-1:private:player-1::player-2" }, focus() {} }
      : originalGetElementById(id);
    window.__privateSendPromise = sendMessage();
  `, context);

  await context.window.__privateSendPromise;
  const write = context.window.__privateChatWrite;
  assert.equal(write.campaignId, "campaign-1");
  assert.deepEqual(Array.from(write.message.participantPlayerIds), ["player-1", "player-2"]);
  assert.deepEqual(Array.from(write.message.participantAuthUids), ["auth-1", "auth-2"]);
  assert.equal(write.message.conversationType, "players");
  assert.equal(write.message.authorOrigin, "Medica");
  assert.equal(write.message.text, "Segredo na floresta");
  assert.equal("author" in write.message, false);
});

test("opens a one-to-one master chat that no second player participates in", async () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    const campaign = state.campaigns[0];
    window.CDIFirebase = {
      enabled: true,
      currentUser: { uid: "auth-1" },
      watchPrivateMessages() { return () => {}; },
      async sendPrivateCampaignMessage(campaignId, message) {
        window.__masterPrivateWrite = { campaignId, message };
        return message;
      }
    };
    firebaseUser = { uid: "auth-1", email: "ana@example.com" };
    session = { role: "player", campaign, player: campaign.players[0], currentMaster: null, view: "messages" };
    render();
    selectPrivateChat("master::player-1");
    const originalGetElementById = document.getElementById.bind(document);
    document.getElementById = id => id === "msgText"
      ? { value: "Vou investigar sozinho", dataset: { chatKey: "campaign-1:private:master::player-1" }, focus() {} }
      : originalGetElementById(id);
    window.__masterPrivateSendPromise = sendMessage();
  `, context);

  assert.match(root.innerHTML, /Conversa particular .* Mestre \+ Medica/);
  await context.window.__masterPrivateSendPromise;
  const write = context.window.__masterPrivateWrite.message;
  assert.equal(write.conversationType, "master-player");
  assert.deepEqual(Array.from(write.participantPlayerIds), ["player-1"]);
  assert.deepEqual(Array.from(write.participantCharacterIds), ["char-1"]);
  assert.deepEqual(Array.from(write.participantAuthUids), ["master-1", "auth-1"]);
  assert.deepEqual(Array.from(write.participantOrigins), ["Mestre", "Medica"]);
});

test("lets the master block all private chats and release only one pair", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    const campaign = state.campaigns[0];
    campaign.players[1].authUid = "auth-2";
    campaign.players[1].status = "claimed";
    campaign.players[1].online = true;
    campaign.players[1].lastSeen = new Date().toISOString();
    campaign.characters[1].controllerPlayerId = "player-2";
    campaign.players.push({
      id: "player-3",
      name: "Carla",
      email: "carla@example.com",
      authUid: "auth-3",
      characterId: "char-3",
      status: "claimed",
      online: true,
      lastSeen: new Date().toISOString()
    });
    campaign.characters.push({
      id: "char-3",
      name: "Luna",
      origin: "Ocultista",
      image: "portrait-3.jpg",
      controllerPlayerId: "player-3",
      health: 10,
      healthMax: 10,
      sanity: 8,
      sanityMax: 8,
      attrs: {},
      res: {},
      skills: [],
      inventory: [],
      traumas: [],
      expressions: [],
      activeExpression: ""
    });
    campaign.members.push("auth-3");
    session = { role: "master", campaign, player: null, currentMaster: state.masters[0], view: "messages" };
    render();
    setChatAvailability("public", false);
    setChatAvailability("private", false);
    setPrivateChatAvailability("master::player-1", true);
    selectPrivateChat("master::player-1");
    window.__releasedChatHtml = document.getElementById("root").innerHTML;
    selectPrivateChat("master::player-2");
    window.__blockedMasterChatHtml = document.getElementById("root").innerHTML;
    selectPrivateChat("player-1::player-2");
    window.__blockedPlayerChatHtml = document.getElementById("root").innerHTML;
    window.__chatSettings = { ...session.campaign.chatSettings };
  `, context);

  assert.equal(context.window.__chatSettings.publicEnabled, false);
  assert.equal(context.window.__chatSettings.privateEnabled, false);
  assert.equal(context.window.__chatSettings.privateThreads["master::player-1"], true);
  assert.doesNotMatch(context.window.__releasedChatHtml, /id="msgText"[^>]*disabled/);
  assert.match(context.window.__blockedMasterChatHtml, /id="msgText"[^>]*disabled/);
  assert.match(context.window.__blockedPlayerChatHtml, /id="msgText"[^>]*disabled/);
  assert.match(root.innerHTML, /Esta conversa foi bloqueada pelo Mestre/);
  assert.match(root.innerHTML, /id="msgText"[^>]*disabled/);
  assert.match(root.innerHTML, /Todas particulares/);
  assert.match(root.innerHTML, /Bloquear conversa entre Mestre e Medica/);
  assert.match(root.innerHTML, /Liberar conversa entre Mestre e Cacador/);
});

test("renders anonymous realtime status cards in the shared game view", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    session = { role: "player", campaign: state.campaigns[0], player: state.campaigns[0].players[0], currentMaster: null, view: "room" };
    render();
  `, context);

  assert.match(root.innerHTML, /Medica/);
  assert.doesNotMatch(root.innerHTML, /Game 01/);
  assert.match(root.innerHTML, /board\.jpg/);
  assert.match(root.innerHTML, /game-board-canvas[\s\S]*board\.jpg[\s\S]*game-card-row[\s\S]*tense\.jpg/);
  assert.doesNotMatch(root.innerHTML, /game-card-row[\s\S]*portrait-1\.jpg/);
  assert.match(root.innerHTML, /Saude/);
  assert.match(root.innerHTML, /Sanidade/);
  assert.match(root.innerHTML, /Defesa/);
  assert.doesNotMatch(root.innerHTML, /Morgana/);
  assert.doesNotMatch(root.innerHTML, /Ana/);
  assert.doesNotMatch(root.innerHTML, /Orion/);
  assert.match(root.innerHTML, /Online/);
  assert.doesNotMatch(root.innerHTML, /game-stat-step/);
});

test("records a player dice roll by origin and shows the five-second game alert", async () => {
  const { bodyChildren, context, timeouts } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    const diceResultElement = {
      innerHTML: "",
      offsetWidth: 1,
      classList: { add() {}, remove() {} }
    };
    const diceHistoryElement = { innerHTML: "" };
    const originalGetElementById = document.getElementById.bind(document);
    document.getElementById = id => ({
      diceResult: diceResultElement,
      diceHistory: diceHistoryElement
    }[id] || originalGetElementById(id));
    window.CDIFirebase = {
      enabled: true,
      currentUser: { uid: "auth-1" },
      async recordDiceRoll(campaignId, roll) {
        window.__recordedDiceCampaignId = campaignId;
        window.__recordedDiceRoll = { ...roll, authorId: "auth-1" };
        return window.__recordedDiceRoll;
      }
    };
    firebaseUser = { uid: "auth-1", email: "ana@example.com" };
    firebaseProfile = { id: "auth-1", role: "player", name: "Ana" };
    session = { role: "player", campaign: state.campaigns[0], player: state.campaigns[0].players[0], currentMaster: null, view: "room" };
    window.__diceRollPromise = rollDice(20, 2, "Percepcao");
  `, context);

  const roll = await context.window.__diceRollPromise;
  vm.runInContext(`
    window.__diceResultHtml = diceResultElement.innerHTML;
    window.__diceHistoryHtml = diceHistoryElement.innerHTML;
    window.__diceAlertMessage = diceRollAlertMessage(state.campaigns[0].diceLogs[0]);
    window.__duplicateDiceAlert = announceDiceRoll(state.campaigns[0].diceLogs[0], state.campaigns[0]);
    session = { role: "master", campaign: state.campaigns[0], player: null, currentMaster: state.masters[0], view: "diceLogs" };
    window.__masterDiceHistoryHtml = masterDiceLogsPage();
  `, context);

  const alertElement = bodyChildren.find(element => element.className === "dice-roll-global-alert");
  assert.equal(context.window.__recordedDiceCampaignId, "campaign-1");
  assert.equal(context.window.__recordedDiceRoll.authorId, "auth-1");
  assert.equal(roll.origin, "Medica");
  assert.equal(roll.author, "Medica");
  assert.equal(context.window.__diceAlertMessage, `[Medica] : GIROU DADO E DEU [${roll.total}!]`);
  assert.match(alertElement.innerHTML, new RegExp(`\\[Medica\\] : GIROU DADO E DEU \\[${roll.total}!\\]`));
  assert.doesNotMatch(alertElement.innerHTML, /Morgana|Ana/);
  assert.match(context.window.__diceResultHtml, new RegExp(`dice-total[^>]*>${roll.total}<`));
  assert.match(context.window.__diceHistoryHtml, new RegExp(`Medica</b>: ${roll.total}`));
  assert.match(context.window.__masterDiceHistoryHtml, new RegExp(`Medica[\\s\\S]*${roll.total}`));
  assert.equal(context.window.__duplicateDiceAlert, false);
  assert.equal(timeouts.includes(5000), true);
});

test("announces a new player dice roll received from the realtime campaign feed", () => {
  const { bodyChildren, context } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    window.CDIFirebase = { enabled: true, currentUser: { uid: "auth-1" } };
    firebaseUser = { uid: "auth-1", email: "ana@example.com" };
    firebaseProfile = { id: "auth-1", role: "player", name: "Ana" };
    session = { role: "player", campaign: state.campaigns[0], player: state.campaigns[0].players[0], currentMaster: null, view: "room" };
    lastRemoteCampaignJson = JSON.stringify(state.campaigns);

    const realtimeCampaigns = JSON.parse(JSON.stringify(state.campaigns));
    realtimeCampaigns[0].diceLogs.unshift({
      id: "remote-roll-1",
      author: "Cacador",
      authorId: "auth-2",
      playerId: "player-2",
      characterId: "char-2",
      rollerRole: "player",
      origin: "Cacador",
      sides: 20,
      die: 19,
      bonus: 0,
      bonusText: "",
      total: 19,
      label: "",
      time: "22:10",
      createdAt: new Date().toISOString()
    });
    window.__diceRemoteApplied = applyRemoteCampaignSnapshot(
      realtimeCampaigns,
      { fromCache: false, hasPendingWrites: false },
      firebaseUser
    );
  `, context);

  const alertElement = bodyChildren.find(element => element.className === "dice-roll-global-alert");
  assert.equal(context.window.__diceRemoteApplied, true);
  assert.match(alertElement.innerHTML, /\[Cacador\] : GIROU DADO E DEU \[19!\]/);

  const css = fs.readFileSync(path.join(__dirname, "..", "style.css"), "utf8");
  assert.match(css, /\.dice-roll-global-alert\s*\{[\s\S]*?animation:\s*traumaAlertLifetime 5s/);
});

test("renders compact stat controls for the master inside the game cards", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    session = { role: "master", campaign: state.campaigns[0], player: null, currentMaster: state.masters[0], view: "room" };
    render();
  `, context);

  assert.match(root.innerHTML, /game-character-card/);
  assert.match(root.innerHTML, /game-stat-step/);
  assert.match(root.innerHTML, /adjustGameCardStat/);
});

test("renders reusable expression playlists only for the master", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    session = { role: "master", campaign: state.campaigns[0], player: null, currentMaster: state.masters[0], view: "expressions" };
    render();
    expressionModal("char-1");
  `, context);

  assert.match(root.innerHTML, /◒ Expressões/);
  assert.match(root.innerHTML, /Retrato original/);
  assert.match(root.innerHTML, /Felicidade/);
  assert.match(root.innerHTML, /Tenso/);
  assert.match(root.innerHTML, /Reaplicar/);
  assert.match(root.innerHTML, /id="expressionTitle"[^>]*required/);
  assert.match(root.innerHTML, /id="expressionImage"[^>]*required/);
  assert.match(root.innerHTML, /value="char-1" selected/);

  vm.runInContext(`
    session = { role: "player", campaign: state.campaigns[0], player: state.campaigns[0].players[0], currentMaster: null, view: "sheet" };
    render();
  `, context);
  assert.doesNotMatch(root.innerHTML, /◒ Expressões|Adicionar expressão|expressionPlaylistCard/);
});

test("changes the game portrait and can return to the original portrait", async () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    session = { role: "master", campaign: state.campaigns[0], player: null, currentMaster: state.masters[0], view: "expressions" };
    window.__selectHappyPromise = selectCharacterExpression("char-1", "expression-happy");
  `, context);
  await context.window.__selectHappyPromise;

  vm.runInContext(`
    session.view = "room";
    render();
  `, context);
  assert.match(root.innerHTML, /game-card-row[\s\S]*happy\.jpg/);
  assert.doesNotMatch(root.innerHTML, /game-card-row[\s\S]*tense\.jpg/);

  vm.runInContext(`
    window.__selectOriginalPromise = selectCharacterExpression("char-1", "");
  `, context);
  await context.window.__selectOriginalPromise;
  assert.match(root.innerHTML, /game-card-row[\s\S]*portrait-1\.jpg/);
  assert.doesNotMatch(root.innerHTML, /game-card-row[\s\S]*happy\.jpg/);
});

test("updates a game card vital immediately when the master uses its controls", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    session = { role: "master", campaign: state.campaigns[0], player: null, currentMaster: state.masters[0], view: "room" };
    render();
    adjustGameCardStat("char-1", "health", -1);
    window.__updatedHealth = session.campaign.characters[0].health;
  `, context);

  assert.equal(context.window.__updatedHealth, 9);
  assert.match(root.innerHTML, /9\/10/);
});

test("renders only the owned inventory in an immersive slot grid", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    session = { role: "player", campaign: state.campaigns[0], player: state.campaigns[0].players[0], currentMaster: null, view: "inventory" };
    render();
  `, context);

  assert.match(root.innerHTML, /Pocao/);
  assert.match(root.innerHTML, /inventory-slot-grid/);
  assert.match(root.innerHTML, /inventory-slot-image" src="pocao.jpg"/);
  assert.match(root.innerHTML, /inventory-detail-image entity-visual-image" src="pocao.jpg"/);
  assert.match(root.innerHTML, /Recupera vida/);
  assert.match(root.innerHTML, /inventory-slot-quantity">2/);
  assert.match(root.innerHTML, /1\/24/);
  assert.doesNotMatch(root.innerHTML, /Itens compartilhados da mesa/);
  assert.doesNotMatch(root.innerHTML, /Mapa da mesa/);
});

test("keeps each character inventory visually isolated", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    state.campaigns[0].players[1].characterId = "char-2";
    session = { role: "player", campaign: state.campaigns[0], player: state.campaigns[0].players[1], currentMaster: null, view: "inventory" };
    render();
  `, context);

  assert.match(root.innerHTML, /Mochila vazia/);
  assert.match(root.innerHTML, /0\/24/);
  assert.doesNotMatch(root.innerHTML, /Pocao/);
});

test("renders only the character-owned evidence in inventory-style slots", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    session = { role: "player", campaign: state.campaigns[0], player: state.campaigns[0].players[0], currentMaster: null, view: "evidencePlayer" };
    render();
  `, context);

  assert.match(root.innerHTML, /Arquivo pessoal/);
  assert.match(root.innerHTML, /inventory-slot-grid/);
  assert.match(root.innerHTML, /evidence-slot is-filled is-selected/);
  assert.match(root.innerHTML, /evidence-photo\.jpg/);
  assert.match(root.innerHTML, /Fotografia antiga/);
  assert.match(root.innerHTML, /Uma silhueta aparece ao fundo/);
  assert.match(root.innerHTML, /1\/24/);
  assert.doesNotMatch(root.innerHTML, /Bilhete cifrado|evidence-note\.jpg/);

  vm.runInContext(`
    state.campaigns[0].players[1].characterId = "char-2";
    session = { role: "player", campaign: state.campaigns[0], player: state.campaigns[0].players[1], currentMaster: null, view: "evidencePlayer" };
    render();
  `, context);
  assert.match(root.innerHTML, /Arquivo vazio/);
  assert.doesNotMatch(root.innerHTML, /Fotografia antiga|Bilhete cifrado/);
});

test("renders the master evidence library with ownership and required fields", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    session = { role: "master", campaign: state.campaigns[0], player: null, currentMaster: state.masters[0], view: "evidence" };
    render();
    evidenceModal("evidence-1");
    evidenceAssignmentModal("evidence-1");
  `, context);

  assert.match(root.innerHTML, /Biblioteca da campanha e posse atual/);
  assert.match(root.innerHTML, /Fotografia antiga/);
  assert.match(root.innerHTML, /Bilhete cifrado/);
  assert.match(root.innerHTML, /Vinculada a/);
  assert.match(root.innerHTML, /Morgana · Medica/);
  assert.match(root.innerHTML, /Alterar vínculo/);
  assert.match(root.innerHTML, /Desvincular/);
  assert.match(root.innerHTML, /deleteEvidenceCatalogEntry/);
  assert.doesNotMatch(root.innerHTML, /Visível para jogadores|evrev/);
  assert.match(root.innerHTML, /id="evtitle"[^>]*required/);
  assert.match(root.innerHTML, /id="evdesc"[^>]*required/);
  assert.match(root.innerHTML, /id="evimg"[^>]*required/);
  assert.match(root.innerHTML, /id="evidenceOwnerCharacter"/);
  assert.match(root.innerHTML, /value="char-1" selected/);

  const css = fs.readFileSync(path.join(__dirname, "..", "style.css"), "utf8");
  assert.match(css, /\.evidence-library-grid\s*\{[\s\S]*?minmax\(220px, 244px\)/);
  assert.match(css, /\.evidence-library-card\s*\{[\s\S]*?padding:\s*14px/);
  assert.match(css, /\.evidence-library-image\s*\{[\s\S]*?aspect-ratio:\s*3 \/ 2/);
});

test("creates an evidence transfer request from the owned character record", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    const campaign = state.campaigns[0];
    campaign.players[1].authUid = "auth-2";
    campaign.players[1].status = "claimed";
    campaign.characters[1].controllerPlayerId = "player-2";
    campaign.members.push("auth-2");
    session = { role: "player", campaign, player: campaign.players[0], currentMaster: null, view: "transferPlayer" };
    render();
    window.__transferPageHtml = document.getElementById("root").innerHTML;
    const originalGetElementById = document.getElementById.bind(document);
    document.getElementById = id => ({
      trType: { value: "evidence" },
      trTarget: { value: "char-2" },
      trMsg: { value: "Entregar para análise" },
      trEvidenceId: { value: "owned-evidence-1" }
    }[id] || originalGetElementById(id));
    submitPlayerTransfer("char-1");
    window.__evidenceTransfer = campaign.itemTransfers[0];
  `, context);

  assert.match(context.window.__transferPageHtml, /Fotografia antiga/);
  assert.doesNotMatch(context.window.__transferPageHtml, /Bilhete cifrado/);
  assert.match(context.window.__transferPageHtml, /Origem: Cacador/);
  assert.doesNotMatch(context.window.__transferPageHtml, /Orion|Bruno/);
  assert.equal(context.window.__evidenceTransfer.evidenceEntryId, "owned-evidence-1");
  assert.equal(context.window.__evidenceTransfer.evidenceId, "evidence-1");
  assert.equal(context.window.__evidenceTransfer.fromCharacterId, "char-1");
  assert.equal(context.window.__evidenceTransfer.toCharacterId, "char-2");
  assert.equal(context.window.__evidenceTransfer.fromName, "Medica");
  assert.equal(context.window.__evidenceTransfer.toName, "Cacador");
});

test("renders the player character image as a face portrait instead of a banner", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    state.campaigns[0].characters[0].image = "morgana.jpg";
    session = { role: "player", campaign: state.campaigns[0], player: state.campaigns[0].players[0], currentMaster: null, view: "sheet" };
    render();
  `, context);

  assert.match(root.innerHTML, /class="character-sheet-portrait entity-visual-image"/);
  assert.doesNotMatch(root.innerHTML, /class="avatar entity-visual-image"/);
});

test("renders only the owned character traumas in the player tab", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    session = { role: "player", campaign: state.campaigns[0], player: state.campaigns[0].players[0], currentMaster: null, view: "traumas" };
    render();
  `, context);

  assert.match(root.innerHTML, /Meus Traumas/);
  assert.match(root.innerHTML, /Aracnofobia/);
  assert.match(root.innerHTML, /aranha\.jpg/);
  assert.doesNotMatch(root.innerHTML, /Claustrofobia|tunel\.jpg/);
  assert.match(root.innerHTML, /trauma-player-loadout/);
  assert.doesNotMatch(root.innerHTML, /removeCharacterTrauma|Vincular trauma|Cadastrar trauma|trauma-library-grid/);
});

test("renders the master trauma thumbnail library and assignment controls", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    session = { role: "master", campaign: state.campaigns[0], player: null, currentMaster: state.masters[0], view: "traumas" };
    render();
    traumaCatalogModal();
    traumaAssignmentModal("char-1", "catalog-trauma-2");
  `, context);

  assert.match(root.innerHTML, /Traumas cadastrados/);
  assert.match(root.innerHTML, /class="trauma-library-grid"/);
  assert.match(root.innerHTML, /class="trauma-library-tooltip"[^>]*>Aracnofobia/);
  assert.match(root.innerHTML, /title="Claustrofobia"/);
  assert.match(root.innerHTML, /Aracnofobia/);
  assert.match(root.innerHTML, /Claustrofobia/);
  assert.match(root.innerHTML, /removeCharacterTrauma/);
  assert.match(root.innerHTML, /deleteTraumaCatalogEntry/);
  assert.match(root.innerHTML, /Cadastrar trauma/);
  assert.match(root.innerHTML, /Vincular trauma/);
  assert.match(root.innerHTML, /id="traumaTitle"[^>]*required/);
  assert.match(root.innerHTML, /id="traumaImage"[^>]*required/);
  assert.doesNotMatch(root.innerHTML, /id="traumaDescription"/);
  assert.match(root.innerHTML, /id="traumaCatalogEntry"[^>]*value="catalog-trauma-2"/);
  assert.match(root.innerHTML, /value="char-1" selected/);

  const css = fs.readFileSync(path.join(__dirname, "..", "style.css"), "utf8");
  assert.match(css, /\.trauma-library-icon-shell:hover \.trauma-library-tooltip,[\s\S]*?opacity:\s*1/);
  assert.match(css, /\.trauma-library-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fill, 84px\)/);
  assert.match(css, /\.trauma-library-icon\s*\{[\s\S]*?width:\s*84px;[\s\S]*?height:\s*84px/);
  assert.doesNotMatch(css, /\.trauma-web/);
});

test("deletes a catalog trauma and all of its active links", async () => {
  const { context } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    session = { role: "master", campaign: state.campaigns[0], player: null, currentMaster: state.masters[0], view: "traumas" };
    window.__deleteCatalogTraumaPromise = deleteTraumaCatalogEntry("catalog-trauma-1");
  `, context);

  await context.window.__deleteCatalogTraumaPromise;
  vm.runInContext(`
    window.__deletedTraumaState = {
      catalogIds: state.campaigns[0].traumaCatalog.map(entry => entry.id),
      firstCharacterTraumas: state.campaigns[0].characters[0].traumas.map(entry => entry.catalogId),
      secondCharacterTraumas: state.campaigns[0].characters[1].traumas.map(entry => entry.catalogId)
    };
  `, context);

  assert.deepEqual(Array.from(context.window.__deletedTraumaState.catalogIds), ["catalog-trauma-2"]);
  assert.deepEqual(Array.from(context.window.__deletedTraumaState.firstCharacterTraumas), []);
  assert.deepEqual(Array.from(context.window.__deletedTraumaState.secondCharacterTraumas), ["catalog-trauma-2"]);
});

test("links a catalog trauma to a character and publishes the global alert", async () => {
  const { bodyChildren, context } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    session = { role: "master", campaign: state.campaigns[0], player: null, currentMaster: state.masters[0], view: "traumas" };
    const originalGetElementById = document.getElementById.bind(document);
    const applyButton = { disabled: false, textContent: "", isConnected: true };
    document.getElementById = id => ({
      traumaCharacter: { value: "char-1" },
      traumaCatalogEntry: { value: "catalog-trauma-2" },
      applyTraumaButton: applyButton,
      traumaAssignmentModal: { remove() {} }
    }[id] || originalGetElementById(id));
    window.__linkCatalogTraumaPromise = applyTrauma();
  `, context);

  await context.window.__linkCatalogTraumaPromise;
  vm.runInContext(`
    window.__linkedTrauma = state.campaigns[0].characters[0].traumas[0];
    window.__latestLinkedTraumaEvent = state.campaigns[0].latestTraumaEvent;
  `, context);
  const linkedTrauma = context.window.__linkedTrauma;
  assert.equal(linkedTrauma.catalogId, "catalog-trauma-2");
  assert.equal(linkedTrauma.title, "Claustrofobia");
  assert.equal(linkedTrauma.image, "tunel.jpg");
  assert.equal(context.window.__latestLinkedTraumaEvent.traumaTitle, "Claustrofobia");
  assert.equal(bodyChildren.some(element => element.className === "trauma-global-alert"), true);
});

test("announces a recent trauma once with origin only and a five-second lifetime", () => {
  const { bodyChildren, context, timeouts } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    session = { role: "player", campaign: state.campaigns[0], player: state.campaigns[0].players[0], currentMaster: null, view: "traumas" };
    const event = {
      id: "trauma-event-1",
      origin: "Medica",
      traumaTitle: "Aracnofobia",
      createdAt: new Date().toISOString()
    };
    window.__traumaMessage = traumaAlertMessage(event);
    window.__firstTraumaAnnouncement = announceTraumaEvent(event, session.campaign);
    window.__secondTraumaAnnouncement = announceTraumaEvent(event, session.campaign);
  `, context);

  const alertElement = bodyChildren.find(element => element.className === "trauma-global-alert");
  assert.equal(context.window.__traumaMessage, "[Medica] - Adquiriu um trauma: [Aracnofobia]");
  assert.equal(context.window.__firstTraumaAnnouncement, true);
  assert.equal(context.window.__secondTraumaAnnouncement, false);
  assert.match(alertElement.innerHTML, /\[Medica\] - Adquiriu um trauma: \[Aracnofobia\]/);
  assert.doesNotMatch(alertElement.innerHTML, /Morgana|Ana/);
  assert.equal(timeouts.includes(5000), true);
});

test("uses the packaged dark fantasy MP3 instead of a synthesized alert", () => {
  const { context } = createAppContext();
  vm.runInContext(`
    window.__traumaSoundUrl = TRAUMA_ALERT_SOUND_URL;
    window.__traumaSoundPlayer = playTraumaAlertSound.toString();
  `, context);

  const assetPath = path.join(__dirname, "..", "assets", "audio", "trauma-alert-dark-fantasy.mp3");
  assert.equal(context.window.__traumaSoundUrl, "assets/audio/trauma-alert-dark-fantasy.mp3");
  assert.equal(fs.existsSync(assetPath), true);
  assert.equal(fs.statSync(assetPath).size, 135980);
  assert.match(context.window.__traumaSoundPlayer, /loadTraumaAlertAudio/);
  assert.doesNotMatch(context.window.__traumaSoundPlayer, /createOscillator/);
});

test("shows a trauma alert when the realtime campaign snapshot arrives", () => {
  const { bodyChildren, context } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    window.CDIFirebase = { enabled: true, currentUser: { uid: "auth-1" } };
    firebaseUser = { uid: "auth-1", email: "ana@example.com" };
    firebaseProfile = { id: "auth-1", role: "player", name: "Ana" };
    session = { role: "player", campaign: state.campaigns[0], player: state.campaigns[0].players[0], currentMaster: null, view: "traumas" };
    lastRemoteCampaignJson = JSON.stringify(state.campaigns);

    const realtimeCampaigns = JSON.parse(JSON.stringify(state.campaigns));
    realtimeCampaigns[0].latestTraumaEvent = {
      id: "realtime-trauma-event",
      origin: "Medica",
      traumaTitle: "Nictofobia",
      createdAt: new Date().toISOString()
    };
    window.__traumaRemoteApplied = applyRemoteCampaignSnapshot(
      realtimeCampaigns,
      { fromCache: false, hasPendingWrites: false },
      firebaseUser
    );
  `, context);

  const alertElement = bodyChildren.find(element => element.className === "trauma-global-alert");
  assert.equal(context.window.__traumaRemoteApplied, true);
  assert.match(alertElement.innerHTML, /\[Medica\] - Adquiriu um trauma: \[Nictofobia\]/);
});

test("updates the game portrait when a realtime expression selection arrives", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    window.CDIFirebase = { enabled: true, currentUser: { uid: "auth-1" } };
    firebaseUser = { uid: "auth-1", email: "ana@example.com" };
    firebaseProfile = { id: "auth-1", role: "player", name: "Ana" };
    session = { role: "player", campaign: state.campaigns[0], player: state.campaigns[0].players[0], currentMaster: null, view: "room" };
    render();
    lastRemoteCampaignJson = JSON.stringify(state.campaigns);

    const realtimeCampaigns = JSON.parse(JSON.stringify(state.campaigns));
    realtimeCampaigns[0].characters[0].activeExpression = "expression-happy";
    realtimeCampaigns[0].characters[0].expressionUpdatedAt = new Date().toISOString();
    window.__expressionRemoteApplied = applyRemoteCampaignSnapshot(
      realtimeCampaigns,
      { fromCache: false, hasPendingWrites: false },
      firebaseUser
    );
  `, context);

  assert.equal(context.window.__expressionRemoteApplied, true);
  assert.match(root.innerHTML, /game-card-row[\s\S]*happy\.jpg/);
  assert.doesNotMatch(root.innerHTML, /game-card-row[\s\S]*tense\.jpg/);
});

test("lets the master unlink and reapply a trauma without affecting another character", async () => {
  const { context } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    session = { role: "master", campaign: state.campaigns[0], player: null, currentMaster: state.masters[0], view: "traumas" };
    window.__removeTraumaPromise = removeCharacterTrauma("char-1", "trauma-1");
  `, context);

  await context.window.__removeTraumaPromise;
  vm.runInContext(`
    window.__ownedTraumaCount = state.campaigns[0].characters[0].traumas.length;
    window.__otherTraumaTitle = state.campaigns[0].characters[1].traumas[0].title;
    window.__catalogCountAfterUnlink = state.campaigns[0].traumaCatalog.length;
    const originalGetElementById = document.getElementById.bind(document);
    document.getElementById = id => ({
      traumaCharacter: { value: "char-1" },
      traumaCatalogEntry: { value: "catalog-trauma-1" },
      applyTraumaButton: { disabled: false, textContent: "", isConnected: true },
      traumaAssignmentModal: { remove() {} }
    }[id] || originalGetElementById(id));
    window.__reapplyTraumaPromise = applyTrauma();
  `, context);
  assert.equal(context.window.__ownedTraumaCount, 0);
  assert.equal(context.window.__otherTraumaTitle, "Claustrofobia");
  assert.equal(context.window.__catalogCountAfterUnlink, 2);

  await context.window.__reapplyTraumaPromise;
  vm.runInContext(`window.__reappliedTrauma = state.campaigns[0].characters[0].traumas[0]`, context);
  assert.equal(context.window.__reappliedTrauma.catalogId, "catalog-trauma-1");
  assert.equal(context.window.__reappliedTrauma.title, "Aracnofobia");
  assert.notEqual(context.window.__reappliedTrauma.id, "trauma-1");
});

test("renders the private scene deck and controls only for the master", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    session = { role: "master", campaign: state.campaigns[0], player: null, currentMaster: state.masters[0], view: "scenes" };
    render();
  `, context);

  assert.match(root.innerHTML, /Adicionar imagens/);
  assert.match(root.innerHTML, /Armadilha privada/);
  assert.match(root.innerHTML, /Corredor futuro/);
  assert.match(root.innerHTML, /Ocultar dos jogadores/);
});

test("renders only the active image for a player without its title or caption", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    session = { role: "player", campaign: state.campaigns[0], player: state.campaigns[0].players[0], currentMaster: null, view: "scenes" };
    render();
  `, context);

  assert.match(root.innerHTML, /scene-1\.jpg/);
  assert.match(root.innerHTML, /Cena apresentada pelo Mestre/);
  assert.doesNotMatch(root.innerHTML, /Portao|O portao se abre/);
  assert.doesNotMatch(root.innerHTML, /Corredor futuro/);
  assert.doesNotMatch(root.innerHTML, /Armadilha privada|Monstro escondido/);
});

test("restores the Firebase player session without storing a password", () => {
  const { context, storage } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    window.CDIFirebase = { enabled: true, currentUser: { uid: "auth-1" } };
    firebaseUser = { uid: "auth-1", email: "ana@example.com" };
    session = { role: "player", campaign: state.campaigns[0], player: state.campaigns[0].players[0], currentMaster: null, view: "inventory" };
    render();
    session = { role: null, campaign: null, player: null, currentMaster: null, view: "home" };
    window.__restored = restoreFirebaseSession(firebaseUser, { id: "auth-1", role: "player", name: "Ana" });
    window.__restoredSession = { role: session.role, campaignId: session.campaign?.id, playerId: session.player?.id, view: session.view };
  `, context);

  const saved = storage.get("cdi_session_context_v2");
  assert.equal(context.window.__restored, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.window.__restoredSession)),
    { role: "player", campaignId: "campaign-1", playerId: "player-1", view: "inventory" }
  );
  assert.doesNotMatch(saved, /secret|password/i);
});

test("waits for the saved campaign instead of switching campaigns during refresh", () => {
  const { context } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    window.CDIFirebase = { enabled: true, currentUser: { uid: "auth-1" } };
    firebaseUser = { uid: "auth-1", email: "ana@example.com" };
    const refreshCampaignOne = state.campaigns[0];
    const refreshCampaignTwo = JSON.parse(JSON.stringify(refreshCampaignOne));
    refreshCampaignTwo.id = "campaign-2";
    refreshCampaignTwo.name = "Campanha atual";
    refreshCampaignTwo.players[0].id = "player-current";
    refreshCampaignTwo.players[0].characterId = "char-current";
    refreshCampaignTwo.characters[0].id = "char-current";
    refreshCampaignTwo.characters[0].controllerPlayerId = "player-current";
    state.campaigns = [refreshCampaignOne, refreshCampaignTwo];
    normalizeState();

    session = { role: "player", campaign: refreshCampaignTwo, player: refreshCampaignTwo.players[0], currentMaster: null, view: "inventory" };
    render();
    session = { role: null, campaign: null, player: null, currentMaster: null, view: "home" };

    state.campaigns = [refreshCampaignOne];
    window.__partialRestore = restoreFirebaseSession(firebaseUser, { id: "auth-1", role: "player", name: "Ana" });
    window.__partialRole = session.role;

    state.campaigns.push(refreshCampaignTwo);
    window.__completeRestore = restoreFirebaseSession(firebaseUser, { id: "auth-1", role: "player", name: "Ana" });
    window.__refreshCampaignId = session.campaign?.id;
    window.__refreshPlayerId = session.player?.id;
  `, context);

  assert.equal(context.window.__partialRestore, false);
  assert.equal(context.window.__partialRole, null);
  assert.equal(context.window.__completeRestore, true);
  assert.equal(context.window.__refreshCampaignId, "campaign-2");
  assert.equal(context.window.__refreshPlayerId, "player-current");
});

test("applies a remote inventory update immediately without changing the active campaign", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    window.CDIFirebase = { enabled: true, currentUser: { uid: "auth-1" } };
    firebaseUser = { uid: "auth-1", email: "ana@example.com" };
    firebaseProfile = { id: "auth-1", role: "player", name: "Ana" };
    session = { role: "player", campaign: state.campaigns[0], player: state.campaigns[0].players[0], currentMaster: null, view: "inventory" };
    render();
    lastRemoteCampaignJson = JSON.stringify(state.campaigns);

    const realtimeCampaigns = JSON.parse(JSON.stringify(state.campaigns));
    realtimeCampaigns[0].characters[0].inventory.push({
      id: "inv-live",
      name: "Lanterna",
      description: "Ilumina o caminho",
      image: "lanterna.jpg",
      quantity: 1
    });
    window.__remoteApplied = applyRemoteCampaignSnapshot(
      realtimeCampaigns,
      { fromCache: false, hasPendingWrites: false },
      firebaseUser
    );
    window.__realtimeCampaignId = session.campaign?.id;
    window.__realtimeInventorySize = session.campaign?.characters[0]?.inventory?.length;
    window.__realtimeDescription = session.campaign?.characters[0]?.inventory
      ?.find((item) => item.id === "inv-live")?.description;
  `, context);

  assert.equal(context.window.__remoteApplied, true);
  assert.equal(context.window.__realtimeCampaignId, "campaign-1");
  assert.equal(context.window.__realtimeInventorySize, 2);
  assert.equal(context.window.__realtimeDescription, "Ilumina o caminho");
  assert.match(root.innerHTML, /Lanterna/);
  assert.match(root.innerHTML, /lanterna.jpg/);
});

test("keeps an open registration modal intact during realtime updates", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    window.CDIFirebase = { enabled: true, currentUser: { uid: "master-1" } };
    firebaseUser = { uid: "master-1", email: "master@example.com" };
    firebaseProfile = { id: "master-1", role: "master", name: "Mestre" };
    session = { role: "master", campaign: state.campaigns[0], player: null, currentMaster: state.masters[0], view: "items" };
    render();
    itemModal();
    document.getElementById("root").innerHTML += '<span id="draft-marker">Rascunho em andamento</span>';
    lastRemoteCampaignJson = JSON.stringify(state.campaigns);

    const originalQuerySelector = document.querySelector.bind(document);
    document.querySelector = selector => selector === ".modal"
      ? { id: "open-registration-modal" }
      : originalQuerySelector(selector);

    const realtimeCampaigns = JSON.parse(JSON.stringify(state.campaigns));
    realtimeCampaigns[0].messages.push({
      id: "message-during-form",
      author: "Ana",
      authorId: "auth-1",
      text: "Atualizacao remota",
      sentAt: new Date().toISOString()
    });
    window.__modalRemoteApplied = applyRemoteCampaignSnapshot(
      realtimeCampaigns,
      { fromCache: false, hasPendingWrites: false },
      firebaseUser
    );
    window.__renderWasDeferred = renderDeferredByModal;
    document.querySelector = originalQuerySelector;
  `, context);

  assert.equal(context.window.__modalRemoteApplied, true);
  assert.equal(context.window.__renderWasDeferred, true);
  assert.match(root.innerHTML, /Rascunho em andamento/);
  assert.match(root.innerHTML, /id="itname"/);

  vm.runInContext(`window.__deferredRenderFlushed = flushDeferredRenderAfterModalClose()`, context);
  assert.equal(context.window.__deferredRenderFlushed, true);
  assert.doesNotMatch(root.innerHTML, /Rascunho em andamento/);
});
