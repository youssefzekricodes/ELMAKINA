/**
 * The website around the game.
 *
 * WHY THIS EXISTS: AdSense flagged elmekina.com for "ads on pages without publisher content". It
 * was right. The site served a splash div, an empty <div id="root"> and 453 characters of
 * <noscript> text, with the ad loader on top of it — while five thousand characters of real
 * writing (the rules, every character's dossier, a ten-part guide) sat locked inside the JS bundle
 * where no crawler could reach it.
 *
 * So these pages are generated FROM those same strings. Not a copy of them — the same ones the game
 * renders, read at build time. The site cannot drift from the game because there is nothing to keep
 * in sync: change a rule in i18n.strings.ts and the page changes with it.
 *
 * The game moves to /play and the landing page takes /. That is also the shape the app stores want:
 * one address to send people to, which offers the browser version and both store listings.
 */
import fs from 'node:fs';
import path from 'node:path';
import { UI } from '../src/i18n.strings';
// @ts-ignore — plain .mjs catalog, shared with the Edge Function
import * as MSG from '../../supabase/functions/game/messages.mjs';

/** Store listings. Empty until the apps are live; the buttons render as "coming soon" until then,
 *  so the page never ships a dead link. */
export const STORES = {
  android: '',   // https://play.google.com/store/apps/details?id=com.elmekina.game
  ios: '',       // https://apps.apple.com/app/idXXXXXXXXX
};

const SITE = 'https://elmekina.com';
const CHARACTERS = ['taxman', 'businesswoman', 'police', 'terrorist', 'colonel', 'politician', 'thief'];
/** The guide, in the order it teaches. Each is a {key}.t heading and a {key}.b paragraph. */
const GUIDE = ['goal', 'hand', 'turn', 'coins', 'claim', 'block', 'bluff', 'chars', 'win'];

type Lang = 'en' | 'tn';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const T = (lang: Lang, key: string) => (UI[lang] && UI[lang][key]) || UI.en[key] || '';
const charName = (lang: Lang, c: string) => (MSG.names[lang] && MSG.names[lang][c]) || MSG.names.en[c] || c;

/** Copy that belongs to the website rather than the game, so it lives here rather than in the app's
 *  string table — nothing in the game ever renders it. */
const COPY = {
  en: {
    lead: 'A free real-time card game of bluffing, deduction and investigation for 2–6 players. Claim a hidden role, lie about the one you hold, and call out everyone who lies back. The last player still holding a card wins.',
    play: 'Play in your browser',
    playSub: 'No download. No account needed to start.',
    howTitle: 'How to play', charsTitle: 'The suspects', charsLead: 'Seven roles are in the deck. You hold two of them, face down — and you may claim any of the seven, whether you hold it or not.',
    rulesTitle: 'Full rules', storeTitle: 'Get the app', soon: 'Coming soon',
    home: 'Home', privacy: 'Privacy', other: 'العربية', otherHref: '/ar/',
    siteTitle: 'ELMEKINA — Online Card Game of Bluffing, Deduction & Deception', getOn: 'Get it on', markAlt: 'The ELMEKINA machine, the emblem of the game',
    footer: 'A game about who you say you are.',
  },
  tn: {
    lead: 'لعبة أوراق مجّانية بالوقت الحقيقي، فيها كذب و فطنة و تحقيق، من 2 حتّى 6 لعّابة. اختار دور مخبّي، اكذب على اللي عندك، و كشّف اللي يكذب عليك. آخر واحد يبقى عندو كارت هو اللي يربح.',
    play: 'العب في المتصفّح',
    playSub: 'من غير تنزيل. ما تحتاجش حساب باش تبدا.',
    howTitle: 'كيفاش تلعب', charsTitle: 'الشخصيّات', charsLead: 'سبعة أدوار في الكومة. عندك زوز منهم مقلوبين — و تنجّم تدّعي أيّ واحد من السبعة، سواء عندك ولا لا.',
    rulesTitle: 'القوانين الكاملة', storeTitle: 'حمّل الأبليكاسيون', soon: 'قريبا',
    home: 'الرئيسيّة', privacy: 'الخصوصيّة', other: 'English', otherHref: '/',
    siteTitle: 'الماكينة — لعبة أوراق أونلاين فيها كذب و فطنة و تحقيق', getOn: 'حمّلها من', markAlt: 'الماكينة، رمز اللعبة',
    footer: 'لعبة على شكون تقول إنّك.',
  },
};

