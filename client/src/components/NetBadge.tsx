/**
 * Low-network badge.
 *
 * The header pill says the same thing, but the header is the last place anyone looks mid-hand —
 * and a slow connection is exactly when you need to know why nothing is happening. This sits on
 * the play area itself, out of the thumb arc, and only ever appears when there is something wrong.
 */
import { useStore } from '../lib/store';
import { lowNetworkUrl } from '../lib/assets';
import { t } from '../i18n';

export function NetBadge() {
  const s = useStore();
  if (s.net === 'ok') return null;
  return (
    <div className={`net-badge ${s.net}`} role="status" aria-live="polite">
      <img src={lowNetworkUrl} alt="" width={22} height={22} />
      <span>{t(s.net === 'off' ? 'net.off' : 'net.slow')}</span>
    </div>
  );
}
