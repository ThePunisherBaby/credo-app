// rosaryRadio.js — 24/7 Automated Live Rosary Radio Service on VPS
// Timezone: America/Santo_Domingo (UTC-4)
// Scheduled Group Rosaries: 07:00, 14:00 (2 PM), 16:00 (4 PM), 20:00 (8 PM)
// Features:
// 1. Complete 5-decade (50 Ave Marías) Antiphonal Human Neural Voice Rosary (es-DO-EmilioNeural + es-DO-RamonaNeural)
//    mixed over continuous YouTube Catholic Piano Prayer Music (bg_music.mp3).
// 2. Continuous between-hours Catholic Instrumental Background Music from YouTube + human voice schedule announcements.
// 3. Full YouTube Rosary & Catholic Instrumental Music Repertoire by Day (Gozosos, Dolorosos, Gloriosos, Luminosos)
//    with background yt-dlp audio extraction & caching.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { pool } = require('../db/pool');

const CACHE_DIR = path.join(os.tmpdir(), 'credo-rosary-v2');
const BUNDLED_BG_MUSIC = path.join(__dirname, '..', 'assets', 'bg_music.mp3');
const SCHEDULE_HOURS = [7, 14, 16, 20]; // 7 AM, 2 PM, 4 PM, 8 PM RD time
const ROSARY_DURATION_MIN = 25;

const VOICE_LEADER = 'es-DO-EmilioNeural';
const VOICE_RESPONSE = 'es-DO-RamonaNeural';

const YOUTUBE_REPERTOIRE = {
  joyful: [
    {
      youtube_id: '5L5WfZIrUhQ',
      slot_type: 'joyful',
      title: 'Santo Rosario Completo: Misterios Gozosos (Lunes y Sábado)',
      days_label: 'Lunes, Sábados y Domingos de Adviento/Navidad',
      duration_label: '23:46',
    },
    {
      youtube_id: 'hvXmQKIOSNs',
      slot_type: 'joyful',
      title: 'Rezo del Santo Rosario Meditado · Misterios Gozosos',
      days_label: 'Lunes y Sábados',
      duration_label: '35:43',
    },
    {
      youtube_id: 'QxxNrw0U3gw',
      slot_type: 'joyful',
      title: 'Santo Rosario Cantado y Rezado · Misterios de Gozo',
      days_label: 'Lunes y Sábados',
      duration_label: '30:42',
    },
  ],
  sorrowful: [
    {
      youtube_id: 'I4oqxPybPgU',
      slot_type: 'sorrowful',
      title: 'Santo Rosario Completo: Misterios Dolorosos (Martes y Viernes)',
      days_label: 'Martes, Viernes y Domingos de Cuaresma',
      duration_label: '23:45',
    },
    {
      youtube_id: '7FsW_Jh8bf8',
      slot_type: 'sorrowful',
      title: 'Santo Rosario en Audio · Misterios de Dolor',
      days_label: 'Martes y Viernes',
      duration_label: '27:56',
    },
    {
      youtube_id: 'TlauNBHumgw',
      slot_type: 'sorrowful',
      title: 'Rezo del Santo Rosario Meditado · Misterios Dolorosos',
      days_label: 'Martes y Viernes',
      duration_label: '36:34',
    },
  ],
  glorious: [
    {
      youtube_id: 'Ojvu3uBzsXM',
      slot_type: 'glorious',
      title: 'Santo Rosario Completo: Misterios Gloriosos (Miércoles y Domingo)',
      days_label: 'Miércoles y Domingos (Tiempo Ordinario y Pascua)',
      duration_label: '23:51',
    },
    {
      youtube_id: 'z_iVG1Z8-EU',
      slot_type: 'glorious',
      title: 'Santo Rosario en Audio · Misterios de Gloria',
      days_label: 'Miércoles y Domingos',
      duration_label: '27:52',
    },
    {
      youtube_id: 'ByEH_HgNJ_g',
      slot_type: 'glorious',
      title: 'Rezo del Santo Rosario Meditado · Misterios Gloriosos',
      days_label: 'Miércoles y Domingos',
      duration_label: '36:32',
    },
  ],
  luminous: [
    {
      youtube_id: 'wZIFINvqbJw',
      slot_type: 'luminous',
      title: 'Santo Rosario Completo: Misterios Luminosos (Jueves)',
      days_label: 'Jueves · Misterios de la Luz',
      duration_label: '26:50',
    },
    {
      youtube_id: '9jfXKoC070s',
      slot_type: 'luminous',
      title: 'Santo Rosario en Audio · Misterios de Luz',
      days_label: 'Jueves',
      duration_label: '28:00',
    },
    {
      youtube_id: 'B79gFxsUju8',
      slot_type: 'luminous',
      title: 'El Santo Rosario Meditado con Audio Completo · Misterios Luminosos',
      days_label: 'Jueves',
      duration_label: '24:27',
    },
  ],
  music: [
    {
      youtube_id: 'JQWDKns81mc',
      slot_type: 'music',
      title: 'Piano Solo · Música Católica Instrumental para Orar (Tobías Buteler)',
      days_label: 'Música de fondo continua 24/7 entre Rosarios',
      duration_label: '43:43',
    },
    {
      youtube_id: '1lRSF-U0v64',
      slot_type: 'music',
      title: 'Instrumental Católico para Orar y Meditar en Silencio',
      days_label: 'Música de fondo continua 24/7 entre Rosarios',
      duration_label: '63:09',
    },
    {
      youtube_id: 'chhJaMqQXRs',
      slot_type: 'music',
      title: 'Siente la Paz de Dios · Música Católica Suave de Adoración',
      days_label: 'Música de fondo continua 24/7 entre Rosarios',
      duration_label: '60:42',
    },
  ],
};

