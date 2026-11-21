// views/profile.js — Pantalla 5: Perfil, Parroquias, Mensajes, Guardados y Ajustes
// Loaded on demand ONLY when on #/profile.

export async function mount({ root, app, signal }) {
  const d = app.dict();
  let subTab = 'settings';

  const currentScheme = () => {
    try {
      const v = localStorage.getItem('credo-color-scheme');
      return v === 'dark' || v === 'light' ? v : 'system';
    } catch {
      return 'system';
    }
  };

  function renderShell() {
    const u = app.user;

    root.innerHTML = `
      <header class="page-head">
        <div>
          <p class="t-footnote">${u ? app.esc(d.ranks[u.ecclesiastical_rank] || u.ecclesiastical_rank) : app.esc(d.profile.guestName)}</p>
          <h1 class="t-large-title">${app.esc(d.profile.title)}</h1>
        </div>
        ${u
          ? `<button type="button" class="btn btn-sm btn-soft" id="profLogoutBtn">${app.esc(d.profile.signOut)}</button>`
          : `<button type="button" class="btn btn-sm btn-gold" id="profLoginBtn">${app.esc(d.profile.signIn)}</button>`}
      </header>

      <article class="card" style="display:flex;flex-direction:column;gap:12px;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:14px">
          <span class="avatar" style="--av-sz:60px;--av-bg:${app.esc(u?.avatar_color || '#0F1E36')}">
            ${u?.avatar_url ? `<img src="${app.esc(u.avatar_url)}" alt="${app.esc(u.full_name)}" />` : (u ? app.initials(u.full_name) : '✝')}
          </span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <strong style="font-size:1.05rem">${app.esc(u ? (u.title_prefix ? `${u.title_prefix} ` : '') + u.full_name : d.profile.guestName)}</strong>
              ${u?.can_publish ? '<span class="verified-check">✓</span>' : ''}
              ${u?.is_ceo ? '<span class="rank-tag" style="background:linear-gradient(135deg,#D9B75A,#B98E34);color:#0B1220;font-weight:800">CEO · Credo</span>' : ''}
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

      <div style="display:grid;gap:10px;margin-bottom:14px">
        <a href="#/parishes" class="card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 16px;text-decoration:none;color:inherit">
          <div style="display:flex;align-items:center;gap:12px;min-width:0">
            <span style="width:40px;height:40px;border-radius:8px;background:var(--gold-soft);color:var(--gold-text);display:grid;place-items:center;flex-shrink:0">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v5"/><path d="M9.5 4.5h5"/><path d="M5 21V11l7-4 7 4v10"/><path d="M9 21v-5a3 3 0 0 1 6 0v5"/><path d="M3 21h18"/></svg>
            </span>
            <div style="min-width:0">
              <strong style="display:block;font-size:0.95rem">Parroquias y Jerarquía</strong>
              <span class="t-footnote">Diócesis, conferencias episcopales y comunidad</span>
            </div>
          </div>
          <span style="color:var(--label-3);font-weight:700;font-size:1.1rem" aria-hidden="true">›</span>
        </a>

        <a href="#/messages" class="card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 16px;text-decoration:none;color:inherit">
          <div style="display:flex;align-items:center;gap:12px;min-width:0">
            <span style="width:40px;height:40px;border-radius:8px;background:var(--surface-2);color:var(--label);display:grid;place-items:center;flex-shrink:0">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </span>
            <div style="min-width:0">
              <strong style="display:block;font-size:0.95rem">Mensajes Directos</strong>
              <span class="t-footnote">Conversaciones privadas y canales parroquiales</span>
            </div>
          </div>
          <span style="color:var(--label-3);font-weight:700;font-size:1.1rem" aria-hidden="true">›</span>
        </a>
      </div>

      <div class="segmented" id="profTabs" role="tablist" style="margin-bottom:16px">
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

    if (subTab === 'settings') {
      const scheme = currentScheme();

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
            <label for="langSelect" class="t-footnote">${app.esc(d.profile.languageLabel)}</label>
            <select id="langSelect" style="min-height:44px;border-radius:8px;border:1px solid var(--sep-strong);background:var(--surface-2);padding:0 12px">
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
