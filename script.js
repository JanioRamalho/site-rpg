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

const root = document.getElementById("root");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const save = () => localStorage.setItem("cdi_fase1_full", JSON.stringify(state));
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const imgInput = (id, label) => `<label>${label}</label><input id="${id}" type="file" accept="image/*">`;

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

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const modals = document.querySelectorAll(".modal");
    if (modals.length > 0) modals[modals.length - 1].remove();
  }
});

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
        resolve(canvas.toDataURL("image/jpeg", 0.8));
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
    <div class="modal"><div class="modalbox">
      <h1>🌑 Crônicas do Infinito</h1>
      <p class="muted">Gerenciador de RPG de Mesa Local</p>
      <div class="grid" style="margin-top:15px;">
        <div class="card"><h2>👑 Painel do Mestre</h2><p>Controle campanhas, fichas, criaturas e mistérios.</p><button onclick="masterLoginModal()">Entrar como Mestre</button></div>
        <div class="card"><h2>👤 Painel do Jogador</h2><p>Acesse seu personagem, inventário e atributos.</p><button onclick="playerLogin()">Entrar como Jogador</button></div>
      </div>
    </div></div>`;
}

function masterLoginModal() {
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

function createMaster() {
  const name = document.getElementById("newMName").value.trim();
  const password = document.getElementById("newMPass").value.trim();
  if (!name || !password) return alert("Preencha todos os campos.");

  state.masters.push({ id: uid(), name, password });
  save();
  toast("Mestre cadastrado!");
  masterLoginModal();
}

function doMasterLogin() {
  const mid = document.getElementById("msel").value;
  const pass = document.getElementById("mpass").value;
  const target = state.masters.find(m => m.id === mid);

  if (!target || target.password !== pass) return alert("Senha incorreta!");

  session = { role: "master", currentMaster: target, campaign: null, player: null, view: "home" };
  masterMenu();
}

function playerLogin() {
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

function doPlayerLogin() {
  const pc = document.getElementById("pc").value;
  const pw = document.getElementById("pw").value;
  const pp = document.getElementById("pp").value;
  const c = state.campaigns.find(x => x.id === pc);
  const p = c?.players.find(x => x.password === pp);

  if (!c || c.password !== pw || !p) return alert("Acesso inválido.");
  session = { role: "player", campaign: c, player: p, currentMaster: null, view: "sheet" };
  render();
}

function masterMenu() {
  const myCampaigns = getMasterCampaigns();
  if (!myCampaigns.length) return newCampaign(true);
  session.campaign = myCampaigns[0];
  session.view = "home";
  render();
}

// --- NAVEGAÇÃO E LAYOUT ---
function nav() {
  const m = session.role === "master";
  const items = m ? [
    ["home","🏠 Visão Geral"], ["campaigns","📚 Campanhas"], ["characters","👤 Personagens"],
    ["skills","🎯 Habilidades"], ["diceLogs","🎲 Histórico"], ["cases","📁 Casos"],
    ["creatures","👹 Criaturas"], ["items","🎒 Itens"], ["evidence","🔎 Evidências"],
    ["marks","🏷️ Marcas"], ["transfers", "🤝 Permissões / Trocas"], ["players","🔐 Jogadores"], ["settings","⚙️ Configurações"]
  ] : [
    ["sheet","👤 Meu Personagem"], ["inventory","🎒 Inventário"], ["evidencePlayer","🔎 Evidências"], ["transferPlayer","🤝 Dar Item/Evidência"]
  ];

  return `
    <div class="side">
      <div class="brand">🌑 Crônicas</div>
      <div class="role">${m ? `Mestre: ${esc(session.currentMaster?.name)}` : "Jogador"}</div>
      <div class="nav">${items.map(([v, t]) => `<button class="${session.view === v ? "active" : ""}" onclick="session.view='${v}';render()">${t}</button>`).join("")}</div>
      <button class="dice-btn" onclick="openDiceRoller()">🎲 Rolador</button>
      <hr style="border-color:var(--card-border); margin: 15px 0;">
      <button class="secondary" onclick="session={role:null};home()">Sair</button>
    </div>`;
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
          <button class="secondary" onclick="session.role==='master'?masterMenu():playerLogin()">Trocar Acesso</button>
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
    characters: charactersPage, skills: masterSkillsManagerPage, diceLogs: masterDiceLogsPage,
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
          ${t.image ? `<img class="avatar" src="${t.image}" style="cursor:pointer;" onclick="openImageModal('${t.image}', '${esc(t.itemName)}')">` : ""}
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

  t.status = status;
  const now = new Date();
  t.time = `${now.toLocaleDateString()} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

  if (status === 'approved') {
    if (t.type === 'item') {
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
    toast("Transferência aprovada e aplicada!");
  } else {
    toast("Transferência rejeitada.");
  }

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

function executeDeleteMasterAccount() {
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
          <button onclick="session.campaign=c;session.view='campaign';render()">Abrir</button>
          <button class="danger" onclick="deleteCampaign('${c.id}')">Excluir</button>
        </div>`).join("")}
    </div>`;
}

function campaignPage() {
  const c = session.campaign;
  return `
    <h2>📚 ${esc(c.name)}</h2>
    <div class="card">
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

function createCampaign() {
  const c = {
    id: uid(), masterId: session.currentMaster.id,
    name: document.getElementById("cn").value || "Campanha",
    password: document.getElementById("cp").value || "123",
    description: document.getElementById("cd").value || "",
    players: [], characters: [], cases: [], creatures: [], items: [], evidence: [], marks: [], diceLogs: [], scenes: [],
    itemTransfers: [], customSkills: [...OFFICIAL_SKILLS]
  };
  state.campaigns.push(c); session.campaign = c; save(); session.view = "home";
  document.querySelectorAll(".modal").forEach(m => m.remove()); render();
}

function deleteCampaign(id) {
  if (confirm("Excluir campanha?")) {
    state.campaigns = state.campaigns.filter(c => c.id !== id);
    session.campaign = getMasterCampaigns()[0] || null;
    save(); render();
  }
}

// --- PERSONAGENS ---
function charactersPage() {
  const c = session.campaign;
  return `
    <h2>👤 Personagens</h2><button onclick="characterModal()">➕ Criar Personagem</button>
    <div class="grid" style="margin-top:15px;">
      ${c.characters.map((x, i) => `
        <div class="card">
          ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal('${x.image}', '${esc(x.name)}')">` : ""}
          <h3>${esc(x.name)}</h3><span class="tag">${esc(x.origin)}</span>
          <p style="margin-top:8px;">❤️ ${x.health}/${x.healthMax} · 🧠 ${x.sanity}/${x.sanityMax}</p><br>
          <button onclick="characterModal(${i})">Ficha</button>
          <button class="danger" onclick="del('characters',${i})">Excluir</button>
        </div>`).join("")}
    </div>`;
}

function characterModal(index = null) {
  const c = session.campaign;
  const x = index === null ? { name: "", origin: ORIGINS[0], healthMax: 20, health: 20, sanityMax: 10, sanity: 10, defense: 10, attrs: {}, res: {}, skills: [], expressions: [], activeExpression: "" } : c.characters[index];
  x.skills ??= [];

  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2>👑 Ficha (Mestre)</h2>
      ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal('${x.image}', '${esc(x.name)}')">` : ""}
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
  const c = isNew ? { id: uid(), attrs: {}, res: {}, skills: [], expressions: [], activeExpression: "", inventory: [] } : session.campaign.characters[index];
  
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

// --- PAINEL DO JOGADOR ---
function playerBody() {
  const v = session.view;
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
  const otherChars = c.characters.filter(x => x.id !== ch.id);

  return `
    <h2>🤝 Entregar Item ou Evidência</h2>
    <p class="muted">Preencha os dados abaixo para solicitar ao Mestre a transferência de um item ou evidência para outro jogador ou para o grupo.</p>
    
    <div class="card" style="margin-top:15px;">
      <h3>Nova Solicitação de Entrega</h3>
      <label>Tipo de Objeto</label>
      <select id="trType">
        <option value="item">Item do Inventário</option>
        <option value="evidence">Evidência</option>
      </select>

      <label>Nome do Item / Evidência</label>
      <input id="trItemName" placeholder="Ex: Chave de Fenda / Fita Cassete">

      <label>Descrição Breve</label>
      <textarea id="trDesc" placeholder="Detalhes do que está sendo entregue..."></textarea>

      ${imgInput("trImg", "Foto do Item / Evidência (Opcional)")}

      <label>Entregar para:</label>
      <select id="trTarget">
        <option value="Grupo / Geral">Para o Grupo / Geral</option>
        ${otherChars.map(o => `<option value="${esc(o.name)}">${esc(o.name)}</option>`).join("")}
      </select>

      <label>Observação para o Mestre</label>
      <input id="trMsg" placeholder="Ex: Encontrado na gaveta da sala de autópsia">

      <br><br>
      <button onclick="submitPlayerTransfer('${ch.name}')">Enviar Solicitação ao Mestre</button>
    </div>

    <h3 style="margin-top:30px;">📋 Suas Solicitações Recentes</h3>
    <div class="grid" style="margin-top:10px;">
      ${myTransfers.length === 0 ? '<p class="muted">Nenhuma solicitação enviada.</p>' : ''}
      ${myTransfers.map(t => `
        <div class="card" style="margin:0; opacity: 0.9;">
          ${t.image ? `<img class="avatar" src="${t.image}" style="cursor:pointer;" onclick="openImageModal('${t.image}', '${esc(t.itemName)}')">` : ""}
          <h3>${esc(t.itemName)} (${t.status === 'pending' ? '⏳ Pendente' : t.status === 'approved' ? '✅ Aprovado' : '❌ Rejeitado'})</h3>
          <p class="muted">Para: <b>${esc(t.toName)}</b></p>
          <p style="font-size:12px;">${esc(t.message || '')}</p>
        </div>`).join("")}
    </div>`;
}

async function submitPlayerTransfer(fromCharName) {
  const type = document.getElementById("trType").value;
  const itemName = document.getElementById("trItemName").value.trim();
  const description = document.getElementById("trDesc").value.trim();
  const toName = document.getElementById("trTarget").value;
  const message = document.getElementById("trMsg").value.trim();

  if (!itemName) return alert("Informe o nome do item ou evidência.");

  const im = await readImg(document.getElementById("trImg").files[0]);

  session.campaign.itemTransfers ??= [];
  session.campaign.itemTransfers.unshift({
    id: uid(),
    fromPlayerId: session.player.id,
    fromName: fromCharName,
    type,
    itemName,
    description,
    image: im || "",
    toName,
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
    ${ch.image ? `<img class="avatar" src="${ch.image}" style="cursor:pointer;" onclick="openImageModal('${ch.image}', '${esc(ch.name)}')">` : ""}
    <span class="tag">Origem: ${esc(ch.origin)}</span>
    <div class="grid" style="margin-top:15px;">
      <div class="card"><h3>❤️ Saúde</h3><h2 id="val-health">${ch.health}/${ch.healthMax}</h2><div class="bar"><div id="bar-health" class="fill health" style="width:${(ch.health/ch.healthMax)*100}%"></div></div><button onclick="changeStatDirect('health',-1)">−</button><button onclick="changeStatDirect('health',1)">+</button></div>
      <div class="card"><h3>🧠 Sanidade</h3><h2 id="val-sanity">${ch.sanity}/${ch.sanityMax}</h2><div class="bar"><div id="bar-sanity" class="fill sanity" style="width:${(ch.sanity/ch.sanityMax)*100}%"></div></div><button onclick="changeStatDirect('sanity',-1)">−</button><button onclick="changeStatDirect('sanity',1)">+</button></div>
      <div class="card"><h3>🛡️ Defesa</h3><h2>${ch.defense || 10}</h2></div>
    </div>
    <div class="grid" style="margin-top:15px;">
      <div class="card"><h3>📊 Atributos</h3>${Object.entries(ch.attrs).map(([k, v]) => `<div class="stat clickable-stat" onclick="rollAttribute('${k}', ${v})"><span>${k}</span><b>${v >= 0 ? '+' + v : v}</b></div>`).join("")}</div>
      <div class="card"><h3>🛡️ Resistências</h3>${Object.entries(ch.res).map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join("")}</div>
    </div>
    <div class="card" style="margin-top:15px;">
      <h3>🎯 Habilidades</h3>
      <div class="grid" style="margin-top:10px;">
        ${ch.skills.map((s, idx) => `
          <div class="card" style="margin:0; padding:10px;">
            <b class="clickable-stat" onclick="rollSkill('${esc(s.name)}', ${s.bonus || 0})">${esc(s.name)}</b>
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
          ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal('${x.image}', '${esc(x.name)}')">` : ""}
          <h3>${esc(x.name)}</h3>
          <p>${esc(x.description)}</p>
          <label style="margin-top:10px; display:flex; align-items:center; gap:5px; font-size:12px;">
            <input type="checkbox" ${x.revealed ? "checked" : ""} onchange="toggleReveal('items', ${i}, this.checked)"> Visível para jogadores
          </label><br>
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
      ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal('${x.image}', '${esc(x.name)}')">` : ""}
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

function recordsPage(key, title) {
  return `
    <h2>${title}</h2>
    <button onclick="recordModal('${key}')">➕ Criar</button>
    <div class="grid" style="margin-top:15px;">
      ${session.campaign[key].map((x, i) => `
        <div class="card">
          ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal('${x.image}', '${esc(x.name)}')">` : ""}
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
      ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal('${x.image}', '${esc(x.name)}')">` : ""}
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
          ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal('${x.image}', '${esc(x.name)}')">` : ""}
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
      ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal('${x.image}', '${esc(x.name)}')">` : ""}
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
          ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal('${x.image}', '${esc(x.name)}')">` : ""}
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
      ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal('${x.image}', '${esc(x.name)}')">` : ""}
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
          ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal('${x.image}', '${esc(x.name)}')">` : ""}
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
      ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal('${x.image}', '${esc(x.name)}')">` : ""}
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
      ${c.players.map((p, i) => `
        <div class="card">
          <h3>${esc(p.name)}</h3>
          <p class="muted">Personagem ID: ${p.characterId || 'Nenhum'}</p>
          <button onclick="linkPlayerModal(${i})">Vincular Personagem</button>
          <button class="danger" onclick="delPlayer(${i})">Remover</button>
        </div>`).join("")}
    </div>`;
}

function newPlayerModal() {
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
  const name = document.getElementById("jn").value, password = document.getElementById("jp").value;
  if (!name || !password) return alert("Preencha tudo.");
  session.campaign.players.push({ id: uid(), name, password, characterId: null });
  save(); document.querySelector(".modal").remove(); render(); toast("Jogador adicionado!");
}

function linkPlayerModal(playerIndex) {
  const p = session.campaign.players[playerIndex];
  const chars = session.campaign.characters;
  root.insertAdjacentHTML("beforeend", `
    <div class="modal"><div class="modalbox">
      <h2>🔗 Vincular Personagem a ${esc(p.name)}</h2>
      <label>Personagem</label>
      <select id="linkCharSel">
        <option value="">Nenhum</option>
        ${chars.map(ch => `<option value="${ch.id}" ${p.characterId === ch.id ? 'selected' : ''}>${esc(ch.name)}</option>`)}
      </select>
      <br><br>
      <button class="secondary" onclick="this.closest('.modal').remove()">Cancelar</button>
      <button onclick="saveLinkPlayer(${playerIndex})">Salvar</button>
    </div></div>`);
}

function saveLinkPlayer(playerIndex) {
  const chId = document.getElementById("linkCharSel").value;
  session.campaign.players[playerIndex].characterId = chId || null;
  save(); document.querySelector(".modal").remove(); render(); toast("Vinculado com sucesso!");
}

function delPlayer(i) { session.campaign.players.splice(i, 1); save(); render(); }

function del(key, i) {
  if (confirm("Excluir item?")) { session.campaign[key].splice(i, 1); save(); render(); }
}

function inventoryPlayer(ch) {
  const items = (session.campaign.items || []).filter(x => x.revealed);
  return `
    <h2>🎒 Inventário</h2>
    <div class="grid" style="margin-top:15px;">
      ${items.map(x => `
        <div class="card">
          ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal('${x.image}', '${esc(x.name)}')">` : ""}
          <h3>${esc(x.name)}</h3>
          <p>${esc(x.description)}</p>
        </div>`).join("") || "<p class='muted'>Nenhum item disponível.</p>"}
    </div>`;
}

function evidencePlayer(ch) {
  const ev = (session.campaign.evidence || []).filter(x => x.revealed);
  return `
    <h2>🔎 Evidências</h2>
    <div class="grid" style="margin-top:15px;">
      ${ev.map(x => `
        <div class="card">
          ${x.image ? `<img class="avatar" src="${x.image}" style="cursor:pointer;" onclick="openImageModal('${x.image}', '${esc(x.name)}')">` : ""}
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
      id: uid(), author: authorName, sides, bonus, bonusText, total, label,
      time: `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`
    });
    if (session.campaign.diceLogs.length > 50) session.campaign.diceLogs.pop();
    save();
  }

  const resEl = document.getElementById("diceResult");
  if (resEl) {
    resEl.innerHTML = `${label ? `<b>${label}</b>: ` : ""}Resultado: <span style="font-size:24px; color:var(--accent);">${total}</span>${bonusText}`;
    document.getElementById("diceHistory").innerHTML = (session.campaign?.diceLogs || []).slice(0, 5).map(l => `<b>${esc(l.author)}</b>: ${l.total}`).join("<br>");
  } else {
    openDiceRoller();
    rollDice(sides, bonus, label);
  }
}

function rollAttribute(name, mod) { rollDice(20, mod, `Atributo: ${name}`); }
function rollSkill(name, mod) { rollDice(20, mod, `Habilidade: ${name}`); }

render();
            