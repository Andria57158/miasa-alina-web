// src/hooks/useVoiceRecorder.js
// Enregistrement audio « en un clic » : 1er clic = démarre, 2e clic = arrête et renvoie { blob, durationS }.
import { useCallback, useRef, useState } from 'react';

export default function useVoiceRecorder({ onRecorded }) {
  const [recording, setRecording] = useState(false);
  const rec = useRef(null);
  const chunks = useRef([]);
  const startedAt = useRef(0);

  const toggle = useCallback(async () => {
    if (recording) { rec.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' });
        const durationS = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
        if (blob.size > 0) onRecorded?.({ blob, durationS });    // → sendPrivateMessage / addEventComment (kind: 'voice')
      };
      rec.current = r; startedAt.current = Date.now(); r.start(); setRecording(true);
    } catch { alert("Impossible d'accéder au micro. Autorisez-le dans le navigateur."); }
  }, [recording, onRecorded]);

  return { recording, toggle };
}
