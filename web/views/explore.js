// views/explore.js — Explorar: Búsqueda Universal, Radios Católicas En Vivo, Presbíteros, Vids y Publicaciones

import { audioEngine } from '../audio-engine.js?v=23';

function proxyImg(url) {
  if (!url) return '';
  if (/^https?:\/\/(aire96fm\.com\.do|reflexionandolapalabra\.com)/i.test(url)) {
    return `/api/v1/media/proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

const FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'live', label: '● En Vivo', isLive: true },
  { id: 'clergy', label: 'Presbíteros' },
  { id: 'vids', label: 'Vids' },
  { id: 'posts', label: 'Publicaciones' },
];

export async function mount({ root, app, signal, params }) {
  const d = app.dict();
  let activeFilter = FILTERS.some((f) => f.id === params?.filter) ? params.filter : 'all';
  let activeVideoSlug = '';
  let searchQ = '';
  let searchTimer = 0;

  let liveData = null;
  let clergyList = [];
  let vidsList = [];
  let postsList = [];
  let loading = true;
  let audioUnsub = null;

  root.innerHTML = `
    <div class="explore-sticky-top">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
        <h1 class="t-title-2" style="margin:0;font-size:1.35rem;letter-spacing:-0.025em">${app.esc(d.nav.explore || 'Explorar')}</h1>
        <span class="t-caption" style="color:var(--label-2);font-weight:700">Radios · Presbíteros · Vids</span>
      </div>
      <div class="explore-search-row">
        <div class="search-field" style="margin:0;min-height:42px;background:var(--surface-2)">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="search" id="exploreSearchInput" placeholder="Buscar presbíteros, radios, videos o publicaciones…" />
        </div>
      </div>

      <div class="explore-filter-strip" id="exploreFilters" role="tablist" aria-label="Filtros de exploración">
        ${FILTERS.map((f) => `
          <button type="button" class="explore-pill${activeFilter === f.id ? ' is-active' : ''}" data-efilter="${f.id}" role="tab" aria-selected="${activeFilter === f.id}">
            ${f.isLive ? '<span class="live-dot" style="width:7px;height:7px"></span>' : ''}
            <span>${app.esc(f.label.replace(/^●\s*/, ''))}</span>
          </button>
        `).join('')}
      </div>
    </div>

    <div id="exploreBody">
      <div class="skeleton" style="height:170px;margin-bottom:14px"></div>
      <div class="skeleton" style="height:82px;margin-bottom:10px"></div>
      <div class="skeleton" style="height:82px"></div>
    </div>
  `;

  const bodyEl = root.querySelector('#exploreBody');
  const searchInput = root.querySelector('#exploreSearchInput');

  function filterByQuery(items, extractor) {
    if (!searchQ) return items;
    const ql = searchQ.toLowerCase();
    return items.filter((item) => extractor(item).toLowerCase().includes(ql));
  }

  function renderLiveFilterSection() {
    if (!liveData) return `<div class="empty-box">Cargando señales en vivo…</div>`;
    const st = audioEngine.getState();
    const hero = liveData.hero;
    const radios = filterByQuery(liveData.radios || [], (c) => `${c.name} ${c.tagline} ${c.current_program} ${c.host_name}`);
    const heroArt = proxyImg(hero?.cover_url);
    const heroIsPlaying = st.playing && st.channel?.id === hero?.id;

    return `
      ${hero && (!searchQ || `${hero.name} ${hero.tagline} ${hero.current_program}`.toLowerCase().includes(searchQ.toLowerCase())) ? `
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
      ${radios.length === 0
        ? `<div class="empty-box">No hay emisoras que coincidan con tu búsqueda.</div>`
        : `
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
        `}
    `;
  }

  function renderClergyRows(users) {
    if (!users || users.length === 0) return `<div class="empty-box">No se encontraron presbíteros.</div>`;
    return `
      <div class="entity-list">
        ${users.map((u) => {
          const av = proxyImg(u.avatar_url);
          const rank = d.ranks[u.ecclesiastical_rank] || u.ecclesiastical_rank;
          return `
            <a href="#/user/${u.id}" class="entity-row">
              <span class="avatar" data-zoomable data-zoom-name="${app.esc(`${u.title_prefix ? `${u.title_prefix} ` : ''}${u.full_name}`)}" data-zoom-src="${app.esc(av)}" style="--av-bg:${app.esc(u.avatar_color || '#0F1E36')}">
                ${av ? `<img src="${app.esc(av)}" alt="" />` : app.initials(u.full_name)}
              </span>
              <div class="entity-main">
                <div class="entity-title">
                  <span>${app.esc(u.title_prefix ? `${u.title_prefix} ` : '')}${app.esc(u.full_name)}</span>
                  ${u.is_ceo ? '<span class="rank-tag" style="background:#0A84FF;color:#FFFFFF">CEO</span>' : ''}
                </div>
                <div class="entity-sub">${app.esc(rank)}</div>
              </div>
              <span class="t-caption">›</span>
            </a>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderVidsGrid(items) {
    if (!items || items.length === 0) return `<div class="empty-box">No se encontraron videos.</div>`;
    return `
      <div class="explore-vids-grid">
        ${items.map((v) => {
          const thumb = v.thumbnail_url || (v.youtube_id ? `https://i.ytimg.com/vi/${v.youtube_id}/hqdefault.jpg` : '');
          const playing = activeVideoSlug === `vid-${v.id}`;
          return `
            <article class="explore-vid-card">
              <div class="explore-vid-thumb">
                ${playing && v.youtube_id
                  ? `<iframe src="https://www.youtube.com/embed/${app.esc(v.youtube_id)}?autoplay=1&playsinline=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`
                  : `
                    ${thumb ? `<img src="${app.esc(thumb)}" alt="" loading="lazy" />` : ''}
                    <button type="button" class="video-play-overlay" data-play-vid="vid-${app.esc(v.id)}" aria-label="Reproducir video">
                      <span class="video-play-circle" style="width:42px;height:42px">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="margin-left:2px"><path d="M8 5v14l11-7z"/></svg>
                      </span>
                    </button>
                  `}
              </div>
              <div class="explore-vid-meta">
                <strong>${app.esc(v.title || 'Video Oficial')}</strong>
                <span class="t-caption">${app.esc(v.channel_name || 'Credo Vids')}</span>
              </div>
            </article>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderPostsRows(posts) {
    if (!posts || posts.length === 0) return `<div class="empty-box">No hay publicaciones con ese criterio.</div>`;
    return `
      <div class="entity-list">
        ${posts.map((p) => `
          <a href="${p.source_url ? app.esc(p.source_url) : '#/feed'}" ${p.source_url ? 'target="_blank" rel="noopener noreferrer"' : ''} class="entity-row">
            ${p.image_url
              ? `<img src="${app.esc(proxyImg(p.image_url))}" alt="" width="48" height="48" style="border-radius:10px;object-fit:cover;flex-shrink:0" loading="lazy" />`
              : `<span class="avatar" style="--av-bg:#0A84FF">✝</span>`}
            <div class="entity-main">
              <div class="entity-title">${app.esc(p.title || p.content?.slice(0, 60) || 'Publicación')}</div>
              <div class="entity-sub">
                ${app.esc(p.channel_name || p.author?.full_name || 'Credo')} · ${app.relTime(p.created_at)}
              </div>
            </div>
            <span class="t-caption">${p.source_url ? '↗' : '›'}</span>
          </a>
        `).join('')}
      </div>
    `;
  }

  function render() {
    root.querySelectorAll('[data-efilter]').forEach((b) => {
      const active = b.dataset.efilter === activeFilter;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', String(active));
    });

    if (loading && !liveData && clergyList.length === 0) {
      return;
    }

    if (activeFilter === 'live') {
      bodyEl.innerHTML = renderLiveFilterSection();
      bindHandlers();
      return;
    }

    const fClergy = filterByQuery(clergyList, (u) => `${u.full_name} ${u.username}`);
    const fVids = filterByQuery(vidsList, (v) => `${v.title || ''} ${v.channel_name || ''} ${v.description || ''}`);
    const fPosts = filterByQuery(postsList, (p) => `${p.title || ''} ${p.content || ''} ${p.channel_name || ''}`);

    if (activeFilter === 'clergy') {
      bodyEl.innerHTML = `
        <div class="section-bar"><h2 class="t-title-2">Presbíteros</h2><span class="t-footnote">${fClergy.length}</span></div>
        ${renderClergyRows(fClergy)}
      `;
      bindHandlers();
      return;
    }

    if (activeFilter === 'vids') {
      bodyEl.innerHTML = `
        <div class="section-bar"><h2 class="t-title-2">Videos Católicos</h2><span class="t-footnote">${fVids.length}</span></div>
        ${renderVidsGrid(fVids)}
      `;
      bindHandlers();
      return;
    }

    if (activeFilter === 'posts') {
      bodyEl.innerHTML = `
        <div class="section-bar"><h2 class="t-title-2">Publicaciones</h2><span class="t-footnote">${fPosts.length}</span></div>
        ${renderPostsRows(fPosts)}
      `;
      bindHandlers();
      return;
    }

    // Filter: ALL
    const st = audioEngine.getState();
    const quickRadios = filterByQuery(liveData?.radios || [], (c) => `${c.name} ${c.tagline} ${c.current_program}`);

    bodyEl.innerHTML = `
      ${quickRadios.length > 0 ? `
        <div class="section-bar">
          <h2 class="t-title-3" style="display:flex;align-items:center;gap:7px"><span class="live-dot"></span>Emisoras En Vivo</h2>
          <button type="button" class="btn btn-sm btn-soft" data-jump-filter="live">Ver todas</button>
        </div>
        <div class="explore-quick-live">
          ${quickRadios.map((ch) => {
            const art = proxyImg(ch.cover_url);
            const active = st.playing && st.channel?.id === ch.id;
            return `
              <button type="button" class="explore-live-chip${active ? ' is-playing' : ''}" data-play-ch="${ch.id}">
                ${art ? `<img src="${app.esc(art)}" alt="" width="42" height="42" />` : ''}
                <div>
                  <strong style="display:block;font-size:0.84rem;line-height:1.2">${app.esc(ch.name)}</strong>
                  <span class="t-caption" style="color:${active ? 'var(--gold-text)' : 'var(--label-2)'}">${active ? '⏸ Escuchando' : `▶ ${app.esc(ch.frequency || 'En Vivo')}`}</span>
                </div>
              </button>
            `;
          }).join('')}
        </div>
      ` : ''}

      <div class="section-bar">
        <h2 class="t-title-3">Presbíteros</h2>
        <button type="button" class="btn btn-sm btn-soft" data-jump-filter="clergy">Ver más</button>
      </div>
      ${renderClergyRows(fClergy.slice(0, 4))}

      ${fVids.length > 0 ? `
        <div class="section-bar" style="margin-top:20px">
          <h2 class="t-title-3">Vids Recientes</h2>
          <button type="button" class="btn btn-sm btn-soft" data-jump-filter="vids">Explorar Vids</button>
        </div>
        ${renderVidsGrid(fVids.slice(0, 4))}
      ` : ''}

      ${fPosts.length > 0 ? `
        <div class="section-bar" style="margin-top:20px">
          <h2 class="t-title-3">Publicaciones Oficiales</h2>
          <button type="button" class="btn btn-sm btn-soft" data-jump-filter="posts">Ver todas</button>
        </div>
        ${renderPostsRows(fPosts.slice(0, 5))}
      ` : ''}
    `;
    bindHandlers();
  }

  function bindHandlers() {
    root.querySelectorAll('[data-jump-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeFilter = btn.dataset.jumpFilter;
        render();
      });
    });

    root.querySelector('#heroListenBtn')?.addEventListener('click', () => {
      if (liveData?.hero) app.playLive(liveData.hero, { expandPlayer: false });
    });

    root.querySelector('#heroOpenSheetBtn')?.addEventListener('click', () => {
      if (liveData?.hero) {
        if (audioEngine.getState().channel?.id !== liveData.hero.id) {
          app.playLive(liveData.hero, { expandPlayer: true });
        } else {
          app.openFullPlayer();
        }
      }
    });

    root.querySelectorAll('[data-play-ch]').forEach((card) => {
      card.addEventListener('click', () => {
        const id = Number(card.dataset.playCh);
        const ch = (liveData?.all || []).find((c) => c.id === id);
        if (ch) app.playLive(ch, { expandPlayer: false });
      });
    });

    root.querySelectorAll('[data-play-vid]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slug = btn.dataset.playVid;
        const opening = activeVideoSlug !== slug;
        activeVideoSlug = opening ? slug : '';
        if (opening) {
          const vidId = slug.replace(/^vid-/, '');
          const v = vidsList.find((item) => String(item.id) === vidId);
          audioEngine.notifyExternalMedia({
            title: v?.title || 'Video Católico',
            artist: v?.channel_name || 'Credo · Vids',
            coverUrl: v?.thumbnail_url || '/icons/credo-192.png',
            playing: true,
            onAction: (act) => {
              if (act === 'stop' || act === 'pause') {
                activeVideoSlug = '';
                audioEngine.notifyExternalMedia({ playing: false });
                render();
              }
            },
          });
        } else {
          audioEngine.notifyExternalMedia({ playing: false });
        }
        render();
      });
    });
  }

  root.querySelector('#exploreFilters').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-efilter]');
    if (!btn) return;
    activeFilter = btn.dataset.efilter;
    activeVideoSlug = '';
    render();
  });

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQ = searchInput.value.trim();
      render();
    }, 180);
  });

  audioUnsub = audioEngine.subscribe(() => render());

  // Instant 0ms synchronous paint from local cache (zero skeletons on cached visits!)
  const cLive = app.getCached('/api/v1/live');
  const cClergy = app.getCached('/api/v1/users?clergy_only=true&limit=25');
  const cVids = app.getCached('/api/v1/vids');
  const cPosts = app.getCached('/api/v1/posts?scope=global&limit=20') || app.getCached('/api/v1/posts?scope=global&limit=6&offset=0');
  if (cLive || cClergy || cPosts) {
    if (cLive) {
      liveData = cLive;
      app.setLiveQueue(liveData.all || []);
    }
    if (cClergy) clergyList = cClergy.users || [];
    if (cVids) vidsList = cVids.reels || cVids.vids || cVids.items || [];
    if (cPosts) postsList = cPosts.posts || [];
    loading = false;
    render();
  }

  try {
    const [liveRes, clergyRes, vidsRes, postsRes] = await Promise.allSettled([
      app.api('/api/v1/live', { signal }),
      app.api('/api/v1/users?clergy_only=true&limit=25', { signal }),
      app.api('/api/v1/vids', { signal }),
      app.api('/api/v1/posts?scope=global&limit=20', { signal }),
    ]);
    if (signal.aborted) return;

    if (liveRes.status === 'fulfilled') {
      liveData = liveRes.value;
      app.setLiveQueue(liveData.all || []);
    }
    if (clergyRes.status === 'fulfilled') clergyList = clergyRes.value.users || [];
    if (vidsRes.status === 'fulfilled') vidsList = vidsRes.value.reels || vidsRes.value.vids || vidsRes.value.items || [];
    if (postsRes.status === 'fulfilled') postsList = postsRes.value.posts || [];
    loading = false;
    render();
  } catch (err) {
    if (err.name !== 'AbortError' && !liveData && clergyList.length === 0) {
      loading = false;
      bodyEl.innerHTML = `<div class="empty-box">${app.esc(err.message)}</div>`;
    }
  }

  return {
    cleanup() {
      clearTimeout(searchTimer);
      if (audioUnsub) audioUnsub();
    },
  };
}
