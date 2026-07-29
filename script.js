/**
 * CRÔNICAS DO INFINITO - SCRIPT PRINCIPAL
 * Versão Completa com Gerenciamento de Fotos, Permissões de Trocas e Exclusão/Limpeza no Painel do Mestre
 */

const ATTR = ["Físico", "Agilidade", "Inteligência", "Percepção", "Vontade", "Presença"];
const RES = ["Física", "Mental", "Sobrenatural"];
const ORIGINS = ["Policial", "Médico", "Padre", "Caçador", "Jornalista", "Cientista", "Engenheiro", "Professor"];

const OFFICIAL_SKILLS = [
  "🗣️ Detectar Mentiras", "📑 Burocracia", "🥷 Furtividade", "🏹 Conhecimento da Presa",
  "🌲 Sobrevivencia", "🩺 Medicina", "🧬 Ciências", "⚙️ Engenharia",
  "💻 Tecnologia", "📰 Jornalismo", "🧠 História", "🔮 Ocultismo",
  "👁️ Percepção", "🗣️ Manipulação"
];

const ICONS_LIST = ["🗡️", "🛡️", "🔮", "🔥", "⚡", "📜", "🗝️", "🎯", "🧬", "🧪", "🕵️", "💣", "🩸", "🕯️", "👻"];
const tabletop = window.CDITabletop;

// Estado Global
let state = JSON.parse(localStorage.getItem("cdi_fase1_full")) || { masters: [], campaigns: [] };

state.masters ??= [];
state.campaigns?.forEach(c => {
  c.masterId ??= "m1";
  c.diceLogs ??= [];
  c.customSkills ??= [...OFFICIAL_SKILLS];
  c.items ??= [];
  c.evidence ??= [];
  c.itemTransfers ??= [];
});

let session = { role: null, campaign: null, player: null, currentMaster: null, view: "home" };
let firebaseUser = null;
let firebaseProfile = null;
let firebaseReady = false;
let unsubscribeCampaigns = null;
let saveTimer = null;
let isApplyingRemoteState = false;
let lastSavedCampaignJson = "";
let lastRemoteCampaignJson = "";
let isCampaignSaveInFlight = false;
let saveAgainAfterCurrent = false;
let syncStatus = "Carregando Firebase...";
let presenceTimer = null;
let presenceContext = null;

const root = document.getElementById("root");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const usingFirebase = () => Boolean(window.CDIFirebase?.enabled);
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const jsArg = value => esc(JSON.stringify(String(value ?? "")));
const imgInput = (id, label) => `<label>${label}</label><input id="${id}" type="file" accept="image/*">`;

function normalizeCampaign(c) {
  if (!c) return c;
  tabletop?.normalizeCampaign(c, uid);
  c.masterId ??= "m1";
  c.players ??= [];
  c.characters ??= [];
  c.cases ??= [];
  c.creatures ??= [];
  c.items ??= [];
  c.evidence ??= [];
  c.marks ??= [];
  c.diceLogs ??= [];
  c.scenes ??= [];
  c.messages ??= [];
  c.customSkills ??= [...OFFICIAL_SKILLS];
  c.itemTransfers ??= [];
  c.members ??= [c.masterId, ...c.players.map(p => p.authUid).filter(Boolean)];
  ["players", "characters", "cases", "creatures", "items", "evidence", "marks", "diceLogs", "messages", "itemTransfers"].forEach(key => {
    c[key].forEach(item => item.id ??= uid());
  });
  return c;
}

function normalizeState() {
  state.masters ??= [];
  state.campaigns ??= [];
  state.campaigns.forEach(normalizeCampaign);
}

function persistLocal() {
  localStorage.setItem("cdi_fase1_full", JSON.stringify(state));
}

function setSyncStatus(status) {
  syncStatus = status;
  const el = document.getElementById("syncStatus");
  if (el) el.textContent = status;
}

async function flushCampaignSave() {
  if (!usingFirebase() || isApplyingRemoteState || !session.campaign?.id) return;
  normalizeCampaign(session.campaign);
  const payload = JSON.stringify(session.campaign);
  if (payload === lastSavedCampaignJson) return;

  if (isCampaignSaveInFlight) {
    saveAgainAfterCurrent = true;
    return;
  }

  isCampaignSaveInFlight = true;
  setSyncStatus("Sincronizando...");
  try {
    await window.CDIFirebase.saveCampaign(session.campaign, {
      role: session.role,
      playerId: session.player?.id || null
    });
    lastSavedCampaignJson = payload;
    setSyncStatus("Online em tempo real");
  } catch (err) {
    console.error(err);
    setSyncStatus("Falha de sincronizacao");
    toast("Nao foi possivel sincronizar com o Firebase.");
  } finally {
    isCampaignSaveInFlight = false;
    if (saveAgainAfterCurrent) {
      saveAgainAfterCurrent = false;
      queueCampaignSave();
    }
  }
}

function queueCampaignSave() {
  if (!usingFirebase() || isApplyingRemoteState || !session.campaign?.id) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushCampaignSave, 150);
}

const save = () => {
  normalizeState();
  persistLocal();
  queueCampaignSave();
};

function firebaseStatusText() {
  if (!window.CDIFirebase) return "Firebase carregando...";
  return usingFirebase() ? syncStatus : "Modo local: configure firebase-config.js";
}

function findCampaign(id) {
  return state.campaigns.find(c => c.id === id);
}

function openCampaign(id) {
  const campaign = findCampaign(id);
  if (!campaign) return alert("Campanha nao encontrada.");
  session.campaign = campaign;
  session.view = "campaign";
  render();
}

async function copyCampaignId(id) {
  try {
    await navigator.clipboard.writeText(id);
    toast("ID da campanha copiado!");
  } catch (err) {
    prompt("Copie o ID da campanha:", id);
  }
}

function getMasterCampaigns() {
  return session.currentMaster ? state.campaigns.filter(c => c.masterId === session.currentMaster.id) : [];
}

function toast(msg) {
  const area = document.getElementById("toast-area") || (() => {
    let div = document.createElement("div");
    div.id = "toast-area";
    document.body.appendChild(div);
    return div;
  })();
  
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  area.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function profileCanUseRole(profile, role) {
  return !profile?.role || profile.role === role;
}

function addSystemMessage(c, text) {
  c.messages ??= [];
  const now = new Date();
  c.messages.unshift({
    id: uid(),
    author: "Sistema",
    authorId: "system",
    text,
    time: `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`
  });
  if (c.messages.length > 100) c.messages.pop();
}

function firebaseErrorMessage(err) {
  const code = String(err?.code || "").replace("firestore/", "");
  const rawMessage = String(err?.message || "").toLowerCase();
  if (rawMessage.includes("client is offline") || rawMessage.includes("failed to get document")) {
    return "Nao foi possivel conectar ao Firestore agora. Verifique a internet, bloqueadores/extensoes do navegador e tente novamente em alguns segundos.";
  }
  const messages = {
    "auth/email-already-in-use": "Este e-mail ja possui uma conta.",
    "auth/invalid-email": "E-mail invalido.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
    "auth/requires-recent-login": "Entre novamente antes de executar esta acao.",
    "campaign/player-not-ready": "O Mestre ainda nao preparou e vinculou um personagem para este e-mail.",
    "permission-denied": "Permissao negada no Firebase. Publique as regras atualizadas do Firestore e tente novamente.",
    "unavailable": "Nao foi possivel conectar ao Firestore. Verifique sua internet, bloqueadores do navegador e se o Firestore esta ativo no Firebase Console."
  };
  return messages[code] || err?.message || "Erro ao acessar o Firebase.";
}

function updateLocalPlayerPresence(online) {
  if (!session.campaign || !session.player) return;
  const player = session.campaign.players.find(p => p.id === session.player.id) || session.player;
  player.online = Boolean(online);
  player.lastSeen = new Date().toISOString();
  session.player = player;
}

async function publishPlayerPresence(online, context = presenceContext) {
  if (!context || !usingFirebase() || !window.CDIFirebase?.setPlayerPresence) return;
  if (session.player?.id === context.playerId) updateLocalPlayerPresence(online);
  try {
    await window.CDIFirebase.setPlayerPresence(context.campaignId, context.playerId, online);
  } catch (err) {
    console.warn("Nao foi possivel atualizar a presenca do jogador.", err);
  }
}

function startPlayerPresence() {
  clearInterval(presenceTimer);
  presenceTimer = null;
  if (!usingFirebase() || session.role !== "player" || !session.campaign?.id || !session.player?.id) return;
  presenceContext = { campaignId: session.campaign.id, playerId: session.player.id };
  publishPlayerPresence(true);
  presenceTimer = setInterval(() => publishPlayerPresence(true), 45000);
}

async function stopPlayerPresence(markOffline = false) {
  clearInterval(presenceTimer);
  presenceTimer = null;
  const context = presenceContext;
  presenceContext = null;
  if (markOffline && context) await publishPlayerPresence(false, context);
}

document.addEventListener("visibilitychange", () => {
  if (!presenceContext) return;
  publishPlayerPresence(document.visibilityState === "visible");
});

window.addEventListener("pagehide", () => {
  if (presenceContext) publishPlayerPresence(false, presenceContext);
});

setInterval(() => {
  if (session.role && session.view === "room") render();
}, 30000);

function playerRegisterModal() {
  if (!usingFirebase()) return playerLogin();
  root.innerHTML = `
    <div class="modal"><div class="modalbox">
      <h2>➕ Novo Jogador</h2>
      <label>Nome</label><input id="newPName" placeholder="Seu nome na mesa">
      <label>E-mail</label><input id="newPEmail" type="email" placeholder="jogador@email.com">
      <label>Senha</label><input id="newPPass" type="password" placeholder="Senha com pelo menos 6 caracteres">
      <br><br>
      <button onclick="createPlayerAccount()">Cadastrar</button>
      <button class="secondary" onclick="playerLogin()">Voltar</button>
    </div></div>`;
}

async function createPlayerAccount() {
  const name = document.getElementById("newPName").value.trim();
  const email = document.getElementById("newPEmail").value.trim();
  const password = document.getElementById("newPPass").value.trim();
  if (!name || !email || !password) return alert("Preencha todos os campos.");
  try {
    firebaseProfile = await window.CDIFirebase.signUp(email, password, name, "player");
    toast("Conta de jogador criada!");
    playerLogin();
  } catch (err) {
    alert(firebaseErrorMessage(err));
  }
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const modals = document.querySelectorAll(".modal");
    if (modals.length > 0) modals[modals.length - 1].remove();
  }
});

window.addEventListener("cdi-firebase-ready", initFirebaseBridge);

