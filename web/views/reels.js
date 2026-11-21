// views/reels.js — Reels Católicos en Vivo (Videos Reales: Vatican News, EWTN Español y Clero Oficial)
// Loaded on demand ONLY when on #/reels.

export async function mount({ root, app, signal }) {
  const d = app.dict();
  let reels = [];
  let activeReelEl = null;
  let observer = null;

  root.innerHTML = `
    <header class="feed-topbar">
      <h1 class="t-large-title" style="font-size:1.72rem;letter-spacing:-0.03em">${app.esc(d.nav?.reels || 'Reels')}</h1>
      <div class="page-head-actions">
        <button type="button" class="icon-btn-44" id="reelPublishBtn" aria-label="Publicar Reel">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>
        </button>
      </div>
    </header>

    <div class="reels-stage" id="reelsStage" aria-live="polite">
      <div class="reel-card">
        <div class="skeleton" style="width:100%;height:100%;border-radius:10px"></div>
      </div>
    </div>
  `;

  root.querySelector('#reelPublishBtn').addEventListener('click', () => {
    app.openComposer({ defaultKind: 'reel' });
  });

  const stage = root.querySelector('#reelsStage');

  function restoreThumbnail(card) {
    if (!card) return;
    const host = card.querySelector('[data-reel-media]');
    if (!host || !host.dataset.playing) return;
    delete host.dataset.playing;
    const thumb = host.dataset.thumb;
    const title = host.dataset.title || '';
    const views = host.dataset.views || '';
    host.innerHTML = `
      <img src="${app.esc(thumb)}" alt="${app.esc(title)}" loading="lazy" />
      <button type="button" class="reel-play-btn" data-play-reel aria-label="Reproducir video">
        <span class="video-play-circle">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" style="margin-left:2px"><path d="M8 5v14l11-7z"/></svg>
        </span>
        ${views ? `<span class="reel-views-tag">▶ ${app.esc(views)}</span>` : ''}
      </button>
    `;
  }

  function playCard(card) {
    if (!card) return;
    const host = card.querySelector('[data-reel-media]');
    const yt = host?.dataset.yt;
    if (!host || !yt || host.dataset.playing === '1') return;

    if (activeReelEl && activeReelEl !== card) {
      restoreThumbnail(activeReelEl);
    }
    activeReelEl = card;
    host.dataset.playing = '1';
    host.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}?autoplay=1&playsinline=1&rel=0&modestbranding=1" title="${app.esc(host.dataset.title || 'Reel en Credo')}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  }

  function renderReels() {
    if (!reels.length) {
      stage.innerHTML = `<div class="empty-box">No hay reels disponibles en este momento.</div>`;
      return;
    }

    stage.innerHTML = reels
      .map((r, idx) => {
        const imgAttrs = idx === 0 ? 'fetchpriority="high"' : 'loading="lazy"';
        const viewsStr = typeof r.views_count === 'number' ? r.views_count.toLocaleString('es') : '';
        return `
          <article class="reel-card stagger-in" style="--stagger-i:${Math.min(idx, 4)}" data-reel-id="${app.esc(r.id)}">
            <div class="reel-media" data-reel-media data-yt="${app.esc(r.youtube_id)}" data-thumb="${app.esc(r.thumbnail_url)}" data-title="${app.esc(r.title)}" data-views="${app.esc(viewsStr)}">
              <img src="${app.esc(r.thumbnail_url)}" alt="${app.esc(r.title)}" ${imgAttrs} />
              <button type="button" class="reel-play-btn" data-play-reel aria-label="Reproducir">
                <span class="video-play-circle">
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" style="margin-left:2px"><path d="M8 5v14l11-7z"/></svg>
                </span>
                ${viewsStr ? `<span class="reel-views-tag">▶ ${app.esc(viewsStr)}</span>` : ''}
              </button>
            </div>

            <div class="reel-scrim" aria-hidden="true"></div>

            <div class="reel-rail">
              ${r.post_id ? `
                <button type="button" class="reel-rail-btn" data-reel-amen="${r.post_id}" aria-label="Amén">
                  <span>🙏</span>
                  <strong data-reel-amen-count="${r.post_id}">${r.amen_count || 0}</strong>
                </button>` : ''}
              <button type="button" class="reel-rail-btn" data-reel-share="${app.esc(r.source_url || location.href)}" data-reel-title="${app.esc(r.title)}" aria-label="Compartir">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                <span>Compartir</span>
              </button>
              ${r.source_url ? `
                <a href="${app.esc(r.source_url)}" target="_blank" rel="noopener noreferrer" class="reel-rail-btn" aria-label="Abrir fuente oficial">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  <span>Original</span>
                </a>` : ''}
            </div>

            <div class="reel-overlay">
              <div class="reel-channel-row">
                <span class="avatar" style="--av-sz:30px;--av-bg:${app.esc(r.accent_color || '#0F1E36')}">
                  ${r.avatar_url ? `<img src="${app.esc(r.avatar_url)}" alt="" />` : app.initials(r.channel_name)}
                </span>
                <strong style="font-size:0.9rem">${app.esc(r.channel_name)}</strong>
                <span class="verified-check" title="Canal oficial verificado">
                  <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-6.5"/></svg>
                </span>
                <span style="font-size:0.74rem;color:rgba(255,255,255,0.7)">· ${app.relTime(r.published_at)}</span>
              </div>
              <h2 class="reel-title">${app.esc(r.title)}</h2>
              ${r.description ? `<p class="reel-desc">${app.esc(r.description)}</p>` : ''}
            </div>
          </article>
        `;
      })
      .join('');

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting && entry.target === activeReelEl) {
            restoreThumbnail(entry.target);
            activeReelEl = null;
          }
        }
      },
      { root: stage, threshold: 0.45 }
    );
    stage.querySelectorAll('.reel-card').forEach((el) => observer.observe(el));
  }

  stage.addEventListener('click', async (e) => {
    const playBtn = e.target.closest('[data-play-reel]');
    if (playBtn) {
      playCard(playBtn.closest('.reel-card'));
      return;
    }

    const amenBtn = e.target.closest('[data-reel-amen]');
    if (amenBtn) {
      const postId = Number(amenBtn.dataset.reelAmen);
      if (!app.user) return app.openAuthModal();
      try {
        const res = await app.api(`/api/v1/posts/${postId}/react`, {
          method: 'POST',
          body: { reaction_type: 'amen' },
        });
        const active = (res.my_reactions || []).includes('amen');
        amenBtn.classList.toggle('is-active', active);
        const cntEl = amenBtn.querySelector(`[data-reel-amen-count="${postId}"]`);
        if (cntEl) cntEl.textContent = String(res.reactions?.amen || 0);
      } catch (err) {
        app.toast(err.message);
      }
      return;
    }

    const shareBtn = e.target.closest('[data-reel-share]');
    if (shareBtn) {
      const url = shareBtn.dataset.reelShare || location.href;
      const title = shareBtn.dataset.reelTitle || 'Credo Reels';
      try {
        if (navigator.share) await navigator.share({ title, url });
        else await navigator.clipboard.writeText(url);
        app.toast('Enlace copiado');
      } catch {}
    }
  });

  try {
    const res = await app.api('/api/v1/reels', { signal });
    if (!signal.aborted) {
      reels = res.reels || [];
      renderReels();
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      stage.innerHTML = `<div class="empty-box">${app.esc(err.message)}</div>`;
    }
  }

  return {
    cleanup() {
      if (observer) observer.disconnect();
      restoreThumbnail(activeReelEl);
    },
  };
}
