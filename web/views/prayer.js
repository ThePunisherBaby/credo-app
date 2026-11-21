// views/prayer.js — Pantalla 3: Oración (Liturgia/Evangelio del Día y Muro de Intenciones)
// Loaded on demand ONLY when on #/prayer.

import { audioEngine } from '../audio-engine.js';
import { enhanceLiquidGlass } from '../glass.js';

export async function mount({ root, app, signal }) {
  const d = app.dict();
  let filter = 'recent';
  let liturgy = null;
  let intentions = [];
  let audioUnsub = null;

  root.innerHTML = `
    <header class="page-head">
      <div>
        <p class="t-footnote">${app.esc(d.prayer.subtitle)}</p>
        <h1 class="t-large-title">${app.esc(d.prayer.title)}</h1>
      </div>
    </header>

    <section id="liturgyHost">
      <div class="liturgy-card"><div class="skeleton" style="height:240px"></div></div>
    </section>

    <div class="section-bar">
      <h2 class="t-title-2">${app.esc(d.prayer.wallTitle)}</h2>
    </div>

    <div class="chip-row" id="prayerFilterChips" role="tablist">
      <button type="button" class="chip is-active" data-pf="recent">${app.esc(d.prayer.filters.recent)}</button>
      <button type="button" class="chip" data-pf="urgent">${app.esc(d.prayer.filters.urgent)}</button>
      <button type="button" class="chip" data-pf="parish">${app.esc(d.prayer.filters.parish)}</button>
      <button type="button" class="chip" data-pf="mine">${app.esc(d.prayer.filters.mine)}</button>
    </div>

    <section class="prayer-list" id="prayerList">
      <div class="card"><div class="skeleton" style="height:110px"></div></div>
      <div class="card"><div class="skeleton" style="height:110px"></div></div>
    </section>

    <!-- Floating Liquid Glass Prayer FAB (Functional Layer) -->
    <div class="prayer-fab-anchor">
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

  const liturgyHost = root.querySelector('#liturgyHost');
  const prayerList = root.querySelector('#prayerList');

  function renderLiturgy() {
    if (!liturgy) return;
    const speaking = audioEngine.getState().gospelSpeaking;
    liturgyHost.innerHTML = `
      <article class="liturgy-card">
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

        ${liturgy.source_url ? `
        <div style="display:flex;justify-content:flex-end;border-top:1px solid var(--sep);padding-top:10px">
          <a href="${app.esc(liturgy.source_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-soft">Leer en reflexionandolapalabra.com ↗</a>
        </div>` : ''}
      </article>
    `;

    liturgyHost.querySelector('#gospelSpeakBtn').onclick = () => {
      audioEngine.toggleGospelSpeech(
        `${liturgy.gospel_ref}. ${liturgy.gospel_title}. ${liturgy.gospel_text}. ${liturgy.reflection}`,
        app.locale
      );
    };
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

  audioUnsub = audioEngine.subscribe(() => renderLiturgy());

  const [litRes] = await Promise.allSettled([
    app.api(`/api/v1/prayers/liturgy?lang=${app.locale}`, { signal }),
    loadIntentions(),
  ]);

  if (!signal.aborted && litRes.status === 'fulfilled') {
    liturgy = litRes.value.liturgy;
    renderLiturgy();
  }

  return {
    cleanup() {
      if (audioUnsub) audioUnsub();
    },
  };
}
