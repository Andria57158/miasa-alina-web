// src/hooks/useProfiles.js
// Un seul cache de profils pour toute l'application : quand quelqu'un change sa photo ou son pseudo,
// tous les composants qui affichent profileOf(id) se mettent à jour immédiatement.
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchProfiles, subscribeProfiles } from '../services/profiles';

export default function useProfiles(initialIds = []) {
  const [map, setMap] = useState({});
  const known = useRef(new Set());

  const ensure = useCallback(async (ids) => {
    const missing = [...new Set(ids)].filter((id) => id && !known.current.has(id));
    if (!missing.length) return;
    missing.forEach((id) => known.current.add(id));
    try {
      const rows = await fetchProfiles(missing);
      setMap((m) => ({ ...m, ...Object.fromEntries(rows.map((p) => [p.id, p])) }));
    } catch { missing.forEach((id) => known.current.delete(id)); }
  }, []);

  useEffect(() => { ensure(initialIds); }, [initialIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => subscribeProfiles((p) => p && setMap((m) => ({ ...m, [p.id]: p }))), []);

  const profileOf = useCallback((id) => map[id] || { id, pseudo: 'Membre', avatar_url: null }, [map]);
  return { profileOf, ensure };
}
