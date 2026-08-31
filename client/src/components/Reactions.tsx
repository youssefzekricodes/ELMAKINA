/* In-game emoji reactions: tap an emoji and it floats up over the table for everyone in the room.
   Reactions are broadcast over the Supabase room channel (ephemeral, no database). */
import { useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { sendReaction } from '../lib/net';
import { t } from '../i18n';
import { Icon } from './ui';

// GIF sticker reactions only (image path in `token`). Each flies up over the table when tapped.
const isGif = (token: string) => token.startsWith('/');
const REACTIONS: { token: string; key: string }[] = [
  { token: '/img/reactions/peepo-laugh.gif', key: 'laugh' },
  { token: '/img/reactions/pepe-point.gif', key: 'point' },
  { token: '/img/reactions/angry.gif', key: 'angry' },
  { token: '/img/reactions/pepe-cry.gif', key: 'cry' },
  { token: '/img/reactions/cat-crying.gif', key: 'catcry' },
  { token: '/img/reactions/goose.gif', key: 'dance' },
  { token: '/img/reactions/dog-dance.gif', key: 'dogdance' },
  { token: '/img/reactions/shiba.gif', key: 'shiba' },
  { token: '/img/reactions/scuba.gif', key: 'scuba' },
  { token: '/img/reactions/icon60.gif', key: 'icon60' },
  { token: '/img/reactions/hi.gif', key: 'hi' },
  { token: '/img/reactions/tung.gif', key: 'tung' },
  // Animated WebP rather than GIF: the sources ran 14 MB between them, which is not something to
  // put on a phone mid-hand. Same frames, a tenth of the weight.
  { token: '/img/reactions/awkward.webp', key: 'awkward' },
  { token: '/img/reactions/shook.webp', key: 'shook' },
  { token: '/img/reactions/huh.webp', key: 'huh' },
  { token: '/img/reactions/confused.webp', key: 'confused' },
  { token: '/img/reactions/catdog.webp', key: 'catdog' },
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
          {open ? <Icon name="close-circle" className="size-6" /> : <img src="/img/emojis.png" alt="" className="react-launch-img" draggable={false} />}
        </button>
      </div>
    </>
  );
}
