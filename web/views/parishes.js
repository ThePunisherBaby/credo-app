// views/parishes.js — Pantalla 4: Mi Parroquia, Directorio Verificado, Jerarquía Mundial
// Also handles #/unit/:id (Ecclesiastical Unit Detail) and #/user/:id (Verified Account Profile).
// Strictly lazy-loads hierarchy ONE level at a time via GET /api/v1/units?parent_id=...

export async function mount({ root, app, signal, route, params }) {
  if (route === 'unit' && params?.id) {
    return mountUnitDetail({ root, app, signal, unitId: Number(params.id) });
  }
  if (route === 'user' && params?.id) {
    return mountUserProfile({ root, app, signal, userId: Number(params.id) });
  }

  const d = app.dict();
  let activeTab = 'directory';
  let dirFilter = 'all';
  let searchQ = '';
  let searchTimer = 0;
  let hierarchyStack = []; // [{ id, name }]
  let myParish = null;

  root.innerHTML = `
    <header class="page-head">
      <div>
        <p class="t-footnote">${app.esc(d.parishes.subtitle)}</p>
        <h1 class="t-large-title">${app.esc(d.parishes.title)}</h1>
      </div>
    </header>

    <section id="myParishHost">
      <div class="parish-hero"><div class="skeleton" style="height:260px;border-radius:0"></div></div>
    </section>

    <div class="segmented" id="parishSegTabs" role="tablist">
      <button type="button" class="seg-btn is-active" data-ptab="directory">${app.esc(d.parishes.tabs.directory)}</button>
      <button type="button" class="seg-btn" data-ptab="hierarchy">${app.esc(d.parishes.tabs.hierarchy)}</button>
    </div>

    <section id="parishTabBody" style="margin-top:14px"></section>
  `;

  const myParishHost = root.querySelector('#myParishHost');
  const tabBody = root.querySelector('#parishTabBody');

  function renderMyParish() {
    if (!myParish) return;
    const masses = Array.isArray(myParish.mass_schedule) ? myParish.mass_schedule : [];
    const confs = Array.isArray(myParish.confession_schedule) ? myParish.confession_schedule : [];
    const notices = Array.isArray(myParish.notices) ? myParish.notices : [];
    const lineage = myParish.lineage || [];

    myParishHost.innerHTML = `
      <article class="parish-hero">
        <div class="parish-cover" style="background:linear-gradient(145deg, ${app.esc(myParish.accent_color || '#0A84FF')}, #0B0D12)">
          ${myParish.image_url ? `<img src="${app.esc(myParish.image_url)}" alt="${app.esc(myParish.name)}" fetchpriority="high" />` : ''}
          <div class="parish-cover-scrim" aria-hidden="true"></div>
          <div class="parish-cover-meta">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
              <span class="rank-tag" style="background:rgba(10,132,255,0.28);color:#A8D3FF">✦ ${app.esc(d.parishes.myParishLabel)}</span>
              <button type="button" class="btn btn-sm" style="background:rgba(255,255,255,0.16);color:#fff" id="changeMyParishBtn">${app.esc(d.parishes.changeParish)}</button>
            </div>
            <h2 class="t-title-2" style="color:#fff;margin-top:6px">${app.esc(myParish.name)}</h2>
            <p style="margin:2px 0 0;font-size:0.82rem;color:rgba(255,255,255,0.8)">${app.esc(myParish.city || '')}${myParish.country_name ? `, ${app.esc(myParish.country_name)}` : ''}</p>
          </div>
        </div>

        <div class="parish-body">
          ${lineage.length > 0 ? `
            <div class="lineage-trail">
              ${lineage.map((u) => `<a href="#/unit/${u.id}" class="lineage-pill">${app.esc(u.name)}</a>`).join('<span class="t-caption">›</span>')}
            </div>` : ''}

          ${masses.length > 0 ? `
          <div class="schedule-group">
            <strong class="t-footnote" style="text-transform:uppercase;letter-spacing:0.06em;color:var(--gold-text)">⛪ ${app.esc(d.parishes.massTimes)}</strong>
            ${masses
              .map(
                (m) => `
              <div class="schedule-row">
                <strong>${app.esc(m.day)}</strong>
                <div class="time-chips">${(m.times || []).map((t) => `<span class="time-chip">${app.esc(t)}</span>`).join('')}</div>
              </div>`
              )
              .join('')}
          </div>` : ''}

          ${confs.length > 0 ? `
            <div class="schedule-group">
              <strong class="t-footnote" style="text-transform:uppercase;letter-spacing:0.06em;color:var(--label-2)">🕊️ ${app.esc(d.parishes.confessions)}</strong>
              ${confs
                .map(
                  (c) => `
                <div class="schedule-row">
                  <span>${app.esc(c.day)}</span>
                  <div class="time-chips">${(c.times || []).map((t) => `<span class="time-chip">${app.esc(t)}</span>`).join('')}</div>
                </div>`
                )
                .join('')}
            </div>` : ''}

          ${notices.length > 0 ? `
            <div style="display:flex;flex-direction:column;gap:8px">
              <strong class="t-footnote" style="text-transform:uppercase;letter-spacing:0.06em;color:var(--label-2)">📌 ${app.esc(d.parishes.notices)}</strong>
              ${notices
                .map(
                  (n) => `
                <div style="padding:10px 12px;border-radius:8px;background:var(--surface-2)">
                  <div style="display:flex;justify-content:space-between;gap:8px;font-size:0.84rem">
                    <strong>${app.esc(n.title)}</strong>
                    <span class="t-caption">${app.esc(n.date || '')}</span>
                  </div>
                  <p class="t-footnote" style="margin-top:3px">${app.esc(n.detail || '')}</p>
                </div>`
                )
                .join('')}
            </div>` : ''}

        </div>
      </article>
    `;

    myParishHost.querySelector('#changeMyParishBtn').onclick = () => openParishPicker(app, (chosen) => {
      app.setLinkedParish(chosen.id);
      loadMyParish(chosen.id);
    });
  }

  async function loadMyParish(unitId) {
    try {
      let targetId = unitId || app.linkedParishId || app.user?.primary_unit_id;
      if (!targetId) {
        const listRes = await app.api('/api/v1/units?unit_type=parish&limit=1', { signal });
        targetId = listRes.units?.[0]?.id;
      }
      if (!targetId) return;
      const detail = await app.api(`/api/v1/units/${targetId}`, { signal });
      if (!signal.aborted && detail.unit) {
        myParish = detail.unit;
        app.setLinkedParish(myParish.id, { silent: true });
        renderMyParish();
      }
    } catch (err) {
      if (err.name !== 'AbortError') myParishHost.innerHTML = '';
    }
  }

  async function renderDirectoryTab() {
    tabBody.innerHTML = `
      <div class="search-field">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input type="search" id="dirSearchInput" value="${app.esc(searchQ)}" placeholder="${app.esc(d.parishes.searchDir)}" />
      </div>
      <div class="chip-row" id="dirFilterChips">
        <button type="button" class="chip${dirFilter === 'all' ? ' is-active' : ''}" data-df="all">${app.esc(d.parishes.dirFilters.all)}</button>
        <button type="button" class="chip${dirFilter === 'bishops' ? ' is-active' : ''}" data-df="bishops">${app.esc(d.parishes.dirFilters.bishops)}</button>
        <button type="button" class="chip${dirFilter === 'priests' ? ' is-active' : ''}" data-df="priests">${app.esc(d.parishes.dirFilters.priests)}</button>
        <button type="button" class="chip${dirFilter === 'parishes' ? ' is-active' : ''}" data-df="parishes">${app.esc(d.parishes.dirFilters.parishes)}</button>
      </div>
      <div class="entity-list" id="dirResults">
        <div class="skeleton" style="height:68px"></div>
        <div class="skeleton" style="height:68px"></div>
      </div>
    `;

    const input = tabBody.querySelector('#dirSearchInput');
    const resultsEl = tabBody.querySelector('#dirResults');

    const fetchDir = async () => {
      resultsEl.innerHTML = `<div class="skeleton" style="height:68px"></div>`;
      try {
        if (dirFilter === 'parishes') {
          const qs = new URLSearchParams({ unit_type: 'parish', limit: '25' });
          if (searchQ) qs.set('q', searchQ);
          const res = await app.api(`/api/v1/units?${qs}`, { signal });
          const units = res.units || [];
          resultsEl.innerHTML =
            units.length === 0
              ? `<div class="empty-box">No se encontraron parroquias.</div>`
              : units
                  .map(
                    (u) => `
                  <a href="#/unit/${u.id}" class="entity-row">
                    <span class="avatar" style="--av-bg:${app.esc(u.accent_color || '#0F1E36')}">⛪</span>
                    <div class="entity-main">
                      <div class="entity-title">${app.esc(u.name)}</div>
                      <div class="entity-sub">${app.esc(u.city || '')}${u.country_name ? `, ${app.esc(u.country_name)}` : ''}</div>
                    </div>
                    <span class="t-caption">›</span>
                  </a>`
                  )
                  .join('');
          return;
        }

        const qs = new URLSearchParams({ limit: '30', clergy_only: 'true' });
        if (searchQ) qs.set('q', searchQ);
        if (dirFilter === 'priests') qs.set('rank', 'priest');
        const res = await app.api(`/api/v1/users?${qs}`, { signal });
        let users = res.users || [];
        if (dirFilter === 'bishops') {
          users = users.filter((u) => ['pope', 'cardinal', 'archbishop', 'bishop'].includes(u.ecclesiastical_rank));
        }
        resultsEl.innerHTML =
          users.length === 0
            ? `<div class="empty-box">No se encontraron cuentas oficiales.</div>`
            : users
                .map((u) => {
                  const rank = d.ranks[u.ecclesiastical_rank] || u.ecclesiastical_rank;
                  const loc = u.lineage?.[u.lineage.length - 1]?.name || '';
                  const avUrl = u.avatar_url && u.avatar_url.includes('aire96fm.com.do')
                    ? `/api/v1/media/proxy?url=${encodeURIComponent(u.avatar_url)}`
                    : u.avatar_url;
                  return `
                    <a href="#/user/${u.id}" class="entity-row">
                      <span class="avatar" style="--av-bg:${app.esc(u.avatar_color || '#0F1E36')}">
                        ${avUrl ? `<img src="${app.esc(avUrl)}" alt="" />` : app.initials(u.full_name)}
                      </span>
                      <div class="entity-main">
                        <div class="entity-title">
                          <span>${app.esc(u.title_prefix ? `${u.title_prefix} ` : '')}${app.esc(u.full_name)}</span>
                          ${u.is_ceo ? '<span class="rank-tag">CEO</span>' : ''}
                        </div>
                        <div class="entity-sub">${app.esc(rank)}${loc ? ` · ${app.esc(loc)}` : ''}</div>
                      </div>
                      <span class="t-caption">›</span>
                    </a>`;
                })
                .join('');
      } catch (err) {
        if (err.name !== 'AbortError') resultsEl.innerHTML = `<div class="empty-box">${app.esc(err.message)}</div>`;
      }
    };

    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchQ = input.value.trim();
        fetchDir();
      }, 250);
    });

    tabBody.querySelector('#dirFilterChips').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-df]');
      if (!btn) return;
      dirFilter = btn.dataset.df;
      tabBody.querySelectorAll('#dirFilterChips .chip').forEach((c) => c.classList.toggle('is-active', c === btn));
      fetchDir();
    });

    fetchDir();
  }

  async function renderHierarchyTab() {
    const currentParent = hierarchyStack[hierarchyStack.length - 1] || null;
    tabBody.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <div class="lineage-trail">
          <button type="button" class="lineage-pill" id="hierRootBtn">🌍 Iglesia Universal</button>
          ${hierarchyStack
            .map(
              (item, idx) =>
                `<span class="t-caption">›</span><button type="button" class="lineage-pill" data-h-idx="${idx}">${app.esc(item.name)}</button>`
            )
            .join('')}
        </div>
        ${currentParent ? `<a href="#/unit/${currentParent.id}" class="btn btn-sm btn-soft">Ver ficha</a>` : ''}
      </div>
      <div class="entity-list" id="hierList">
        <div class="skeleton" style="height:68px"></div>
        <div class="skeleton" style="height:68px"></div>
      </div>
    `;

    tabBody.querySelector('#hierRootBtn').onclick = () => {
      hierarchyStack = [];
      renderHierarchyTab();
    };
    tabBody.querySelectorAll('[data-h-idx]').forEach((b) => {
      b.onclick = () => {
        hierarchyStack = hierarchyStack.slice(0, Number(b.dataset.hIdx) + 1);
        renderHierarchyTab();
      };
    });

    const hierList = tabBody.querySelector('#hierList');
    try {
      const qs = currentParent ? `parent_id=${currentParent.id}&limit=60` : 'root_only=true&limit=60';
      const res = await app.api(`/api/v1/units?${qs}`, { signal });
      const units = res.units || [];
      if (units.length === 0) {
        hierList.innerHTML = `<div class="empty-box">No hay sub-unidades registradas en este nivel.</div>`;
        return;
      }
      hierList.innerHTML = units
        .map((u) => {
          const typeLabel = d.unitTypes[u.unit_type] || u.unit_type;
          return `
            <div class="entity-row" style="justify-content:space-between">
              <button type="button" style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;border:none;background:none;text-align:left;padding:0" data-drill-id="${u.id}" data-drill-name="${app.esc(u.name)}" data-drill-children="${u.children_count}">
                <span class="avatar" style="--av-bg:${app.esc(u.accent_color || '#0F1E36')}">${u.country_code || 'VA'}</span>
                <div class="entity-main">
                  <div class="entity-title">${app.esc(u.name)}</div>
                  <div class="entity-sub">${app.esc(typeLabel)} · ${u.children_count} ${app.esc(d.parishes.subUnits)} · ${u.members_count} ${app.esc(d.parishes.members)}</div>
                </div>
              </button>
              <a href="#/unit/${u.id}" class="btn btn-sm btn-soft" aria-label="Detalle">Ficha</a>
            </div>`;
        })
        .join('');

      hierList.onclick = (e) => {
        const drill = e.target.closest('[data-drill-id]');
        if (!drill) return;
        const cnt = Number(drill.dataset.drillChildren || 0);
        if (cnt > 0) {
          hierarchyStack.push({ id: Number(drill.dataset.drillId), name: drill.dataset.drillName });
          renderHierarchyTab();
        } else {
          location.hash = `#/unit/${drill.dataset.drillId}`;
        }
      };
    } catch (err) {
      if (err.name !== 'AbortError') hierList.innerHTML = `<div class="empty-box">${app.esc(err.message)}</div>`;
    }
  }

  root.querySelector('#parishSegTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ptab]');
    if (!btn) return;
    activeTab = btn.dataset.ptab;
    root.querySelectorAll('#parishSegTabs .seg-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
    if (activeTab === 'directory') renderDirectoryTab();
    else renderHierarchyTab();
  });

  await Promise.allSettled([loadMyParish(), renderDirectoryTab()]);

  return {
    cleanup() {
      clearTimeout(searchTimer);
    },
  };
}

