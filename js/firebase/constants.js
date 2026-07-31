export const SHARED_SUBCOLLECTION_KEYS = [
  "players",
  "characters",
  "cases",
  "creatures",
  "items",
  "marks",
  "diceLogs",
  "messages",
  "itemTransfers"
];

export const MASTER_ONLY_SUBCOLLECTION_KEYS = ["scenes", "evidence"];

export const SUBCOLLECTION_KEYS = [
  ...SHARED_SUBCOLLECTION_KEYS,
  ...MASTER_ONLY_SUBCOLLECTION_KEYS
];