const MYSTERIES = {
  joyful: {
    key: 'joyful',
    name: 'Misterios Gozosos',
    daysLabel: 'Lunes, Sábados y Domingos de Adviento/Navidad',
    youtube_id: '5L5WfZIrUhQ',
    list: [
      'Primer Misterio Gozoso: La Encarnación del Hijo de Dios en el seno purísimo de la Virgen María. Meditemos en el sí humilde de María: He aquí la esclava del Señor, hágase en mí según tu palabra.',
      'Segundo Misterio Gozoso: La Visitación de Nuestra Señora a su prima Santa Isabel. María lleva a Jesús en su vientre y llena de alegría y del Espíritu Santo el hogar de Isabel.',
      'Tercer Misterio Gozoso: El Nacimiento del Niño Jesús en el portal de Belén. El Verbo de Dios se hace niño pobre y humilde para salvarnos y traernos la paz verdadera.',
      'Cuarto Misterio Gozoso: La Presentación del Niño Jesús en el Templo y la Purificación de Nuestra Señora. Simeón reconoce al Mesías como Luz para alumbrar a las naciones.',
      'Quinto Misterio Gozoso: El Niño Jesús perdido y hallado en el Templo entre los doctores de la Ley. Jesús nos recuerda que debemos ocuparnos primero de las cosas del Padre celestial.',
    ],
  },
  sorrowful: {
    key: 'sorrowful',
    name: 'Misterios Dolorosos',
    daysLabel: 'Martes, Viernes y Domingos de Cuaresma',
    youtube_id: 'I4oqxPybPgU',
    list: [
      'Primer Misterio Doloroso: La Oración y Agonía de Nuestro Señor Jesucristo en el Huerto de Getsemaní. Padre, si es posible, pase de mí este cáliz; pero no se haga mi voluntad, sino la tuya.',
      'Segundo Misterio Doloroso: La Flagelación de Nuestro Señor Jesucristo atado a la columna. Por sus llagas hemos sido sanados y reconciliados con Dios.',
      'Tercer Misterio Doloroso: La Coronación de espinas de Nuestro Señor Jesucristo. Jesús acepta la humillación por amor para reinar en nuestros corazones con misericordia.',
      'Cuarto Misterio Doloroso: Nuestro Señor Jesucristo carga con la Cruz camino del monte Calvario. El que quiera venir en pos de mí, tome su cruz de cada día y sígame.',
      'Quinto Misterio Doloroso: La Crucifixión y Muerte de Nuestro Señor Jesucristo en la Cruz. Padre, perdónalos porque no saben lo que hacen. En tus manos encomiendo mi espíritu.',
    ],
  },
  glorious: {
    key: 'glorious',
    name: 'Misterios Gloriosos',
    daysLabel: 'Miércoles y Domingos (Tiempo Ordinario y Pascua)',
    youtube_id: 'Ojvu3uBzsXM',
    list: [
      'Primer Misterio Glorioso: La Triunfante Resurrección de Nuestro Señor Jesucristo. Cristo ha vencido a la muerte y nos abre las puertas de la vida eterna.',
      'Segundo Misterio Glorioso: La Admirable Ascensión de Nuestro Señor Jesucristo al Cielo. Jesús sube al Padre y nos promete estar con nosotros todos los días hasta el fin del mundo.',
      'Tercer Misterio Glorioso: La Venida del Espíritu Santo sobre María Santísima y los Apóstoles en Pentecostés. Ven, Espíritu Santo, llena los corazones de tus fieles y enciende en ellos el fuego de tu amor.',
      'Cuarto Misterio Glorioso: La Asunción de la Santísima Virgen María en cuerpo y alma al Cielo. María, llena de gracia, es recibida en la gloria celestial por su Hijo Jesucristo.',
      'Quinto Misterio Glorioso: La Coronación de María Santísima como Reina y Madre de todo lo creado. Bajo tu amparo nos acogemos, Santa Madre de Dios.',
    ],
  },
  luminous: {
    key: 'luminous',
    name: 'Misterios Luminosos',
    daysLabel: 'Jueves · Misterios de la Luz',
    youtube_id: 'wZIFINvqbJw',
    list: [
      'Primer Misterio Luminoso: El Bautismo de Jesús en el río Jordán. Los cielos se abren y la voz del Padre proclama: Este es mi Hijo amado, en quien me complazco.',
      'Segundo Misterio Luminoso: La Autorrevelación de Jesús en las bodas de Caná. María nos dice hoy como a los sirvientes: Hagan todo lo que Él les diga.',
      'Tercer Misterio Luminoso: El Anuncio del Reino de Dios invitando a la conversión y al perdón de los pecados. El tiempo se ha cumplido y el Reino de Dios está cerca; conviértanse y crean en el Evangelio.',
      'Cuarto Misterio Luminoso: La Transfiguración de Nuestro Señor Jesucristo en el monte Tabor. Su rostro resplandeció como el sol mostrando la gloria divina a Pedro, Santiago y Juan.',
      'Quinto Misterio Luminoso: La Institución de la Santísima Eucaristía en la Última Cena. Tomad y comed, esto es mi Cuerpo; tomad y bebed, esta es mi Sangre entregada por ustedes.',
    ],
  },
};

