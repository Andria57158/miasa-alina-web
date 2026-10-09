// src/context/PlayerContext.jsx
//
// Lecteur audio GLOBAL : un seul objet Audio() vit ici, dans un Provider
// monté une seule fois au-dessus de <Routes> (voir App.jsx). Comme il
// n'est jamais démonté quand on change de page, la musique continue de
// jouer même en naviguant ailleurs sur le site.
//
import React, { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react';

const PlayerContext = createContext(null);

export const PlayerProvider = ({ children }) => {
  const audioRef = useRef(new Audio());

  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [queue, setQueue] = useState([]); // la liste dans laquelle "suivant/précédent" naviguent
  const [playbackMode, setPlaybackModeState] = useState(() => localStorage.getItem('playbackMode') || 'repeat-all');

  const setPlaybackMode = useCallback((mode) => {
    setPlaybackModeState(mode);
    localStorage.setItem('playbackMode', mode);
  }, []);

  const playNext = useCallback(() => {
    setCurrentSong((prevSong) => {
      if (!prevSong || queue.length === 0) return prevSong;
      const idx = queue.findIndex((s) => s.id === prevSong.id);
      if (idx === -1) return prevSong;
      let nextIdx;
      if (playbackMode === 'repeat-one') nextIdx = idx;
      else if (playbackMode === 'shuffle') nextIdx = Math.floor(Math.random() * queue.length);
      else nextIdx = (idx + 1) % queue.length;
      const next = queue[nextIdx];
      if (!next) return prevSong;
      audioRef.current.src = next.src;
      audioRef.current.play().catch((e) => console.log('Erreur lecture audio :', e));
      setIsPlaying(true);
      return next;
    });
  }, [queue, playbackMode]);

  // Écoute les événements du <audio> une seule fois (objet stable).
  useEffect(() => {
    const audio = audioRef.current;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onMeta = () => setDuration(audio.duration);
    const onEnd = () => playNext();
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnd);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnd);
    };
  }, [playNext]);

  // song: le morceau à jouer. songQueue (optionnel) : la liste affichée par
  // la page qui appelle playSong (album filtré, résultats de recherche...),
  // utilisée ensuite par "suivant"/"précédent".
  const playSong = useCallback((song, songQueue) => {
    if (songQueue) setQueue(songQueue);
    setCurrentSong((prevSong) => {
      if (prevSong?.id === song.id) {
        if (audioRef.current.paused) {
          audioRef.current.play().catch(() => {});
          setIsPlaying(true);
        } else {
          audioRef.current.pause();
          setIsPlaying(false);
        }
        return prevSong;
      }
      audioRef.current.src = song.src;
      audioRef.current.play().catch((e) => console.log('Erreur lecture audio :', e));
      setIsPlaying(true);
      song.plays = (song.plays || 0) + 1;
      return song;
    });
  }, []);

  const togglePlayPause = useCallback(() => {
    if (!audioRef.current.src) return;
    if (audioRef.current.paused) {
      audioRef.current.play().catch(() => {});
      setIsPlaying(true);
    } else {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  const playPrevious = useCallback(() => {
    setCurrentSong((prevSong) => {
      if (!prevSong || queue.length === 0) return prevSong;
      const idx = queue.findIndex((s) => s.id === prevSong.id);
      if (idx === -1) return prevSong;
      const prevIdx = (idx - 1 + queue.length) % queue.length;
      const prev = queue[prevIdx];
      if (!prev) return prevSong;
      audioRef.current.src = prev.src;
      audioRef.current.play().catch(() => {});
      setIsPlaying(true);
      return prev;
    });
  }, [queue]);

  const skipForward = useCallback(() => {
    const audio = audioRef.current;
    audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 30);
  }, []);

  const skipBackward = useCallback(() => {
    const audio = audioRef.current;
    audio.currentTime = Math.max(0, audio.currentTime - 10);
  }, []);

  const seekTo = useCallback((time) => {
    audioRef.current.currentTime = time;
  }, []);

  const value = {
    currentSong,
    isPlaying,
    currentTime,
    duration,
    queue,
    playbackMode,
    setPlaybackMode,
    playSong,
    togglePlayPause,
    playNext,
    playPrevious,
    skipForward,
    skipBackward,
    seekTo
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};

export const usePlayer = () => {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer() doit être utilisé à l'intérieur de <PlayerProvider>");
  return ctx;
};
