// views/prayer.js — Oración: Santo Rosario a cualquier hora + Música + Evangelio (Voz Humana) + Muro

import { audioEngine } from '../audio-engine.js?v=23';
import { enhanceLiquidGlass } from '../glass.js?v=23';
import { attachSegSpringPills } from '../springs.mjs?v=23';

const ART_BY_KEY = {
  rosary: '/icons/art_rosary.jpg',
  music: '/icons/art_music.jpg',
  joyful: '/icons/art_morning.jpg',
  luminous: '/icons/art_gospel.jpg',
  sorrowful: '/icons/art_sorrow.jpg',
  glorious: '/icons/art_glory.jpg',
};

const MYSTERY_DAYS_ORDER = [
  { key: 'joyful', badge: 'Lunes y Sábado', title: 'Misterios Gozosos' },
  { key: 'luminous', badge: 'Jueves', title: 'Misterios Luminosos' },
  { key: 'sorrowful', badge: 'Martes y Viernes', title: 'Misterios Dolorosos' },
  { key: 'glorious', badge: 'Miércoles y Domingo', title: 'Misterios Gloriosos' },
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
  let intentions = [];
  let audioUnsub = null;

  root.innerHTML = `
    <div class="explore-sticky-top">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
        <h1 class="t-title-2" style="margin:0;font-size:1.35rem;letter-spacing:-0.025em">${app.esc(d.prayer.title)}</h1>
        <span class="t-caption" style="color:var(--label-2);font-weight:700">${app.esc(d.prayer.subtitle)}</span>
      </div>
      <div class="seg-tabs" id="prayerTabs" role="tablist" style="margin-bottom:2px">
        <button type="button" class="seg-tab is-active" data-ptab="rosary" role="tab" aria-selected="true">Rosario</button>
        <button type="button" class="seg-tab" data-ptab="prayers" role="tab" aria-selected="false">Oraciones</button>
        <button type="button" class="seg-tab" data-ptab="wall" role="tab" aria-selected="false">Muro</button>
      </div>
    </div>

    <div id="prayerTabRosary">
      <div class="prog-hlist">
        <div class="skeleton" style="height:92px;border-radius:24px"></div>
        <div class="skeleton" style="height:92px;border-radius:24px"></div>
      </div>
    </div>

    <div id="prayerTabPrayers" hidden>
      <div class="liturgy-card"><div class="skeleton" style="height:220px"></div></div>
    </div>

    <div id="prayerTabWall" hidden>
      <div class="chip-row" id="prayerFilterChips" role="tablist">
        <button type="button" class="chip is-active" data-pf="recent">${app.esc(d.prayer.filters.recent)}</button>
        <button type="button" class="chip" data-pf="urgent">${app.esc(d.prayer.filters.urgent)}</button>
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
  attachSegSpringPills(root);

  const rosaryHost = root.querySelector('#prayerTabRosary');
  const prayersHost = root.querySelector('#prayerTabPrayers');
  const wallHost = root.querySelector('#prayerTabWall');
  const prayerList = root.querySelector('#prayerList');
  const fabWrap = root.querySelector('#prayerFabWrap');

  function makeSlotChannel(slotKey, label, subLabel) {
    const idMap = { today: 9010, joyful: 9011, sorrowful: 9012, glorious: 9013, luminous: 9014, music: 9002 };
    const cover = ART_BY_KEY[slotKey] || ART_BY_KEY.rosary;
    return {
      id: idMap[slotKey] || 9015,
      slug: `rosario-${slotKey}`,
      name: label,
      tagline: subLabel || 'Disponible a cualquier hora · Voz humana y música',
      current_program: subLabel || label,
      frequency: slotKey === 'music' ? 'MÚSICA DE ORACIÓN' : 'SANTO ROSARIO',
      city: 'Credo Oración',
      accent_color: '#007AFF',
      cover_url: cover,
      stream_url: `/api/v1/rosary/audio/${encodeURIComponent(slotKey)}`,
    };
  }

  function renderRosary() {
    if (!rosaryStatus) return;
    const audioSt = audioEngine.getState();
    const curSlug = audioSt.channel?.slug || '';
    const mystery = rosaryStatus.mystery || {};
    const todayKey = mystery.key || 'joyful';
    const isPlayingTodayNow =
      audioSt.playing && (curSlug === 'rosario-today' || curSlug === `rosario-${todayKey}`);
    const isPlayingBgMusic =
      audioSt.playing && (curSlug === 'rosario-music' || curSlug === 'credo-musica-oracion');

    const schedule = rosaryStatus.schedule_hours || ['7:00 AM', '2:00 PM', '4:00 PM', '8:00 PM'];
    const canManageAudio = Boolean(app.user?.is_ceo || app.user?.ecclesiastical_rank === 'admin');
    const calendar = rosaryStatus.weekly_calendar || [
      { day: 'Lunes y Sábado', mystery: 'Misterios Gozosos' },
      { day: 'Martes y Viernes', mystery: 'Misterios Dolorosos' },
      { day: 'Miércoles y Domingo', mystery: 'Misterios Gloriosos' },
      { day: 'Jueves', mystery: 'Misterios Luminosos' },
    ];

    const playOrExpand = (channel, isSameActive) => {
      if (isSameActive) {
        audioEngine.togglePlay();
      } else {
        app.playLive(channel, { expandPlayer: true });
      }
    };

    const hPlayIcon = (playing) =>
      playing
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4.5" height="14" rx="1.6"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.6"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5-11-6.5Z"/></svg>';

    rosaryHost.innerHTML = `
      <div class="prog-hlist" style="margin-bottom:var(--s-4)">
        <button type="button" class="prog-hcard stagger-in${isPlayingTodayNow ? ' is-playing' : ''}" id="playTodayRosaryNowBtn" style="--stagger-i:0">
          <img class="prog-hcard-bg" src="${ART_BY_KEY[todayKey] || ART_BY_KEY.rosary}" alt="" aria-hidden="true" />
          <div class="prog-hcard-scrim" aria-hidden="true"></div>
          <div class="prog-hcard-meta">
            <div class="prog-hcard-top">
              <span class="prog-hcard-pill is-today">Hoy · ${app.esc(mystery.daysLabel || rosaryStatus.liturgical_season || 'Rosario')}</span>
              <span class="prog-hcard-pill">A cualquier hora</span>
            </div>
            <strong class="prog-hcard-title">Santo Rosario · ${app.esc(mystery.name || 'Misterios de Hoy')}</strong>
            <span class="prog-hcard-sub">${isPlayingTodayNow ? 'Reproduciendo ahora · Toca para pausar' : 'Toca para rezar ahora con voz humana y música de paz'}</span>
          </div>
          <span class="prog-hcard-play" aria-hidden="true">${hPlayIcon(isPlayingTodayNow)}</span>
        </button>

        <button type="button" class="prog-hcard stagger-in${isPlayingBgMusic ? ' is-playing' : ''}" id="playBgMusicBtn" style="--stagger-i:1">
          <img class="prog-hcard-bg" src="${ART_BY_KEY.music}" alt="" aria-hidden="true" />
          <div class="prog-hcard-scrim" aria-hidden="true"></div>
          <div class="prog-hcard-meta">
            <div class="prog-hcard-top">
              <span class="prog-hcard-pill">Instrumental</span>
              <span class="prog-hcard-pill">Para meditar</span>
            </div>
            <strong class="prog-hcard-title">Música de Oración</strong>
            <span class="prog-hcard-sub">${isPlayingBgMusic ? 'Reproduciendo ahora · Piano e instrumental sacro' : 'Toca para escuchar melodías contemplativas en paz'}</span>
          </div>
          <span class="prog-hcard-play" aria-hidden="true">${hPlayIcon(isPlayingBgMusic)}</span>
        </button>
      </div>

      <div class="section-bar" style="margin-top:0;margin-bottom:10px">
        <div>
          <h3 class="t-title-3" style="margin:0">Elegir Misterios del Rosario</h3>
          <p class="t-caption" style="margin:2px 0 0">Puedes rezar cualquiera en el momento del día que prefieras</p>
        </div>
      </div>

      <div class="prog-hgrid" style="margin-bottom:var(--s-4)">
        ${MYSTERY_DAYS_ORDER.map((item, idx) => {
          const isToday = todayKey === item.key;
          const isSlotPlaying = audioSt.playing && curSlug === `rosario-${item.key}`;
          const art = ART_BY_KEY[item.key] || ART_BY_KEY.rosary;
          return `
            <button
              type="button"
              class="prog-hcard prog-hcard--compact stagger-in${isSlotPlaying ? ' is-playing' : ''}"
              data-play-mystery="${app.esc(item.key)}"
              data-mystery-title="${app.esc(item.title)}"
              data-mystery-days="${app.esc(item.badge)}"
              style="--stagger-i:${idx + 2}"
            >
              <img class="prog-hcard-bg" src="${art}" alt="" aria-hidden="true" />
              <div class="prog-hcard-scrim" aria-hidden="true"></div>
              <div class="prog-hcard-meta">
                <div class="prog-hcard-top">
                  <span class="prog-hcard-pill${isToday ? ' is-today' : ''}">${isToday ? 'HOY' : app.esc(item.badge)}</span>
                </div>
                <strong class="prog-hcard-title">${app.esc(item.title)}</strong>
                <span class="prog-hcard-sub">${isToday ? app.esc(item.badge) : 'Rezar ahora'}</span>
              </div>
              <span class="prog-hcard-play" aria-hidden="true">${hPlayIcon(isSlotPlaying)}</span>
            </button>
          `;
        }).join('')}
      </div>

      <section class="mystery-cal stagger-in" style="--stagger-i:6;margin-bottom:var(--s-4)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <strong class="t-headline" style="margin:0">Calendario semanal y horarios sugeridos</strong>
          <span class="t-caption" style="color:var(--gold-text);font-weight:700">${app.esc(schedule.join(' · '))}</span>
        </div>
        <div class="mystery-cal-rows">
          ${calendar.map((row) => {
            const label = row.mysteryName ? `Misterios ${row.mysteryName}` : (row.mystery || '');
            const isTodayRow = Boolean(row.is_today) || String(label).toLowerCase() === String(mystery.name || '').toLowerCase();
            return `
              <div class="mystery-cal-row${isTodayRow ? ' is-today' : ''}">
                <span>${app.esc(row.day)}</span>
                <span>${app.esc(label)}</span>
              </div>
            `;
          }).join('')}
        </div>
      </section>

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
            <h3 class="t-title-3">Estudio CEO · Audio de Oración</h3>
          </div>
          <p class="t-footnote" style="margin-bottom:12px">Sube grabaciones del Rosario o música contemplativa en MP3.</p>
          <form id="rosaryUploadForm" style="display:flex;flex-direction:column;gap:10px">
            <div class="field">
              <label for="ruSlot">Franja de emisión</label>
              <select id="ruSlot" name="slot_type">
                <option value="music">Música de Oración</option>
                <option value="joyful">Misterios Gozosos</option>
                <option value="luminous">Misterios Luminosos</option>
                <option value="sorrowful">Misterios Dolorosos</option>
                <option value="glorious">Misterios Gloriosos</option>
              </select>
            </div>
            <div class="field">
              <label for="ruTitle">Título de la pista</label>
              <input id="ruTitle" name="title" required placeholder="Ej. Santo Rosario · Misterios Gozosos" />
            </div>
            <div class="field">
              <label for="ruFile">Archivo MP3 (máx. 15 MB)</label>
              <input id="ruFile" type="file" accept="audio/mpeg,audio/mp3,.mp3" required />
            </div>
            <button type="submit" class="btn btn-gold btn-sm">Subir audio</button>
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
      playOrExpand(
        makeSlotChannel(
          todayKey,
          `Santo Rosario · ${mystery.name || 'Misterios de Hoy'}`,
          `${mystery.daysLabel || 'Hoy'} · Voz Humana y Música de Paz`
        ),
        isPlayingTodayNow
      );
    });

    rosaryHost.querySelector('#playBgMusicBtn')?.addEventListener('click', () => {
      playOrExpand(
        makeSlotChannel(
          'music',
          'Música de Oración',
          'Instrumental y Cantos Contemplativos · Credo'
        ),
        isPlayingBgMusic
      );
    });

    rosaryHost.querySelectorAll('[data-play-mystery]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.playMystery;
        const title = btn.dataset.mysteryTitle;
        const days = btn.dataset.mysteryDays;
        const cur = audioEngine.getState();
        const activeThis = cur.playing && cur.channel?.slug === `rosario-${key}`;
        playOrExpand(
          makeSlotChannel(key, `Santo Rosario · ${title}`, `${days} · Voz Humana y Música de Paz`),
          activeThis
        );
      });
    });

    rosaryHost.querySelectorAll('[data-speak-mystery]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.speakMystery);
        const text = (mystery.list || [])[idx];
        if (text) {
          audioEngine.toggleGospelSpeech(
            `${text}. Padre nuestro, que estás en el cielo, santificado sea tu Nombre; venga a nosotros tu Reino; hágase tu voluntad en la tierra como en el cielo. Danos hoy nuestro pan de cada día; perdona nuestras ofensas, como también nosotros perdonamos a los que nos ofenden; no nos dejes caer en la tentación, y líbranos del mal. Amén.`,
            app.locale,
            {
              title: `Misterio ${idx + 1} · ${mystery.name || 'Santo Rosario'}`,
              artist: 'Credo · Lectura del Santo Rosario',
              cover_url: ART_BY_KEY[todayKey] || ART_BY_KEY.rosary,
            }
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
        app.locale,
        {
          title: liturgy.gospel_title || 'Evangelio del Día',
          artist: liturgy.gospel_ref || 'Lectura Orante · Credo',
          cover_url: ART_BY_KEY.gospel,
        }
      );
    });

    prayersHost.querySelectorAll('[data-speak-prayer]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pr = dailyList[Number(btn.dataset.speakPrayer)];
        if (pr) {
          audioEngine.toggleGospelSpeech(`${pr.title}. ${pr.body}`, app.locale, {
            title: pr.title,
            artist: pr.badge || 'Oración Católica · Credo',
            cover_url: ART_BY_KEY.morning,
          });
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
                <div class="t-caption">${app.relTime(it.created_at)}</div>
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

  app.swr(
    '/api/v1/rosary/status',
    (val) => {
      if (signal.aborted || !val) return;
      rosaryStatus = val.status;
      rosaryTracks = val.tracks || [];
      renderRosary();
    },
    { signal, ttlMs: 30_000 }
  ).catch((err) => {
    if (!signal.aborted && err.name !== 'AbortError' && !rosaryStatus) {
      rosaryHost.innerHTML = `<div class="empty-box">${app.esc(err.message)}</div>`;
    }
  });

  app.swr(
    `/api/v1/prayers/liturgy?lang=${app.locale}`,
    (val) => {
      if (signal.aborted || !val) return;
      liturgy = val.liturgy;
      renderLiturgyAndPrayers();
    },
    { signal, ttlMs: 120_000 }
  ).catch(() => {
    if (!signal.aborted && !liturgy) renderLiturgyAndPrayers();
  });

  loadIntentions();

  return {
    cleanup() {
      if (audioUnsub) audioUnsub();
    },
  };
}
