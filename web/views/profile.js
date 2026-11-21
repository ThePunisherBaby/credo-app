// views/profile.js — Pantalla 5: Perfil, Guardados, Accesibilidad (Dark OLED / Claro / Vidrio) y Credo Plus
// Loaded on demand ONLY when on #/profile.

export async function mount({ root, app, signal }) {
  const d = app.dict();
  let subTab = 'plus';
  let plusPlan = 'annual';

  const currentScheme = () => {
    try {
      const v = localStorage.getItem('credo-color-scheme');
      return v === 'dark' || v === 'light' ? v : 'system';
    } catch {
      return 'system';
    }
  };
  const currentGlass = () => {
    try {
      const v = localStorage.getItem('credo-glass-opacity');
      return v !== null ? Number(v) : 0.45;
    } catch {
      return 0.45;
    }
  };
  const currentScale = () => document.documentElement.dataset.fontScale || 'normal';

  function renderShell() {
    const u = app.user;
    const isPlus = app.isCredoPlus();

    root.innerHTML = `
      <header class="page-head">
        <div>
          <p class="t-footnote">${isPlus ? '✦ ' + app.esc(d.profile.plusActive) : app.esc(d.profile.plusFree)}</p>
          <h1 class="t-large-title">${app.esc(d.profile.title)}</h1>
        </div>
        ${u
          ? `<button type="button" class="btn btn-sm btn-soft" id="profLogoutBtn">${app.esc(d.profile.signOut)}</button>`
          : `<button type="button" class="btn btn-sm btn-gold" id="profLoginBtn">${app.esc(d.profile.signIn)}</button>`}
      </header>

      <article class="card" style="display:flex;flex-direction:column;gap:12px;margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:14px">
          <span class="avatar" style="--av-sz:60px;--av-bg:${app.esc(u?.avatar_color || '#0F1E36')}">
            ${u?.avatar_url ? `<img src="${app.esc(u.avatar_url)}" alt="${app.esc(u.full_name)}" />` : (u ? app.initials(u.full_name) : '✝')}
          </span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <strong style="font-size:1.05rem">${app.esc(u ? (u.title_prefix ? `${u.title_prefix} ` : '') + u.full_name : d.profile.guestName)}</strong>
              ${u?.can_publish ? '<span class="verified-check">✓</span>' : ''}
              ${u?.is_ceo ? '<span class="rank-tag" style="background:linear-gradient(135deg,#D9B75A,#B98E34);color:#0B1220;font-weight:800">CEO · Credo</span>' : ''}
              ${isPlus ? '<span class="rank-tag">✦ Plus</span>' : ''}
            </div>
            <p class="t-footnote" style="margin-top:3px">
              ${u ? `${app.esc(u.current_office_title || d.ranks[u.ecclesiastical_rank] || u.ecclesiastical_rank)}${u.lineage?.length ? ` · ${app.esc(u.lineage[u.lineage.length - 1].name)}` : ''}` : app.esc(d.profile.guestHint)}
            </p>
          </div>
        </div>
        ${u && Array.isArray(u.website_links) && u.website_links.length > 0 ? `
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
            ${u.website_links.map((lk) => `<a href="${app.esc(lk.url)}" target="_blank" rel="noopener noreferrer" class="lineage-pill" style="color:var(--gold-text)">🌐 ${app.esc(lk.label)} ↗</a>`).join('')}
            <a href="#/user/${u.id}" class="btn btn-sm btn-soft" style="margin-left:auto">Ver perfil público</a>
          </div>` : (u ? `<div style="display:flex;justify-content:flex-end"><a href="#/user/${u.id}" class="btn btn-sm btn-soft">Ver perfil público</a></div>` : '')}
      </article>

      <div class="segmented" id="profTabs" role="tablist" style="margin-bottom:16px">
        <button type="button" class="seg-btn${subTab === 'plus' ? ' is-active' : ''}" data-tab="plus">✦ ${app.esc(d.profile.tabs.plus)}</button>
        <button type="button" class="seg-btn${subTab === 'settings' ? ' is-active' : ''}" data-tab="settings">${app.esc(d.profile.tabs.settings)}</button>
        <button type="button" class="seg-btn${subTab === 'saved' ? ' is-active' : ''}" data-tab="saved">${app.esc(d.profile.tabs.saved)}</button>
      </div>

      <section id="profTabBody"></section>
    `;

    root.querySelector('#profLoginBtn')?.addEventListener('click', () => app.openAuthModal());
    root.querySelector('#profLogoutBtn')?.addEventListener('click', () => {
      app.logout();
      renderShell();
    });

    root.querySelector('#profTabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      subTab = b.dataset.tab;
      root.querySelectorAll('#profTabs .seg-btn').forEach((x) => x.classList.toggle('is-active', x === b));
      renderSubTab();
    });

    renderSubTab();
  }

  async function renderSubTab() {
    const host = root.querySelector('#profTabBody');
    if (subTab === 'plus') {
      const isPlus = app.isCredoPlus();
      host.innerHTML = `
        <article class="plus-hero">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
            <span class="rank-tag" style="background:rgba(212,175,55,0.22);color:#FFE07D;padding:5px 12px">✦ ${app.esc(d.profile.plusTitle)}</span>
            ${isPlus ? `<span style="font-size:0.78rem;color:#30D158;font-weight:700">● Activo</span>` : ''}
          </div>
          <h2 class="t-title-2" style="color:#fff">${app.esc(d.profile.plusSubtitle)}</h2>

          <table class="plus-compare" aria-label="Comparativa Gratis vs Credo Plus">
            <thead>
              <tr>
                <th>Beneficio</th>
                <th>Gratis</th>
                <th style="color:#FFE07D">Plus</th>
              </tr>
            </thead>
            <tbody>
              ${d.profile.plusCompare
                .map(
                  ([label, free, plus]) => `
                <tr>
                  <td>${app.esc(label)}</td>
                  <td>${free ? '✓' : '—'}</td>
                  <td style="color:#FFE07D;font-weight:700">${plus ? '✓' : '—'}</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>

          <div class="segmented" id="plusPlanSeg" style="background:rgba(255,255,255,0.1);border-color:rgba(255,255,255,0.16)">
            <button type="button" class="seg-btn${plusPlan === 'monthly' ? ' is-active' : ''}" data-plan="monthly" style="${plusPlan === 'monthly' ? '' : 'color:rgba(255,255,255,0.75)'}">${app.esc(d.profile.plusMonthly)}</button>
            <button type="button" class="seg-btn${plusPlan === 'annual' ? ' is-active' : ''}" data-plan="annual" style="${plusPlan === 'annual' ? '' : 'color:rgba(255,255,255,0.75)'}">${app.esc(d.profile.plusAnnual)} · ${app.esc(d.profile.plusSaveBadge)}</button>
          </div>

          ${isPlus
            ? `<button type="button" class="btn btn-outline btn-block" id="togglePlusBtn" style="color:#fff;border-color:rgba(255,255,255,0.3)">${app.esc(d.profile.plusDeactivate)}</button>`
            : `<button type="button" class="btn btn-gold btn-block" id="togglePlusBtn"> Pay / Tarjeta · ${app.esc(d.profile.plusCta)}</button>`}

          <p class="plus-legal">ⓘ ${app.esc(d.profile.plusLegal)}</p>
        </article>
      `;

      host.querySelector('#plusPlanSeg').onclick = (e) => {
        const b = e.target.closest('[data-plan]');
        if (!b) return;
        plusPlan = b.dataset.plan;
        renderSubTab();
      };
      host.querySelector('#togglePlusBtn').onclick = async () => {
        await app.setCredoPlus(!isPlus, plusPlan);
        renderShell();
      };
      return;
    }

    if (subTab === 'settings') {
      const scheme = currentScheme();
      const glassVal = currentGlass();
      const scale = currentScale();

      host.innerHTML = `
        <div class="card settings-group">
          <h2 class="t-title-3">${app.esc(d.profile.appearance)}</h2>

          <div class="setting-row">
            <label class="t-footnote">${app.esc(d.profile.themeLabel)}</label>
            <div class="segmented" id="themeSeg">
              <button type="button" class="seg-btn${scheme === 'system' ? ' is-active' : ''}" data-scheme="system">${app.esc(d.profile.themeSystem)}</button>
              <button type="button" class="seg-btn${scheme === 'light' ? ' is-active' : ''}" data-scheme="light">${app.esc(d.profile.themeLight)}</button>
              <button type="button" class="seg-btn${scheme === 'dark' ? ' is-active' : ''}" data-scheme="dark">${app.esc(d.profile.themeDark)}</button>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-row-inline">
              <label for="glassSlider" class="t-footnote">${app.esc(d.profile.glassOpacityLabel)}</label>
              <span class="t-caption" id="glassPct">${Math.round(glassVal * 100)}%</span>
            </div>
            <input id="glassSlider" class="range-slider" type="range" min="0" max="1" step="0.05" value="${glassVal}" />
            <div class="setting-row-inline t-caption">
              <span>${app.esc(d.profile.glassClear)}</span>
              <span>${app.esc(d.profile.glassTinted)}</span>
            </div>
          </div>

          <div class="setting-row">
            <label class="t-footnote">${app.esc(d.profile.fontScaleLabel)}</label>
            <div class="segmented" id="scaleSeg">
              <button type="button" class="seg-btn${scale === 'normal' ? ' is-active' : ''}" data-scale="normal">${app.esc(d.profile.fontNormal)}</button>
              <button type="button" class="seg-btn${scale === 'large' ? ' is-active' : ''}" data-scale="large">${app.esc(d.profile.fontLarge)}</button>
              <button type="button" class="seg-btn${scale === 'xl' ? ' is-active' : ''}" data-scale="xl">${app.esc(d.profile.fontXL)}</button>
            </div>
          </div>

          <div class="setting-row">
            <label for="langSelect" class="t-footnote">${app.esc(d.profile.languageLabel)}</label>
            <select id="langSelect" style="min-height:44px;border-radius:14px;border:1px solid var(--sep-strong);background:var(--surface-2);padding:0 12px">
              <option value="es"${app.locale === 'es' ? ' selected' : ''}>Español</option>
              <option value="en"${app.locale === 'en' ? ' selected' : ''}>English</option>
              <option value="it"${app.locale === 'it' ? ' selected' : ''}>Italiano</option>
              <option value="pt"${app.locale === 'pt' ? ' selected' : ''}>Português</option>
              <option value="fr"${app.locale === 'fr' ? ' selected' : ''}>Français</option>
            </select>
          </div>
        </div>

        <div class="card settings-group" style="margin-top:14px">
          ${window.CredoNative
            ? `
              <div class="setting-row-inline">
                <div>
                  <strong class="t-headline" style="display:block">App Android · Credo</strong>
                  <span class="t-footnote">Versión instalada: v${app.esc(window.CredoNative.getVersionName())}</span>
                </div>
                <span class="rank-tag">GitHub OTA</span>
              </div>
              <button type="button" class="btn btn-gold btn-sm btn-block" id="checkUpdateBtn">🔄 Buscar actualizaciones</button>
            `
            : `
              <div class="setting-row-inline">
                <div>
                  <strong class="t-headline" style="display:block">App Android Oficial</strong>
                  <span class="t-footnote">Con actualizaciones automáticas vía GitHub</span>
                </div>
                <span class="rank-tag">APK</span>
              </div>
              <a href="https://github.com/ThePunisherBaby/credo-app/releases/latest" target="_blank" rel="noopener noreferrer" class="btn btn-gold btn-sm btn-block">⬇ Descargar Credo (.apk)</a>
            `}
          <button type="button" class="btn btn-outline btn-sm btn-block" id="replayOnbBtn">${app.esc(d.profile.replayOnboarding)}</button>
        </div>
      `;

      host.querySelector('#checkUpdateBtn')?.addEventListener('click', () => {
        window.CredoNative?.checkForUpdates();
      });

      host.querySelector('#themeSeg').onclick = (e) => {
        const b = e.target.closest('[data-scheme]');
        if (!b) return;
        app.setColorScheme(b.dataset.scheme);
        host.querySelectorAll('#themeSeg .seg-btn').forEach((x) => x.classList.toggle('is-active', x === b));
      };

      const slider = host.querySelector('#glassSlider');
      slider.addEventListener('input', () => {
        const val = slider.value;
        document.documentElement.style.setProperty('--glass-user-opacity', val);
        host.querySelector('#glassPct').textContent = `${Math.round(Number(val) * 100)}%`;
        try { localStorage.setItem('credo-glass-opacity', val); } catch {}
      });

      host.querySelector('#scaleSeg').onclick = (e) => {
        const b = e.target.closest('[data-scale]');
        if (!b) return;
        const sc = b.dataset.scale;
        document.documentElement.dataset.fontScale = sc;
        try { localStorage.setItem('credo-font-scale', sc); } catch {}
        host.querySelectorAll('#scaleSeg .seg-btn').forEach((x) => x.classList.toggle('is-active', x === b));
      };

      host.querySelector('#langSelect').addEventListener('change', (e) => {
        app.setLocale(e.target.value);
      });

      host.querySelector('#replayOnbBtn').onclick = () => app.openOnboarding(true);
      return;
    }

    // Saved posts tab
    if (!app.user) {
      host.innerHTML = `<div class="empty-box"><p>${app.esc(d.profile.guestHint)}</p><button type="button" class="btn btn-gold btn-sm" id="savedLoginBtn">${app.esc(d.profile.signIn)}</button></div>`;
      host.querySelector('#savedLoginBtn').onclick = () => app.openAuthModal();
      return;
    }
    host.innerHTML = `<div class="card"><div class="skeleton" style="height:120px"></div></div>`;
    try {
      const res = await app.api('/api/v1/posts?scope=saved&limit=20', { signal });
      const posts = res.posts || [];
      host.innerHTML =
        posts.length === 0
          ? `<div class="empty-box">Aún no has guardado publicaciones. Toca el ícono de marcador en el feed para guardar homilías y videos.</div>`
          : `<div class="feed-list">${posts
              .map(
                (p) => `
              <article class="card post-card">
                <strong style="font-size:0.86rem;color:var(--gold-text)">${app.esc(p.author?.full_name || '')}</strong>
                ${p.title ? `<h3 class="post-title">${app.esc(p.title)}</h3>` : ''}
                <p class="post-excerpt">${app.esc(p.content)}</p>
              </article>`
              )
              .join('')}</div>`;
    } catch (err) {
      if (err.name !== 'AbortError') host.innerHTML = `<div class="empty-box">${app.esc(err.message)}</div>`;
    }
  }

  renderShell();
  return { cleanup() {} };
}
