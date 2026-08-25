/* In-game emoji reactions: tap an emoji and it floats up over the table for everyone in the room.
   Reactions are broadcast over the Supabase room channel (ephemeral, no database). */
import { useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { sendReaction } from '../lib/net';
import { t } from '../i18n';
import { Icon } from './ui';

// A reaction's `token` is either an emoji glyph or an image path (starts with "/"); gif stickers fly bigger.
const isGif = (token: string) => token.startsWith('/');
const REACTIONS: { token: string; key: string }[] = [
  { token: '😂', key: 'hhh' },
  { token: '😭', key: 'cry' },
  { token: '😠', key: 'grrr' },
  { token: '🎉', key: 'yeeey' },
  { token: '/img/reactions/scuba.gif', key: 'scuba' },
  { token: '/img/reactions/cat-crying.gif', key: 'catcry' },
];

export function Reactions() {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const last = useRef(0);

  if (s.screen !== 'game' || !s.room) return null;

  const fire = (emoji: string) => {
    const now = Date.now();
    if (now - last.current < 500) return; // gentle anti-spam
    last.current = now;
    sendReaction(emoji);
  };

  return (
    <>
      {/* floating layer: each live reaction rises and fades */}
      <div className="react-fly" aria-hidden="true">
        {s.reactions.map((r) => (
          <span key={r.id} className="react-bubble" style={{ left: `${8 + ((r.id * 41) % 76)}%` }}>
            <span className="react-emoji">{isGif(r.emoji) ? <img src={r.emoji} alt="" draggable={false} /> : r.emoji}</span>
            <span className="react-name">{r.uid === s.me ? t('react.you') : r.name}</span>
          </span>
        ))}
      </div>

      {/* launcher + emoji tray (bottom corner) */}
      <div className={`react-dock ${open ? 'open' : ''}`}>
        {open && (
          <div className="react-tray" role="group" aria-label={t('react.title')}>
            {REACTIONS.map((e) => (
              <button key={e.key} type="button" className="react-key" aria-label={t(`react.${e.key}`)} onClick={() => fire(e.token)}>
                {isGif(e.token) ? <img src={e.token} alt="" draggable={false} /> : e.token}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="react-launch" aria-label={t('react.title')} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? <Icon name="close-circle" className="size-5" /> : <span className="react-launch-face">😄</span>}
        </button>
      </div>
    </>
  );
}
