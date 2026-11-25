// speechText.js — Normalizes liturgical, biblical & Spanish punctuation for human-sounding TTS
// Prevents neural TTS from speaking "barra", "punto", "coma", "uve punto", or Roman numeral letters.

const BIBLE_BOOKS = {
  mt: 'San Mateo',
  mc: 'San Marcos',
  lc: 'San Lucas',
  jn: 'San Juan',
  hch: 'Hechos de los Apóstoles',
  hech: 'Hechos de los Apóstoles',
  rm: 'Romanos',
  rom: 'Romanos',
  gal: 'Gálatas',
  gál: 'Gálatas',
  ef: 'Efesios',
  flp: 'Filipenses',
  fil: 'Filipenses',
  col: 'Colosenses',
  tit: 'Tito',
  heb: 'Hebreos',
  sant: 'Santiago',
  stgo: 'Santiago',
  ap: 'Apocalipsis',
  apoc: 'Apocalipsis',
  sal: 'Salmo',
  sl: 'Salmo',
  gn: 'Génesis',
  gén: 'Génesis',
  gen: 'Génesis',
  ex: 'Éxodo',
  éx: 'Éxodo',
  lv: 'Levítico',
  lev: 'Levítico',
  nm: 'Números',
  núm: 'Números',
  num: 'Números',
  dt: 'Deuteronomio',
  is: 'Isaías',
  jer: 'Jeremías',
  ez: 'Ezequiel',
  dn: 'Daniel',
  sab: 'Sabiduría',
  eclo: 'Eclesiástico',
  sir: 'Eclesiástico',
  prov: 'Proverbios',
  pr: 'Proverbios',
  jb: 'Job',
  os: 'Oseas',
  jl: 'Joel',
  am: 'Amós',
  miq: 'Miqueas',
  zac: 'Zacarías',
  mal: 'Malaquías',
};

const NUMBERED_BOOKS = {
  cor: 'de Corintios',
  tes: 'de Tesalonicenses',
  tim: 'de Timoteo',
  tm: 'de Timoteo',
  pe: 'de San Pedro',
  ped: 'de San Pedro',
  jn: 'de San Juan',
  re: 'de los Reyes',
  rey: 'de los Reyes',
  sam: 'de Samuel',
  cr: 'de las Crónicas',
  mac: 'de los Macabeos',
};

const ROMAN_MAP = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10,
  XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15, XVI: 16, XVII: 17, XVIII: 18, XIX: 19, XX: 20,
  XXI: 21, XXII: 22, XXIII: 23, XXIV: 24, XXV: 25, XXVI: 26, XXVII: 27, XXVIII: 28, XXIX: 29, XXX: 30,
  XXXI: 31, XXXII: 32, XXXIII: 33, XXXIV: 34, XXXV: 35,
};

function expandVerseSpan(spanRaw) {
  const cleaned = String(spanRaw || '')
    .replace(/(\d+)[a-d]+/gi, '$1')
    .replace(/\s+/g, '');
  const nums = cleaned.match(/\d+/g);
  if (!nums || nums.length === 0) return '';
  if (nums.length === 1) return `versículo ${nums[0]}`;
  const first = nums[0];
  const last = nums[nums.length - 1];
  if (first === last) return `versículo ${first}`;
  return `versículos del ${first} al ${last}`;
}

