const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_MIN_UPLOAD_BYTES_PER_SECOND = 64 * 1024;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 350;
const DEFAULT_MAX_RETRY_DELAY_MS = 4000;

export class CloudinaryUploadError extends Error {
  constructor(message, { code = "CLOUDINARY_UPLOAD_FAILED", status = null, retryable = false, cause } = {}) {
    super(message);
    this.name = "CloudinaryUploadError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    if (cause !== undefined) this.cause = cause;
  }
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export function cloudinaryUploadTimeoutMs(bytes, options = {}) {
  const minimumMs = positiveNumber(options.minimumMs, DEFAULT_TIMEOUT_MS);
  const maximumMs = Math.max(minimumMs, positiveNumber(options.maximumMs, DEFAULT_MAX_TIMEOUT_MS));
  const minimumBytesPerSecond = positiveNumber(
    options.minimumBytesPerSecond,
    DEFAULT_MIN_UPLOAD_BYTES_PER_SECOND
  );
  const transferAllowance = Math.ceil((Math.max(0, Number(bytes) || 0) / minimumBytesPerSecond) * 1000);
  return Math.min(Math.max(minimumMs, minimumMs + transferAllowance), maximumMs);
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map(tag => String(tag).trim()).filter(Boolean).join(",");
  }
  return tags == null ? "" : String(tags).trim();
}

function escapeContextPart(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/([=|])/g, "\\$1");
}

