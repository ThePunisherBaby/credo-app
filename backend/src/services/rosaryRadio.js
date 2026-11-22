// rosaryRadio.js — 24/7 Automated Live Rosary Radio Service on VPS
// Timezone: America/Santo_Domingo (UTC-4)
// Scheduled Group Rosaries: 07:00, 14:00 (2 PM), 16:00 (4 PM), 20:00 (8 PM)
// Automatic Mystery selection by day & Catholic Liturgical Season + interlude schedule spots & promos.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { pool } = require('../db/pool');

const CACHE_DIR = path.join(os.tmpdir(), 'credo-rosary-audio');
const SCHEDULE_HOURS = [7, 14, 16, 20]; // 7 AM, 2 PM, 4 PM, 8 PM RD time
const ROSARY_DURATION_MIN = 22;

const MYSTERIES = {
  joyful: {
    key: 'joyful',
    name: 'Misterios Gozosos',
    daysLabel: 'Lunes, Sábados y Domingos de Adviento/Navidad',
    list: [
      'Primer Misterio Gozoso: La Encarnación del Hijo de Dios en el seno de la Virgen María.',
      'Segundo Misterio Gozoso: La Visitación de Nuestra Señora a su prima Santa Isabel.',
      'Tercer Misterio Gozoso: El Nacimiento del Niño Jesús en el portal de Belén.',
      'Cuarto Misterio Gozoso: La Presentación del Niño Jesús en el Templo.',
      'Quinto Misterio Gozoso: El Niño Jesús perdido y hallado en el Templo entre los doctores.',
    ],
  },
  sorrowful: {
    key: 'sorrowful',
    name: 'Misterios Dolorosos',
    daysLabel: 'Martes, Viernes y Domingos de Cuaresma',
    list: [
      'Primer Misterio Doloroso: La Oración de Jesús en el Huerto de Getsemaní.',
      'Segundo Misterio Doloroso: La Flagelación de Nuestro Señor atado a la columna.',
      'Tercer Misterio Doloroso: La Coronación de espinas de Nuestro Señor Jesucristo.',
      'Cuarto Misterio Doloroso: Jesús carga con la Cruz camino del monte Calvario.',
      'Quinto Misterio Doloroso: La Crucifixión y Muerte de Nuestro Señor en la Cruz.',
    ],
  },
  glorious: {
    key: 'glorious',
    name: 'Misterios Gloriosos',
    daysLabel: 'Miércoles y Domingos (Tiempo Ordinario y Pascua)',
    list: [
      'Primer Misterio Glorioso: La Resurrección gloriosa de Nuestro Señor Jesucristo.',
      'Segundo Misterio Glorioso: La Ascensión del Señor al Cielo.',
      'Tercer Misterio Glorioso: La Venida del Espíritu Santo en Pentecostés.',
      'Cuarto Misterio Glorioso: La Asunción de la Santísima Virgen María en cuerpo y alma.',
      'Quinto Misterio Glorioso: La Coronación de María Santísima como Reina y Señora de todo lo creado.',
    ],
  },
  luminous: {
    key: 'luminous',
    name: 'Misterios Luminosos',
    daysLabel: 'Jueves · Misterios de la Luz',
    list: [
      'Primer Misterio Luminoso: El Bautismo de Jesús en el río Jordán.',
      'Segundo Misterio Luminoso: La Autorrevelación de Jesús en las bodas de Caná.',
      'Tercer Misterio Luminoso: El Anuncio del Reino de Dios invitando a la conversión.',
      'Cuarto Misterio Luminoso: La Transfiguración del Señor en el monte Tabor.',
      'Quinto Misterio Luminoso: La Institución de la Santísima Eucaristía en la Última Cena.',
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
  for (const p of parts) map[p.type] = p.value;
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
    dow: weekdays[map.weekday] ?? now.getUTCDay(),
  };
}

function getLiturgicalContext() {
  const sd = getSantoDomingoNow();
  const todayUtc = Date.UTC(sd.year, sd.month - 1, sd.day);
  const easter = computeEasterDate(sd.year).getTime();
  const diffDays = Math.round((todayUtc - easter) / 86400000);

  // Compute First Sunday of Advent (Sunday closest to Nov 30)
  const christmas = Date.UTC(sd.year, 11, 25);
  const xmasDow = new Date(christmas).getUTCDay();
  const daysBackToSun4 = xmasDow === 0 ? 7 : xmasDow;
  const adventStart = christmas - (daysBackToSun4 + 21) * 86400000;

  let season = 'Tiempo Ordinario';
  let seasonCode = 'ordinary';
  if (todayUtc >= adventStart && todayUtc < christmas) {
    season = 'Tiempo de Adviento';
    seasonCode = 'advent';
  } else if (todayUtc >= christmas || (sd.month === 1 && sd.day <= 12)) {
    season = 'Tiempo de Navidad';
    seasonCode = 'christmas';
  } else if (diffDays >= -46 && diffDays <= -8) {
    season = 'Cuaresma';
    seasonCode = 'lent';
  } else if (diffDays >= -7 && diffDays <= -1) {
    season = 'Semana Santa';
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
    is_live_rosary: isRosaryHour,
    mode: isRosaryHour ? 'rosary' : 'interlude',
    active_slot_label: isRosaryHour ? `${fmtHour(sd.hour)} · En Vivo` : 'Avisos y Programación',
    next_rosary_label: fmtHour(nextHour),
    seconds_until_next: secondsUntilNext,
    schedule_hours: SCHEDULE_HOURS.map(fmtHour),
    stream_url: '/api/v1/rosary/stream',
  };
}

function buildDecadeText(mysteryDesc) {
  const hailMary = 'Dios te salve María, llena eres de gracia, el Señor es contigo. Bendita tú eres entre todas las mujeres y bendito es el fruto de tu vientre, Jesús. Santa María, Madre de Dios, ruega por nosotros pecadores ahora y en la hora de nuestra muerte. Amén.';
  return [
    mysteryDesc,
    'Padre nuestro que estás en el cielo, santificado sea tu Nombre; venga a nosotros tu Reino; hágase tu voluntad en la tierra como en el cielo. Danos hoy nuestro pan de cada día; perdona nuestras ofensas como también nosotros perdonamos a los que nos ofenden; no nos dejes caer en la tentación y líbranos del mal. Amén.',
    hailMary,
    hailMary,
    'Gloria al Padre, y al Hijo, y al Espíritu Santo. Como era en el principio, ahora y siempre, por los siglos de los siglos. Amén. Oh Jesús mío, perdona nuestros pecados, líbranos del fuego del infierno, lleva al cielo a todas las almas, especialmente a las más necesitadas de tu misericordia.',
  ];
}

function getScriptLines(key) {
  if (key === 'interlude') {
    return [
      'Estás escuchando Credo Radio Rosario, la voz de oración continua de nuestra comunidad.',
      'Reza el Santo Rosario en grupo en vivo todos los días a las siete de la mañana, dos de la tarde, cuatro de la tarde y ocho de la noche, hora de República Dominicana.',
      'Recuerda visitar Aire Noventa y Seis F M en aire noventa y seis f m punto com punto d o, y Reflexionando la Palabra punto com para el Evangelio de cada día.',
      'En las horas entre cada rosario te acompañamos con avisos parroquiales, mensajes de fe y preparación espiritual para el próximo encuentro de oración.',
      'Señor, enséñanos a orar con un corazón humilde y atento a tu Palabra. Sintoniza el próximo Santo Rosario en directo aquí en Credo.',
    ];
  }
  const m = MYSTERIES[key] || MYSTERIES.glorious;
  const lines = [
    `Bienvenido al Santo Rosario en vivo desde Credo. En este día contemplamos los ${m.name}.`,
    'Por la señal de la Santa Cruz, de nuestros enemigos líbranos, Señor Dios nuestro. En el nombre del Padre, y del Hijo, y del Espíritu Santo. Amén.',
    'Creo en Dios Padre Todopoderoso, Creador del cielo y de la tierra, y en Jesucristo su único Hijo Nuestro Señor.',
  ];
  for (const desc of m.list) {
    lines.push(...buildDecadeText(desc));
  }
  lines.push(
    'Dios te salve, Reina y Madre de misericordia, vida, dulzura y esperanza nuestra. Ruega por nosotros, Santa Madre de Dios, para que seamos dignos de alcanzar las promesas de Nuestro Señor Jesucristo. Amén.'
  );
  return lines;
}

async function fetchTtsChunk(text) {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=es&client=tw-ob&q=${encodeURIComponent(text.slice(0, 195))}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CredoRadio/1.0)' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function generateChimeFile(outPath) {
  await new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=523.25:duration=1.1',
      '-af', 'afade=t=in:st=0:d=0.05,afade=t=out:st=0.25:d=0.85,volume=0.18',
      '-ar', '24000', '-ac', '1', '-b:a', '64k', outPath,
    ]);
    ff.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`chime exit ${code}`))));
    ff.on('error', reject);
  });
}

