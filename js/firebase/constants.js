export const SHARED_SUBCOLLECTION_KEYS = [
  "players",
  "characters",
  "cases",
  "creatures",
  "items",
  "evidence",
  "marks",
  "diceLogs",
  "messages",
  "itemTransfers"
];

export const MASTER_ONLY_SUBCOLLECTION_KEYS = ["scenes"];

export const SUBCOLLECTION_KEYS = [
  ...SHARED_SUBCOLLECTION_KEYS,
  ...MASTER_ONLY_SUBCOLLECTION_KEYS
];