function normalizeContext(context) {
  if (!context) return "";
  if (typeof context === "string") return context.trim();
  if (typeof context !== "object" || Array.isArray(context)) return String(context);
  return Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${escapeContextPart(key)}=${escapeContextPart(value)}`)
    .join("|");
}

function isRetryableStatus(status) {
  return status === 420 || status === 429 || (status >= 500 && status <= 599);
}

export function isCloudinarySecureUrl(value, cloudName = "") {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "res.cloudinary.com") return false;
    if (!cloudName) return true;
    const firstSegment = decodeURIComponent(parsed.pathname.split("/").filter(Boolean)[0] || "");
    return firstSegment === cloudName;
  } catch {
    return false;
  }
}

function toUploadResult(body, cloudName) {
  const secureUrl = typeof body?.secure_url === "string" ? body.secure_url.trim() : "";
  if (!isCloudinarySecureUrl(secureUrl, cloudName)) {
    throw new CloudinaryUploadError("O Cloudinary respondeu sem uma URL HTTPS valida para a imagem.", {
      code: "CLOUDINARY_INVALID_RESPONSE"
    });
  }

  return {
    secureUrl,
    assetId: body.asset_id ?? null,
    publicId: body.public_id ?? null,
    version: body.version ?? null,
    versionId: body.version_id ?? null,
    format: body.format ?? null,
    width: body.width ?? null,
    height: body.height ?? null,
    bytes: body.bytes ?? null,
    etag: body.etag ?? null
  };
}

export function createCloudinaryService(config = {}) {
  const cloudName = String(config.cloudName || "").trim();
  const uploadPreset = String(config.uploadPreset || "").trim();
  const defaultFolder = String(config.folder || "site-rpg").trim();
  const defaultAssetFolder = String(config.assetFolder || "").trim();
  const hasExplicitTimeout = Number.isFinite(Number(config.timeoutMs)) && Number(config.timeoutMs) > 0;
  const timeoutMs = positiveNumber(config.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxTimeoutMs = positiveNumber(config.maxTimeoutMs, DEFAULT_MAX_TIMEOUT_MS);
  const minUploadBytesPerSecond = positiveNumber(
    config.minUploadBytesPerSecond,
    DEFAULT_MIN_UPLOAD_BYTES_PER_SECOND
  );
  const maxRetries = nonNegativeInteger(config.maxRetries, DEFAULT_MAX_RETRIES);
  const retryBaseDelayMs = nonNegativeInteger(config.retryBaseDelayMs, DEFAULT_RETRY_BASE_DELAY_MS);
  const maxRetryDelayMs = nonNegativeInteger(config.maxRetryDelayMs, DEFAULT_MAX_RETRY_DELAY_MS);
  const fetchImpl = config.fetchImpl || globalThis.fetch?.bind(globalThis);
  const FormDataImpl = config.FormDataImpl || globalThis.FormData;
  const AbortControllerImpl = config.AbortControllerImpl || globalThis.AbortController;
  const sleepImpl = config.sleepImpl || (delay => new Promise(resolve => setTimeout(resolve, delay)));

  function isConfigured() {
    return Boolean(cloudName && uploadPreset);
  }

  function assertReady(blob) {
    if (!isConfigured()) {
      throw new CloudinaryUploadError("Cloudinary nao configurado: informe cloudName e uploadPreset.", {
        code: "CLOUDINARY_NOT_CONFIGURED"
      });
    }
    if (!blob) {
      throw new CloudinaryUploadError("Nenhuma imagem foi informada para o upload.", {
        code: "CLOUDINARY_MISSING_FILE"
      });
    }
    if (typeof fetchImpl !== "function" || typeof FormDataImpl !== "function") {
      throw new CloudinaryUploadError("Este navegador nao oferece os recursos necessarios para enviar imagens.", {
        code: "CLOUDINARY_UNSUPPORTED_ENVIRONMENT"
      });
    }
  }

  function buildFormData(blob, options) {
    const data = new FormDataImpl();
    data.append("file", blob);
    data.append("upload_preset", uploadPreset);

    const folder = options.folder ?? defaultFolder;
    const assetFolder = options.assetFolder ?? defaultAssetFolder;
    const tags = normalizeTags(options.tags);
    const context = normalizeContext(options.context);
    const publicId = options.publicId == null ? "" : String(options.publicId).trim();

    if (folder) data.append("folder", String(folder));
    if (assetFolder) data.append("asset_folder", String(assetFolder));
    if (tags) data.append("tags", tags);
    if (context) data.append("context", context);
    if (publicId) data.append("public_id", publicId);
    return data;
  }

  function uploadTimeoutMs(blob) {
    if (hasExplicitTimeout) return timeoutMs;
    return cloudinaryUploadTimeoutMs(blob?.size, {
      minimumMs: timeoutMs,
      maximumMs: maxTimeoutMs,
      minimumBytesPerSecond: minUploadBytesPerSecond
    });
  }

  async function requestWithTimeout(url, init, activeTimeoutMs) {
    const controller = typeof AbortControllerImpl === "function" ? new AbortControllerImpl() : null;
    let timer;
    const timeoutError = new CloudinaryUploadError(`O upload excedeu o limite de ${activeTimeoutMs} ms.`, {
      code: "CLOUDINARY_TIMEOUT",
      retryable: true
    });
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        try { controller?.abort(); } catch {}
        reject(timeoutError);
      }, activeTimeoutMs);
    });

    try {
      return await Promise.race([
        Promise.resolve().then(() => fetchImpl(url, { ...init, ...(controller ? { signal: controller.signal } : {}) })),
        timeout
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function performAttempt(blob, options) {
    let response;
    try {
      response = await requestWithTimeout(
        `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
        { method: "POST", body: buildFormData(blob, options) },
        uploadTimeoutMs(blob)
      );
    } catch (error) {
      if (error instanceof CloudinaryUploadError) throw error;
      throw new CloudinaryUploadError("Falha de rede ao enviar a imagem para o Cloudinary.", {
        code: "CLOUDINARY_NETWORK_ERROR",
        retryable: true,
        cause: error
      });
    }

    const body = await response?.json?.().catch(() => ({})) || {};
    if (!response?.ok) {
      const status = Number(response?.status) || null;
      const retryable = status !== null && isRetryableStatus(status);
      const detail = typeof body?.error?.message === "string" ? body.error.message.trim() : "";
      throw new CloudinaryUploadError(detail || `O Cloudinary recusou o upload${status ? ` (HTTP ${status})` : ""}.`, {
        code: "CLOUDINARY_HTTP_ERROR",
        status,
        retryable
      });
    }

    return toUploadResult(body, cloudName);
  }

  async function uploadImage(blob, options = {}) {
    assertReady(blob);
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await performAttempt(blob, options || {});
      } catch (error) {
        const normalized = error instanceof CloudinaryUploadError
          ? error
          : new CloudinaryUploadError("Falha inesperada ao enviar a imagem para o Cloudinary.", { cause: error });
        lastError = normalized;
        if (!normalized.retryable || attempt >= maxRetries) throw normalized;

        const delay = Math.min(retryBaseDelayMs * (2 ** attempt), maxRetryDelayMs);
        if (delay > 0) await sleepImpl(delay);
      }
    }

    throw lastError || new CloudinaryUploadError("Falha ao enviar imagem para o Cloudinary.");
  }

  return { isConfigured, uploadImage };
}