async function initFirebaseBridge() {
  if (firebaseReady || !window.CDIFirebase) return;
  firebaseReady = true;
  if (!usingFirebase()) {
    normalizeState();
    persistLocal();
    return render();
  }

  window.CDIFirebase.onAuthChanged(async user => {
    firebaseUser = user;
    try {
      firebaseProfile = user ? await window.CDIFirebase.getUserProfile(user.uid) : null;
    } catch (err) {
      console.warn(err);
      firebaseProfile = user ? {
        id: user.uid,
        name: user.displayName || user.email,
        email: user.email,
        role: "",
        offlineProfile: true
      } : null;
    }
    if (unsubscribeCampaigns) unsubscribeCampaigns();
    unsubscribeCampaigns = null;

    if (!user) {
      await stopPlayerPresence(false);
      session = { role: null, campaign: null, player: null, currentMaster: null, view: "home" };
      state.campaigns = [];
      lastSavedCampaignJson = "";
      lastRemoteCampaignJson = "";
      return render();
    }

    unsubscribeCampaigns = window.CDIFirebase.watchCampaigns(user.uid, (campaigns, meta = {}) => {
      const remoteJson = JSON.stringify(campaigns);
      if (remoteJson === lastRemoteCampaignJson) {
        setSyncStatus(meta.hasPendingWrites ? "Sincronizando..." : (meta.fromCache ? "Usando cache local" : "Online em tempo real"));
        return;
      }
      lastRemoteCampaignJson = remoteJson;

      isApplyingRemoteState = true;
      state.campaigns = campaigns.map(normalizeCampaign);
      persistLocal();

      if (session.campaign) {
        const updated = findCampaign(session.campaign.id);
        if (updated) {
          session.campaign = updated;
          if (session.player) {
            session.player = updated.players.find(p => p.id === session.player.id || p.authUid === user.uid) || session.player;
          }
        }
      }

      isApplyingRemoteState = false;
      if (session.campaign) lastSavedCampaignJson = JSON.stringify(session.campaign);
      setSyncStatus(meta.hasPendingWrites ? "Sincronizando..." : (meta.fromCache ? "Usando cache local" : "Online em tempo real"));
      if (meta.hasPendingWrites) return;
      render();
    }, err => {
      console.error(err);
      setSyncStatus("Falha de conexao");
      toast("Falha ao acompanhar campanhas em tempo real.");
    });

    if (!session.role) render();
  });
}

function readImg(file) {
  return new Promise(resolve => {
    if (!file) return resolve("");
    const fr = new FileReader();
    fr.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxSize = 800;
        let width = img.width, height = img.height;
        if (width > height && width > maxSize) { height *= maxSize / width; width = maxSize; }
        else if (height > maxSize) { width *= maxSize / height; height = maxSize; }
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        if (usingFirebase()) {
          canvas.toBlob(async blob => {
            try {
              const campaignId = session.campaign?.id || "shared";
              const path = `campaign-images/${campaignId}/${uid()}.jpg`;
              const url = await window.CDIFirebase.uploadImage(path, blob);
              resolve(url || canvas.toDataURL("image/jpeg", 0.8));
            } catch (err) {
              console.error(err);
              toast("Nao foi possivel enviar a imagem. Salvando localmente.");
              resolve(canvas.toDataURL("image/jpeg", 0.8));
            }
          }, "image/jpeg", 0.8);
        } else {
          resolve(canvas.toDataURL("image/jpeg", 0.8));
        }
      };
      img.src = e.target.result;
    };
    fr.readAsDataURL(file);
  });
}

function openImageModal(imgSrc, title = "Visualizar Imagem") {
  if (!imgSrc) return;
  root.insertAdjacentHTML("beforeend", `
    <div class="modal" onclick="this.remove()">
      <div class="modalbox" style="text-align:center; max-width:90vw;" onclick="event.stopPropagation()">
        <h3>${esc(title)}</h3>
        <img src="${imgSrc}" style="max-width:100%; max-height:70vh; border-radius:8px; object-fit:contain; margin-top:10px; cursor:pointer;" onclick="this.closest('.modal').remove()">
        <br><br>
        <button class="secondary" onclick="this.closest('.modal').remove()">Fechar</button>
      </div>
    </div>`);
}

// --- TELAS DE AUTENTICAÇÃO E HOME ---
function home() {
  root.innerHTML = `
    <div class="modal home-screen"><div class="modalbox">
      <h1>🌑 Crônicas do Infinito</h1>
      <p class="muted">Gerenciador de RPG de Mesa Online</p>
      <div class="grid" style="margin-top:15px;">
        <div class="card"><h2>👑 Painel do Mestre</h2><p>Controle campanhas, fichas, criaturas e mistérios.</p><button onclick="masterLoginModal()">Entrar como Mestre</button></div>
        <div class="card"><h2>👤 Painel do Jogador</h2><p>Acesse seu personagem, inventário e atributos.</p><button onclick="playerLogin()">Entrar como Jogador</button></div>
      </div>
    </div></div>`;
}

function masterLoginModal() {
  if (usingFirebase()) {
    root.innerHTML = `
      <div class="modal"><div class="modalbox">
        <h2>👑 Acesso do Mestre</h2>
        <label>E-mail</label><input id="memail" type="email" placeholder="mestre@email.com">
        <label>Senha</label><input id="mpass" type="password" placeholder="Sua senha">
        <br><br>
        <button onclick="doMasterLogin()">Entrar</button>
        <button class="secondary" onclick="newMasterModal()">Criar conta</button>
        <button class="secondary" onclick="home()">Voltar</button>
      </div></div>`;
    return;
  }
  if (state.masters.length === 0) return newMasterModal();
  root.innerHTML = `
    <div class="modal"><div class="modalbox">
      <h2>👑 Acesso do Mestre</h2>
      <label>Selecione o Mestre</label>
      <select id="msel">${state.masters.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join("")}</select>
      <label>Senha do Mestre</label>
      <input id="mpass" type="password" placeholder="Sua senha">
      <br><br>
      <button onclick="doMasterLogin()">Entrar</button>
      <button class="secondary" onclick="newMasterModal()">➕ Novo Mestre</button>
      <button class="secondary" onclick="home()">Voltar</button>
    </div></div>`;
}

function newMasterModal() {
  if (usingFirebase()) {
    root.innerHTML = `
      <div class="modal"><div class="modalbox">
        <h2>➕ Novo Mestre</h2>
        <label>Nome do Mestre</label><input id="newMName" placeholder="Ex: Mestre Gabriel">
        <label>E-mail</label><input id="newMEmail" type="email" placeholder="mestre@email.com">
        <label>Senha de Acesso</label><input id="newMPass" type="password" placeholder="Senha com pelo menos 6 caracteres">
        <br><br>
        <button onclick="createMaster()">Cadastrar</button>
        <button class="secondary" onclick="masterLoginModal()">Voltar</button>
      </div></div>`;
    return;
  }
  root.innerHTML = `
    <div class="modal"><div class="modalbox">
      <h2>➕ Novo Mestre</h2>
      <label>Nome do Mestre</label><input id="newMName" placeholder="Ex: Mestre Gabriel">
      <label>Senha de Acesso</label><input id="newMPass" type="password" placeholder="Senha">
      <br><br>
      <button onclick="createMaster()">Cadastrar</button>
      <button class="secondary" onclick="${state.masters.length > 0 ? 'masterLoginModal()' : 'home()'}">Voltar</button>
    </div></div>`;
}

async function createMaster() {
  if (usingFirebase()) {
    const name = document.getElementById("newMName").value.trim();
    const email = document.getElementById("newMEmail").value.trim();
    const password = document.getElementById("newMPass").value.trim();
    if (!name || !email || !password) return alert("Preencha todos os campos.");
    try {
      const profile = await window.CDIFirebase.signUp(email, password, name, "master");
      firebaseProfile = profile;
      session = { role: "master", currentMaster: profile, campaign: null, player: null, view: "home" };
      toast("Mestre cadastrado no Firebase!");
      masterMenu();
    } catch (err) {
      alert(firebaseErrorMessage(err));
    }
    return;
  }
  const name = document.getElementById("newMName").value.trim();
  const password = document.getElementById("newMPass").value.trim();
  if (!name || !password) return alert("Preencha todos os campos.");

  state.masters.push({ id: uid(), name, password });
  save();
  toast("Mestre cadastrado!");
  masterLoginModal();
}

async function doMasterLogin() {
  if (usingFirebase()) {
    const email = document.getElementById("memail").value.trim();
    const pass = document.getElementById("mpass").value;
    if (!email || !pass) return alert("Informe e-mail e senha.");
    try {
      let profile = await window.CDIFirebase.signIn(email, pass, "master");
      if (!profile) profile = await window.CDIFirebase.saveUserProfile(window.CDIFirebase.currentUser, "master", email);
      if (!profileCanUseRole(profile, "master")) return alert("Esta conta foi cadastrada como Jogador. Use uma conta de Mestre para acessar este painel.");
      firebaseProfile = profile;
      session = { role: "master", currentMaster: profile, campaign: null, player: null, view: "home" };
      masterMenu();
    } catch (err) {
      alert(firebaseErrorMessage(err));
    }
    return;
  }
  const mid = document.getElementById("msel").value;
  const pass = document.getElementById("mpass").value;
  const target = state.masters.find(m => m.id === mid);

  if (!target || target.password !== pass) return alert("Senha incorreta!");

  session = { role: "master", currentMaster: target, campaign: null, player: null, view: "home" };
  masterMenu();
}

function playerLogin() {
  if (usingFirebase()) {
    root.innerHTML = `
      <div class="modal"><div class="modalbox">
        <h2>👤 Acesso do Jogador</h2>
        <label>E-mail</label><input id="pemail" type="email" placeholder="jogador@email.com">
        <label>Senha</label><input id="ppass" type="password" placeholder="Sua senha">
        <label>ID da Campanha</label><input id="pcid" placeholder="Cole o ID informado pelo Mestre">
        <label>Senha da Campanha</label><input id="pw" type="password">
        <label>Nome na mesa</label><input id="pname" placeholder="Ex: Ana">
        <br><br>
        <button onclick="doPlayerLogin()">Entrar</button>
        <button class="secondary" onclick="playerRegisterModal()">Criar conta de jogador</button>
        <button class="secondary" onclick="home()">Voltar</button>
      </div></div>`;
    return;
  }
  if (!state.campaigns.length) return alert("Nenhuma campanha criada.");
  root.innerHTML = `
    <div class="modal"><div class="modalbox">
      <h2>👤 Acesso do Jogador</h2>
      <label>Campanha</label><select id="pc">${state.campaigns.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
      <label>Senha da Campanha</label><input id="pw" type="password">
      <label>Senha do Jogador</label><input id="pp" type="password">
      <br><br>
      <button onclick="doPlayerLogin()">Entrar</button>
      <button class="secondary" onclick="home()">Voltar</button>
    </div></div>`;
}

