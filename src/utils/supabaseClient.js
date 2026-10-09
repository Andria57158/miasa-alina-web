// src/utils/supabaseClient.js  — SEUL fichier client Supabase du projet
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Vérification simple pour éviter des erreurs silencieuses
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Variables Supabase manquantes : ajoutez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans le fichier .env (à la racine du projet) puis relancez 'npm run dev'."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Expose l'URL Supabase pour construire les URLs publiques du Storage
export const SUPABASE_URL = supabaseUrl;

// Noms des buckets de stockage
export const BUCKET_COVERS = 'album-covers';
export const BUCKET_LYRICS = 'lyrics-files';
export const BUCKET_AUDIO = 'audio-files';
export const BUCKET_AVATARS = 'avatars';

// Upload un fichier vers un bucket et retourne son URL publique
export async function uploadFileToBucket(bucket, file, folder = '') {
  if (!file) return null;
  const ext = file.name.split('.').pop();
  const cleanName = file.name
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 40);
  const path = `${folder ? folder + '/' : ''}${Date.now()}_${cleanName}.${ext}`;

  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { url: data.publicUrl, path, name: file.name, ext };
}
