// supabase/functions/instagram-story/index.ts
//
// Étape 2 du schéma : « Appel à l'API Instagram Graph (paramètre STORIES) ».
// Le navigateur envoie ici l'URL PUBLIQUE de l'image/vidéo déjà modifiée par Cloudinary ;
// c'est cette fonction (et non le navigateur) qui détient le jeton Instagram.
//
// Actions : create -> status -> publish
//   create  : crée le « conteneur » STORIES  (image_url ou video_url)
//   status  : état du traitement (obligatoire pour les vidéos)
//   publish : publie le conteneur sur la Story
//
// Secrets nécessaires : IG_USER_ID, IG_ACCESS_TOKEN
// Optionnels : IG_GRAPH_VERSION (défaut v23.0), IG_GRAPH_HOST (défaut graph.facebook.com),
//              IG_ALLOWED_HOSTS (défaut res.cloudinary.com), ADMIN_USER_ID

import { corsHeaders, json, HttpError, requireUser, adminId, errorResponse } from '../_shared/common.ts';

const graphBase = () =>
  `https://${Deno.env.get('IG_GRAPH_HOST') ?? 'graph.facebook.com'}/${Deno.env.get('IG_GRAPH_VERSION') ?? 'v23.0'}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function graph(path: string, method: 'GET' | 'POST', params: Record<string, string>) {
  const token = Deno.env.get('IG_ACCESS_TOKEN')!;
  const body = new URLSearchParams({ ...params, access_token: token });
  const url = method === 'GET' ? `${graphBase()}${path}?${body}` : `${graphBase()}${path}`;
  const res = await fetch(url, method === 'GET'
    ? undefined
    : { method, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    const e = data?.error ?? {};
    // On ne renvoie jamais le jeton, même dans un message d'erreur.
    const msg = String(e.error_user_msg ?? e.message ?? `Erreur Instagram (${res.status})`).split(token).join('***');
    const err = new HttpError(502, 'INSTAGRAM_ERROR', msg) as HttpError & { igCode?: number; igSubcode?: number };
    err.igCode = e.code; err.igSubcode = e.error_subcode;
    throw err;
  }
  return data;
}

function assertAllowedUrl(raw: unknown): string {
  let u: URL;
  try { u = new URL(String(raw)); } catch { throw new HttpError(400, 'BAD_URL', 'URL du média invalide.'); }
  const allowed = (Deno.env.get('IG_ALLOWED_HOSTS') ?? 'res.cloudinary.com').split(',').map((s) => s.trim());
  // Empêche d'utiliser cette fonction pour publier n'importe quelle image trouvée sur le web.
  if (u.protocol !== 'https:' || !allowed.includes(u.hostname)) {
    throw new HttpError(400, 'URL_NOT_ALLOWED', "Le média doit provenir de votre compte Cloudinary.");
  }
  return u.toString();
}

export async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Méthode non autorisée.');
    const user = await requireUser(req);
    if (user.id !== adminId()) throw new HttpError(403, 'FORBIDDEN', "Réservé à l'administrateur.");

    const igUser = Deno.env.get('IG_USER_ID');
    if (!igUser || !Deno.env.get('IG_ACCESS_TOKEN')) {
      throw new HttpError(501, 'INSTAGRAM_NOT_CONFIGURED', "Instagram n'est pas encore configuré sur le serveur.");
    }

    const body = await req.json().catch(() => ({}));

    if (body.action === 'create') {
      const mediaType = body.mediaType === 'VIDEO' ? 'VIDEO' : body.mediaType === 'IMAGE' ? 'IMAGE' : null;
      if (!mediaType) throw new HttpError(400, 'BAD_MEDIA_TYPE', 'mediaType doit valoir IMAGE ou VIDEO.');
      const mediaUrl = assertAllowedUrl(body.url);
      const params: Record<string, string> = { media_type: 'STORIES' };
      params[mediaType === 'VIDEO' ? 'video_url' : 'image_url'] = mediaUrl;

      // Cloudinary peut mettre quelques secondes à produire la version transformée :
      // Instagram répond alors « média introuvable » → on réessaie un peu.
      let lastErr: unknown;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const data = await graph(`/${igUser}/media`, 'POST', params);
          return json({ creationId: data.id });
        } catch (e) {
          lastErr = e;
          const sub = (e as { igSubcode?: number }).igSubcode;
          const retryable = sub === 2207052 || sub === 2207003 || sub === 2207053 || (e as { igCode?: number }).igCode === 9004;
          if (!retryable) throw e;
          await sleep(Number(Deno.env.get('IG_RETRY_DELAY_MS') ?? 5000));
        }
      }
      throw lastErr;
    }

    if (body.action === 'status') {
      if (!/^\d+$/.test(String(body.creationId ?? ''))) throw new HttpError(400, 'BAD_ID', 'creationId invalide.');
      const data = await graph(`/${body.creationId}`, 'GET', { fields: 'status_code,status' });
      return json({ status: data.status_code ?? 'IN_PROGRESS', detail: data.status ?? null });
    }

    if (body.action === 'publish') {
      if (!/^\d+$/.test(String(body.creationId ?? ''))) throw new HttpError(400, 'BAD_ID', 'creationId invalide.');
      const data = await graph(`/${igUser}/media_publish`, 'POST', { creation_id: String(body.creationId) });
      return json({ mediaId: data.id });
    }

    throw new HttpError(400, 'BAD_ACTION', 'Action inconnue.');
  } catch (e) {
    return errorResponse(e);
  }
}

Deno.serve(handle);