async function doPlayerLogin() {
  if (usingFirebase()) {
    const email = document.getElementById("pemail").value.trim();
    const pass = document.getElementById("ppass").value;
    const campaignId = document.getElementById("pcid").value.trim();
    const campaignPass = document.getElementById("pw").value;
    const name = document.getElementById("pname").value.trim();
    if (!email || !pass || !campaignId || !campaignPass) return alert("Preencha e-mail, senha e dados da campanha.");
    const loginBtn = document.querySelector('button[onclick="doPlayerLogin()"]');
    if (loginBtn) {
      loginBtn.disabled = true;
      loginBtn.textContent = "Entrando...";
    }
    const resetPlayerLoginButton = () => {
      if (!loginBtn) return;
      loginBtn.disabled = false;
      loginBtn.textContent = "Entrar";
    };

    try {
      let profile = await window.CDIFirebase.signIn(email, pass, "player");
      if (!profile) profile = await window.CDIFirebase.saveUserProfile(window.CDIFirebase.currentUser, "player", name || email);
      if (!profileCanUseRole(profile, "player")) {
        resetPlayerLoginButton();
        return alert("Esta conta foi cadastrada como Mestre. Use uma conta de Jogador para entrar na campanha.");
      }
      firebaseProfile = profile;

      const joined = await window.CDIFirebase.joinCampaign(campaignId, campaignPass, profile, name);
      if (!joined?.campaign || !joined?.player) {
        resetPlayerLoginButton();
        return alert("Campanha ou senha inválida.");
      }
      const c = normalizeCampaign(joined.campaign);
      const p = joined.player;

      state.campaigns = [c, ...state.campaigns.filter(x => x.id !== c.id)];
      session = { role: "player", campaign: c, player: p, currentMaster: null, view: "sheet" };
      lastSavedCampaignJson = JSON.stringify(c);
      startPlayerPresence();
      toast(`Voce entrou na campanha ${c.name}.`);
      render();
    } catch (err) {
      resetPlayerLoginButton();
      alert(firebaseErrorMessage(err));
    }
    return;
  }
  const pc = document.getElementById("pc").value;
  const pw = document.getElementById("pw").value;
  const pp = document.getElementById("pp").value;
  const c = state.campaigns.find(x => x.id === pc);
  const p = c?.players.find(x => x.password === pp);

  if (!c || c.password !== pw || !p) return alert("Acesso inválido.");
  p.authUid ??= `local-${p.id}`;
  p.status = "claimed";
  p.online = true;
  p.lastSeen = new Date().toISOString();
  session = { role: "player", campaign: c, player: p, currentMaster: null, view: "sheet" };
  save();
  render();
}

function masterMenu() {
  const myCampaigns = getMasterCampaigns();
  if (usingFirebase() && !myCampaigns.length) {
    session.campaign = null;
    session.view = "home";
    return render();
  }
  if (!myCampaigns.length) return newCampaign(true);
  session.campaign = myCampaigns[0];
  session.view = "home";
  render();
}

// --- NAVEGAÇÃO E LAYOUT ---
function nav() {
  const m = session.role === "master";
  const items = m ? [
    ["messages","Mensagens"],
    ["room","Sala"],
    ["home","🏠 Visão Geral"], ["campaigns","📚 Campanhas"], ["characters","👤 Personagens"],
    ["skills","🎯 Habilidades"], ["diceLogs","🎲 Histórico"], ["cases","📁 Casos"],
    ["creatures","👹 Criaturas"], ["items","🎒 Itens"], ["evidence","🔎 Evidências"],
    ["marks","🏷️ Marcas"], ["transfers", "🤝 Permissões / Trocas"], ["players","🔐 Jogadores"], ["settings","⚙️ Configurações"]
  ] : [
    ["messages","Mensagens"],
    ["room","Sala"],
    ["sheet","👤 Meu Personagem"], ["inventory","🎒 Inventário"], ["evidencePlayer","🔎 Evidências"], ["transferPlayer","🤝 Dar Item/Evidência"]
  ];

  return `
    <div class="side">
      <div class="brand">🌑 Crônicas</div>
      <div class="role">${m ? `Mestre: ${esc(session.currentMaster?.name)}` : "Jogador"}</div>
      <div class="nav">${items.map(([v, t]) => `<button class="${session.view === v ? "active" : ""}" onclick="session.view='${v}';render()">${t}</button>`).join("")}</div>
      <button class="dice-btn" onclick="openDiceRoller()">🎲 Rolador</button>
      <hr style="border-color:var(--card-border); margin: 15px 0;">
      <button class="secondary" onclick="logout()">Sair</button>
    </div>`;
}

async function logout() {
  if (!usingFirebase() && session.role === "player" && session.player) {
    updateLocalPlayerPresence(false);
    save();
  }
  await stopPlayerPresence(true);
  if (unsubscribeCampaigns) unsubscribeCampaigns();
  unsubscribeCampaigns = null;
  lastSavedCampaignJson = "";
  lastRemoteCampaignJson = "";
  saveAgainAfterCurrent = false;
  if (usingFirebase()) {
    await window.CDIFirebase.signOut();
  }
  session = { role: null, campaign: null, player: null, currentMaster: null, view: "home" };
  home();
}

function render() {
  if (!session.role) return home();
  const c = session.campaign;
  if (c) {
    c.scenes ??= [];
    c.diceLogs ??= [];
    c.customSkills ??= [...OFFICIAL_SKILLS];
    c.items ??= [];
    c.evidence ??= [];
    c.itemTransfers ??= [];
  }
  root.innerHTML = `
    <div class="app">
      ${nav()}
      <section class="content">
        <div class="top">
          <div><h1>${esc(c ? c.name : "Configurações")}</h1><span class="muted">${session.role === "master" ? "Mestre" : "Jogador"}</span></div>
          <button class="secondary" onclick="logout()">Trocar Acesso</button>
        </div>
        ${session.role === "master" ? masterBody() : playerBody()}
      </section>
    </div>`;
}

// --- PAINEL DO MESTRE ---
function masterBody() {
  const v = session.view, c = session.campaign, myCampaigns = getMasterCampaigns();
  if (v === "settings") return masterSettingsPage();
  if (v === "campaigns") return campaignsPage();
  if (v === "campaign") return campaignPage();
  if (v === "transfers") return masterTransfersPage();
  if (!c) return `<h2>Visão Geral</h2><p class="muted">Nenhuma campanha criada.</p><button onclick="newCampaign()">➕ Criar Campanha</button>`;

  const views = {
    messages: messagesPage, room: roomPage, characters: charactersPage, skills: masterSkillsManagerPage, diceLogs: masterDiceLogsPage,
    cases: () => recordsPage("cases", "📁 Casos"), creatures: creaturesPage,
    items: itemsMasterPage, evidence: evidencePage, marks: marksPage, players: playersPage
  };

  if (views[v]) return views[v]();

  return `
    <h2>Visão Geral</h2>
    <div class="grid" style="margin-top:15px;">
      <div class="card"><h3>📚 Campanhas</h3><h2>${myCampaigns.length}</h2></div>
      <div class="card"><h3>👤 Personagens</h3><h2>${c.characters.length}</h2></div>
      <div class="card"><h3>👹 Criaturas</h3><h2>${c.creatures.length}</h2></div>
      <div class="card"><h3>🔎 Evidências</h3><h2>${c.evidence.length}</h2></div>
    </div>`;
}

function masterTransfersPage() {
  const c = session.campaign;
  c.itemTransfers ??= [];
  const pending = c.itemTransfers.filter(t => t.status === "pending");
  const history = c.itemTransfers.filter(t => t.status !== "pending");

  return `
    <h2>🤝 Gerenciamento de Permissões e Trocas</h2>
    <p class="muted">Aprove ou rejeite solicitações de jogadores que desejam entregar itens ou evidências entre si ou para o grupo.</p>
    
    <h3>⏳ Solicitações Pendentes</h3>
    <div class="grid" style="margin-top:15px;">
      ${pending.length === 0 ? '<p class="muted">Nenhuma solicitação pendente no momento.</p>' : ''}
      ${pending.map(t => `
        <div class="card" style="border-left: 4px solid var(--accent);">
          ${t.image ? `<img class="avatar" src="${t.image}" style="cursor:pointer;" onclick="openImageModal(${jsArg(t.image)}, ${jsArg(t.itemName)})">` : ""}
          <h3>${esc(t.itemName)}</h3>
          <p class="muted">Tipo: <b>${t.type === 'item' ? 'Item' : 'Evidência'}</b></p>
          <p>De: <b>${esc(t.fromName)}</b> ➡️ Para: <b>${esc(t.toName)}</b></p>
          <p style="font-size:13px; margin: 8px 0;"><i>"${esc(t.message || 'Sem observações')}"</i></p>
          <div style="display:flex; gap:8px; margin-top:10px;">
            <button onclick="resolveTransfer('${t.id}', 'approved')">✅ Aprovar</button>
            <button class="danger" onclick="resolveTransfer('${t.id}', 'rejected')">❌ Rejeitar</button>
          </div>
        </div>`).join("")}
    </div>

    <h3 style="margin-top:30px;">📜 Histórico de Transferências</h3>
    <div class="grid" style="margin-top:15px;">
      ${history.length === 0 ? '<p class="muted">Nenhum histórico registrado.</p>' : ''}
      ${history.map(t => `
        <div class="card" style="opacity: 0.8;">
          <h3>${esc(t.itemName)} (${t.status === 'approved' ? '✅ Aprovado' : '❌ Rejeitado'})</h3>
          <p>De: <b>${esc(t.fromName)}</b> ➡️ Para: <b>${esc(t.toName)}</b></p>
          <span class="muted" style="font-size:11px;">${t.time}</span>
        </div>`).join("")}
    </div>`;
}

function resolveTransfer(transferId, status) {
  const c = session.campaign;
  const t = c.itemTransfers.find(x => x.id === transferId);
  if (!t) return;

  if (status === 'approved') {
    if (t.type === 'item' && t.fromCharacterId && t.toCharacterId && t.inventoryId) {
      try {
        tabletop.transferInventoryItem(
          c,
          t.fromCharacterId,
          t.toCharacterId,
          t.inventoryId,
          t.quantity || 1,
          uid
        );
      } catch (err) {
        return alert(`Nao foi possivel concluir a transferencia: ${err.message}`);
      }
    } else if (t.type === 'item') {
      let targetItem = c.items.find(i => i.name.toLowerCase() === t.itemName.toLowerCase());
      if (!targetItem) {
        c.items.push({ id: uid(), name: t.itemName, description: t.description || "Item transferido.", revealed: true, image: t.image || "" });
      } else {
        targetItem.revealed = true;
      }
    } else if (t.type === 'evidence') {
      let targetEv = c.evidence.find(e => e.name.toLowerCase() === t.itemName.toLowerCase());
      if (!targetEv) {
        c.evidence.push({ id: uid(), name: t.itemName, description: t.description || "Evidência transferida.", revealed: true, image: t.image || "" });
      } else {
        targetEv.revealed = true;
      }
    }
    toast("Transferencia aprovada e aplicada!");
  } else {
    toast("Transferencia rejeitada.");
  }

  t.status = status;
  const now = new Date();
  t.time = `${now.toLocaleDateString()} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

  save();
  render();
}

function masterSkillsManagerPage() {
  const c = session.campaign;
  return `
    <h2>🎯 Gerenciamento de Habilidades</h2>
    <button onclick="openCreateSkillModal()">➕ Adicionar Habilidade</button>
    <div class="grid" style="margin-top:15px;">
      ${c.customSkills.map((sk, i) => `
        <div class="card" style="display:flex; justify-content:space-between; align-items:center; padding:15px; margin:0;">
          <span><b>${esc(sk)}</b></span>
          <button class="danger" style="padding:4px 8px; font-size:11px;" onclick="deleteCampaignSkill(${i})">Excluir</button>
        </div>`).join("")}
    </div>`;
}

function openCreateSkillModal() {
  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2>➕ Nova Habilidade</h2>
      <label>Ícone</label><select id="newSkIcon">${ICONS_LIST.map(ic => `<option value="${ic}">${ic}</option>`).join("")}</select>
      <label>Nome</label><input id="newSkName">
      <br><br>
      <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
      <button onclick="saveNewCampaignSkill()">Salvar</button>
    </div></div>`);
}

