// views/vids.js — Vids (Immersive 100dvh Minimalist Catholic Vertical Video Feed)

function makeThumbUrl(it) {
  if (it.thumbnail_url) {
    if (it.thumbnail_url.includes('aire96fm.com.do') || it.thumbnail_url.includes('reflexionandolapalabra.com')) {
      return `/api/v1/media/proxy?url=${encodeURIComponent(it.thumbnail_url)}`;
    }
    return it.thumbnail_url;
  }
  if (it.youtube_id) {
    return `https://i.ytimg.com/vi/${encodeURIComponent(it.youtube_id)}/hqdefault.jpg`;
  }
  return '';
}

function makeEmbedUrl(it) {
  if (it.embed_url) {
    return it.embed_url.includes('autoplay=1')
      ? it.embed_url
      : `${it.embed_url}${it.embed_url.includes('?') ? '&' : '?'}autoplay=1&playsinline=1&rel=0&modestbranding=1`;
  }
  if (it.youtube_id) {
    return `https://www.youtube.com/embed/${encodeURIComponent(it.youtube_id)}?autoplay=1&playsinline=1&rel=0&modestbranding=1`;
  }
  return '';
}

function makeWatchUrl(it) {
  if (it.watch_url) return it.watch_url;
  if (it.youtube_id) return `https://www.youtube.com/watch?v=${encodeURIComponent(it.youtube_id)}`;
  return '';
}