const buildPromises = new Map();

async function ensureBroadcastFile(key) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const targetPath = path.join(CACHE_DIR, `${key}.mp3`);
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 4096) {
    return targetPath;
  }
  if (buildPromises.has(key)) return buildPromises.get(key);

  const task = (async () => {
    const tmpDir = path.join(CACHE_DIR, `build_${key}_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      const chimePath = path.join(tmpDir, 'chime.mp3');
      await generateChimeFile(chimePath);

      const lines = getScriptLines(key);
      const chunks = [];
      for (const sentence of lines) {
        // Split sentences safely under 190 chars for Google TTS
        const parts = sentence.match(/.{1,175}(?:\s|$)/g) || [sentence];
        for (const p of parts) {
          const clean = p.trim();
          if (clean) chunks.push(clean);
        }
      }

      const listEntries = [`file '${chimePath}'`];
      for (let i = 0; i < chunks.length; i += 1) {
        try {
          const buf = await fetchTtsChunk(chunks[i]);
          const partPath = path.join(tmpDir, `p_${String(i).padStart(3, '0')}.mp3`);
          fs.writeFileSync(partPath, buf);
          listEntries.push(`file '${partPath}'`);
        } catch (err) {
          console.warn(`[rosaryRadio] TTS chunk ${i} skipped:`, err.message);
        }
      }

      const listFile = path.join(tmpDir, 'concat.txt');
      fs.writeFileSync(listFile, listEntries.join('\n'));

      await new Promise((resolve, reject) => {
        const ff = spawn('ffmpeg', [
          '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
          '-ar', '24000', '-ac', '1', '-b:a', '64k', targetPath,
        ]);
        ff.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg concat exit ${code}`))));
        ff.on('error', reject);
      });
      return targetPath;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      buildPromises.delete(key);
    }
  })();

  buildPromises.set(key, task);
  return task;
}