const CSS = `
:root{--ink:#0E0B08;--paper:#F3E9D6;--muted:#A79A85;--gold:#B7873F;--lit:#FFD97A;--line:rgba(243,233,214,.14);
  --accent:#E5661A}
*{box-sizing:border-box}
html{background:var(--ink);color:var(--paper);-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;font-family:'Plus Jakarta Sans',system-ui,sans-serif;line-height:1.6;font-size:17px;min-height:100vh}
body[dir=rtl]{font-family:'IBM Plex Sans Arabic',system-ui,sans-serif}
/* The game's own backdrop — the table, the curtains, the wanted wall. Fixed, so scrolling moves the
   content across the scene rather than dragging the scene along with it. */
body::before{content:'';position:fixed;inset:0;z-index:-2;background:url('/img/bg-portrait-sm.webp?v=2') center/cover no-repeat}
@media (orientation:landscape){body::before{background-image:url('/img/bg-game-sm.webp?v=2')}}
/* The SAME choice components/Background.tsx makes, expressed in CSS: orientation picks the framing,
   a longest edge of 1100px picks the resolution. Getting this wrong is exactly why the page looked
   soft while the game looked sharp — a 900px-wide file stretched 1.6x across a 1280px desktop,
   where the game was already loading the 1600px one and scaling it DOWN. */
@media (orientation:landscape) and (min-width:1100px){body::before{background-image:url('/img/bg-game.webp?v=2')}}
@media (orientation:portrait) and (min-height:1100px){body::before{background-image:url('/img/bg-portrait.webp?v=2')}}
/* No scrim over the artwork — the scene carries the page. Legibility is paid for locally instead:
   the hero text has a shadow, and every block of body copy sits on its own blurred surface. */
.wrap{max-width:900px;margin:0 auto;padding:0 24px}
a{color:var(--lit);text-decoration:none}a:hover{text-decoration:underline}
h1,h2,h3{font-family:Oswald,'IBM Plex Sans Arabic',system-ui,sans-serif;font-weight:600;letter-spacing:.02em;line-height:1.1;margin:0}
h3{font-size:18px;color:var(--paper);font-weight:500}
h2{font-size:clamp(24px,4vw,32px);margin-bottom:26px}
/* The short rule under a heading is the one flourish on this page, borrowed from the game's own tab
   bar. As a block it starts at the inline start, so it sits under the first letter in both LTR and
   RTL without needing a mirrored rule. */
h2::after{content:'';display:block;width:54px;height:4px;border-radius:999px;background:var(--lit);margin-top:14px}

/* Air around each block, and a hairline between consecutive ones. Using the adjacent-sibling form
   means the first block needs no exception. */
section{padding:44px 0}
section + section{border-top:1px solid var(--line)}
nav.top{display:flex;gap:22px;align-items:center;padding:22px 0;font-size:15px}
nav.top .brand{font-family:Oswald,sans-serif;font-size:19px;text-transform:uppercase;color:var(--paper);letter-spacing:.08em;margin-inline-end:auto}
nav.top a:not(.brand){color:var(--muted)}nav.top a:not(.brand):hover{color:var(--paper);text-decoration:none}
/* The same control the game uses: a circular chip with the OTHER language's flag in it, because a
   flag is a picture of a place and reads as a round token rather than a square glyph. */
.lang{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;flex:0 0 auto;
  border-radius:50%;border:1px solid var(--line);background:rgba(0,0,0,.38);padding:0}
.lang:hover{border-color:var(--gold)}
.lang img{width:22px;height:22px;border-radius:50%;display:block}

/* The hero sits directly over the busiest part of the artwork — the table and the figures around
   it. A shadow buys back the contrast locally, which is cheaper than darkening the whole scene and
   losing the thing worth showing. */
.hero h1,.hero .lead,.hero .tagline{text-shadow:0 2px 10px rgba(8,5,3,.98),0 4px 30px rgba(8,5,3,.9),0 1px 3px rgba(8,5,3,.95)}
.hero{text-align:center;padding:26px 0 54px}
.hero .mark{width:min(148px,34vw);margin:0 auto 16px;display:block}
.hero h1{font-size:clamp(46px,11vw,92px);text-transform:uppercase;letter-spacing:.04em}
.tagline{color:var(--gold);letter-spacing:.22em;text-transform:uppercase;font-size:12px;margin:14px 0 0}
.lead{font-size:18px;color:var(--paper);opacity:.85;max-width:44ch;margin:22px auto 0}

/* The same key the game's home screen puts under your thumb: machine orange, lit from the top
   right, with the slab under it. Pressing sinks the cap down-left and thins the slab to match.
   Copied in behaviour rather than in class, because this page cannot import the app's stylesheet —
   the accent and the 52%/60% mixes are the ones in styles.css, so they stay one button. */
.cta{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;
  min-height:66px;padding:12px 44px;margin-top:32px;border-radius:14px;
  background:var(--accent);color:#1B120A;font-weight:800;font-size:19px;letter-spacing:.01em;
  border-bottom:6px solid color-mix(in srgb, var(--accent) 52%, #000);
  border-left:6px solid color-mix(in srgb, var(--accent) 60%, #000);
  box-shadow:inset 0 2px 0 color-mix(in srgb, #fff 26%, transparent), 0 12px 26px rgba(0,0,0,.45);
  transition:transform .09s ease, border-width .09s ease, box-shadow .09s ease}
.cta:hover{text-decoration:none;filter:brightness(1.04)}
.cta:active{transform:translate(-2px,2px);border-bottom-width:3px;border-left-width:3px;
  box-shadow:inset 0 2px 0 color-mix(in srgb, #fff 18%, transparent), 0 5px 12px rgba(0,0,0,.4)}
.cta small{display:block;font-weight:600;opacity:.72;font-size:12.5px;letter-spacing:0}
@media (prefers-reduced-motion: reduce){.cta{transition:none}.cta:active{transform:none}}

/* Real platform marks, sized to the same optical weight so neither shouts over the other. */
.stores{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:22px}
.store{display:inline-flex;align-items:center;gap:11px;border:1px solid var(--line);border-radius:14px;
  padding:10px 20px;background:rgba(0,0,0,.35);backdrop-filter:blur(6px);color:var(--paper);text-align:start}
.store:hover{border-color:var(--gold);text-decoration:none}
.store img{height:24px;width:auto;display:block}
.store b{display:block;font-size:15px;font-weight:600;line-height:1.2}
.store small{display:block;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.store[aria-disabled=true]{opacity:.5}
.store[aria-disabled=true]:hover{border-color:var(--line)}

.steps,.rules{background:rgba(10,7,5,.62);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);
  border:1px solid var(--line);border-radius:20px;padding:30px 26px}
.steps{display:grid;gap:26px;counter-reset:s;max-width:660px;margin:0 auto}
/* The guide is genuinely a sequence — you cannot claim before you know what a turn is — so the
   numbering carries information rather than decorating. */
.step{counter-increment:s;padding-inline-start:54px;position:relative}
.step::before{content:counter(s,decimal-leading-zero);position:absolute;inset-inline-start:0;top:-2px;
  font-family:Oswald,sans-serif;font-size:22px;color:var(--gold)}
.step p{margin:5px 0 0;color:var(--muted);font-size:16px}

.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}
.card{display:flex;gap:14px;align-items:flex-start;border:1px solid var(--line);border-radius:16px;
  padding:16px;background:rgba(0,0,0,.34);backdrop-filter:blur(6px)}
.card img{width:64px;border-radius:9px;flex:0 0 auto}
.card p{margin:5px 0 0;color:var(--muted);font-size:14.5px;line-height:1.5}

.rules{color:var(--paper);opacity:.92;max-width:660px;margin:0 auto}
.rules h2,.rules h3{margin-top:26px;margin-bottom:8px}
.rules ul,.rules ol{padding-inline-start:22px}
.rules li{margin:7px 0}

/* A page title needs air under it before its content starts — without this the steps panel's border
   sits directly against the heading. The +.lead reset stops the two margins stacking on pages where
   an intro paragraph comes between the title and the grid. */
section > h1{margin-bottom:30px}
section > h1 + .lead{margin-top:0;margin-bottom:26px}
.page{padding:10px 0 60px}
.page h1{font-size:clamp(32px,6vw,52px);text-transform:uppercase;letter-spacing:.03em;margin-bottom:10px}
.page .lead{margin-inline:0;text-align:start}
.center{text-align:center;margin-top:44px}

footer{border-top:1px solid var(--line);padding:24px 0 46px;color:var(--muted);font-size:14px;
  display:flex;gap:20px;flex-wrap:wrap;align-items:center}
footer .sp{margin-inline-start:auto}
`;

