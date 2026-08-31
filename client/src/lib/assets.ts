/**
 * Game art, cached in IndexedDB.
 *
 * The card faces, the machine, the coin and the avatars are the same bytes every session, and
 * re-fetching them on every load is the slowest part of opening the game on a phone. They are
 * stored as blobs in IndexedDB (Dexie) and handed to the app as object URLs, so after the first
 * visit the board paints without touching the network at all.
 *
 * The rewrite happens on the THEME object before React mounts, so no component ever sees a network
 * URL and nothing downstream has to know this layer exists. Anything that fails to cache simply
 * keeps its original path — a broken cache must never mean a broken board.
 */
import Dexie, { type Table } from 'dexie';
import { THEME, ACTION_CARDS, CHARACTERS, DEFAULT_AVATARS } from '../theme';
import { builtInAvatars } from './store';

/** Bump when the art itself changes; a mismatch throws the whole store away. */
const ASSET_VER = 1;

interface Cached { url: string; ver: number; blob: Blob }

class AssetDb extends Dexie {
  files!: Table<Cached, string>;
  constructor() {
    super('mekina-assets');
    this.version(1).stores({ files: 'url' });
  }
}

const db = new AssetDb();
const objectUrls: string[] = [];

/** Every image the game needs before it can draw a table. */
export function assetList(): string[] {
  const t = THEME.img;
  return [...new Set([
    t.poster, t.machine, t.machineSmall, t.cardBack, t.coin,
    ...t.bg, ...t.bgSmall, ...t.bgGame, ...t.bgGameSmall,
    ...CHARACTERS.flatMap((c) => [THEME.characters[c].card, THEME.characters[c].cardSm]),
    ...Object.values(ACTION_CARDS),
    ...DEFAULT_AVATARS.map((a) => `/img/avatars/${a}.webp`),
    '/img/low-network.png',
  ])].filter(Boolean);
}

/** Read one asset from the cache, or fetch and store it. Returns null if it cannot be had. */
async function load(url: string): Promise<Blob | null> {
  try {
    const hit = await db.files.get(url);
    if (hit && hit.ver === ASSET_VER && hit.blob) return hit.blob;
  } catch { /* a blocked or corrupt IndexedDB must not stop the game — fall through to the network */ }
  try {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) return null;
    const blob = await res.blob();
    db.files.put({ url, ver: ASSET_VER, blob }).catch(() => { /* private mode / quota: still usable this session */ });
    return blob;
  } catch { return null; }
}

/** Swap a cached blob in for its path, everywhere the theme exposes one. */
function rewrite(map: Record<string, string>) {
  const t = THEME.img as Record<string, any>;
  for (const k of Object.keys(t)) {
    const v = t[k];
    if (typeof v === 'string') { if (map[v]) t[k] = map[v]; }
    else if (Array.isArray(v)) t[k] = v.map((u: string) => map[u] || u);
  }
  for (const c of CHARACTERS) {
    const ch = THEME.characters[c];
    if (map[ch.card]) ch.card = map[ch.card];
    if (map[ch.cardSm]) ch.cardSm = map[ch.cardSm];
  }
  for (const k of Object.keys(ACTION_CARDS)) if (map[ACTION_CARDS[k]]) ACTION_CARDS[k] = map[ACTION_CARDS[k]];
}

/** The low-network badge, resolved through the cache like everything else. */
export let lowNetworkUrl = '/img/low-network.png';

/**
 * Fill the cache, reporting 0..1 as it goes. Resolves when every asset has been tried — never
 * rejects, and never blocks the game on a single missing file.
 */
export async function preloadAssets(onProgress?: (done: number, total: number) => void): Promise<void> {
  const urls = assetList();
  const total = urls.length;
  let done = 0;
  const map: Record<string, string> = {};
  // Six at a time: enough to saturate a phone connection without stalling the first paint behind
  // a queue of forty parallel requests.
  const queue = urls.slice();
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      const blob = await load(url);
      if (blob) { const obj = URL.createObjectURL(blob); objectUrls.push(obj); map[url] = obj; }
      onProgress?.(++done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, total) }, worker));
  rewrite(map);
  for (const a of DEFAULT_AVATARS) { const u = map[`/img/avatars/${a}.webp`]; if (u) builtInAvatars[a] = u; }
  if (map['/img/low-network.png']) lowNetworkUrl = map['/img/low-network.png'];
  // Old art from a previous release is dead weight; drop it once the new set is in.
  db.files.where('ver').notEqual(ASSET_VER).delete().catch(() => { /* nothing to clean, or no access */ });
}

/** Release the object URLs (only meaningful if the app is ever torn down). */
export function releaseAssets() { objectUrls.splice(0).forEach((u) => URL.revokeObjectURL(u)); }
