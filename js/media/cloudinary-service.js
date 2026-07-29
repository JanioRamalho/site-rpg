export function createCloudinaryService(config = {}) {
  const cloudName = config.cloudName || "";
  const uploadPreset = config.uploadPreset || "";
  const folder = config.folder || "site-rpg";

  function isConfigured() {
    return Boolean(cloudName && uploadPreset);
  }

  async function uploadImage(blob, options = {}) {
    if (!isConfigured() || !blob) return "";

    const data = new FormData();
    data.append("file", blob);
    data.append("upload_preset", uploadPreset);
    data.append("folder", options.folder || folder);
    if (options.tags) data.append("tags", options.tags);

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: "POST",
      body: data
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error?.message || "Falha ao enviar imagem para o Cloudinary.");
    }

    return body.secure_url || body.url || "";
  }

  return { isConfigured, uploadImage };
}
