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
      <a href="#/messages" class="btn btn-sm btn-soft">💬 Grupos</a>
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
        <div class="parish-cover">
          <img src="${app.esc(myParish.image_url || 'https://images.unsplash.com/photo-1507692049790-de58290a4334?auto=format&fit=crop&w=1080&q=80')}" alt="${app.esc(myParish.name)}" fetchpriority="high" />
          <div class="parish-cover-scrim" aria-hidden="true"></div>
          <div class="parish-cover-meta">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
              <span class="rank-tag" style="background:rgba(212,175,55,0.22);color:#FFE07D">✦ ${app.esc(d.parishes.myParishLabel)}</span>
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
                      <div class="entity-title">${app.esc(u.name)} <span class="verified-check">✓</span></div>
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
            ? `<div class="empty-box">No se encontraron cuentas verificadas.</div>`
            : users
                .map((u) => {
                  const rank = d.ranks[u.ecclesiastical_rank] || u.ecclesiastical_rank;
                  const loc = u.lineage?.[u.lineage.length - 1]?.name || '';
                  return `
                    <a href="#/user/${u.id}" class="entity-row">
                      <span class="avatar" style="--av-bg:${app.esc(u.avatar_color || '#0F1E36')}">${app.initials(u.full_name)}</span>
                      <div class="entity-main">
                        <div class="entity-title">
                          <span>${app.esc(u.title_prefix ? `${u.title_prefix} ` : '')}${app.esc(u.full_name)}</span>
                          <span class="verified-check">✓</span>
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
            <span class="rank-tag" style="background:rgba(212,175,55,0.22);color:#FFE07D">${app.esc(d.unitTypes[u.unit_type] || u.unit_type)}</span>
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
              <span class="avatar" style="--av-bg:${app.esc(m.avatar_color || '#0F1E36')}">${app.initials(m.full_name)}</span>
              <div class="entity-main">
                <div class="entity-title">${app.esc(m.title_prefix ? `${m.title_prefix} ` : '')}${app.esc(m.full_name)} ${m.can_publish ? '<span class="verified-check">✓</span>' : ''}</div>
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

async function mountUserProfile({ root, app, signal, userId }) {
  const d = app.dict();
  root.innerHTML = `<div class="card"><div class="skeleton" style="height:220px"></div></div>`;
  try {
    const [profRes, postsRes] = await Promise.all([
      app.api(`/api/v1/users/${userId}`, { signal }),
      app.api(`/api/v1/posts?author_id=${userId}&limit=12`, { signal }),
    ]);
    const u = profRes.user;
    const assignments = profRes.assignments || [];
    const posts = postsRes.posts || [];
    const links = Array.isArray(u.website_links) ? u.website_links : [];
    const hasAireRadio = u.is_ceo || u.username === 'p_domingo_vasquez';

    root.innerHTML = `
      <div style="margin-bottom:12px"><a href="#/parishes" class="btn btn-sm btn-soft">← ${app.esc(d.parishes.title)}</a></div>
      <article class="card" style="display:flex;flex-direction:column;gap:14px;margin-bottom:18px">
        <div style="display:flex;align-items:center;gap:14px">
          <span class="avatar" style="--av-sz:68px;--av-bg:${app.esc(u.avatar_color || '#0F1E36')}">
            ${u.avatar_url ? `<img src="${app.esc(u.avatar_url)}" alt="${app.esc(u.full_name)}" />` : app.initials(u.full_name)}
          </span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <h1 class="t-title-2">${app.esc(u.title_prefix ? `${u.title_prefix} ` : '')}${app.esc(u.full_name)}</h1>
              ${u.can_publish ? '<span class="verified-check">✓</span>' : ''}
              ${u.is_ceo ? '<span class="rank-tag" style="background:linear-gradient(135deg,#D9B75A,#B98E34);color:#0B1220;font-weight:800">CEO · Credo</span>' : ''}
            </div>
            <span class="rank-tag" style="margin-top:4px;display:inline-block">${app.esc(d.ranks[u.ecclesiastical_rank] || u.ecclesiastical_rank)}</span>
            ${u.current_office_title ? `<p class="t-footnote" style="margin-top:4px">${app.esc(u.current_office_title)}</p>` : ''}
          </div>
        </div>
        ${u.bio ? `<p style="margin:0;font-size:0.93rem;line-height:1.5">${app.esc(u.bio)}</p>` : ''}
        ${u.motto ? `<p class="t-serif" style="margin:0;font-style:italic;color:var(--gold-text)">«${app.esc(u.motto)}»</p>` : ''}

        ${links.length > 0 ? `
          <div style="display:flex;flex-direction:column;gap:8px">
            <strong class="t-footnote" style="text-transform:uppercase;letter-spacing:0.06em;color:var(--gold-text)">🌐 Medios Oficiales Propios</strong>
            <div style="display:grid;gap:8px">
              ${links.map((lk) => `
                <a href="${app.esc(lk.url)}" target="_blank" rel="noopener noreferrer" class="entity-row" style="padding:10px 12px">
                  <span class="avatar" style="--av-sz:38px;--av-bg:#0F1E36">🔗</span>
                  <div class="entity-main">
                    <div class="entity-title">${app.esc(lk.label)} <span class="verified-check">✓</span></div>
                    <div class="entity-sub">${app.esc(lk.role || lk.url)} · ${app.esc(lk.url.replace(/^https?:\/\//, ''))}</div>
                  </div>
                  <span class="t-caption">↗</span>
                </a>`).join('')}
            </div>
          </div>` : ''}

        ${hasAireRadio ? `
          <div class="offering-banner" style="background:linear-gradient(135deg,rgba(15,30,54,0.92),rgba(42,30,12,0.92));color:#fff;border-color:rgba(212,175,55,0.45)">
            <div style="display:flex;align-items:center;gap:12px">
              <img src="https://aire96fm.com.do/wp-content/themes/aire96-liquid/assets/img/aire96-logo-256.png" alt="Aire 96 FM" width="46" height="46" style="border-radius:8px;object-fit:cover" />
              <div>
                <div style="display:flex;align-items:center;gap:6px;font-size:0.72rem;font-weight:800;color:#FF6961">
                  <span class="live-dot"></span> RADIO EN VIVO · 96.5 FM
                </div>
                <strong style="display:block;font-size:0.96rem">Aire 96 FM · Señal Oficial</strong>
                <span style="font-size:0.76rem;color:rgba(255,255,255,0.75)">aire96fm.com.do</span>
              </div>
            </div>
            <button type="button" class="btn btn-gold btn-sm" id="ceoPlayAireBtn">▶ Escuchar en Vivo</button>
          </div>` : ''}

        ${(u.lineage || []).length > 0 ? `
          <div class="lineage-trail">
            ${u.lineage.map((x) => `<a href="#/unit/${x.id}" class="lineage-pill">${app.esc(x.name)}</a>`).join('<span class="t-caption">›</span>')}
          </div>` : ''}
        <div style="display:flex;gap:16px;font-size:0.86rem;color:var(--label-2)">
          <span><strong style="color:var(--label)">${u.posts_count || 0}</strong> publicaciones</span>
          <span><strong style="color:var(--label)">${u.followers_count || 0}</strong> seguidores</span>
        </div>
        <div style="display:flex;gap:8px">
          <button type="button" class="btn btn-gold btn-sm" id="uFollowBtn">${u.is_following ? d.parishes.following : d.parishes.follow}</button>
          <button type="button" class="btn btn-soft btn-sm" id="uMsgBtn">💬 ${app.esc(d.parishes.message)}</button>
        </div>
      </article>

      ${assignments.length > 0 ? `
        <div class="section-bar"><h2 class="t-title-3">Trayectoria Eclesiástica</h2></div>
        <div class="entity-list" style="margin-bottom:18px">
          ${assignments.map((a) => `
            <a href="#/unit/${a.unit_id}" class="entity-row">
              <div class="entity-main">
                <div class="entity-title">${app.esc(a.role_title)}</div>
                <div class="entity-sub">${app.esc(a.unit_name || '')} · ${a.start_year || ''}${a.is_current ? ' — Presente' : a.end_year ? ` — ${a.end_year}` : ''}</div>
              </div>
            </a>`).join('')}
        </div>` : ''}

      <div class="section-bar"><h2 class="t-title-3">Publicaciones Oficiales (${posts.length})</h2></div>
      <div class="feed-list">
        ${posts.length === 0 ? `<div class="empty-box" style="margin:0 20px">Sin publicaciones todavía.</div>` : posts.map((p) => `
          <article class="ig-post">
            ${p.image_url ? `<div class="ig-media"><img src="${app.esc(p.image_url)}" alt="" loading="lazy" /></div>` : ''}
            <div class="ig-caption" style="padding-top:10px">
              ${p.title ? `<h3 class="post-title">${app.esc(p.title)}</h3>` : ''}
              <p class="post-excerpt">${app.esc(p.content)}</p>
            </div>
          </article>`).join('')}
      </div>
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

    root.querySelector('#uFollowBtn').onclick = async (ev) => {
      if (!app.user) return app.openAuthModal();
      const btn = ev.currentTarget;
      const isF = btn.textContent === d.parishes.following;
      await app.api(`/api/v1/users/${u.id}/follow`, { method: isF ? 'DELETE' : 'POST' });
      btn.textContent = isF ? d.parishes.follow : d.parishes.following;
    };
    root.querySelector('#uMsgBtn').onclick = async () => {
      if (!app.user) return app.openAuthModal();
      try {
        const res = await app.api('/api/v1/conversations/direct', { method: 'POST', body: { target_user_id: u.id } });
        location.hash = `#/messages/${res.conversation.id}`;
      } catch (err) {
        app.toast(err.message);
      }
    };
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