async function mountUnitDetail({ root, app, signal, unitId }) {
  const d = app.dict();
  root.innerHTML = `<div class="card"><div class="skeleton" style="height:240px"></div></div>`;
  try {
    const data = await app.api(`/api/v1/units/${unitId}`, { signal });
    const u = data.unit;
    const masses = Array.isArray(u.mass_schedule) ? u.mass_schedule : [];
    const lineage = u.lineage || [];
    const members = data.members || [];
    const children = data.children || [];

    root.innerHTML = `
      <div style="margin-bottom:12px">
        <a href="#/parishes" class="btn btn-sm btn-soft">← ${app.esc(d.parishes.title)}</a>
      </div>
      <article class="parish-hero">
        <div class="parish-cover" style="background:linear-gradient(145deg, ${app.esc(u.accent_color || '#0F1E36')}, #0B0D12)">
          ${u.image_url ? `<img src="${app.esc(u.image_url)}" alt="${app.esc(u.name)}" fetchpriority="high" />` : ''}
          <div class="parish-cover-scrim"></div>
          <div class="parish-cover-meta">
            <span class="rank-tag" style="background:rgba(10,132,255,0.28);color:#A8D3FF">${app.esc(d.unitTypes[u.unit_type] || u.unit_type)}</span>
            <h1 class="t-title-2" style="color:#fff;margin-top:4px">${app.esc(u.name)}</h1>
            <p style="margin:2px 0 0;font-size:0.84rem;color:rgba(255,255,255,0.8)">${app.esc(u.city || '')}${u.country_name ? `, ${app.esc(u.country_name)}` : ''}</p>
          </div>
        </div>
        <div class="parish-body">
          <div class="lineage-trail">
            ${lineage.map((x) => `<a href="#/unit/${x.id}" class="lineage-pill">${app.esc(x.name)}</a>`).join('<span class="t-caption">›</span>')}
          </div>
          ${u.description ? `<p class="t-subhead">${app.esc(u.description)}</p>` : ''}
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn btn-gold btn-sm" id="unitSetMineBtn">✦ Elegir como Mi Parroquia</button>
            <button type="button" class="btn btn-outline btn-sm" id="unitFollowBtn">${u.is_following ? d.parishes.following : d.parishes.follow}</button>
          </div>
          ${masses.length > 0 ? `
            <div class="schedule-group">
              <strong class="t-footnote" style="text-transform:uppercase;color:var(--gold-text)">⛪ ${app.esc(d.parishes.massTimes)}</strong>
              ${masses.map((m) => `<div class="schedule-row"><strong>${app.esc(m.day)}</strong><div class="time-chips">${(m.times || []).map((t) => `<span class="time-chip">${app.esc(t)}</span>`).join('')}</div></div>`).join('')}
            </div>` : ''}
        </div>
      </article>

      ${members.length > 0 ? `
        <div class="section-bar"><h2 class="t-title-3">Clero y Miembros (${members.length})</h2></div>
        <div class="entity-list">
          ${members.map((m) => `
            <a href="#/user/${m.id}" class="entity-row">
              <span class="avatar" style="--av-bg:${app.esc(m.avatar_color || '#0F1E36')}">
                ${m.avatar_url ? `<img src="${app.esc(m.avatar_url)}" alt="" />` : app.initials(m.full_name)}
              </span>
              <div class="entity-main">
                <div class="entity-title">${app.esc(m.title_prefix ? `${m.title_prefix} ` : '')}${app.esc(m.full_name)} ${m.is_ceo ? '<span class="rank-tag">CEO</span>' : ''}</div>
                <div class="entity-sub">${app.esc(m.current_office_title || d.ranks[m.ecclesiastical_rank] || '')}</div>
              </div>
              <span class="t-caption">›</span>
            </a>`).join('')}
        </div>` : ''}

      ${children.length > 0 ? `
        <div class="section-bar"><h2 class="t-title-3">Jurisdicciones dependientes (${children.length})</h2></div>
        <div class="entity-list">
          ${children.map((c) => `
            <a href="#/unit/${c.id}" class="entity-row">
              <span class="avatar" style="--av-bg:${app.esc(c.accent_color || '#0F1E36')}">${c.country_code || 'VA'}</span>
              <div class="entity-main">
                <div class="entity-title">${app.esc(c.name)}</div>
                <div class="entity-sub">${app.esc(d.unitTypes[c.unit_type] || c.unit_type)} · ${app.esc(c.city || '')}</div>
              </div>
              <span class="t-caption">›</span>
            </a>`).join('')}
        </div>` : ''}
    `;

    root.querySelector('#unitSetMineBtn').onclick = () => {
      app.setLinkedParish(u.id);
      app.toast(`"${u.name}" guardada como Mi Parroquia`);
    };
    root.querySelector('#unitFollowBtn').onclick = async (ev) => {
      if (!app.user) return app.openAuthModal();
      const btn = ev.currentTarget;
      const following = btn.textContent === d.parishes.following;
      await app.api(`/api/v1/units/${u.id}/follow`, { method: following ? 'DELETE' : 'POST' });
      btn.textContent = following ? d.parishes.follow : d.parishes.following;
    };
  } catch (err) {
    if (err.name !== 'AbortError') root.innerHTML = `<div class="empty-box">${app.esc(err.message)}</div>`;
  }
  return { cleanup() {} };
}

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

