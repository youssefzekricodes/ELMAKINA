/* ELMAKINA client — vanilla JS. Talks to the authoritative server over Socket.IO.
   Rendering is keyed/incremental so animations aren't reset on every state message.
   All user-facing text goes through I18N.t() (en / Tunisian). */
(() => {
  'use strict';
  const THEME = window.MEKINA_THEME;
  const I18N = window.MEKINA_I18N;
  const t = I18N.t;
  const CH = THEME.characters;
  const IMG = THEME.img;
  const CHARACTERS = ['taxman', 'businesswoman', 'police', 'terrorist', 'colonel', 'politician', 'thief'];
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ───────── state ─────────
  let socket = null, room = null, state = null, me = null, clockOffset = 0;
  const ui = { targeting: null, targetId: null, lastLogId: 0, lastEventId: null, logOpen: false, unread: 0, promptKey: '', handKey: '', consoleKey: '', seatsKey: '', turnSeen: null };
  const session = {
    load() { try { return JSON.parse(localStorage.getItem('mekina.session') || 'null'); } catch { return null; } },
    save(s) { localStorage.setItem('mekina.session', JSON.stringify(s)); },
    clear() { localStorage.removeItem('mekina.session'); },
  };
  // ───────── profile (avatar + background colour) ─────────
  const DEFAULT_AVATARS = ['boy-1', 'boy-2', 'boy-3', 'boy-4', 'boy-5', 'boy-6', 'girl-1', 'girl-2', 'girl-3', 'girl-4', 'girl-5', 'girl-6'];
  const PALETTE = CHARACTERS.map(c => ({ color: CH[c].color.toLowerCase(), name: c }));
  const profile = (() => { try { return Object.assign({ avatar: 'boy-1', avatarData: null, color: null }, JSON.parse(localStorage.getItem('mekina.profile') || '{}')); } catch { return { avatar: 'boy-1', avatarData: null, color: null }; } })();
  const saveProfile = () => localStorage.setItem('mekina.profile', JSON.stringify(profile));
  const customAvatars = {}; // playerId -> data URL (from room payloads)
  const avatarSrc = (p) => p && p.avatar === 'custom' ? (customAvatars[p.id] || p.avatarData || '') : `img/avatars/${(p && p.avatar) || 'boy-1'}.webp`;
  const avatarHtml = (p, size = '') => `<span class="avatar ${size}" style="--bg:${(p && p.color) || '#6b5d45'}"><img src="${avatarSrc(p)}" alt="" draggable="false" /></span>`;
  const myProfilePreview = () => ({ id: me, avatar: profile.avatar, avatarData: profile.avatarData, color: profile.color });

  const ACTIONS = [
    { type: 'income', cost: 0, kind: 'default' },
    { type: 'loan', cost: 0, kind: 'default' },
    { type: 'paidkill', cost: 7, kind: 'default', target: 'others' },
    { type: 'businesswoman', cost: 0, kind: 'claim' },
    { type: 'taxman', cost: 0, kind: 'claim', target: 'rich' },
    { type: 'police', cost: 0, kind: 'claim', target: 'any' },
    { type: 'terrorist', cost: 3, kind: 'claim', target: 'others' },
    { type: 'colonel', cost: 4, kind: 'claim', target: 'others' },
    { type: 'politician', cost: 0, kind: 'claim' },
    { type: 'thief', cost: 0, kind: 'claim', target: 'coins' },
  ];
  const actionName = (type) => CH[type] ? I18N.charName(type) : t(`action.${type}.name`);
  const actionDesc = (type) => t(`action.${type}.desc`);
  // Inline icons for the default (non-character) actions
  const ICONS = {
      "income": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M6 9H10\" opacity=\".5\"/><path d=\"M20.8333 10H18.2308C16.4465 10 15 11.3431 15 13C15 14.6569 16.4465 16 18.2308 16H20.8333C20.9167 16 20.9583 16 20.9935 15.9979C21.5328 15.965 21.9623 15.5662 21.9977 15.0654C22 15.0327 22 14.994 22 14.9167V11.0833C22 11.006 22 10.9673 21.9977 10.9346C21.9623 10.4338 21.5328 10.035 20.9935 10.0021C20.9583 10 20.9167 10 20.8333 10Z\"/><path d=\"M20.965 10C20.8873 8.1277 20.6366 6.97975 19.8284 6.17157C18.6569 5 16.7712 5 13 5H10C6.22876 5 4.34315 5 3.17157 6.17157C2 7.34315 2 9.22876 2 13C2 16.7712 2 18.6569 3.17157 19.8284C4.34315 21 6.22876 21 10 21H13C16.7712 21 18.6569 21 19.8284 19.8284C20.6366 19.0203 20.8873 17.8723 20.965 16\"/><path stroke-linecap=\"round\" d=\"M6 5L9.73549 2.52313C10.7874 1.82562 12.2126 1.82562 13.2645 2.52313L17 5\" opacity=\".5\"/><path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M17.991 13H18\" opacity=\".5\"/></g></svg>",
      "loan": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M2 10C2 7.17157 2 5.75736 2.87868 4.87868C3.75736 4 5.17157 4 8 4H13C15.8284 4 17.2426 4 18.1213 4.87868C19 5.75736 19 7.17157 19 10C19 12.8284 19 14.2426 18.1213 15.1213C17.2426 16 15.8284 16 13 16H8C5.17157 16 3.75736 16 2.87868 15.1213C2 14.2426 2 12.8284 2 10Z\"/><path d=\"M19.0003 7.07617C19.9754 7.17208 20.6317 7.38885 21.1216 7.87873C22.0003 8.75741 22.0003 10.1716 22.0003 13.0001C22.0003 15.8285 22.0003 17.2427 21.1216 18.1214C20.2429 19.0001 18.8287 19.0001 16.0003 19.0001H11.0003C8.17187 19.0001 6.75766 19.0001 5.87898 18.1214C5.38909 17.6315 5.17233 16.9751 5.07642 16\" opacity=\".5\"/><path d=\"M13 10C13 11.3807 11.8807 12.5 10.5 12.5C9.11929 12.5 8 11.3807 8 10C8 8.61929 9.11929 7.5 10.5 7.5C11.8807 7.5 13 8.61929 13 10Z\"/><path stroke-linecap=\"round\" d=\"M16 12L16 8\" opacity=\".5\"/><path stroke-linecap=\"round\" d=\"M5 12L5 8\" opacity=\".5\"/></g></svg>",
      "paidkill": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12Z\"/><path stroke-linecap=\"round\" d=\"M2 12L5 12\" opacity=\".5\"/><path stroke-linecap=\"round\" d=\"M19 12L22 12\" opacity=\".5\"/><path stroke-linecap=\"round\" d=\"M12 22L12 19\" opacity=\".5\"/><path stroke-linecap=\"round\" d=\"M12 5L12 2\" opacity=\".5\"/><path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M12 12H10M12 12H14M12 12V14M12 12L12 10\"/></g></svg>"
  };

  // ───────── helpers ─────────
  const now = () => Date.now() + clockOffset;
  const pl = (id) => state && state.players.find(p => p.id === id);
  const pname = (id) => (pl(id) || {}).name || '?';
  const cname = (c) => I18N.charName(c);
  const pad2 = (n) => String(n).padStart(2, '0');
  function toast(msg, ok = false) {
    const el = $('#toast'); el.textContent = msg; el.className = 'toast' + (ok ? ' ok' : '');
    clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.add('hidden'), 2600);
  }
  function emit(ev, data) {
    sfx.play('click');
    return new Promise((resolve) => socket.emit(ev, data || {}, (res) => {
      if (res && res.ok === false) { toast(I18N.err(res.error || t('toast.error'))); sfx.play('error'); }
      resolve(res || {});
    }));
  }
  const coinHtml = (n, cls = '') => `<span class="coins ${cls}"><img src="${IMG.coin}" alt="" /><span class="n">${n}</span></span>`;
  function cardHtml(c, opts = {}) {
    const th = CH[c];
    return `<div class="card ${opts.cls || 'w96'} ${opts.pick ? 'pick' : ''} ${opts.anim ? 'in' : ''}" ${opts.attrs || ''} title="${esc(t('char.blurb.' + c))}"><img src="${th ? (opts.small ? th.cardSm : th.card) : ''}" alt="${esc(cname(c))}" draggable="false" /></div>`;
  }
  // Log icons: Solar Icons (line-duotone) by 480 Design, CC BY 4.0 — via Iconify
  const LOG_ICONS = {
      "claim": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M16.7582 12.6766L15.9131 9.37926C15.4725 7.66038 15.2522 6.80094 14.677 6.36888C14.4841 6.22403 14.268 6.11656 14.0388 6.05159C13.3551 5.85777 12.5782 6.22163 11.0242 6.94934C9.87347 7.48822 9.29811 7.75765 8.69774 7.94822C8.48901 8.01448 8.27824 8.07352 8.06578 8.12524C7.4547 8.27402 6.82756 8.34142 5.57328 8.47622C3.87945 8.65827 3.03253 8.74929 2.53319 9.27447C2.36579 9.45054 2.22999 9.6566 2.13226 9.88284C1.84073 10.5577 2.06102 11.4171 2.50159 13.136L3.34673 16.4334C4.34019 20.3093 7.64328 21.5286 9.86292 21.9058C10.5401 22.0208 10.8787 22.0784 11.907 21.7903C12.9353 21.5023 13.201 21.2755 13.7324 20.8219C15.4742 19.335 17.7517 16.5526 16.7582 12.6766Z\"/><path d=\"M16.5 17.221C18.2412 16.4706 19.9791 15.0638 20.6533 12.4334L21.4984 9.13602C21.939 7.41713 22.1593 6.55769 21.8678 5.88284C21.77 5.6566 21.6342 5.45054 21.4668 5.27447C20.9675 4.74929 20.1206 4.65827 18.4267 4.47622C17.1725 4.34142 16.5453 4.27402 15.9342 4.12524C15.7218 4.07352 15.511 4.01448 15.3023 3.94822C14.7019 3.75765 14.1266 3.48822 12.9758 2.94934C11.4219 2.22163 10.6449 1.85777 9.96126 2.05159C9.73208 2.11656 9.51592 2.22403 9.32307 2.36888C8.74783 2.80094 8.52754 3.66038 8.08698 5.37926L7.38745 8.10846\" opacity=\".5\"/><path stroke-linecap=\"round\" d=\"M5.25882 13.2955C5.31893 12.6763 5.77997 12.1206 6.44889 11.9414C7.11781 11.7621 7.79491 12.0128 8.1566 12.5191\"/><path stroke-linecap=\"round\" d=\"M19.1797 8.93565C19.1195 8.3164 18.6585 7.76073 17.9896 7.5815C17.3207 7.40226 16.6436 7.65296 16.2819 8.1592\" opacity=\".5\"/><path stroke-linecap=\"round\" d=\"M11.0547 11.7423C11.1148 11.123 11.5759 10.5674 12.2448 10.3881C12.9137 10.2089 13.5908 10.4596 13.9525 10.9658\"/><path stroke-linecap=\"round\" d=\"M10.4861 6.60592C10.8477 6.09969 11.5248 5.84899 12.1938 6.02823C12.3417 6.06797 12.5079 6.17169 12.5781 6.24219\" opacity=\".5\"/><path stroke-linecap=\"round\" d=\"M13.2007 16.231C13.2007 16.231 12.1758 15.4703 10.3884 15.9492C8.60094 16.4282 8.09372 17.5994 8.09372 17.5994\"/></g></svg>",
      "action": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M10.8613 3.36335C11.3679 2.45445 11.6213 2 12 2C12.3787 2 12.6321 2.45445 13.1387 3.36335L13.2698 3.59849C13.4138 3.85677 13.4858 3.98591 13.598 4.07112C13.7103 4.15633 13.8501 4.18796 14.1296 4.25122L14.3842 4.30881C15.3681 4.53142 15.86 4.64273 15.977 5.01909C16.0941 5.39546 15.7587 5.78763 15.088 6.57197L14.9144 6.77489C14.7238 6.99777 14.6285 7.10922 14.5857 7.24709C14.5428 7.38496 14.5572 7.53364 14.586 7.83102L14.6122 8.10176C14.7136 9.14824 14.7644 9.67148 14.4579 9.90409C14.1515 10.1367 13.6909 9.92462 12.7697 9.50047L12.5314 9.39073C12.2696 9.2702 12.1387 9.20994 12 9.20994C11.8613 9.20994 11.7304 9.2702 11.4686 9.39073L11.2303 9.50047C10.3091 9.92462 9.84847 10.1367 9.54206 9.90409C9.23565 9.67148 9.28635 9.14824 9.38776 8.10176L9.41399 7.83102C9.44281 7.53364 9.45722 7.38496 9.41435 7.24709C9.37147 7.10922 9.27617 6.99777 9.08557 6.77489L8.91204 6.57197C8.2413 5.78763 7.90593 5.39546 8.02297 5.01909C8.14001 4.64273 8.63194 4.53142 9.61581 4.30881L9.87035 4.25122C10.1499 4.18796 10.2897 4.15633 10.402 4.07112C10.5142 3.98591 10.5862 3.85677 10.7302 3.59849L10.8613 3.36335Z\"/><path d=\"M19.4306 7.68168C19.684 7.22723 19.8106 7 20 7C20.1894 7 20.316 7.22722 20.5694 7.68167L20.6349 7.79925C20.7069 7.92839 20.7429 7.99296 20.799 8.03556C20.8551 8.07817 20.925 8.09398 21.0648 8.12561L21.1921 8.15441C21.684 8.26571 21.93 8.32136 21.9885 8.50955C22.047 8.69773 21.8794 8.89381 21.544 9.28598L21.4572 9.38744C21.3619 9.49889 21.3143 9.55461 21.2928 9.62354C21.2714 9.69248 21.2786 9.76682 21.293 9.91551L21.3061 10.0509C21.3568 10.5741 21.3822 10.8357 21.229 10.952C21.0758 11.0683 20.8455 10.9623 20.3849 10.7502L20.2657 10.6954C20.1348 10.6351 20.0694 10.605 20 10.605C19.9306 10.605 19.8652 10.6351 19.7343 10.6954L19.6151 10.7502C19.1545 10.9623 18.9242 11.0683 18.771 10.952C18.6178 10.8357 18.6432 10.5741 18.6939 10.0509L18.707 9.91551C18.7214 9.76682 18.7286 9.69248 18.7072 9.62354C18.6857 9.55461 18.6381 9.49889 18.5428 9.38744L18.456 9.28599C18.1206 8.89381 17.953 8.69773 18.0115 8.50955C18.07 8.32136 18.316 8.26571 18.8079 8.15441L18.9352 8.12561C19.075 8.09398 19.1449 8.07817 19.201 8.03556C19.2571 7.99296 19.2931 7.92839 19.3651 7.79925L19.4306 7.68168Z\"/><path d=\"M3.43063 7.68168C3.68396 7.22723 3.81063 7 4 7C4.18937 7 4.31604 7.22722 4.56937 7.68167L4.63491 7.79925C4.7069 7.92839 4.74289 7.99296 4.79901 8.03556C4.85513 8.07817 4.92503 8.09398 5.06482 8.12561L5.19209 8.15441C5.68403 8.26571 5.93 8.32136 5.98852 8.50955C6.04704 8.69773 5.87935 8.89381 5.54398 9.28598L5.45722 9.38744C5.36191 9.49889 5.31426 9.55461 5.29283 9.62354C5.27139 9.69248 5.27859 9.76682 5.293 9.91551L5.30612 10.0509C5.35682 10.5741 5.38218 10.8357 5.22897 10.952C5.07576 11.0683 4.84547 10.9623 4.38487 10.7502L4.2657 10.6954C4.13481 10.6351 4.06937 10.605 4 10.605C3.93063 10.605 3.86519 10.6351 3.7343 10.6954L3.61513 10.7502C3.15454 10.9623 2.92424 11.0683 2.77103 10.952C2.61782 10.8357 2.64318 10.5741 2.69388 10.0509L2.707 9.91551C2.72141 9.76682 2.72861 9.69248 2.70717 9.62354C2.68574 9.55461 2.63809 9.49889 2.54278 9.38744L2.45602 9.28599C2.12065 8.89381 1.95296 8.69773 2.01148 8.50955C2.07 8.32136 2.31597 8.26571 2.80791 8.15441L2.93518 8.12561C3.07497 8.09398 3.14487 8.07817 3.20099 8.03556C3.25711 7.99296 3.29311 7.92839 3.36509 7.79925L3.43063 7.68168Z\"/><path stroke-linecap=\"round\" d=\"M4 21.3884H6.25993C7.27079 21.3884 8.29253 21.4937 9.27633 21.6964C11.0166 22.0549 12.8488 22.0983 14.6069 21.8138C15.4738 21.6734 16.326 21.4589 17.0975 21.0865C17.7939 20.7504 18.6469 20.2766 19.2199 19.7459C19.7921 19.216 20.388 18.3487 20.8109 17.6707C21.1736 17.0894 20.9982 16.3762 20.4245 15.943C19.7873 15.4619 18.8417 15.462 18.2046 15.9433L16.3974 17.3084C15.697 17.8375 14.932 18.3245 14.0206 18.4699C13.911 18.4874 13.7962 18.5033 13.6764 18.5172M11.7518 18.5326C12.4312 18.5968 13.0434 18.5829 13.5668 18.5292C13.6038 18.5254 13.6403 18.5214 13.6764 18.5172M13.6764 18.5172C13.8222 18.486 13.9669 18.396 14.1028 18.2775C14.746 17.7161 14.7866 16.77 14.2285 16.1431C14.0991 15.9977 13.9475 15.8764 13.7791 15.7759C10.9817 14.1074 6.62942 15.3782 4 17.2429M13.6764 18.5172C13.6399 18.525 13.6033 18.5292 13.5668 18.5292\" opacity=\".5\"/></g></svg>",
      "coins": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M9 19C6.19108 19 4.78661 19 3.77772 18.3259C3.34096 18.034 2.96596 17.659 2.67412 17.2223C2 16.2134 2 14.8089 2 12C2 9.19108 2 7.78661 2.67412 6.77772C2.96596 6.34096 3.34096 5.96596 3.77772 5.67412C4.78661 5 6.19108 5 9 5L15 5C17.8089 5 19.2134 5 20.2223 5.67412C20.659 5.96596 21.034 6.34096 21.3259 6.77772C22 7.78661 22 9.19108 22 12C22 14.8089 22 16.2134 21.3259 17.2223C21.034 17.659 20.659 18.034 20.2223 18.3259C19.2134 19 17.8089 19 15 19H9Z\"/><path d=\"M9 9C7.34315 9 6 10.3431 6 12C6 13.6569 7.34315 15 9 15\" opacity=\".5\"/><path d=\"M15 9C16.6569 9 18 10.3431 18 12C18 13.6569 16.6569 15 15 15\" opacity=\".5\"/><path stroke-linecap=\"round\" d=\"M9 5V18.5\"/><path stroke-linecap=\"round\" d=\"M15 5V18.5\"/></g></svg>",
      "challenge": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M5.31171 10.7615C8.23007 5.58716 9.68925 3 12 3C14.3107 3 15.7699 5.58716 18.6883 10.7615L19.0519 11.4063C21.4771 15.7061 22.6897 17.856 21.5937 19.428C20.4978 21 17.7864 21 12.3637 21H11.6363C6.21356 21 3.50217 21 2.40626 19.428C1.31034 17.856 2.52291 15.7061 4.94805 11.4063L5.31171 10.7615Z\" opacity=\".5\"/><path stroke-linecap=\"round\" d=\"M12 8V13\"/><path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M12 16H12.0001\"/></g></svg>",
      "block": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M3 10.4167C3 7.21907 3 5.62028 3.37752 5.08241C3.75503 4.54454 5.25832 4.02996 8.26491 3.00079L8.83772 2.80472C10.405 2.26824 11.1886 2 12 2C12.8114 2 13.595 2.26824 15.1623 2.80472L15.7351 3.00079C18.7417 4.02996 20.245 4.54454 20.6225 5.08241C21 5.62028 21 7.21907 21 10.4167C21 10.8996 21 11.4234 21 11.9914C21 17.6294 16.761 20.3655 14.1014 21.5273C13.38 21.8424 13.0193 22 12 22C10.9807 22 10.62 21.8424 9.89856 21.5273C7.23896 20.3655 3 17.6294 3 11.9914C3 11.4234 3 10.8996 3 10.4167Z\" opacity=\".5\"/><path stroke-linecap=\"round\" d=\"M3 11L12 8L21 11\"/><path stroke-linecap=\"round\" d=\"M12 2V21.5\"/></g></svg>",
      "loss": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-width=\"1.5\"><path d=\"M9.17065 4C9.58249 2.83481 10.6937 2 11.9999 2C13.3062 2 14.4174 2.83481 14.8292 4\" opacity=\".5\"/><path d=\"M20.5001 6H3.5\"/><path d=\"M18.8334 8.5L18.3735 15.3991C18.1965 18.054 18.108 19.3815 17.243 20.1907C16.378 21 15.0476 21 12.3868 21H11.6134C8.9526 21 7.6222 21 6.75719 20.1907C5.89218 19.3815 5.80368 18.054 5.62669 15.3991L5.16675 8.5\"/><path d=\"M9.5 11L10 16\" opacity=\".5\"/><path d=\"M14.5 11L14 16\" opacity=\".5\"/></g></svg>",
      "eliminated": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><g fill=\"none\" stroke=\"currentColor\"><path stroke-width=\"1.5\" d=\"M22 19.723V12.3006C22 6.61173 17.5228 2 12 2C6.47715 2 2 6.61173 2 12.3006V19.723C2 21.0453 3.35098 21.9054 4.4992 21.314C5.42726 20.836 6.5328 20.9069 7.39614 21.4998C8.36736 22.1667 9.63264 22.1667 10.6039 21.4998L10.9565 21.2576C11.5884 20.8237 12.4116 20.8237 13.0435 21.2576L13.3961 21.4998C14.3674 22.1667 15.6326 22.1667 16.6039 21.4998C17.4672 20.9069 18.5727 20.836 19.5008 21.314C20.649 21.9054 22 21.0453 22 19.723Z\" opacity=\".5\"/><path d=\"M15.5 10.5C15.5 11.0523 15.2761 11.5 15 11.5C14.7239 11.5 14.5 11.0523 14.5 10.5C14.5 9.94772 14.7239 9.5 15 9.5C15.2761 9.5 15.5 9.94772 15.5 10.5Z\"/><ellipse cx=\"9\" cy=\"10.5\" rx=\".5\" ry=\"1\"/></g></svg>",
      "reveal": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M3.27489 15.2957C2.42496 14.1915 2 13.6394 2 12C2 10.3606 2.42496 9.80853 3.27489 8.70433C4.97196 6.49956 7.81811 4 12 4C16.1819 4 19.028 6.49956 20.7251 8.70433C21.575 9.80853 22 10.3606 22 12C22 13.6394 21.575 14.1915 20.7251 15.2957C19.028 17.5004 16.1819 20 12 20C7.81811 20 4.97196 17.5004 3.27489 15.2957Z\" opacity=\".5\"/><path d=\"M15 12C15 13.6569 13.6569 15 12 15C10.3431 15 9 13.6569 9 12C9 10.3431 10.3431 9 12 9C13.6569 9 15 10.3431 15 12Z\"/></g></svg>",
      "system": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M13.7654 2.15224C13.3978 2 12.9319 2 12 2C11.0681 2 10.6022 2 10.2346 2.15224C9.74457 2.35523 9.35522 2.74458 9.15223 3.23463C9.05957 3.45834 9.0233 3.7185 9.00911 4.09799C8.98826 4.65568 8.70226 5.17189 8.21894 5.45093C7.73564 5.72996 7.14559 5.71954 6.65219 5.45876C6.31645 5.2813 6.07301 5.18262 5.83294 5.15102C5.30704 5.08178 4.77518 5.22429 4.35436 5.5472C4.03874 5.78938 3.80577 6.1929 3.33983 6.99993C2.87389 7.80697 2.64092 8.21048 2.58899 8.60491C2.51976 9.1308 2.66227 9.66266 2.98518 10.0835C3.13256 10.2756 3.3397 10.437 3.66119 10.639C4.1338 10.936 4.43789 11.4419 4.43786 12C4.43783 12.5581 4.13375 13.0639 3.66118 13.3608C3.33965 13.5629 3.13248 13.7244 2.98508 13.9165C2.66217 14.3373 2.51966 14.8691 2.5889 15.395C2.64082 15.7894 2.87379 16.193 3.33973 17C3.80568 17.807 4.03865 18.2106 4.35426 18.4527C4.77508 18.7756 5.30694 18.9181 5.83284 18.8489C6.07289 18.8173 6.31632 18.7186 6.65204 18.5412C7.14547 18.2804 7.73556 18.27 8.2189 18.549C8.70224 18.8281 8.98826 19.3443 9.00911 19.9021C9.02331 20.2815 9.05957 20.5417 9.15223 20.7654C9.35522 21.2554 9.74457 21.6448 10.2346 21.8478C10.6022 22 11.0681 22 12 22C12.9319 22 13.3978 22 13.7654 21.8478C14.2554 21.6448 14.6448 21.2554 14.8477 20.7654C14.9404 20.5417 14.9767 20.2815 14.9909 19.902C15.0117 19.3443 15.2977 18.8281 15.781 18.549C16.2643 18.2699 16.8544 18.2804 17.3479 18.5412C17.6836 18.7186 17.927 18.8172 18.167 18.8488C18.6929 18.9181 19.2248 18.7756 19.6456 18.4527C19.9612 18.2105 20.1942 17.807 20.6601 16.9999C21.1261 16.1929 21.3591 15.7894 21.411 15.395C21.4802 14.8691 21.3377 14.3372 21.0148 13.9164C20.8674 13.7243 20.6602 13.5628 20.3387 13.3608C19.8662 13.0639 19.5621 12.558 19.5621 11.9999C19.5621 11.4418 19.8662 10.9361 20.3387 10.6392C20.6603 10.4371 20.8675 10.2757 21.0149 10.0835C21.3378 9.66273 21.4803 9.13087 21.4111 8.60497C21.3592 8.21055 21.1262 7.80703 20.6602 7C20.1943 6.19297 19.9613 5.78945 19.6457 5.54727C19.2249 5.22436 18.693 5.08185 18.1671 5.15109C17.9271 5.18269 17.6837 5.28136 17.3479 5.4588C16.8545 5.71959 16.2644 5.73002 15.7811 5.45096C15.2977 5.17191 15.0117 4.65566 14.9909 4.09794C14.9767 3.71848 14.9404 3.45833 14.8477 3.23463C14.6448 2.74458 14.2554 2.35523 13.7654 2.15224Z\" opacity=\".5\"/></g></svg>",
      "win": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M12.0002 16C6.24021 16 5.21983 10.2595 5.03907 5.70647C4.98879 4.43998 4.96365 3.80673 5.43937 3.22083C5.91508 2.63494 6.48445 2.53887 7.62318 2.34674C8.74724 2.15709 10.2166 2 12.0002 2C13.7837 2 15.2531 2.15709 16.3771 2.34674C17.5159 2.53887 18.0852 2.63494 18.5609 3.22083C19.0367 3.80673 19.0115 4.43998 18.9612 5.70647C18.7805 10.2595 17.7601 16 12.0002 16Z\"/><path stroke-linecap=\"round\" d=\"M12 16V19\" opacity=\".5\"/><path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M15.5 22H8.5L8.83922 20.3039C8.93271 19.8365 9.34312 19.5 9.8198 19.5H14.1802C14.6569 19.5 15.0673 19.8365 15.1608 20.3039L15.5 22Z\"/><path d=\"M19 5L19.9486 5.31621C20.9387 5.64623 21.4337 5.81124 21.7168 6.20408C22 6.59692 22 7.11873 21.9999 8.16234L21.9999 8.23487C21.9999 9.09561 21.9999 9.52598 21.7927 9.87809C21.5855 10.2302 21.2093 10.4392 20.4569 10.8572L17.5 12.5\" opacity=\".5\"/><path d=\"M4.99994 5L4.05132 5.31621C3.06126 5.64623 2.56623 5.81124 2.2831 6.20408C1.99996 6.59692 1.99997 7.11873 2 8.16234L2 8.23487C2.00003 9.09561 2.00004 9.52598 2.20723 9.87809C2.41441 10.2302 2.79063 10.4392 3.54305 10.8572L6.49994 12.5\" opacity=\".5\"/><path d=\"M11.1459 6.02251C11.5259 5.34084 11.7159 5 12 5C12.2841 5 12.4741 5.34084 12.8541 6.02251L12.9524 6.19887C13.0603 6.39258 13.1143 6.48944 13.1985 6.55334C13.2827 6.61725 13.3875 6.64097 13.5972 6.68841L13.7881 6.73161C14.526 6.89857 14.895 6.98205 14.9828 7.26432C15.0706 7.54659 14.819 7.84072 14.316 8.42898L14.1858 8.58117C14.0429 8.74833 13.9714 8.83191 13.9392 8.93531C13.9071 9.03872 13.9179 9.15023 13.9395 9.37327L13.9592 9.57632C14.0352 10.3612 14.0733 10.7536 13.8435 10.9281C13.6136 11.1025 13.2682 10.9435 12.5773 10.6254L12.3986 10.5431C12.2022 10.4527 12.1041 10.4075 12 10.4075C11.8959 10.4075 11.7978 10.4527 11.6014 10.5431L11.4227 10.6254C10.7318 10.9435 10.3864 11.1025 10.1565 10.9281C9.92674 10.7536 9.96476 10.3612 10.0408 9.57632L10.0605 9.37327C10.0821 9.15023 10.0929 9.03872 10.0608 8.93531C10.0286 8.83191 9.95713 8.74833 9.81418 8.58117L9.68403 8.42898C9.18097 7.84072 8.92945 7.54659 9.01723 7.26432C9.10501 6.98205 9.47396 6.89857 10.2119 6.73161L10.4028 6.68841C10.6125 6.64097 10.7173 6.61725 10.8015 6.55334C10.8857 6.48944 10.9397 6.39258 11.0476 6.19887L11.1459 6.02251Z\"/><path stroke-linecap=\"round\" d=\"M18 22H6\" opacity=\".5\"/></g></svg>"
  };
  const logIcon = (e) => { const k = e.key || ''; const kind = k === 'game.win' ? 'win' : e.kind; return LOG_ICONS[kind] || LOG_ICONS.system; };
  const ringHtml = (deadline, total) => deadline ? `<span class="ring" data-deadline="${deadline}" data-total="${total || 8000}"><span>—</span></span>` : '';

  // Timers: one rAF loop updates every countdown ring
  function tick() {
    const n = now();
    for (const el of $$('.ring[data-deadline]')) {
      const dl = Number(el.dataset.deadline), total = Number(el.dataset.total) || 8000;
      const rem = Math.max(0, dl - n);
      el.style.setProperty('--p', Math.max(0, Math.min(1, rem / total)));
      const s = (rem / 1000).toFixed(rem < 10000 ? 1 : 0);
      const span = el.firstElementChild; if (span.textContent !== s) span.textContent = s;
      el.classList.toggle('low', rem < 3000);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ───────── sound (synthesized, no files) ─────────
  const sfx = (() => {
    let ctx = null, enabled = localStorage.getItem('mekina.sound') !== 'off';
    const ensure = () => { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } } if (ctx.state === 'suspended') ctx.resume(); return ctx; };
    const tone = (f, dur, type = 'sine', gain = .12, t0 = 0, slide = 0) => {
      const c = ensure(); if (!c) return; const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f, c.currentTime + t0); if (slide) o.frequency.exponentialRampToValueAtTime(slide, c.currentTime + t0 + dur);
      g.gain.setValueAtTime(0, c.currentTime + t0); g.gain.linearRampToValueAtTime(gain, c.currentTime + t0 + .01); g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + t0 + dur);
      o.connect(g).connect(c.destination); o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + dur + .05);
    };
    const noise = (dur, gain = .08, t0 = 0) => {
      const c = ensure(); if (!c) return; const b = c.createBuffer(1, c.sampleRate * dur, c.sampleRate); const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const s = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800;
      s.buffer = b; g.gain.value = gain; s.connect(f).connect(g).connect(c.destination); s.start(c.currentTime + t0);
    };
    const lib = {
      click: () => tone(900, .05, 'square', .03),
      error: () => tone(200, .18, 'sawtooth', .05),
      coin: () => { tone(1300, .08, 'triangle', .1); tone(1950, .16, 'sine', .08, .05); },
      card: () => noise(.18, .06),
      stamp: () => { tone(140, .18, 'square', .12); noise(.08, .08); },
      alert: () => { tone(660, .1, 'square', .06); tone(880, .14, 'square', .06, .12); },
      turn: () => { tone(523, .1, 'triangle', .09); tone(659, .1, 'triangle', .09, .11); tone(784, .2, 'triangle', .09, .22); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, .35, 'triangle', .1, i * .13)),
      lose: () => tone(300, .5, 'sawtooth', .06, 0, 90),
      reveal: () => { tone(440, .12, 'sine', .08); tone(880, .25, 'sine', .08, .1); },
    };
    return {
      get enabled() { return enabled; },
      toggle() { enabled = !enabled; localStorage.setItem('mekina.sound', enabled ? 'on' : 'off'); if (enabled) { ensure(); lib.click(); } return enabled; },
      play(n) { if (!enabled || (reducedMotion && n === 'click')) return; try { (lib[n] || (() => {}))(); } catch {} },
      unlock() { ensure(); },
    };
  })();

  // ───────── background slideshow (every 5 s, cross-fade) ─────────
  const slideshow = (() => {
    const layers = $$('.bg-layer'); let i = 0, cur = 0, timer = null, list = [];
    const pick = () => { const portrait = window.innerHeight > window.innerWidth; const small = Math.max(window.innerWidth, window.innerHeight) < 1100; const bgs = small ? IMG.bgSmall : IMG.bg; list = portrait ? [IMG.poster, ...bgs] : bgs; };
    const show = (src) => { const next = layers[1 - cur]; next.style.backgroundImage = `url('${src}')`; next.classList.add('show'); layers[cur].classList.remove('show'); cur = 1 - cur; };
    const step = () => { if (document.hidden) return; i = (i + 1) % list.length; show(list[i]); };
    return {
      start() { pick(); show(list[0]); for (const s of list) { const im = new Image(); im.src = s; } clearInterval(timer); timer = setInterval(step, THEME.slideshowMs); },
      refresh() { const old = list[i]; pick(); if (!list.includes(old)) { i = 0; show(list[0]); } },
    };
  })();
  window.addEventListener('resize', () => slideshow.refresh());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) slideshow.refresh(); });

  // ───────── language ─────────
  function applyLanguage() {
    const rtl = I18N.dir() === 'rtl';
    document.documentElement.lang = rtl ? 'ar' : 'en';
    document.documentElement.dir = I18N.dir();
    for (const el of $$('[data-i18n]')) el.innerHTML = t(el.dataset.i18n);
    for (const el of $$('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
    $('#btn-lang').textContent = t('top.lang'); $('#btn-lang').title = t('top.lang.title');
    $('#btn-log').title = t('top.log'); $('#btn-sound').title = t('top.sound'); $('#btn-rules').title = t('top.rules');
    renderRules();
    renderProfileUI();
    // force re-render of keyed regions
    ui.promptKey = ''; ui.consoleKey = ''; ui.seatsKey = '';
    if (room && !state) renderLobby();
    if (state) { $('#log').innerHTML = ''; ui.lastLogId = 0; render(); }
  }

  // ───────── screens ─────────
  function show(screen) {
    for (const s of ['home', 'lobby', 'game']) $('#screen-' + s).classList.toggle('hidden', s !== screen);
    $('#btn-leave').classList.toggle('hidden', screen === 'home');
    $('#roomcode-pill').classList.toggle('hidden', screen === 'home');
    $('#btn-log').classList.toggle('hidden-force', screen !== 'game');
    document.body.classList.toggle('in-game', screen === 'game');
    if (screen !== 'game') { $('#log-area').classList.remove('open'); }
  }

  function renderLobby() {
    if (!room) return;
    $('#roomcode-pill').textContent = room.code;
    $('#lobby-code').textContent = room.code;
    const isHost = room.hostId === room.you;
    for (const p of room.players) if (p.avatar === 'custom' && p.avatarData) customAvatars[p.id] = p.avatarData;
    $('#lobby-players').innerHTML = room.players.map((p, i) => `
      <li class="ptile ${p.connected ? '' : 'off'} ${p.ready || p.isHost || p.isBot ? 'ready' : ''}">
        ${avatarHtml(p, 'lg')}
        <div class="who">${esc(p.name)}${p.isBot ? `<span class="bot-chip">${t('seat.bot')}</span>` : ''}</div>
        <div class="sub"><span class="dot"></span>${p.isBot ? t('lobby.bot') : p.isHost ? t('lobby.host') : (p.ready ? t('lobby.readyTag') : t('lobby.notreadyTag'))}${p.id === room.you ? ' · ' + t('lobby.you') : ''}</div>
      </li>`).join('') + Array.from({ length: Math.max(0, Math.min(room.maxPlayers, 6) - room.players.length) }, (_, k) => `<li class="ptile empty"><span class="avatar lg empty"></span><div class="sub">${t('lobby.waitingSeat')}</div></li>`).join('');
    const meP = room.players.find(p => p.id === room.you);
    $('#btn-ready').textContent = meP && meP.ready ? t('lobby.notready') : t('lobby.ready');
    $('#btn-ready').classList.toggle('hidden', isHost);
    $('#btn-start').classList.toggle('hidden', !isHost);
    $('#btn-start').disabled = !room.canStart;
    $('#bot-row').classList.toggle('hidden', !isHost);
    $('#btn-addbot').disabled = room.players.length >= room.maxPlayers;
    $('#btn-removebot').disabled = !room.players.some(p => p.isBot);
    const n = room.players.length;
    $('#lobby-hint').textContent = n < room.minPlayers ? t('lobby.hint.more', { n, max: room.maxPlayers })
      : isHost ? (room.canStart ? t('lobby.hint.canStart') : t('lobby.hint.wait'))
      : t('lobby.hint.guest');
  }

  // ───────── game rendering (keyed) ─────────
  function render() {
    if (!state) return;
    renderSeats();
    renderConsole();
    renderLog();
    renderPrompt();
  }

  function validTargets(action) {
    return state.players.filter(p => {
      if (!p.alive) return false;
      if (action.target === 'any') return true;
      if (p.id === me) return false;
      if (action.target === 'rich') return p.coins > 7;
      if (action.target === 'coins') return p.coins > 0;
      return true;
    }).map(p => p.id);
  }

  // Opponent seats sit on the top arc of the oval table; you sit at the bottom.
  const SEAT_ANGLES = { 1: [-90], 2: [-142, -38], 3: [-158, -90, -22], 4: [-164, -118, -62, -16], 5: [-168, -128, -90, -52, -12] };
  function renderSeats() {
    const host = $('#seats');
    const opponents = state.players.filter(p => p.id !== me);
    const key = opponents.map(p => p.id).join('|') + I18N.lang;
    if (key !== ui.seatsKey) {
      ui.seatsKey = key;
      host.innerHTML = opponents.map((p) => `<div class="seat" data-pid="${p.id}">
        <div class="av-wrap"><span class="avatar md" style="--bg:${p.color || '#6b5d45'}"><img src="${avatarSrc(p)}" alt="" draggable="false" /></span><span class="lamp"></span><span class="tag turn-tag hidden">▶</span></div>
        <div class="nm"></div>
        <div class="coins"><img src="${IMG.coin}" alt="" /><span class="n">0</span></div>
        <div class="hand"></div>
        <div class="status"></div>
        <div class="pick-arrow hidden"><span class="pa-hand">☝</span><span class="pa-text"></span></div>
        <div class="stamp-host"></div></div>`).join('');
    }
    const angles = SEAT_ANGLES[opponents.length] || SEAT_ANGLES[5];
    const w = state.pending && state.pending.window;
    const targeting = ui.targeting ? validTargets(ui.targeting) : null;
    $('#deck-n').textContent = state.deckSize;
    const bankLbl = $('#bank-lbl'); if (bankLbl) bankLbl.textContent = t('game.bank');
    opponents.forEach((p, i) => {
      const el = host.children[i]; if (!el) return;
      const a = (angles[i] !== undefined ? angles[i] : -90) * Math.PI / 180;
      el.style.left = `clamp(80px, ${50 + 40 * Math.cos(a)}%, calc(100% - 80px))`; el.style.top = `clamp(100px, ${52 + 33 * Math.sin(a)}%, calc(100% - 100px))`;
      const isTurn = state.turnPlayerId === p.id && state.phase === 'playing';
      el.classList.toggle('turn', isTurn);
      el.classList.toggle('dead', !p.alive);
      el.classList.toggle('offline', !p.connected && p.alive);
      el.classList.toggle('targetable', !!(targeting && targeting.includes(p.id)));
      el.classList.toggle('selected', ui.targetId === p.id);
      $('.nm', el).innerHTML = esc(p.name) + (p.isBot ? `<span class="bot-chip">${t('seat.bot')}</span>` : '');
      $('.turn-tag', el).classList.toggle('hidden', !isTurn);
      $('.lamp', el).className = 'lamp ' + (p.connected ? 'on' : 'off');
      const img = $('.avatar img', el); const src = avatarSrc(p); if (img.getAttribute('src') !== src) img.src = src;
      $('.avatar', el).style.setProperty('--bg', p.color || '#6b5d45');
      const nEl = $('.coins .n', el); if (nEl.textContent !== String(p.coins)) nEl.textContent = p.coins;
      const hand = $('.hand', el);
      const pickSlots = !!(ui.targeting && ui.targeting.type === 'police' && ui.targetId === p.id);
      const hk = p.cardCount + ':' + (pickSlots ? 1 : 0);
      if (hand.dataset.k !== hk) { hand.dataset.k = hk; hand.innerHTML = Array.from({ length: p.cardCount }, (_, sIdx) => `<div class="cardback ${pickSlots ? 'pick' : ''}" data-slot="${sIdx}"><span class="slot-n">${sIdx + 1}</span></div>`).join(''); }
      el.classList.toggle('picking', pickSlots);
      const pa = $('.pick-arrow', el); pa.classList.toggle('hidden', !pickSlots); if (pickSlots) $('.pa-text', pa).textContent = t('pick.card');
      let status = '';
      if (!p.alive) status = `<span class="tag dead">${t('seat.eliminated')}</span>`;
      else if (w && w.type === 'reaction') {
        if (w.claim && w.claim.claimerId === p.id) status = `<span class="tag claim">${t('seat.claims', { character: esc(cname(w.claim.character)) })}</span>`;
        else if (w.passed.includes(p.id)) status = `<span class="tag pass">${t('seat.passed')}</span>`;
        else if (w.eligible.includes(p.id)) { const o = []; if (w.block && w.blockEligible.includes(p.id)) o.push(t('seat.opt.' + (w.block.kind === 'veto' ? 'veto' : w.block.kind === 'tax' ? 'tax' : 'block'))); if (w.claim && w.challengeEligible.includes(p.id)) o.push(t('seat.opt.bluff')); status = `<span class="tag think">${t('seat.may', { opts: esc(o.join(' / ')) })}</span>`; }
      } else if (w && w.type === 'decision' && w.playerId === p.id) status = `<span class="tag think">${t('seat.deciding')}</span>`;
      else if (isTurn && state.pending && state.pending.stage === 'turn') status = `<span class="tag turn">${t('seat.theirTurn')}</span>`;
      else if (state.pending && state.pending.actorId === p.id && state.pending.stage === 'resolving') status = `<span class="tag claim">${t('seat.acting')}</span>`;
      else if (!p.connected) status = `<span class="tag pass">${t('seat.nosignal')}</span>`;
      const st = $('.status', el); if (st.innerHTML !== status) st.innerHTML = status;
    });
    // my seat at the bottom of the table
    const meP = pl(me), seatMe = $('#seat-me');
    if (meP) {
      const isMyTurn = state.turnPlayerId === me && state.phase === 'playing';
      const mk = [me, meP.avatar, meP.color, meP.coins, meP.alive, isMyTurn, I18N.lang].join('|');
      if (seatMe.dataset.k !== mk) { seatMe.dataset.k = mk; seatMe.innerHTML = `<div class="av-wrap">${avatarHtml(meP, 'md')}</div><div class="nm">${esc(meP.name)} <span class="you-chip">${t('game.you')}</span></div>`; }
      seatMe.classList.toggle('turn', isMyTurn); seatMe.classList.toggle('dead', !meP.alive);
    }
    if (!host.dataset.bound) {
      host.dataset.bound = '1';
      host.addEventListener('click', (ev) => {
        const seat = ev.target.closest('.seat.targetable'); if (!seat || !ui.targeting) return;
        const pid = seat.dataset.pid; const slot = ev.target.closest('.cardback');
        if (ui.targeting.type === 'police') { if (ui.targetId === pid && slot) return sendAction({ type: 'police', targetId: pid, slot: Number(slot.dataset.slot) }); ui.targetId = pid; return render(); }
        if (ui.targeting.type === 'colonel') { ui.targetId = pid; return render(); }
        sendAction({ type: ui.targeting.type, targetId: pid });
      });
    }
  }

  function renderConsole() {
    const meP = pl(me), you = state.you, box = $('#me');
    if (!you || !meP) { box.innerHTML = `<div class="status-line">${t('game.spectating')}</div>`; return; }
    const myTurn = state.phase === 'playing' && state.pending && state.pending.stage === 'turn' && state.pending.actorId === me && meP.alive;
    const selfPick = ui.targeting && ui.targeting.type === 'police' && ui.targetId === me;
    const key = JSON.stringify([I18N.lang, you.cards, meP.coins, meP.alive, myTurn, state.phase, state.pending && state.pending.stage, state.pending && state.pending.actorId, state.pending && state.pending.deadline, ui.targeting && ui.targeting.type, selfPick, state.deckSize, state.players.map(p => [p.alive, p.coins > 7, p.coins > 0])]);
    if (key === ui.consoleKey) return;
    const handChanged = JSON.stringify(you.cards) !== ui.handKey;
    ui.consoleKey = key; ui.handKey = JSON.stringify(you.cards);
    const hand = (selfPick ? `<div class="pick-banner"><span class="pa-hand">☝</span>${t('pick.own')}</div>` : '') + you.cards.map((c, i) => cardHtml(c, { cls: 'w120', anim: handChanged, pick: selfPick, attrs: selfPick ? `data-selfslot="${i}"` : '' })).join('') || `<span class="status-line">${t('game.nocards')}</span>`;
    let actions = '';
    if (myTurn) {
      const tile = (a) => {
        const canAfford = meP.coins >= a.cost;
        const targets = a.target ? validTargets(a) : null;
        const ok = canAfford && (!targets || targets.length > 0);
        const why = !canAfford ? t('game.needCoins', { n: a.cost }) : (targets && !targets.length ? t('game.noTarget') : '');
        const th = CH[a.type];
        const thumb = th ? `<span class="thumb"><img src="${th.cardSm}" alt="" /></span>` : `<span class="thumb icon ${a.type}">${ICONS[a.type]}</span>`;
        return `<button class="action ${a.kind}" style="--c:${th ? th.color : '#b9ad99'}" data-type="${a.type}" ${ok ? '' : 'disabled'} title="${esc(why || actionDesc(a.type))}">${thumb}
          <span class="txt"><span class="t">${esc(actionName(a.type))}</span><span class="d">${esc(why || actionDesc(a.type))}</span></span>
          ${a.cost ? `<span class="cost ${canAfford ? '' : 'short'}">${a.cost}<img src="${IMG.coin}" alt="" /></span>` : '<span class="cost free">·</span>'}</button>`;
      };
      actions = `<div class="actions">
        <div class="act-group"><div class="act-label">${t('actions.basic')}</div><div class="act-grid basic">${ACTIONS.filter(a => a.kind === 'default').map(tile).join('')}</div></div>
        <div class="act-group"><div class="act-label">${t('actions.claims')}</div><div class="act-grid claims">${ACTIONS.filter(a => a.kind === 'claim').map(tile).join('')}</div></div></div>`;
    }
    let status = '';
    if (state.phase === 'ended') status = `<div class="status-line">${t('game.over')}</div>`;
    else if (myTurn) status = `<div class="status-line"><b class="turn">${t('game.yourturn')}</b> ${t('game.choose')} ${ringHtml(state.pending.deadline, state.timings.turn)}</div>`;
    else if (state.pending && state.pending.stage === 'turn') status = `<div class="status-line">${t('game.waitingFor', { name: esc(pname(state.pending.actorId)) })} ${ringHtml(state.pending.deadline, state.timings.turn)}</div>`;
    else if (!meP.alive) status = `<div class="status-line">${t('game.eliminated')}</div>`;
    box.innerHTML = `
      <div class="console-head">
        <div class="console-title">${t('game.yourhand')} ${coinHtml(meP.coins, 'big me-coins')}<span class="sub">${t('game.max', { max: state.maxCoins, deck: state.deckSize })}</span></div>
        ${status}
      </div>
      <div class="hand-row"><div class="hand ${selfPick ? 'picking' : ''}">${hand}</div>${actions}</div>`;
    $$('.action', box).forEach(b => b.addEventListener('click', () => startAction(b.dataset.type)));
    $$('[data-selfslot]', box).forEach(c => c.addEventListener('click', () => sendAction({ type: 'police', targetId: me, slot: Number(c.dataset.selfslot) })));
  }

  function renderLog() {
    const el = $('#log');
    const fresh = state.log.filter(e => e.id > ui.lastLogId);
    if (!fresh.length) return;
    if (ui.lastLogId === 0) el.innerHTML = '';
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    for (const e of fresh) { const d = document.createElement('div'); d.className = 'entry ' + e.kind; d.innerHTML = `<span class="ic">${logIcon(e)}</span><span class="tx"></span>`; d.lastElementChild.textContent = I18N.logText(e).replace(/^[☠🏆]\s*/, ''); el.appendChild(d); }
    while (el.children.length > 150) el.removeChild(el.firstChild);
    if (atBottom || ui.lastLogId === 0) el.scrollTop = el.scrollHeight;
    const wasFirst = ui.lastLogId === 0;
    ui.lastLogId = fresh[fresh.length - 1].id;
    if (!wasFirst && !ui.logOpen && window.matchMedia('(max-width: 1100px)').matches) { ui.unread += fresh.length; const b = $('#log-badge'); b.textContent = ui.unread > 9 ? '9+' : ui.unread; b.classList.remove('hidden'); }
  }

  function renderPrompt() {
    const box = $('#prompt');
    const meP = pl(me);
    const p = state.pending, w = p && p.window;
    let html = '', urgent = false, key = '';

    if (state.phase === 'ended') {
      const isHost = room && room.hostId === me;
      key = 'end' + state.winnerId + isHost + I18N.lang;
      html = `<div class="p-strip"><span>${t('end.strip')}</span></div><div class="winner"><div class="small-caps">${t('end.winner')}</div><h2>${esc(state.winnerId ? pname(state.winnerId) : t('end.nobody'))}</h2>
        <p class="p-sub">${state.winnerId === me ? t('end.you') : t('end.them')}</p>
        ${isHost ? `<div class="p-actions"><button class="key orange" id="p-newgame">${t('end.new')}</button></div>` : `<div class="p-waiting">${t('end.wait')}</div>`}</div>`;
    } else if (ui.targeting) {
      const a = ui.targeting;
      key = 'target' + a.type + ui.targetId + I18N.lang;
      let body = `<div class="pick-banner"><span class="pa-hand">☝</span>${t('pick.player')}</div><div class="p-sub">${t('prompt.target.tap')}</div>`;
      if (a.type === 'police') body = `<div class="pick-banner"><span class="pa-hand">☝</span>${ui.targetId ? (ui.targetId === me ? t('pick.own') : t('pick.slot', { name: esc(pname(ui.targetId)) })) : t('pick.player')}</div><div class="p-sub">${ui.targetId ? t('prompt.target.police.slot', { owner: ui.targetId === me ? t('prompt.owner.you') : t('prompt.owner.of', { name: esc(pname(ui.targetId)) }) }) : t('prompt.target.police.pick')}</div>`;
      if (a.type === 'colonel' && ui.targetId) body = `<div class="p-sub">${t('prompt.target.colonel', { name: esc(pname(ui.targetId)) })}</div>
        <div class="pick-banner"><span class="pa-hand">☝</span>${t('pick.guess')}</div>
        <div class="p-cards picking">${CHARACTERS.map(c => cardHtml(c, { cls: 'w72', small: true, pick: true, attrs: `data-guess="${c}"` })).join('')}</div>`;
      html = `<div class="p-strip"><span class="steps">${stepsHtml('claim')}</span><span class="strip-note">${t('prompt.target.strip', { name: esc(actionName(a.type)) })}</span><button class="key grey small" id="p-cancel">${t('prompt.cancel')}</button></div><div class="p-body">${body}</div>`;
    } else if (w && w.type === 'reaction') {
      const actor = pname(p.actorId);
      const canChallenge = meP && meP.alive && w.claim && w.challengeEligible.includes(me) && !w.passed.includes(me);
      const canBlock = meP && meP.alive && w.block && w.blockEligible.includes(me) && !w.passed.includes(me);
      const canPass = meP && meP.alive && w.eligible.includes(me) && !w.passed.includes(me);
      urgent = !!(canChallenge || canBlock);
      key = 'react' + w.deadline + canChallenge + canBlock + canPass + w.passed.length + I18N.lang;
      let title, sub, cardC = null, strip;
      if (w.claim) {
        const c = w.claim; cardC = c.character;
        strip = t(c.kind === 'action' ? 'prompt.strip.claim' : c.kind === 'block' ? 'prompt.strip.counter' : c.kind === 'veto' ? 'prompt.strip.veto' : 'prompt.strip.tax');
        title = t('prompt.claims', { name: esc(pname(c.claimerId)), character: esc(cname(c.character)) });
        sub = claimText(c, p.action);
      } else if (w.block && w.block.kind === 'veto') { strip = t('prompt.strip.loan'); title = t('prompt.loan.title', { name: esc(actor) }); sub = t('prompt.loan.sub'); }
      else if (w.block && w.block.kind === 'tax') { strip = t('prompt.strip.bw'); cardC = 'businesswoman'; title = t('prompt.bw.title', { name: esc(actor) }); sub = t('prompt.bw.sub'); }
      else { strip = t('prompt.strip.proven'); cardC = p.action.character; title = t('prompt.proven.title', { name: esc(actor), character: esc(cname(p.action.character)) }); sub = t('prompt.proven.sub'); }
      const blockLabel = w.block ? (w.block.kind === 'veto' ? t('prompt.block.veto') : w.block.kind === 'tax' ? t('prompt.block.tax') : t('prompt.block.block', { character: esc(cname(w.block.character)) })) : '';
      const blockDesc = w.block ? (w.block.kind === 'veto' ? t('prompt.vetoDesc') : w.block.kind === 'tax' ? t('prompt.taxDesc') : t('prompt.blockDesc', { character: esc(cname(w.block.character)) })) : '';
      // plain-language consequence if nobody reacts
      let effect = '';
      if (w.claim && w.claim.kind === 'action') effect = t('effect.' + p.action.type, { name: esc(actor), target: esc(p.action.targetId ? pname(p.action.targetId) : '') });
      else if (w.claim && w.claim.kind === 'block') effect = t('effect.block');
      else if (w.claim && w.claim.kind === 'veto') effect = t('effect.veto');
      else if (w.claim && w.claim.kind === 'tax') effect = t('effect.tax');
      else if (w.block && w.block.kind === 'veto') effect = t('effect.veto').replace(/^[^,،]*[,،]\s*/, '');
      else if (w.block) effect = t('effect.' + (p.action.type || 'block'), { name: esc(actor), target: esc(p.action.targetId ? pname(p.action.targetId) : '') });
      let primary = '';
      if (canBlock) primary += `<button class="key orange" id="p-block"><span class="k-main">${blockLabel}</span><span class="k-sub">${blockDesc}</span></button>`;
      if (canPass) primary += `<button class="key grey" id="p-pass"><span class="k-main">${canBlock || canChallenge ? t('prompt.pass') : t('prompt.ok')}</span><span class="k-sub">${t('prompt.passDesc')}</span></button>`;
      if (!canPass) primary = `<div class="p-waiting">${w.claim && w.claim.claimerId === me ? t('prompt.waiting.mine') : t('prompt.waiting.others')} ${t('prompt.passed', { n: w.passed.length, total: w.eligible.length })}</div>`;
      const bluffHint = !w.claim ? t('prompt.bluff.none') : w.claim.claimerId === me ? t('prompt.bluff.own') : !canChallenge ? t('prompt.bluff.passed') : '';
      const bluff = `<div class="p-bluff"><button class="key red small" id="p-challenge" ${canChallenge ? '' : 'disabled'} title="${esc(bluffHint)}">${t('prompt.bluff.btn')}${w.claim ? ' — ' + t('prompt.bluff.quote', { name: esc(pname(w.claim.claimerId)), character: esc(cname(w.claim.character)) }) : ''}</button><span>${canChallenge ? t('prompt.bluffDesc') : esc(bluffHint)}</span></div>`;
      const who = w.claim ? avatarMini(w.claim.claimerId) : avatarMini(p.actorId);
      html = `<div class="p-strip"><span class="steps">${stepsHtml('react')}</span>${ringHtml(w.deadline, w.claim ? state.timings.challenge : state.timings.block)}</div>
        <div class="p-body"><div class="p-main">${cardC ? cardHtml(cardC, { cls: 'w96', small: true }) : ''}<div class="p-text">${who}<div class="p-title">${title}</div><div class="p-sub">${sub}</div>${effect ? `<div class="p-effect">${effect}</div>` : ''}</div></div>
        ${timelineHtml(4)}
        <div class="p-actions">${primary}</div>${bluff}</div>`;
    } else if (w && w.type === 'result') {
      key = 'res' + w.deadline + w.kind + I18N.lang;
      const d = w.data || {};
      let verdict = '';
      if (w.kind === 'challenge' && d.result) {
        verdict = `<div class="verdict ${d.result === 'true' ? 'ok' : 'bad'}">${avatarMini(d.claimerId)}<span>${d.result === 'true' ? t('result.true', { claimer: esc(pname(d.claimerId)), character: esc(cname(d.character)), challenger: esc(pname(d.challengerId)) }) : t('result.bluff', { claimer: esc(pname(d.claimerId)), character: esc(cname(d.character)) })}</span></div>`;
      }
      html = `<div class="p-strip result"><span class="steps">${stepsHtml('result')}</span>${ringHtml(w.deadline, w.kind === 'turn_end' ? state.timings.turnPause : state.timings.resultPause)}</div>
        <div class="p-body"><div class="p-title">${w.kind === 'turn_end' ? t('result.turnEnd') : t('result.title')}</div>${verdict}${timelineHtml(8)}
        ${w.kind === 'turn_end' ? `<div class="p-waiting">${t('result.next')}</div>` : ''}</div>`;
    } else if (w && w.type === 'decision') {
      key = 'dec' + w.deadline + w.playerId + (w.data ? 1 : 0) + I18N.lang;
      if (w.playerId === me && w.data) {
        urgent = true;
        if (w.kind === 'lose_card') {
          html = `<div class="p-strip"><span>${t('decision.hit', { reason: esc(I18N.reason(w.data.reason)) })}</span>${ringHtml(w.deadline, state.timings.decision)}</div><div class="p-body">
            <div class="p-sub">${t('decision.choose')}</div>
            <div class="pick-banner red"><span class="pa-hand">☝</span>${t('pick.lose')}</div>
            <div class="p-cards picking">${state.you.cards.map((c, i) => cardHtml(c, { cls: 'w110', small: true, pick: true, attrs: `data-lose="${i}"` })).join('')}</div>
            ${w.data.canPay ? `<div class="p-actions"><button class="key green" id="p-pay">${t('decision.pay', { n: w.data.payCost })}</button></div>` : ''}</div>`;
        } else if (w.kind === 'police') {
          const owner = w.data.targetId === me ? t('prompt.owner.you') : t('prompt.owner.of', { name: esc(pname(w.data.targetId)) });
          html = `<div class="p-strip"><span>${t('decision.police.strip')}</span>${ringHtml(w.deadline, state.timings.decision)}</div><div class="p-body">
            <div class="p-main"><div class="card w96 flip" id="peek"><div class="inner"><div class="face back"></div><div class="face front"><img src="${CH[w.data.card].card}" alt="" /></div></div></div>
            <div><div class="p-title">${t('decision.police.title', { owner, n: w.data.slot + 1, character: esc(cname(w.data.card)) })}</div><div class="p-sub">${t('decision.police.sub')}</div></div></div>
            <div class="p-actions"><button class="key grey" id="p-keep">${t('decision.keep')}</button><button class="key orange" id="p-swap">${t('decision.swap')}</button></div></div>`;
        }
      } else {
        html = `<div class="p-strip"><span>${t('decision.waiting.strip')}</span>${ringHtml(w.deadline, state.timings.decision)}</div><div class="p-body"><div class="p-title">${t(w.kind === 'police' ? 'decision.waiting.police' : 'decision.waiting.lose', { name: esc(pname(w.playerId)) })}</div></div>`;
      }
    }

    if (key === ui.promptKey && !!html === !box.classList.contains('hidden')) return;
    ui.promptKey = key;
    box.classList.toggle('hidden', !html);
    box.classList.toggle('urgent', urgent);
    box.innerHTML = html;
    if (!html) return;
    if (urgent) sfx.play('alert');
    const peek = $('#peek', box); if (peek) setTimeout(() => peek.classList.add('flipped'), 150);
    const on = (sel, fn) => { const el = $(sel, box); if (el) el.addEventListener('click', fn); };
    on('#p-cancel', () => { ui.targeting = null; ui.targetId = null; render(); });
    on('#p-challenge', () => emit('game_challenge'));
    on('#p-pass', () => emit('game_pass'));
    on('#p-block', () => emit('game_block'));
    on('#p-pay', () => emit('game_decision', { pay: true }));
    on('#p-keep', () => emit('game_decision', { swap: false }));
    on('#p-swap', () => emit('game_decision', { swap: true }));
    on('#p-newgame', async (e) => { e.currentTarget.disabled = true; const r = await emit('new_game'); if (!r.ok) { e.currentTarget.disabled = false; emit('back_to_lobby'); } });
    $$('[data-lose]', box).forEach(el => el.addEventListener('click', () => emit('game_decision', { index: Number(el.dataset.lose) })));
    $$('[data-guess]', box).forEach(el => el.addEventListener('click', () => sendAction({ type: 'colonel', targetId: ui.targetId, guess: el.dataset.guess })));
  }

  // Phase indicator and a timeline of this turn's log entries (for context inside prompts / result card)
  const stepsHtml = (active) => ['claim', 'react', 'result'].map(k => `<span class="step ${k === active ? 'on' : ''}">${t('steps.' + k)}</span>`).join('<span class="step-sep">›</span>');
  function timelineHtml(limit = 6) {
    const from = (state.pending && state.pending.logStart) || 0;
    const items = state.log.filter(e => e.id > from && e.kind !== 'system');
    const shown = items.slice(-limit);
    if (!shown.length) return '';
    return `<ol class="timeline">${shown.map(e => `<li class="tl ${e.kind}"><span class="ic">${logIcon(e)}</span><span class="tx">${esc(I18N.logText(e))}</span></li>`).join('')}</ol>`;
  }
  const avatarMini = (pid) => { const p = pl(pid); return p ? avatarHtml(p, 'xs') : ''; };

  function claimText(claim, action) {
    const name = esc(pname(claim.claimerId)), c = esc(cname(claim.character));
    if (claim.kind === 'veto') return t('claim.veto', { name });
    if (claim.kind === 'tax') return t('claim.tax', { name });
    if (claim.kind === 'block') return t('claim.block', { name, character: c, actor: esc(pname(action.actorId)), action: esc(cname(action.character)) });
    const target = action.targetId ? esc(pname(action.targetId)) : '';
    const what = t('claim.what.' + action.type, { target, guess: action.guess ? esc(cname(action.guess)) : '' });
    return t('claim.action', { name, character: c, what });
  }

  function startAction(type) {
    const a = ACTIONS.find(x => x.type === type);
    if (a.target) { ui.targeting = a; ui.targetId = null; render(); return; }
    sendAction({ type });
  }
  async function sendAction(payload) {
    ui.targeting = null; ui.targetId = null;
    await emit('game_action', payload);
    render();
  }

  // ───────── FX (driven by server events) ─────────
  const fx = $('#fx');
  const rectOf = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; };
  const seatEl = (pid) => pid === me ? $('#me') : $(`#seats .seat[data-pid="${pid}"]`);
  const coinsElOf = (pid) => pid === me ? $('#me .me-coins') : $(`#seats .seat[data-pid="${pid}"] .coins`);
  const bankEl = () => $('#bank') || $('#deck');
  function anchor(id) { return rectOf(id === 'bank' ? bankEl() : coinsElOf(id) || seatEl(id)) || { x: window.innerWidth / 2, y: window.innerHeight / 2 }; }
  function flyCoins(fromId, toId, n) {
    const a = anchor(fromId), b = anchor(toId); const count = Math.min(n, 6);
    sfx.play('coin');
    for (let i = 0; i < count; i++) {
      const c = document.createElement('img'); c.className = 'fx-coin'; c.src = IMG.coin; fx.appendChild(c);
      const dx = (Math.random() - .5) * 30, dy = (Math.random() - .5) * 30;
      c.animate([{ transform: `translate(${a.x - 13 + dx}px, ${a.y - 13 + dy}px) scale(.6)`, opacity: 0 }, { transform: `translate(${a.x - 13 + dx}px, ${a.y - 13 + dy}px) scale(1)`, opacity: 1, offset: .15 }, { transform: `translate(${(a.x + b.x) / 2 - 13}px, ${Math.min(a.y, b.y) - 60}px) scale(1.1)`, offset: .55 }, { transform: `translate(${b.x - 13}px, ${b.y - 13}px) scale(.7)`, opacity: 1 }], { duration: reducedMotion ? 1 : 700 + i * 80, delay: i * 60, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' }).onfinish = () => { c.remove(); const ce = coinsElOf(toId); if (ce) { ce.classList.remove('bump'); void ce.offsetWidth; ce.classList.add('bump'); } };
    }
  }
  function flyCard(fromId) {
    const a = anchor(fromId), b = rectOf(bankEl()) || anchor('bank');
    sfx.play('card');
    const c = document.createElement('div'); c.className = 'fx-card'; fx.appendChild(c);
    c.animate([{ transform: `translate(${a.x - 20}px, ${a.y - 33}px) rotate(0deg)`, opacity: 1 }, { transform: `translate(${b.x - 20}px, ${b.y - 33}px) rotate(540deg) scale(.5)`, opacity: .2 }], { duration: reducedMotion ? 1 : 800, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' }).onfinish = () => c.remove();
    const se = seatEl(fromId); if (se) { se.classList.remove('shake'); void se.offsetWidth; se.classList.add('shake'); setTimeout(() => se.classList.remove('shake'), 500); }
  }
  function stamp(pid, text, cls = '') {
    const a = anchor(pid); const s = document.createElement('div'); s.className = 'fx-stamp ' + cls; s.textContent = text; s.style.left = a.x + 'px'; s.style.top = (a.y - 10) + 'px'; fx.appendChild(s);
    sfx.play('stamp'); setTimeout(() => s.remove(), 3600);
  }
  function reveal(character) {
    const d = document.createElement('div'); d.className = 'fx-reveal card flip'; d.innerHTML = `<div class="inner"><div class="face back"></div><div class="face front"><img src="${CH[character].card}" alt="" /></div></div>`; fx.appendChild(d);
    sfx.play('reveal'); requestAnimationFrame(() => setTimeout(() => d.classList.add('flipped'), 80)); setTimeout(() => d.remove(), 2700);
  }
  function banner(text) {
    const b = $('#banner'); b.textContent = text; b.classList.remove('hidden'); b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; setTimeout(() => b.classList.add('hidden'), 1900);
  }
  function confetti() {
    if (reducedMotion) return; const colors = ['#ffd23f', '#f08a1d', '#3ccf6e', '#3f8efc', '#ff6b5e', '#f4efe6'];
    for (let i = 0; i < 90; i++) { const c = document.createElement('div'); c.className = 'fx-confetti'; c.style.left = Math.random() * 100 + 'vw'; c.style.background = colors[i % colors.length]; fx.appendChild(c);
      c.animate([{ transform: `translateY(0) rotate(0)`, opacity: 1 }, { transform: `translateY(${window.innerHeight + 40}px) rotate(${720 + Math.random() * 720}deg) translateX(${(Math.random() - .5) * 200}px)`, opacity: .9 }], { duration: 2500 + Math.random() * 2000, delay: Math.random() * 800, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' }).onfinish = () => c.remove(); }
  }
  function processEvents(s) {
    const evs = s.events || [];
    if (ui.lastEventId === null) { ui.lastEventId = evs.length ? evs[evs.length - 1].id : 0; return; } // don't replay history on (re)join
    const fresh = evs.filter(e => e.id > ui.lastEventId);
    if (!fresh.length) return;
    ui.lastEventId = fresh[fresh.length - 1].id;
    fresh.forEach((e, i) => setTimeout(() => {
      switch (e.type) {
        case 'coins': flyCoins(e.from, e.to, e.n); break;
        case 'card_lost': flyCard(e.playerId); if (e.playerId === me) { const c = $('#me'); c.classList.add('shake'); setTimeout(() => c.classList.remove('shake'), 500); sfx.play('lose'); } break;
        case 'reveal': reveal(e.character); stamp(e.playerId, t('stamp.true'), 'ok'); setTimeout(() => stamp(e.challengerId, t('stamp.wrong')), 600); break;
        case 'bluff': stamp(e.playerId, t('stamp.bluff')); break;
        case 'block': stamp(e.playerId, t(e.kind === 'veto' ? 'stamp.veto' : e.kind === 'tax' ? 'stamp.tax' : 'stamp.blocked'), 'blue'); break;
        case 'eliminated': stamp(e.playerId, t('stamp.out'), ''); if (e.playerId === me) sfx.play('lose'); break;
        case 'win': if (e.playerId === me) { confetti(); sfx.play('win'); } else sfx.play('lose'); break;
      }
    }, i * 350));
  }

  // ───────── rules (dossier) ─────────
  function renderRules() {
    const cards = `<div class="rule-chars">${CHARACTERS.map(c => `<div class="rule-char">${cardHtml(c, { cls: 'w56', small: true })}<div><b>${esc(cname(c))}</b><span class="muted">${esc(t('char.blurb.' + c))}</span></div></div>`).join('')}</div>`;
    $('#rules-body').innerHTML = t('rules.html').replace('{cards}', cards);
  }

  // ───────── socket wiring ─────────
  function connect() {
    socket = io({ transports: ['websocket', 'polling'] });
    socket.on('connect', async () => {
      $('#conn').className = 'lamp on';
      const s = session.load();
      if (s && s.code) {
        const res = await new Promise(r => socket.emit('rejoin', s, r));
        if (res && res.ok) { me = res.playerId; }
        else { session.clear(); me = null; room = null; state = null; show('home'); tryAutoJoin(); }
      } else tryAutoJoin();
    });
    socket.on('disconnect', () => { $('#conn').className = 'lamp off'; });
    socket.on('kicked', (msg) => { toast(I18N.err(msg)); session.clear(); room = null; state = null; show('home'); });
    socket.on('room', (r) => {
      room = r; me = r.you;
      for (const p of r.players) if (p.avatar === 'custom' && p.avatarData) customAvatars[p.id] = p.avatarData;
      if (r.phase === 'lobby') { state = null; ui.lastLogId = 0; ui.lastEventId = null; ui.seatsKey = ''; ui.consoleKey = ''; ui.promptKey = ''; renderLobby(); show('lobby'); }
      else { $('#roomcode-pill').textContent = r.code; if (state) { show('game'); render(); } }
    });
    socket.on('state', (s) => {
      clockOffset = s.serverTime - Date.now();
      const prevTurn = state && state.turnPlayerId, prevStage = state && state.pending && state.pending.stage;
      state = s;
      if (ui.targeting && !(s.pending && s.pending.stage === 'turn' && s.pending.actorId === me)) { ui.targeting = null; ui.targetId = null; }
      show('game');
      render();
      processEvents(s);
      const myTurnNow = s.phase === 'playing' && s.pending && s.pending.stage === 'turn' && s.pending.actorId === me;
      if (myTurnNow && (prevTurn !== me || prevStage !== 'turn') && ui.turnSeen !== s.pending.deadline) { ui.turnSeen = s.pending.deadline; banner(t('banner.turn')); sfx.play('turn'); try { navigator.vibrate && navigator.vibrate(40); } catch {} }
    });
  }

  // ───────── UI events ─────────
  document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
  $('#btn-create').addEventListener('click', async () => {
    const name = $('#name').value.trim(); if (!name) return toast(t('toast.name'));
    const res = await emit('create_room', { name, profile });
    if (res.ok) session.save({ code: res.code, playerId: res.playerId, token: res.token });
  });
  $('#btn-join').addEventListener('click', async () => {
    const name = $('#name').value.trim(); if (!name) return toast(t('toast.name'));
    const code = $('#code').value.trim().toUpperCase(); if (code.length !== 4) return toast(t('toast.code'));
    const res = await emit('join_room', { name, code, profile });
    if (res.ok) { session.save({ code: res.code, playerId: res.playerId, token: res.token }); clearInviteParam(); }
  });
  $('#btn-solo').addEventListener('click', async () => {
    const name = $('#name').value.trim(); if (!name) return toast(t('toast.name'));
    const res = await emit('solo', { name, bots: 3, profile });
    if (res.ok) session.save({ code: res.code, playerId: res.playerId, token: res.token });
  });
  $('#btn-addbot').addEventListener('click', () => emit('add_bot'));
  $('#btn-removebot').addEventListener('click', () => emit('remove_bot'));
  function clearInviteParam() { if (location.search) history.replaceState(null, '', location.pathname); $('#join-hint').classList.add('hidden'); }
  // Invite link (?room=CODE): auto-join when we already know the player's name, otherwise ask for it.
  let autoJoinCode = null;
  function tryAutoJoin() {
    if (!autoJoinCode || !socket || !socket.connected || session.load()) return;
    const name = $('#name').value.trim();
    if (name) { const code = autoJoinCode; autoJoinCode = null; $('#btn-join').click(); return; }
    $('#join-hint').textContent = t('home.joinHint', { code: autoJoinCode }); $('#join-hint').classList.remove('hidden');
    $('#name').focus();
  }
  $('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-join').click(); });
  $('#name').addEventListener('keydown', (e) => { if (e.key === 'Enter') ($('#code').value ? $('#btn-join') : $('#btn-create')).click(); });
  $('#name').addEventListener('input', () => { if (autoJoinCode && $('#name').value.trim()) $('#join-hint').textContent = t('home.joinHint', { code: autoJoinCode }); });
  $('#btn-ready').addEventListener('click', () => emit('toggle_ready'));
  $('#btn-start').addEventListener('click', () => emit('start_game'));
  $('#btn-copy').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?room=${room.code}`;
    try { await navigator.clipboard.writeText(url); toast(t('lobby.copied'), true); } catch { toast(url, true); }
  });
  $('#btn-leave').addEventListener('click', async () => {
    if (state && state.phase === 'playing' && !confirm(t('toast.leave'))) return;
    await emit('leave_room'); session.clear(); room = null; state = null; me = null; show('home');
  });
  $('#btn-rules').addEventListener('click', () => $('#rules').classList.remove('hidden'));
  $('#btn-rules-close').addEventListener('click', () => $('#rules').classList.add('hidden'));
  $('#rules').addEventListener('click', (e) => { if (e.target.id === 'rules') $('#rules').classList.add('hidden'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#rules').classList.add('hidden'); $('#avatar-modal').classList.add('hidden'); $('#log-area').classList.remove('open'); ui.logOpen = false; } });
  const soundBtn = $('#btn-sound'); soundBtn.classList.toggle('muted', !sfx.enabled);
  soundBtn.addEventListener('click', () => soundBtn.classList.toggle('muted', !sfx.toggle()));
  $('#btn-lang').addEventListener('click', () => { I18N.set(I18N.lang === 'en' ? 'tn' : 'en'); applyLanguage(); sfx.play('click'); });
  const setLog = (open) => { ui.logOpen = open; $('#log-area').classList.toggle('open', open); if (open) { ui.unread = 0; $('#log-badge').classList.add('hidden'); const el = $('#log'); el.scrollTop = el.scrollHeight; } };
  $('#btn-log').addEventListener('click', () => setLog(!ui.logOpen));
  $('#btn-log-close').addEventListener('click', () => setLog(false));

  // ───────── avatar picker ─────────
  function renderProfileUI() {
    const prev = myProfilePreview(); prev.id = 'me';
    if (profile.avatar === 'custom' && profile.avatarData) customAvatars.me = profile.avatarData;
    const set = (sel) => { const el = $(sel); if (!el) return; el.style.setProperty('--bg', profile.color || '#6b5d45'); el.classList.toggle('auto', !profile.color); const img = $('img', el); if (img) img.src = avatarSrc(prev); };
    set('#home-avatar'); set('#picker-preview');
    $('#avatar-grid').innerHTML = DEFAULT_AVATARS.map(a => `<button class="av-opt ${profile.avatar === a ? 'sel' : ''}" data-av="${a}" style="--bg:${profile.color || '#6b5d45'}"><img src="img/avatars/${a}.webp" alt="${a}" /></button>`).join('') +
      `<button class="av-opt upload ${profile.avatar === 'custom' ? 'sel' : ''}" id="av-upload" style="--bg:${profile.color || '#6b5d45'}">${profile.avatar === 'custom' && profile.avatarData ? `<img src="${profile.avatarData}" alt="" />` : `<svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M12 3 7 8h3v6h4V8h3l-5-5zM5 18v2h14v-2H5z"/></svg>`}<span>${t('profile.upload')}</span></button>`;
    $('#color-row').innerHTML = `<button class="color-chip auto ${!profile.color ? 'sel' : ''}" data-color="" title="${esc(t('profile.auto'))}">A</button>` + PALETTE.map(c => `<button class="color-chip ${profile.color === c.color ? 'sel' : ''}" data-color="${c.color}" style="--c:${c.color}" title="${esc(cname(c.name))}"></button>`).join('');
    $$('#avatar-grid .av-opt[data-av]').forEach(b => b.addEventListener('click', () => { profile.avatar = b.dataset.av; profile.avatarData = null; commitProfile(); }));
    $('#av-upload').addEventListener('click', () => $('#avatar-file').click());
    $$('#color-row .color-chip').forEach(b => b.addEventListener('click', () => { profile.color = b.dataset.color || null; commitProfile(); }));
  }
  function commitProfile() { saveProfile(); renderProfileUI(); if (room && socket && socket.connected) emit('set_profile', { profile }); }
  $('#avatar-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return; e.target.value = '';
    try {
      const url = URL.createObjectURL(file); const img = new Image(); await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = url; });
      const W = 160, H = 176, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const cx = cv.getContext('2d');
      const sc = Math.max(W / img.width, H / img.height); const dw = img.width * sc, dh = img.height * sc; cx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh); URL.revokeObjectURL(url);
      let data = cv.toDataURL('image/webp', 0.82); if (!data.startsWith('data:image/webp')) data = cv.toDataURL('image/jpeg', 0.8);
      if (data.length > 110000) { data = cv.toDataURL('image/jpeg', 0.6); }
      if (data.length > 110000) return toast(t('profile.tooBig'));
      profile.avatar = 'custom'; profile.avatarData = data; commitProfile();
    } catch { toast(t('toast.error')); }
  });
  const openPicker = () => { renderProfileUI(); $('#avatar-modal').classList.remove('hidden'); };
  $('#btn-avatar').addEventListener('click', openPicker);
  $('#btn-avatar-lobby').addEventListener('click', openPicker);
  $('#btn-avatar-done').addEventListener('click', () => $('#avatar-modal').classList.add('hidden'));
  $('#avatar-modal').addEventListener('click', (e) => { if (e.target.id === 'avatar-modal') $('#avatar-modal').classList.add('hidden'); });

  // prefill from invite link / saved name
  const params = new URLSearchParams(location.search);
  if (params.get('room')) { $('#code').value = params.get('room').toUpperCase(); autoJoinCode = $('#code').value; }
  if (params.get('lang')) I18N.set(params.get('lang'));
  $('#name').value = localStorage.getItem('mekina.name') || '';
  $('#name').addEventListener('input', () => localStorage.setItem('mekina.name', $('#name').value));

  // preload card art
  for (const c of CHARACTERS) { const im = new Image(); im.src = CH[c].card; const im2 = new Image(); im2.src = CH[c].cardSm; }
  applyLanguage();
  slideshow.start();
  show('home');
  connect();
})();
