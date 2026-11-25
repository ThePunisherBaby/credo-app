// views/parishes.js — Public Profile Screen (#/user/:id) without church hierarchy bloat

function proxyProfileMedia(url) {
  if (!url) return '';
  if (/^https?:\/\/(aire96fm\.com\.do|reflexionandolapalabra\.com)/i.test(url)) {
    return `/api/v1/media/proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

function renderPublicTile(p, app, idx = 0) {
  const lazyAttr = idx < 6 ? '' : ' loading="lazy"';
  if (p.image_url) {
    return `<img src="${app.esc(proxyProfileMedia(p.image_url))}" alt="${app.esc(p.title || '')}"${lazyAttr} />`;
  }
  if (p.youtube_id) {
    return `
      <img src="https://i.ytimg.com/vi/${app.esc(p.youtube_id)}/hqdefault.jpg" alt="${app.esc(p.title || '')}"${lazyAttr} />
      <span style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.62);color:#fff;width:22px;height:22px;border-radius:6px;display:grid;place-items:center">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      </span>`;
  }
  return `<div class="ig-tile-text">${app.esc(p.title || p.content || '')}</div>`;
}

export async function mount({ root, app, signal, route, params }) {
  if (route === 'user' && params?.id) {
    return mountUserProfile({ root, app, signal, userId: Number(params.id) });
  }
  app.navigate('#/explore');
  return { cleanup() {} };
}