let ADS_CLIENT = '';

function shell(lang: Lang, o: { title: string; desc: string; canonical: string; body: string; alt: string; jsonLd?: object[]; ads?: boolean }) {
  const dir = lang === 'tn' ? 'rtl' : 'ltr';
  const c = COPY[lang];
  const base = lang === 'tn' ? '/ar' : '';
  return `<!doctype html>
<html lang="${lang === 'tn' ? 'ar' : 'en'}" dir="${dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.desc)}" />
<link rel="canonical" href="${SITE}${o.canonical}" />
<link rel="alternate" hreflang="en" href="${SITE}${o.alt.replace('{b}', '')}" />
<link rel="alternate" hreflang="ar" href="${SITE}${o.alt.replace('{b}', '/ar')}" />
<meta name="theme-color" content="#0E0B08" />
<meta name="robots" content="index,follow,max-image-preview:large" />
<meta property="og:site_name" content="ELMEKINA" />
<meta property="og:title" content="${esc(o.title)}" />
<meta property="og:description" content="${esc(o.desc)}" />
<meta property="og:image" content="${SITE}/img/og-image.png" />
<meta property="og:url" content="${SITE}${o.canonical}" />
<meta property="og:type" content="website" />
<meta property="og:locale" content="${lang === 'tn' ? 'ar_TN' : 'en_US'}" />
<meta property="og:locale:alternate" content="${lang === 'tn' ? 'en_US' : 'ar_TN'}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(o.title)}" />
<meta name="twitter:description" content="${esc(o.desc)}" />
<meta name="twitter:image" content="${SITE}/img/og-image.png" />
<link rel="icon" href="/img/favicon.png" />
${ADS_CLIENT && o.ads !== false ? `<meta name="google-adsense-account" content="${ADS_CLIENT}" />
<script async crossorigin="anonymous" src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADS_CLIENT}"></script>` : ''}
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600&family=Plus+Jakarta+Sans:wght@400;600;700;800&family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap" />
<style>${CSS}</style>
${(o.jsonLd || []).map((d) => `<script type="application/ld+json">${JSON.stringify(d)}</script>`).join('\n')}
</head>
<body dir="${dir}">
<div class="wrap">
  <nav class="top">
    <a class="brand" href="${base}/">ELMEKINA</a>
    <a href="${base}/how-to-play/">${esc(c.howTitle)}</a>
    <a href="${base}/characters/">${esc(c.charsTitle)}</a>
    <a class="lang" href="${c.otherHref}" title="${esc(c.other)}" aria-label="${esc(c.other)}"><img src="${lang === 'tn' ? '/img/icons/flag-en.svg' : '/img/icons/flag-tn.svg'}" alt="" width="22" height="22" /></a>
  </nav>