function computeEasterDate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function getSantoDomingoNow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santo_Domingo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    weekday: 'short',
    hour12: false,
  }).formatToParts(now);

  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const wkMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
    dow: wkMap[map.weekday] ?? now.getUTCDay(),
  };
}

function getLiturgicalContext() {
  const sd = getSantoDomingoNow();
  const todayUTC = new Date(Date.UTC(sd.year, sd.month - 1, sd.day));
  const easter = computeEasterDate(sd.year);
  const diffDays = Math.round((todayUTC - easter) / 86400000);

  const xmas = new Date(Date.UTC(sd.year, 11, 25));
  const xmasDow = xmas.getUTCDay();
  const adventStart = new Date(Date.UTC(sd.year, 11, 25 - (xmasDow === 0 ? 28 : 21 + xmasDow)));

  let season = 'Tiempo Ordinario';
  let seasonCode = 'ordinary';

  if (
    (sd.month === 12 && sd.day >= 25) ||
    (sd.month === 1 && sd.day <= 12)
  ) {
    season = 'Tiempo de Navidad';
    seasonCode = 'christmas';
  } else if (todayUTC >= adventStart && sd.month === 12 && sd.day < 25) {
    season = 'Tiempo de Adviento';
    seasonCode = 'advent';
  } else if (diffDays >= -46 && diffDays < 0) {
    season = diffDays >= -7 ? 'Semana Santa' : 'Tiempo de Cuaresma';
    seasonCode = 'lent';
  } else if (diffDays >= 0 && diffDays <= 49) {
    season = 'Tiempo Pascual';
    seasonCode = 'easter';
  }

  let mysteryKey = 'glorious';
  if (sd.dow === 1 || sd.dow === 6) mysteryKey = 'joyful';
  else if (sd.dow === 2 || sd.dow === 5) mysteryKey = 'sorrowful';
  else if (sd.dow === 4) mysteryKey = 'luminous';
  else if (sd.dow === 0) {
    if (seasonCode === 'advent' || seasonCode === 'christmas') mysteryKey = 'joyful';
    else if (seasonCode === 'lent') mysteryKey = 'sorrowful';
    else mysteryKey = 'glorious';
  }

  const isRosaryHour = SCHEDULE_HOURS.includes(sd.hour) && sd.minute < ROSARY_DURATION_MIN;

  let nextHour = SCHEDULE_HOURS.find(
    (h) => h > sd.hour || (h === sd.hour && sd.minute < ROSARY_DURATION_MIN)
  );
  let daysAhead = 0;
  if (nextHour === undefined) {
    nextHour = SCHEDULE_HOURS[0];
    daysAhead = 1;
  }

  const nowSecOfDay = sd.hour * 3600 + sd.minute * 60 + sd.second;
  const nextStartSec = daysAhead * 86400 + nextHour * 3600;
  const secondsUntilNext = Math.max(0, nextStartSec - nowSecOfDay);

  const fmtHour = (h) => (h === 0 ? '12:00 AM' : h < 12 ? `${h}:00 AM` : h === 12 ? '12:00 PM' : `${h - 12}:00 PM`);

  return {
    timezone: 'America/Santo_Domingo (UTC-4)',
    local_time: `${String(sd.hour).padStart(2, '0')}:${String(sd.minute).padStart(2, '0')}`,
    liturgical_season: season,
    season_code: seasonCode,
    use_regina_caeli: seasonCode === 'easter',
    mystery: MYSTERIES[mysteryKey],
    all_mysteries: MYSTERIES,
    repertoire: YOUTUBE_REPERTOIRE,
    is_live_rosary: isRosaryHour,
    mode: isRosaryHour ? 'rosary' : 'interlude',
    active_slot_label: isRosaryHour ? `${fmtHour(sd.hour)} · Santo Rosario en Vivo` : 'Música Católica de Fondo y Avisos',
    next_rosary_label: fmtHour(nextHour),
    seconds_until_next: secondsUntilNext,
    schedule_hours: SCHEDULE_HOURS.map(fmtHour),
    stream_url: '/api/v1/rosary/stream',
  };
}

