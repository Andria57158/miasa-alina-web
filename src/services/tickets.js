// src/services/tickets.js — billets (1 QR par place), liste des invités, style selon la catégorie.
import { supabase } from '../supabaseClient';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

// VVIP / VIP / Gold : billet en couleur. Lite / Silver / Fan Zone : seul le QR code s'affiche.
const COLORED = {
  vvip: { label: 'VVIP', from: '#7b1fa2', to: '#e91e63', text: '#ffffff' },
  vip:  { label: 'VIP',  from: '#b71c1c', to: '#ff5252', text: '#ffffff' },
  gold: { label: 'GOLD', from: '#b8860b', to: '#ffd54f', text: '#2b1d00' },
};
export const ticketTheme = (tierName) => {
  const c = COLORED[norm(tierName)];
  return c ? { colored: true, ...c } : { colored: false, label: String(tierName || '') };
};

export async function listMyTickets() {
  const { data, error } = await supabase.from('tickets').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
// Admin : liste des invités = billets « valid » (ceux déjà scannés n'y sont plus)
export const listAllTickets = listMyTickets;

export function subscribeTickets(onChange) {
  const ch = supabase.channel(`tickets-sync:${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, onChange).subscribe();
  return () => supabase.removeChannel(ch);
}
