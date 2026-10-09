// Worker "romeo-media" (v2) : écriture dans R2.
//  - admin : audio, covers, lyrics, media, events
//  - utilisateur connecté : stories, voice, chat  (fichiers rangés sous son id, suppression de ses propres fichiers)
//  - anonyme : avatars uniquement (inscription, avant connexion) — petite taille, images seulement
// Tout le monde peut LIRE via PUBLIC_BASE_URL.

const IMG = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const KINDS = {
  audio:   { who: 'admin', max: 50 * 1024 * 1024, types: ['audio/mpeg', 'audio/mp4', 'audio/x-m4a'] },
  covers:  { who: 'admin', max: 10 * 1024 * 1024, types: IMG },
  lyrics:  { who: 'admin', max: 10 * 1024 * 1024, types: ['text/plain', 'application/pdf', 'application/vnd.ms-works'] },
  media:   { who: 'admin', max: 80 * 1024 * 1024, types: ['video/mp4', 'image/jpeg', 'image/png', 'image/webp'] },
  events:  { who: 'admin', max: 10 * 1024 * 1024, types: IMG },
  stories: { who: 'user',  max: 80 * 1024 * 1024, types: [...IMG, 'video/mp4', 'video/quicktime', 'video/webm'] },
  voice:   { who: 'user',  max: 10 * 1024 * 1024, types: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'] },
  chat:    { who: 'user',  max: 20 * 1024 * 1024, types: [...IMG, 'application/pdf', 'text/plain',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'] },
  avatars: { who: 'anon',  max: 3 * 1024 * 1024,  types: ['image/jpeg', 'image/png', 'image/webp'] },
};
const NAME_RE = /^[A-Za-z0-9._-]{1,200}$/;

const json = (body, status, cors) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });

async function getUser(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  return r.ok ? r.json() : null;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
    const cors = allowed.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type', Vary: 'Origin' }
      : {};
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!cors['Access-Control-Allow-Origin']) return json({ error: 'origine refusée' }, 403, cors);

    const [action, kind, rawName] = new URL(request.url).pathname.split('/').filter(Boolean);
    const rule = KINDS[kind];
    const name = rawName ? decodeURIComponent(rawName) : '';
    if (!rule || !NAME_RE.test(name)) return json({ error: 'requête invalide' }, 400, cors);

    // --- qui a le droit ?
    let user = null;
    if (rule.who !== 'anon') {
      user = await getUser(request, env);
      if (!user) return json({ error: 'connexion requise' }, 401, cors);
      if (rule.who === 'admin' && user.id !== env.ADMIN_ID) return json({ error: 'accès réservé à l’administrateur' }, 403, cors);
    }
    // fichiers des utilisateurs rangés sous leur id ; l'admin peut tout supprimer
    const isAdmin = user && user.id === env.ADMIN_ID;
    const key = rule.who === 'user' ? `${kind}/${isAdmin && action === 'delete' ? (url_owner(request) || user.id) : user.id}/${name}` : `${kind}/${name}`;

    if (action === 'upload' && request.method === 'PUT') {
      const type = (request.headers.get('Content-Type') || '').split(';')[0].trim();
      const size = Number(request.headers.get('Content-Length') || 0);
      if (!rule.types.includes(type)) return json({ error: `type refusé : ${type}` }, 415, cors);
      if (!size || size > rule.max) return json({ error: 'fichier trop gros ou taille inconnue' }, 413, cors);
      await env.BUCKET.put(key, request.body, {
        httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' },
      });
      return json({ url: `${env.PUBLIC_BASE_URL}/${key}`, key }, 200, cors);
    }

    if (action === 'delete' && request.method === 'DELETE') {
      if (rule.who === 'anon' && !(user && user.id === env.ADMIN_ID)) {
        const u = await getUser(request, env);
        if (!u || u.id !== env.ADMIN_ID) return json({ error: 'suppression réservée à l’administrateur' }, 403, cors);
      }
      await env.BUCKET.delete(key);
      return json({ ok: true }, 200, cors);
    }
    return json({ error: 'route inconnue' }, 404, cors);
  },
};

// DELETE /delete/<kind>/<name>?owner=<uuid> : l'admin peut préciser le propriétaire du fichier
function url_owner(request) {
  const o = new URL(request.url).searchParams.get('owner') || '';
  return /^[0-9a-f-]{36}$/i.test(o) ? o : null;
}