function runProcess(cmd, args, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = '';
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-240)}`));
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// Synthesize human neural speech with Microsoft Edge Neural TTS (es-DO-EmilioNeural / es-DO-RamonaNeural)
// Falls back to Google Translate TTS only if edge-tts fails.
async function synthesizeSpeechToFile(text, outPath, voice = VOICE_LEADER) {
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 512) return outPath;
  try {
    await runProcess('edge-tts', [
      '--voice', voice,
      '--rate=-6%',
      '--text', text,
      '--write-media', outPath,
    ], 25000);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 512) return outPath;
  } catch (err) {
    console.warn(`[rosaryRadio] edge-tts fallback (${voice}):`, err.message);
  }

  // Fallback to Google Translate TTS chunked
  const parts = text.match(/.{1,175}(?:\s|$)/g) || [text];
  const bufs = [];
  for (const p of parts) {
    const clean = p.trim();
    if (!clean) continue;
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=es&client=tw-ob&q=${encodeURIComponent(clean)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CredoRadio/2.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) bufs.push(Buffer.from(await res.arrayBuffer()));
  }
  if (bufs.length === 0) throw new Error('Both edge-tts and fallback TTS failed');
  fs.writeFileSync(outPath, Buffer.concat(bufs));
  return outPath;
}

function getBgMusicFile() {
  const ytMusic = path.join(CACHE_DIR, 'music.mp3');
  if (fs.existsSync(ytMusic) && fs.statSync(ytMusic).size > 50000) return ytMusic;
  if (fs.existsSync(BUNDLED_BG_MUSIC)) return BUNDLED_BG_MUSIC;
  return null;
}

const commonPartsPromise = { current: null };

async function ensureCommonPrayerParts() {
  if (commonPartsPromise.current) return commonPartsPromise.current;
  const partsDir = path.join(CACHE_DIR, 'common_parts');
  fs.mkdirSync(partsDir, { recursive: true });

  commonPartsPromise.current = (async () => {
    const defs = [
      {
        name: 'sign_credo.mp3',
        voice: VOICE_LEADER,
        text: 'Por la señal de la Santa Cruz, de nuestros enemigos, líbranos Señor, Dios nuestro. En el nombre del Padre, y del Hijo, y del Espíritu Santo. Amén. Creo en Dios, Padre Todopoderoso, Creador del cielo y de la tierra. Creo en Jesucristo, su único Hijo, Nuestro Señor, que fue concebido por obra y gracia del Espíritu Santo, nació de Santa María Virgen, padeció bajo el poder de Poncio Pilato, fue crucificado, muerto y sepultado, y al tercer día resucitó de entre los muertos.',
      },
      {
        name: 'contrition_resp.mp3',
        voice: VOICE_RESPONSE,
        text: 'Creo en el Espíritu Santo, la santa Iglesia católica, la comunión de los santos, el perdón de los pecados, la resurrección de la carne y la vida eterna. Amén. Señor mío, Jesucristo, Dios y Hombre verdadero, me pesa de todo corazón haber pecado, porque he merecido el infierno y he perdido el cielo, y sobre todo porque te ofendí a ti, que eres bondad infinita. Propongo firmemente, con tu gracia, enmendarme y evitar las ocasiones de pecado. Amén.',
      },
      {
        name: 'pn_leader.mp3',
        voice: VOICE_LEADER,
        text: 'Padre nuestro, que estás en el cielo, santificado sea tu Nombre; venga a nosotros tu Reino; hágase tu voluntad en la tierra como en el cielo.',
      },
      {
        name: 'pn_resp.mp3',
        voice: VOICE_RESPONSE,
        text: 'Danos hoy nuestro pan de cada día; perdona nuestras ofensas, como también nosotros perdonamos a los que nos ofenden; no nos dejes caer en la tentación, y líbranos del mal. Amén.',
      },
      {
        name: 'ave_leader.mp3',
        voice: VOICE_LEADER,
        text: 'Dios te salve, María, llena eres de gracia, el Señor es contigo. Bendita tú eres entre todas las mujeres, y bendito es el fruto de tu vientre, Jesús.',
      },
      {
        name: 'ave_resp.mp3',
        voice: VOICE_RESPONSE,
        text: 'Santa María, Madre de Dios, ruega por nosotros, pecadores, ahora y en la hora de nuestra muerte. Amén.',
      },
      {
        name: 'gloria_leader.mp3',
        voice: VOICE_LEADER,
        text: 'Gloria al Padre, y al Hijo, y al Espíritu Santo.',
      },
      {
        name: 'gloria_resp.mp3',
        voice: VOICE_RESPONSE,
        text: 'Como era en el principio, ahora y siempre, por los siglos de los siglos. Amén. María, Madre de gracia y Madre de misericordia, en la vida y en la muerte ampáranos, gran Señora. Oh Jesús mío, perdona nuestros pecados, líbranos del fuego del infierno, lleva al cielo a todas las almas, especialmente a las más necesitadas de tu divina misericordia. Amén.',
      },
      {
        name: 'salve.mp3',
        voice: VOICE_LEADER,
        text: 'Para concluir nuestro Santo Rosario, rezamos juntos la Salve. Dios te salve, Reina y Madre de misericordia, vida, dulzura y esperanza nuestra; Dios te salve. A ti llamamos los desterrados hijos de Eva; a ti suspiramos, gimiendo y llorando, en este valle de lágrimas. Ea, pues, Señora, abogada nuestra, vuelve a nosotros esos tus ojos misericordiosos; y después de este destierro, muéstranos a Jesús, fruto bendito de tu vientre. Oh clementísima, oh piadosa, oh dulce siempre Virgen María. Ruega por nosotros, Santa Madre de Dios, para que seamos dignos de alcanzar las promesas de Nuestro Señor Jesucristo. Amén. Que la bendición de Dios Todopoderoso, Padre, Hijo y Espíritu Santo, descienda sobre ustedes y sus familias, y permanezca para siempre. Amén.',
      },
    ];

    const out = {};
    for (const d of defs) {
      const p = path.join(partsDir, d.name);
      await synthesizeSpeechToFile(d.text, p, d.voice);
      out[d.name] = p;
    }

    // Also create a 2.5s peaceful pause file and a 28s music interlude segment
    const pausePath = path.join(partsDir, 'pause.mp3');
    if (!fs.existsSync(pausePath)) {
      await runProcess('ffmpeg', [
        '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono',
        '-t', '1.4', '-ar', '24000', '-ac', '1', '-b:a', '64k', pausePath,
      ]);
    }
    out['pause.mp3'] = pausePath;
    return out;
  })();

  return commonPartsPromise.current;
}

const buildPromises = new Map();

async function ensureBroadcastFile(key) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  if (key === 'music') {
    const bg = getBgMusicFile();
    if (bg) return bg;
  }

  // If a full YouTube Rosary track was already downloaded for this Mystery set, use it!
  const ytMysteryPath = path.join(CACHE_DIR, `yt_${key}.mp3`);
  if (fs.existsSync(ytMysteryPath) && fs.statSync(ytMysteryPath).size > 200000) {
    return ytMysteryPath;
  }

  const targetPath = path.join(CACHE_DIR, `${key}.mp3`);
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 30000) {
    return targetPath;
  }
  if (buildPromises.has(key)) return buildPromises.get(key);

  const task = (async () => {
    const tmpDir = path.join(CACHE_DIR, `build_${key}_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      const bgFile = getBgMusicFile();

      if (key === 'interlude') {
        // Build continuous radio program: YouTube Catholic Piano Background Music + Warm Human Neural Announcements
        const spots = [
          {
            voice: VOICE_LEADER,
            text: 'Estás en sintonía con Credo Radio Rosario veinticuatro siete. Te acompañamos con música católica instrumental de oración y meditación mientras llega la hora de nuestro próximo Santo Rosario en comunidad.',
          },
          {
            voice: VOICE_RESPONSE,
            text: 'Recuerda nuestros horarios oficiales del Santo Rosario en grupo: todos los días a las siete de la mañana, dos de la tarde, cuatro de la tarde y ocho de la noche, hora de República Dominicana.',
          },
          {
            voice: VOICE_LEADER,
            text: 'En cualquier momento también puedes pulsar el botón Rezar Rosario de Hoy Ahora, o elegir cualquiera de los Misterios Gozosos, Dolorosos, Gloriosos o Luminosos en el repertorio completo de la pantalla de Oración.',
          },
          {
            voice: VOICE_RESPONSE,
            text: 'Señor Jesús, quédate con nosotros y llena de paz nuestros hogares. Disfruta de esta música católica instrumental para orar en silencio.',
          },
        ];

        // Extract a 32-second pure piano slice from bg_music.mp3 to play between each human voice spot
        const musicSlice = path.join(tmpDir, 'music_slice.mp3');
        if (bgFile) {
          await runProcess('ffmpeg', [
            '-y', '-ss', '8', '-t', '34', '-i', bgFile,
            '-af', 'afade=t=in:st=0:d=2,afade=t=out:st=31:d=3,volume=0.85',
            '-ar', '24000', '-ac', '1', '-b:a', '64k', musicSlice,
          ]);
        }

        const listEntries = [];
        for (let i = 0; i < spots.length; i += 1) {
          const rawVoice = path.join(tmpDir, `spot_raw_${i}.mp3`);
          const normVoice = path.join(tmpDir, `spot_${i}.mp3`);
          await synthesizeSpeechToFile(spots[i].text, rawVoice, spots[i].voice);
          await runProcess('ffmpeg', [
            '-y', '-i', rawVoice,
            '-ar', '24000', '-ac', '1', '-b:a', '64k', normVoice,
          ]);
          listEntries.push(`file '${normVoice}'`);
          if (fs.existsSync(musicSlice)) {
            listEntries.push(`file '${musicSlice}'`);
          }
        }

        const voiceConcat = path.join(tmpDir, 'voice_concat.mp3');
        const listFile = path.join(tmpDir, 'concat.txt');
        fs.writeFileSync(listFile, listEntries.join('\n'));
        await runProcess('ffmpeg', [
          '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
          '-ar', '24000', '-ac', '1', '-b:a', '64k', voiceConcat,
        ]);

        if (bgFile) {
          // Mix gentle continuous YouTube piano background music underneath the entire interlude program
          await runProcess('ffmpeg', [
            '-y',
            '-i', voiceConcat,
            '-stream_loop', '-1', '-i', bgFile,
            '-filter_complex', '[0:a]volume=1.0[v];[1:a]volume=0.28[bg];[v][bg]amix=inputs=2:duration=first:dropout_transition=2[out]',
            '-map', '[out]',
            '-ar', '24000', '-ac', '1', '-b:a', '64k', targetPath,
          ], 60000);
        } else {
          fs.copyFileSync(voiceConcat, targetPath);
        }
        return targetPath;
      }

      // Build complete 5-decade (50 Ave Marías) Antiphonal Human Neural Rosary for joyful/sorrowful/glorious/luminous
      const common = await ensureCommonPrayerParts();
      const m = MYSTERIES[key] || MYSTERIES.glorious;

      const introPath = path.join(tmpDir, 'intro.mp3');
      await synthesizeSpeechToFile(
        `Bienvenidos al Santo Rosario de Credo. Hoy meditamos juntos los ${m.name}, correspondientes a ${m.daysLabel}. Dispongamos nuestro corazón en la presencia del Señor y de María Santísima.`,
        introPath,
        VOICE_LEADER
      );

      const listEntries = [
        `file '${introPath}'`,
        `file '${common['pause.mp3']}'`,
        `file '${common['sign_credo.mp3']}'`,
        `file '${common['contrition_resp.mp3']}'`,
        `file '${common['pause.mp3']}'`,
      ];

      // All 5 Mysteries with 10 full antiphonal Ave Marías each
      for (let d = 0; d < m.list.length; d += 1) {
        const mPath = path.join(tmpDir, `mystery_${d}.mp3`);
        await synthesizeSpeechToFile(m.list[d], mPath, d % 2 === 0 ? VOICE_LEADER : VOICE_RESPONSE);
        listEntries.push(`file '${mPath}'`);
        listEntries.push(`file '${common['pause.mp3']}'`);
        listEntries.push(`file '${common['pn_leader.mp3']}'`);
        listEntries.push(`file '${common['pn_resp.mp3']}'`);

        for (let a = 0; a < 10; a += 1) {
          listEntries.push(`file '${common['ave_leader.mp3']}'`);
          listEntries.push(`file '${common['ave_resp.mp3']}'`);
        }

        listEntries.push(`file '${common['gloria_leader.mp3']}'`);
        listEntries.push(`file '${common['gloria_resp.mp3']}'`);
        listEntries.push(`file '${common['pause.mp3']}'`);
      }

      listEntries.push(`file '${common['salve.mp3']}'`);

      const listFile = path.join(tmpDir, 'rosary_concat.txt');
      fs.writeFileSync(listFile, listEntries.join('\n'));
      const voiceOnlyPath = path.join(tmpDir, 'rosary_voice.mp3');

      await runProcess('ffmpeg', [
        '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
        '-ar', '24000', '-ac', '1', '-b:a', '64k', voiceOnlyPath,
      ], 90000);

      if (bgFile) {
        await runProcess('ffmpeg', [
          '-y',
          '-i', voiceOnlyPath,
          '-stream_loop', '-1', '-i', bgFile,
          '-filter_complex', '[0:a]volume=1.05[v];[1:a]volume=0.18[bg];[v][bg]amix=inputs=2:duration=first:dropout_transition=2[out]',
          '-map', '[out]',
          '-ar', '24000', '-ac', '1', '-b:a', '64k', targetPath,
        ], 120000);
      } else {
        fs.copyFileSync(voiceOnlyPath, targetPath);
      }

      return targetPath;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      buildPromises.delete(key);
    }
  })();

  buildPromises.set(key, task);
  return task;
}