${o.body}
  <footer>
    <span>${esc(c.footer)}</span>
    <a class="sp" href="/privacy/">${esc(c.privacy)}</a>
    <a href="/play/">${esc(c.play)}</a>
  </footer>
</div>
<script>
/* The game boots from localStorage 'mekina.lang' (client/src/i18n.ts) and this site shares its
   origin, so the landing can hand its language over instead of the two disagreeing.
   Two different strengths on purpose:
   - the flag chip is an EXPLICIT choice, so it always writes;
   - the Play links only write when no choice exists yet — someone who set the game to Derja and
     later read the English rules page must not have their game silently flipped by clicking Play. */
(function () {
  var mine = '${lang === 'tn' ? 'tn' : 'en'}', other = '${lang === 'tn' ? 'en' : 'tn'}';
  var put = function (v, always) {
    try { if (always || !localStorage.getItem('mekina.lang')) localStorage.setItem('mekina.lang', v); } catch (e) { /* private mode */ }
  };
  document.querySelectorAll('a.lang').forEach(function (a) { a.addEventListener('click', function () { put(other, true); }); });
  document.querySelectorAll('a[href="/play/"]').forEach(function (a) { a.addEventListener('click', function () { put(mine, false); }); });
})();
</script>
</body>
</html>`;
}

/**
 * Structured data.
 *
 * Not decoration: the page tells a crawler in prose that this is a bluffing card game for 2-6
 * players, and this tells it the same thing in a form it does not have to infer. It is also part of
 * reading as a real publisher rather than an app shell with ads on it — which is the finding this
 * whole site exists to answer.
 *
 * Everything here is drawn from the page's own visible content. Marking up claims a visitor cannot
 * see is precisely the kind of thing that earns a manual action.
 */
/**
 * One suspect card. Both pages call this.
 *
 * The image and the TEXT BLOCK are the two flex children — the heading and the blurb must be
 * wrapped together. Written out twice, they drifted: the characters page had img, h3 and p as three
 * siblings in a row, so the name sat BESIDE the description instead of above it.
 */
function charCard(lang: Lang, id: string, size: number) {
  return `<div class="card"><img src="/img/cards/${id}-sm.webp" alt="${esc(charName(lang, id))}" width="${size}" loading="lazy" />`
       + `<div><h3>${esc(charName(lang, id))}</h3><p>${esc(T(lang, `char.blurb.${id}`))}</p></div></div>`;
}

function gameSchema(lang: Lang) {
  const c = COPY[lang];
  const base = lang === 'tn' ? '/ar' : '';
  // sameAs only once a listing exists — pointing at a store page that 404s is worse than silence.
  const sameAs = [STORES.android, STORES.ios].filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: 'ELMEKINA',
    alternateName: ['ELMAKINA', 'Mekina', 'الماكينة'],
    url: `${SITE}${base}/`,
    description: c.lead,
    image: `${SITE}/img/og-image.png`,
    inLanguage: lang === 'tn' ? 'ar-TN' : 'en',
    genre: ['Card game', 'Party game', 'Social deduction'],
    applicationCategory: 'GameApplication',
    gamePlatform: ['Web browser', 'Android'],
    operatingSystem: 'Any',
    playMode: ['MultiPlayer', 'SinglePlayer'],
    numberOfPlayers: { '@type': 'QuantitativeValue', minValue: 2, maxValue: 6 },
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
    ...(sameAs.length ? { sameAs } : {}),
  };
}

/** The guide, as the sequence it already is on the page. */
function howToSchema(lang: Lang) {
  const c = COPY[lang];
  const base = lang === 'tn' ? '/ar' : '';
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: c.howTitle,
    description: c.lead,
    inLanguage: lang === 'tn' ? 'ar-TN' : 'en',
    url: `${SITE}${base}/how-to-play/`,
    step: GUIDE.map((k, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: T(lang, `guide.${k}.t`),
      text: T(lang, `guide.${k}.b`),
    })),
  };
}

/** Where a page sits, so a result can show the path rather than a bare URL. */
function crumbs(lang: Lang, title: string, path: string) {
  const base = lang === 'tn' ? '/ar' : '';
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ELMEKINA', item: `${SITE}${base}/` },
      { '@type': 'ListItem', position: 2, name: title, item: `${SITE}${base}${path}` },
    ],
  };
}

function storeButtons(lang: Lang) {
  const c = COPY[lang];
  const one = (href: string, logo: string, name: string) => {
    const inner = `<img src="${logo}" alt="" /><span><small>${esc(href ? c.getOn : c.soon)}</small><b>${esc(name)}</b></span>`;
    return href ? `<a class="store" href="${href}">${inner}</a>`
                : `<span class="store" aria-disabled="true">${inner}</span>`;
  };
  return `<div class="stores">
      ${one(STORES.android, '/img/stores/Google_Play_2016_icon.svg.webp', 'Google Play')}
      ${one(STORES.ios, '/img/stores/new-Apple-logo-white-png-large-size.png', 'App Store')}
    </div>`;
}

function landing(lang: Lang) {
  const c = COPY[lang];
  const base = lang === 'tn' ? '/ar' : '';
  const steps = GUIDE.map((k) => `          <div class="step"><h3>${esc(T(lang, `guide.${k}.t`))}</h3><p>${esc(T(lang, `guide.${k}.b`))}</p></div>`).join('\n');
  const chars = CHARACTERS.map((id) => '          ' + charCard(lang, id, 64)).join('\n');
  const rules = T(lang, 'rules.html').replace('{cards}', '');
  // No tabbed sections here. The landing is the door: the mark, what the game is, and the way in.
  // Everything it used to hold lives at /how-to-play/ and /characters/, reachable from the header.
  //
  // ADS ARE OFF ON THIS PAGE, deliberately. Without those sections the hero is 387 characters —
  // the same order as the 453-character shell AdSense flagged for "ads on a page without publisher
  // content". The ads stay on the pages that carry the writing. Set ads back to true here only if
  // this page grows real content again.
  const body = `  <header class="hero">
    <img class="mark" src="/img/machine-sm.webp" alt="${esc(c.markAlt)}" width="148" />
    <h1>ELMEKINA</h1>
    <p class="tagline">${T(lang, 'home.tagline')}</p>
    <p class="lead">${esc(c.lead)}</p>
    <a class="cta" href="/play/">${esc(c.play)}<small>${esc(c.playSub)}</small></a>
    ${storeButtons(lang)}
  </header>`;
  return shell(lang, { title: c.siteTitle, desc: c.lead, canonical: `${base}/`, body, alt: '{b}/', ads: false, jsonLd: [gameSchema(lang), howToSchema(lang)] });
}

function howToPlay(lang: Lang) {
  const c = COPY[lang];
  const base = lang === 'tn' ? '/ar' : '';
  const steps = GUIDE.map((k) => `      <div class="step"><h3>${esc(T(lang, `guide.${k}.t`))}</h3><p>${esc(T(lang, `guide.${k}.b`))}</p></div>`).join('\n');
  // rules.html is authored HTML in the string table — rendered, not escaped. The {cards} token is a
  // placeholder the game fills with card art; on the page it becomes a link to the dossier instead.
  const rules = T(lang, 'rules.html').replace('{cards}', `<p><a href="${base}/characters/">${esc(c.charsTitle)} →</a></p>`);
  const body = `  <section>
    <h1 style="font-size:clamp(30px,5vw,46px)">${esc(c.howTitle)}</h1>
    <div class="steps">
