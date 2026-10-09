// supabase/functions/_shared/common.ts
// Utilitaires communs aux fonctions Edge : CORS, réponses JSON, vérification de la connexion.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

export interface AuthUser { id: string; isAnonymous: boolean; email?: string }

// Vérifie le jeton de connexion de l'appelant auprès de Supabase Auth.
export async function requireUser(req: Request): Promise<AuthUser> {
  const auth = req.headers.get('Authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!auth.startsWith('Bearer ') || !url || !anon) throw new HttpError(401, 'UNAUTHENTICATED', 'Connexion requise.');
  const res = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: auth, apikey: anon } });
  if (!res.ok) throw new HttpError(401, 'UNAUTHENTICATED', 'Session invalide ou expirée.');
  const user = await res.json();
  return { id: user.id, isAnonymous: !!user.is_anonymous, email: user.email };
}

// Même identifiant administrateur que dans vos règles SQL (romeo.sql).
export const adminId = () => Deno.env.get('ADMIN_USER_ID') ?? 'ab096262-ff74-4faf-a671-6f4611e454d7';

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
  console.error('Erreur inattendue :', e instanceof Error ? e.message : 'inconnue');
  return json({ error: 'SERVER_ERROR', message: 'Erreur interne du serveur.' }, 500);
}