function saveNewCampaignSkill() {
  const icon = document.getElementById("newSkIcon").value;
  const name = document.getElementById("newSkName").value.trim();
  if (!name) return alert("Digite o nome.");
  
  const c = session.campaign;
  const fullName = `${icon} ${name}`;
  if (c.customSkills.includes(fullName)) return alert("Já existe.");

  c.customSkills.push(fullName);
  save(); document.querySelector(".modal").remove(); render(); toast("Habilidade adicionada!");
}

function deleteCampaignSkill(i) {
  if (confirm("Excluir habilidade?")) {
    session.campaign.customSkills.splice(i, 1);
    save(); render(); toast("Removida!");
  }
}

function masterDiceLogsPage() {
  const logs = session.campaign.diceLogs || [];
  return `
    <h2>🎲 Histórico de Rolagens</h2>
    <div style="display:flex; gap:10px; margin-bottom:15px;">
      <button class="danger" onclick="clearCampaignDiceLogs()">🧹 Limpar Histórico desta Campanha</button>
      <button class="danger" onclick="clearAllMastersDiceLogs()">🔥 Limpar Histórico Global (Todas as Campanhas)</button>
    </div>
    <div class="card">
      ${logs.length === 0 ? '<p class="muted">Nenhuma rolagem registrada.</p>' : ''}
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${logs.map(l => `
          <div style="padding:10px; border-bottom:1px solid var(--card-border); display:flex; justify-content:space-between;">
            <div><b>${esc(l.author)}</b> rolou <i>${esc(l.label || 'dado')}</i>: <span style="color:var(--accent); font-weight:bold;">${l.total}</span> <span class="muted" style="font-size:12px;">(d${l.sides}${l.bonusText})</span></div>
            <span class="muted" style="font-size:11px;">${l.time}</span>
          </div>`).join("")}
      </div>
    </div>`;
}

function clearCampaignDiceLogs() {
  if (confirm("Apagar histórico desta campanha?")) { 
    session.campaign.diceLogs = []; 
    save(); 
    render(); 
    toast("Histórico da campanha limpo!"); 
  }
}

function clearAllMastersDiceLogs() {
  if (confirm("ATENÇÃO: Deseja apagar o histórico de rolagens de TODAS as campanhas deste Mestre?")) {
    state.campaigns.forEach(c => {
      if (c.masterId === session.currentMaster.id) {
        c.diceLogs = [];
      }
    });
    save();
    render();
    toast("Todo o histórico de dados foi limpo!");
  }
}

function masterSettingsPage() {
  return `
    <h2>⚙️ Configurações</h2>
    <div class="card" style="margin-bottom:20px;">
      <h3>🔑 Alterar Senha</h3>
      <label>Nova Senha</label><input id="newMasterPass" type="password">
      <br><br><button onclick="saveMasterPassword()">Salvar</button>
    </div>

    <div class="card" style="border-color: var(--danger, #ff4d4d); background: rgba(255, 77, 77, 0.03);">
      <h3 style="color: var(--danger, #ff4d4d);">⚠️ Zona de Perigo</h3>
      <p class="muted" style="margin-bottom: 15px;">Apagar sua conta de Mestre removerá permanentemente seu perfil e todas as campanhas, fichas e dados associados a ele.</p>
      <button class="danger" onclick="deleteMasterAccountModal()">🗑️ Apagar Conta de Mestre</button>
    </div>`;
}

function deleteMasterAccountModal() {
  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2 style="color: var(--danger, #ff4d4d);">⚠️ Excluir Conta de Mestre</h2>
      <p class="muted">Para confirmar a exclusão definitiva da sua conta e de todas as suas campanhas, digite sua senha atual:</p>
      <label>Senha Atual</label>
      <input id="confirmMasterDelPass" type="password" placeholder="Sua senha">
      <br><br>
      <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
      <button class="danger" onclick="executeDeleteMasterAccount()">Confirmar Exclusão</button>
    </div></div>`);
}

async function executeDeleteMasterAccount() {
  if (usingFirebase()) {
    if (!confirm("Confirmar exclusao da conta Firebase e campanhas deste mestre?")) return;
    try {
      const ids = getMasterCampaigns().map(c => c.id);
      for (const id of ids) await window.CDIFirebase.deleteCampaign(id);
      await window.CDIFirebase.deleteCurrentUser();
      state.campaigns = [];
      persistLocal();
      document.querySelectorAll(".modal").forEach(m => m.remove());
      toast("Conta de Mestre excluida com sucesso.");
      home();
    } catch (err) {
      alert(firebaseErrorMessage(err));
    }
    return;
  }
  const pass = document.getElementById("confirmMasterDelPass").value;
  const target = state.masters.find(m => m.id === session.currentMaster.id);

  if (!target || target.password !== pass) {
    alert("Senha incorreta! A exclusão foi cancelada.");
    return;
  }

  // Remove campanhas do mestre
  state.campaigns = state.campaigns.filter(c => c.masterId !== session.currentMaster.id);
  // Remove o mestre
  state.masters = state.masters.filter(m => m.id !== session.currentMaster.id);

  save();
  document.querySelectorAll(".modal").forEach(m => m.remove());
  toast("Conta de Mestre excluída com sucesso.");
  home();
}

function saveMasterPassword() {
  const pass = document.getElementById("newMasterPass").value.trim();
  if (!pass) return alert("Vazio.");
  if (usingFirebase()) {
    window.CDIFirebase.updateCurrentPassword(pass)
      .then(() => toast("Senha alterada no Firebase!"))
      .catch(err => alert(firebaseErrorMessage(err)));
    return;
  }
  const m = state.masters.find(x => x.id === session.currentMaster.id);
  if (m) { m.password = pass; session.currentMaster.password = pass; save(); toast("Senha alterada!"); }
}

function campaignsPage() {
  return `
    <h2>📚 Campanhas</h2><button onclick="newCampaign()">➕ Nova Campanha</button>
    <div class="grid" style="margin-top:15px;">
      ${getMasterCampaigns().map(c => `
        <div class="card">
          <h3>${esc(c.name)}</h3>
          <p class="muted">👤 ${c.characters.length} personagens</p>
          <label>ID para jogadores</label>
          <input readonly value="${esc(c.id)}" onclick="this.select()">
          <button onclick="openCampaign('${esc(c.id)}')">Abrir</button>
          <button class="secondary" onclick="copyCampaignId('${esc(c.id)}')">Copiar ID</button>
          <button class="danger" onclick="deleteCampaign('${c.id}')">Excluir</button>
        </div>`).join("")}
    </div>`;
}

function campaignPage() {
  const c = session.campaign;
  return `
    <h2>📚 ${esc(c.name)}</h2>
    <div class="card">
      <label>ID da Campanha para jogadores</label><input readonly value="${esc(c.id)}" onclick="this.select()">
      <button class="secondary" onclick="copyCampaignId('${esc(c.id)}')">Copiar ID da Campanha</button>
      <label>Nome</label><input id="campName" value="${esc(c.name)}">
      <label>Senha</label><input id="campPass" value="${esc(c.password)}">
      <label>Descrição</label><textarea id="campDesc">${esc(c.description)}</textarea>
      <br><button onclick="cSave()">Salvar</button>
    </div>`;
}

function cSave() {
  const c = session.campaign;
  c.name = document.getElementById("campName").value;
  c.password = document.getElementById("campPass").value;
  c.description = document.getElementById("campDesc").value;
  save(); render(); toast("Salvo!");
}

function newCampaign(first = false) {
  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2>📚 Nova Campanha</h2>
      <label>Nome</label><input id="cn">
      <label>Senha</label><input id="cp" type="password">
      <label>Descrição</label><textarea id="cd"></textarea>
      <br><button onclick="createCampaign()">Criar</button>
      ${first ? "" : "<button class='secondary' onclick='this.closest(\".modal\").remove()'>Cancelar</button>"}
    </div></div>`);
}

async function createCampaign() {
  const c = {
    id: uid(), masterId: session.currentMaster.id,
    name: document.getElementById("cn").value || "Campanha",
    password: document.getElementById("cp").value || "123",
    description: document.getElementById("cd").value || "",
    members: [session.currentMaster.id],
    players: [], characters: [], cases: [], creatures: [], items: [], evidence: [], marks: [], diceLogs: [], messages: [], scenes: [],
    itemTransfers: [], customSkills: [...OFFICIAL_SKILLS]
  };
  normalizeCampaign(c);
  state.campaigns.push(c);
  session.campaign = c;
  session.view = "campaign";
  persistLocal();

  if (usingFirebase()) {
    try {
      await window.CDIFirebase.saveCampaign(c);
      lastSavedCampaignJson = JSON.stringify(c);
    } catch (err) {
      state.campaigns = state.campaigns.filter(x => x.id !== c.id);
      session.campaign = null;
      alert(firebaseErrorMessage(err));
      return;
    }
  } else {
    save();
  }

  document.querySelectorAll(".modal").forEach(m => m.remove());
  render();
  toast("Campanha criada! Compartilhe o ID com os jogadores.");
}

async function deleteCampaign(id) {
  if (confirm("Excluir campanha?")) {
    state.campaigns = state.campaigns.filter(c => c.id !== id);
    session.campaign = getMasterCampaigns()[0] || null;
    persistLocal();
    if (usingFirebase()) {
      try { await window.CDIFirebase.deleteCampaign(id); }
      catch (err) { alert(firebaseErrorMessage(err)); }
    }
    render();
  }
}

// --- PERSONAGENS ---
function charactersPage() {
  const c = session.campaign;
  return `
    <h2>👤 Personagens</h2><button onclick="characterModal()">➕ Criar Personagem</button>
    <div class="grid" style="margin-top:15px;">
      ${c.characters.map((x, i) => {
        const controller = c.players.find(player => player.id === x.controllerPlayerId && player.characterId === x.id);
        return `
        <div class="card">
          ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal(${jsArg(x.image)}, ${jsArg(x.name)})">` : ""}
          <h3>${esc(x.name)}</h3><span class="tag">${esc(x.origin)}</span>
          <p style="margin-top:8px;">❤️ ${x.health}/${x.healthMax} · 🧠 ${x.sanity}/${x.sanityMax}</p><br>
          <p class="muted">${controller ? `Controlado por ${esc(controller.name)}` : "Sem jogador vinculado"} · ${x.inventory.length} item${x.inventory.length === 1 ? "" : "s"}</p>
          <button onclick="characterModal(${i})">Ficha</button>
          <button class="secondary" onclick="manageCharacterInventoryModal('${x.id}')">Inventario</button>
          <button class="danger" onclick="del('characters',${i})">Excluir</button>
        </div>`;
      }).join("")}
    </div>`;
}

