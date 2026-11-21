// views/feed.js — Pantalla 1: Inicio (Feed Curado Oficial)
// Loaded on demand ONLY when on #/feed. Cleans up IntersectionObserver and aborts fetches on leave.

import { audioEngine } from '../audio-engine.js';

export async function mount({ root, app, signal }) {
  const d = app.dict();
  const state = {
    scope: 'global',
    mediaKind: '',
    q: '',
    offset: 0,
    limit: 6,
    hasMore: true,
    loading: false,
    posts: [],
    stories: [],
    liveStations: [],
    liturgy: null,
    searchOpen: false,
  };

  let observer = null;
  let searchTimer = 0;
  let audioUnsub = null;

  const greetingKey = () => {
    const h = new Date().getHours();
    if (h < 12) return 'morning';
    if (h < 19) return 'afternoon';
    return 'evening';
  };

  root.innerHTML = `
    <header class="page-head">
      <div>
        <p class="t-footnote">${app.esc(d.greetings[greetingKey()])}${app.user ? `, ${app.esc(app.user.full_name.split(' ')[0])}` : ''}</p>
        <h1 class="t-large-title">${app.esc(d.appName)}</h1>
      </div>
      <div class="page-head-actions">
        <button type="button" class="icon-btn-44" id="feedSearchToggle" aria-label="Buscar">
          <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        </button>
        <button type="button" class="icon-btn-44" id="feedPublishBtn" aria-label="${app.esc(d.feed.publishBtn)}">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8v8M8 12h8"/></svg>
        </button>
      </div>
    </header>

    <div id="feedSearchWrap" hidden>
      <div class="search-field">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input type="search" id="feedSearchInput" placeholder="${app.esc(d.feed.searchPlaceholder)}" />
      </div>
    </div>

    <section aria-label="${app.esc(d.feed.storiesTitle)}">
      <div class="stories-strip" id="storiesStrip">
        <div class="skeleton" style="width:66px;height:66px;border-radius:50%;flex-shrink:0"></div>
        <div class="skeleton" style="width:66px;height:66px;border-radius:50%;flex-shrink:0"></div>
        <div class="skeleton" style="width:66px;height:66px;border-radius:50%;flex-shrink:0"></div>
        <div class="skeleton" style="width:66px;height:66px;border-radius:50%;flex-shrink:0"></div>
      </div>
    </section>

    <section id="gospelMiniHost"></section>

    <div class="chip-row" id="feedScopeChips" role="tablist" aria-label="Filtros del feed">
      <button type="button" class="chip is-active" data-filter="global">${app.esc(d.feed.scopes.global)}</button>
      <button type="button" class="chip" data-filter="video">${app.esc(d.feed.scopes.video)}</button>
      <button type="button" class="chip" data-filter="article">${app.esc(d.feed.scopes.article)}</button>
      <button type="button" class="chip" data-filter="following">${app.esc(d.feed.scopes.following)}</button>
      <button type="button" class="chip" data-filter="my_diocese">${app.esc(d.feed.scopes.my_diocese)}</button>
    </div>

    <div class="feed-list" id="feedList" aria-live="polite">
      <div class="card"><div class="skeleton" style="height:220px"></div></div>
      <div class="card"><div class="skeleton" style="height:220px"></div></div>
    </div>
    <div id="feedSentinel" style="height:48px;display:grid;place-items:center;color:var(--label-3);font-size:0.82rem;margin-top:12px;"></div>
  `;

  const storiesStrip = root.querySelector('#storiesStrip');
  const gospelHost = root.querySelector('#gospelMiniHost');
  const feedList = root.querySelector('#feedList');
  const sentinel = root.querySelector('#feedSentinel');
  const searchWrap = root.querySelector('#feedSearchWrap');
  const searchInput = root.querySelector('#feedSearchInput');

  root.querySelector('#feedSearchToggle').addEventListener('click', () => {
    state.searchOpen = !state.searchOpen;
    searchWrap.hidden = !state.searchOpen;
    if (state.searchOpen) searchInput.focus();
  });

  root.querySelector('#feedPublishBtn').addEventListener('click', () => {
    app.openComposer();
  });

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = searchInput.value.trim();
      reloadFeed();
    }, 280);
  });

  root.querySelector('#feedScopeChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    const f = btn.dataset.filter;
    if ((f === 'following' || f === 'my_diocese') && !app.user) {
      app.openAuthModal();
      return;
    }
    root.querySelectorAll('#feedScopeChips .chip').forEach((c) => c.classList.toggle('is-active', c === btn));
    if (f === 'video' || f === 'article') {
      state.scope = 'global';
      state.mediaKind = f;
    } else {
      state.scope = f;
      state.mediaKind = '';
    }
    reloadFeed();
  });

  function renderStories() {
    const parts = [];
    // Live stations first in the highlights carousel (clean circular art + breathing live halo)
    state.liveStations.slice(0, 4).forEach((ch, idx) => {
      const imgUrl = ch.cover_url ? `/api/v1/media/proxy?url=${encodeURIComponent(ch.cover_url)}` : '';
      parts.push(`
        <button type="button" class="story-item stagger-in" style="--stagger-i:${idx}" data-live-slug="${app.esc(ch.slug)}">
          <span class="story-ring is-live">
            <span class="story-ring-inner">
              <img src="${app.esc(imgUrl || ch.cover_url)}" alt="${app.esc(ch.name)}" width="62" height="62" />
            </span>
          </span>
          <span class="story-name">
            <span class="live-dot" aria-hidden="true"></span>
            <span>${app.esc(ch.name.split(' ')[0])}</span>
          </span>
        </button>
      `);
    });

    // Official Clergy Stories (if any)
    state.stories.forEach((st, idx) => {
      const name = st.author?.full_name || 'Clero';
      parts.push(`
        <button type="button" class="story-item stagger-in" style="--stagger-i:${Math.min(idx + 2, 5)}" data-story-idx="${idx}">
          <span class="story-ring">
            <span class="story-ring-inner" style="background:${app.esc(st.author?.avatar_color || '#0F1E36')}">
              ${st.image_url
                ? `<img src="${app.esc(st.image_url)}" alt="${app.esc(name)}" loading="lazy" width="62" height="62" />`
                : `<span style="color:#fff;font-weight:800">${app.initials(name)}</span>`}
            </span>
          </span>
          <span class="story-name"><span>${app.esc(name.split(' ')[0])}</span></span>
        </button>
      `);
    });

    storiesStrip.innerHTML = parts.join('');
    storiesStrip.onclick = (e) => {
      const liveBtn = e.target.closest('[data-live-slug]');
      if (liveBtn) {
        const ch = state.liveStations.find((c) => c.slug === liveBtn.dataset.liveSlug);
        if (ch) app.playLiveWithPreRoll(ch);
        return;
      }
      const stBtn = e.target.closest('[data-story-idx]');
      if (stBtn) {
        app.openStoryViewer(state.stories, Number(stBtn.dataset.storyIdx));
      }
    };
  }

  function renderGospelMini() {
    if (!state.liturgy) return;
    const speaking = audioEngine.getState().gospelSpeaking;
    gospelHost.innerHTML = `
      <article class="gospel-mini-card stagger-in" style="--stagger-i:1">
        <div class="gospel-mini-eyebrow">
          <span>✦</span>
          <span>${app.esc(d.feed.gospelCardLabel)}</span>
        </div>
        <p class="gospel-mini-quote">${app.esc(state.liturgy.gospel_excerpt)}</p>
        <div class="gospel-mini-foot">
          <span class="gospel-mini-ref">${app.esc(state.liturgy.gospel_ref)}</span>
          <div class="gospel-mini-btns">
            <button type="button" class="btn btn-sm" id="miniGospelAudioBtn">
              ${speaking ? app.esc(d.feed.stopAudio) : app.esc(d.feed.listenGospel)}
            </button>
            <a href="#/prayer" class="btn btn-sm is-primary">${app.esc(d.feed.readGospel)}</a>
          </div>
        </div>
      </article>
    `;
    gospelHost.querySelector('#miniGospelAudioBtn').onclick = () => {
      audioEngine.toggleGospelSpeech(
        `${state.liturgy.gospel_ref}. ${state.liturgy.gospel_title}. ${state.liturgy.gospel_text}`,
        app.locale
      );
    };
  }

  function renderSponsorCard() {
    return '';
  }

  function postCardHTML(p, globalIndex) {
    const author = p.author || {};
    const unitName = p.channel_name || p.scope_unit?.name || author.lineage?.[author.lineage.length - 1]?.name || '';
    const isVideo = p.media_kind === 'video' && p.youtube_id;
    const isAmen = (p.my_reactions || []).includes('amen');
    const isSaved = Boolean(p.is_saved);
    const deferClass = globalIndex >= 2 ? ' deferred-card' : '';
    const staggerAttr = globalIndex < 5 ? ` style="--stagger-i:${globalIndex + 1}"` : '';
    const staggerClass = globalIndex < 5 ? ' stagger-in' : '';
    // optimize-image-priority: fetchpriority="high" ONLY on index 0 LCP image, NEVER combined with loading="lazy"
    const imgAttrs = globalIndex === 0 ? 'fetchpriority="high"' : 'loading="lazy"';
    const avUrl = author.avatar_url && author.avatar_url.includes('aire96fm.com.do')
      ? `/api/v1/media/proxy?url=${encodeURIComponent(author.avatar_url)}`
      : author.avatar_url;

    let mediaBlock = '';
    if (isVideo) {
      mediaBlock = `
        <div class="post-media" data-video-box="${p.id}" data-yt="${app.esc(p.youtube_id)}">
          <img src="${app.esc(p.image_url)}" alt="${app.esc(p.title || d.feed.officialChannel)}" ${imgAttrs} width="640" height="400" />
          ${p.video_duration ? `<span class="video-duration-pill">${app.esc(p.video_duration)}</span>` : ''}
          <button type="button" class="video-play-overlay" data-play-video="${p.id}" aria-label="${app.esc(d.feed.watchInline)}">
            <span class="video-play-circle">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" style="margin-left:2px"><path d="M8 5v14l11-7z"/></svg>
            </span>
          </button>
        </div>
      `;
    } else if (p.image_url) {
      mediaBlock = `
        <div class="post-media" data-open-post="${p.id}" style="cursor:pointer">
          <img src="${app.esc(p.image_url)}" alt="${app.esc(p.title || author.full_name)}" ${imgAttrs} width="640" height="400" />
        </div>
      `;
    } else {
      mediaBlock = `
        <div class="post-quote-canvas" data-open-post="${p.id}" style="cursor:pointer">
          “${app.esc(p.content.slice(0, 220))}${p.content.length > 220 ? '…' : ''}”
        </div>
      `;
    }

    return `
      <article class="card post-card${deferClass}${staggerClass}"${staggerAttr} data-post-id="${p.id}">
        <header class="post-head">
          <a href="#/user/${author.id}" class="avatar" style="--av-bg:${app.esc(author.avatar_color || '#0F1E36')}" aria-label="${app.esc(author.full_name)}">
            ${avUrl ? `<img src="${app.esc(avUrl)}" alt="" loading="lazy" />` : app.initials(author.full_name)}
          </a>
          <div class="post-author-info">
            <div class="post-author-row">
              <a href="#/user/${author.id}" class="post-author-name">${app.esc(author.title_prefix ? `${author.title_prefix} ` : '')}${app.esc(author.full_name)}</a>
              <span class="verified-check" title="Cuenta oficial verificada" aria-label="Verificado">
                <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-6.5"/></svg>
              </span>
              ${author.is_ceo ? '<span class="rank-tag">CEO</span>' : ''}
            </div>
            <div class="post-meta-line">
              ${unitName ? `<span>${app.esc(unitName)}</span> · ` : ''}
              <span>${app.relTime(p.created_at)}</span>
            </div>
          </div>
        </header>

        ${mediaBlock}

        ${p.title ? `<h2 class="post-title" data-open-post="${p.id}" style="cursor:pointer">${app.esc(p.title)}</h2>` : ''}
        <p class="post-excerpt" data-open-post="${p.id}" style="cursor:pointer">${app.esc(p.content)}</p>
        ${p.scripture_ref ? `<span class="post-scripture-pill">📖 ${app.esc(p.scripture_ref)}</span>` : ''}

        <footer class="post-actions">
          <div class="post-act-group">
            <button type="button" class="act-btn${isAmen ? ' is-active' : ''}" data-react-post="${p.id}" aria-pressed="${isAmen}">
              <span>🙏</span>
              <span>${app.esc(d.feed.amen)}</span>
              <strong data-amen-count="${p.id}">${p.reactions?.amen || 0}</strong>
            </button>
            <button type="button" class="act-btn" data-open-post="${p.id}" aria-label="${app.esc(d.feed.comment)}">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span>${p.comments_count || 0}</span>
            </button>
          </div>
          <div class="post-act-group">
            <button type="button" class="act-btn${isSaved ? ' is-active' : ''}" data-save-post="${p.id}" aria-pressed="${isSaved}" aria-label="${app.esc(d.feed.save)}">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            <button type="button" class="act-btn" data-share-post="${p.id}" aria-label="${app.esc(d.feed.share)}">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
            </button>
          </div>
        </footer>
      </article>
    `;
  }

  async function loadPage(reset = false) {
    if (state.loading || (!state.hasMore && !reset)) return;
    state.loading = true;
    if (reset) {
      state.offset = 0;
      state.hasMore = true;
      state.posts = [];
      feedList.innerHTML = `<div class="card"><div class="skeleton" style="height:220px"></div></div>`;
    }
    sentinel.textContent = d.feed.loadMore;

    try {
      const qs = new URLSearchParams({
        scope: state.scope,
        limit: String(state.limit),
        offset: String(state.offset),
      });
      if (state.mediaKind) qs.set('media_kind', state.mediaKind);
      if (state.q) qs.set('q', state.q);

      const data = await app.api(`/api/v1/posts?${qs}`, { signal });
      const batch = data.posts || [];
      if (reset) feedList.innerHTML = '';

      if (batch.length === 0 && state.posts.length === 0) {
        feedList.innerHTML = `<div class="empty-box">${app.esc(d.feed.emptyFeed)}</div>`;
      } else {
        const startIdx = state.posts.length;
        state.posts.push(...batch);
        let html = '';
        batch.forEach((p, i) => {
          const idx = startIdx + i;
          html += postCardHTML(p, idx);
          // Insert respectful native sponsor card after post #2 for Free users only
          if (idx === 2) html += renderSponsorCard();
        });
        feedList.insertAdjacentHTML('beforeend', html);
      }

      state.offset += batch.length;
      state.hasMore = batch.length >= state.limit;
      sentinel.textContent = state.hasMore ? '' : (state.posts.length > 0 ? d.feed.endOfFeed : '');
    } catch (err) {
      if (err.name !== 'AbortError') {
        sentinel.textContent = '';
        if (state.posts.length === 0) {
          feedList.innerHTML = `<div class="empty-box">${app.esc(err.message)}</div>`;
        }
      }
    } finally {
      state.loading = false;
    }
  }

  function reloadFeed() {
    loadPage(true);
  }

  feedList.addEventListener('click', async (e) => {
    const plusBtn = e.target.closest('[data-open-plus]');
    if (plusBtn) {
      location.hash = '#/profile';
      return;
    }

    const playVid = e.target.closest('[data-play-video]');
    if (playVid) {
      const box = playVid.closest('[data-video-box]');
      const yt = box?.dataset.yt;
      if (!yt) return;
      await app.runPreRollIfNeeded(() => {
        box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}?autoplay=1&rel=0&modestbranding=1" title="Video oficial de Credo" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
      });
      return;
    }

    const reactBtn = e.target.closest('[data-react-post]');
    if (reactBtn) {
      const postId = Number(reactBtn.dataset.reactPost);
      if (!app.user) {
        app.openAuthModal();
        return;
      }
      try {
        const res = await app.api(`/api/v1/posts/${postId}/react`, {
          method: 'POST',
          body: { reaction_type: 'amen' },
        });
        const active = (res.my_reactions || []).includes('amen');
        reactBtn.classList.toggle('is-active', active);
        reactBtn.setAttribute('aria-pressed', String(active));
        if (active) {
          reactBtn.classList.add('is-pop');
          setTimeout(() => reactBtn.classList.remove('is-pop'), 500);
        }
        const cntEl = reactBtn.querySelector(`[data-amen-count="${postId}"]`);
        if (cntEl) cntEl.textContent = String(res.reactions?.amen || 0);
      } catch (err) {
        app.toast(err.message);
      }
      return;
    }

    const saveBtn = e.target.closest('[data-save-post]');
    if (saveBtn) {
      const postId = Number(saveBtn.dataset.savePost);
      if (!app.user) {
        app.openAuthModal();
        return;
      }
      try {
        const res = await app.api(`/api/v1/posts/${postId}/save`, { method: 'POST' });
        const saved = Boolean(res.saved);
        saveBtn.classList.toggle('is-active', saved);
        saveBtn.setAttribute('aria-pressed', String(saved));
        const svg = saveBtn.querySelector('svg');
        if (svg) svg.setAttribute('fill', saved ? 'currentColor' : 'none');
        app.toast(saved ? d.feed.saved : d.feed.save);
      } catch (err) {
        app.toast(err.message);
      }
      return;
    }

    const shareBtn = e.target.closest('[data-share-post]');
    if (shareBtn) {
      const url = `${location.origin}/#/feed`;
      try {
        if (navigator.share) await navigator.share({ title: 'Credo', url });
        else await navigator.clipboard.writeText(url);
        app.toast('Enlace copiado');
      } catch {}
      return;
    }

    const openEl = e.target.closest('[data-open-post]');
    if (openEl) {
      const post = state.posts.find((p) => p.id === Number(openEl.dataset.openPost));
      if (post) openPostDetailModal(post, app, d);
    }
  });

  // Infinite scroll sentinel
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && state.hasMore && !state.loading) {
        loadPage(false);
      }
    },
    { rootMargin: '260px 0px' }
  );
  observer.observe(sentinel);

  audioUnsub = audioEngine.subscribe(() => renderGospelMini());

  // Parallel lightweight initial fetch ONLY for this view
  const [storiesRes, liveRes, liturgyRes] = await Promise.allSettled([
    app.api('/api/v1/stories', { signal }),
    app.api('/api/v1/live', { signal }),
    app.api(`/api/v1/prayers/liturgy?lang=${app.locale}`, { signal }),
    loadPage(true),
  ]);

  if (!signal.aborted) {
    if (storiesRes.status === 'fulfilled') state.stories = storiesRes.value.stories || [];
    if (liveRes.status === 'fulfilled') state.liveStations = liveRes.value.all || [];
    if (liturgyRes.status === 'fulfilled') state.liturgy = liturgyRes.value.liturgy || null;
    renderStories();
    renderGospelMini();
  }

  return {
    cleanup() {
      clearTimeout(searchTimer);
      if (observer) observer.disconnect();
      if (audioUnsub) audioUnsub();
    },
  };
}

