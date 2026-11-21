// views/live.js — Pantalla 2: En Vivo (Hub de Radio y TV Católica)
// Loaded on demand ONLY when on #/live. Connects to persistent Mini-Player & Full-Screen Player.

import { audioEngine } from '../audio-engine.js';

export async function mount({ root, app, signal }) {
  const d = app.dict();
  let channelsData = { hero: null, radios: [], tv_channels: [], all: [] };
  let audioUnsub = null;

  root.innerHTML = `
    <header class="page-head">
      <div>
        <p class="t-footnote">${app.esc(d.live.subtitle)}</p>
        <h1 class="t-large-title">${app.esc(d.live.title)}</h1>
      </div>
    </header>

    <section id="liveHeroHost">
      <div class="skeleton" style="height:230px;border-radius:12px;margin-bottom:24px"></div>
    </section>

    <div class="section-bar">
      <h2 class="t-title-2">${app.esc(d.live.radiosTitle)}</h2>
      <span class="t-footnote" id="radiosCount"></span>
    </div>
    <section class="radio-grid" id="radioGrid">
      <div class="skeleton" style="height:190px;border-radius:10px"></div>
      <div class="skeleton" style="height:190px;border-radius:10px"></div>
    </section>

    <div class="section-bar" id="tvSectionBar" hidden>
      <h2 class="t-title-2">${app.esc(d.live.tvTitle)}</h2>
      <span class="t-footnote" id="tvCount"></span>
    </div>
    <section class="tv-list" id="tvList" hidden></section>
  `;

  const heroHost = root.querySelector('#liveHeroHost');
  const radioGrid = root.querySelector('#radioGrid');
  const tvSectionBar = root.querySelector('#tvSectionBar');
  const tvList = root.querySelector('#tvList');

  const proxyImg = (url) =>
    url && (url.includes('aire96fm.com.do') || url.includes('reflexionandolapalabra.com'))
      ? `/api/v1/media/proxy?url=${encodeURIComponent(url)}`
      : url;

  function renderAll() {
    const active = audioEngine.getState();
    const curId = active.channel?.id;

    // Hero Stream — Apple Music Radio Card Aesthetic
    const hero = channelsData.hero;
    if (hero) {
      const isPlaying = curId === hero.id && active.playing;
      const heroImg = proxyImg(hero.cover_url);
      heroHost.innerHTML = `
        <article class="hero-live-card stagger-in" style="--stagger-i:0">
          <img class="hero-live-bg" src="${app.esc(heroImg)}" alt="" aria-hidden="true" />
          <div class="hero-live-scrim" aria-hidden="true"></div>
          <div class="hero-live-content">
            <div class="hero-live-top">
              <span class="live-badge-pill"><span class="live-dot" style="background:#fff"></span>${app.esc(d.live.liveBadge)}</span>
              ${hero.frequency ? `<span class="listeners-pill">${app.esc(hero.frequency)}</span>` : ''}
            </div>
            <div class="hero-live-row">
              <img class="hero-live-art" src="${app.esc(heroImg)}" alt="${app.esc(hero.name)}" fetchpriority="high" width="82" height="82" />
              <div style="min-width:0">
                <h2 class="t-title-2" style="color:#fff">${app.esc(hero.name)}</h2>
                <p style="margin:4px 0 0;font-size:0.88rem;color:rgba(255,255,255,0.78);font-weight:600">${app.esc(hero.current_program)}</p>
              </div>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button type="button" class="btn btn-gold" data-play-channel="${hero.id}">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="${isPlaying ? 'M6 5h4v14H6zm8 0h4v14h-4z' : 'M8 5v14l11-7z'}"/></svg>
                <span>${isPlaying ? app.esc(d.live.playingNow) : app.esc(hero.kind === 'radio' ? d.live.listenNow : d.live.watchNow)}</span>
              </button>
              <button type="button" class="btn btn-sm" style="background:rgba(255,255,255,0.14);color:#fff" data-expand-channel="${hero.id}">
                Reproductor
              </button>
            </div>
          </div>
        </article>
      `;
    }

    // Radios Grid — Eager-loaded proxied official logos so cards never flash blank
    root.querySelector('#radiosCount').textContent = `${channelsData.radios.length} en directo`;
    radioGrid.innerHTML = channelsData.radios
      .map((st, idx) => {
        const isPlaying = curId === st.id && active.playing;
        const stImg = proxyImg(st.cover_url);
        return `
          <button type="button" class="station-card stagger-in${isPlaying ? ' is-playing' : ''}" style="--stagger-i:${idx + 1}" data-play-channel="${st.id}">
            <div class="station-art-wrap" style="--st-accent:${app.esc(st.accent_color)}">
              <img src="${app.esc(stImg)}" alt="${app.esc(st.name)}" width="240" height="240" />
              <div class="station-art-scrim" aria-hidden="true"></div>
              <span class="station-freq-badge">${app.esc(st.frequency)}</span>
              <span class="station-play-fab" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="${isPlaying ? 'M6 5h4v14H6zm8 0h4v14h-4z' : 'M8 5v14l11-7z'}"/>
                </svg>
              </span>
            </div>
            <div>
              <div class="station-name">${app.esc(st.name)}</div>
              <div class="station-prog">${app.esc(st.current_program)}</div>
              <div class="t-caption" style="margin-top:5px;display:flex;align-items:center;gap:5px">
                <span class="live-dot"></span>
                <span>${app.esc(d.live.liveBadge)}</span>
              </div>
            </div>
          </button>
        `;
      })
      .join('');

    // TV Channels 16:9 (only show if real TV channels exist)
    const hasTv = channelsData.tv_channels && channelsData.tv_channels.length > 0;
    tvSectionBar.hidden = !hasTv;
    tvList.hidden = !hasTv;
    if (hasTv) {
      root.querySelector('#tvCount').textContent = `${channelsData.tv_channels.length} HD`;
      tvList.innerHTML = channelsData.tv_channels
        .map((tv) => {
          const isPlaying = curId === tv.id && active.playing;
          return `
            <article class="tv-card deferred-card">
              <div class="tv-thumb" data-tv-embed="${tv.id}">
                <img src="${app.esc(tv.cover_url)}" alt="${app.esc(tv.name)}" loading="lazy" />
                <span class="post-media-badge" style="background:var(--live-red)">● ${app.esc(d.live.liveBadge)} · ${app.esc(tv.frequency)}</span>
                <button type="button" class="video-play-overlay" data-play-tv="${tv.id}" aria-label="${app.esc(d.live.watchNow)} ${app.esc(tv.name)}">
                  <span class="video-play-circle">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" style="margin-left:2px"><path d="M8 5v14l11-7z"/></svg>
                  </span>
                </button>
              </div>
              <div class="tv-card-body">
                <div>
                  <strong style="display:block">${app.esc(tv.name)}</strong>
                  <span class="t-footnote">${app.esc(tv.current_program)}</span>
                </div>
                <button type="button" class="btn btn-sm ${isPlaying ? 'btn-gold' : 'btn-soft'}" data-play-channel="${tv.id}">
                  ${isPlaying ? app.esc(d.live.playingNow) : 'Audio'}
                </button>
              </div>
            </article>
          `;
        })
        .join('');
    }
  }

  root.addEventListener('click', (e) => {
    const playBtn = e.target.closest('[data-play-channel]');
    if (playBtn) {
      const ch = channelsData.all.find((c) => c.id === Number(playBtn.dataset.playChannel));
      if (!ch) return;
      app.setLiveQueue(channelsData.all);
      const cur = audioEngine.getState();
      if (cur.channel?.id === ch.id) {
        audioEngine.togglePlay();
      } else {
        app.playLive(ch);
      }
      return;
    }

    const expandBtn = e.target.closest('[data-expand-channel]');
    if (expandBtn) {
      const ch = channelsData.all.find((c) => c.id === Number(expandBtn.dataset.expandChannel));
      if (!ch) return;
      app.setLiveQueue(channelsData.all);
      app.playLive(ch, { expandPlayer: true });
      return;
    }

    const tvBtn = e.target.closest('[data-play-tv]');
    if (tvBtn) {
      const tv = channelsData.tv_channels.find((c) => c.id === Number(tvBtn.dataset.playTv));
      if (!tv) return;
      app.setLiveQueue(channelsData.all);
      app.playLive(tv, { expandPlayer: true });
    }
  });

  audioUnsub = audioEngine.subscribe(() => renderAll());

  try {
    channelsData = await app.api('/api/v1/live', { signal });
    if (!signal.aborted) {
      app.setLiveQueue(channelsData.all || []);
      renderAll();
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      heroHost.innerHTML = `<div class="empty-box">${app.esc(err.message)}</div>`;
    }
  }

  return {
    cleanup() {
      if (audioUnsub) audioUnsub();
    },
  };
}