function characterModal(index = null) {
  const c = session.campaign;
  const x = index === null ? { name: "", origin: ORIGINS[0], healthMax: 20, health: 20, sanityMax: 10, sanity: 10, defense: 10, attrs: {}, res: {}, skills: [], expressions: [], activeExpression: "", inventory: [], controllerPlayerId: null } : c.characters[index];
  x.skills ??= [];

  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2>👑 Ficha (Mestre)</h2>
      ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal(${jsArg(x.image)}, ${jsArg(x.name)})">` : ""}
      <label>Nome</label><input id="cname" value="${esc(x.name)}">
      ${imgInput("photo", "Imagem")}
      <label>Origem</label><select id="origin">${ORIGINS.map(o => `<option ${o === x.origin ? "selected" : ""}>${o}</option>`).join("")}</select>
      <div class="two">
        <div><label>Saúde Máx</label><input id="hm" type="number" value="${x.healthMax}"></div>
        <div><label>Saúde Atual</label><input id="hv" type="number" value="${x.health}"></div>
        <div><label>Sanidade Máx</label><input id="sm" type="number" value="${x.sanityMax}"></div>
        <div><label>Sanidade Atual</label><input id="sv" type="number" value="${x.sanity}"></div>
      </div>
      <label>🛡️ Defesa</label><input id="cdef" type="number" value="${x.defense ?? 10}">
      <h3>📊 Atributos</h3><div class="two">${ATTR.map(a => `<div><label>${a}</label><input id="a_${a}" type="number" value="${x.attrs[a] ?? 0}"></div>`).join("")}</div>
      <h3>🛡️ Resistências</h3><div class="two">${RES.map(a => `<div><label>${a}</label><input id="r_${a}" type="number" value="${x.res[a] ?? 0}"></div>`).join("")}</div>
      
      <h3>🎯 Habilidades</h3>
      <div class="skills-selector">
        ${(c.customSkills || OFFICIAL_SKILLS).map(sk => `
          <label><input type="checkbox" class="master-sk-check" value="${esc(sk)}" ${x.skills.some(s => s.name === sk) ? "checked" : ""}> ${esc(sk)}</label>`).join("")}
      </div>

      <div style="margin-top:10px;">
        ${x.skills.map((s, idx) => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:6px; border-bottom:1px solid var(--card-border);">
            <span><b>${esc(s.name)}</b></span>
            <div style="display:flex; align-items:center; gap:5px;">
              <span>Máx:</span><input type="number" id="sk_max_${idx}" value="${s.maxUses ?? 2}" style="width:45px;">
              ${index !== null ? `<button class="danger" onclick="removeSkill('${x.id}', ${idx})">✕</button>` : ''}
            </div>
          </div>`).join("")}
      </div>

      <br><button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
      <button onclick="saveCharacter(${index})">Salvar</button>
    </div></div>`);
}

async function saveCharacter(index) {
  const isNew = index === null;
  const c = isNew ? { id: uid(), attrs: {}, res: {}, skills: [], expressions: [], activeExpression: "", inventory: [], controllerPlayerId: null } : session.campaign.characters[index];
  
  c.name = document.getElementById("cname").value || "Personagem";
  c.origin = document.getElementById("origin").value;
  c.healthMax = +document.getElementById("hm").value;
  c.health = Math.max(0, Math.min(c.healthMax, +document.getElementById("hv").value));
  c.sanityMax = +document.getElementById("sm").value;
  c.sanity = Math.max(0, Math.min(c.sanityMax, +document.getElementById("sv").value));
  c.defense = +document.getElementById("cdef").value || 10;
  
  ATTR.forEach(a => c.attrs[a] = +document.getElementById("a_" + a).value);
  RES.forEach(a => c.res[a] = +document.getElementById("r_" + a).value);
  
  const checked = Array.from(document.querySelectorAll('.master-sk-check:checked')).map(cb => cb.value);
  c.skills = checked.map(name => c.skills.find(s => s.name === name) || { name, uses: 2, maxUses: 2, bonus: 0 });

  c.skills.forEach((s, idx) => {
    const maxInput = document.getElementById(`sk_max_${idx}`);
    if (maxInput) { s.maxUses = parseInt(maxInput.value) || 0; if (s.uses > s.maxUses) s.uses = s.maxUses; }
  });

  const im = await readImg(document.getElementById("photo").files[0]);
  if (im) c.image = im;

  if (isNew) session.campaign.characters.push(c);
  save(); document.querySelector(".modal").remove(); render(); toast("Salvo!");
}

function removeSkill(charId, idx) {
  const ch = session.campaign.characters.find(x => x.id === charId);
  ch.skills.splice(idx, 1);
  save(); render();
}

function messagesPage() {
  const c = session.campaign;
  c.messages ??= [];
  const messages = c.messages.slice(0, 80);
  return `
    <h2>💬 Mensagens</h2>
    <div class="card chat-panel">
      <div class="chat-list">
        ${messages.length === 0 ? '<p class="muted">Nenhuma mensagem enviada ainda.</p>' : messages.map(m => `
          <div class="chat-message">
            <div><b>${esc(m.author)}</b> <span class="muted">${esc(m.time || "")}</span></div>
            <p>${esc(m.text)}</p>
          </div>`).join("")}
      </div>
      <div class="chat-compose">
        <input id="msgText" placeholder="Escreva uma mensagem para a mesa" onkeydown="if(event.key==='Enter') sendMessage()">
        <button onclick="sendMessage()">Enviar</button>
      </div>
    </div>`;
}

function sendMessage() {
  const input = document.getElementById("msgText");
  const text = input.value.trim();
  if (!text) return;
  const now = new Date();
  const author = session.role === "master"
    ? `Mestre (${session.currentMaster?.name || "Mestre"})`
    : (session.player?.name || firebaseProfile?.name || "Jogador");

  session.campaign.messages ??= [];
  session.campaign.messages.unshift({
    id: uid(),
    author,
    authorId: firebaseUser?.uid || session.currentMaster?.id || session.player?.id || "",
    text,
    time: `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`
  });
  if (session.campaign.messages.length > 100) session.campaign.messages.pop();
  save();
  render();
}

function formatLastSeen(value) {
  if (!value) return "Sem registro";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sem registro";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function roomPage() {
  const c = session.campaign;
  const participants = tabletop?.getControlledParticipants(c) || [];
  const statusLabels = { online: "Online", away: "Ausente", offline: "Offline" };
  const claimedWithoutCharacter = c.players.filter(player => player.authUid && !player.characterId).length;

  return `
    <div class="page-heading">
      <div>
        <h2>Sala</h2>
        <p class="muted">${participants.length} personagem${participants.length === 1 ? "" : "s"} em jogo</p>
      </div>
      ${session.role === "master" && claimedWithoutCharacter
        ? `<span class="notice-badge">${claimedWithoutCharacter} jogador${claimedWithoutCharacter === 1 ? "" : "es"} sem personagem</span>`
        : ""}
    </div>
    <div class="participant-grid">
      ${participants.map(({ player, character, presence }) => `
        <article class="participant-card">
          ${character.image
            ? `<img class="participant-avatar" src="${character.image}" alt="${esc(character.name)}">`
            : `<div class="participant-avatar participant-avatar-fallback" aria-hidden="true">${esc(character.name.slice(0, 1).toUpperCase())}</div>`}
          <div class="participant-info">
            <div class="participant-title">
              <h3>${esc(character.name)}</h3>
              <span class="presence presence-${presence}"><span class="presence-dot"></span>${statusLabels[presence]}</span>
            </div>
            <p>${esc(character.origin || "Origem nao definida")}</p>
            <div class="participant-meta">
              <span>Jogador: <b>${esc(player.name)}</b></span>
              <span>Ultima atividade: ${esc(formatLastSeen(player.lastSeen))}</span>
            </div>
          </div>
        </article>`).join("") || `
        <div class="empty-state">
          <h3>Nenhum personagem em jogo</h3>
          <p class="muted">A sala exibira os personagens assim que os jogadores vinculados entrarem.</p>
        </div>`}
    </div>`;
}

// --- PAINEL DO JOGADOR ---
function playerBody() {
  const v = session.view;
  if (v === "messages") return messagesPage();
  if (v === "room") return roomPage();
  const ch = session.campaign.characters.find(x => x.id === session.player.characterId);
  if (!ch) {
    return `
      <h2>👤 Meu Personagem</h2>
      <p class="muted">Você ainda não está vinculado a nenhum personagem desta campanha. Peça ao Mestre para associá-lo.</p>`;
  }
  if (v === "inventory") return inventoryPlayer(ch);
  if (v === "evidencePlayer") return evidencePlayer(ch);
  if (v === "transferPlayer") return transferPlayerPage(ch);
  return sheetPlayer(ch);
}

function transferPlayerPage(ch) {
  const c = session.campaign;
  c.itemTransfers ??= [];
  const myTransfers = c.itemTransfers.filter(t => t.fromPlayerId === session.player.id);
  const otherParticipants = (tabletop?.getControlledParticipants(c) || []).filter(entry => entry.character.id !== ch.id);
  const inventory = ch.inventory || [];
  const visibleEvidence = (c.evidence || []).filter(entry => entry.revealed);

  return `
    <h2>🤝 Entregar Item ou Evidência</h2>
    <p class="muted">As entregas ficam pendentes ate a aprovacao do Mestre.</p>

    <div class="card" style="margin-top:15px;">
      <h3>Nova solicitacao</h3>
      <label>Tipo de Objeto</label>
      <select id="trType" onchange="toggleTransferType()">
        <option value="item">Item do inventario</option>
        <option value="evidence">Evidencia</option>
      </select>

      <div id="trItemFields">
        <label>Item</label>
        <select id="trInventoryId" ${inventory.length ? "" : "disabled"}>
          ${inventory.map(item => `<option value="${item.id}">${esc(item.name)} (${item.quantity}x)</option>`).join("") || `<option value="">Inventario vazio</option>`}
        </select>
        <label>Quantidade</label><input id="trQuantity" type="number" min="1" value="1">
      </div>

      <div id="trEvidenceFields" hidden>
        <label>Evidencia</label>
        <select id="trEvidenceId" ${visibleEvidence.length ? "" : "disabled"}>
          ${visibleEvidence.map(evidence => `<option value="${evidence.id}">${esc(evidence.name)}</option>`).join("") || `<option value="">Nenhuma evidencia revelada</option>`}
        </select>
      </div>

      <label>Entregar para:</label>
      <select id="trTarget">
        <option value="">Grupo / Geral</option>
        ${otherParticipants.map(({ player, character }) => `<option value="${character.id}">${esc(character.name)} - ${esc(player.name)}</option>`).join("")}
      </select>

      <label>Observacao para o Mestre</label>
      <input id="trMsg" placeholder="Detalhes da entrega">

      <br><br>
      <button onclick="submitPlayerTransfer('${ch.id}')">Enviar solicitacao</button>
    </div>

    <h3 style="margin-top:30px;">📋 Suas Solicitações Recentes</h3>
    <div class="grid" style="margin-top:10px;">
      ${myTransfers.length === 0 ? '<p class="muted">Nenhuma solicitação enviada.</p>' : ''}
      ${myTransfers.map(t => `
        <div class="card" style="margin:0; opacity: 0.9;">
          ${t.image ? `<img class="avatar" src="${t.image}" style="cursor:pointer;" onclick="openImageModal(${jsArg(t.image)}, ${jsArg(t.itemName)})">` : ""}
          <h3>${esc(t.itemName)} (${t.status === 'pending' ? '⏳ Pendente' : t.status === 'approved' ? '✅ Aprovado' : '❌ Rejeitado'})</h3>
          <p class="muted">Para: <b>${esc(t.toName)}</b></p>
          <p style="font-size:12px;">${esc(t.message || '')}</p>
        </div>`).join("")}
    </div>`;
}

function toggleTransferType() {
  const isItem = document.getElementById("trType")?.value === "item";
  const itemFields = document.getElementById("trItemFields");
  const evidenceFields = document.getElementById("trEvidenceFields");
  if (itemFields) itemFields.hidden = !isItem;
  if (evidenceFields) evidenceFields.hidden = isItem;
}

async function submitPlayerTransfer(fromCharacterId) {
  const type = document.getElementById("trType").value;
  const fromCharacter = session.campaign.characters.find(entry => entry.id === fromCharacterId);
  const toCharacterId = document.getElementById("trTarget").value || null;
  const toCharacter = session.campaign.characters.find(entry => entry.id === toCharacterId);
  const message = document.getElementById("trMsg").value.trim();
  if (!fromCharacter) return alert("Personagem de origem nao encontrado.");

  let source;
  let quantity = 1;
  if (type === "item") {
    source = fromCharacter.inventory.find(entry => entry.id === document.getElementById("trInventoryId").value);
    if (!source) return alert("Escolha um item do seu inventario.");
    if (!toCharacter) return alert("Escolha o personagem que recebera o item.");
    quantity = Math.max(1, Number.parseInt(document.getElementById("trQuantity").value, 10) || 1);
    if (quantity > source.quantity) return alert("A quantidade informada e maior que a disponivel.");
  } else {
    source = session.campaign.evidence.find(entry => entry.id === document.getElementById("trEvidenceId").value);
    if (!source) return alert("Escolha uma evidencia revelada.");
  }

  const targetPlayer = toCharacter
    ? session.campaign.players.find(player => player.characterId === toCharacter.id)
    : null;

  session.campaign.itemTransfers ??= [];
  session.campaign.itemTransfers.unshift({
    id: uid(),
    fromPlayerId: session.player.id,
    fromCharacterId: fromCharacter.id,
    fromName: fromCharacter.name,
    type,
    inventoryId: type === "item" ? source.id : null,
    evidenceId: type === "evidence" ? source.id : null,
    quantity,
    itemName: source.name,
    description: source.description || "",
    image: source.image || "",
    toCharacterId,
    toPlayerId: targetPlayer?.id || null,
    toName: toCharacter?.name || "Grupo / Geral",
    message,
    status: "pending",
    time: "Pendente de aprovação"
  });

  save();
  toast("Solicitação enviada ao Mestre com sucesso!");
  render();
}

function sheetPlayer(ch) {
  ch.skills ??= [];
  return `
    <h2>👤 ${esc(ch.name)}</h2>
    ${ch.image ? `<img class="avatar" src="${ch.image}" style="cursor:pointer;" onclick="openImageModal(${jsArg(ch.image)}, ${jsArg(ch.name)})">` : ""}
    <span class="tag">Origem: ${esc(ch.origin)}</span>
    <div class="grid" style="margin-top:15px;">
      <div class="card"><h3>❤️ Saúde</h3><h2 id="val-health">${ch.health}/${ch.healthMax}</h2><div class="bar"><div id="bar-health" class="fill health" style="width:${(ch.health/ch.healthMax)*100}%"></div></div><button onclick="changeStatDirect('health',-1)">−</button><button onclick="changeStatDirect('health',1)">+</button></div>
      <div class="card"><h3>🧠 Sanidade</h3><h2 id="val-sanity">${ch.sanity}/${ch.sanityMax}</h2><div class="bar"><div id="bar-sanity" class="fill sanity" style="width:${(ch.sanity/ch.sanityMax)*100}%"></div></div><button onclick="changeStatDirect('sanity',-1)">−</button><button onclick="changeStatDirect('sanity',1)">+</button></div>
      <div class="card"><h3>🛡️ Defesa</h3><h2>${ch.defense || 10}</h2></div>
    </div>
    <div class="grid" style="margin-top:15px;">
      <div class="card"><h3>📊 Atributos</h3>${Object.entries(ch.attrs).map(([k, v]) => `<div class="stat clickable-stat" onclick="rollAttribute(${jsArg(k)}, ${v})"><span>${esc(k)}</span><b>${v >= 0 ? '+' + v : v}</b></div>`).join("")}</div>
      <div class="card"><h3>🛡️ Resistências</h3>${Object.entries(ch.res).map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join("")}</div>
    </div>
    <div class="card" style="margin-top:15px;">
      <h3>🎯 Habilidades</h3>
      <div class="grid" style="margin-top:10px;">
        ${ch.skills.map((s, idx) => `
          <div class="card" style="margin:0; padding:10px;">
            <b class="clickable-stat" onclick="rollSkill(${jsArg(s.name)}, ${s.bonus || 0})">${esc(s.name)}</b>
            <div style="margin-top:8px; display:flex; align-items:center; gap:8px;">
              <span>Usos: <b>${s.uses}/${s.maxUses}</b></span>
              <button onclick="changeSkillUses('${ch.id}', ${idx}, -1)">−</button>
              <button onclick="changeSkillUses('${ch.id}', ${idx}, 1)">+</button>
            </div>
          </div>`).join("") || "<p class='muted'>Nenhuma habilidade.</p>"}
      </div>
    </div>`;
}

function changeSkillUses(charId, idx, delta) {
  const ch = session.campaign.characters.find(x => x.id === charId);
  const s = ch.skills[idx];
  s.uses = Math.max(0, Math.min(s.maxUses, s.uses + delta));
  save(); render();
}

function changeStatDirect(key, delta) {
  const ch = session.campaign.characters.find(x => x.id === session.player.characterId);
  ch[key] = Math.max(0, Math.min(ch[key + "Max"], ch[key] + delta));
  save();
  document.getElementById(`val-${key}`).textContent = `${ch[key]}/${ch[key + "Max"]}`;
  document.getElementById(`bar-${key}`).style.width = `${(ch[key] / ch[key + "Max"]) * 100}%`;
}

// --- ITENS, CASOS E EVIDÊNCIAS ---
function itemsMasterPage() {
  return `
    <h2>🎒 Itens</h2>
    <button onclick="itemModal()">➕ Criar</button>
    <div class="grid" style="margin-top:15px;">
      ${session.campaign.items.map((x, i) => `
        <div class="card">
          ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal(${jsArg(x.image)}, ${jsArg(x.name)})">` : ""}
          <h3>${esc(x.name)}</h3>
          <p>${esc(x.description)}</p>
          <label style="margin-top:10px; display:flex; align-items:center; gap:5px; font-size:12px;">
            <input type="checkbox" ${x.revealed ? "checked" : ""} onchange="toggleReveal('items', ${i}, this.checked)"> Visível para jogadores
          </label><br>
          <button onclick="deliverItemModal(${i})">Entregar</button>
          <button onclick="itemModal(${i})">Editar</button>
          <button class="danger" onclick="del('items', ${i})">Excluir</button>
        </div>`).join("")}
    </div>`;
}

function itemModal(index = null) {
  const x = index === null ? { name: "", description: "", revealed: false, image: "" } : session.campaign.items[index];
  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2>🎒 Item</h2>
      ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal(${jsArg(x.image)}, ${jsArg(x.name)})">` : ""}
      <label>Nome</label><input id="itname" value="${esc(x.name)}">
      <label>Descrição</label><textarea id="itdesc">${esc(x.description)}</textarea>
      ${imgInput("itimg", "Foto do Item")}
      <label style="margin-top:10px; display:flex; align-items:center; gap:5px;">
        <input type="checkbox" id="itrev" ${x.revealed ? "checked" : ""}> Visível para Jogadores
      </label>
      <br><br>
      <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
      <button onclick="saveItemModal(${index})">Salvar</button>
    </div></div>`);
}

async function saveItemModal(index) {
  const isNew = index === null;
  const x = isNew ? {} : session.campaign.items[index];
  x.name = document.getElementById("itname").value || "Item";
  x.description = document.getElementById("itdesc").value || "";
  x.revealed = document.getElementById("itrev").checked;

  const im = await readImg(document.getElementById("itimg").files[0]);
  if (im) x.image = im;

  if (isNew) session.campaign.items.push(x);
  save(); document.querySelector(".modal").remove(); render(); toast("Item salvo!");
}

function deliverItemModal(itemIndex) {
  const item = session.campaign.items[itemIndex];
  const characters = session.campaign.characters;
  if (!item) return;
  if (!characters.length) return alert("Crie um personagem antes de entregar itens.");

  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2>Entregar ${esc(item.name)}</h2>
      <label>Personagem</label>
      <select id="grantCharacterId">
        ${characters.map(character => {
          const player = session.campaign.players.find(entry => entry.characterId === character.id);
          return `<option value="${character.id}">${esc(character.name)}${player ? ` - ${esc(player.name)}` : ""}</option>`;
        }).join("")}
      </select>
      <div class="two">
        <div><label>Quantidade</label><input id="grantQuantity" type="number" min="1" value="1"></div>
        <div class="checkbox-field"><label><input id="grantEquipped" type="checkbox"> Entregar equipado</label></div>
      </div>
      <label>Observacoes</label><textarea id="grantNotes" placeholder="Carga, municao, estado ou detalhes especiais"></textarea>
      <div class="modal-actions">
        <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
        <button onclick="saveItemGrant(${itemIndex})">Entregar</button>
      </div>
    </div></div>`);
}