async function resolveActiveAudioSource() {
  const ctx = getLiturgicalContext();
  const desiredSlot = ctx.is_live_rosary ? ctx.mystery.key : 'interlude';

  try {
    // Check if CEO uploaded an official custom track for this slot (or promo during interlude)
    const slotsToCheck = ctx.is_live_rosary ? [desiredSlot] : ['promo', 'interlude'];
    const { rows } = await pool.query(
      `SELECT id, title, data FROM rosary_audio_tracks
        WHERE slot_type = ANY($1::text[])
        ORDER BY created_at DESC LIMIT 3`,
      [slotsToCheck]
    );
    if (rows.length > 0) {
      // Rotate custom uploaded tracks cleanly every 5 minutes if multiple
      const pick = rows[Math.floor(Date.now() / 300000) % rows.length];
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const customPath = path.join(CACHE_DIR, `custom_${pick.id}.mp3`);
      if (!fs.existsSync(customPath)) {
        fs.writeFileSync(customPath, pick.data);
      }
      return { filePath: customPath, title: pick.title, ctx };
    }
  } catch (err) {
    console.warn('[rosaryRadio] Custom track lookup failed:', err.message);
  }

  const generatedPath = await ensureBroadcastFile(desiredSlot);
  return {
    filePath: generatedPath,
    title: ctx.is_live_rosary ? `${ctx.mystery.name} · En Vivo` : 'Credo Radio Rosario · Avisos 24/7',
    ctx,
  };
}

function warmUpRosaryCache() {
  ensureBroadcastFile('interlude').catch((e) => console.warn('[rosaryRadio] interlude warmup:', e.message));
  const ctx = getLiturgicalContext();
  ensureBroadcastFile(ctx.mystery.key).catch((e) => console.warn('[rosaryRadio] mystery warmup:', e.message));
}

module.exports = {
  SCHEDULE_HOURS,
  MYSTERIES,
  getLiturgicalContext,
  resolveActiveAudioSource,
  warmUpRosaryCache,
};
