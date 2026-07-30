const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const tabletop = require("../js/game/tabletop-model.js");

function createAppContext() {
  const root = {
    innerHTML: "",
    insertAdjacentHTML(_position, html) {
      this.innerHTML += html;
    }
  };
  const storage = new Map();
  const document = {
    body: { appendChild() {} },
    addEventListener() {},
    getElementById(id) {
      return id === "root" ? root : null;
    },
    querySelector() { return null; },
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
    setTimeout() { return 1; },
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
  return { context, root, storage };
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
          { id: "char-1", name: "Morgana", origin: "Medica", health: 10, healthMax: 10, sanity: 8, sanityMax: 8, attrs: {}, res: {}, skills: [], inventory: [{ id: "inv-1", itemId: "item-1", name: "Pocao", description: "Recupera vida", image: "pocao.jpg", quantity: 2 }] },
          { id: "char-2", name: "Orion", origin: "Cacador", health: 10, healthMax: 10, sanity: 8, sanityMax: 8, attrs: {}, res: {}, skills: [] }
        ],
        items: [{ id: "shared-1", name: "Mapa da mesa", description: "Compartilhado", revealed: true }],
        evidence: [], messages: [], diceLogs: [], itemTransfers: [], cases: [], creatures: [], marks: [],
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

  assert.match(root.innerHTML, /Sala/);
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
});

test("renders only controlled characters in the shared room", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    session = { role: "player", campaign: state.campaigns[0], player: state.campaigns[0].players[0], currentMaster: null, view: "room" };
    render();
  `, context);

  assert.match(root.innerHTML, /Morgana/);
  assert.doesNotMatch(root.innerHTML, /Orion/);
  assert.match(root.innerHTML, /Online/);
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

test("renders only the active public scene for a player", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    session = { role: "player", campaign: state.campaigns[0], player: state.campaigns[0].players[0], currentMaster: null, view: "scenes" };
    render();
  `, context);

  assert.match(root.innerHTML, /Portao/);
  assert.match(root.innerHTML, /O portao se abre/);
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