const ytDownloadPromises = new Map();

// Background YouTube audio repertoire downloader using yt-dlp + ffmpeg
function triggerYouTubeDownload(slotKey, youtubeId) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const outMp3 = path.join(CACHE_DIR, slotKey ? `yt_${slotKey}.mp3` : `yt_id_${youtubeId}.mp3`);
  if (fs.existsSync(outMp3) && fs.statSync(outMp3).size > 200000) {
    return Promise.resolve(outMp3);
  }
  const lockKey = `${slotKey}_${youtubeId}`;
  if (ytDownloadPromises.has(lockKey)) return ytDownloadPromises.get(lockKey);

  const p = (async () => {
    const tmpM4a = path.join(CACHE_DIR, `dl_${youtubeId}_${Date.now()}.m4a`);
    const tmpOut = `${outMp3}.part.mp3`;
    try {
      await runProcess('yt-dlp', [
        '--no-playlist',
        '--js-runtimes', 'node',
        '-f', 'bestaudio[ext=m4a]/bestaudio',
        '-o', tmpM4a,
        `https://www.youtube.com/watch?v=${youtubeId}`,
      ], 180000);

      if (fs.existsSync(tmpM4a) && fs.statSync(tmpM4a).size > 50000) {
        await runProcess('ffmpeg', [
          '-y', '-i', tmpM4a,
          '-ar', '24000', '-ac', '1', '-b:a', '64k',
          tmpOut,
        ], 180000);
        if (fs.existsSync(tmpOut) && fs.statSync(tmpOut).size > 100000) {
          fs.renameSync(tmpOut, outMp3);
          if (slotKey === 'music') {
            fs.copyFileSync(outMp3, path.join(CACHE_DIR, 'music.mp3'));
          }
          console.log(`[rosaryRadio] Downloaded YouTube audio repertoire: ${slotKey || youtubeId} (${youtubeId})`);
          return outMp3;
        }
      }
    } catch (err) {
      console.warn(`[rosaryRadio] yt-dlp background download (${youtubeId}):`, err.message);
    } finally {
      try { fs.rmSync(tmpM4a, { force: true }); } catch {}
      try { fs.rmSync(tmpOut, { force: true }); } catch {}
      ytDownloadPromises.delete(lockKey);
    }
    return null;
  })();

  ytDownloadPromises.set(lockKey, p);
  return p;
}

