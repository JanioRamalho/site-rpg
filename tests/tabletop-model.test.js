const test = require("node:test");
const assert = require("node:assert/strict");
const tabletop = require("../js/game/tabletop-model.js");

function sequentialIds() {
  let value = 0;
  return () => `generated-${++value}`;
}

test("normalizes legacy links without losing the prepared character", () => {
  const campaign = {
    players: [{ id: "player-1", name: "Ana", email: "ANA@EXAMPLE.COM", characterId: "char-1" }],
    characters: [{ id: "char-1", name: "Morgana" }]
  };

  tabletop.normalizeCampaign(campaign, sequentialIds());

  assert.equal(campaign.schemaVersion, 2);
  assert.equal(campaign.players[0].emailNormalized, "ana@example.com");
  assert.equal(campaign.players[0].status, "pending");
  assert.equal(campaign.players[0].characterId, "char-1");
  assert.equal(campaign.characters[0].controllerPlayerId, "player-1");
  assert.deepEqual(campaign.characters[0].inventory, []);
});

test("prevents the same character from being assigned to two players", () => {
  const campaign = {
    players: [
      { id: "player-1", name: "Ana" },
      { id: "player-2", name: "Bruno" }
    ],
    characters: [{ id: "char-1", name: "Morgana" }]
  };

  tabletop.assignCharacter(campaign, "player-1", "char-1");
  assert.throws(
    () => tabletop.assignCharacter(campaign, "player-2", "char-1"),
    /ja esta vinculado/
  );

  tabletop.assignCharacter(campaign, "player-1", null);
  tabletop.assignCharacter(campaign, "player-2", "char-1");
  assert.equal(campaign.players[1].characterId, "char-1");
  assert.equal(campaign.characters[0].controllerPlayerId, "player-2");
});

test("shows only characters controlled by authenticated players in the room", () => {
  const now = Date.now();
  const campaign = {
    players: [
      {
        id: "player-online",
        name: "Ana",
        authUid: "auth-1",
        characterId: "char-1",
        online: true,
        lastSeen: new Date(now - 1000).toISOString()
      },
      {
        id: "player-pending",
        name: "Bruno",
        authUid: null,
        characterId: "char-2"
      }
    ],
    characters: [
      { id: "char-1", name: "Morgana" },
      { id: "char-2", name: "Orion" },
      { id: "char-3", name: "Sem dono" }
    ]
  };

  const participants = tabletop.getControlledParticipants(campaign, now);

  assert.equal(participants.length, 1);
  assert.equal(participants[0].character.name, "Morgana");
  assert.equal(participants[0].presence, "online");
});

test("grants, stacks and edits items in an individual inventory", () => {
  const ids = sequentialIds();
  const campaign = {
    players: [],
    characters: [{ id: "char-1", name: "Morgana", inventory: [] }]
  };
  const item = { id: "item-1", name: "Pocao", description: "Recupera vida" };

  const first = tabletop.grantItem(campaign, "char-1", item, { quantity: 2 }, ids);
  const stacked = tabletop.grantItem(campaign, "char-1", item, { quantity: 3 }, ids);
  tabletop.updateInventoryEntry(campaign, "char-1", first.id, { equipped: true, notes: "No cinto" });

  assert.equal(first.id, stacked.id);
  assert.equal(stacked.quantity, 5);
  assert.equal(stacked.equipped, true);
  assert.equal(stacked.notes, "No cinto");
});

test("moves only the approved quantity between character inventories", () => {
  const ids = sequentialIds();
  const campaign = {
    players: [],
    characters: [
      {
        id: "char-1",
        name: "Morgana",
        inventory: [{ id: "inv-1", itemId: "item-1", name: "Flecha", quantity: 3 }]
      },
      { id: "char-2", name: "Orion", inventory: [] }
    ]
  };

  tabletop.transferInventoryItem(campaign, "char-1", "char-2", "inv-1", 2, ids);

  assert.equal(campaign.characters[0].inventory[0].quantity, 1);
  assert.equal(campaign.characters[1].inventory[0].quantity, 2);
  assert.throws(
    () => tabletop.transferInventoryItem(campaign, "char-1", "char-2", "inv-1", 2, ids),
    /Quantidade indisponivel/
  );
});

test("releases a character when its player is removed", () => {
  const campaign = {
    players: [{ id: "player-1", name: "Ana", characterId: "char-1" }],
    characters: [{ id: "char-1", name: "Morgana" }]
  };

  tabletop.releasePlayer(campaign, "player-1");

  assert.equal(campaign.players[0].characterId, null);
  assert.equal(campaign.characters[0].controllerPlayerId, null);
});
