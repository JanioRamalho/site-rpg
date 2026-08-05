import {
  MASTER_ONLY_SUBCOLLECTION_KEYS,
  SHARED_SUBCOLLECTION_KEYS,
  SUBCOLLECTION_KEYS
} from "./constants.js";
import { makeId, stripUndefined, withRetry } from "./utils.js";

export function createCampaignRepository(ctx) {
  const { api, auth, db, projectId } = ctx;
  const MAX_IMAGE_MIGRATION_DOCUMENTS = 450;
  const cloudinaryCloudName = String(ctx.cloudinaryCloudName || "").trim().toLowerCase();
  const campaignSaveCache = new Map();
  const restBaseUrl = projectId
    ? `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`
    : "";

  function splitCampaign(campaign) {
    const base = { ...campaign };
    const collections = {};
    SUBCOLLECTION_KEYS.forEach(key => {
      collections[key] = Array.isArray(base[key]) ? base[key] : [];
      delete base[key];
    });
    return { base, collections };
  }

  function mergeCampaign(base, collections = {}, options = {}) {
    const campaign = { ...base };
    SHARED_SUBCOLLECTION_KEYS.forEach(key => {
      const splitItems = collections[key] || [];
      campaign[key] = splitItems.length ? splitItems : (Array.isArray(base[key]) ? base[key] : []);
    });
    MASTER_ONLY_SUBCOLLECTION_KEYS.forEach(key => {
      if (options.includeMasterOnly === false) {
        campaign[key] = [];
        return;
      }
      const splitItems = collections[key] || [];
      campaign[key] = splitItems.length ? splitItems : (Array.isArray(base[key]) ? base[key] : []);
    });
    return campaign;
  }

  function readableSubcollectionKeys(base, userId) {
    return base?.masterId === userId ? SUBCOLLECTION_KEYS : SHARED_SUBCOLLECTION_KEYS;
  }

  function cleanSubDoc(item, order) {
    return stripUndefined({ ...item, id: String(item.id), _order: order });
  }

  function assertRemoteImage(value, fieldName, { allowEmpty = false } = {}) {
    const image = String(value || "").trim();
    if (!image && allowEmpty) return "";
    if (/^data:image\//i.test(image)) {
      const error = new Error(`${fieldName} deve usar uma URL HTTPS do Cloudinary; imagens Base64 nao sao permitidas.`);
      error.code = "campaign/base64-image-not-allowed";
      throw error;
    }
    if (!isCloudinaryHttpsUrl(image)) {
      const error = new Error(`${fieldName} deve usar uma URL HTTPS de res.cloudinary.com.`);
      error.code = "campaign/cloudinary-image-required";
      throw error;
    }
    return image;
  }

  function cleanImageMeta(metadata) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
    return stripUndefined({
      provider: metadata.provider ? String(metadata.provider).slice(0, 32) : undefined,
      assetId: metadata.assetId ? String(metadata.assetId).slice(0, 256) : undefined,
      publicId: metadata.publicId ? String(metadata.publicId).slice(0, 1024) : undefined,
      version: metadata.version ?? undefined,
      versionId: metadata.versionId ? String(metadata.versionId).slice(0, 256) : undefined,
      format: metadata.format ? String(metadata.format).slice(0, 32) : undefined,
      width: Number.isFinite(Number(metadata.width)) ? Math.max(0, Math.trunc(Number(metadata.width))) : undefined,
      height: Number.isFinite(Number(metadata.height)) ? Math.max(0, Math.trunc(Number(metadata.height))) : undefined,
      bytes: Number.isFinite(Number(metadata.bytes)) ? Math.max(0, Math.trunc(Number(metadata.bytes))) : undefined,
      etag: metadata.etag ? String(metadata.etag).slice(0, 256) : undefined
    });
  }

  function cleanScene(scene, order) {
    if (!scene || typeof scene !== "object" || Array.isArray(scene)) {
      throw new Error("Cena invalida.");
    }

    const id = String(scene.id || "").trim();
    if (!id || id.includes("/") || id.length > 512) throw new Error("Cena sem identificador valido.");

    const clean = {
      ...stripUndefined(scene),
      id,
      title: String(scene.title || "Cena").trim().slice(0, 160) || "Cena",
      caption: String(scene.caption || "").slice(0, 4000),
      masterNotes: String(scene.masterNotes || "").slice(0, 12000),
      image: assertRemoteImage(scene.image, "A imagem da cena"),
      imageMeta: cleanImageMeta(scene.imageMeta),
      createdAt: scene.createdAt ? String(scene.createdAt).slice(0, 80) : undefined,
      imagePublicId: scene.imagePublicId ? String(scene.imagePublicId).slice(0, 1024) : undefined,
      imageAssetId: scene.imageAssetId ? String(scene.imageAssetId).slice(0, 256) : undefined,
      imageFormat: scene.imageFormat ? String(scene.imageFormat).slice(0, 32) : undefined,
      imageWidth: Number.isFinite(Number(scene.imageWidth)) ? Math.max(0, Math.trunc(Number(scene.imageWidth))) : undefined,
      imageHeight: Number.isFinite(Number(scene.imageHeight)) ? Math.max(0, Math.trunc(Number(scene.imageHeight))) : undefined,
      imageBytes: Number.isFinite(Number(scene.imageBytes)) ? Math.max(0, Math.trunc(Number(scene.imageBytes))) : undefined
    };
    return cleanSubDoc(clean, order);
  }

  function cleanLiveScene(liveScene, updatedAt = new Date().toISOString()) {
    if (!liveScene || typeof liveScene !== "object" || Array.isArray(liveScene)) {
      throw new Error("Cena ao vivo invalida.");
    }

    const active = Boolean(liveScene.active);
    const sceneId = liveScene.sceneId === null || liveScene.sceneId === undefined || liveScene.sceneId === ""
      ? null
      : String(liveScene.sceneId).trim().slice(0, 512);
    const index = Number.parseInt(liveScene.index, 10);
    const total = Number.parseInt(liveScene.total, 10);
    return stripUndefined({
      active,
      sceneId,
      image: assertRemoteImage(liveScene.image, "A imagem da cena ao vivo", { allowEmpty: !active }),
      index: Math.max(0, Number.isFinite(index) ? index : 0),
      total: Math.max(0, Number.isFinite(total) ? total : 0),
      updatedAt: String(liveScene.updatedAt || updatedAt).slice(0, 80)
    });
  }

  const MEDIA_MUTATION_COLLECTIONS = new Set([
    "characters",
    "cases",
    "creatures",
    "items",
    "evidence",
    "marks"
  ]);

  function assertDocumentId(value, label) {
    const id = String(value || "").trim();
    if (!id || id.includes("/") || id.length > 512) {
      const error = new Error(`${label} invalido.`);
      error.code = "campaign/media-document-id-invalid";
      throw error;
    }
    return id;
  }

  function containsBase64Image(value, seen = new WeakSet()) {
    if (typeof value === "string") return /^data:image\//i.test(value.trimStart());
    if (!value || typeof value !== "object") return false;
    if (seen.has(value)) return false;
    seen.add(value);
    return Object.values(value).some(entry => containsBase64Image(entry, seen));
  }

  function isCloudinaryHttpsUrl(value) {
    try {
      const parsed = new URL(String(value || ""));
      if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "res.cloudinary.com") return false;
      if (!cloudinaryCloudName) return true;
      return String(parsed.pathname.split("/").filter(Boolean)[0] || "").toLowerCase() === cloudinaryCloudName;
    } catch {
      return false;
    }
  }

  function collectImageValues(value, output = [], seen = new WeakSet()) {
    if (!value || typeof value !== "object") return output;
    if (seen.has(value)) return output;
    seen.add(value);
    Object.entries(value).forEach(([key, child]) => {
      if (key === "image" && typeof child === "string" && child.trim()) {
        output.push(child.trim());
        return;
      }
      if (child && typeof child === "object") collectImageValues(child, output, seen);
    });
    return output;
  }

  function assertManagedImages(value, label = "Os dados") {
    const invalid = collectImageValues(value).find(image => !isCloudinaryHttpsUrl(image));
    if (!invalid) return;
    const error = new Error(`${label} contem uma imagem fora da conta Cloudinary configurada.`);
    error.code = "campaign/unmanaged-image-not-allowed";
    throw error;
  }

  function normalizedLegacyImageSource(value) {
    const image = typeof value === "string" ? value.trim() : "";
    return image && !isCloudinaryHttpsUrl(image) ? image : "";
  }

  function cleanCampaignMediaMutation(mutation) {
    if (!mutation || typeof mutation !== "object" || Array.isArray(mutation)) {
      throw new Error("Mutacao de midia invalida.");
    }

    const basePatch = mutation.basePatch ?? {};
    if (!basePatch || typeof basePatch !== "object" || Array.isArray(basePatch)) {
      throw new Error("Patch da campanha invalido.");
    }
    const baseKeys = Object.keys(basePatch);
    if (baseKeys.some(key => !["gameBoard", "previousGameBoard"].includes(key))) {
      const error = new Error("A mutacao de midia so pode alterar os tabuleiros no documento da campanha.");
      error.code = "campaign/media-base-field-not-allowed";
      throw error;
    }
    if (Object.prototype.hasOwnProperty.call(basePatch, "gameBoard")
      && (!basePatch.gameBoard || typeof basePatch.gameBoard !== "object" || Array.isArray(basePatch.gameBoard))) {
      throw new Error("Tabuleiro invalido.");
    }
    if (Object.prototype.hasOwnProperty.call(basePatch, "previousGameBoard")
      && (!basePatch.previousGameBoard || typeof basePatch.previousGameBoard !== "object" || Array.isArray(basePatch.previousGameBoard))) {
      throw new Error("Tabuleiro anterior invalido.");
    }

    if (!Array.isArray(mutation.documents)) throw new Error("Documentos de midia invalidos.");
    if (!Array.isArray(mutation.cloudinaryUrls) || !mutation.cloudinaryUrls.length) {
      const error = new Error("Informe ao menos uma URL confirmada pelo Cloudinary.");
      error.code = "campaign/media-cloudinary-urls-required";
      throw error;
    }
    const cloudinaryUrls = [...new Set(mutation.cloudinaryUrls.map(value => String(value || "").trim()))];
    if (cloudinaryUrls.some(url => !isCloudinaryHttpsUrl(url))) {
      const error = new Error("Todas as URLs da mutacao precisam usar HTTPS em res.cloudinary.com.");
      error.code = "campaign/media-cloudinary-url-invalid";
      throw error;
    }

    const cleanBasePatch = stripUndefined(basePatch);
    if (containsBase64Image(cleanBasePatch)) {
      const error = new Error("A mutacao de midia nao permite imagens Base64.");
      error.code = "campaign/media-base64-not-allowed";
      throw error;
    }
    assertManagedImages(cleanBasePatch, "O documento da campanha");

    const documentKeys = new Set();
    const documents = mutation.documents.map(entry => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error("Documento de midia invalido.");
      }
      const collection = String(entry.collection || "").trim();
      if (!MEDIA_MUTATION_COLLECTIONS.has(collection)) {
        const error = new Error(`A colecao ${collection || "informada"} nao aceita esta mutacao de midia.`);
        error.code = "campaign/media-collection-not-allowed";
        throw error;
      }
      const id = assertDocumentId(entry.id, "Identificador do documento");
      const data = entry.data ?? entry.patch;
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error(`Patch de ${collection}/${id} invalido.`);
      }
      if (containsBase64Image(data)) {
        const error = new Error(`O documento ${collection}/${id} ainda contem uma imagem Base64.`);
        error.code = "campaign/media-base64-not-allowed";
        throw error;
      }

      const key = `${collection}/${id}`;
      if (documentKeys.has(key)) {
        const error = new Error(`O documento ${key} foi informado mais de uma vez.`);
        error.code = "campaign/media-document-duplicate";
        throw error;
      }
      documentKeys.add(key);

      const clean = stripUndefined(data);
      assertManagedImages(clean, `O documento ${collection}/${id}`);
      if (clean.id !== undefined && String(clean.id) !== id) {
        const error = new Error(`O id interno de ${key} nao corresponde ao documento.`);
        error.code = "campaign/media-document-id-mismatch";
        throw error;
      }
      return { collection, id, data: { ...clean, id } };
    });

    if (!baseKeys.length && !documents.length) {
      const error = new Error("A mutacao de midia nao possui alteracoes.");
      error.code = "campaign/media-mutation-empty";
      throw error;
    }
    const operationCount = documents.length + 1;
    if (operationCount > 500) {
      const error = new Error("A mutacao de midia excede o limite de 500 operacoes do Firestore.");
      error.code = "campaign/media-operation-limit";
      throw error;
    }

    return { basePatch: cleanBasePatch, documents, cloudinaryUrls, operationCount };
  }

  function cleanImageMigrationReplacements(replacements) {
    if (!Array.isArray(replacements)) throw new Error("Substituicoes de imagens invalidas.");
    const unique = new Map();

    replacements.forEach(replacement => {
      if (!replacement || typeof replacement !== "object" || Array.isArray(replacement)) {
        throw new Error("Substituicao de imagem invalida.");
      }
      const source = String(replacement.source || "").trim();
      if (!source || isCloudinaryHttpsUrl(source)) {
        const error = new Error("A origem da migracao precisa ser uma imagem ainda nao gerenciada pelo Cloudinary.");
        error.code = "campaign/migration-source-invalid";
        throw error;
      }

      const url = String(replacement.url || "").trim();
      let parsedUrl = null;
      try {
        parsedUrl = new URL(url);
      } catch {}
      if (!parsedUrl || parsedUrl.protocol !== "https:" || parsedUrl.hostname.toLowerCase() !== "res.cloudinary.com" || /^data:/i.test(url)) {
        const error = new Error("A imagem migrada precisa usar uma URL HTTPS do Cloudinary.");
        error.code = "campaign/migration-url-invalid";
        throw error;
      }

      let metadata = {};
      if (replacement.metadata !== undefined && replacement.metadata !== null) {
        if (typeof replacement.metadata !== "object" || Array.isArray(replacement.metadata)) {
          throw new Error("Metadados da imagem migrada invalidos.");
        }
        try {
          metadata = stripUndefined(replacement.metadata);
        } catch {
          throw new Error("Metadados da imagem migrada invalidos.");
        }
      }

      const clean = { source, url, metadata };
      const prior = unique.get(source);
      if (prior && JSON.stringify(prior) !== JSON.stringify(clean)) {
        const error = new Error("A mesma imagem legada possui destinos de migracao diferentes.");
        error.code = "campaign/migration-source-conflict";
        throw error;
      }
      unique.set(source, clean);
    });

    return unique;
  }

  function replaceMigratedImages(value, replacements) {
    if (Array.isArray(value)) {
      let next = value;
      let count = 0;
      value.forEach((entry, index) => {
        const result = replaceMigratedImages(entry, replacements);
        count += result.count;
        if (result.value !== entry) {
          if (next === value) next = [...value];
          next[index] = result.value;
        }
      });
      return { value: next, count };
    }

    if (!value || typeof value !== "object") return { value, count: 0 };

    let next = value;
    let count = 0;
    Object.entries(value).forEach(([key, entry]) => {
      const source = key === "image" ? normalizedLegacyImageSource(entry) : "";
      if (source && replacements.has(source)) return;
      const result = replaceMigratedImages(entry, replacements);
      count += result.count;
      if (result.value !== entry) {
        if (next === value) next = { ...value };
        next[key] = result.value;
      }
    });

    const imageSource = normalizedLegacyImageSource(value.image);
    if (imageSource && replacements.has(imageSource)) {
      const replacement = replacements.get(imageSource);
      if (next === value) next = { ...value };
      next.image = replacement.url;
      next.imageMeta = JSON.parse(JSON.stringify(replacement.metadata));
      count += 1;
    }
    return { value: next, count };
  }

  function migrationReferenceCount(value, replacements, sources = null) {
    if (Array.isArray(value)) {
      return value.reduce((total, entry) => total + migrationReferenceCount(entry, replacements, sources), 0);
    }
    if (!value || typeof value !== "object") return 0;

    let count = 0;
    Object.entries(value).forEach(([key, entry]) => {
      const source = key === "image" ? normalizedLegacyImageSource(entry) : "";
      if (source && replacements.has(source)) {
        count += 1;
        sources?.add(source);
        return;
      }
      count += migrationReferenceCount(entry, replacements, sources);
    });
    return count;
  }

  function legacyImageReferenceCount(value) {
    if (Array.isArray(value)) {
      return value.reduce((total, entry) => total + legacyImageReferenceCount(entry), 0);
    }
    if (!value || typeof value !== "object") return 0;

    return Object.entries(value).reduce((total, [key, entry]) => (
      total + (key === "image" && normalizedLegacyImageSource(entry)
        ? 1
        : legacyImageReferenceCount(entry))
    ), 0);
  }

  function collectLegacyImageSources(value, sources = new Set()) {
    if (Array.isArray(value)) {
      value.forEach(entry => collectLegacyImageSources(entry, sources));
      return sources;
    }
    if (!value || typeof value !== "object") return sources;
    Object.entries(value).forEach(([key, entry]) => {
      const source = key === "image" ? normalizedLegacyImageSource(entry) : "";
      if (source) sources.add(source);
      else collectLegacyImageSources(entry, sources);
    });
    return sources;
  }

  function migrationError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function mergeExpectedMigratedImages(current, expected, replacements, path = []) {
    const expectedCount = migrationReferenceCount(expected, replacements);
    if (!expectedCount) return { value: current, count: 0 };

    if (Array.isArray(expected)) {
      if (current !== undefined && current !== null && !Array.isArray(current)) {
        throw migrationError(
          `A estrutura remota de ${path.join(".") || "imagem"} mudou durante a migracao.`,
          "campaign/migration-structure-conflict"
        );
      }

      const remote = Array.isArray(current) ? current : [];
      let next = remote;
      let count = 0;
      const remoteById = new Map();
      remote.forEach((entry, index) => {
        const id = entry && typeof entry === "object" && !Array.isArray(entry) ? String(entry.id || "") : "";
        if (!id) return;
        if (remoteById.has(id)) {
          throw migrationError(
            `A lista remota ${path.join(".") || "de imagens"} possui ids repetidos.`,
            "campaign/migration-array-id-conflict"
          );
        }
        remoteById.set(id, index);
      });
      const expectedIds = new Set();

      expected.forEach((entry, expectedIndex) => {
        const entryCount = migrationReferenceCount(entry, replacements);
        if (!entryCount) return;
        const entryId = entry && typeof entry === "object" && !Array.isArray(entry)
          ? String(entry.id || "")
          : "";
        if (!entryId) {
          throw migrationError(
            `A lista ${path.join(".") || "de imagens"} possui uma entrada sem id e nao pode ser mesclada com seguranca.`,
            "campaign/migration-array-id-required"
          );
        }
        if (expectedIds.has(entryId)) {
          throw migrationError(
            `A lista local ${path.join(".") || "de imagens"} possui ids repetidos.`,
            "campaign/migration-array-id-conflict"
          );
        }
        expectedIds.add(entryId);

        const remoteIndex = remoteById.get(entryId);
        if (remoteIndex === undefined) {
          throw migrationError(
            `A entrada ${entryId} nao existe mais em ${path.join(".") || "dados remotos"}. A migracao nao recria dados ausentes.`,
            "campaign/migration-remote-data-missing"
          );
        }

        const merged = mergeExpectedMigratedImages(
          remote[remoteIndex],
          entry,
          replacements,
          [...path, `${entryId || expectedIndex}`]
        );
        if (merged.value !== remote[remoteIndex]) {
          if (next === remote) next = [...remote];
          next[remoteIndex] = merged.value;
        }
        count += merged.count;
      });
      return { value: next, count };
    }

    if (!expected || typeof expected !== "object") {
      throw migrationError("Snapshot local de imagens invalido.", "campaign/migration-snapshot-invalid");
    }
    if (current !== undefined && current !== null && (typeof current !== "object" || Array.isArray(current))) {
      throw migrationError(
        `A estrutura remota de ${path.join(".") || "imagem"} mudou durante a migracao.`,
        "campaign/migration-structure-conflict"
      );
    }

    if (current === undefined || current === null) {
      throw migrationError(
        `O campo remoto ${path.join(".") || "de imagem"} nao existe mais. A migracao foi cancelada sem recria-lo.`,
        "campaign/migration-remote-data-missing"
      );
    }

    let next = current;
    let count = 0;
    const expectedImage = normalizedLegacyImageSource(expected.image);
    if (replacements.has(expectedImage)) {
      const replacement = replacements.get(expectedImage);
      const currentImage = typeof current.image === "string" ? current.image.trim() : "";
      if (currentImage !== expectedImage && currentImage !== replacement.url) {
        throw migrationError(
          `A imagem remota de ${path.join(".") || "registro"} foi alterada durante a migracao.`,
          "campaign/migration-image-conflict"
        );
      }

      const currentMetadata = current.imageMeta && typeof current.imageMeta === "object" && !Array.isArray(current.imageMeta)
        ? current.imageMeta
        : {};
      const nextMetadata = {
        ...JSON.parse(JSON.stringify(currentMetadata)),
        ...JSON.parse(JSON.stringify(replacement.metadata))
      };
      if (currentImage !== replacement.url || JSON.stringify(current.imageMeta || {}) !== JSON.stringify(nextMetadata)) {
        next = { ...current, image: replacement.url, imageMeta: nextMetadata };
      }
      count += 1;
    }

    Object.entries(expected).forEach(([key, entry]) => {
      if (key === "image" || key === "imageMeta" || !migrationReferenceCount(entry, replacements)) return;
      const merged = mergeExpectedMigratedImages(current[key], entry, replacements, [...path, key]);
      if (merged.value !== current[key]) {
        if (next === current) next = { ...current };
        next[key] = merged.value;
      }
      count += merged.count;
    });
    return { value: next, count };
  }

  function sanitizeMigratedCampaignBase(base, updatedAt) {
    if (!base?.liveScene || typeof base.liveScene !== "object" || Array.isArray(base.liveScene)) return base;
    return {
      ...base,
      liveScene: cleanLiveScene(base.liveScene, updatedAt)
    };
  }

  function cleanMigrationExpectation(campaignId, expectation, replacements) {
    if (!expectation || typeof expectation !== "object" || Array.isArray(expectation)) {
      throw migrationError(
        "A migracao exige o snapshot local esperado e a quantidade de referencias.",
        "campaign/migration-expectation-required"
      );
    }

    const expectedCampaign = expectation.expectedCampaign || expectation.campaign || expectation.snapshot;
    const expectedCount = Number(expectation.expectedCount ?? expectation.expectedReferenceCount);
    if (!expectedCampaign || typeof expectedCampaign !== "object" || Array.isArray(expectedCampaign)) {
      throw migrationError("Snapshot local esperado invalido.", "campaign/migration-snapshot-invalid");
    }
    if (String(expectedCampaign.id || "") !== String(campaignId)) {
      throw migrationError("O snapshot local pertence a outra campanha.", "campaign/migration-campaign-mismatch");
    }
    if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) {
      throw migrationError("Quantidade esperada de imagens invalida.", "campaign/migration-expected-count-invalid");
    }

    const { base, collections } = splitCampaign(expectedCampaign);
    const usedSources = new Set();
    const derivedCount = migrationReferenceCount(base, replacements, usedSources)
      + SUBCOLLECTION_KEYS.reduce(
        (total, key) => total + migrationReferenceCount(collections[key] || [], replacements, usedSources),
        0
      );
    const legacyCount = legacyImageReferenceCount(base)
      + SUBCOLLECTION_KEYS.reduce(
        (total, key) => total + legacyImageReferenceCount(collections[key] || []),
        0
      );

    if (derivedCount !== legacyCount || usedSources.size !== replacements.size) {
      throw migrationError(
        "As substituicoes nao cobrem exatamente as imagens nao gerenciadas do snapshot local.",
        "campaign/migration-replacements-incomplete"
      );
    }
    if (derivedCount !== expectedCount) {
      throw migrationError(
        `A migracao esperava ${expectedCount} referencia(s), mas o snapshot possui ${derivedCount}.`,
        "campaign/migration-expected-count-mismatch"
      );
    }

    return { base, collections, expectedCount };
  }

  async function preflightCampaignImageMigration(campaignId, expectedCampaign) {
    if (!campaignId || !auth.currentUser) throw new Error("Preflight de imagens invalido.");
    const normalizedCampaignId = String(campaignId);
    if (!expectedCampaign || String(expectedCampaign.id || "") !== normalizedCampaignId) {
      throw migrationError("O snapshot do preflight pertence a outra campanha.", "campaign/migration-campaign-mismatch");
    }

    const { base: expectedBase, collections: expectedCollections } = splitCampaign(expectedCampaign);
    const expectedSources = collectLegacyImageSources(expectedCampaign);
    const syntheticReplacements = new Map([...expectedSources].map(source => [source, {
      source,
      url: source,
      metadata: {}
    }]));
    const campaignRef = api.doc(db, "campaigns", normalizedCampaignId);
    const [campaignSnapshot, ...collectionSnapshots] = await Promise.all([
      withRetry(() => api.getDoc(campaignRef), ctx),
      ...SUBCOLLECTION_KEYS.map(key => withRetry(
        () => api.getDocs(api.collection(db, "campaigns", normalizedCampaignId, key)),
        ctx
      ))
    ]);
    if (!campaignSnapshot?.exists()) {
      throw migrationError("Campanha nao encontrada durante o preflight.", "campaign/migration-remote-data-missing");
    }
    const remoteBase = campaignSnapshot.data() || {};
    if (String(remoteBase.masterId || "") !== String(auth.currentUser.uid || "")) {
      throw migrationError("Somente o Mestre da campanha pode preparar a migracao.", "campaign/migration-master-required");
    }
    const embeddedLegacyCollections = SUBCOLLECTION_KEYS.filter(key => (
      Array.isArray(remoteBase[key]) && legacyImageReferenceCount(remoteBase[key]) > 0
    ));
    if (embeddedLegacyCollections.length) {
      throw migrationError(
        `A campanha ainda guarda imagens dentro do documento principal (${embeddedLegacyCollections.join(", ")}). Esse formato precisa de um procedimento de compatibilidade separado antes da migracao.`,
        "campaign/migration-legacy-storage-layout"
      );
    }

    let confirmedReferences = 0;
    let confirmedDocuments = 0;
    function confirmTarget(current, expected, label) {
      const expectedCount = migrationReferenceCount(expected, syntheticReplacements);
      const remoteCount = legacyImageReferenceCount(current);
      if (!expectedCount && !remoteCount) return;
      if (!expectedCount || remoteCount !== expectedCount) {
        throw migrationError(
          `${label} possui ${remoteCount} imagem(ns) remota(s), mas o snapshot preparado possui ${expectedCount}.`,
          "campaign/migration-snapshot-stale"
        );
      }
      const merged = mergeExpectedMigratedImages(current, expected, syntheticReplacements, [label]);
      if (merged.count !== expectedCount) {
        throw migrationError(`O preflight nao confirmou integralmente ${label}.`, "campaign/migration-count-mismatch");
      }
      confirmedReferences += expectedCount;
      confirmedDocuments += 1;
    }

    confirmTarget(remoteBase, expectedBase, "campaign");
    SUBCOLLECTION_KEYS.forEach((key, index) => {
      const remoteById = new Map(collectionSnapshots[index].docs.map(documentSnapshot => [
        String(documentSnapshot.id),
        documentSnapshot.data() || {}
      ]));
      const expectedById = new Map((expectedCollections[key] || []).map(entry => [String(entry?.id || ""), entry]));
      expectedById.forEach((expectedEntry, id) => {
        if (!legacyImageReferenceCount(expectedEntry)) return;
        if (!id || !remoteById.has(id)) {
          throw migrationError(
            `O documento ${key}/${id || "sem-id"} nao existe mais no Firebase.`,
            "campaign/migration-remote-data-missing"
          );
        }
        confirmTarget(remoteById.get(id), expectedEntry, `${key}/${id}`);
      });
      remoteById.forEach((remoteEntry, id) => {
        if (legacyImageReferenceCount(remoteEntry) && !expectedById.has(id)) {
          throw migrationError(
            `O documento remoto ${key}/${id} possui imagens ausentes do snapshot local.`,
            "campaign/migration-snapshot-stale"
          );
        }
      });
    });

    const expectedCount = legacyImageReferenceCount(expectedBase)
      + SUBCOLLECTION_KEYS.reduce(
        (total, key) => total + legacyImageReferenceCount(expectedCollections[key] || []),
        0
      );
    if (confirmedReferences !== expectedCount) {
      throw migrationError(
        `O preflight confirmou ${confirmedReferences} de ${expectedCount} referencia(s).`,
        "campaign/migration-count-mismatch"
      );
    }
    if (confirmedDocuments + (expectedCount ? 1 : 0) > MAX_IMAGE_MIGRATION_DOCUMENTS) {
      throw migrationError(
        `A migracao alcancaria mais de ${MAX_IMAGE_MIGRATION_DOCUMENTS} documentos em uma unica transacao. Divida a campanha antes de continuar.`,
        "campaign/migration-operation-limit"
      );
    }
    return {
      status: expectedCount ? "ready" : "noop",
      verified: true,
      campaignId: normalizedCampaignId,
      expectedCount,
      documents: confirmedDocuments,
      updatedAt: remoteBase.updatedAt || null
    };
  }

  async function upgradeLegacyCampaignStorageLayout(campaignId) {
    if (!campaignId || !auth.currentUser) throw new Error("Preparacao da campanha invalida.");
    const normalizedCampaignId = String(campaignId);
    const campaignRef = api.doc(db, "campaigns", normalizedCampaignId);
    const [campaignSnapshot, ...collectionSnapshots] = await Promise.all([
      withRetry(() => api.getDoc(campaignRef), ctx),
      ...SUBCOLLECTION_KEYS.map(key => withRetry(
        () => api.getDocs(api.collection(db, "campaigns", normalizedCampaignId, key)),
        ctx
      ))
    ]);
    if (!campaignSnapshot?.exists()) {
      throw migrationError("Campanha nao encontrada durante a preparacao.", "campaign/migration-remote-data-missing");
    }
    const remoteBase = campaignSnapshot.data() || {};
    if (String(remoteBase.masterId || "") !== String(auth.currentUser.uid || "")) {
      throw migrationError("Somente o Mestre da campanha pode preparar o armazenamento.", "campaign/migration-master-required");
    }

    const embeddedKeys = SUBCOLLECTION_KEYS.filter(key => (
      Array.isArray(remoteBase[key]) && legacyImageReferenceCount(remoteBase[key]) > 0
    ));
    if (!embeddedKeys.length) {
      return { status: "noop", verified: true, campaignId: normalizedCampaignId, documents: 0 };
    }

    const targets = [];
    embeddedKeys.forEach(key => {
      const collectionIndex = SUBCOLLECTION_KEYS.indexOf(key);
      if (collectionSnapshots[collectionIndex]?.docs?.length) {
        throw migrationError(
          `A colecao ${key} existe no formato antigo e no novo. Nenhum formato foi escolhido automaticamente.`,
          "campaign/migration-legacy-storage-mixed"
        );
      }
      const ids = new Set();
      remoteBase[key].forEach((entry, order) => {
        const id = String(entry?.id || "").trim();
        if (!entry || typeof entry !== "object" || Array.isArray(entry) || !id || id.includes("/") || id.length > 512) {
          throw migrationError(
            `A colecao antiga ${key} possui uma entrada sem identificador seguro.`,
            "campaign/migration-document-id-invalid"
          );
        }
        if (ids.has(id)) {
          throw migrationError(
            `A colecao antiga ${key} possui o id repetido ${id}.`,
            "campaign/migration-array-id-conflict"
          );
        }
        ids.add(id);
        targets.push({
          key,
          id,
          order,
          ref: api.doc(db, "campaigns", normalizedCampaignId, key, id),
          data: cleanSubDoc(entry, order)
        });
      });
    });
    if (targets.length + 1 > MAX_IMAGE_MIGRATION_DOCUMENTS) {
      throw migrationError(
        `A preparacao alcancaria mais de ${MAX_IMAGE_MIGRATION_DOCUMENTS} documentos em uma unica transacao.`,
        "campaign/migration-operation-limit"
      );
    }

    const preparedAt = new Date().toISOString();
    const initialEmbedded = Object.fromEntries(embeddedKeys.map(key => [key, remoteBase[key]]));
    const result = await withRetry(() => api.runTransaction(db, async transaction => {
      const [currentCampaignSnapshot, ...targetSnapshots] = await Promise.all([
        transaction.get(campaignRef),
        ...targets.map(target => transaction.get(target.ref))
      ]);
      if (!currentCampaignSnapshot?.exists()) {
        throw migrationError("A campanha desapareceu durante a preparacao.", "campaign/migration-remote-data-missing");
      }
      const currentBase = currentCampaignSnapshot.data() || {};
      if (String(currentBase.masterId || "") !== String(auth.currentUser.uid || "")) {
        throw migrationError("O Mestre da campanha mudou durante a preparacao.", "campaign/migration-master-required");
      }
      embeddedKeys.forEach(key => {
        if (JSON.stringify(currentBase[key]) !== JSON.stringify(initialEmbedded[key])) {
          throw migrationError(
            `A colecao antiga ${key} mudou durante a preparacao.`,
            "campaign/migration-snapshot-stale"
          );
        }
      });
      targetSnapshots.forEach((snapshot, index) => {
        if (snapshot?.exists()) {
          throw migrationError(
            `O documento ${targets[index].key}/${targets[index].id} foi criado durante a preparacao.`,
            "campaign/migration-legacy-storage-mixed"
          );
        }
      });

      targets.forEach(target => transaction.set(target.ref, target.data, { merge: false }));
      const baseUpdate = {
        storageLayoutMigration: {
          version: 1,
          completedAt: preparedAt,
          movedCollections: embeddedKeys,
          movedDocuments: targets.length,
          verified: true
        },
        updatedAt: preparedAt
      };
      embeddedKeys.forEach(key => { baseUpdate[key] = api.deleteField(); });
      transaction.update(campaignRef, baseUpdate);
      return { status: "committed", documents: targets.length, collections: embeddedKeys };
    }), ctx);

    const [verifiedCampaign, ...verifiedCollections] = await Promise.all([
      withRetry(() => api.getDoc(campaignRef), ctx),
      ...embeddedKeys.map(key => withRetry(
        () => api.getDocs(api.collection(db, "campaigns", normalizedCampaignId, key)),
        ctx
      ))
    ]);
    const verifiedBase = verifiedCampaign?.data() || {};
    const layoutVerified = embeddedKeys.every((key, index) => (
      !Object.prototype.hasOwnProperty.call(verifiedBase, key)
      && verifiedCollections[index]?.docs?.length === initialEmbedded[key].length
    ));
    if (!layoutVerified) {
      throw migrationError("O Firebase nao confirmou a preparacao integral da campanha.", "campaign/migration-unverified");
    }
    campaignSaveCache.delete(normalizedCampaignId);
    return { ...result, verified: true, campaignId: normalizedCampaignId };
  }

  function sortSubDocs(docs) {
    return docs
      .map(d => {
        const { _order, ...data } = d;
        return { data, order: Number.isFinite(_order) ? _order : Number.MAX_SAFE_INTEGER };
      })
      .sort((a, b) => a.order - b.order || String(a.data.id).localeCompare(String(b.data.id)))
      .map(x => x.data);
  }

  function cloneCollections(collections = {}) {
    return Object.fromEntries(SUBCOLLECTION_KEYS.map(key => [
      key,
      JSON.parse(JSON.stringify(collections[key] || []))
    ]));
  }

  async function authHeaders() {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error("Usuario nao autenticado.");
    return { Authorization: `Bearer ${token}` };
  }

  function decodeFirestoreValue(value) {
    if (!value) return null;
    if ("stringValue" in value) return value.stringValue;
    if ("integerValue" in value) return Number(value.integerValue);
    if ("doubleValue" in value) return Number(value.doubleValue);
    if ("booleanValue" in value) return Boolean(value.booleanValue);
    if ("nullValue" in value) return null;
    if ("timestampValue" in value) return value.timestampValue;
    if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeFirestoreValue);
    if ("mapValue" in value) return decodeFirestoreFields(value.mapValue.fields || {});
    return null;
  }

  function decodeFirestoreFields(fields = {}) {
    return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]));
  }

  function decodeFirestoreDocument(doc) {
    if (!doc) return null;
    const id = String(doc.name || "").split("/").pop();
    return { id, ...decodeFirestoreFields(doc.fields || {}) };
  }

  function encodeFirestoreValue(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreValue) } };
    if (typeof value === "boolean") return { booleanValue: value };
    if (typeof value === "number") {
      return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    }
    if (typeof value === "object") {
      return { mapValue: { fields: encodeFirestoreFields(value) } };
    }
    return { stringValue: String(value) };
  }

  function encodeFirestoreFields(data = {}) {
    return Object.fromEntries(Object.entries(stripUndefined(data)).map(([key, value]) => [key, encodeFirestoreValue(value)]));
  }

  async function restFetch(path, options = {}) {
    if (!restBaseUrl) throw new Error("Firebase projectId nao configurado.");
    const headers = {
      ...(await authHeaders()),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    };
    const response = await fetch(`${restBaseUrl}/${path}`, { ...options, headers });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error?.message || "Falha ao acessar Firestore REST.");
    return body;
  }

  async function restGetDoc(path) {
    try {
      return decodeFirestoreDocument(await restFetch(path));
    } catch (err) {
      if (String(err.message || "").includes("NOT_FOUND")) return null;
      throw err;
    }
  }

  async function restListCollection(path) {
    const body = await restFetch(path);
    return (body.documents || []).map(decodeFirestoreDocument);
  }

  async function restPatchDoc(path, data) {
    const fields = encodeFirestoreFields(data);
    const mask = Object.keys(fields).map(key => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join("&");
    const suffix = mask ? `?${mask}` : "";
    return decodeFirestoreDocument(await restFetch(`${path}${suffix}`, {
      method: "PATCH",
      body: JSON.stringify({ fields })
    }));
  }

  async function getSubcollection(campaignId, key) {
    try {
      const snap = await withRetry(() => api.getDocs(api.collection(db, "campaigns", campaignId, key)), ctx);
      return sortSubDocs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.warn(`SDK Firestore falhou ao ler ${key}; usando REST.`, err);
      return sortSubDocs(await restListCollection(`campaigns/${campaignId}/${key}`));
    }
  }

  function assertManagedSubcollectionChanges(key, items, previousItems, canWrite = () => true) {
    const previousById = new Map((previousItems || []).map((item, index) => [String(item.id), {
      clean: cleanSubDoc(item, index),
      item
    }]));
    items.forEach((item, index) => {
      const id = String(item.id);
      const nextClean = cleanSubDoc(item, index);
      const previousEntry = previousById.get(id);
      if (!canWrite(item, previousEntry?.item)
        || JSON.stringify(previousEntry?.clean) === JSON.stringify(nextClean)) return;
      if (!previousEntry) {
        assertManagedImages(nextClean, `O documento ${key}/${id}`);
        return;
      }
      const changedFields = {};
      const fieldNames = new Set([...Object.keys(previousEntry.clean), ...Object.keys(nextClean)]);
      fieldNames.forEach(field => {
        if (JSON.stringify(previousEntry.clean[field]) === JSON.stringify(nextClean[field])) return;
        if (field in nextClean) changedFields[field] = nextClean[field];
      });
      assertManagedImages(changedFields, `As alteracoes de ${key}/${id}`);
    });
  }

  async function syncSubcollection(campaignId, key, items, options = {}) {
    const previous = Array.isArray(options.previousItems)
      ? options.previousItems
      : (campaignSaveCache.get(campaignId)?.[key] || []);
    const canWrite = options.canWrite || (() => true);
    const canDelete = options.canDelete || (() => true);
    assertManagedSubcollectionChanges(key, items, previous, canWrite);
    const previousIds = new Set(previous.map(item => String(item.id)));
    const nextIds = new Set(items.map(item => String(item.id)));
    const previousById = new Map(previous.map((item, index) => [String(item.id), {
      clean: cleanSubDoc(item, index),
      item
    }]));
    const writes = [];

    items.forEach((item, index) => {
      const id = String(item.id);
      const nextClean = cleanSubDoc(item, index);
      const previousEntry = previousById.get(id);
      if (canWrite(item, previousEntry?.item) && JSON.stringify(previousEntry?.clean) !== JSON.stringify(nextClean)) {
        if (!previousEntry) {
          writes.push(() => api.setDoc(
            api.doc(db, "campaigns", campaignId, key, id),
            nextClean,
            { merge: false }
          ));
          return;
        }

        const changedFields = {};
        const fieldNames = new Set([...Object.keys(previousEntry.clean), ...Object.keys(nextClean)]);
        fieldNames.forEach(field => {
          if (JSON.stringify(previousEntry.clean[field]) === JSON.stringify(nextClean[field])) return;
          changedFields[field] = field in nextClean ? nextClean[field] : api.deleteField();
        });
        writes.push(() => api.updateDoc(
          api.doc(db, "campaigns", campaignId, key, id),
          changedFields
        ));
      }
    });

    previousIds.forEach(id => {
      const previousItem = previousById.get(id)?.item;
      if (!nextIds.has(id) && canDelete(previousItem)) {
        writes.push(() => api.deleteDoc(api.doc(db, "campaigns", campaignId, key, id)));
      }
    });

    for (let i = 0; i < writes.length; i += 400) {
      const chunk = writes.slice(i, i + 400);
      await withRetry(() => Promise.all(chunk.map(write => write())), ctx);
    }
  }

  async function deleteSubcollection(campaignId, key) {
    const snap = await withRetry(() => api.getDocs(api.collection(db, "campaigns", campaignId, key)), ctx);
    const deletes = snap.docs.map(d => () => api.deleteDoc(d.ref));
    for (let i = 0; i < deletes.length; i += 400) {
      const chunk = deletes.slice(i, i + 400);
      await withRetry(() => Promise.all(chunk.map(del => del())), ctx);
    }
  }

  function watchCampaigns(userId, callback, onError) {
    if (!userId) return () => {};
    const q = api.query(api.collection(db, "campaigns"), api.where("members", "array-contains", userId));
    const bases = new Map();
    const subcollections = new Map();
    const subUnsubs = new Map();
    const subReady = new Map();
    const subKeys = new Map();
    let latestMeta = { fromCache: false, hasPendingWrites: false };
    let lastPayload = "";
    let lastMetaPayload = "";

    function emit() {
      const baseCampaigns = Array.from(bases.values());
      if (baseCampaigns.some(base => subReady.get(base.id)?.size !== (subKeys.get(base.id)?.length || 0))) return;
      const campaigns = baseCampaigns.map(base => mergeCampaign(
        base,
        subcollections.get(base.id) || {},
        { includeMasterOnly: base.masterId === userId }
      ));
      const payload = JSON.stringify(campaigns);
      const metaPayload = JSON.stringify(latestMeta);
      if (payload === lastPayload && metaPayload === lastMetaPayload) return;
      lastPayload = payload;
      lastMetaPayload = metaPayload;
      campaigns.forEach(c => campaignSaveCache.set(c.id, cloneCollections(subcollections.get(c.id))));
      callback(campaigns, latestMeta);
    }

    function watchCampaignSubcollections(campaignId, keys) {
      if (subUnsubs.has(campaignId)) return;
      subcollections.set(campaignId, Object.fromEntries(keys.map(key => [key, []])));
      subReady.set(campaignId, new Set());
      subKeys.set(campaignId, keys);
      const unsubs = keys.map(key => api.onSnapshot(
        api.collection(db, "campaigns", campaignId, key),
        { includeMetadataChanges: true },
        snap => {
          latestMeta = { fromCache: snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites };
          const current = subcollections.get(campaignId) || {};
          current[key] = sortSubDocs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
          subcollections.set(campaignId, current);
          subReady.get(campaignId)?.add(key);
          emit();
        },
        onError
      ));
      subUnsubs.set(campaignId, unsubs);
    }

    const unsubBase = api.onSnapshot(q, { includeMetadataChanges: true }, snapshot => {
      latestMeta = { fromCache: snapshot.metadata.fromCache, hasPendingWrites: snapshot.metadata.hasPendingWrites };
      const activeIds = new Set();
      snapshot.docs.forEach(d => {
        const campaign = { id: d.id, ...d.data() };
        activeIds.add(campaign.id);
        bases.set(campaign.id, campaign);
        watchCampaignSubcollections(campaign.id, readableSubcollectionKeys(campaign, userId));
      });

      Array.from(bases.keys()).forEach(id => {
        if (!activeIds.has(id)) {
          bases.delete(id);
          subcollections.delete(id);
          subReady.delete(id);
          subKeys.delete(id);
          campaignSaveCache.delete(id);
          (subUnsubs.get(id) || []).forEach(unsub => unsub());
          subUnsubs.delete(id);
        }
      });
      emit();
    }, onError);

    return () => {
      unsubBase();
      subUnsubs.forEach(unsubs => unsubs.forEach(unsub => unsub()));
      subUnsubs.clear();
      subReady.clear();
      subKeys.clear();
    };
  }

  function watchPrivateMessages(campaignId, options = {}, callback, onError) {
    if (!campaignId || !auth.currentUser || typeof callback !== "function") return () => {};
    const collectionRef = api.collection(db, "campaigns", campaignId, "privateMessages");
    const source = options.role === "master"
      ? collectionRef
      : api.query(collectionRef, api.where("accessUid", "==", String(auth.currentUser.uid)));
    return api.onSnapshot(
      source,
      { includeMetadataChanges: true },
      snapshot => {
        const uniqueMessages = new Map();
        snapshot.docs.forEach(d => {
          const message = { id: d.id, ...d.data() };
          uniqueMessages.set(String(message.id), message);
        });
        callback(sortSubDocs([...uniqueMessages.values()]).slice(0, 500), {
          fromCache: snapshot.metadata.fromCache,
          hasPendingWrites: snapshot.metadata.hasPendingWrites
        });
      },
      onError
    );
  }

  async function getCampaign(campaignId) {
    if (!campaignId) return null;
    let base = null;
    try {
      const snap = await withRetry(() => api.getDoc(api.doc(db, "campaigns", campaignId)), ctx);
      if (!snap.exists()) return null;
      base = { id: snap.id, ...snap.data() };
    } catch (err) {
      console.warn("SDK Firestore falhou ao buscar campanha; usando REST.", err);
      base = await restGetDoc(`campaigns/${campaignId}`);
      if (!base) return null;
    }
    const includeMasterOnly = base.masterId === auth.currentUser?.uid;
    const readableKeys = readableSubcollectionKeys(base, auth.currentUser?.uid);
    const collectionEntries = await Promise.all(readableKeys.map(async key => [
      key,
      await getSubcollection(campaignId, key)
    ]));
    const collections = Object.fromEntries(collectionEntries);
    const campaign = mergeCampaign(base, collections, { includeMasterOnly });
    campaignSaveCache.set(campaign.id, cloneCollections(collections));
    return campaign;
  }

  async function getCampaignForJoin(campaignId) {
    if (!campaignId) return null;
    try {
      const snap = await withRetry(() => api.getDoc(api.doc(db, "campaigns", campaignId)), ctx);
      return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    } catch (err) {
      console.warn("SDK Firestore falhou ao buscar campanha para entrada; usando REST.", err);
      return restGetDoc(`campaigns/${campaignId}`);
    }
  }

  async function addCampaignMember(campaignId, userId) {
    if (!campaignId || !userId) return;
    try {
      await withRetry(() => api.updateDoc(api.doc(db, "campaigns", campaignId), {
        members: api.arrayUnion(userId),
        updatedAt: new Date().toISOString()
      }), ctx);
    } catch (err) {
      console.warn("SDK Firestore falhou ao adicionar membro; usando REST.", err);
      const campaign = await restGetDoc(`campaigns/${campaignId}`);
      const members = Array.from(new Set([...(campaign?.members || []), userId]));
      await restPatchDoc(`campaigns/${campaignId}`, { members, updatedAt: new Date().toISOString() });
    }
  }

  async function joinCampaign(campaignId, campaignPass, profile, name = "") {
    if (!campaignId || !auth.currentUser) return null;
    const user = auth.currentUser;
    const base = await getCampaignForJoin(campaignId);
    if (!base || base.password !== campaignPass) return null;
    const normalizedEmail = String(user.email || profile?.email || "").trim().toLowerCase();
    if (Array.isArray(base.readyPlayerEmails) && !base.readyPlayerEmails.includes(normalizedEmail)) {
      const error = new Error("O Mestre ainda nao preparou e vinculou um personagem para este e-mail.");
      error.code = "campaign/player-not-ready";
      throw error;
    }

    await addCampaignMember(campaignId, user.uid);
    let players = [];
    try {
      const playersSnap = await withRetry(() => api.getDocs(api.collection(db, "campaigns", campaignId, "players")), ctx);
      players = sortSubDocs(playersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.warn("SDK Firestore falhou ao listar jogadores; usando REST.", err);
      players = sortSubDocs(await restListCollection(`campaigns/${campaignId}/players`));
    }
    let player = players.find(p => p.authUid === user.uid)
      || players.find(p => !p.authUid && String(p.emailNormalized || p.email || "").trim().toLowerCase() === normalizedEmail);
    const isNewPlayer = !player;
    const isFirstJoin = !player?.authUid;
    const nowIso = new Date().toISOString();

    player = player ? {
      ...player,
      name: player.name || name || profile?.name || user.displayName || user.email,
      email: user.email,
      emailNormalized: normalizedEmail,
      authUid: user.uid,
      status: "claimed",
      joinedAt: player.joinedAt || nowIso,
      lastSeen: nowIso,
      online: true
    } : {
      id: makeId(),
      name: name || profile?.name || user.displayName || user.email,
      email: user.email,
      emailNormalized: normalizedEmail,
      authUid: user.uid,
      characterId: null,
      status: "claimed",
      joinedAt: nowIso,
      lastSeen: nowIso,
      online: true
    };

    const playerOrder = isNewPlayer ? players.length : Math.max(0, players.findIndex(p => p.id === player.id));
    try {
      await withRetry(() => api.setDoc(
        api.doc(db, "campaigns", campaignId, "players", String(player.id)),
        cleanSubDoc(player, playerOrder),
        { merge: true }
      ), ctx);
    } catch (err) {
      console.warn("SDK Firestore falhou ao salvar jogador; usando REST.", err);
      await restPatchDoc(`campaigns/${campaignId}/players/${String(player.id)}`, cleanSubDoc(player, playerOrder));
    }

    if (isFirstJoin && base.chatSettings?.publicEnabled !== false) {
      const now = new Date();
      const message = {
        id: makeId(),
        author: "Sistema",
        authorId: user.uid,
        text: `${player.name} entrou na campanha.`,
        time: `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`
      };
      try {
        await withRetry(() => api.setDoc(
          api.doc(db, "campaigns", campaignId, "messages", String(message.id)),
          cleanSubDoc(message, 0),
          { merge: false }
        ), ctx);
      } catch (err) {
        console.warn("SDK Firestore falhou ao salvar mensagem de entrada; usando REST.", err);
        await restPatchDoc(`campaigns/${campaignId}/messages/${String(message.id)}`, cleanSubDoc(message, 0));
      }
    }

    return { campaign: await getCampaign(campaignId), player };
  }

  async function setPlayerPresence(campaignId, playerId, online) {
    if (!campaignId || !playerId || !auth.currentUser) return;
    const presence = {
      online: Boolean(online),
      lastSeen: new Date().toISOString()
    };
    try {
      await withRetry(() => api.updateDoc(
        api.doc(db, "campaigns", campaignId, "players", String(playerId)),
        presence
      ), ctx);
    } catch (err) {
      console.warn("SDK Firestore falhou ao atualizar presenca; usando REST.", err);
      await restPatchDoc(`campaigns/${campaignId}/players/${String(playerId)}`, presence);
    }
  }

  async function sendCampaignMessage(campaignId, message) {
    if (!campaignId || !auth.currentUser) throw new Error("Mensagem sem campanha ou usuario autenticado.");

    const now = new Date();
    const sentAt = String(message?.sentAt || now.toISOString());
    const text = String(message?.text || "").trim().slice(0, 500);
    if (!text) throw new Error("A mensagem esta vazia.");

    const outgoing = stripUndefined({
      id: String(message?.id || makeId()),
      author: String(message?.author || "Jogador").trim().slice(0, 60) || "Jogador",
      authorId: auth.currentUser.uid,
      playerId: message?.playerId ? String(message.playerId) : undefined,
      text,
      time: String(message?.time || `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`),
      sentAt
    });
    const sentAtMs = Date.parse(sentAt);
    const order = -(Number.isFinite(sentAtMs) ? sentAtMs : Date.now());
    const stored = cleanSubDoc(outgoing, order);

    try {
      await withRetry(() => api.setDoc(
        api.doc(db, "campaigns", campaignId, "messages", outgoing.id),
        stored,
        { merge: false }
      ), ctx);
    } catch (err) {
      console.warn("SDK Firestore falhou ao enviar mensagem; usando REST.", err);
      await restPatchDoc(`campaigns/${campaignId}/messages/${outgoing.id}`, stored);
    }

    const cachedMessages = campaignSaveCache.get(campaignId)?.messages;
    if (cachedMessages && !cachedMessages.some(entry => String(entry.id) === outgoing.id)) {
      cachedMessages.unshift({ ...outgoing });
    }
    return outgoing;
  }

  async function recordDiceRoll(campaignId, roll) {
    if (!campaignId || !auth.currentUser) throw new Error("Rolagem sem campanha ou usuario autenticado.");

    const now = new Date();
    const createdAt = String(roll?.createdAt || now.toISOString());
    const sides = Math.max(2, Math.trunc(Number(roll?.sides) || 20));
    const die = Math.trunc(Number(roll?.die));
    const bonus = Math.trunc(Number(roll?.bonus) || 0);
    const total = Math.trunc(Number(roll?.total));
    if (!Number.isFinite(die) || die < 1 || die > sides || !Number.isFinite(total) || total !== die + bonus) {
      throw new Error("Resultado de dado invalido.");
    }

    const rollerRole = roll?.rollerRole === "player" ? "player" : "master";
    const origin = String(roll?.origin || (rollerRole === "master" ? "Mestre" : "Sem origem")).trim().slice(0, 80)
      || (rollerRole === "master" ? "Mestre" : "Sem origem");
    const outgoing = stripUndefined({
      id: String(roll?.id || makeId()),
      author: rollerRole === "player" ? origin : "Mestre",
      authorId: auth.currentUser.uid,
      playerId: roll?.playerId ? String(roll.playerId) : undefined,
      characterId: roll?.characterId ? String(roll.characterId) : undefined,
      rollerRole,
      origin,
      sides,
      die,
      bonus,
      bonusText: String(roll?.bonusText || "").slice(0, 80),
      total,
      label: String(roll?.label || "").trim().slice(0, 120),
      time: String(roll?.time || `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`),
      createdAt
    });
    const createdAtMs = Date.parse(createdAt);
    const order = -(Number.isFinite(createdAtMs) ? createdAtMs : Date.now());
    const stored = cleanSubDoc(outgoing, order);

    try {
      await withRetry(() => api.setDoc(
        api.doc(db, "campaigns", campaignId, "diceLogs", outgoing.id),
        stored,
        { merge: false }
      ), ctx);
    } catch (err) {
      console.warn("SDK Firestore falhou ao registrar rolagem; usando REST.", err);
      await restPatchDoc(`campaigns/${campaignId}/diceLogs/${outgoing.id}`, stored);
    }

    const cachedLogs = campaignSaveCache.get(campaignId)?.diceLogs;
    if (cachedLogs && !cachedLogs.some(entry => String(entry.id) === outgoing.id)) {
      cachedLogs.unshift({ ...outgoing });
    }
    return outgoing;
  }

  async function sendPrivateCampaignMessage(campaignId, message) {
    if (!campaignId || !auth.currentUser) throw new Error("Mensagem privada sem campanha ou usuario autenticado.");

    const now = new Date();
    const sentAt = String(message?.sentAt || now.toISOString());
    const text = String(message?.text || "").trim().slice(0, 500);
    const conversationType = message?.conversationType === "master-player" ? "master-player" : "players";
    const participantPlayerIds = (message?.participantPlayerIds || []).map(String);
    const participantCharacterIds = (message?.participantCharacterIds || []).map(String);
    const participantAuthUids = (message?.participantAuthUids || []).map(String);
    const participantOrigins = (message?.participantOrigins || []).map(origin => String(origin || "Sem origem").slice(0, 80));
    const expectedPlayerCount = conversationType === "master-player" ? 1 : 2;
    if (!text) throw new Error("A mensagem esta vazia.");
    if (
      participantPlayerIds.length !== expectedPlayerCount
      || participantCharacterIds.length !== expectedPlayerCount
      || participantAuthUids.length !== 2
      || participantOrigins.length !== 2
      || participantPlayerIds.some(id => !id)
      || participantCharacterIds.some(id => !id)
      || participantAuthUids.some(id => !id)
      || new Set(participantPlayerIds).size !== expectedPlayerCount
      || new Set(participantCharacterIds).size !== expectedPlayerCount
      || new Set(participantAuthUids).size !== 2
    ) {
      throw new Error("Participantes da conversa privada invalidos.");
    }

    const outgoing = stripUndefined({
      id: String(message?.id || makeId()),
      threadId: String(message?.threadId || "").slice(0, 180),
      conversationType,
      participantPlayerIds,
      participantCharacterIds,
      participantAuthUids,
      participantOrigins,
      authorId: auth.currentUser.uid,
      authorRole: message?.authorRole === "master" ? "master" : "player",
      authorPlayerId: String(message?.authorPlayerId || ""),
      authorCharacterId: String(message?.authorCharacterId || ""),
      authorOrigin: String(message?.authorOrigin || "Sem origem").trim().slice(0, 80) || "Sem origem",
      text,
      time: String(message?.time || `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`),
      sentAt
    });
    if (!outgoing.threadId) throw new Error("Conversa privada invalida.");

    const sentAtMs = Date.parse(sentAt);
    const order = -(Number.isFinite(sentAtMs) ? sentAtMs : Date.now());
    const copies = participantAuthUids.map(accessUid => ({
      docId: `${outgoing.id}--${accessUid}`,
      data: cleanSubDoc({ ...outgoing, accessUid }, order)
    }));
    try {
      await withRetry(() => {
        if (typeof api.writeBatch !== "function") {
          return Promise.all(copies.map(copy => api.setDoc(
            api.doc(db, "campaigns", campaignId, "privateMessages", copy.docId),
            copy.data,
            { merge: false }
          )));
        }
        const batch = api.writeBatch(db);
        copies.forEach(copy => batch.set(
          api.doc(db, "campaigns", campaignId, "privateMessages", copy.docId),
          copy.data,
          { merge: false }
        ));
        return batch.commit();
      }, ctx);
    } catch (err) {
      console.warn("SDK Firestore falhou ao enviar mensagem privada; usando REST.", err);
      await Promise.all(copies.map(copy => (
        restPatchDoc(`campaigns/${campaignId}/privateMessages/${copy.docId}`, copy.data)
      )));
    }
    return outgoing;
  }

  async function updateCharacterInventory(campaignId, characterId, inventory, options = {}) {
    if (!campaignId || !characterId || !auth.currentUser) {
      throw new Error("Inventario de personagem invalido.");
    }

    const cleanInventory = stripUndefined(Array.isArray(inventory) ? inventory : []);
    assertManagedImages(cleanInventory, "O inventario");
    const inventoryUpdatedAt = new Date().toISOString();
    const update = { inventory: cleanInventory, inventoryUpdatedAt };
    if (Object.prototype.hasOwnProperty.call(options, "appliedOriginLoadouts")) {
      update.appliedOriginLoadouts = Array.from(new Set(
        (Array.isArray(options.appliedOriginLoadouts) ? options.appliedOriginLoadouts : [])
          .map(origin => String(origin || "").trim())
          .filter(Boolean)
      ));
    }
    try {
      await withRetry(() => api.updateDoc(
        api.doc(db, "campaigns", campaignId, "characters", String(characterId)),
        update
      ), ctx);
    } catch (err) {
      console.warn("SDK Firestore falhou ao atualizar inventario; usando REST.", err);
      await restPatchDoc(`campaigns/${campaignId}/characters/${String(characterId)}`, update);
    }

    const cachedCharacter = campaignSaveCache.get(campaignId)?.characters
      ?.find(character => String(character.id) === String(characterId));
    if (cachedCharacter) Object.assign(cachedCharacter, stripUndefined(update));
    return update;
  }

  async function updateCharacterEvidenceAssignments(campaignId, characterUpdates) {
    if (!campaignId || !auth.currentUser || !Array.isArray(characterUpdates)) {
      throw new Error("Vinculos de evidencias invalidos.");
    }

    const updatedAt = new Date().toISOString();
    const updates = Array.from(new Map(characterUpdates
      .filter(entry => entry?.characterId)
      .map(entry => [String(entry.characterId), {
        id: String(entry.characterId),
        evidence: stripUndefined(Array.isArray(entry.evidence) ? entry.evidence : [])
      }])).values());
    assertManagedImages(updates, "Os vinculos de evidencias");
    const campaignRef = api.doc(db, "campaigns", campaignId);

    await withRetry(() => api.runTransaction(db, async transaction => {
      updates.forEach(entry => {
        transaction.update(
          api.doc(db, "campaigns", campaignId, "characters", entry.id),
          { evidence: entry.evidence, evidenceUpdatedAt: updatedAt }
        );
      });
      transaction.update(campaignRef, { updatedAt });
    }), ctx);

    const cachedCharacters = campaignSaveCache.get(campaignId)?.characters || [];
    updates.forEach(entry => {
      const cachedCharacter = cachedCharacters.find(character => String(character.id) === entry.id);
      if (cachedCharacter) {
        cachedCharacter.evidence = JSON.parse(JSON.stringify(entry.evidence));
        cachedCharacter.evidenceUpdatedAt = updatedAt;
      }
    });
    return { updatedAt, characters: updates };
  }

  async function deleteEvidenceCatalogEntry(campaignId, evidenceId, characterUpdates) {
    if (!campaignId || !evidenceId || !auth.currentUser || !Array.isArray(characterUpdates)) {
      throw new Error("Exclusao de evidencia invalida.");
    }

    const normalizedEvidenceId = String(evidenceId);
    const updatedAt = new Date().toISOString();
    const updates = Array.from(new Map(characterUpdates
      .filter(entry => entry?.characterId)
      .map(entry => [String(entry.characterId), {
        id: String(entry.characterId),
        evidence: stripUndefined(Array.isArray(entry.evidence) ? entry.evidence : [])
      }])).values());
    assertManagedImages(updates, "Os vinculos de evidencias");
    const campaignRef = api.doc(db, "campaigns", campaignId);
    const evidenceRef = api.doc(db, "campaigns", campaignId, "evidence", normalizedEvidenceId);

    await withRetry(() => api.runTransaction(db, async transaction => {
      transaction.delete(evidenceRef);
      updates.forEach(entry => {
        transaction.update(
          api.doc(db, "campaigns", campaignId, "characters", entry.id),
          { evidence: entry.evidence, evidenceUpdatedAt: updatedAt }
        );
      });
      transaction.update(campaignRef, { updatedAt });
    }), ctx);

    const cached = campaignSaveCache.get(campaignId);
    if (cached) {
      cached.evidence = (cached.evidence || []).filter(entry => String(entry.id) !== normalizedEvidenceId);
      updates.forEach(entry => {
        const cachedCharacter = cached.characters?.find(character => String(character.id) === entry.id);
        if (cachedCharacter) cachedCharacter.evidence = JSON.parse(JSON.stringify(entry.evidence));
      });
    }
    return { evidenceId: normalizedEvidenceId, updatedAt, characters: updates };
  }

  async function updateTraumaCatalog(campaignId, traumaCatalog) {
    if (!campaignId || !auth.currentUser) {
      throw new Error("Catalogo de traumas invalido.");
    }

    const update = {
      traumaCatalog: stripUndefined(Array.isArray(traumaCatalog) ? traumaCatalog : []),
      updatedAt: new Date().toISOString()
    };
    assertManagedImages(update.traumaCatalog, "O catalogo de traumas");
    try {
      await withRetry(() => api.updateDoc(
        api.doc(db, "campaigns", campaignId),
        update
      ), ctx);
    } catch (err) {
      console.warn("SDK Firestore falhou ao atualizar catalogo de traumas; usando REST.", err);
      await restPatchDoc(`campaigns/${campaignId}`, update);
    }
    return update;
  }

  async function updateTraumaCatalogAndCharacters(campaignId, traumaCatalog, characterUpdates) {
    if (!campaignId || !auth.currentUser || !Array.isArray(characterUpdates)) {
      throw new Error("Exclusao de trauma invalida.");
    }

    const updatedAt = new Date().toISOString();
    const cleanCatalog = stripUndefined(Array.isArray(traumaCatalog) ? traumaCatalog : []);
    const updates = Array.from(new Map(characterUpdates
      .filter(entry => entry?.characterId)
      .map(entry => [String(entry.characterId), {
        id: String(entry.characterId),
        traumas: stripUndefined(Array.isArray(entry.traumas) ? entry.traumas : [])
      }])).values());
    assertManagedImages(cleanCatalog, "O catalogo de traumas");
    assertManagedImages(updates, "Os traumas dos personagens");
    const campaignRef = api.doc(db, "campaigns", campaignId);

    await withRetry(() => api.runTransaction(db, async transaction => {
      transaction.update(campaignRef, { traumaCatalog: cleanCatalog, updatedAt });
      updates.forEach(entry => {
        transaction.update(
          api.doc(db, "campaigns", campaignId, "characters", entry.id),
          { traumas: entry.traumas, traumasUpdatedAt: updatedAt }
        );
      });
    }), ctx);

    const cachedCharacters = campaignSaveCache.get(campaignId)?.characters || [];
    updates.forEach(entry => {
      const cachedCharacter = cachedCharacters.find(character => String(character.id) === entry.id);
      if (cachedCharacter) {
        cachedCharacter.traumas = JSON.parse(JSON.stringify(entry.traumas));
        cachedCharacter.traumasUpdatedAt = updatedAt;
      }
    });
    return { traumaCatalog: cleanCatalog, updatedAt, characters: updates };
  }

  async function updateCharacterTraumas(campaignId, characterId, traumas, traumaEvent = null) {
    if (!campaignId || !characterId || !auth.currentUser) {
      throw new Error("Traumas de personagem invalidos.");
    }

    const cleanTraumas = stripUndefined(Array.isArray(traumas) ? traumas : []);
    assertManagedImages(cleanTraumas, "Os traumas do personagem");
    const updatedAt = new Date().toISOString();
    const characterUpdate = {
      traumas: cleanTraumas,
      traumasUpdatedAt: updatedAt
    };
    const campaignUpdate = {
      updatedAt,
      ...(traumaEvent ? { latestTraumaEvent: stripUndefined(traumaEvent) } : {})
    };
    const campaignRef = api.doc(db, "campaigns", campaignId);
    const characterRef = api.doc(db, "campaigns", campaignId, "characters", String(characterId));

    await withRetry(() => api.runTransaction(db, async transaction => {
      transaction.update(characterRef, characterUpdate);
      transaction.update(campaignRef, campaignUpdate);
    }), ctx);

    const cachedCharacter = campaignSaveCache.get(campaignId)?.characters
      ?.find(character => String(character.id) === String(characterId));
    if (cachedCharacter) Object.assign(cachedCharacter, stripUndefined(characterUpdate));

    return {
      ...characterUpdate,
      latestTraumaEvent: campaignUpdate.latestTraumaEvent || null
    };
  }

  async function updateCharacterExpressions(campaignId, characterId, expressions, activeExpression = "") {
    if (!campaignId || !characterId || !auth.currentUser) {
      throw new Error("Expressoes de personagem invalidas.");
    }

    const cleanExpressions = stripUndefined(Array.isArray(expressions) ? expressions : []);
    assertManagedImages(cleanExpressions, "As expressoes do personagem");
    const update = {
      expressions: cleanExpressions,
      activeExpression: String(activeExpression || ""),
      expressionUpdatedAt: new Date().toISOString()
    };
    try {
      await withRetry(() => api.updateDoc(
        api.doc(db, "campaigns", campaignId, "characters", String(characterId)),
        update
      ), ctx);
    } catch (err) {
      console.warn("SDK Firestore falhou ao atualizar expressoes; usando REST.", err);
      await restPatchDoc(`campaigns/${campaignId}/characters/${String(characterId)}`, update);
    }

    const cachedCharacter = campaignSaveCache.get(campaignId)?.characters
      ?.find(character => String(character.id) === String(characterId));
    if (cachedCharacter) Object.assign(cachedCharacter, stripUndefined(update));
    return update;
  }

  async function assignPlayerCharacter(campaignId, playerId, characterId) {
    if (!campaignId || !playerId || !auth.currentUser) throw new Error("Vinculo de personagem invalido.");

    const normalizedPlayerId = String(playerId);
    const nextCharacterId = characterId ? String(characterId) : null;
    const campaignRef = api.doc(db, "campaigns", campaignId);
    const playerRef = api.doc(db, "campaigns", campaignId, "players", normalizedPlayerId);
    const updatedAt = new Date().toISOString();
    const updatedBy = auth.currentUser.uid;

    const result = await withRetry(() => api.runTransaction(db, async transaction => {
      const playerSnap = await transaction.get(playerRef);
      if (!playerSnap.exists()) throw new Error("Jogador nao encontrado.");

      const playerData = playerSnap.data();
      const previousCharacterId = playerData.characterId ? String(playerData.characterId) : null;
      const characterIds = Array.from(new Set([previousCharacterId, nextCharacterId].filter(Boolean)));
      const characterEntries = [];

      for (const id of characterIds) {
        const ref = api.doc(db, "campaigns", campaignId, "characters", id);
        characterEntries.push([id, ref, await transaction.get(ref)]);
      }

      const charactersById = new Map(characterEntries.map(([id, ref, snap]) => [id, { ref, snap }]));
      const nextEntry = nextCharacterId ? charactersById.get(nextCharacterId) : null;
      if (nextCharacterId && !nextEntry?.snap.exists()) throw new Error("Personagem nao encontrado.");

      const nextController = nextEntry?.snap.data()?.controllerPlayerId;
      if (nextController && String(nextController) !== normalizedPlayerId) {
        throw new Error("Este personagem ja esta vinculado a outro jogador.");
      }

      const playerUpdate = {
        characterId: nextCharacterId,
        characterLinkUpdatedAt: updatedAt,
        characterLinkUpdatedBy: updatedBy
      };
      transaction.update(playerRef, playerUpdate);

      const previousEntry = previousCharacterId ? charactersById.get(previousCharacterId) : null;
      if (previousEntry?.snap.exists() && previousCharacterId !== nextCharacterId) {
        const previousController = previousEntry.snap.data()?.controllerPlayerId;
        if (!previousController || String(previousController) === normalizedPlayerId) {
          transaction.update(previousEntry.ref, { controllerPlayerId: null });
        }
      }
      if (nextEntry) transaction.update(nextEntry.ref, { controllerPlayerId: normalizedPlayerId });

      const normalizedEmail = String(playerData.emailNormalized || playerData.email || "").trim().toLowerCase();
      const campaignUpdate = { updatedAt };
      if (normalizedEmail) {
        campaignUpdate.readyPlayerEmails = nextCharacterId
          ? api.arrayUnion(normalizedEmail)
          : api.arrayRemove(normalizedEmail);
      }
      transaction.update(campaignRef, campaignUpdate);

      return {
        player: { id: playerSnap.id, ...playerData, ...playerUpdate },
        previousCharacterId,
        character: nextEntry ? {
          id: nextEntry.snap.id,
          ...nextEntry.snap.data(),
          controllerPlayerId: normalizedPlayerId
        } : null
      };
    }), ctx);

    const cached = campaignSaveCache.get(campaignId);
    if (cached) {
      const cachedPlayer = cached.players?.find(player => String(player.id) === normalizedPlayerId);
      if (cachedPlayer) Object.assign(cachedPlayer, result.player);
      if (result.previousCharacterId && result.previousCharacterId !== nextCharacterId) {
        const previousCharacter = cached.characters?.find(character => String(character.id) === result.previousCharacterId);
        if (String(previousCharacter?.controllerPlayerId || "") === normalizedPlayerId) previousCharacter.controllerPlayerId = null;
      }
      if (nextCharacterId) {
        const nextCharacter = cached.characters?.find(character => String(character.id) === nextCharacterId);
        if (nextCharacter) nextCharacter.controllerPlayerId = normalizedPlayerId;
      }
    }

    return result;
  }

  async function resolveItemTransfer(campaignId, transferId, decision) {
    if (!campaignId || !transferId || !auth.currentUser) throw new Error("Transferencia invalida.");
    if (!["approved", "rejected"].includes(decision)) throw new Error("Decisao de transferencia invalida.");

    const transferRef = api.doc(db, "campaigns", campaignId, "itemTransfers", String(transferId));
    const resolvedDate = new Date();
    const resolvedAt = resolvedDate.toISOString();
    const resolvedBy = auth.currentUser.uid;

    const result = await withRetry(() => api.runTransaction(db, async transaction => {
      const transferSnap = await transaction.get(transferRef);
      if (!transferSnap.exists()) throw new Error("Solicitacao de transferencia nao encontrada.");
      const transfer = { id: transferSnap.id, ...transferSnap.data() };

      if (transfer.status !== "pending") {
        return { transfer, alreadyResolved: true };
      }

      const resolution = {
        status: decision,
        resolvedAt,
        resolvedBy,
        time: resolvedDate.toLocaleString("pt-BR")
      };
      if (decision === "rejected") {
        transaction.update(transferRef, resolution);
        return { transfer: { ...transfer, ...resolution } };
      }

      if (transfer.type === "evidence") {
        if (!transfer.fromCharacterId || !transfer.toCharacterId || !transfer.evidenceEntryId || !transfer.evidenceId) {
          throw new Error("A solicitacao nao possui os vinculos de evidencia necessarios.");
        }
        if (String(transfer.fromCharacterId) === String(transfer.toCharacterId)) {
          throw new Error("Origem e destino da transferencia sao iguais.");
        }

        const sourceRef = api.doc(db, "campaigns", campaignId, "characters", String(transfer.fromCharacterId));
        const targetRef = api.doc(db, "campaigns", campaignId, "characters", String(transfer.toCharacterId));
        const sourceSnap = await transaction.get(sourceRef);
        const targetSnap = await transaction.get(targetRef);
        if (!sourceSnap.exists() || !targetSnap.exists()) throw new Error("Um dos personagens nao existe mais.");

        const sourceEvidence = JSON.parse(JSON.stringify(sourceSnap.data().evidence || []));
        const targetEvidence = JSON.parse(JSON.stringify(targetSnap.data().evidence || []));
        const sourceIndex = sourceEvidence.findIndex(entry => String(entry.id) === String(transfer.evidenceEntryId));
        if (sourceIndex < 0) throw new Error("A evidencia nao esta mais com o personagem de origem.");

        const evidence = sourceEvidence[sourceIndex];
        if (String(evidence.evidenceId || "") !== String(transfer.evidenceId)) {
          throw new Error("O vinculo da evidencia foi alterado.");
        }
        if (targetEvidence.some(entry => String(entry.evidenceId || "") === String(evidence.evidenceId || ""))) {
          throw new Error("O personagem de destino ja possui esta evidencia.");
        }

        sourceEvidence.splice(sourceIndex, 1);
        targetEvidence.unshift(stripUndefined({
          ...evidence,
          id: makeId(),
          grantedAt: resolvedAt
        }));
        assertManagedImages(sourceEvidence, "As evidencias do personagem de origem");
        assertManagedImages(targetEvidence, "As evidencias do personagem de destino");
        transaction.update(sourceRef, { evidence: sourceEvidence, evidenceUpdatedAt: resolvedAt });
        transaction.update(targetRef, { evidence: targetEvidence, evidenceUpdatedAt: resolvedAt });
        transaction.update(transferRef, resolution);

        return {
          transfer: { ...transfer, ...resolution },
          sourceCharacter: { id: sourceSnap.id, evidence: sourceEvidence },
          targetCharacter: { id: targetSnap.id, evidence: targetEvidence }
        };
      }

      if (transfer.type !== "item") throw new Error("Tipo de transferencia invalido.");

      if (!transfer.fromCharacterId || !transfer.toCharacterId || !transfer.inventoryId) {
        throw new Error("A solicitacao nao possui os vinculos de inventario necessarios.");
      }
      if (String(transfer.fromCharacterId) === String(transfer.toCharacterId)) {
        throw new Error("Origem e destino da transferencia sao iguais.");
      }

      const sourceRef = api.doc(db, "campaigns", campaignId, "characters", String(transfer.fromCharacterId));
      const targetRef = api.doc(db, "campaigns", campaignId, "characters", String(transfer.toCharacterId));
      const sourceSnap = await transaction.get(sourceRef);
      const targetSnap = await transaction.get(targetRef);
      if (!sourceSnap.exists() || !targetSnap.exists()) throw new Error("Um dos personagens nao existe mais.");

      const sourceData = sourceSnap.data();
      const targetData = targetSnap.data();
      const sourceInventory = JSON.parse(JSON.stringify(sourceData.inventory || []));
      const targetInventory = JSON.parse(JSON.stringify(targetData.inventory || []));
      const sourceIndex = sourceInventory.findIndex(entry => String(entry.id) === String(transfer.inventoryId));
      if (sourceIndex < 0) throw new Error("O item nao esta mais no inventario de origem.");

      const amount = Math.max(1, Number.parseInt(transfer.quantity, 10) || 1);
      const sourceItem = sourceInventory[sourceIndex];
      if ((Number(sourceItem.quantity) || 0) < amount) throw new Error("Quantidade indisponivel no inventario de origem.");

      const targetEntry = sourceItem.itemId
        ? targetInventory.find(entry => String(entry.itemId || "") === String(sourceItem.itemId) && String(entry.notes || "") === String(sourceItem.notes || ""))
        : null;
      if (targetEntry) {
        targetEntry.quantity = Math.max(0, Number(targetEntry.quantity) || 0) + amount;
        if (String(sourceItem.name || "").trim()) targetEntry.name = String(sourceItem.name).trim();
        if (String(sourceItem.description || "").trim()) targetEntry.description = String(sourceItem.description).trim();
        if (String(sourceItem.image || "").trim()) targetEntry.image = String(sourceItem.image).trim();
      } else {
        targetInventory.push(stripUndefined({
          ...sourceItem,
          id: makeId(),
          quantity: amount,
          equipped: false,
          grantedAt: resolvedAt
        }));
      }

      sourceItem.quantity = Math.max(0, Number(sourceItem.quantity) || 0) - amount;
      if (sourceItem.quantity === 0) sourceInventory.splice(sourceIndex, 1);

      assertManagedImages(sourceInventory, "O inventario do personagem de origem");
      assertManagedImages(targetInventory, "O inventario do personagem de destino");
      transaction.update(sourceRef, { inventory: sourceInventory, inventoryUpdatedAt: resolvedAt });
      transaction.update(targetRef, { inventory: targetInventory, inventoryUpdatedAt: resolvedAt });
      transaction.update(transferRef, resolution);

      return {
        transfer: { ...transfer, ...resolution },
        sourceCharacter: { id: sourceSnap.id, inventory: sourceInventory },
        targetCharacter: { id: targetSnap.id, inventory: targetInventory }
      };
    }), ctx);

    const cached = campaignSaveCache.get(campaignId);
    if (cached && result?.sourceCharacter) {
      const source = cached.characters?.find(character => String(character.id) === String(result.sourceCharacter.id));
      if (source) {
        if (result.sourceCharacter.inventory) source.inventory = JSON.parse(JSON.stringify(result.sourceCharacter.inventory));
        if (result.sourceCharacter.evidence) source.evidence = JSON.parse(JSON.stringify(result.sourceCharacter.evidence));
      }
    }
    if (cached && result?.targetCharacter) {
      const target = cached.characters?.find(character => String(character.id) === String(result.targetCharacter.id));
      if (target) {
        if (result.targetCharacter.inventory) target.inventory = JSON.parse(JSON.stringify(result.targetCharacter.inventory));
        if (result.targetCharacter.evidence) target.evidence = JSON.parse(JSON.stringify(result.targetCharacter.evidence));
      }
    }
    return result;
  }

  function assertManagedPlayerSubcollectionChanges(key, items, playerId, userId, previousItems = null) {
    if (!["messages", "diceLogs", "itemTransfers"].includes(key)) return;
    const previousIds = new Set((previousItems || []).map(item => String(item.id)));
    items.forEach((item, index) => {
      if (previousIds.has(String(item.id))) return;
      if (key === "itemTransfers" && String(item.fromPlayerId || "") !== String(playerId)) return;
      if (key !== "itemTransfers" && item.authorId !== userId) return;
      assertManagedImages(cleanSubDoc(item, index), `O documento ${key}/${String(item.id)}`);
    });
  }

  async function syncPlayerSubcollection(campaignId, key, items, playerId, userId, previousItems = null) {
    const previous = Array.isArray(previousItems)
      ? previousItems
      : (campaignSaveCache.get(campaignId)?.[key] || []);
    const previousById = new Map(previous.map(item => [String(item.id), item]));

    if (key === "characters") {
      const character = items.find(item => String(item.controllerPlayerId || "") === String(playerId));
      if (!character) return;
      const prior = previousById.get(String(character.id)) || {};
      const writable = {
        controllerPlayerId: String(playerId),
        health: character.health,
        sanity: character.sanity,
        skills: character.skills || []
      };
      const priorWritable = {
        controllerPlayerId: prior.controllerPlayerId || null,
        health: prior.health,
        sanity: prior.sanity,
        skills: prior.skills || []
      };
      if (JSON.stringify(writable) !== JSON.stringify(priorWritable)) {
        await withRetry(() => api.setDoc(
          api.doc(db, "campaigns", campaignId, key, String(character.id)),
          stripUndefined(writable),
          { merge: true }
        ), ctx);
      }
      return;
    }

    if (!["messages", "diceLogs", "itemTransfers"].includes(key)) return;
    assertManagedPlayerSubcollectionChanges(key, items, playerId, userId, previous);
    const newItems = items.filter(item => {
      if (previousById.has(String(item.id))) return false;
      if (key === "itemTransfers") return String(item.fromPlayerId || "") === String(playerId);
      return item.authorId === userId;
    });

    for (const item of newItems) {
      const order = Math.max(0, items.findIndex(entry => String(entry.id) === String(item.id)));
      const clean = cleanSubDoc(item, order);
      await withRetry(() => api.setDoc(
        api.doc(db, "campaigns", campaignId, key, String(item.id)),
        clean,
        { merge: false }
      ), ctx);
    }
  }

  async function adjustCharacterVital(campaignId, characterId, key, delta) {
    const normalizedCampaignId = String(campaignId || "").trim();
    const normalizedCharacterId = String(characterId || "").trim();
    const normalizedKey = String(key || "");
    const parsedDelta = Math.trunc(Number(delta) || 0);
    if (!normalizedCampaignId || !normalizedCharacterId || !auth.currentUser) {
      throw new Error("Alteracao de atributo sem campanha, personagem ou usuario autenticado.");
    }
    if (!new Set(["health", "sanity"]).has(normalizedKey) || !parsedDelta) {
      throw new Error("Alteracao de atributo invalida.");
    }

    const characterRef = api.doc(db, "campaigns", normalizedCampaignId, "characters", normalizedCharacterId);
    const result = await withRetry(() => api.runTransaction(db, async transaction => {
      const snapshot = await transaction.get(characterRef);
      if (!snapshot.exists()) throw new Error("Personagem nao encontrado.");
      const character = snapshot.data() || {};
      const currentNumber = Number(character[normalizedKey]);
      const current = Number.isFinite(currentNumber) ? Math.max(0, currentNumber) : 0;
      const maxNumber = Number(character[`${normalizedKey}Max`]);
      const max = Number.isFinite(maxNumber) && maxNumber > 0
        ? maxNumber
        : Math.max(1, current);
      const value = Math.max(0, Math.min(max, current + parsedDelta));
      if (value !== current) transaction.update(characterRef, { [normalizedKey]: value });
      return {
        campaignId: normalizedCampaignId,
        characterId: normalizedCharacterId,
        key: normalizedKey,
        value,
        max
      };
    }), ctx);

    const cached = campaignSaveCache.get(normalizedCampaignId);
    const cachedCharacter = cached?.characters?.find(character => String(character.id) === normalizedCharacterId);
    if (cachedCharacter) cachedCharacter[normalizedKey] = result.value;
    return result;
  }

  function sceneWithoutStorageFields(scene) {
    if (!scene || typeof scene !== "object") return scene;
    const { _order, ...clean } = scene;
    return JSON.parse(JSON.stringify(clean));
  }

  async function trashCampaignScene(campaignId, sceneId) {
    const normalizedCampaignId = String(campaignId || "").trim();
    const normalizedSceneId = assertDocumentId(sceneId, "Identificador da cena");
    if (!normalizedCampaignId || !auth.currentUser) throw new Error("Exclusao de cena invalida.");

    const campaignRef = api.doc(db, "campaigns", normalizedCampaignId);
    const sceneRef = api.doc(db, "campaigns", normalizedCampaignId, "scenes", normalizedSceneId);
    const trashRef = api.doc(db, "campaigns", normalizedCampaignId, "sceneTrash", normalizedSceneId);
    const deletedAt = new Date().toISOString();
    const result = await withRetry(() => api.runTransaction(db, async transaction => {
      const campaignSnapshot = await transaction.get(campaignRef);
      const sceneSnapshot = await transaction.get(sceneRef);
      const trashSnapshot = await transaction.get(trashRef);
      if (!campaignSnapshot.exists()) throw new Error("Campanha nao encontrada.");
      if (!sceneSnapshot.exists()) {
        if (!trashSnapshot.exists()) throw new Error("Cena nao encontrada.");
        return { scene: trashSnapshot.data(), liveScene: campaignSnapshot.data()?.liveScene || null };
      }

      const storedScene = sceneSnapshot.data() || {};
      const trashedScene = stripUndefined({
        ...storedScene,
        id: normalizedSceneId,
        previousOrder: Number.isFinite(Number(storedScene._order)) ? Number(storedScene._order) : 0,
        _order: -Date.now(),
        deletedAt,
        deletedBy: String(auth.currentUser.uid || "")
      });
      transaction.set(trashRef, trashedScene, { merge: false });
      transaction.delete(sceneRef);

      const campaign = campaignSnapshot.data() || {};
      const wasLive = String(campaign.liveScene?.sceneId || "") === normalizedSceneId;
      const liveScene = wasLive
        ? cleanLiveScene({ active: false, sceneId: null, image: "", index: 0, total: 0 }, deletedAt)
        : campaign.liveScene || null;
      transaction.update(campaignRef, {
        updatedAt: deletedAt,
        ...(wasLive ? { liveScene } : {})
      });
      return { scene: trashedScene, liveScene, wasLive };
    }), ctx);

    const cached = campaignSaveCache.get(normalizedCampaignId);
    if (cached) {
      cached.scenes = (cached.scenes || []).filter(scene => String(scene.id) !== normalizedSceneId);
      cached.sceneTrash = [
        sceneWithoutStorageFields(result.scene),
        ...(cached.sceneTrash || []).filter(scene => String(scene.id) !== normalizedSceneId)
      ];
    }
    return {
      scene: sceneWithoutStorageFields(result.scene),
      liveScene: result.liveScene ? JSON.parse(JSON.stringify(result.liveScene)) : null,
      wasLive: Boolean(result.wasLive)
    };
  }

  async function restoreCampaignScene(campaignId, sceneId, options = {}) {
    const normalizedCampaignId = String(campaignId || "").trim();
    const normalizedSceneId = assertDocumentId(sceneId, "Identificador da cena");
    if (!normalizedCampaignId || !auth.currentUser) throw new Error("Restauracao de cena invalida.");

    const scenesRef = api.collection(db, "campaigns", normalizedCampaignId, "scenes");
    const activeSnapshot = await withRetry(() => api.getDocs(scenesRef), ctx);
    const activeCount = activeSnapshot.docs.length;
    if (activeCount >= 40) {
      const error = new Error("O roteiro ja possui o limite de 40 cenas ativas.");
      error.code = "campaign/scene-limit-reached";
      throw error;
    }

    const campaignRef = api.doc(db, "campaigns", normalizedCampaignId);
    const sceneRef = api.doc(db, "campaigns", normalizedCampaignId, "scenes", normalizedSceneId);
    const trashRef = api.doc(db, "campaigns", normalizedCampaignId, "sceneTrash", normalizedSceneId);
    const restoredAt = new Date().toISOString();
    const result = await withRetry(() => api.runTransaction(db, async transaction => {
      const campaignSnapshot = await transaction.get(campaignRef);
      const sceneSnapshot = await transaction.get(sceneRef);
      const trashSnapshot = await transaction.get(trashRef);
      if (!campaignSnapshot.exists()) throw new Error("Campanha nao encontrada.");
      if (sceneSnapshot.exists()) {
        if (trashSnapshot.exists()) transaction.delete(trashRef);
        return sceneSnapshot.data();
      }
      if (!trashSnapshot.exists()) throw new Error("Cena nao encontrada na lixeira.");

      const trashedScene = trashSnapshot.data() || {};
      const { deletedAt, deletedBy, previousOrder, _order, ...sceneData } = trashedScene;
      const requestedOrder = Number(options.order);
      const restoredScene = stripUndefined({
        ...sceneData,
        id: normalizedSceneId,
        _order: Number.isFinite(requestedOrder) ? Math.max(0, requestedOrder) : activeCount,
        restoredAt
      });
      transaction.set(sceneRef, restoredScene, { merge: false });
      transaction.delete(trashRef);
      transaction.update(campaignRef, { updatedAt: restoredAt });
      return restoredScene;
    }), ctx);

    const cached = campaignSaveCache.get(normalizedCampaignId);
    if (cached) {
      cached.sceneTrash = (cached.sceneTrash || []).filter(scene => String(scene.id) !== normalizedSceneId);
      const restored = sceneWithoutStorageFields(result);
      cached.scenes = [...(cached.scenes || []).filter(scene => String(scene.id) !== normalizedSceneId), restored];
    }
    return { scene: sceneWithoutStorageFields(result), restoredAt };
  }

  async function updateCampaignScenes(campaignId, scenes, options = {}) {
    if (!campaignId || !auth.currentUser || !Array.isArray(scenes)) {
      throw new Error("Roteiro de cenas invalido.");
    }

    const normalizedCampaignId = String(campaignId);
    if (scenes.length > 40) {
      const error = new Error("O roteiro aceita no maximo 40 cenas ativas.");
      error.code = "campaign/scene-limit-reached";
      throw error;
    }
    const cleanedScenes = scenes.map((scene, index) => cleanScene(scene, index));
    if (new Set(cleanedScenes.map(scene => scene.id)).size !== cleanedScenes.length) {
      throw new Error("O roteiro possui cenas com identificadores repetidos.");
    }

    const updatedAt = new Date().toISOString();
    const hasLiveScene = Object.prototype.hasOwnProperty.call(options || {}, "liveScene");
    let liveScene = hasLiveScene ? cleanLiveScene(options.liveScene, updatedAt) : null;
    if (liveScene?.active && !liveScene.sceneId) {
      throw new Error("A cena ao vivo ativa precisa de um identificador.");
    }
    if (liveScene?.sceneId) {
      const liveIndex = cleanedScenes.findIndex(scene => scene.id === liveScene.sceneId);
      if (liveScene.active && liveIndex < 0) throw new Error("A cena ao vivo nao pertence ao roteiro.");
      if (liveIndex >= 0) {
        liveScene = {
          ...liveScene,
          image: cleanedScenes[liveIndex].image,
          index: liveIndex,
          total: cleanedScenes.length,
          updatedAt
        };
      }
    }

    const previousScenes = campaignSaveCache.get(normalizedCampaignId)?.scenes || [];
    const previousIds = new Set(previousScenes.map(scene => String(scene.id)));
    const nextIds = new Set(cleanedScenes.map(scene => scene.id));
    const previousById = new Map(previousScenes.map((scene, index) => [String(scene.id), {
      clean: cleanSubDoc(scene, index),
      scene
    }]));
    const operations = [];

    cleanedScenes.forEach(scene => {
      const ref = api.doc(db, "campaigns", normalizedCampaignId, "scenes", scene.id);
      const previous = previousById.get(scene.id)?.clean;
      if (!previous) {
        operations.push({ method: "set", ref, data: scene, options: { merge: false } });
        return;
      }

      const changes = {};
      const fieldNames = new Set([...Object.keys(previous), ...Object.keys(scene)]);
      fieldNames.forEach(field => {
        if (JSON.stringify(previous[field]) === JSON.stringify(scene[field])) return;
        changes[field] = Object.prototype.hasOwnProperty.call(scene, field) ? scene[field] : api.deleteField();
      });
      if (Object.keys(changes).length) operations.push({ method: "update", ref, data: changes });
    });

    previousIds.forEach(id => {
      if (!nextIds.has(id)) {
        operations.push({
          method: "delete",
          ref: api.doc(db, "campaigns", normalizedCampaignId, "scenes", id)
        });
      }
    });

    const campaignUpdate = {
      updatedAt,
      ...(hasLiveScene ? { liveScene } : {})
    };
    operations.push({
      method: "update",
      ref: api.doc(db, "campaigns", normalizedCampaignId),
      data: campaignUpdate
    });

    if (operations.length > 500) {
      throw new Error("O roteiro excede o limite atomico de 500 operacoes do Firestore.");
    }

    await withRetry(() => {
      if (typeof api.writeBatch === "function") {
        const batch = api.writeBatch(db);
        operations.forEach(operation => {
          if (operation.method === "set") {
            batch.set(operation.ref, operation.data, operation.options);
          } else if (operation.method === "update") {
            batch.update(operation.ref, operation.data);
          } else {
            batch.delete(operation.ref);
          }
        });
        return batch.commit();
      }

      return Promise.all(operations.map(operation => {
        if (operation.method === "set") return api.setDoc(operation.ref, operation.data, operation.options);
        if (operation.method === "update") return api.updateDoc(operation.ref, operation.data);
        return api.deleteDoc(operation.ref);
      }));
    }, ctx);

    const cached = campaignSaveCache.get(normalizedCampaignId) || cloneCollections();
    cached.scenes = cleanedScenes.map(scene => {
      const { _order, ...clean } = scene;
      return JSON.parse(JSON.stringify(clean));
    });
    campaignSaveCache.set(normalizedCampaignId, cached);

    return {
      scenes: JSON.parse(JSON.stringify(cached.scenes)),
      liveScene: liveScene ? JSON.parse(JSON.stringify(liveScene)) : null,
      updatedAt
    };
  }

  async function updateLiveScene(campaignId, liveScene) {
    if (!campaignId || !auth.currentUser) throw new Error("Cena ao vivo invalida.");

    const updatedAt = new Date().toISOString();
    const clean = cleanLiveScene(liveScene, updatedAt);
    const update = { liveScene: clean, updatedAt };
    await withRetry(() => api.updateDoc(
      api.doc(db, "campaigns", String(campaignId)),
      update
    ), ctx);
    return JSON.parse(JSON.stringify(clean));
  }

  async function commitCampaignMediaMutation(campaignId, mutation) {
    if (!auth.currentUser) {
      const error = new Error("Somente um Mestre autenticado pode salvar imagens da campanha.");
      error.code = "campaign/media-master-required";
      throw error;
    }
    const normalizedCampaignId = assertDocumentId(campaignId, "Identificador da campanha");
    const clean = cleanCampaignMediaMutation(mutation);
    if (typeof api.writeBatch !== "function") {
      const error = new Error("O Firestore deste ambiente nao oferece escrita atomica em batch.");
      error.code = "campaign/media-batch-unavailable";
      throw error;
    }

    const campaignRef = api.doc(db, "campaigns", normalizedCampaignId);
    const campaignSnapshot = await withRetry(() => api.getDoc(campaignRef), ctx);
    if (!campaignSnapshot?.exists()) {
      const error = new Error("Campanha nao encontrada para salvar as imagens.");
      error.code = "campaign/media-campaign-not-found";
      throw error;
    }
    if (String(campaignSnapshot.data()?.masterId || "") !== String(auth.currentUser.uid || "")) {
      const error = new Error("Somente o Mestre desta campanha pode salvar suas imagens.");
      error.code = "campaign/media-master-required";
      throw error;
    }

    const updatedAt = new Date().toISOString();
    await withRetry(() => {
      const batch = api.writeBatch(db);
      clean.documents.forEach(document => {
        batch.set(
          api.doc(db, "campaigns", normalizedCampaignId, document.collection, document.id),
          document.data,
          { merge: true }
        );
      });
      batch.update(campaignRef, stripUndefined({
        ...clean.basePatch,
        updatedAt
      }));
      return batch.commit();
    }, ctx);

    campaignSaveCache.delete(normalizedCampaignId);
    return {
      status: "committed",
      verified: true,
      campaignId: normalizedCampaignId,
      documents: clean.documents.length,
      operations: clean.operationCount,
      cloudinaryUrls: clean.cloudinaryUrls.length,
      updatedAt
    };
  }

  async function migrateCampaignImages(campaignId, replacements, expectation) {
    if (!campaignId || !auth.currentUser) throw new Error("Migracao de imagens invalida.");
    const cleanReplacements = cleanImageMigrationReplacements(replacements);
    const normalizedCampaignId = String(campaignId);
    const expected = cleanMigrationExpectation(normalizedCampaignId, expectation, cleanReplacements);
    const migrationCompletedAt = new Date().toISOString();
    const migratableCollections = [...SUBCOLLECTION_KEYS];
    const collectionSnapshots = await Promise.all(migratableCollections.map(key => (
      withRetry(() => api.getDocs(api.collection(db, "campaigns", normalizedCampaignId, key)), ctx)
    )));
    const targetsByKey = new Map();
    const campaignTarget = {
      key: "campaign",
      ref: api.doc(db, "campaigns", normalizedCampaignId),
      label: "campaign",
      id: normalizedCampaignId,
      expected: expected.base,
      expectedCount: migrationReferenceCount(expected.base, cleanReplacements)
    };
    targetsByKey.set(campaignTarget.key, campaignTarget);

    collectionSnapshots.forEach((snapshot, index) => {
      const key = migratableCollections[index];
      snapshot.docs.forEach(documentSnapshot => {
        const id = String(documentSnapshot.id || "");
        const logicalKey = `${key}/${id}`;
        const expectedEntry = (expected.collections[key] || [])
          .find(entry => String(entry?.id || "") === id);
        const remoteData = documentSnapshot.data();
        const expectedEntryCount = expectedEntry
          ? migrationReferenceCount(expectedEntry, cleanReplacements)
          : 0;
        if (!expectedEntryCount
          && !migrationReferenceCount(remoteData, cleanReplacements)
          && !legacyImageReferenceCount(remoteData)) return;
        targetsByKey.set(logicalKey, {
          key: logicalKey,
          ref: documentSnapshot.ref || api.doc(db, "campaigns", normalizedCampaignId, key, String(documentSnapshot.id)),
          label: key,
          id,
          expected: expectedEntryCount
            ? cleanSubDoc(expectedEntry, (expected.collections[key] || []).indexOf(expectedEntry))
            : null,
          expectedCount: expectedEntryCount
        });
      });
    });

    migratableCollections.forEach(key => {
      (expected.collections[key] || []).forEach((entry, order) => {
        const expectedCount = migrationReferenceCount(entry, cleanReplacements);
        if (!expectedCount) return;
        const id = String(entry?.id || "").trim();
        if (!id || id.includes("/") || id.length > 512) {
          throw migrationError(
            `Um documento local de ${key} nao possui identificador valido.`,
            "campaign/migration-document-id-invalid"
          );
        }
        const logicalKey = `${key}/${id}`;
        const prior = targetsByKey.get(logicalKey);
        targetsByKey.set(logicalKey, {
          ...(prior || {}),
          key: logicalKey,
          ref: prior?.ref || api.doc(db, "campaigns", normalizedCampaignId, key, id),
          label: key,
          id,
          expected: cleanSubDoc(entry, order),
          expectedCount
        });
      });
    });

    const targets = [...targetsByKey.values()];
    if (targets.length > MAX_IMAGE_MIGRATION_DOCUMENTS) {
      throw migrationError(
        `A migracao alcancaria mais de ${MAX_IMAGE_MIGRATION_DOCUMENTS} documentos em uma unica transacao.`,
        "campaign/migration-operation-limit"
      );
    }

    const result = await withRetry(() => api.runTransaction(db, async transaction => {
      const snapshots = await Promise.all(targets.map(target => transaction.get(target.ref)));
      if (!snapshots[0]?.exists()) throw new Error("Campanha nao encontrada para migracao.");

      let count = 0;
      let changedDocuments = 0;
      let createdDocuments = 0;
      const pendingWrites = [];
      snapshots.forEach((snapshot, index) => {
        const target = targets[index];
        if (!snapshot?.exists()) {
          if (!target.expectedCount || !target.expected) return;
          throw migrationError(
            `O documento remoto ${target.key} nao existe mais. A migracao nao recria documentos ausentes.`,
            "campaign/migration-remote-data-missing"
          );
        }

        const current = snapshot.data();
        if (!target.expected) {
          if (legacyImageReferenceCount(current)) {
            throw migrationError(
              `O documento remoto ${target.key} possui imagens que nao constam no snapshot local.`,
              "campaign/migration-snapshot-stale"
            );
          }
          return;
        }

        const merged = mergeExpectedMigratedImages(current, target.expected, cleanReplacements, [target.key]);
        if (merged.count !== target.expectedCount) {
          throw migrationError(
            `O documento ${target.key} confirmou ${merged.count} de ${target.expectedCount} referencia(s).`,
            "campaign/migration-count-mismatch"
          );
        }
        let migratedValue = target.label === "campaign"
          ? sanitizeMigratedCampaignBase(merged.value, migrationCompletedAt)
          : merged.value;
        if (migrationReferenceCount(migratedValue, cleanReplacements) || legacyImageReferenceCount(migratedValue)) {
          throw migrationError(
            `O documento ${target.key} ainda possui uma imagem nao gerenciada apos a migracao.`,
            "campaign/migration-snapshot-stale"
          );
        }

        const update = {};
        const fieldNames = new Set([
          ...Object.keys(current || {}),
          ...Object.keys(migratedValue || {})
        ]);
        fieldNames.forEach(field => {
          if (migratedValue[field] === current[field]) return;
          update[field] = Object.prototype.hasOwnProperty.call(migratedValue, field)
            ? migratedValue[field]
            : api.deleteField();
        });

        count += merged.count;
        if (Object.keys(update).length) {
          changedDocuments += 1;
          pendingWrites.push({ method: "update", ref: target.ref, data: update });
        }
      });

      if (count !== expected.expectedCount) {
        throw migrationError(
          `O Firebase confirmou ${count} de ${expected.expectedCount} referencia(s).`,
          "campaign/migration-count-mismatch"
        );
      }
      if (count) {
        const campaignRef = targets[0].ref;
        const campaignUpdate = pendingWrites.find(entry => entry.method === "update" && entry.ref === campaignRef);
        const marker = {
          provider: "cloudinary",
          completedAt: migrationCompletedAt,
          migratedReferences: count,
          verified: true
        };
        if (campaignUpdate) {
          campaignUpdate.data.imageMigration = marker;
          campaignUpdate.data.updatedAt = migrationCompletedAt;
        } else {
          pendingWrites.push({
            method: "update",
            ref: campaignRef,
            data: { imageMigration: marker, updatedAt: migrationCompletedAt }
          });
        }
      }
      if (pendingWrites.length > 500) {
        throw new Error("A migracao excede o limite atomico de 500 documentos do Firestore.");
      }
      pendingWrites.forEach(entry => {
        if (entry.method === "set") transaction.set(entry.ref, entry.data, { merge: false });
        else transaction.update(entry.ref, entry.data);
      });
      return {
        status: count ? "committed" : "noop",
        verified: true,
        count,
        expectedCount: expected.expectedCount,
        documents: changedDocuments,
        createdDocuments
      };
    }), ctx);

    if (!result?.verified || result.count !== expected.expectedCount) {
      throw migrationError("O Firebase nao confirmou integralmente a migracao.", "campaign/migration-unverified");
    }
    if (result.count) campaignSaveCache.delete(normalizedCampaignId);
    return result;
  }

  async function saveCampaign(campaign, options = {}) {
    if (!campaign?.id) return;
    const { base, collections } = splitCampaign(campaign);
    const hasBaseline = options.baseCampaign
      && String(options.baseCampaign.id || "") === String(campaign.id);
    const baseline = hasBaseline ? splitCampaign(options.baseCampaign) : null;
    const updatedAt = new Date().toISOString();
    const isPlayer = options.role === "player";
    const campaignRef = api.doc(db, "campaigns", campaign.id);
    let masterBaseWrite = null;
    let mutationAcknowledgedWithBase = false;

    if (!isPlayer) {
      base.readyPlayerEmails = Array.from(new Set(collections.players
        .filter(player => player.characterId && (player.emailNormalized || player.email))
        .map(player => String(player.emailNormalized || player.email).trim().toLowerCase())
        .filter(Boolean)));
      delete base.lastClientMutation;

      if (!baseline) {
        const { sceneTrash: _sceneTrash, ...campaignWithoutSceneTrash } = campaign;
        assertManagedImages(campaignWithoutSceneTrash, "A campanha");
        const cleaned = { ...stripUndefined({ ...base, updatedAt }) };
        SUBCOLLECTION_KEYS.forEach(key => { cleaned[key] = api.deleteField(); });
        if (options.isCreation === true) {
          if (SUBCOLLECTION_KEYS.some(key => collections[key].length)) {
            const error = new Error("A criacao atomica da campanha nao aceita subdocumentos preexistentes.");
            error.code = "campaign/creation-subcollections-not-empty";
            throw error;
          }
          if (!options.mutationId) {
            const error = new Error("A criacao duravel da campanha precisa de uma identidade de mutacao.");
            error.code = "campaign/creation-mutation-required";
            throw error;
          }
          cleaned.lastClientMutation = stripUndefined({
            id: String(options.mutationId),
            revision: Math.max(0, Number(options.mutationRevision || 0)),
            authUid: String(auth.currentUser?.uid || ""),
            completedAt: updatedAt
          });
          mutationAcknowledgedWithBase = true;
        }
        masterBaseWrite = { method: "set", data: cleaned };
      } else {
        baseline.base.readyPlayerEmails = Array.from(new Set((baseline.collections.players || [])
          .filter(player => player.characterId && (player.emailNormalized || player.email))
          .map(player => String(player.emailNormalized || player.email).trim().toLowerCase())
          .filter(Boolean)));
        delete baseline.base.lastClientMutation;
        const previousBase = stripUndefined(baseline.base);
        const nextBase = stripUndefined(base);
        const changedFields = { updatedAt };
        const fieldNames = new Set([...Object.keys(previousBase), ...Object.keys(nextBase)]);
        fieldNames.delete("id");
        fieldNames.forEach(field => {
          if (JSON.stringify(previousBase[field]) === JSON.stringify(nextBase[field])) return;
          changedFields[field] = field in nextBase ? nextBase[field] : api.deleteField();
        });
        assertManagedImages(changedFields, "As alteracoes da campanha");
        SUBCOLLECTION_KEYS.forEach(key => {
          if (key === "sceneTrash") return;
          assertManagedSubcollectionChanges(
            key,
            collections[key],
            baseline.collections[key] || []
          );
        });
        masterBaseWrite = { method: "update", data: changedFields };
      }
    } else {
      const cached = campaignSaveCache.get(campaign.id) || {};
      SUBCOLLECTION_KEYS.forEach(key => {
        if (key === "sceneTrash") return;
        assertManagedPlayerSubcollectionChanges(
          key,
          collections[key],
          options.playerId,
          auth.currentUser?.uid,
          baseline?.collections?.[key] ?? cached[key] ?? []
        );
      });
    }

    if (isPlayer) {
      await withRetry(() => api.updateDoc(campaignRef, { updatedAt }), ctx);
    } else if (masterBaseWrite.method === "set") {
      await withRetry(() => api.setDoc(campaignRef, masterBaseWrite.data, { merge: true }), ctx);
    } else {
      await withRetry(() => api.updateDoc(campaignRef, masterBaseWrite.data), ctx);
    }

    for (const key of SUBCOLLECTION_KEYS) {
      if (key === "sceneTrash") continue;
      if (isPlayer) {
        await syncPlayerSubcollection(
          campaign.id,
          key,
          collections[key],
          options.playerId,
          auth.currentUser?.uid,
          baseline?.collections?.[key] ?? null
        );
      } else {
        await syncSubcollection(campaign.id, key, collections[key], {
          ...(baseline ? { previousItems: baseline.collections[key] || [] } : {})
        });
      }
    }

    if (options.mutationId && !mutationAcknowledgedWithBase) {
      const completedAt = new Date().toISOString();
      await withRetry(() => api.updateDoc(campaignRef, {
        lastClientMutation: stripUndefined({
          id: String(options.mutationId),
          revision: Math.max(0, Number(options.mutationRevision || 0)),
          authUid: String(auth.currentUser?.uid || ""),
          completedAt
        }),
        updatedAt: completedAt
      }), ctx);
    }
    campaignSaveCache.set(campaign.id, cloneCollections(collections));
    return { mutationId: options.mutationId || null, completed: true };
  }

  async function deleteCampaign(campaignId) {
    if (!campaignId) return;
    for (const key of SUBCOLLECTION_KEYS) await deleteSubcollection(campaignId, key);
    await deleteSubcollection(campaignId, "privateMessages");
    campaignSaveCache.delete(campaignId);
    await withRetry(() => api.deleteDoc(api.doc(db, "campaigns", campaignId)), ctx);
  }

  return {
    addCampaignMember,
    adjustCharacterVital,
    assignPlayerCharacter,
    commitCampaignMediaMutation,
    deleteEvidenceCatalogEntry,
    deleteCampaign,
    getCampaign,
    getCampaignForJoin,
    joinCampaign,
    migrateCampaignImages,
    preflightCampaignImageMigration,
    upgradeLegacyCampaignStorageLayout,
    recordDiceRoll,
    resolveItemTransfer,
    restoreCampaignScene,
    saveCampaign,
    sendCampaignMessage,
    sendPrivateCampaignMessage,
    setPlayerPresence,
    trashCampaignScene,
    updateCharacterEvidenceAssignments,
    updateCharacterExpressions,
    updateCampaignScenes,
    updateLiveScene,
    updateTraumaCatalog,
    updateTraumaCatalogAndCharacters,
    updateCharacterTraumas,
    updateCharacterInventory,
    watchCampaigns,
    watchPrivateMessages
  };
}