async function resolveActiveAudioSource({ requestedSlot = '', youtubeId = '' } = {}) {
  const ctx = getLiturgicalContext();

  // 1. If a specific YouTube repertoire ID was requested
  if (youtubeId && /^[a-zA-Z0-9_-]{11}$/.test(youtubeId)) {
    const ytFile = path.join(CACHE_DIR, `yt_id_${youtubeId}.mp3`);
    if (fs.existsSync(ytFile) && fs.statSync(ytFile).size > 100000) {
      return { filePath: ytFile, title: `Repertorio Santo Rosario (${youtubeId})`, ctx, isOnDemand: true };
    }
    triggerYouTubeDownload('', youtubeId).catch(() => {});
  }

  // 2. Determine target slot ('joyful' | 'sorrowful' | 'glorious' | 'luminous' | 'music' | 'interlude')
  let desiredSlot = ctx.is_live_rosary ? ctx.mystery.key : 'interlude';
  let isOnDemand = false;
  if (requestedSlot === 'today' || requestedSlot === 'mystery') {
    desiredSlot = ctx.mystery.key;
    isOnDemand = true;
  } else if (['joyful', 'sorrowful', 'glorious', 'luminous', 'music', 'interlude'].includes(requestedSlot)) {
    desiredSlot = requestedSlot;
    isOnDemand = requestedSlot !== 'interlude';
  }

  if (desiredSlot === 'music') {
    const bg = getBgMusicFile();
    if (bg) return { filePath: bg, title: 'Música Católica Instrumental de Oración', ctx, isOnDemand: true };
  }

  // 3. Check if CEO uploaded a custom track for this slot
  try {
    const slotsToCheck = desiredSlot === 'interlude' ? ['promo', 'interlude'] : [desiredSlot];
    const { rows } = await pool.query(
      `SELECT id, title, data FROM rosary_audio_tracks
        WHERE slot_type = ANY($1::text[])
        ORDER BY created_at DESC LIMIT 3`,
      [slotsToCheck]
    );
    if (rows.length > 0) {
      const pick = rows[Math.floor(Date.now() / 300000) % rows.length];
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const customPath = path.join(CACHE_DIR, `custom_${pick.id}.mp3`);
      if (!fs.existsSync(customPath)) {
        fs.writeFileSync(customPath, pick.data);
      }
      return { filePath: customPath, title: pick.title, ctx, isOnDemand };
    }
  } catch (err) {
    console.warn('[rosaryRadio] Custom track lookup failed:', err.message);
  }

  // 4. If the target file is already built on disk, return it immediately!
  const ytSlotPath = path.join(CACHE_DIR, `yt_${desiredSlot}.mp3`);
  if (fs.existsSync(ytSlotPath) && fs.statSync(ytSlotPath).size > 200000) {
    return {
      filePath: ytSlotPath,
      title: `${MYSTERIES[desiredSlot]?.name || 'Santo Rosario'} · Repertorio Oficial`,
      ctx,
      isOnDemand,
    };
  }

  const builtPath = path.join(CACHE_DIR, `${desiredSlot}.mp3`);
  if (fs.existsSync(builtPath) && fs.statSync(builtPath).size > 30000) {
    return {
      filePath: builtPath,
      title: MYSTERIES[desiredSlot] ? `${MYSTERIES[desiredSlot].name} · Voz Humana y Música` : 'Credo Radio Rosario 24/7',
      ctx,
      isOnDemand,
    };
  }

  // 5. If still building, trigger build in background; if bundled bg_music exists and we need instant response for interlude,
  //    wait up to 6 seconds for build, or serve bundled Catholic piano music immediately so the user NEVER hears silence!
  const buildTask = ensureBroadcastFile(desiredSlot).catch((e) => {
    console.warn(`[rosaryRadio] build ${desiredSlot} err:`, e.message);
    return null;
  });

  const timeoutResult = await Promise.race([
    buildTask,
    new Promise((resolve) => setTimeout(() => resolve(null), isOnDemand ? 22000 : 4500)),
  ]);

  if (timeoutResult && fs.existsSync(timeoutResult)) {
    return {
      filePath: timeoutResult,
      title: MYSTERIES[desiredSlot] ? `${MYSTERIES[desiredSlot].name}` : 'Credo Radio Rosario 24/7',
      ctx,
      isOnDemand,
    };
  }

  // Instant fallback to bundled YouTube Catholic Piano music so playback starts immediately without silence
  if (fs.existsSync(BUNDLED_BG_MUSIC)) {
    return {
      filePath: BUNDLED_BG_MUSIC,
      title: 'Música Católica Instrumental de Oración · Preparando Rosario',
      ctx,
      isOnDemand,
    };
  }

  const finalPath = await buildTask;
  return {
    filePath: finalPath,
    title: 'Credo Radio Rosario 24/7',
    ctx,
    isOnDemand,
  };
}

