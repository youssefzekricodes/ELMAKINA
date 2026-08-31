/* One ambient background image (blurred/dimmed behind the table in-game). */
import { useEffect, useRef } from 'react';
import { IMG } from '../theme';

export function Background({ inGame, screen }: { inGame: boolean; screen?: string }) {
  const layer = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const pick = () => {
      const el = layer.current; if (!el) return;
      const small = Math.max(window.innerWidth, window.innerHeight) < 1100;
      const src = (small ? IMG.bgSmall : IMG.bg)[0];
      el.style.backgroundImage = `url('${src}')`;
      new Image().src = src;
    };
    pick();
    window.addEventListener('resize', pick);
    return () => window.removeEventListener('resize', pick);
  }, []);
  return (
    <div className={`bg ${inGame ? 'in-game' : ''} ${screen === 'lobby' ? 'smokey' : ''}`} aria-hidden="true">
      <div className="bg-layer show" ref={layer} />
      <div className="bg-vignette" />
    </div>
  );
}
