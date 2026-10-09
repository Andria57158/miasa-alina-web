// supabase/functions/admin-actions/index.ts
// Edge Function appelée par AdminUsers.jsx via :
//   supabase.functions.invoke('admin-actions', { body: { action: 'deleteUser', userId } })

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Pré-vol CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Client "admin" avec la clé service_role (jamais exposée au front)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Vérifier que l'appelant est bien authentifié (token envoyé automatiquement par supabase.functions.invoke)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Non authentifié' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Session invalide' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Vérifier que l'appelant a bien le rôle admin dans la table users
    const { data: callerProfile } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (callerProfile?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Accès réservé aux admins' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Lire l'action demandée
    const { action, userId } = await req.json();

    if (action === 'deleteUser') {
      if (!userId) throw new Error('userId manquant');

      // Garde-fous
      if (userId === user.id) throw new Error('Impossible de supprimer votre propre compte');
      if (userId === 'ab096262-ff74-4faf-a671-6f4611e454d7') {
        throw new Error("Impossible de supprimer l'admin principal");
      }

      // 1) Supprime le compte Auth (le profil public.users part en cascade)
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      // Si le compte Auth n'existe déjà plus, on continue quand même (nettoyage du profil)
      if (error && !/not found/i.test(error.message)) throw error;

      // 2) Nettoyage du profil au cas où la cascade n'aurait pas eu lieu
      const { error: profileErr } = await supabaseAdmin.from('users').delete().eq('id', userId);
      if (profileErr) throw profileErr;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Action inconnue' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('admin-actions error:', err);
    return new Response(JSON.stringify({ error: (err as Error).message ?? String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