function saveItemGrant(itemIndex) {
  const item = session.campaign.items[itemIndex];
  const characterId = document.getElementById("grantCharacterId").value;
  try {
    tabletop.grantItem(session.campaign, characterId, item, {
      quantity: document.getElementById("grantQuantity").value,
      equipped: document.getElementById("grantEquipped").checked,
      notes: document.getElementById("grantNotes").value.trim()
    }, uid);
    save();
    document.querySelector(".modal").remove();
    render();
    toast("Item entregue ao personagem.");
  } catch (err) {
    alert(err.message);
  }
}

function manageCharacterInventoryModal(characterId) {
  const character = session.campaign.characters.find(entry => entry.id === characterId);
  if (!character) return;
  character.inventory ??= [];
  const catalog = session.campaign.items || [];

  root.insertAdjacentHTML("beforeend", `
    <div class="modal" id="inventoryManagerModal"><div class="modalbox modalbox-wide">
      <div class="modal-heading">
        <div><h2>Inventario de ${esc(character.name)}</h2><p class="muted">${character.inventory.length} tipo${character.inventory.length === 1 ? "" : "s"} de item</p></div>
        <button class="icon-button secondary" title="Fechar" aria-label="Fechar" onclick="this.closest('.modal').remove()">×</button>
      </div>

      <section class="inventory-add-band">
        <h3>Adicionar do catalogo</h3>
        ${catalog.length ? `
          <div class="inventory-add-grid">
            <select id="inventoryCatalogItem">${catalog.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join("")}</select>
            <input id="inventoryCatalogQuantity" type="number" min="1" value="1" aria-label="Quantidade">
            <button onclick="grantCatalogItemToCharacter('${character.id}')">Adicionar</button>
          </div>
          <label>Observacoes</label><input id="inventoryCatalogNotes" placeholder="Detalhes opcionais">`
          : `<p class="muted">Nenhum item cadastrado no catalogo.</p>`}
      </section>

      <div class="inventory-manager-list">
        ${character.inventory.map(entry => `
          <div class="inventory-manager-row">
            ${entry.image ? `<img src="${entry.image}" alt="${esc(entry.name)}">` : `<div class="inventory-item-fallback" aria-hidden="true">${esc(entry.name.slice(0, 1).toUpperCase())}</div>`}
            <div class="inventory-manager-main">
              <div class="card-title-row"><h3>${esc(entry.name)}</h3>${entry.equipped ? `<span class="status-chip status-online">Equipado</span>` : ""}</div>
              <p>${esc(entry.description)}</p>
              <div class="inventory-edit-grid">
                <div><label>Quantidade</label><input id="invQty_${entry.id}" type="number" min="1" value="${entry.quantity}"></div>
                <div><label>Observacoes</label><input id="invNotes_${entry.id}" value="${esc(entry.notes)}"></div>
              </div>
              <div class="row-actions">
                <button onclick="saveInventoryEntry('${character.id}','${entry.id}')">Salvar</button>
                <button class="secondary" onclick="toggleInventoryEquipped('${character.id}','${entry.id}')">${entry.equipped ? "Desequipar" : "Equipar"}</button>
                <button class="danger" onclick="removeCharacterInventoryItem('${character.id}','${entry.id}')">Remover</button>
              </div>
            </div>
          </div>`).join("") || `<div class="empty-state"><h3>Inventario vazio</h3></div>`}
      </div>
    </div></div>`);
}