function formatTextForSpeech(raw) {
  if (!raw) return '';
  let t = String(raw);

  // Strip URLs & email addresses so TTS never reads domains/slashes
  t = t
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b(?:www\.)?[a-z0-9.-]+\.(?:com|org|net|tech|do)(?:\.[a-z]{2})?\b/gi, ' ')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, ' ');

  // Normalize liturgical markers BEFORE stripping punctuation
  t = t
    .replace(/(^|[\s\n])R\s*\/\s*\.\s*/g, '$1Respondemos: ')
    .replace(/(^|[\s\n])R\.\s+/g, '$1Respondemos: ')
    .replace(/(^|[\s\n])V\s*\/\s*\.\s*/g, '$1')
    .replace(/(^|[\s\n])V\.\s+/g, '$1');

  // Remove liturgical color slash list e.g. "Color: VERDE/ROJO/BLANCO"
  t = t.replace(/Color\s*:\s*([A-Za-zÁÉÍÓÚÑ]+(?:\s*\/\s*[A-Za-zÁÉÍÓÚÑ]+)+)/gi, (_, colors) => {
    const list = colors.split('/').map((s) => s.trim().toLowerCase()).join(', o ');
    return `Color litúrgico: ${list}.`;
  });

  // Normalize am/pm times with slashes like "6am / 12pm / 6pm" -> natural Spanish
  t = t.replace(/\b(\d{1,2})(?::(\d{2}))?\s*(am|a\.m\.|pm|p\.m\.)\b/gi, (_, h, m, ap) => {
    const hour = Number(h);
    const min = m && Number(m) > 0 ? ` y ${Number(m)}` : '';
    const isAm = /^a/i.test(ap);
    const period = isAm ? 'de la mañana' : hour === 12 ? 'del mediodía' : hour >= 19 ? 'de la noche' : 'de la tarde';
    return `${hour}${min} ${period}`;
  });

  // Expand numbered biblical citations like "1 Cor 12, 12" or "2 Tim 4/6-8"
  t = t.replace(
    /\b([1-3])\s*(Cor|Tes|Tim|Tm|Pe|Ped|Jn|Re|Rey|Sam|Cr|Mac)\.?\s*(\d{1,3})\s*[,:/]\s*([\d\s.,–—\-a-d]+)/gi,
    (_, num, bk, ch, vs) => {
      const ord = num === '1' ? 'Primera' : num === '2' ? 'Segunda' : 'Tercera';
      const book = NUMBERED_BOOKS[bk.toLowerCase()] || bk;
      return `${ord} ${book}, capítulo ${ch}, ${expandVerseSpan(vs)}. `;
    }
  );

  // Expand single-word biblical citations like "Mt 2/15", "Ap 14,1-3.4b-5", "Lc 21,1-4"
  t = t.replace(
    /\b(Mt|Mc|Lc|Jn|Hch|Hech|Rm|Rom|G[aá]l|Ef|Flp|Fil|Col|Tit|Heb|Sant|Stgo|Ap|Apoc|Sal|Sl|G[eé]n|Gen|[EÉ]x|Lv|Lev|N[uú]m|Num|Dt|Is|Jer|Ez|Dn|Sab|Eclo|Sir|Prov|Pr|Jb|Os|Jl|Am|Miq|Zac|Mal)\.?\s+(\d{1,3})\s*[,:/]\s*([\d.,–—\-a-d]+)/gi,
    (_, bk, ch, vs) => {
      const key = bk.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const fullBook = BIBLE_BOOKS[bk.toLowerCase()] || BIBLE_BOOKS[key] || bk;
      if (key === 'sal' || key === 'sl') {
        return `Salmo ${ch}, ${expandVerseSpan(vs)}. `;
      }
      return `${fullBook}, capítulo ${ch}, ${expandVerseSpan(vs)}. `;
    }
  );

  // Expand bare Psalm number-verse clusters e.g. "Salmo responsorial: 23,1-2.3-4ab.5-6"
  t = t.replace(
    /\b(Salmo(?:\s+responsorial)?)\s*[:.]?\s*(\d{1,3})\s*[,:/]\s*([\d.,–—\-a-d]+)/gi,
    (_, lbl, ch, vs) => `${lbl} ${ch}, ${expandVerseSpan(vs)}. `
  );

  // Also catch full book names followed by slash or comma citations like "Mateo 2/15" or "Mateo 2,15"
  t = t.replace(
    /\b(Mateo|Marcos|Lucas|Juan|Apocalipsis|Génesis|Éxodo|Isaías|Jeremías|Romanos|Gálatas|Efesios|Filipenses|Colosenses|Hebreos|Santiago)\s+(\d{1,3})\s*[,:/]\s*([\d.,–—\-a-d]+)/gi,
    (_, book, ch, vs) => `${book}, capítulo ${ch}, ${expandVerseSpan(vs)}. `
  );

  // Expand common clerical/common abbreviations so TTS doesn't pause awkwardly on "."
  t = t
    .replace(/\bS\.S\.\s*/g, 'Su Santidad ')
    .replace(/\bS\.E\.R\.\s*/g, 'Su Eminencia ')
    .replace(/\bMons\.\s*/gi, 'Monseñor ')
    .replace(/\bDiác\.\s*/gi, 'Diácono ')
    .replace(/\bHno\.\s*/gi, 'Hermano ')
    .replace(/\bHna\.\s*/gi, 'Hermana ')
    .replace(/\bSem\.\s*/gi, 'Seminarista ')
    .replace(/\bSto\.\s*/gi, 'Santo ')
    .replace(/\bSta\.\s*/gi, 'Santa ')
    .replace(/\bP\.\s+(?=[A-ZÁÉÍÓÚÑ])/g, 'Padre ')
    .replace(/\betc\./gi, 'etcétera');

  // Expand Roman numerals (weeks, popes, saints) cleanly
  t = t.replace(/\b(Papa|San|Santa|Juan Pablo|Benedicto|Clemente|Pío|León|Inocencio|Paulo|Gregorio)\s+I\b(?=[,.\s:;]|$)/g, '$1 primero');
  t = t.replace(/\b(XXXV|XXXIV|XXXIII|XXXII|XXXI|XXX|XXIX|XXVIII|XXVII|XXVI|XXV|XXIV|XXIII|XXII|XXI|XX|XIX|XVIII|XVII|XVI|XV|XIV|XIII|XII|XI|X|IX|VIII|VII|VI|IV|III|II)\b\.?/g, (m, r) => {
    const val = ROMAN_MAP[r];
    return val ? String(val) : m;
  });

  // Replace remaining slashes, decorative dots, bullets, bars, emojis & quotation symbols with quiet pauses
  t = t
    .replace(/\s*\/\s*/g, ', ')
    .replace(/[·•|✦✝📿🕯️🕊️📖🔊📻🎵🙏🎉⛪]+/g, ', ')
    .replace(/[«»“”"]/g, ' ')
    .replace(/[–—]/g, ', ')
    .replace(/\r?\n{2,}/g, '. ')
    .replace(/\r?\n/g, ', ')
    // Remove punctuation sequences like ", ." or ": ," or "..." collisions
    .replace(/[,;:]\s*\./g, '.')
    .replace(/\.\s*[,;:]/g, '.')
    .replace(/\s+([,.;:?!])/g, '$1')
    .replace(/([,.;:])\1+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return t;
}

module.exports = { formatTextForSpeech };
