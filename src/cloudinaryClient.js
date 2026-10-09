// src/cloudinaryClient.js
const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || 'VOTRE_CLOUD_NAME';
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || 'VOTRE_UPLOAD_PRESET';

export async function uploadToCloudinary(file, resourceType = 'auto') {
  if (!file) throw new Error('Aucun fichier à envoyer.');

  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', UPLOAD_PRESET);

  const res = await fetch(endpoint, { method: 'POST', body: formData });
  if (!res.ok) {
    let message = `Échec de l'envoi vers Cloudinary (${res.status})`;
    try {
      const errJson = await res.json();
      if (errJson?.error?.message) message = errJson.error.message;
    } catch { /* ignore */ }
    throw new Error(message);
  }

  const data = await res.json();
  return {
    url: data.secure_url,
    publicId: data.public_id,
    resourceType: data.resource_type,
    format: data.format,
    duration: data.duration ? Math.round(data.duration) : null // dispo pour l'audio/vidéo
  };
}

export function optimizedImageUrl(url, width) {
  if (!url || !url.includes('/upload/')) return url;
  const transform = width ? `f_auto,q_auto,w_${width}` : 'f_auto,q_auto';
  return url.replace('/upload/', `/upload/${transform}/`);
}

/** Idem pour l'audio (bitrate optimisé automatiquement). */
export function optimizedAudioUrl(url) {
  if (!url || !url.includes('/upload/')) return url;
  return url.replace('/upload/', '/upload/q_auto/');
}