export async function mount({ root, app, signal }) {
  root.innerHTML = `
    <div class="vids-shell">
      <div class="vids-topbar">
        <div class="vids-brand-badge">
          <img class="brand-logo" src="/icons/credo-192.png" alt="" width="30" height="30" />
          <span>Credo</span>
          <span style="opacity:0.65;font-weight:600">· Vids</span>
        </div>
        ${app.user?.can_publish ? `
          <button type="button" class="vids-add-btn" id="vidsAddBtn" aria-label="Publicar Vid">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          </button>` : '<span></span>'}
      </div>
      <div class="vids-stage" id="vidsStage">
        <div class="vid-card" style="display:grid;place-items:center">
          <div class="skeleton" style="width:86%;height:70%;border-radius:16px"></div>
        </div>
      </div>
    </div>
  `;

  root.querySelector('#vidsAddBtn')?.addEventListener('click', () => app.openComposer());

  const stage = root.querySelector('#vidsStage');
  let activeCard = null;
  let observer = null;
  const localLikes = new Set();
  const localSaves = new Set();

  function stopCard(card) {
    if (!card) return;
    const media = card.querySelector('.vid-media');
    if (!media) return;
    const iframe = media.querySelector('iframe');
    if (iframe) iframe.remove();
    const img = media.querySelector('img');
    if (img) img.hidden = false;
    const playBtn = card.querySelector('.vid-play-btn');
    if (playBtn) playBtn.hidden = false;
    if (activeCard === card) activeCard = null;
  }

  function playCard(card, item) {
    const embed = makeEmbedUrl(item);
    if (!embed) {
      const watch = makeWatchUrl(item);
      if (watch) window.open(watch, '_blank', 'noopener,noreferrer');
      return;
    }
    if (activeCard && activeCard !== card) {
      stopCard(activeCard);
    }
    const media = card.querySelector('.vid-media');
    const playBtn = card.querySelector('.vid-play-btn');
    const img = media.querySelector('img');
    if (img) img.hidden = true;
    if (playBtn) playBtn.hidden = true;

    const iframe = document.createElement('iframe');
    iframe.src = embed;
    iframe.title = item.title || 'Credo Vid';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    media.appendChild(iframe);
    activeCard = card;
  }

  try {
    const res = await app.api('/api/v1/vids', { signal });
    const items = res.reels || res.vids || [];

    if (items.length === 0) {
      stage.innerHTML = `<div class="vid-card" style="display:grid;place-items:center;padding:28px;text-align:center"><p style="color:rgba(255,255,255,0.72);font-weight:600">No hay videos católicos disponibles todavía.</p></div>`;
      return { cleanup() {} };
    }

    stage.innerHTML = items.map((it, idx) => {
      const thumb = makeThumbUrl(it);
      const isInternal = Boolean(it.post_id) && !it.is_external;
      const av = isInternal && it.avatar_url
        ? (/^https?:\/\//i.test(it.avatar_url) ? `/api/v1/media/proxy?url=${encodeURIComponent(it.avatar_url)}` : it.avatar_url)
        : '/icons/credo-192.png';
      const channelLabel = isInternal && (it.author_name || it.channel_name)
        ? (it.author_name || it.channel_name)
        : 'Credo';
      const cleanDesc = String(it.description || '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !/suscr[ií]b|youtube\.com|http|ewtn,\s*la\s*red/i.test(l))
        .slice(0, 2)
        .join(' · ');
      const watch = makeWatchUrl(it);
      const countAmen = Number(it.amen_count || 0);
      const countComments = Number(it.comments_count || 0);

      return `
        <article class="vid-card" data-idx="${idx}" data-id="${app.esc(String(it.id || idx))}">
          <div class="vid-media">
            ${thumb ? `<img src="${app.esc(thumb)}" alt="${app.esc(it.title || channelLabel)}" loading="${idx < 2 ? 'eager' : 'lazy'}" />` : ''}
          </div>
          <div class="vid-scrim" aria-hidden="true"></div>
          <button type="button" class="vid-play-btn" aria-label="Reproducir video">
            <span class="vid-play-glyph">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" style="margin-left:3px"><path d="M8 5v14l11-7z"/></svg>
            </span>
          </button>

          <div class="vid-rail">
            <button type="button" class="vid-rail-btn" data-act="like">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-4.5-9.2-9.2C1.2 8.2 3.5 4.5 7.2 4.5c2 0 3.7 1 4.8 2.6 1.1-1.6 2.8-2.6 4.8-2.6 3.7 0 6 3.7 4.4 7.3C19 16.5 12 21 12 21z"/></svg>
              <span data-like-count>${countAmen > 0 ? countAmen : 'Amén'}</span>
            </button>
            <button type="button" class="vid-rail-btn" data-act="comment">
              <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z"/></svg>
              <span>${countComments > 0 ? countComments : 'Comentar'}</span>
            </button>
            <button type="button" class="vid-rail-btn" data-act="save">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              <span>Guardar</span>
            </button>
            <button type="button" class="vid-rail-btn" data-act="share">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
              <span>Compartir</span>
            </button>
            ${watch ? `
              <a href="${app.esc(watch)}" target="_blank" rel="noopener noreferrer" class="vid-rail-btn" aria-label="Abrir fuente original">
                <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M7 7h10v10"/></svg>
                <span>Original</span>
              </a>` : ''}
          </div>

          <div class="vid-overlay">
            <div class="vid-channel-row">
              <img class="brand-logo" src="${app.esc(av)}" alt="Credo" width="30" height="30" style="border-radius:8px;object-fit:cover" />
              <strong style="font-size:0.92rem;color:#fff">${app.esc(channelLabel)}</strong>
              <span class="verified-check" aria-label="Verificado">✓</span>
              ${it.is_live ? `<span class="badge-live"><span class="live-dot"></span>EN VIVO</span>` : ''}
            </div>
            ${it.title ? `<h2 class="vid-title">${app.esc(it.title)}</h2>` : ''}
            ${cleanDesc ? `<p class="vid-desc">${app.esc(cleanDesc)}</p>` : ''}
          </div>
        </article>
      `;
    }).join('');

    stage.querySelectorAll('.vid-card').forEach((card) => {
      const idx = Number(card.dataset.idx);
      const item = items[idx];
      card.querySelector('.vid-play-btn').addEventListener('click', () => playCard(card, item));

      card.querySelector('[data-act="like"]')?.addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        const lbl = btn.querySelector('[data-like-count]');
        if (item.post_id) {
          if (!app.user) return app.openAuthModal();
          try {
            const r = await app.api(`/api/v1/posts/${item.post_id}/react`, { method: 'POST', body: { kind: 'amen' } });
            btn.classList.toggle('is-active', Boolean(r.active));
            lbl.textContent = r.count > 0 ? String(r.count) : 'Amén';
          } catch (err) {
            app.toast(err.message);
          }
          return;
        }
        const key = String(item.id || idx);
        const isOn = localLikes.has(key);
        if (isOn) localLikes.delete(key);
        else localLikes.add(key);
        btn.classList.toggle('is-active', !isOn);
        const base = Number(item.amen_count || 0) + (!isOn ? 1 : 0);
        lbl.textContent = base > 0 ? String(base) : 'Amén';
      });

      card.querySelector('[data-act="comment"]')?.addEventListener('click', () => {
        if (item.post_id && typeof app.openCommentsModal === 'function') {
          return app.openCommentsModal(item.post_id);
        }
        const watch = makeWatchUrl(item);
        if (watch) app.toast('Comentarios disponibles en el enlace original');
      });

      card.querySelector('[data-act="save"]')?.addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        if (item.post_id) {
          if (!app.user) return app.openAuthModal();
          try {
            const r = await app.api(`/api/v1/posts/${item.post_id}/save`, { method: 'POST' });
            const isSaved = Boolean(r.saved ?? r.bookmarked);
            btn.classList.toggle('is-active', isSaved);
            app.toast(isSaved ? 'Guardado en tu perfil' : 'Quitado de guardados');
          } catch (err) {
            app.toast(err.message);
          }
          return;
        }
        const key = String(item.id || idx);
        const isSaved = localSaves.has(key);
        if (isSaved) localSaves.delete(key);
        else localSaves.add(key);
        btn.classList.toggle('is-active', !isSaved);
        app.toast(!isSaved ? 'Guardado en este dispositivo' : 'Quitado de guardados');
      });

      card.querySelector('[data-act="share"]')?.addEventListener('click', async () => {
        const url = makeWatchUrl(item) || location.href;
        try {
          if (navigator.share) await navigator.share({ title: item.title || 'Credo Vids', url });
          else {
            await navigator.clipboard?.writeText(url);
            app.toast('Enlace copiado');
          }
        } catch {}
      });
    });

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting && activeCard === entry.target) {
            stopCard(entry.target);
          }
        }
      },
      { root: stage, threshold: 0.35 }
    );
    stage.querySelectorAll('.vid-card').forEach((card) => observer.observe(card));
  } catch (err) {
    if (err.name !== 'AbortError') {
      stage.innerHTML = `<div class="vid-card" style="display:grid;place-items:center;padding:24px"><div class="empty-box">${app.esc(err.message)}</div></div>`;
    }
  }

  return {
    cleanup() {
      if (observer) observer.disconnect();
      if (activeCard) stopCard(activeCard);
    },
  };
}
