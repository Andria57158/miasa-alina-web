// src/Admin/AlbumFormModal.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { uploadToCloudinary } from '../cloudinaryClient';
import './AlbumFormModal.css';

const AUDIO_ACCEPT = 'audio/*';

const emptyTrack = () => ({
  artist: 'ALP',
  title: '',
  description: '',
  lyricsText: '',
  audioFile: null,
  audioFileName: '',
  audioDuration: 0,
  audioPreviewUrl: null
});

const readAudioDuration = (file) =>
  new Promise((resolve) => {
    try {
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(audio.src);
        resolve(Math.round(audio.duration) || 0);
      };
      audio.onerror = () => resolve(0);
      audio.src = URL.createObjectURL(file);
    } catch {
      resolve(0);
    }
  });

const AlbumFormModal = ({ album = null, onClose, onSaved }) => {
  const isEdit = !!album;
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Étape 1
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState(album?.cover || '');
  const [title, setTitle] = useState(album?.title || '');

  // Étape 2
  const [year, setYear] = useState(album?.year || '');
  const [trackCount, setTrackCount] = useState(album?.songs?.length || 1);
  const [description, setDescription] = useState(album?.description || '');

  // Étape 3
  const [tracks, setTracks] = useState([emptyTrack()]);

  useEffect(() => {
    if (!isEdit) {
      const n = Math.max(1, Math.min(50, parseInt(trackCount, 10) || 1));
      setTracks(prev => {
        const next = [...prev];
        while (next.length < n) next.push(emptyTrack());
        while (next.length > n) next.pop();
        return next;
      });
    }
  }, [trackCount, isEdit]);

  const handleCoverChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  };

  const updateTrack = (index, field, value) => {
    setTracks(prev => prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)));
  };

  const handleTrackAudio = async (index, e) => {
    const file = e.target.files[0];
    if (!file) return;
   
    setTracks(prev => prev.map((t, i) => {
      if (i !== index) return t;
      if (t.audioPreviewUrl) URL.revokeObjectURL(t.audioPreviewUrl);
      return { ...t, audioFile: file, audioFileName: file.name, audioPreviewUrl: URL.createObjectURL(file) };
    }));
    const dur = await readAudioDuration(file);
    updateTrack(index, 'audioDuration', dur);
  };

  const goNext = () => {
    setError('');
    if (step === 1 && !title.trim()) { setError("Le nom de l'album est obligatoire."); return; }
    if (step === 2 && !year.trim()) { setError('La date de sortie est obligatoire.'); return; }
    setStep(s => Math.min(isEdit ? 2 : 3, s + 1));
  };
  const goPrev = () => { setError(''); setStep(s => Math.max(1, s - 1)); };

  const handleSubmit = async () => {
    setError('');
    if (!title.trim()) { setError("Le nom de l'album est obligatoire."); setStep(1); return; }
    if (!isEdit) {
      for (let i = 0; i < tracks.length; i++) {
        if (!tracks[i].title.trim()) {
          setError(`Le titre du morceau ${i + 1} est obligatoire.`);
          setStep(3);
          return;
        }
      }
    }

    setSaving(true);
    try {
      let coverUrl = album?.cover || null;
      if (coverFile) {
        const uploaded = await uploadToCloudinary(coverFile, 'image');
        coverUrl = uploaded.url;
      }

      if (isEdit) {
        const { error: updateErr } = await supabase
          .from('albums')
          .update({
            title: title.trim(),
            year: year.trim(),
            description: description.trim(),
            cover_url: coverUrl
          })
          .eq('id', album.id);
        if (updateErr) throw updateErr;
      } else {
        const { data: newAlbum, error: insertErr } = await supabase
          .from('albums')
          .insert({
            title: title.trim(),
            artist: 'ALP',
            year: year.trim(),
            description: description.trim(),
            cover_url: coverUrl,
            track_count: tracks.length
          })
          .select()
          .single();
        if (insertErr) throw insertErr;

        // Upload des paroles + de la musique, puis insertion des morceaux
        for (let i = 0; i < tracks.length; i++) {
          const t = tracks[i];
          let audioUrl = null;
          let audioDuration = t.audioDuration || 0;
          if (t.audioFile) {
            const uploadedAudio = await uploadToCloudinary(t.audioFile, 'video');
            audioUrl = uploadedAudio.url;
            audioDuration = uploadedAudio.duration || audioDuration;
          }
          const { error: songErr } = await supabase.from('songs').insert({
            album_id: newAlbum.id,
            title: t.title.trim(),
            artist: t.artist.trim() || 'ALP',
            description: t.description.trim(),
            lyrics_text: t.lyricsText.trim() || null,
            audio_url: audioUrl,
            duration: audioDuration,
            position: i + 1
          });
          if (songErr) throw songErr;
        }
      }

      onSaved && onSaved();
      onClose();
    } catch (e) {
      console.error(e);
      setError(e.message || "Une erreur est survenue lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  const lastStep = isEdit ? 2 : 3;

  return (
    <div className="afm-overlay" onClick={onClose}>
      <div className="afm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="afm-header">
          <h2><i className="fas fa-compact-disc"></i> {isEdit ? "Modifier l'album" : 'Créer un album'}</h2>
          <button className="afm-close" onClick={onClose}><i className="fas fa-times"></i></button>
        </div>

        <div className="afm-steps">
          <div className={`afm-step-dot ${step >= 1 ? 'active' : ''}`}>1</div>
          <div className="afm-step-line"></div>
          <div className={`afm-step-dot ${step >= 2 ? 'active' : ''}`}>2</div>
          {!isEdit && (
            <>
              <div className="afm-step-line"></div>
              <div className={`afm-step-dot ${step >= 3 ? 'active' : ''}`}>3</div>
            </>
          )}
        </div>

        <div className="afm-body">
          {step === 1 && (
            <div className="afm-panel">
              <p className="afm-panel-title">Pochette et nom de l'album</p>
              <label className="afm-cover-upload">
                {coverPreview ? <img src={coverPreview} alt="pochette" /> : <i className="fas fa-image"></i>}
                <input type="file" accept="image/*" onChange={handleCoverChange} hidden />
                <span>{coverPreview ? 'Changer la pochette' : 'Choisir une pochette'}</span>
              </label>
              <label className="afm-field">
                Nom de l'album
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex : YASSAL PIII" />
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="afm-panel">
              <p className="afm-panel-title">Date de sortie, nombre de titres et histoire</p>
              <label className="afm-field">
                Date de sortie
                <input type="date" value={year} onChange={(e) => setYear(e.target.value)} />
              </label>
              {!isEdit && (
                <label className="afm-field">
                  Nombre de titres
                  <input type="number" min="1" max="50" value={trackCount} onChange={(e) => setTrackCount(e.target.value)} />
                </label>
              )}
              <label className="afm-field">
                Histoire de l'album
                <textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Racontez l'histoire de cet album..." />
              </label>
            </div>
          )}

          {step === 3 && !isEdit && (
            <div className="afm-panel afm-tracks-panel">
              <p className="afm-panel-title">Détails de chaque morceau ({tracks.length})</p>
              {tracks.map((t, i) => (
                <div className="afm-track-card" key={i}>
                  <div className="afm-track-header">Morceau {i + 1}</div>
                  <label className="afm-field">
                    Nom de l'artiste
                    <input type="text" value={t.artist} onChange={(e) => updateTrack(i, 'artist', e.target.value)} placeholder="Ex : ALP ft RASL" />
                  </label>
                  <label className="afm-field">
                    Titre
                    <input type="text" value={t.title} onChange={(e) => updateTrack(i, 'title', e.target.value)} placeholder="Titre du morceau" />
                  </label>
                  <label className="afm-field">
                    Histoire du morceau
                    <textarea rows={3} value={t.description} onChange={(e) => updateTrack(i, 'description', e.target.value)} placeholder="Histoire / contexte du morceau..." />
                  </label>
                  <label className="afm-field">
                    Paroles (à écrire ici)
                    <textarea rows={7} value={t.lyricsText} onChange={(e) => updateTrack(i, 'lyricsText', e.target.value)} placeholder={"[Couplet 1]\nUne ligne par vers…\n\n[Refrain]\n…"} />
                  </label>
                  <label className="afm-field">
                    Musique (fichier audio)
                    <div className="afm-file-row">
                      <label className="afm-file-btn">
                        <i className="fas fa-file-audio"></i> Choisir un fichier
                        <input type="file" accept={AUDIO_ACCEPT} onChange={(e) => handleTrackAudio(i, e)} hidden />
                      </label>
                      <span className="afm-file-name">{t.audioFileName || 'Aucun fichier'}</span>
                    </div>
                    {t.audioPreviewUrl && (
                      <audio className="afm-audio-preview" controls src={t.audioPreviewUrl} style={{ marginTop: 8 }} />
                    )}
                  </label>
                </div>
              ))}
            </div>
          )}

          {error && <div className="afm-error"><i className="fas fa-triangle-exclamation"></i> {error}</div>}
        </div>

        <div className="afm-footer">
          {step > 1 && <button className="afm-btn afm-btn-secondary" onClick={goPrev} disabled={saving}>Précédent</button>}
          <div className="afm-footer-spacer"></div>
          {step < lastStep && <button className="afm-btn afm-btn-primary" onClick={goNext}>Suivant</button>}
          {step === lastStep && (
            <button className="afm-btn afm-btn-primary" onClick={handleSubmit} disabled={saving}>
              {saving ? <><i className="fas fa-spinner fa-spin"></i> Enregistrement...</> : (isEdit ? 'Enregistrer les modifications' : "Créer l'album")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export const SongFormModal = ({ albumId, song = null, onClose, onSaved }) => {
  const isEdit = !!song;
  const [artist, setArtist] = useState(song?.artist || 'ALP');
  const [title, setTitle] = useState(song?.title || '');
  const [description, setDescription] = useState(song?.description || song?.histoire || '');
  const [lyricsText, setLyricsText] = useState(song?.lyrics_text ?? song?.lyrics ?? '');
  const [audioFile, setAudioFile] = useState(null);
  const [audioFileName, setAudioFileName] = useState(song?.audio_url ? song.title : '');
  const [audioDuration, setAudioDuration] = useState(song?.duration || 0);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState(song?.audio_url || null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleAudioFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // Prévisualisation immédiate, quel que soit le format (mp3, m4a, mpga, wav...)
    if (audioPreviewUrl && audioPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(audioPreviewUrl);
    setAudioFile(file);
    setAudioFileName(file.name);
    setAudioPreviewUrl(URL.createObjectURL(file));
    const dur = await readAudioDuration(file);
    setAudioDuration(dur);
  };

  const handleSubmit = async () => {
    if (!title.trim()) { setError('Le titre du morceau est obligatoire.'); return; }
    setSaving(true);
    setError('');
    try {
      let audioUrl = song?.audio_url || null;
      let duration = song?.duration || 0;
      if (audioFile) {
        const uploadedAudio = await uploadToCloudinary(audioFile, 'video');
        audioUrl = uploadedAudio.url;
        duration = uploadedAudio.duration || audioDuration || duration;
      }

      if (isEdit) {
        const { error: updateErr } = await supabase
          .from('songs')
          .update({
            artist: artist.trim() || 'ALP',
            title: title.trim(),
            description: description.trim(),
            lyrics_text: lyricsText.trim() || null,
            audio_url: audioUrl,
            duration
          })
          .eq('id', song.id);
        if (updateErr) throw updateErr;
      } else {
        const { error: insertErr } = await supabase.from('songs').insert({
          album_id: albumId,
          artist: artist.trim() || 'ALP',
          title: title.trim(),
          description: description.trim(),
          lyrics_text: lyricsText.trim() || null,
          audio_url: audioUrl,
          duration
        });
        if (insertErr) throw insertErr;
      }

      onSaved && onSaved();
      onClose();
    } catch (e) {
      console.error(e);
      setError(e.message || "Une erreur est survenue lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="afm-overlay" onClick={onClose}>
      <div className="afm-modal afm-modal-small" onClick={(e) => e.stopPropagation()}>
        <div className="afm-header">
          <h2><i className="fas fa-music"></i> {isEdit ? 'Modifier le morceau' : 'Ajouter un morceau'}</h2>
          <button className="afm-close" onClick={onClose}><i className="fas fa-times"></i></button>
        </div>
        <div className="afm-body">
          <div className="afm-panel">
            <label className="afm-field">
              Nom de l'artiste
              <input type="text" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Ex : ALP ft RASL" />
            </label>
            <label className="afm-field">
              Titre
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre du morceau" />
            </label>
            <label className="afm-field">
              Histoire du morceau
              <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Histoire / contexte du morceau..." />
            </label>
            <label className="afm-field">
              Paroles (à écrire ici)
              <textarea rows={8} value={lyricsText} onChange={(e) => setLyricsText(e.target.value)} placeholder={"[Couplet 1]\nUne ligne par vers…\n\n[Refrain]\n…"} />
            </label>
            <label className="afm-field">
              Musique (fichier audio)
              <div className="afm-file-row">
                <label className="afm-file-btn">
                  <i className="fas fa-file-audio"></i> Choisir un fichier
                  <input type="file" accept={AUDIO_ACCEPT} onChange={handleAudioFile} hidden />
                </label>
                <span className="afm-file-name">{audioFileName || 'Aucun fichier'}</span>
              </div>
              {audioPreviewUrl && (
                <audio className="afm-audio-preview" controls src={audioPreviewUrl} style={{ marginTop: 8 }} />
              )}
            </label>
            {error && <div className="afm-error"><i className="fas fa-triangle-exclamation"></i> {error}</div>}
          </div>
        </div>
        <div className="afm-footer">
          <div className="afm-footer-spacer"></div>
          <button className="afm-btn afm-btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? <><i className="fas fa-spinner fa-spin"></i> Enregistrement...</> : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AlbumFormModal;
