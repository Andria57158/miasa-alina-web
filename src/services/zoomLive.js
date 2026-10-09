// src/services/zoomLive.js
// Le live s'appuie sur l'API Zoom (réunion créée côté serveur, affichée avec le Meeting SDK).
import { callEdgeFunction } from './edgeFunctions';

// Hôte : crée la réunion → { meetingNumber, password, sdkKey, signature, zak }
export const createLiveSession = ({ title }) => callEdgeFunction('zoom-live', { action: 'create', topic: title });

// Spectateur : → { meetingNumber, password, sdkKey, signature }
export const joinLiveSession = (meetingNumber) => callEdgeFunction('zoom-live', { action: 'join', meetingNumber });

export const endLiveSession = (meetingNumber) => callEdgeFunction('zoom-live', { action: 'end', meetingNumber });

// Codes d'erreur qui veulent dire « Zoom n'est pas disponible » → on retombe sur le mode local
export const isZoomUnavailable = (err) => err?.code === 'ZOOM_NOT_CONFIGURED' || err?.code === 'UNAVAILABLE';
