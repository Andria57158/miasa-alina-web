// supabase/functions/zoom-live/index.ts
//
// Le live s'appuie sur l'API Zoom :
//   create : crée une réunion Zoom (API REST) + signature « hôte » du Meeting SDK + jeton ZAK
//   join   : signature « participant » pour regarder un live en cours
//   end    : termine la réunion
// Le navigateur ne voit jamais les secrets Zoom : il reçoit seulement une signature courte durée.
//
// Secrets nécessaires :
//   ZOOM_ACCOUNT_ID, ZOOM_S2S_CLIENT_ID, ZOOM_S2S_CLIENT_SECRET   (appli « Server-to-Server OAuth »)
//   ZOOM_SDK_KEY, ZOOM_SDK_SECRET                                  (appli « Meeting SDK »)
//   ZOOM_HOST_USER   (e-mail ou ID de l'utilisateur Zoom qui héberge les lives)
// Optionnel : ADMIN_USER_ID

import { corsHeaders, json, HttpError, requireUser, errorResponse } from '../_shared/common.ts';

const MARKER = 'yassal-live';

// ---------- Signature du Meeting SDK (JWT HS256) ----------
const b64url = (data: ArrayBuffer | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};

export async function signSdkJwt(sdkKey: string, sdkSecret: string, meetingNumber: string, role: 0 | 1, now = Math.floor(Date.now() / 1000)) {
  const iat = now - 30;
  const exp = iat + 60 * 60 * 2; // 2 h
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ appKey: sdkKey, sdkKey, mn: meetingNumber, role, iat, exp, tokenExp: exp }));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(sdkSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(sig)}`;
}

// ---------- API REST Zoom (OAuth Server-to-Server) ----------
let cached: { token: string; exp: number } | null = null;

async function zoomToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 30_000) return cached.token;
  const id = Deno.env.get('ZOOM_S2S_CLIENT_ID')!;
  const secret = Deno.env.get('ZOOM_S2S_CLIENT_SECRET')!;
  const account = Deno.env.get('ZOOM_ACCOUNT_ID')!;
  const res = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(account)}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new HttpError(502, 'ZOOM_AUTH_ERROR', "Connexion à Zoom refusée : vérifiez les identifiants Zoom.");
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cached.token;
}

async function zoomApi(path: string, init: RequestInit = {}) {
  const token = await zoomToken();
  const res = await fetch(`https://api.zoom.us/v2${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, 'ZOOM_API_ERROR', `Zoom : ${data?.message ?? res.status}`);
  return data;
}

const configured = () =>
  ['ZOOM_ACCOUNT_ID', 'ZOOM_S2S_CLIENT_ID', 'ZOOM_S2S_CLIENT_SECRET', 'ZOOM_SDK_KEY', 'ZOOM_SDK_SECRET'].every((k) => !!Deno.env.get(k));

const cleanNumber = (v: unknown) => {
  const s = String(v ?? '').replace(/\s/g, '');
  if (!/^\d{9,12}$/.test(s)) throw new HttpError(400, 'BAD_MEETING', 'Numéro de réunion invalide.');
  return s;
};

export async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Méthode non autorisée.');
    const user = await requireUser(req);
    if (!configured()) throw new HttpError(501, 'ZOOM_NOT_CONFIGURED', "Zoom n'est pas encore configuré sur le serveur.");

    const sdkKey = Deno.env.get('ZOOM_SDK_KEY')!;
    const sdkSecret = Deno.env.get('ZOOM_SDK_SECRET')!;
    const host = encodeURIComponent(Deno.env.get('ZOOM_HOST_USER') ?? 'me');
    const body = await req.json().catch(() => ({}));

    // ----- Créer un live -----
    if (body.action === 'create') {
      if (user.isAnonymous) throw new HttpError(403, 'FORBIDDEN', 'Connectez-vous avec votre compte pour lancer un direct.');
      const topic = String(body.topic ?? 'Live YASSAL').slice(0, 100);
      const meeting = await zoomApi(`/users/${host}/meetings`, {
        method: 'POST',
        body: JSON.stringify({
          topic,
          type: 1, // réunion instantanée
          agenda: `${MARKER}:${user.id}`, // sert à vérifier que la réunion vient bien de l'application
          settings: {
            host_video: true,
            participant_video: false,
            mute_upon_entry: true,
            join_before_host: false,
            waiting_room: false,
            approval_type: 2,
            audio: 'voip',
            auto_recording: 'none',
          },
        }),
      });
      const meetingNumber = String(meeting.id);
      const zakRes = await zoomApi(`/users/${host}/token?type=zak`);
      return json({
        meetingNumber,
        password: meeting.password ?? '',
        joinUrl: meeting.join_url,
        sdkKey,
        zak: zakRes.token,
        signature: await signSdkJwt(sdkKey, sdkSecret, meetingNumber, 1),
      });
    }

    // ----- Rejoindre comme spectateur -----
    if (body.action === 'join') {
      const meetingNumber = cleanNumber(body.meetingNumber);
      const meeting = await zoomApi(`/meetings/${meetingNumber}`);
      if (!String(meeting.agenda ?? '').startsWith(`${MARKER}:`)) throw new HttpError(403, 'NOT_A_LIVE', "Cette réunion n'est pas un live de l'application.");
      return json({
        meetingNumber,
        password: meeting.password ?? '',
        sdkKey,
        signature: await signSdkJwt(sdkKey, sdkSecret, meetingNumber, 0),
      });
    }

    // ----- Terminer le live -----
    if (body.action === 'end') {
      const meetingNumber = cleanNumber(body.meetingNumber);
      const meeting = await zoomApi(`/meetings/${meetingNumber}`);
      const owner = String(meeting.agenda ?? '').split(':')[1];
      const admin = Deno.env.get('ADMIN_USER_ID') ?? 'ab096262-ff74-4faf-a671-6f4611e454d7';
      if (owner !== user.id && user.id !== admin) throw new HttpError(403, 'FORBIDDEN', "Seul l'auteur du live peut le terminer.");
      await zoomApi(`/meetings/${meetingNumber}/status`, { method: 'PUT', body: JSON.stringify({ action: 'end' }) });
      return json({ ended: true });
    }

    throw new HttpError(400, 'BAD_ACTION', 'Action inconnue.');
  } catch (e) {
    return errorResponse(e);
  }
}

Deno.serve(handle);