async function mountUserProfile({ root, app, signal, userId }) {
  const d = app.dict();
  root.innerHTML = `<div class="skeleton" style="height:260px"></div>`;
  try {
    const [profRes, postsRes] = await Promise.all([
      app.api(`/api/v1/users/${userId}`, { signal }),
      app.api(`/api/v1/posts?author_id=${userId}&limit=36`, { signal }),
    ]);
    const u = profRes.user;
    const assignments = profRes.assignments || [];
    const posts = postsRes.posts || [];
    const vids = posts.filter((p) => p.media_kind === 'video' || Boolean(p.youtube_id));
    const links = Array.isArray(u.website_links) ? u.website_links : [];
    const hasAireRadio = u.is_ceo || u.username === 'p_domingo_vasquez';
    const avUrl = proxyProfileMedia(u.avatar_url);
    let activeTab = 'posts';

    const openPublicPostSheet = (p) => {
      app.openModal(
        p.title || `${u.title_prefix ? `${u.title_prefix} ` : ''}${u.full_name}`,
        `
        <div style="display:flex;flex-direction:column;gap:12px">
          ${p.image_url ? `<img src="${app.esc(proxyProfileMedia(p.image_url))}" alt="" style="width:100%;border-radius:12px;max-height:360px;object-fit:cover" />` : ''}
          ${p.youtube_id ? `<div style="aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#000"><iframe src="https://www.youtube.com/embed/${app.esc(p.youtube_id)}?playsinline=1&rel=0" style="width:100%;height:100%;border:0" allowfullscreen></iframe></div>` : ''}
          ${p.scripture_ref ? `<span class="post-scripture-pill">📖 ${app.esc(p.scripture_ref)}</span>` : ''}
          <p style="margin:0;font-size:0.95rem;line-height:1.58;white-space:pre-line">${app.esc(p.content || '')}</p>
          ${p.source_url ? `<a href="${app.esc(p.source_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-soft" style="align-self:flex-start">Leer en ${app.esc(p.channel_name || 'fuente oficial')} ↗</a>` : ''}
        </div>
        `
      );
    };

    const renderPublicBody = () => {
      const container = root.querySelector('#pubProfGrid');
      if (!container) return;
      if (activeTab === 'lineage') {
        container.className = '';
        container.innerHTML = `
          <div class="entity-list" style="margin-top:12px">
            ${assignments.map((a) => `
              <a href="#/unit/${a.unit_id}" class="entity-row">
                <div class="entity-main">
                  <div class="entity-title">${app.esc(a.role_title)}</div>
                  <div class="entity-sub">${app.esc(a.unit_name || '')}${a.start_year ? ` · ${a.start_year}` : ''}${a.is_current ? ' — Presente' : a.end_year ? ` — ${a.end_year}` : ''}</div>
                </div>
                <span class="t-caption">›</span>
              </a>`).join('')}
          </div>`;
        return;
      }
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
        <div class="ig-prof-avatar" style="${u.avatar_color ? `background:${app.esc(u.avatar_color)}` : ''}">
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
        <strong style="font-size:0.98rem">${app.esc(u.title_prefix ? `${u.title_prefix} ` : '')}${app.esc(u.full_name)}</strong>
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
        ${(u.lineage || []).length > 0 ? `
          <div class="lineage-trail" style="margin-top:6px">
            ${u.lineage.map((x) => `<a href="#/unit/${x.id}" class="lineage-pill">${app.esc(x.name)}</a>`).join('<span class="t-caption">›</span>')}
          </div>` : ''}
      </div>

      ${hasAireRadio ? `
        <div class="offering-banner" style="padding:11px 14px;margin-bottom:14px;background:linear-gradient(135deg,rgba(10,25,52,0.95),rgba(10,132,255,0.28));color:#fff;border-color:rgba(10,132,255,0.45)">
          <div style="display:flex;align-items:center;gap:10px;min-width:0">
            <img src="${app.esc(proxyProfileMedia('https://aire96fm.com.do/wp-content/themes/aire96-liquid/assets/img/aire96-logo-256.png'))}" alt="Aire 96 FM" width="40" height="40" style="border-radius:8px;object-fit:cover;flex-shrink:0" />
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
        ${assignments.length > 0 ? `
          <button type="button" class="ig-prof-tab" data-pubtab="lineage" aria-label="Trayectoria Eclesiástica">
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v5M10 4h4"/><path d="M5 21h14"/><path d="M7 21v-8l5-4 5 4v8"/></svg>
          </button>` : ''}
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

function openParishPicker(app, onPick) {
  const dlg = app.openModal(
    'Elegir Mi Parroquia',
    `
    <div class="search-field" style="margin-top:0">
      <input type="search" id="ppSearch" placeholder="Buscar parroquia o ciudad…" />
    </div>
    <div class="entity-list" id="ppList"><div class="skeleton" style="height:56px"></div></div>
    `
  );
  const list = dlg.querySelector('#ppList');
  const input = dlg.querySelector('#ppSearch');
  let timer = 0;

  const load = async (q = '') => {
    const qs = new URLSearchParams({ unit_type: 'parish', limit: '20' });
    if (q) qs.set('q', q);
    const res = await app.api(`/api/v1/units?${qs}`);
    const units = res.units || [];
    list.innerHTML = units
      .map(
        (u) => `
      <button type="button" class="entity-row" data-pick-unit="${u.id}">
        <span class="avatar" style="--av-bg:${app.esc(u.accent_color || '#0F1E36')}">⛪</span>
        <div class="entity-main">
          <div class="entity-title">${app.esc(u.name)}</div>
          <div class="entity-sub">${app.esc(u.city || '')}${u.country_name ? `, ${app.esc(u.country_name)}` : ''}</div>
        </div>
      </button>`
      )
      .join('');
    list.onclick = (e) => {
      const btn = e.target.closest('[data-pick-unit]');
      if (!btn) return;
      const chosen = units.find((x) => x.id === Number(btn.dataset.pickUnit));
      if (chosen) {
        app.closeModal();
        onPick(chosen);
      }
    };
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => load(input.value.trim()), 240);
  });
  load();
}
