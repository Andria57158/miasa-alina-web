// src/services/edgeFunctions.js
// Appel des fonctions Edge Supabase avec des erreurs lisibles (code + message).
import { supabase } from '../supabaseClient';

export async function callEdgeFunction(name, body) {
  let data;
  let error;
  try {
    ({ data, error } = await supabase.functions.invoke(name, { body }));
  } catch (e) {
    throw Object.assign(new Error('Service indisponible.'), { code: 'UNAVAILABLE', cause: e });
  }
  if (error) {
    let payload = null;
    try { payload = await error.context?.json?.(); } catch { /* corps non JSON */ }
    const code = payload?.error || (error.name === 'FunctionsFetchError' ? 'UNAVAILABLE' : 'FUNCTION_ERROR');
    const message = payload?.message || error.message || 'Erreur du service.';
    throw Object.assign(new Error(message), { code, status: error.context?.status });
  }
  return data;
}