${steps}
    </div>
  </section>
  <section>
    <h2>${esc(c.rulesTitle)}</h2>
    <div class="rules">${rules}</div>
    <p style="margin-top:26px"><a class="cta" href="/play/">${esc(c.play)}</a></p>
  </section>`;
  return shell(lang, { title: `${c.howTitle} — ELMEKINA`, desc: `${c.howTitle} — ${c.lead}`, canonical: `${base}/how-to-play/`, body, alt: '{b}/how-to-play/', jsonLd: [howToSchema(lang), crumbs(lang, c.howTitle, '/how-to-play/')] });
}

function characters(lang: Lang) {
  const c = COPY[lang];
  const cards = CHARACTERS.map((id) => '    ' + charCard(lang, id, 76)).join('\n');
  const base = lang === 'tn' ? '/ar' : '';
  const body = `  <section>
    <h1 style="font-size:clamp(30px,5vw,46px)">${esc(c.charsTitle)}</h1>
    <p class="lead">${esc(c.charsLead)}</p>
    <div class="grid">
${cards}
    </div>
    <p style="margin-top:26px"><a class="cta" href="/play/">${esc(c.play)}</a></p>
  </section>`;
  return shell(lang, { title: `${c.charsTitle} — ELMEKINA`, desc: c.charsLead, canonical: `${base}/characters/`, body, alt: '{b}/characters/', jsonLd: [crumbs(lang, c.charsTitle, '/characters/')] });
}

/**
 * Emit the site and move the game to /play.
 *
 * Vite writes the SPA as dist/index.html; that becomes dist/play/index.html and the landing page
 * takes its place. Assets are referenced absolutely (/assets/...), so the move costs nothing.
 */
export function buildPages(dist: string, adsClient = '') {
  // Ads belong on the pages that HAVE content. That was the whole finding: the loader sat on a
  // page with an empty <div id="root"> while every word of real writing lived somewhere a crawler
  // could not reach.
  ADS_CLIENT = adsClient;
  const spa = path.join(dist, 'index.html');
  if (fs.existsSync(spa)) {
    fs.mkdirSync(path.join(dist, 'play'), { recursive: true });
    fs.renameSync(spa, path.join(dist, 'play', 'index.html'));
  }
  fs.mkdirSync(path.join(dist, 'ar'), { recursive: true });

  const pages: [string, string][] = [
    ['index.html', landing('en')],
    ['how-to-play/index.html', howToPlay('en')],
    ['characters/index.html', characters('en')],
    ['ar/index.html', landing('tn')],
    ['ar/how-to-play/index.html', howToPlay('tn')],
    ['ar/characters/index.html', characters('tn')],
  ];
  // Directory + index.html, so the URL is /how-to-play/ with no extension. Every static host
  // resolves a directory index, so nothing else is needed to serve it.
  for (const [rel, html] of pages) {
    const out = path.join(dist, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html);
  }

  // The sitemap is generated from the same list, so a new page can never be forgotten in it.
  const today = new Date().toISOString().slice(0, 10);
  const urls = ['/', '/how-to-play/', '/characters/', '/ar/', '/ar/how-to-play/', '/ar/characters/', '/play/', '/privacy/'];
  fs.writeFileSync(path.join(dist, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${SITE}${u}</loc><lastmod>${today}</lastmod><priority>${u === '/' ? '1.0' : u === '/play' ? '0.9' : '0.6'}</priority></url>`).join('\n') +
    `\n</urlset>\n`);

  return pages.length;
}