async function mountUserProfile({ root, app, signal, userId }) {
  const d = app.dict();
  root.innerHTML = `<div class="skeleton" style="height:260px"></div>`;
  try {
    const [profRes, postsRes] = await Promise.all([
      app.api(`/api/v1/users/${userId}`, { signal }),
      app.api(`/api/v1/posts?author_id=${userId}&limit=36`, { signal }),
    ]);
    const u = profRes.user;
    const posts = postsRes.posts || [];
    const vids = posts.filter((p) => p.media_kind === 'video' || Boolean(p.youtube_id));
    const links = Array.isArray(u.website_links) ? u.website_links : [];
    const hasAireRadio = u.is_ceo || u.username === 'p_domingo_vasquez';
    const avUrl = proxyProfileMedia(u.avatar_url);
    const fullNameDisplay = `${u.title_prefix ? `${u.title_prefix} ` : ''}${u.full_name}`;
    let activeTab = 'posts';

    const openPublicPostSheet = (p) => {
      const dlg = app.openModal(
        p.title || fullNameDisplay,
        `
        <div style="display:flex;flex-direction:column;gap:12px">
          ${p.image_url ? `<img src="${app.esc(proxyProfileMedia(p.image_url))}" alt="" style="width:100%;aspect-ratio:1/1;object-fit:cover" />` : ''}
          ${p.youtube_id ? `<div style="aspect-ratio:16/9;overflow:hidden;background:#000"><iframe src="https://www.youtube.com/embed/${app.esc(p.youtube_id)}?playsinline=1&rel=0" style="width:100%;height:100%;border:0" allowfullscreen></iframe></div>` : ''}
          ${p.scripture_ref ? `<span class="post-scripture-pill">📖 ${app.esc(p.scripture_ref)}</span>` : ''}
          <p style="margin:0;font-size:0.94rem;line-height:1.56;white-space:pre-line">${app.esc(p.content || '')}</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn btn-gold btn-sm" id="pubOpenCommentsBtn">💬 Comentarios (${p.comments_count || 0})</button>
            ${p.source_url ? `<a href="${app.esc(p.source_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-soft">Leer en ${app.esc(p.channel_name || 'fuente oficial')} ↗</a>` : ''}
          </div>
        </div>
        `
      );
      dlg.querySelector('#pubOpenCommentsBtn')?.addEventListener('click', () => app.openCommentsModal({ ...p, author: p.author || u }));
    };

    const renderPublicBody = () => {
      const container = root.querySelector('#pubProfGrid');
      if (!container) return;
      const list = activeTab === 'vids' ? vids : posts;
      if (list.length === 0) {
        container.className = '';
        container.innerHTML = `<div class="empty-box" style="margin-top:12px">${activeTab === 'vids' ? 'Sin videos publicados todavía.' : 'Sin publicaciones todavía.'}</div>`;
        return;
      }
      container.className = 'ig-prof-grid';
      container.innerHTML = list.map((p, idx) => `
        <button type="button" class="ig-prof-tile" data-pub-tile="${idx}" aria-label="${app.esc(p.title || 'Publicación')}">
          ${renderPublicTile(p, app, idx)}
        </button>
      `).join('');
      container.querySelectorAll('[data-pub-tile]').forEach((btn) => {
        btn.addEventListener('click', () => openPublicPostSheet(list[Number(btn.dataset.pubTile)]));
      });
    };

    root.innerHTML = `
      <header class="ig-prof-top">
        <div class="ig-prof-username">
          <a href="#/explore" class="ig-icon-btn" style="width:34px;height:34px;flex-shrink:0" aria-label="Volver">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </a>
          <span>@${app.esc(u.username || 'credo')}</span>
          ${u.is_ceo ? '<span class="rank-tag" style="background:#0A84FF;color:#FFFFFF;font-size:0.66rem;flex-shrink:0">CEO</span>' : ''}
        </div>
        <div class="ig-prof-actions">
          <button type="button" class="ig-icon-btn" id="pubShareTopBtn" aria-label="Compartir perfil">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
          </button>
        </div>
      </header>

      <section class="ig-prof-head">
        <div
          class="ig-prof-avatar"
          data-zoomable
          data-zoom-name="${app.esc(fullNameDisplay)}"
          data-zoom-src="${app.esc(avUrl)}"
          data-zoom-bg="${app.esc(u.avatar_color || '#0F1E36')}"
          style="${u.avatar_color ? `background:${app.esc(u.avatar_color)}` : ''}"
          title="Mantén presionado para ampliar"
        >
          ${avUrl ? `<img src="${app.esc(avUrl)}" alt="${app.esc(u.full_name)}" />` : app.initials(u.full_name)}
        </div>
        <div class="ig-prof-stats">
          <div>
            <span class="ig-stat-val">${u.posts_count ?? posts.length}</span>
            <span class="ig-stat-lbl">Publicaciones</span>
          </div>
          <div>
            <span class="ig-stat-val" id="pubFollowersVal">${u.followers_count ?? 0}</span>
            <span class="ig-stat-lbl">Seguidores</span>
          </div>
          <div>
            <span class="ig-stat-val">${u.following_count ?? 0}</span>
            <span class="ig-stat-lbl">Siguiendo</span>
          </div>
        </div>
      </section>

      <div class="ig-prof-bio">
        <strong style="font-size:0.98rem">${app.esc(fullNameDisplay)}</strong>
        <span class="t-footnote">${app.esc(u.current_office_title || d.ranks[u.ecclesiastical_rank] || u.ecclesiastical_rank)}</span>
        ${u.bio ? `<p style="margin:4px 0 0;font-size:0.88rem;line-height:1.45">${app.esc(u.bio)}</p>` : ''}
        ${u.motto ? `<p style="margin:2px 0 0;font-size:0.84rem;font-style:italic;color:var(--gold-text)">«${app.esc(u.motto)}»</p>` : ''}
        ${links.length > 0 ? `
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
            ${links.map((lk) => `
              <a href="${app.esc(lk.url)}" target="_blank" rel="noopener noreferrer" class="source-pill-box">
                <span>🔗 ${app.esc(lk.label)}</span>
                <span class="source-pill-arrow" aria-hidden="true">↗</span>
              </a>`).join('')}
          </div>` : ''}
      </div>

      ${hasAireRadio ? `
        <div class="offering-banner" style="padding:11px 14px;margin-bottom:14px;background:linear-gradient(135deg,rgba(10,25,52,0.95),rgba(10,132,255,0.28));color:#fff;border-color:rgba(10,132,255,0.45)">
          <div style="display:flex;align-items:center;gap:10px;min-width:0">
            <img src="${app.esc(proxyProfileMedia('https://aire96fm.com.do/wp-content/themes/aire96-liquid/assets/img/aire96-logo-256.png'))}" alt="Aire 96 FM" width="40" height="40" style="border-radius:50%;object-fit:cover;flex-shrink:0" />
            <div style="min-width:0">
              <div style="display:flex;align-items:center;gap:5px;font-size:0.68rem;font-weight:800;color:#FF6961">
                <span class="live-dot" style="width:6px;height:6px"></span> RADIO EN VIVO · 96.5 FM
              </div>
              <strong style="display:block;font-size:0.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Aire 96 FM · Señal Oficial</strong>
            </div>
          </div>
          <button type="button" class="btn btn-gold btn-sm" id="ceoPlayAireBtn">▶ Escuchar</button>
        </div>` : ''}

      <div class="ig-prof-cta">
        <button type="button" class="btn ${u.is_following ? 'btn-soft' : 'btn-gold'} btn-sm" id="uFollowBtn">${u.is_following ? d.parishes.following : d.parishes.follow}</button>
        <button type="button" class="btn btn-soft btn-sm" id="pubShareBtn">Compartir perfil</button>
      </div>

      <div class="ig-prof-tabs" role="tablist">
        <button type="button" class="ig-prof-tab is-active" data-pubtab="posts" aria-label="Publicaciones">
          <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        </button>
        <button type="button" class="ig-prof-tab" data-pubtab="vids" aria-label="Vids">
          <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="m10 8.5 6 3.5-6 3.5z" fill="currentColor" stroke="none"/></svg>
        </button>
      </div>

      <div id="pubProfGrid"></div>
    `;

    root.querySelector('#ceoPlayAireBtn')?.addEventListener('click', async () => {
      try {
        const liveRes = await app.api('/api/v1/live');
        app.setLiveQueue(liveRes.all || []);
        const aire = (liveRes.all || []).find((c) => c.slug === 'aire-96') || liveRes.hero;
        if (aire) app.playLive(aire, { expandPlayer: true });
      } catch (err) {
        app.toast(err.message);
      }
    });

    const shareProfile = async () => {
      const shareUrl = `${location.origin}/#/user/${u.id}`;
      try {
        if (navigator.share) await navigator.share({ title: u.full_name, url: shareUrl });
        else {
          await navigator.clipboard?.writeText(shareUrl);
          app.toast('Enlace de perfil copiado');
        }
      } catch {}
    };
    root.querySelector('#pubShareBtn')?.addEventListener('click', shareProfile);
    root.querySelector('#pubShareTopBtn')?.addEventListener('click', shareProfile);

    let followingState = Boolean(u.is_following);
    root.querySelector('#uFollowBtn').onclick = async (ev) => {
      if (!app.user) return app.openAuthModal();
      const btn = ev.currentTarget;
      const fValEl = root.querySelector('#pubFollowersVal');
      const prevCount = Number(fValEl?.textContent || 0);
      const nextFollow = !followingState;
      followingState = nextFollow;
      btn.textContent = nextFollow ? d.parishes.following : d.parishes.follow;
      btn.classList.toggle('btn-gold', !nextFollow);
      btn.classList.toggle('btn-soft', nextFollow);
      if (fValEl) fValEl.textContent = String(Math.max(0, prevCount + (nextFollow ? 1 : -1)));
      try {
        await app.api(`/api/v1/users/${u.id}/follow`, { method: nextFollow ? 'POST' : 'DELETE' });
      } catch (err) {
        followingState = !nextFollow;
        btn.textContent = followingState ? d.parishes.following : d.parishes.follow;
        btn.classList.toggle('btn-gold', !followingState);
        btn.classList.toggle('btn-soft', followingState);
        if (fValEl) fValEl.textContent = String(prevCount);
        app.toast(err.message);
      }
    };

    root.querySelectorAll('[data-pubtab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        activeTab = tab.dataset.pubtab;
        root.querySelectorAll('[data-pubtab]').forEach((t) => t.classList.toggle('is-active', t === tab));
        renderPublicBody();
      });
    });

    renderPublicBody();
  } catch (err) {
    if (err.name !== 'AbortError') root.innerHTML = `<div class="empty-box">${app.esc(err.message)}</div>`;
  }
  return { cleanup() {} };
}
