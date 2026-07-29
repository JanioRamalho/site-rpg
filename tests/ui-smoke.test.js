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
      setItem(key, value) { storage.set(key, String(value)); }
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
  return { context, root };
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
          { id: "char-1", name: "Morgana", origin: "Medica", health: 10, healthMax: 10, sanity: 8, sanityMax: 8, attrs: {}, res: {}, skills: [], inventory: [{ id: "inv-1", itemId: "item-1", name: "Pocao", quantity: 2 }] },
          { id: "char-2", name: "Orion", origin: "Cacador", health: 10, healthMax: 10, sanity: 8, sanityMax: 8, attrs: {}, res: {}, skills: [] }
        ],
        items: [{ id: "shared-1", name: "Mapa da mesa", description: "Compartilhado", revealed: true }],
        evidence: [], messages: [], diceLogs: [], itemTransfers: [], cases: [], creatures: [], marks: []
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

test("renders the owned inventory separately from legacy shared items", () => {
  const { context, root } = createAppContext();
  seedCampaign(context);
  vm.runInContext(`
    session = { role: "player", campaign: state.campaigns[0], player: state.campaigns[0].players[0], currentMaster: null, view: "inventory" };
    render();
  `, context);

  assert.match(root.innerHTML, /Pocao/);
  assert.match(root.innerHTML, /2x/);
  assert.match(root.innerHTML, /Itens compartilhados da mesa/);
  assert.match(root.innerHTML, /Mapa da mesa/);
});
