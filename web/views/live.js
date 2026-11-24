// views/live.js — En Vivo: Radios · Canales TV · Misas en Vivo

import { audioEngine } from '../audio-engine.js?v=14';

function proxyImg(url) {
  if (!url) return '';
  if (url.includes('aire96fm.com.do') || url.includes('reflexionandolapalabra.com')) {
    return `/api/v1/media/proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

export async function mount({ root, app, signal }) {
  const d = app.dict();
  let data = null;
  let activeSubTab = 'radios';
  let activeVideoSlug = '';
  let audioUnsub = null;

  root.innerHTML = `
    <header class="page-head">
      <div>
        <p class="t-footnote">${app.esc(d.live.subtitle)}</p>
        <h1 class="t-large-title">${app.esc(d.live.title)}</h1>
      </div>
    </header>

    <div class="seg-tabs" id="liveSubTabs" role="tablist">
      <button type="button" class="seg-tab is-active" data-ltab="radios" role="tab" aria-selected="true">Radios</button>
      <button type="button" class="seg-tab" data-ltab="tv" role="tab" aria-selected="false">Canales TV</button>
      <button type="button" class="seg-tab" data-ltab="masses" role="tab" aria-selected="false">Misas en Vivo</button>
    </div>

    <div id="liveBody">
      <div class="hero-live-card" style="min-height:200px"><div class="skeleton" style="height:160px"></div></div>
    </div>
  `;

  const bodyEl = root.querySelector('#liveBody');

  function renderVideoList(items, emptyText) {
    if (!items || items.length === 0) {
      return `<div class="empty-box">${app.esc(emptyText)}</div>`;
    }
    return `
      <div class="tv-list">
        ${items.map((ch) => {
          const isPlayingVid = activeVideoSlug === ch.slug;
          const thumb = proxyImg(ch.cover_url) || (ch.youtube_live_id ? `https://i.ytimg.com/vi/${app.esc(ch.youtube_live_id)}/hqdefault.jpg` : '');
          return `
            <article class="tv-card">
              <div class="tv-thumb" style="background:#000">
                ${isPlayingVid && ch.youtube_live_id
                  ? `<iframe src="https://www.youtube.com/embed/${app.esc(ch.youtube_live_id)}?autoplay=1&playsinline=1&rel=0" style="width:100%;height:100%;border:0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`
                  : `
                    ${thumb ? `<img src="${app.esc(thumb)}" alt="${app.esc(ch.name)}" loading="lazy" />` : ''}
                    <button type="button" class="video-play-overlay" data-play-vid="${app.esc(ch.slug)}" aria-label="Reproducir ${app.esc(ch.name)}">
                      <span class="video-play-circle">
                        <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" style="margin-left:2px"><path d="M8 5v14l11-7z"/></svg>
                      </span>
                    </button>
                    <span class="station-freq-badge" style="display:inline-flex;align-items:center;gap:5px"><span class="live-dot" style="width:6px;height:6px"></span>${app.esc(ch.frequency || 'VIDEO')}</span>
                  `}
              </div>
              <div class="tv-card-body">
                <div style="min-width:0;flex:1">
                  <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
                    <span class="t-caption" style="color:var(--gold-text);font-weight:700">${app.esc(ch.tagline || ch.current_program || '')}</span>
                  </div>
                  <strong style="font-size:0.95rem;display:block;line-height:1.3">${app.esc(ch.name)}</strong>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0">
                  <button type="button" class="btn btn-sm ${isPlayingVid ? 'btn-soft' : 'btn-gold'}" data-play-vid="${app.esc(ch.slug)}">
                    ${isPlayingVid ? 'Cerrar' : 'Ver'}
                  </button>
                  ${ch.source_url ? `<a href="${app.esc(ch.source_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-soft" aria-label="Abrir fuente original">↗</a>` : ''}
                </div>
              </div>
            </article>
          `;
        }).join('')}
      </div>
    `;
  }

  function render() {
    if (!data) return;
    const st = audioEngine.getState();

    if (activeSubTab === 'tv') {
      bodyEl.innerHTML = renderVideoList(data.tv_channels || [], 'No hay señales de TV disponibles en este momento.');
      bindHandlers();
      return;
    }

    if (activeSubTab === 'masses') {
      bodyEl.innerHTML = renderVideoList(data.live_masses || [], 'No hay Misas transmitiéndose en este momento.');
      bindHandlers();
      return;
    }

    const hero = data.hero;
    const radios = data.radios || [];
    const heroArt = proxyImg(hero?.cover_url);
    const heroIsPlaying = st.playing && st.channel?.id === hero?.id;

    bodyEl.innerHTML = `
      ${hero ? `
        <article class="hero-live-card" data-channel-id="${hero.id}">
          ${heroArt ? `<img class="hero-live-bg" src="${app.esc(heroArt)}" alt="" aria-hidden="true" />` : ''}
          <div class="hero-live-scrim" aria-hidden="true"></div>
          <div class="hero-live-content">
            <div class="hero-live-top">
              <span class="live-badge-pill"><span class="live-dot" style="background:#fff" aria-hidden="true"></span>${app.esc(d.live.onAir)}</span>
              <span class="listeners-pill">${app.esc(hero.frequency || 'RADIO')}</span>
            </div>

            <div class="hero-live-row">
              ${heroArt ? `<img class="hero-live-art" src="${app.esc(heroArt)}" alt="${app.esc(hero.name)}" fetchpriority="high" />` : ''}
              <div style="flex:1;min-width:0">
                <p style="margin:0;font-size:0.72rem;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#66B2FF">${app.esc(hero.tagline)}</p>
                <h2 class="t-title-2" style="color:#fff;margin-top:4px">${app.esc(hero.name)}</h2>
                <p style="margin:4px 0 0;font-size:0.86rem;color:rgba(255,255,255,0.85)">${app.esc(hero.current_program || '')}</p>
                ${hero.city ? `<p style="margin:3px 0 0;font-size:0.74rem;color:rgba(255,255,255,0.65)">${app.esc(hero.city)}</p>` : ''}
              </div>
            </div>

            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button type="button" class="btn btn-gold btn-sm" id="heroListenBtn">
                ${heroIsPlaying ? '⏸ ' + app.esc(d.live.pauseNow) : '▶ ' + app.esc(d.live.listenNow)}
              </button>
              <button type="button" class="btn btn-sm" style="background:rgba(255,255,255,0.14);color:#fff" id="heroOpenSheetBtn">
                Reproductor
              </button>
            </div>
          </div>
        </article>
      ` : ''}

      <div class="section-bar">
        <h2 class="t-title-2">Emisoras Católicas</h2>
        <span class="t-footnote">${radios.length} en vivo</span>
      </div>
      <div class="radio-grid">
        ${radios.map((ch) => {
          const isCur = st.channel?.id === ch.id;
          const active = isCur && st.playing;
          const art = proxyImg(ch.cover_url);
          return `
            <button type="button" class="station-card${isCur ? ' is-playing' : ''}" data-play-ch="${ch.id}">
              <div class="station-art-wrap" style="--st-accent:${app.esc(ch.accent_color || '#0A84FF')}">
                ${art ? `<img src="${app.esc(art)}" alt="${app.esc(ch.name)}" loading="lazy" />` : ''}
                <div class="station-art-scrim"></div>
                <span class="station-freq-badge">${app.esc(ch.frequency || 'EN VIVO')}</span>
                <span class="station-play-fab" aria-hidden="true">${active ? '⏸' : '▶'}</span>
              </div>
              <strong class="station-name">${app.esc(ch.name)}</strong>
              <span class="station-prog">${app.esc(ch.current_program || ch.tagline || '')}</span>
            </button>
          `;
        }).join('')}
      </div>
    `;
    bindHandlers();
  }

  function bindHandlers() {
    root.querySelector('#heroListenBtn')?.addEventListener('click', () => {
      if (data?.hero) app.playLive(data.hero, { expandPlayer: false });
    });

    root.querySelector('#heroOpenSheetBtn')?.addEventListener('click', () => {
      if (data?.hero) {
        if (audioEngine.getState().channel?.id !== data.hero.id) {
          app.playLive(data.hero, { expandPlayer: true });
        } else {
          app.openFullPlayer();
        }
      }
    });

    root.querySelectorAll('[data-play-ch]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ch = (data?.radios || []).find((c) => Number(c.id) === Number(btn.dataset.playCh));
        if (ch) app.playLive(ch, { expandPlayer: true });
      });
    });

    root.querySelectorAll('[data-play-vid]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slug = btn.dataset.playVid;
        activeVideoSlug = activeVideoSlug === slug ? '' : slug;
        render();
      });
    });
  }

  root.querySelectorAll('#liveSubTabs .seg-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      activeSubTab = tab.dataset.ltab;
      activeVideoSlug = '';
      root.querySelectorAll('#liveSubTabs .seg-tab').forEach((t) => {
        const on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', String(on));
      });
      render();
    });
  });

  audioUnsub = audioEngine.subscribe(() => {
    if (activeSubTab === 'radios') render();
  });

  try {
    data = await app.api('/api/v1/live', { signal });
    if (!signal.aborted) {
      app.setLiveQueue(data.radios || data.all || []);
      render();
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      bodyEl.innerHTML = `<div class="empty-box">${app.esc(err.message)}</div>`;
    }
  }

  return {
    cleanup() {
      if (audioUnsub) audioUnsub();
    },
  };
}