function reopenInventoryManager(characterId, message) {
  save();
  render();
  manageCharacterInventoryModal(characterId);
  if (message) toast(message);
}

function grantCatalogItemToCharacter(characterId) {
  const itemId = document.getElementById("inventoryCatalogItem")?.value;
  const item = session.campaign.items.find(entry => entry.id === itemId);
  if (!item) return alert("Selecione um item do catalogo.");
  tabletop.grantItem(session.campaign, characterId, item, {
    quantity: document.getElementById("inventoryCatalogQuantity").value,
    notes: document.getElementById("inventoryCatalogNotes").value.trim()
  }, uid);
  reopenInventoryManager(characterId, "Item adicionado.");
}

function saveInventoryEntry(characterId, inventoryId) {
  tabletop.updateInventoryEntry(session.campaign, characterId, inventoryId, {
    quantity: document.getElementById(`invQty_${inventoryId}`).value,
    notes: document.getElementById(`invNotes_${inventoryId}`).value.trim()
  });
  reopenInventoryManager(characterId, "Inventario atualizado.");
}

function toggleInventoryEquipped(characterId, inventoryId) {
  const character = session.campaign.characters.find(entry => entry.id === characterId);
  const item = character?.inventory.find(entry => entry.id === inventoryId);
  if (!item) return;
  tabletop.updateInventoryEntry(session.campaign, characterId, inventoryId, { equipped: !item.equipped });
  reopenInventoryManager(characterId, item.equipped ? "Item equipado." : "Item desequipado.");
}

function removeCharacterInventoryItem(characterId, inventoryId) {
  if (!confirm("Remover este item do inventario?")) return;
  tabletop.removeInventoryEntry(session.campaign, characterId, inventoryId);
  reopenInventoryManager(characterId, "Item removido.");
}

function recordsPage(key, title) {
  return `
    <h2>${title}</h2>
    <button onclick="recordModal('${key}')">➕ Criar</button>
    <div class="grid" style="margin-top:15px;">
      ${session.campaign[key].map((x, i) => `
        <div class="card">
          ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal(${jsArg(x.image)}, ${jsArg(x.name)})">` : ""}
          <h3>${esc(x.name)}</h3>
          <p>${esc(x.description)}</p>
          <button onclick="recordModal('${key}', ${i})">Editar</button>
          <button class="danger" onclick="del('${key}', ${i})">Excluir</button>
        </div>`).join("")}
    </div>`;
}

