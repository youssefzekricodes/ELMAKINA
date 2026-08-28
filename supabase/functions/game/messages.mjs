/* Shared message catalog (edge function + client). Log entries carry {key, params}; text is rendered per language.
   Languages: en (English), tn (Tunisian Derja, Arabic script). ESM — imported by the Supabase Edge Function and the Vite client. */

const names = {
  en: { taxman: 'Tax Man', businesswoman: 'Business Woman', police: 'Police', terrorist: 'Terrorist', colonel: 'Colonel', politician: 'Politician', thief: 'Thief' },
  tn: { taxman: 'القبّاض', businesswoman: 'مرا بزنس', police: 'البوليس', terrorist: 'الإرهابي', colonel: 'الكولونال', politician: 'السياسي', thief: 'السارق' },
};
const reasons = {
  en: { paidkill: 'Paid Kill', terrorist: 'Terrorist', colonel_correct: 'Colonel guessed correctly', lost_challenge: 'lost challenge', caught_bluffing: 'caught bluffing', wrong_guess: 'wrong Colonel guess', paidkill_timeout: 'Paid Kill, timed out', terrorist_timeout: 'Terrorist, timed out', lost_challenge_timeout: 'lost challenge, timed out', caught_bluffing_timeout: 'caught bluffing, timed out', left: 'left the game' },
  tn: { paidkill: 'قتلة خالصة', terrorist: 'الإرهابي', colonel_correct: 'الكولونال عرفها', lost_challenge: 'خسر التحدّي', caught_bluffing: 'انكشف الكذّاب', wrong_guess: 'الكولونال غلط', paidkill_timeout: 'قتلة خالصة، خرج الوقت', terrorist_timeout: 'الإرهابي، خرج الوقت', lost_challenge_timeout: 'خسر التحدّي، خرج الوقت', caught_bluffing_timeout: 'انكشف الكذّاب، خرج الوقت', left: 'خرج من اللعبة' },
};
const whats = {
  en: { inspection: 'the inspection', kill: 'the kill', theft: 'the theft' },
  tn: { inspection: 'التفتيش', kill: 'القتلة', theft: 'السرقة' },
};
const log = {
  en: {
    'game.start': 'Game started with {n} players. Everyone gets {hand} cards and 2 coins.',
    'game.order': 'Turn order: {names}.',
    'game.win': '🏆 {name} wins ELMAKINA!',
    'game.nobody': 'Nobody survived.',
    'card.lost': '{name} loses a card ({reason}). {left} left.',
    'elim.bounty': '☠ {name} is eliminated! Their {bounty} coins go to {killer} ({gain}).',
    'elim.bank': '☠ {name} is eliminated! Their {bounty} coins return to the bank.',
    'elim.plain': '☠ {name} is eliminated!',
    'elim.left': '🚪 {name} left the game — their cards go back to the deck.',
    'income': '{name} takes Income ({gain}).',
    'timeout': '{name} ran out of time — Income taken automatically.',
    'disconnected': '{name} is disconnected — Income taken automatically.',
    'loan.ask': '{name} asks the bank for a Loan (2 coins). A Tax Man may veto it.',
    'loan.get': '{name} receives the Loan ({gain}).',
    'loan.veto': '{blocker} claims Tax Man and vetoes {name}\'s Loan!',
    'loan.vetoed': 'The Loan is vetoed. {name} gets nothing.',
    'loan.vetofail': 'The veto fails. {name} receives the Loan ({gain}).',
    'paidkill': '{name} pays 7 coins for a Paid Kill on {target}. {target} may pay 9 coins to survive.',
    'claim.terrorist': '{name} claims Terrorist and pays 3 coins to kill a card of {target}.',
    'claim.colonel': '{name} claims Colonel and pays 4 coins: "{target} holds a {guess}!"',
    'claim.businesswoman': '{name} claims Business Woman to take 4 coins. A Tax Man may take 1 of them.',
    'claim.taxman': '{name} claims Tax Man to collect wealth tax (1 coin) from {target}.',
    'claim.police.self': '{name} claims Police to inspect one of their own cards.',
    'claim.police': '{name} claims Police to inspect a card of {target}.',
    'claim.politician': '{name} claims Politician to swap their entire hand.',
    'claim.thief': '{name} claims Thief to steal 2 coins from {target}.',
    'action.fail': '{name}\'s action fails.',
    'block.claim': '{name} claims {character} to block {what}!',
    'block.ok': '{What} is blocked.',
    'block.fail': 'The block fails — {what} proceeds.',
    'bw.out': '{name} is out — nothing to collect.',
    'bw.take4': '{name} takes 4 coins as Business Woman ({gain}).',
    'bw.taxed': '{name} keeps {kept} of the 4 coins ({gain}); Tax Man cut: {parts}.',
    'bw.taxclaim': '{name} claims Tax Man and reaches for 1 of {target}\'s 4 coins!',
    'actor.out': '{name} is out — the action is void.',
    'tax.nothing': '{name} has nothing to tax.',
    'tax.take': '{name} collects 1 coin of wealth tax from {target} ({gain}).',
    'colonel.targetout': '{name} is already out — the guess is void.',
    'colonel.right': 'Correct! {target} really holds a {guess} and loses it. The 4 coins go to the bank.',
    'colonel.wrong': 'Wrong! {target} does not hold a {guess}. {name} loses a random card and {target} receives the 4 coins ({gain}).',
    'politician.swap': '{name} returns all {n} cards to the deck and draws {n} new ones.',
    'steal.out': '{name} is out — nothing to steal.',
    'steal': '{name} steals {n} coins from {target} ({gain}).',
    'police.nocards': '{name} has no cards to inspect.',
    'police.look.self': '{name} secretly inspects one of their own cards and decides whether to swap it.',
    'police.look': '{name} secretly inspects card #{slot} of {target} and decides whether to swap it.',
    'police.swap': '{name} swaps the inspected card with the front card of the deck.',
    'police.keep': '{name} leaves the inspected card in place.',
    'kill.out': '{name} is already out — nothing happens.',
    'kill.survive': '{name} pays 9 coins to the bank and survives the {reason}!',
    'bluff.true': '{challenger} calls the bluff — but {name} reveals a {character}! The claim was true; {challenger} loses a card of their choice.',
    'bluff.replace': '{name} returns the revealed {character} to the deck and draws a replacement.',
    'bluff.caught': '{challenger} calls the bluff — {name} was lying about {character} and loses a card of their choice. The action is stopped.',
  },
  tn: {
    'game.start': 'بدات اللعبة بـ {n} لعّابة. الكل ياخو {hand} كروت و 2 دينار.',
    'game.order': 'الدور: {names}.',
    'game.win': '🏆 {name} ربح الماكينة!',
    'game.nobody': 'حتّى حدّ ما نجى.',
    'card.lost': '{name} خسر كارطة ({reason}). بقاتلو {left}.',
    'elim.bounty': '☠ {name} خرج من اللعبة! الـ{bounty} دينار متاعو مشاو لـ {killer} ({gain}).',
    'elim.bank': '☠ {name} خرج من اللعبة! الـ{bounty} دينار متاعو رجعو للبنكة.',
    'elim.plain': '☠ {name} خرج من اللعبة!',
    'elim.left': '🚪 {name} مشا و خلّى اللعبة — كروتو رجعو للكومة.',
    'income': '{name} خذا الدخل ({gain}).',
    'timeout': '{name} خرجلو الوقت — خذا الدخل وحدو.',
    'disconnected': '{name} مقطوع — خذا الدخل وحدو.',
    'loan.ask': '{name} طلب سلفة من البنكة (2 دينار). القبّاض ينجم يمنعها.',
    'loan.get': '{name} خذا السلفة ({gain}).',
    'loan.veto': '{blocker} قال راهو القبّاض و منع السلفة متاع {name}!',
    'loan.vetoed': 'السلفة ممنوعة. {name} ما خذا شي.',
    'loan.vetofail': 'المنع ما نجحش. {name} خذا السلفة ({gain}).',
    'paidkill': '{name} خلّص 7 دينار باش يقتل كارطة متاع {target}. {target} ينجم يخلّص 9 دينار و ينجى.',
    'claim.terrorist': '{name} قال راهو الإرهابي و خلّص 3 دينار باش يقتل كارطة متاع {target}.',
    'claim.colonel': '{name} قال راهو الكولونال و خلّص 4 دينار: "{target} عندو {guess}!"',
    'claim.businesswoman': '{name} قالت/قال راهو مرا بزنس باش ياخو 4 دينار. القبّاض ينجم ياخو واحد منهم.',
    'claim.taxman': '{name} قال راهو القبّاض باش يقبض ضريبة (دينار) من {target}.',
    'claim.police.self': '{name} قال راهو البوليس باش يشوف كارطة من كروتو.',
    'claim.police': '{name} قال راهو البوليس باش يشوف كارطة متاع {target}.',
    'claim.politician': '{name} قال راهو السياسي باش يبدّل كروتو الكل.',
    'claim.thief': '{name} قال راهو السارق باش يسرق 2 دينار من {target}.',
    'action.fail': 'الحركة متاع {name} طاحت.',
    'block.claim': '{name} قال راهو {character} باش يصدّ {what}!',
    'block.ok': '{What} تصدّت.',
    'block.fail': 'الصدّ ما نجحش — {what} تكمّل.',
    'bw.out': '{name} خرج — ما ثمّا شي ياخوه.',
    'bw.take4': '{name} خذا 4 دينار كمرا بزنس ({gain}).',
    'bw.taxed': '{name} خلّى {kept} من الـ4 دينار ({gain})؛ حصّة القبّاض: {parts}.',
    'bw.taxclaim': '{name} قال راهو القبّاض و مدّ يدّو لدينار من الـ4 متاع {target}!',
    'actor.out': '{name} خرج — الحركة ملغاة.',
    'tax.nothing': '{name} ما عندو شي يتقبض.',
    'tax.take': '{name} قبض دينار ضريبة من {target} ({gain}).',
    'colonel.targetout': '{name} خرج من قبل — التخمين ملغي.',
    'colonel.right': 'صحيح! {target} عندو {guess} بالحقّ و خسرها. الـ4 دينار مشاو للبنكة.',
    'colonel.wrong': 'غالط! {target} ما عندوش {guess}. {name} خسر كارطة بالصدفة و {target} خذا الـ4 دينار ({gain}).',
    'politician.swap': '{name} رجّع الـ{n} كروت متاعو للكومة و خذا {n} جداد.',
    'steal.out': '{name} خرج — ما ثمّا شي يتسرق.',
    'steal': '{name} سرق {n} دينار من {target} ({gain}).',
    'police.nocards': '{name} ما عندوش كروت للتفتيش.',
    'police.look.self': '{name} شاف كارطة من كروتو بالسرّ و يقرّر يبدّلها ولا لا.',
    'police.look': '{name} شاف الكارطة رقم {slot} متاع {target} بالسرّ و يقرّر يبدّلها ولا لا.',
    'police.swap': '{name} بدّل الكارطة بالكارطة اللي فوق في الكومة.',
    'police.keep': '{name} خلّى الكارطة في بلاصتها.',
    'kill.out': '{name} خرج من قبل — ما صار شي.',
    'kill.survive': '{name} خلّص 9 دينار للبنكة و نجى من {reason}!',
    'bluff.true': '{challenger} قال كذّاب — أما {name} ورّى {character}! كان صادق؛ {challenger} يختار كارطة يخسرها.',
    'bluff.replace': '{name} رجّع {character} اللي ورّاها للكومة و خذا وحدة أخرى.',
    'bluff.caught': '{challenger} قال كذّاب — {name} كان يكذب على {character} و يختار كارطة يخسرها. الحركة وقفت.',
  },
};
const CHAR_KEYS = new Set(['character', 'guess']);
function gainStr(lang, g) {
  if (!g || typeof g !== 'object') return String(g);
  if (g.got < g.n) return lang === 'tn' ? `+${g.got} (الحدّ ${g.max})` : `+${g.got} (capped at ${g.max})`;
  return `+${g.got}`;
}
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function format(lang, key, params = {}) {
  const L = log[lang] && log[lang][key] ? lang : 'en';
  const tpl = (log[L] && log[L][key]) || key;
  return tpl.replace(/\{(\w+)\}/g, (m, k) => {
    const lower = k.toLowerCase();
    let v = params[lower] !== undefined ? params[lower] : params[k];
    if (v === undefined) return m;
    if (CHAR_KEYS.has(lower)) v = (names[lang] && names[lang][v]) || names.en[v] || v;
    else if (lower === 'reason') v = (reasons[lang] && reasons[lang][v]) || reasons.en[v] || v;
    else if (lower === 'what') v = (whats[lang] && whats[lang][v]) || whats.en[v] || v;
    else if (lower === 'gain') v = gainStr(lang, v);
    else if (Array.isArray(v)) v = v.map(x => typeof x === 'object' ? `${x.name} ${gainStr(lang, x.gain)}` : x).join(lower === 'names' ? ' → ' : ', ');
    if (k !== lower && k[0] === k[0].toUpperCase()) v = cap(String(v));
    return String(v);
  });
}
export const LANGS = ['en', 'tn'];
export { names, reasons, whats, log, format, gainStr };