function warmUpRosaryCache() {
  (async () => {
    try {
      const ctx = getLiturgicalContext();
      console.log(`[rosaryRadio] Warming up Human Neural Rosary + YouTube Background Music (Today: ${ctx.mystery.name})...`);
      await ensureBroadcastFile('interlude');
      await ensureBroadcastFile(ctx.mystery.key);
      for (const k of ['joyful', 'sorrowful', 'glorious', 'luminous']) {
        if (k !== ctx.mystery.key) {
          await ensureBroadcastFile(k);
        }
      }
      console.log('[rosaryRadio] All 4 Human Neural Rosary Mystery sets + Interlude ready!');

      // Also download the YouTube Rosary & Instrumental Music repertoire in the background
      await triggerYouTubeDownload(ctx.mystery.key, ctx.mystery.youtube_id);
      await triggerYouTubeDownload('music', 'JQWDKns81mc');
      for (const k of ['joyful', 'sorrowful', 'glorious', 'luminous']) {
        if (k !== ctx.mystery.key) {
          await triggerYouTubeDownload(k, MYSTERIES[k].youtube_id);
        }
      }
    } catch (err) {
      console.warn('[rosaryRadio] warmup warning:', err.message);
    }
  })();
}

module.exports = {
  CACHE_DIR,
  SCHEDULE_HOURS,
  MYSTERIES,
  YOUTUBE_REPERTOIRE,
  getLiturgicalContext,
  resolveActiveAudioSource,
  synthesizeSpeechToFile,
  triggerYouTubeDownload,
  warmUpRosaryCache,
};