function recordModal(key, index = null) {
  const x = index === null ? { name: "", description: "", image: "" } : session.campaign[key][index];
  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2>📁 Registro</h2>
      ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal(${jsArg(x.image)}, ${jsArg(x.name)})">` : ""}
      <label>Nome</label><input id="rn" value="${esc(x.name)}">
      <label>Descrição</label><textarea id="rd">${esc(x.description)}</textarea>
      ${imgInput("ri", "Foto / Documento")}
      <br><br>
      <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
      <button onclick="saveRecordModal('${key}', ${index})">Salvar</button>
    </div></div>`);
}

async function saveRecordModal(key, index) {
  const isNew = index === null;
  const x = isNew ? {} : session.campaign[key][index];
  x.name = document.getElementById("rn").value || "Registro";
  x.description = document.getElementById("rd").value || "";

  const im = await readImg(document.getElementById("ri").files[0]);
  if (im) x.image = im;

  if (isNew) session.campaign[key].push(x);
  save(); document.querySelector(".modal").remove(); render(); toast("Salvo!");
}

function creaturesPage() {
  return `
    <h2>👹 Criaturas</h2>
    <button onclick="creatureModal()">➕ Criar</button>
    <div class="grid" style="margin-top:15px;">
      ${session.campaign.creatures.map((x, i) => `
        <div class="card">
          ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal(${jsArg(x.image)}, ${jsArg(x.name)})">` : ""}
          <h3>${esc(x.name)}</h3>
          <p>${esc(x.appearance)}</p>
          <button onclick="creatureModal(${i})">Editar</button>
          <button class="danger" onclick="del('creatures', ${i})">Excluir</button>
        </div>`).join("")}
    </div>`;
}

function creatureModal(index = null) {
  const x = index === null ? { name: "", appearance: "", image: "" } : session.campaign.creatures[index];
  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2>👹 Criatura</h2>
      ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal(${jsArg(x.image)}, ${jsArg(x.name)})">` : ""}
      <label>Nome</label><input id="crname" value="${esc(x.name)}">
      <label>Aparência / Detalhes</label><textarea id="crapp">${esc(x.appearance)}</textarea>
      ${imgInput("crim", "Foto da Criatura")}
      <br><br>
      <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
      <button onclick="saveCreatureModal(${index})">Salvar</button>
    </div></div>`);
}

async function saveCreatureModal(index) {
  const isNew = index === null;
  const x = isNew ? {} : session.campaign.creatures[index];
  x.name = document.getElementById("crname").value || "Criatura";
  x.appearance = document.getElementById("crapp").value || "";

  const im = await readImg(document.getElementById("crim").files[0]);
  if (im) x.image = im;

  if (isNew) session.campaign.creatures.push(x);
  save(); document.querySelector(".modal").remove(); render(); toast("Salvo!");
}

function evidencePage() {
  return `
    <h2>🔎 Evidências</h2>
    <button onclick="evidenceModal()">➕ Criar</button>
    <div class="grid" style="margin-top:15px;">
      ${session.campaign.evidence.map((x, i) => `
        <div class="card">
          ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal(${jsArg(x.image)}, ${jsArg(x.name)})">` : ""}
          <h3>${esc(x.name)}</h3>
          <p>${esc(x.description)}</p>
          <label style="margin-top:10px; display:flex; align-items:center; gap:5px; font-size:12px;">
            <input type="checkbox" ${x.revealed ? "checked" : ""} onchange="toggleReveal('evidence', ${i}, this.checked)"> Visível para jogadores
          </label><br>
          <button onclick="evidenceModal(${i})">Editar</button>
          <button class="danger" onclick="del('evidence', ${i})">Excluir</button>
        </div>`).join("")}
    </div>`;
}

function evidenceModal(index = null) {
  const x = index === null ? { name: "", description: "", revealed: false, image: "" } : session.campaign.evidence[index];
  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2>🔎 Evidência</h2>
      ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal(${jsArg(x.image)}, ${jsArg(x.name)})">` : ""}
      <label>Nome</label><input id="evname" value="${esc(x.name)}">
      <label>Descrição</label><textarea id="evdesc">${esc(x.description)}</textarea>
      ${imgInput("evimg", "Foto da Evidência")}
      <label style="margin-top:10px; display:flex; align-items:center; gap:5px;">
        <input type="checkbox" id="evrev" ${x.revealed ? "checked" : ""}> Visível para Jogadores
      </label>
      <br><br>
      <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
      <button onclick="saveEvidenceModal(${index})">Salvar</button>
    </div></div>`);
}

async function saveEvidenceModal(index) {
  const isNew = index === null;
  const x = isNew ? {} : session.campaign.evidence[index];
  x.name = document.getElementById("evname").value || "Evidência";
  x.description = document.getElementById("evdesc").value || "";
  x.revealed = document.getElementById("evrev").checked;

  const im = await readImg(document.getElementById("evimg").files[0]);
  if (im) x.image = im;

  if (isNew) session.campaign.evidence.push(x);
  save(); document.querySelector(".modal").remove(); render(); toast("Evidência salva!");
}

function marksPage() {
  return `
    <h2>🏷️ Marcas</h2>
    <button onclick="markModal()">➕ Criar</button>
    <div class="grid" style="margin-top:15px;">
      ${session.campaign.marks.map((x, i) => `
        <div class="card">
          ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal(${jsArg(x.image)}, ${jsArg(x.name)})">` : ""}
          <h3>${esc(x.name)}</h3>
          <p>${esc(x.description)}</p>
          <button onclick="markModal(${i})">Editar</button>
          <button class="danger" onclick="del('marks', ${i})">Excluir</button>
        </div>`).join("")}
    </div>`;
}

function markModal(index = null) {
  const x = index === null ? { name: "", description: "", image: "" } : session.campaign.marks[index];
  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2>🏷️ Marca</h2>
      ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal(${jsArg(x.image)}, ${jsArg(x.name)})">` : ""}
      <label>Nome</label><input id="mkname" value="${esc(x.name)}">
      <label>Descrição</label><textarea id="mkdesc">${esc(x.description)}</textarea>
      ${imgInput("mkimg", "Foto da Marca")}
      <br><br>
      <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
      <button onclick="saveMarkModal(${index})">Salvar</button>
    </div></div>`);
}

async function saveMarkModal(index) {
  const isNew = index === null;
  const x = isNew ? {} : session.campaign.marks[index];
  x.name = document.getElementById("mkname").value || "Marca";
  x.description = document.getElementById("mkdesc").value || "";

  const im = await readImg(document.getElementById("mkimg").files[0]);
  if (im) x.image = im;

  if (isNew) session.campaign.marks.push(x);
  save(); document.querySelector(".modal").remove(); render(); toast("Salvo!");
}

function toggleReveal(key, i, val) {
  session.campaign[key][i].revealed = val;
  save(); toast("Atualizado!");
}

function playersPage() {
  const c = session.campaign;
  return `
    <h2>🔐 Jogadores</h2>
    <button onclick="newPlayerModal()">➕ Novo Jogador</button>
    <div class="grid" style="margin-top:15px;">
      ${c.players.map((p, i) => {
        const character = c.characters.find(ch => ch.id === p.characterId);
        const presence = tabletop?.presenceState(p) || "offline";
        return `
        <div class="card">
          <div class="card-title-row">
            <h3>${esc(p.name)}</h3>
            <span class="status-chip ${p.authUid ? `status-${presence}` : "status-pending"}">${p.authUid ? (presence === "online" ? "Online" : presence === "away" ? "Ausente" : "Offline") : "Convite pendente"}</span>
          </div>
          ${p.email ? `<p class="muted">${esc(p.email)}</p>` : ""}
          <p class="player-character-line">Personagem: <b>${character ? esc(character.name) : "Nenhum"}</b></p>
          <button onclick="linkPlayerModal(${i})">Vincular Personagem</button>
          ${character ? `<button class="secondary" onclick="manageCharacterInventoryModal('${character.id}')">Gerenciar Inventario</button>` : ""}
          <button class="danger" onclick="delPlayer(${i})">Remover</button>
        </div>`;
      }).join("") || `<div class="empty-state"><h3>Nenhum jogador configurado</h3></div>`}
    </div>`;
}

function newPlayerModal() {
  if (usingFirebase()) {
    root.insertAdjacentHTML("beforeend", `
      <div class="modal"><div class="modalbox">
        <h2>🔐 Jogador</h2>
        <label>Nome</label><input id="jn">
        <label>E-mail da conta Firebase</label><input id="je" type="email" placeholder="jogador@email.com">
        <br><br>
        <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
        <button onclick="saveNewPlayer()">Salvar</button>
      </div></div>`);
    return;
  }
  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2>🔐 Jogador</h2>
      <label>Nome</label><input id="jn">
      <label>Senha</label><input id="jp" type="password">
      <br><br>
      <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
      <button onclick="saveNewPlayer()">Salvar</button>
    </div></div>`);
}

function saveNewPlayer() {
  const name = document.getElementById("jn").value.trim();
  if (usingFirebase()) {
    const email = document.getElementById("je").value.trim();
    if (!name || !email) return alert("Preencha nome e e-mail.");
    const emailNormalized = tabletop.normalizeEmail(email);
    if (session.campaign.players.some(player => tabletop.normalizeEmail(player.emailNormalized || player.email) === emailNormalized)) {
      return alert("Ja existe um jogador configurado com este e-mail.");
    }
    session.campaign.players.push({
      id: uid(),
      name,
      email,
      emailNormalized,
      authUid: null,
      characterId: null,
      status: "pending",
      online: false,
      lastSeen: null,
      joinedAt: null
    });
    save(); document.querySelector(".modal").remove(); render(); toast("Jogador adicionado!");
    return;
  }
  const password = document.getElementById("jp").value;
  if (!name || !password) return alert("Preencha tudo.");
  session.campaign.players.push({ id: uid(), name, password, characterId: null });
  save(); document.querySelector(".modal").remove(); render(); toast("Jogador adicionado!");
}

function linkPlayerModal(playerIndex) {
  const p = session.campaign.players[playerIndex];
  const chars = session.campaign.characters;
  const assignedByCharacter = new Map(session.campaign.players
    .filter(player => player.id !== p.id && player.characterId)
    .map(player => [player.characterId, player.name]));
  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2>🔗 Vincular Personagem a ${esc(p.name)}</h2>
      <label>Personagem</label>
      <select id="linkCharSel">
        <option value="">Nenhum</option>
        ${chars.map(ch => {
          const assignedTo = assignedByCharacter.get(ch.id);
          return `<option value="${ch.id}" ${p.characterId === ch.id ? "selected" : ""} ${assignedTo ? "disabled" : ""}>${esc(ch.name)}${assignedTo ? ` - vinculado a ${esc(assignedTo)}` : ""}</option>`;
        }).join("")}
      </select>
      <br><br>
      <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
      <button onclick="saveLinkPlayer(${playerIndex})">Salvar</button>
    </div></div>`);
}

function saveLinkPlayer(playerIndex) {
  const chId = document.getElementById("linkCharSel").value;
  const player = session.campaign.players[playerIndex];
  try {
    tabletop.assignCharacter(session.campaign, player.id, chId || null);
    save(); document.querySelector(".modal").remove(); render(); toast(chId ? "Vinculado com sucesso!" : "Vinculo removido.");
  } catch (err) {
    alert(err.message);
  }
}

function delPlayer(i) {
  const player = session.campaign.players[i];
  if (!player || !confirm(`Remover ${player.name} da campanha?`)) return;
  tabletop.releasePlayer(session.campaign, player.id);
  if (player.authUid) session.campaign.members = (session.campaign.members || []).filter(id => id !== player.authUid);
  session.campaign.players.splice(i, 1);
  save(); render();
}

function del(key, i) {
  const target = session.campaign[key]?.[i];
  if (!target) return;
  const assignedPlayers = key === "characters"
    ? session.campaign.players.filter(player => player.characterId === target.id)
    : [];
  const warning = assignedPlayers.length
    ? `Excluir este personagem? O vinculo com ${assignedPlayers.map(player => player.name).join(", ")} tambem sera removido.`
    : "Excluir item?";
  if (!confirm(warning)) return;
  assignedPlayers.forEach(player => tabletop.releasePlayer(session.campaign, player.id));
  session.campaign[key].splice(i, 1);
  save(); render();
}

function inventoryPlayer(ch) {
  const items = ch.inventory || [];
  const sharedItems = (session.campaign.items || []).filter(item => item.revealed && !items.some(entry => entry.itemId === item.id));
  return `
    <h2>🎒 Inventário</h2>
    <div class="grid" style="margin-top:15px;">
      ${items.map(x => `
        <div class="card inventory-card">
          ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal(${jsArg(x.image)}, ${jsArg(x.name)})">` : ""}
          <div class="card-title-row">
            <h3>${esc(x.name)}</h3>
            <span class="quantity-chip">${x.quantity}x</span>
          </div>
          <p>${esc(x.description)}</p>
          ${x.notes ? `<p class="inventory-notes">${esc(x.notes)}</p>` : ""}
          ${x.equipped ? `<span class="status-chip status-online">Equipado</span>` : ""}
        </div>`).join("") || `<div class="empty-state"><h3>Inventario vazio</h3><p class="muted">O Mestre ainda nao entregou itens a este personagem.</p></div>`}
    </div>
    ${sharedItems.length ? `
      <h3 class="section-heading">Itens compartilhados da mesa</h3>
      <div class="grid">
        ${sharedItems.map(item => `
          <div class="card shared-item-card">
            ${item.image ? `<img class="avatar" src="${item.image}" style="cursor:pointer;" onclick="openImageModal(${jsArg(item.image)}, ${jsArg(item.name)})">` : ""}
            <h3>${esc(item.name)}</h3>
            <p>${esc(item.description)}</p>
          </div>`).join("")}
      </div>` : ""}`;
}

function evidencePlayer(ch) {
  const ev = (session.campaign.evidence || []).filter(x => x.revealed);
  return `
    <h2>🔎 Evidências</h2>
    <div class="grid" style="margin-top:15px;">
      ${ev.map(x => `
        <div class="card">
          ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal(${jsArg(x.image)}, ${jsArg(x.name)})">` : ""}
          <h3>${esc(x.name)}</h3>
          <p>${esc(x.description)}</p>
        </div>`).join("") || "<p class='muted'>Nenhuma evidência revelada.</p>"}
    </div>`;
}

// --- ROLADOR DE DADOS ---
function openDiceRoller() {
  const c = session.campaign;
  const logs = c?.diceLogs || [];
  root.insertAdjacentHTML("beforeend", `
    <div class="modal" id="diceModal"><div class="modalbox">🎲 Rolador de Dados
      <div class="grid" style="margin-top:10px;">
        ${[4, 6, 8, 10, 12, 20, 100].map(s => `<button onclick="rollDice(${s})">d${s}</button>`).join("")}
      </div>
      <div class="dice-result" id="diceResult" style="margin-top:15px; text-align:center;">Escolha um dado</div>
      <div id="diceHistory" style="font-size:12px; color:var(--muted); margin-top:10px;">${logs.slice(0, 5).map(l => `<b>${esc(l.author)}</b>: ${l.total}`).join("<br>") || "Sem rolagens."}</div>
      <button class="secondary" style="margin-top:15px;" onclick="document.getElementById('diceModal').remove()">Fechar</button>
    </div></div>`);
}

function rollDice(sides, bonus = 0, label = "") {
  const die = Math.floor(Math.random() * sides) + 1;
  const total = die + bonus;
  const bonusText = bonus !== 0 ? ` (${die} ${bonus >= 0 ? '+' : ''}${bonus})` : "";
  
  let authorName = session.role === "player" ? (session.campaign?.characters.find(x => x.id === session.player.characterId)?.name || session.player.name) : (session.currentMaster ? `Mestre (${session.currentMaster.name})` : "Mestre");

  if (session.campaign) {
    session.campaign.diceLogs ??= [];
    const now = new Date();
    session.campaign.diceLogs.unshift({
      id: uid(), author: authorName, authorId: firebaseUser?.uid || session.currentMaster?.id || "", sides, bonus, bonusText, total, label,
      time: `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`
    });
    if (session.campaign.diceLogs.length > 50) session.campaign.diceLogs.pop();
    save();
  }

  let resEl = document.getElementById("diceResult");
  if (!resEl) {
    openDiceRoller();
    resEl = document.getElementById("diceResult");
  }
  if (resEl) {
    resEl.innerHTML = `${label ? `<b>${label}</b>: ` : ""}Resultado: <span style="font-size:24px; color:var(--accent);">${total}</span>${bonusText}`;
    document.getElementById("diceHistory").innerHTML = (session.campaign?.diceLogs || []).slice(0, 5).map(l => `<b>${esc(l.author)}</b>: ${l.total}`).join("<br>");
  }
}

function rollAttribute(name, mod) { rollDice(20, mod, `Atributo: ${name}`); }
function rollSkill(name, mod) { rollDice(20, mod, `Habilidade: ${name}`); }

normalizeState();
if (window.CDIFirebase) initFirebaseBridge();
render();
            
