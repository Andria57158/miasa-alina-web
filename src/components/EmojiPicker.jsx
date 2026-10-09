// src/components/EmojiPicker.jsx

import React, { useRef, useEffect, useState } from 'react';
import EmojiPickerReact, { Theme, EmojiStyle } from 'emoji-picker-react';

// Dimensions adaptées à l'écran : le picker ne dépasse jamais la fenêtre
const computeLayout = () => {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const h = typeof window !== 'undefined' ? window.innerHeight : 768;
  const small = w <= 480;
  return {
    height: Math.max(260, Math.min(360, Math.floor(h * (small ? 0.5 : 0.55)))),
    emojiSize: small ? 26 : 30,
    perRow: small ? 7 : 8,
    small,
  };
};

const EmojiPicker = ({ onSelect, onClose }) => {
  const pickerRef = useRef(null);
  const [layout, setLayout] = useState(computeLayout);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target)) onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [onClose]);

  // Recalcule la taille à chaque redimensionnement / rotation de l'écran
  useEffect(() => {
    const onResize = () => setLayout(computeLayout());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  return (
    <div className="emoji-picker-advanced" ref={pickerRef}>
      <EmojiPickerReact
        onEmojiClick={(emojiData) => onSelect(emojiData.emoji)}
        theme={Theme.DARK}
        emojiStyle={EmojiStyle.NATIVE}
        autoFocusSearch={false}
        lazyLoadEmojis={true}
        previewConfig={{ showPreview: false }}
        skinTonesDisabled={layout.small}
        emojiSize={layout.emojiSize}
        perRow={layout.perRow}
        width="100%"
        height={layout.height}
      />
    </div>
  );
};

export default EmojiPicker;
