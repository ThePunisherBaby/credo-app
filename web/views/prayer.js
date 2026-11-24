// views/prayer.js — Oración: Rosario 24/7 (7am/2pm/4pm/8pm) + Repertorio Completo por Día (Voz Humana y YouTube) + Música de Fondo + Oraciones + Muro

import { audioEngine } from '../audio-engine.js?v=18';
import { enhanceLiquidGlass } from '../glass.js?v=18';

function formatCountdown(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

const MYSTERY_DAYS_ORDER = [
  { key: 'joyful', badge: 'Lunes y Sábado', title: 'Misterios Gozosos', yt: '5L5WfZIrUhQ' },
  { key: 'sorrowful', badge: 'Martes y Viernes', title: 'Misterios Dolorosos', yt: 'I4oqxPybPgU' },
  { key: 'glorious', badge: 'Miércoles y Domingo', title: 'Misterios Gloriosos', yt: 'Ojvu3uBzsXM' },
  { key: 'luminous', badge: 'Jueves', title: 'Misterios Luminosos', yt: 'wZIFINvqbJw' },
];

const CATHOLIC_PRAYERS = {
  angelus: {
    title: 'El Ángelus',
    badge: 'Tradicional · 6am / 12pm / 6pm',
    body: `V. El Ángel del Señor anunció a María.\nR. Y concibió por obra del Espíritu Santo.\n\nDios te salve, María, llena eres de gracia, el Señor es contigo. Bendita tú eres entre todas las mujeres, y bendito es el fruto de tu vientre, Jesús. Santa María, Madre de Dios, ruega por nosotros, pecadores, ahora y en la hora de nuestra muerte. Amén.\n\nV. He aquí la esclava del Señor.\nR. Hágase en mí según tu palabra.\n\nV. Y el Verbo se hizo carne.\nR. Y habitó entre nosotros.\n\nV. Ruega por nosotros, Santa Madre de Dios.\nR. Para que seamos dignos de alcanzar las promesas de Nuestro Señor Jesucristo. Amén.`,
  },
  reginaCaeli: {
    title: 'Regina Caeli',
    badge: 'Tiempo Pascual',
    body: `V. Reina del cielo, alégrate, aleluya.\nR. Porque el Señor a quien mereciste llevar, aleluya,\nV. Resucitó según su palabra, aleluya.\nR. Ruega al Señor por nosotros, aleluya.\n\nV. Gózate y alégrate, Virgen María, aleluya.\nR. Porque verdaderamente resucitó el Señor, aleluya.`,
  },
  morning: {
    title: 'Ofrecimiento de la Mañana',
    badge: 'Al despertar',
    body: 'Señor Jesús, al comenzar este nuevo día te ofrezco mis pensamientos, palabras, trabajos y alegrías. Acompaña a mi familia, protege a los más necesitados y dame un corazón atento a tu Palabra. Amén.',
  },
  night: {
    title: 'Oración de la Noche',
    badge: 'Antes de descansar',
    body: 'Padre bueno, gracias por los dones de este día. Perdona mis faltas, guarda bajo tu paz mi hogar y concede descanso a quienes sufren en cuerpo o espíritu. En tus manos encomiendo mi descanso. Amén.',
  },
  communion: {
    title: 'Comunión Espiritual',
    badge: 'San Alfonso María de Ligorio',
    body: 'Creo, Jesús mío, que estás real y verdaderamente presente en el Santísimo Sacramento del Altar. Te amo sobre todas las cosas y deseo vivamente recibirte dentro de mi alma; ya que no puedo hacerlo ahora sacramentalmente, ven al menos espiritualmente a mi corazón. Como si ya te hubiese recibido, te abrazo y me uno del todo a Ti. No permitas que jamás me aparte de Ti. Amén.',
  },
};

export async function mount({ root, app, signal }) {
  const d = app.dict();
  let activeTab = 'rosary';
  let filter = 'recent';
  let liturgy = null;
  let rosaryStatus = null;
  let rosaryTracks = [];
  let countdownSec = 0;
  let intentions = [];
  let activeYtEmbed = '';
  let audioUnsub = null;
  let countdownTimer = null;

  root.innerHTML = `
    <div class="explore-sticky-top">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
        <h1 class="t-title-2" style="margin:0;font-size:1.35rem;letter-spacing:-0.025em">${app.esc(d.prayer.title)}</h1>
        <span class="t-caption" style="color:var(--label-2);font-weight:700">${app.esc(d.prayer.subtitle)}</span>
      </div>
      <div class="seg-tabs" id="prayerTabs" role="tablist" style="margin-bottom:2px">
        <button type="button" class="seg-tab is-active" data-ptab="rosary" role="tab" aria-selected="true">Rosario 24/7</button>
        <button type="button" class="seg-tab" data-ptab="prayers" role="tab" aria-selected="false">Oraciones</button>
        <button type="button" class="seg-tab" data-ptab="wall" role="tab" aria-selected="false">Muro</button>
      </div>
    </div>

    <div id="prayerTabRosary">
      <div class="card"><div class="skeleton" style="height:240px"></div></div>
    </div>

    <div id="prayerTabPrayers" hidden>
      <div class="liturgy-card"><div class="skeleton" style="height:220px"></div></div>
    </div>

    <div id="prayerTabWall" hidden>
      <div class="chip-row" id="prayerFilterChips" role="tablist">
        <button type="button" class="chip is-active" data-pf="recent">${app.esc(d.prayer.filters.recent)}</button>
        <button type="button" class="chip" data-pf="urgent">${app.esc(d.prayer.filters.urgent)}</button>
        <button type="button" class="chip" data-pf="parish">${app.esc(d.prayer.filters.parish)}</button>
        <button type="button" class="chip" data-pf="mine">${app.esc(d.prayer.filters.mine)}</button>
      </div>
      <section class="prayer-list" id="prayerList">
        <div class="card"><div class="skeleton" style="height:110px"></div></div>
      </section>
    </div>

    <div class="prayer-fab-anchor" id="prayerFabWrap" hidden>
      <div class="lg lg-fab" id="prayerFabGlass">
        <div class="lg__shadow" aria-hidden="true"></div>
        <div class="lg__glass" aria-hidden="true"></div>
        <div class="lg__rim" aria-hidden="true"></div>
        <div class="lg__glow" aria-hidden="true"></div>
        <div class="lg__content">
          <button type="button" class="fab-btn" id="openPrayerModalBtn">
            <span>🕯️</span>
            <span>${app.esc(d.prayer.askPrayer)}</span>
          </button>
        </div>
      </div>
    </div>
  `;

  enhanceLiquidGlass(root.querySelector('#prayerFabGlass'));

  const rosaryHost = root.querySelector('#prayerTabRosary');
  const prayersHost = root.querySelector('#prayerTabPrayers');
  const wallHost = root.querySelector('#prayerTabWall');
  const prayerList = root.querySelector('#prayerList');
  const fabWrap = root.querySelector('#prayerFabWrap');

  function makeLiveRosaryChannel(st) {
    return {
      id: 9001,
      slug: 'credo-rosario',
      name: 'Credo Radio Rosario 24/7',
      tagline: `${st?.liturgical_season || 'Liturgia Católica'} · 7am · 2pm · 4pm · 8pm`,
      current_program: st?.is_live_rosary
        ? `EN VIVO: ${st?.mystery?.name || 'Santo Rosario'}`
        : `Música Católica de Fondo y Avisos · Próximo: ${st?.next_rosary_label || '7:00 AM'}`,
      frequency: st?.is_live_rosary ? 'ROSARIO EN VIVO' : '24/7 AUTOMÁTICO',
      city: 'República Dominicana (UTC-4)',
      accent_color: '#007AFF',
      cover_url: '/icons/credo-512.png',
      stream_url: '/api/v1/rosary/stream',
      direct_stream_url: '/api/v1/rosary/audio/interlude',
    };
  }

  function makeSlotChannel(slotKey, label, subLabel, ytId = '') {
    const idMap = { today: 9010, joyful: 9011, sorrowful: 9012, glorious: 9013, luminous: 9014, music: 9002 };
    const qs = ytId ? `?yt=${encodeURIComponent(ytId)}` : '';
    return {
      id: idMap[slotKey] || 9015,
      slug: `rosario-${slotKey}${ytId ? '-' + ytId : ''}`,
      name: label,
      tagline: subLabel || 'Santo Rosario Completo · Voz Humana y Música Católica',
      current_program: subLabel || label,
      frequency: slotKey === 'music' ? 'MÚSICA DE ORACIÓN' : 'SANTO ROSARIO',
      city: 'Credo Oración',
      accent_color: '#007AFF',
      cover_url: '/icons/credo-512.png',
      stream_url: `/api/v1/rosary/audio/${encodeURIComponent(slotKey)}${qs}`,
      direct_stream_url: `/api/v1/rosary/stream?slot=${encodeURIComponent(slotKey)}${ytId ? '&yt=' + encodeURIComponent(ytId) : ''}`,
    };
  }

  function renderRosary() {
    if (!rosaryStatus) return;
    const audioSt = audioEngine.getState();
    const curSlug = audioSt.channel?.slug || '';
    const isPlayingLive247 = audioSt.playing && curSlug === 'credo-rosario';
    const isPlayingTodayNow = audioSt.playing && (curSlug === 'rosario-today' || curSlug === `rosario-${rosaryStatus.mystery?.key}`);
    const isPlayingBgMusic = audioSt.playing && (curSlug === 'rosario-music' || curSlug === 'credo-musica-oracion');

    const mystery = rosaryStatus.mystery || {};
    const schedule = rosaryStatus.schedule_hours || ['7:00 AM', '2:00 PM', '4:00 PM', '8:00 PM'];
    const repertoire = rosaryStatus.repertoire || {};
    const canManageAudio = Boolean(app.user?.is_ceo || app.user?.ecclesiastical_rank === 'admin');

    rosaryHost.innerHTML = `
      <article class="rosary-hero">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <span class="live-pill-lg"><span class="live-dot" aria-hidden="true"></span>${rosaryStatus.is_live_rosary ? 'ROSARIO EN VIVO' : 'RADIO ROSARIO 24/7'}</span>
          <span style="font-size:0.76rem;color:rgba(255,255,255,0.82);font-weight:600">${app.esc(rosaryStatus.liturgical_season)} · ${app.esc(rosaryStatus.local_time || '')} RD</span>
        </div>

        <div>
          <h2 class="t-title-2" style="color:#FFFFFF;margin:0">Hoy: ${app.esc(mystery.name || 'Santo Rosario')}</h2>
          <p style="margin:4px 0 0;font-size:0.84rem;color:rgba(255,255,255,0.82)">${app.esc(mystery.daysLabel || '')}</p>
        </div>

        <div class="rosary-times-grid">
          ${schedule.map((slot) => {
            const liveNow = rosaryStatus.is_live_rosary && String(rosaryStatus.active_slot_label || '').startsWith(slot);
            return `<div class="rosary-time-chip${liveNow ? ' is-live' : ''}">${app.esc(slot)}</div>`;
          }).join('')}
        </div>

        <div style="font-size:0.82rem;color:rgba(255,255,255,0.9)">
          ${rosaryStatus.is_live_rosary
            ? '<strong>Transmitiendo el Santo Rosario en comunidad ahora mismo</strong>'
            : `Música católica de fondo activa · Próximo rosario grupal (${app.esc(rosaryStatus.next_rosary_label)}) en <strong id="rosaryCountdown">${formatCountdown(countdownSec)}</strong>`}
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;padding-top:4px">
          <button type="button" class="btn btn-gold btn-sm btn-block" id="playTodayRosaryNowBtn">
            ${isPlayingTodayNow ? '⏸ Pausar Rosario de Hoy' : `▶ Rezar ${app.esc(mystery.name || 'Rosario')} Ahora`}
          </button>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <button type="button" class="btn btn-sm" style="background:rgba(255,255,255,0.16);color:#fff" id="playRosaryStreamBtn">
              ${isPlayingLive247 ? '⏸ Radio 24/7' : '📻 Radio 24/7'}
            </button>
            <button type="button" class="btn btn-sm" style="background:rgba(255,255,255,0.12);color:#fff" id="playBgMusicBtn">
              ${isPlayingBgMusic ? '⏸ Música' : '🎵 Música Fondo'}
            </button>
          </div>
        </div>
      </article>

      <!-- Repertorio Completo de los 4 Misterios del Santo Rosario por Día (Voz Humana Neuronal + YouTube) -->
      <div class="card" style="margin-bottom:var(--s-4)">
        <div class="section-bar" style="margin-top:0">
          <div>
            <h3 class="t-title-3" style="margin:0">Repertorio Completo del Santo Rosario por Día</h3>
            <p class="t-caption" style="margin:2px 0 0">Voz humana natural + música católica de fondo y repertorio de YouTube según el día</p>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:10px">
          ${MYSTERY_DAYS_ORDER.map((item) => {
            const isToday = mystery.key === item.key;
            const slotSlug = `rosario-${item.key}`;
            const isSlotPlaying = audioSt.playing && curSlug.startsWith(slotSlug);
            const ytList = repertoire[item.key] || [];
            const ytOpen = activeYtEmbed === item.key;

            return `
              <div style="padding:14px;border-radius:12px;background:var(--surface-2);border:1px solid ${isToday ? 'rgba(10,132,255,0.48)' : 'var(--sep)'}">
                <div style="display:flex;flex-direction:column;gap:10px">
                  <div>
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                      <span class="t-caption" style="color:var(--gold-text);font-weight:800">${app.esc(item.badge)}</span>
                      ${isToday ? '<span class="rank-tag" style="padding:2px 7px;font-size:0.68rem">HOY</span>' : ''}
                    </div>
                    <strong style="font-size:1rem;display:block;margin-top:3px">${app.esc(item.title)}</strong>
                  </div>
                  <div style="display:grid;grid-template-columns:1fr auto;gap:8px">
                    <button type="button" class="btn btn-sm ${isSlotPlaying ? 'btn-soft' : 'btn-gold'}" data-play-mystery="${app.esc(item.key)}" data-mystery-title="${app.esc(item.title)}" data-mystery-days="${app.esc(item.badge)}">
                      ${isSlotPlaying ? '⏸ En reproducción' : '▶ Escuchar Audio'}
                    </button>
                    <button type="button" class="btn btn-sm btn-soft" data-toggle-yt="${app.esc(item.key)}">
                      ${ytOpen ? 'Cerrar ▴' : 'YouTube ▾'}
                    </button>
                  </div>
                </div>

                ${ytOpen ? `
                  <div style="margin-top:12px;display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--sep);padding-top:10px">
                    <div style="aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:#000">
                      <iframe src="https://www.youtube.com/embed/${app.esc(item.yt)}?autoplay=1&playsinline=1&rel=0" style="width:100%;height:100%;border:0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
                    </div>
                    ${ytList.map((v) => `
                      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:0.82rem">
                        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">🎧 ${app.esc(v.title)} (${app.esc(v.duration_label)})</span>
                        <button type="button" class="btn btn-sm btn-soft" data-play-yt-audio="${app.esc(v.youtube_id)}" data-yt-slot="${app.esc(item.key)}" data-yt-title="${app.esc(v.title)}">▶ Audio</button>
                      </div>
                    `).join('')}
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="card" style="margin-bottom:var(--s-4)">
        <div class="section-bar" style="margin-top:0">
          <h3 class="t-title-3">Los 5 Misterios de Hoy (${app.esc(mystery.name || '')})</h3>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${(mystery.list || []).map((line, i) => `
            <div class="rosary-mystery-item" style="align-items:center;justify-content:space-between">
              <div style="display:flex;gap:12px;align-items:flex-start;flex:1;min-width:0">
                <span class="rosary-mystery-num">${i + 1}</span>
                <span style="font-size:0.9rem;line-height:1.45">${app.esc(line)}</span>
              </div>
              <button type="button" class="btn btn-sm btn-soft" data-speak-mystery="${i}" aria-label="Escuchar misterio ${i + 1}">🔊</button>
            </div>
          `).join('')}
        </div>
      </div>

      ${canManageAudio ? `
        <div class="card">
          <div class="section-bar" style="margin-top:0">
            <h3 class="t-title-3">Estudio CEO · Audio y Publicidad 24/7</h3>
          </div>
          <p class="t-footnote" style="margin-bottom:12px">Sube grabaciones personalizadas del Rosario o promos/avisos en MP3 para rotación automática en vivo.</p>
          <form id="rosaryUploadForm" style="display:flex;flex-direction:column;gap:10px">
            <div class="field">
              <label for="ruSlot">Franja de emisión</label>
              <select id="ruSlot" name="slot_type">
                <option value="promo">Aviso / Publicidad entre horas</option>
                <option value="interlude">Cortina / Reflexión continua</option>
                <option value="joyful">Misterios Gozosos</option>
                <option value="sorrowful">Misterios Dolorosos</option>
                <option value="glorious">Misterios Gloriosos</option>
                <option value="luminous">Misterios Luminosos</option>
              </select>
            </div>
            <div class="field">
              <label for="ruTitle">Título de la pista</label>
              <input id="ruTitle" name="title" required placeholder="Ej. Aviso Misa Dominical · Aire 96 FM" />
            </div>
            <div class="field">
              <label for="ruFile">Archivo MP3 (máx. 15 MB)</label>
              <input id="ruFile" type="file" accept="audio/mpeg,audio/mp3,.mp3" required />
            </div>
            <button type="submit" class="btn btn-gold btn-sm">Subir a Radio Rosario 24/7</button>
          </form>
          ${rosaryTracks.length > 0 ? `
            <div style="margin-top:14px;display:flex;flex-direction:column;gap:8px">
              ${rosaryTracks.map((tr) => `
                <div class="ios-row" style="padding:8px 0;border-color:var(--sep)">
                  <div>
                    <div class="ios-row-label" style="font-size:0.86rem">${app.esc(tr.title)}</div>
                    <div class="ios-row-sub">${app.esc(tr.slot_type)}</div>
                  </div>
                  <button type="button" class="btn btn-sm btn-soft" data-del-track="${tr.id}">Quitar</button>
                </div>
              `).join('')}
            </div>` : ''}
        </div>
      ` : ''}
    `;

    rosaryHost.querySelector('#playTodayRosaryNowBtn')?.addEventListener('click', () => {
      if (isPlayingTodayNow) {
        audioEngine.togglePlay();
      } else {
        app.playLive(
          makeSlotChannel(
            mystery.key || 'today',
            `Santo Rosario · ${mystery.name || 'Misterios de Hoy'}`,
            `${mystery.daysLabel || 'Hoy'} · Voz Humana y Música de Fondo`
          ),
          { expandPlayer: true }
        );
      }
    });

    rosaryHost.querySelector('#playRosaryStreamBtn')?.addEventListener('click', () => {
      if (isPlayingLive247) {
        audioEngine.togglePlay();
      } else {
        app.playLive(makeLiveRosaryChannel(rosaryStatus), { expandPlayer: true });
      }
    });

    rosaryHost.querySelector('#playBgMusicBtn')?.addEventListener('click', () => {
      if (isPlayingBgMusic) {
        audioEngine.togglePlay();
      } else {
        app.playLive(
          makeSlotChannel(
            'music',
            'Credo Música Católica de Oración',
            'Piano e Instrumental Católico 24/7 para Meditar'
          ),
          { expandPlayer: true }
        );
      }
    });

    rosaryHost.querySelectorAll('[data-play-mystery]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.playMystery;
        const title = btn.dataset.mysteryTitle;
        const days = btn.dataset.mysteryDays;
        const cur = audioEngine.getState();
        if (cur.playing && cur.channel?.slug === `rosario-${key}`) {
          audioEngine.togglePlay();
        } else {
          app.playLive(
            makeSlotChannel(key, `Santo Rosario · ${title}`, `${days} · Voz Humana y Música Católica`),
            { expandPlayer: true }
          );
        }
      });
    });

    rosaryHost.querySelectorAll('[data-toggle-yt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.toggleYt;
        activeYtEmbed = activeYtEmbed === key ? '' : key;
        renderRosary();
      });
    });

    rosaryHost.querySelectorAll('[data-play-yt-audio]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ytId = btn.dataset.playYtAudio;
        const slot = btn.dataset.ytSlot;
        const title = btn.dataset.ytTitle;
        app.playLive(
          makeSlotChannel(slot, title, 'Repertorio Santo Rosario · Audio Continuo', ytId),
          { expandPlayer: true }
        );
      });
    });

    rosaryHost.querySelectorAll('[data-speak-mystery]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.speakMystery);
        const text = (mystery.list || [])[idx];
        if (text) {
          audioEngine.toggleGospelSpeech(
            `${text} Padre nuestro, que estás en el cielo, santificado sea tu Nombre; venga a nosotros tu Reino; hágase tu voluntad en la tierra como en el cielo. Danos hoy nuestro pan de cada día; perdona nuestras ofensas, como también nosotros perdonamos a los que nos ofenden; no nos dejes caer en la tentación, y líbranos del mal. Amén.`,
            app.locale
          );
        }
      });
    });

    const uploadForm = rosaryHost.querySelector('#rosaryUploadForm');
    if (uploadForm) {
      uploadForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const fileInput = rosaryHost.querySelector('#ruFile');
        const file = fileInput?.files?.[0];
        if (!file) return app.toast('Selecciona un archivo MP3');
        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Error leyendo archivo'));
            reader.readAsDataURL(file);
          });
          const fd = new FormData(uploadForm);
          const r = await app.api('/api/v1/rosary/tracks', {
            method: 'POST',
            body: {
              slot_type: fd.get('slot_type'),
              title: fd.get('title'),
              data_url: dataUrl,
            },
          });
          if (r.track) rosaryTracks.unshift(r.track);
          app.toast('Pista cargada en la programación 24/7');
          renderRosary();
        } catch (err) {
          app.toast(err.message);
        }
      });
    }

    rosaryHost.querySelectorAll('[data-del-track]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const id = Number(btn.dataset.delTrack);
          await app.api(`/api/v1/rosary/tracks/${id}`, { method: 'DELETE' });
          rosaryTracks = rosaryTracks.filter((t) => t.id !== id);
          renderRosary();
        } catch (err) {
          app.toast(err.message);
        }
      });
    });
  }

  function renderLiturgyAndPrayers() {
    const speaking = audioEngine.getState().gospelSpeaking;
    const isEaster = Boolean(rosaryStatus?.use_regina_caeli);
    const middayPrayer = isEaster ? CATHOLIC_PRAYERS.reginaCaeli : CATHOLIC_PRAYERS.angelus;
    const dailyList = [middayPrayer, CATHOLIC_PRAYERS.morning, CATHOLIC_PRAYERS.night, CATHOLIC_PRAYERS.communion];

    prayersHost.innerHTML = `
      ${liturgy ? `
        <article class="liturgy-card" style="margin-bottom:var(--s-4)">
          <div class="liturgy-toolbar">
            <span class="rank-tag" style="padding:5px 11px">✦ ${app.esc(liturgy.liturgical_season)}</span>
            <button type="button" class="btn btn-sm ${speaking ? 'btn-gold' : 'btn-soft'}" id="gospelSpeakBtn">
              ${speaking ? '⏹ ' + app.esc(d.feed.stopAudio) : '🔊 ' + app.esc(d.feed.listenGospel)}
            </button>
          </div>
          <div>
            <p class="t-footnote" style="margin-bottom:4px">${app.esc(liturgy.saint_of_day)}</p>
            <h2 class="t-serif" style="margin:0;font-size:1.35rem;line-height:1.25">${app.esc(liturgy.gospel_title)}</h2>
            <p class="post-scripture-pill" style="margin-top:4px">${app.esc(liturgy.gospel_ref)}</p>
          </div>
          <p class="gospel-prose" id="gospelProse">${app.esc(liturgy.gospel_text)}</p>
          ${liturgy.reflection ? `
            <div style="padding:14px;border-radius:10px;background:var(--surface-2)">
              <strong class="t-footnote" style="text-transform:uppercase;letter-spacing:0.06em;color:var(--gold-text)">${app.esc(d.prayer.reflection)}</strong>
              <p style="margin:6px 0 0;font-size:0.93rem;line-height:1.55">${app.esc(liturgy.reflection)}</p>
            </div>` : ''}
          ${liturgy.first_reading_text ? `
            <details class="liturgy-details">
              <summary>
                <span>${app.esc(d.prayer.firstReading)} · ${app.esc(liturgy.first_reading_ref)}</span>
                <span class="t-caption">▾</span>
              </summary>
              <p class="gospel-prose" style="margin-top:10px">${app.esc(liturgy.first_reading_text)}</p>
              <p class="t-footnote" style="margin-top:12px"><strong>${app.esc(liturgy.psalm_ref)}:</strong> ${app.esc(liturgy.psalm_response)}</p>
            </details>` : ''}
        </article>` : ''}

      <div style="display:flex;flex-direction:column;gap:12px">
        ${dailyList.map((pr, idx) => `
          <details class="card" style="padding:16px" ${idx === 0 ? 'open' : ''}>
            <summary style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;list-style:none">
              <div>
                <strong style="font-size:1rem">${app.esc(pr.title)}</strong>
                <div class="t-caption" style="color:var(--gold-text)">${app.esc(pr.badge)}</div>
              </div>
              <span class="t-caption">▾</span>
            </summary>
            <p style="margin:12px 0 10px;font-size:0.94rem;line-height:1.62;white-space:pre-line">${app.esc(pr.body)}</p>
            <button type="button" class="btn btn-sm btn-soft" data-speak-prayer="${idx}">🔊 Escuchar con Voz Humana</button>
          </details>
        `).join('')}
      </div>
    `;

    prayersHost.querySelector('#gospelSpeakBtn')?.addEventListener('click', () => {
      audioEngine.toggleGospelSpeech(
        `${liturgy.gospel_ref}. ${liturgy.gospel_title}. ${liturgy.gospel_text}. ${liturgy.reflection || ''}`,
        app.locale
      );
    });

    prayersHost.querySelectorAll('[data-speak-prayer]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pr = dailyList[Number(btn.dataset.speakPrayer)];
        if (pr) {
          audioEngine.toggleGospelSpeech(`${pr.title}. ${pr.body}`, app.locale);
        }
      });
    });
  }

  function renderIntentions() {
    if (intentions.length === 0) {
      prayerList.innerHTML = `<div class="empty-box">No hay intenciones en este filtro todavía. Comparte la primera petición de oración.</div>`;
      return;
    }
    prayerList.innerHTML = intentions
      .map((it, idx) => {
        const catLabel = d.prayer.categories[it.category] || it.category;
        const deferClass = idx >= 3 ? ' deferred-card' : '';
        return `
          <article class="card prayer-card${deferClass}" data-prayer-id="${it.id}">
            <div class="prayer-head">
              <div>
                <strong style="font-size:0.93rem">${app.esc(it.author_display)}</strong>
                <div class="t-caption">${it.unit_name ? `${app.esc(it.unit_name)} · ` : ''}${app.relTime(it.created_at)}</div>
              </div>
              <span class="cat-pill${it.is_urgent ? ' is-urgent' : ''}">${it.is_urgent ? '● ' : ''}${app.esc(catLabel)}</span>
            </div>
            <p class="prayer-body">${app.esc(it.content)}</p>
            <div class="prayer-foot">
              <span class="t-footnote" data-prayer-total="${it.id}">🕯️ ${d.prayer.prayersCount.replace('{n}', String(it.prayers_count))}</span>
              <button type="button" class="pray-candle-btn${it.i_prayed ? ' is-lit' : ''}" data-pray-btn="${it.id}" aria-pressed="${it.i_prayed}">
                <span>🕯️</span>
                <span>${it.i_prayed ? app.esc(d.prayer.prayedBtn) : app.esc(d.prayer.prayBtn)}</span>
              </button>
            </div>
          </article>
        `;
      })
      .join('');
  }

  async function loadIntentions() {
    prayerList.innerHTML = `<div class="card"><div class="skeleton" style="height:110px"></div></div>`;
    try {
      const qs = new URLSearchParams({
        filter,
        device_key: app.getDeviceKey(),
        limit: '20',
      });
      if (filter === 'parish' && app.linkedParishId) qs.set('unit_id', String(app.linkedParishId));
      const res = await app.api(`/api/v1/prayers/intentions?${qs}`, { signal });
      if (!signal.aborted) {
        intentions = res.intentions || [];
        renderIntentions();
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        prayerList.innerHTML = `<div class="empty-box">${app.esc(err.message)}</div>`;
      }
    }
  }

  root.querySelectorAll('#prayerTabs .seg-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      activeTab = tab.dataset.ptab;
      root.querySelectorAll('#prayerTabs .seg-tab').forEach((t) => {
        const on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', String(on));
      });
      rosaryHost.hidden = activeTab !== 'rosary';
      prayersHost.hidden = activeTab !== 'prayers';
      wallHost.hidden = activeTab !== 'wall';
      fabWrap.hidden = activeTab !== 'wall';
    });
  });

  root.querySelector('#prayerFilterChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pf]');
    if (!btn) return;
    if (btn.dataset.pf === 'mine' && !app.user) {
      app.openAuthModal();
      return;
    }
    filter = btn.dataset.pf;
    root.querySelectorAll('#prayerFilterChips .chip').forEach((c) => c.classList.toggle('is-active', c === btn));
    loadIntentions();
  });

  prayerList.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pray-btn]');
    if (!btn) return;
    const id = Number(btn.dataset.prayBtn);
    btn.classList.add('is-lit', 'is-pop');
    setTimeout(() => btn.classList.remove('is-pop'), 500);
    try {
      const res = await app.api(`/api/v1/prayers/intentions/${id}/pray`, {
        method: 'POST',
        body: { device_key: app.getDeviceKey() },
      });
      const item = intentions.find((i) => i.id === id);
      if (item) {
        item.prayers_count = res.prayers_count;
        item.i_prayed = true;
      }
      btn.setAttribute('aria-pressed', 'true');
      btn.innerHTML = `<span>🕯️</span><span>${app.esc(d.prayer.prayedBtn)}</span>`;
      const tot = prayerList.querySelector(`[data-prayer-total="${id}"]`);
      if (tot) tot.textContent = `🕯️ ${d.prayer.prayersCount.replace('{n}', String(res.prayers_count))}`;
      if (res.incremented) app.toast(d.prayer.candleLit);
    } catch (err) {
      app.toast(err.message);
    }
  });

  root.querySelector('#openPrayerModalBtn').addEventListener('click', () => {
    const dlg = app.openModal(
      d.prayer.modalTitle,
      `
      <form id="newPrayerForm" style="display:flex;flex-direction:column;gap:14px">
        <div class="field">
          <label for="prayerCategory">Categoría</label>
          <select id="prayerCategory" name="category">
            <option value="family">${app.esc(d.prayer.categories.family)}</option>
            <option value="health">${app.esc(d.prayer.categories.health)}</option>
            <option value="urgent">${app.esc(d.prayer.categories.urgent)}</option>
            <option value="peace">${app.esc(d.prayer.categories.peace)}</option>
            <option value="vocation">${app.esc(d.prayer.categories.vocation)}</option>
            <option value="gratitude">${app.esc(d.prayer.categories.gratitude)}</option>
          </select>
        </div>
        <div class="field">
          <label for="prayerContent">Tu intención</label>
          <textarea id="prayerContent" name="content" placeholder="${app.esc(d.prayer.modalPlaceholder)}" required minlength="6" maxlength="600"></textarea>
        </div>
        <label style="display:flex;align-items:center;gap:10px;min-height:44px;font-size:0.92rem">
          <input type="checkbox" name="is_anonymous" style="width:20px;height:20px;accent-color:var(--gold-bright)" />
          <span>${app.esc(d.prayer.anonymousLabel)}</span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;min-height:44px;font-size:0.92rem">
          <input type="checkbox" name="is_urgent" style="width:20px;height:20px;accent-color:var(--live-red)" />
          <span>${app.esc(d.prayer.urgentLabel)}</span>
        </label>
        <button type="submit" class="btn btn-gold btn-block">${app.esc(d.prayer.submitPrayer)}</button>
      </form>
      `
    );

    dlg.querySelector('#newPrayerForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      try {
        const res = await app.api('/api/v1/prayers/intentions', {
          method: 'POST',
          body: {
            category: fd.get('category'),
            content: fd.get('content'),
            is_anonymous: fd.get('is_anonymous') === 'on',
            is_urgent: fd.get('is_urgent') === 'on',
            unit_id: app.linkedParishId || undefined,
          },
        });
        if (res.intention) {
          intentions.unshift(res.intention);
          renderIntentions();
        }
        app.closeModal();
        app.toast(d.prayer.prayerAdded);
      } catch (err) {
        app.toast(err.message);
      }
    });
  });

  audioUnsub = audioEngine.subscribe(() => {
    renderRosary();
    renderLiturgyAndPrayers();
  });

  countdownTimer = setInterval(() => {
    if (countdownSec > 0) {
      countdownSec -= 1;
      const el = root.querySelector('#rosaryCountdown');
      if (el) el.textContent = formatCountdown(countdownSec);
    }
  }, 1000);

  app.api('/api/v1/rosary/status', { signal })
    .then((val) => {
      if (signal.aborted) return;
      rosaryStatus = val.status;
      rosaryTracks = val.tracks || [];
      countdownSec = Number(rosaryStatus?.seconds_until_next || 0);
      renderRosary();
    })
    .catch((err) => {
      if (!signal.aborted && err.name !== 'AbortError') {
        rosaryHost.innerHTML = `<div class="empty-box">${app.esc(err.message)}</div>`;
      }
    });

  app.api(`/api/v1/prayers/liturgy?lang=${app.locale}`, { signal })
    .then((val) => {
      if (signal.aborted) return;
      liturgy = val.liturgy;
      renderLiturgyAndPrayers();
    })
    .catch(() => {
      if (!signal.aborted) renderLiturgyAndPrayers();
    });

  loadIntentions();

  return {
    cleanup() {
      if (audioUnsub) audioUnsub();
      if (countdownTimer) clearInterval(countdownTimer);
    },
  };
}
