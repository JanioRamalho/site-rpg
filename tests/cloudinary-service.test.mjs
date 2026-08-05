import test from "node:test";
import assert from "node:assert/strict";
import {
  CloudinaryUploadError,
  cloudinaryUploadTimeoutMs,
  createCloudinaryService,
  isCloudinarySecureUrl
} from "../js/media/cloudinary-service.js";

test("timeout padrao cresce com o tamanho do arquivo sem ultrapassar o teto", () => {
  const small = cloudinaryUploadTimeoutMs(64 * 1024);
  const large = cloudinaryUploadTimeoutMs(25 * 1024 * 1024);
  const extreme = cloudinaryUploadTimeoutMs(1024 * 1024 * 1024);

  assert.ok(small >= 60000);
  assert.ok(large > small);
  assert.equal(extreme, 15 * 60 * 1000);
});

class FakeFormData {
  constructor() {
    this.values = [];
  }

  append(name, value) {
    this.values.push([name, value]);
  }

  get(name) {
    return this.values.find(([key]) => key === name)?.[1];
  }
}

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

function successBody(overrides = {}) {
  return {
    secure_url: "https://res.cloudinary.com/demo/image/upload/v7/site-rpg/scene.webp",
    asset_id: "asset-1",
    public_id: "site-rpg/scene",
    version: 7,
    version_id: "version-1",
    format: "webp",
    width: 1600,
    height: 900,
    bytes: 123456,
    etag: "etag-1",
    ...overrides
  };
}

function serviceConfig(overrides = {}) {
  return {
    cloudName: "demo",
    uploadPreset: "site-rpg",
    FormDataImpl: FakeFormData,
    retryBaseDelayMs: 0,
    ...overrides
  };
}

test("upload configurado devolve URL e metadados estruturados", async () => {
  const requests = [];
  const service = createCloudinaryService(serviceConfig({
    folder: "default-folder",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return response(200, successBody());
    }
  }));

  const result = await service.uploadImage({ name: "scene.png" }, {
    folder: "campaign-1/scenes",
    assetFolder: "campaign-assets",
    tags: ["site-rpg", "scene"],
    context: { campaign: "campaign-1", label: "Ato 1|inicio" },
    publicId: "scene-1"
  });

  assert.deepEqual(result, {
    secureUrl: "https://res.cloudinary.com/demo/image/upload/v7/site-rpg/scene.webp",
    assetId: "asset-1",
    publicId: "site-rpg/scene",
    version: 7,
    versionId: "version-1",
    format: "webp",
    width: 1600,
    height: 900,
    bytes: 123456,
    etag: "etag-1"
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.cloudinary.com/v1_1/demo/image/upload");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.body.get("upload_preset"), "site-rpg");
  assert.equal(requests[0].init.body.get("folder"), "campaign-1/scenes");
  assert.equal(requests[0].init.body.get("asset_folder"), "campaign-assets");
  assert.equal(requests[0].init.body.get("tags"), "site-rpg,scene");
  assert.equal(requests[0].init.body.get("context"), "campaign=campaign-1|label=Ato 1\\|inicio");
  assert.equal(requests[0].init.body.get("public_id"), "scene-1");
});

test("configuracao ausente e arquivo ausente geram erros claros, nunca string vazia", async () => {
  const notConfigured = createCloudinaryService({ FormDataImpl: FakeFormData, fetchImpl: async () => response(200) });
  await assert.rejects(notConfigured.uploadImage({}), error => {
    assert.ok(error instanceof CloudinaryUploadError);
    assert.equal(error.code, "CLOUDINARY_NOT_CONFIGURED");
    return true;
  });

  const configured = createCloudinaryService(serviceConfig({ fetchImpl: async () => response(200) }));
  await assert.rejects(configured.uploadImage(null), error => {
    assert.equal(error.code, "CLOUDINARY_MISSING_FILE");
    return true;
  });
});

test("erros de rede sao repetidos com backoff exponencial", async () => {
  let calls = 0;
  const delays = [];
  const service = createCloudinaryService(serviceConfig({
    maxRetries: 2,
    retryBaseDelayMs: 25,
    sleepImpl: async delay => { delays.push(delay); },
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) throw new TypeError("offline");
      return response(200, successBody());
    }
  }));

  const result = await service.uploadImage({});
  assert.equal(result.publicId, "site-rpg/scene");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [25, 50]);
});

test("HTTP 420, 429 e 5xx sao repetidos", async () => {
  for (const status of [420, 429, 500, 503]) {
    let calls = 0;
    const service = createCloudinaryService(serviceConfig({
      maxRetries: 1,
      sleepImpl: async () => {},
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? response(status, { error: { message: "temporario" } })
          : response(200, successBody());
      }
    }));

    const result = await service.uploadImage({});
    assert.equal(result.assetId, "asset-1");
    assert.equal(calls, 2, `HTTP ${status} deveria realizar uma nova tentativa`);
  }
});

test("HTTP 4xx permanente nao e repetido", async () => {
  let calls = 0;
  const service = createCloudinaryService(serviceConfig({
    maxRetries: 3,
    fetchImpl: async () => {
      calls += 1;
      return response(400, { error: { message: "Invalid unsigned upload preset" } });
    }
  }));

  await assert.rejects(service.uploadImage({}), error => {
    assert.equal(error.code, "CLOUDINARY_HTTP_ERROR");
    assert.equal(error.status, 400);
    assert.equal(error.retryable, false);
    assert.match(error.message, /Invalid unsigned upload preset/);
    return true;
  });
  assert.equal(calls, 1);
});

test("resposta sem URL HTTPS do Cloudinary e rejeitada sem retry", async () => {
  for (const secureUrl of ["", "http://res.cloudinary.com/demo/image/upload/a.png", "https://example.com/a.png"]) {
    let calls = 0;
    const service = createCloudinaryService(serviceConfig({
      maxRetries: 2,
      fetchImpl: async () => {
        calls += 1;
        return response(200, successBody({ secure_url: secureUrl }));
      }
    }));

    await assert.rejects(service.uploadImage({}), error => {
      assert.equal(error.code, "CLOUDINARY_INVALID_RESPONSE");
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("timeout aborta e repete apenas ate o limite configurado", async () => {
  let calls = 0;
  let aborts = 0;
  class FakeAbortController {
    constructor() { this.signal = {}; }
    abort() { aborts += 1; }
  }
  const service = createCloudinaryService(serviceConfig({
    timeoutMs: 5,
    maxRetries: 1,
    AbortControllerImpl: FakeAbortController,
    sleepImpl: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return new Promise(() => {});
    }
  }));

  await assert.rejects(service.uploadImage({}), error => {
    assert.equal(error.code, "CLOUDINARY_TIMEOUT");
    assert.equal(error.retryable, true);
    return true;
  });
  assert.equal(calls, 2);
  assert.equal(aborts, 2);
});

test("validador aceita somente URL HTTPS do cloud correto", () => {
  assert.equal(isCloudinarySecureUrl("https://res.cloudinary.com/demo/image/upload/a.jpg", "demo"), true);
  assert.equal(isCloudinarySecureUrl("https://res.cloudinary.com/outro/image/upload/a.jpg", "demo"), false);
  assert.equal(isCloudinarySecureUrl("http://res.cloudinary.com/demo/image/upload/a.jpg", "demo"), false);
});