async function openPostDetailModal(post, app, d) {
  const author = post.author || {};
  const body = `
    <article style="display:flex;flex-direction:column;gap:14px;">
      <div class="post-head">
        <span class="avatar" style="--av-bg:${app.esc(author.avatar_color || '#0F1E36')}">${app.initials(author.full_name)}</span>
        <div>
          <div class="post-author-row">
            <strong>${app.esc(author.title_prefix ? `${author.title_prefix} ` : '')}${app.esc(author.full_name)}</strong>
            <span class="verified-check">✓</span>
          </div>
          <span class="t-footnote">${app.esc(post.scope_unit?.name || '')} · ${app.relTime(post.created_at)}</span>
        </div>
      </div>
      ${post.image_url ? `<img src="${app.esc(post.image_url)}" alt="" style="width:100%;border-radius:16px;aspect-ratio:16/10;object-fit:cover" />` : ''}
      ${post.title ? `<h3 class="t-serif" style="margin:0;font-size:1.3rem;line-height:1.3">${app.esc(post.title)}</h3>` : ''}
      ${post.scripture_ref ? `<span class="post-scripture-pill">📖 ${app.esc(post.scripture_ref)}</span>` : ''}
      <p style="margin:0;line-height:1.65;white-space:pre-line">${app.esc(post.content)}</p>
      ${post.source_url ? `<a href="${app.esc(post.source_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-soft" style="align-self:flex-start">Leer en ${app.esc(post.channel_name || 'fuente oficial')} ↗</a>` : ''}
      <hr style="border:none;border-top:1px solid var(--sep);width:100%;margin:4px 0" />
      <h4 class="t-headline">Comentarios moderados</h4>
      <div id="modalCommentsList" style="display:flex;flex-direction:column;gap:10px">
        <div class="skeleton" style="height:44px"></div>
      </div>
      <form id="modalCommentForm" style="display:flex;gap:8px;margin-top:4px">
        <input type="text" name="content" placeholder="${app.esc(d.feed.commentPlaceholder)}" style="flex:1;min-height:44px;padding:0 14px;border-radius:999px;border:1px solid var(--sep-strong);background:var(--surface-2)" required />
        <button type="submit" class="btn btn-gold btn-sm">${app.esc(d.feed.send)}</button>
      </form>
    </article>
  `;

  const dlg = app.openModal(d.postTypes[post.post_type] || 'Publicación', body);
  const listEl = dlg.querySelector('#modalCommentsList');
  const form = dlg.querySelector('#modalCommentForm');

  const loadComments = async () => {
    try {
      const res = await app.api(`/api/v1/posts/${post.id}/comments`);
      const items = res.comments || [];
      if (items.length === 0) {
        listEl.innerHTML = `<p class="t-footnote">${app.esc(d.feed.noComments)}</p>`;
      } else {
        listEl.innerHTML = items
          .map(
            (c) => `
          <div style="padding:10px 12px;border-radius:14px;background:var(--surface-2)">
            <div style="display:flex;justify-content:space-between;gap:8px;font-size:0.8rem">
              <strong>${app.esc(c.author?.full_name || 'Fiel')}</strong>
              <span class="t-caption">${app.relTime(c.created_at)}</span>
            </div>
            <p style="margin:4px 0 0;font-size:0.9rem">${app.esc(c.content)}</p>
          </div>`
          )
          .join('');
      }
    } catch {
      listEl.innerHTML = `<p class="t-footnote">${app.esc(d.feed.noComments)}</p>`;
    }
  };

  loadComments();

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!app.user) {
      app.closeModal();
      app.openAuthModal();
      return;
    }
    const content = form.content.value.trim();
    if (!content) return;
    try {
      await app.api(`/api/v1/posts/${post.id}/comments`, {
        method: 'POST',
        body: { content },
      });
      form.content.value = '';
      loadComments();
    } catch (err) {
      app.toast(err.message);
    }
  });
}
