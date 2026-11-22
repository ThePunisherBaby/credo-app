// views/prayer.js — Oración: Rosario 24/7 (7am/2pm/4pm/8pm) · Oraciones y Evangelio · Muro de Intenciones

import { audioEngine } from '../audio-engine.js';
import { enhanceLiquidGlass } from '../glass.js';

function formatCountdown(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

const CATHOLIC_PRAYERS = {
  angelus: {
    title: 'El Ángelus',
    badge: 'Tradicional · 6am / 12pm / 6pm',
    body: `V. El Ángel del Señor anunció a María.\nR. Y concibió por obra del Espíritu Santo.\n\n(Dios te salve, María...)\n\nV. He aquí la esclava del Señor.\nR. Hágase en mí según tu palabra.\n\n(Dios te salve, María...)\n\nV. Y el Verbo se hizo carne.\nR. Y habitó entre nosotros.\n\n(Dios te salve, María...)\n\nV. Ruega por nosotros, Santa Madre de Dios.\nR. Para que seamos dignos de alcanzar las promesas de Jesucristo. Amén.`,
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
  let audioUnsub = null;
  let countdownTimer = null;

  root.innerHTML = `
    <header class="page-head">
      <div>
        <p class="t-footnote">${app.esc(d.prayer.subtitle)}</p>
        <h1 class="t-large-title">${app.esc(d.prayer.title)}</h1>
      </div>
    </header>

    <div class="seg-tabs" id="prayerTabs" role="tablist">
      <button type="button" class="seg-tab is-active" data-ptab="rosary" role="tab" aria-selected="true">Rosario 24/7</button>
      <button type="button" class="seg-tab" data-ptab="prayers" role="tab" aria-selected="false">Oraciones</button>
      <button type="button" class="seg-tab" data-ptab="wall" role="tab" aria-selected="false">Muro</button>
    </div>

    <div id="prayerTabRosary">
      <div class="card"><div class="skeleton" style="height:210px"></div></div>
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

  function makeRosaryChannel(st) {
    return {
      id: 9001,
      slug: 'credo-rosario',
      name: 'Credo Radio Rosario 24/7',
      tagline: `${st?.liturgical_season || 'Liturgia Católica'} · 7am · 2pm · 4pm · 8pm`,
      current_program: st?.is_live_rosary
        ? `EN VIVO: ${st?.mystery?.name || 'Santo Rosario'}`
        : `Próximo Rosario: ${st?.next_rosary_label || '7:00 AM'} · ${st?.mystery?.name || ''}`,
      frequency: st?.is_live_rosary ? 'ROSARIO EN VIVO' : '24/7 AUTOMÁTICO',
      city: 'República Dominicana (UTC-4)',
      accent_color: '#007AFF',
      cover_url: '/icons/credo-512.png',
      stream_url: '/api/v1/rosary/stream',
    };
  }

  function renderRosary() {
    if (!rosaryStatus) return;
    const audioSt = audioEngine.getState();
    const isPlayingRosary = audioSt.playing && audioSt.channel?.slug === 'credo-rosario';
    const mystery = rosaryStatus.mystery || {};
    const schedule = rosaryStatus.schedule_hours || ['7:00 AM', '2:00 PM', '4:00 PM', '8:00 PM'];
    const canManageAudio = Boolean(app.user?.is_ceo || app.user?.ecclesiastical_rank === 'admin');

    rosaryHost.innerHTML = `
      <article class="rosary-hero">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <span class="live-pill-lg"><span class="live-dot" aria-hidden="true"></span>${rosaryStatus.is_live_rosary ? 'ROSARIO EN VIVO' : 'RADIO ROSARIO 24/7'}</span>
          <span style="font-size:0.76rem;color:rgba(255,255,255,0.78);font-weight:600">${app.esc(rosaryStatus.liturgical_season)} · ${app.esc(rosaryStatus.local_time || '')} RD</span>
        </div>

        <div>
          <h2 class="t-title-2" style="color:#FFFFFF;margin:0">${app.esc(mystery.name || 'Santo Rosario')}</h2>
          <p style="margin:4px 0 0;font-size:0.84rem;color:rgba(255,255,255,0.8)">${app.esc(mystery.daysLabel || '')}</p>
        </div>

        <div class="rosary-times-grid">
          ${schedule.map((slot) => {
            const liveNow = rosaryStatus.is_live_rosary && String(rosaryStatus.active_slot_label || '').startsWith(slot);
            return `<div class="rosary-time-chip${liveNow ? ' is-live' : ''}">${app.esc(slot)}</div>`;
          }).join('')}
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding-top:4px">
          <div style="font-size:0.82rem;color:rgba(255,255,255,0.86)">
            ${rosaryStatus.is_live_rosary
              ? '<strong>Transmitiendo el Santo Rosario en vivo</strong>'
              : `Próximo rosario (${app.esc(rosaryStatus.next_rosary_label)}) en <strong id="rosaryCountdown">${formatCountdown(countdownSec)}</strong>`}
          </div>
          <button type="button" class="btn btn-gold btn-sm" id="playRosaryStreamBtn">
            ${isPlayingRosary ? '⏸ Pausar Radio Rosario' : '▶ Escuchar Radio 24/7'}
          </button>
        </div>
      </article>

      <div class="card" style="margin-bottom:var(--s-4)">
        <div class="section-bar" style="margin-top:0">
          <h3 class="t-title-3">Los 5 Misterios de Hoy</h3>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${(mystery.list || []).map((line, i) => `
            <div class="rosary-mystery-item">
              <span class="rosary-mystery-num">${i + 1}</span>
              <span style="font-size:0.9rem;line-height:1.45">${app.esc(line)}</span>
            </div>
          `).join('')}
        </div>
      </div>

      ${canManageAudio ? `
        <div class="card">
          <div class="section-bar" style="margin-top:0">
            <h3 class="t-title-3">Estudio CEO · Audio y Publicidad 24/7</h3>
          </div>
          <p class="t-footnote" style="margin-bottom:12px">Sube grabaciones reales del Rosario o promos/avisos en MP3 para rotación automática en vivo.</p>
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

    rosaryHost.querySelector('#playRosaryStreamBtn')?.addEventListener('click', () => {
      app.playLive(makeRosaryChannel(rosaryStatus), { expandPlayer: true });
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
            <p style="margin:12px 0 0;font-size:0.94rem;line-height:1.62;white-space:pre-line">${app.esc(pr.body)}</p>
          </details>
        `).join('')}
      </div>
    `;

    prayersHost.querySelector('#gospelSpeakBtn')?.addEventListener('click', () => {
      audioEngine.toggleGospelSpeech(
        `${liturgy.gospel_ref}. ${liturgy.gospel_title}. ${liturgy.gospel_text}. ${liturgy.reflection}`,
        app.locale
      );
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

  const [rosRes, litRes] = await Promise.allSettled([
    app.api('/api/v1/rosary/status', { signal }),
    app.api(`/api/v1/prayers/liturgy?lang=${app.locale}`, { signal }),
    loadIntentions(),
  ]);

  if (!signal.aborted && rosRes.status === 'fulfilled') {
    rosaryStatus = rosRes.value.status;
    rosaryTracks = rosRes.value.tracks || [];
    countdownSec = Number(rosaryStatus?.seconds_until_next || 0);
    renderRosary();
  }

  if (!signal.aborted && litRes.status === 'fulfilled') {
    liturgy = litRes.value.liturgy;
    renderLiturgyAndPrayers();
  }

  return {
    cleanup() {
      if (audioUnsub) audioUnsub();
      if (countdownTimer) clearInterval(countdownTimer);
    },
  };
}
