// src/hooks/useFriends.js
import { useCallback, useEffect, useState } from 'react';
import { listMembersWithStatus, sendFriendRequest, acceptFriendRequest, removeRelation, subscribeFriendships } from '../services/friends';

export default function useFriends(myId) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!myId) return;
    try { setMembers(await listMembersWithStatus(myId)); } finally { setLoading(false); }
  }, [myId]);

  useEffect(() => { refresh(); return subscribeFriendships(refresh); }, [refresh]);

  const wrap = (fn) => async (...a) => { try { await fn(...a); await refresh(); } catch (e) { alert(e.message); } };
  return {
    members, loading,
    request: wrap((id) => sendFriendRequest(myId, id)),
    accept:  wrap((m) => acceptFriendRequest(m.relationId)),
    remove:  wrap((m) => removeRelation(m.relationId)),   // retirer / annuler / refuser
  };
}
