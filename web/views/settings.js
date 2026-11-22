// views/settings.js — Dedicated Apple iOS-Style Settings Screen (#/settings)

export async function mount({ root, app }) {
  const d = app.dict();
  const savedTheme = (() => {
    try { return localStorage.getItem('credo-color-scheme') || 'system'; } catch { return 'system'; }
  })();

  root.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">
      <a href="#/profile" class="btn btn-sm btn-soft" aria-label="Volver a Perfil">← ${app.esc(d.nav.profile)}</a>
      <h1 class="t-title-2" style="margin:0">${app.esc(d.profile.settings || 'Configuración')}</h1>
    </div>

    <div class="ios-list">
      <div class="ios-row" style="flex-direction:column;align-items:stretch;gap:10px">
        <div>
          <div class="ios-row-label">${app.esc(d.profile.theme || 'Apariencia')}</div>
          <div class="ios-row-sub">Elige claro, oscuro OLED o seguir el sistema</div>
        </div>
        <div class="seg-tabs" style="margin-bottom:0" id="themePicker">
          <button type="button" class="seg-tab${savedTheme === 'system' ? ' is-active' : ''}" data-theme="system">${app.esc(d.profile.themeAuto || 'Sistema')}</button>
          <button type="button" class="seg-tab${savedTheme === 'light' ? ' is-active' : ''}" data-theme="light">${app.esc(d.profile.themeLight || 'Claro')}</button>
          <button type="button" class="seg-tab${savedTheme === 'dark' ? ' is-active' : ''}" data-theme="dark">${app.esc(d.profile.themeDark || 'Oscuro')}</button>
        </div>
      </div>

      <div class="ios-row">
        <div>
          <div class="ios-row-label">${app.esc(d.profile.language || 'Idioma')}</div>
        </div>
        <select id="langSelect" class="ios-select" style="width:auto;min-width:150px" aria-label="${app.esc(d.profile.language || 'Idioma')}">
          <option value="es"${app.locale === 'es' ? ' selected' : ''}>Español</option>
          <option value="en"${app.locale === 'en' ? ' selected' : ''}>English</option>
          <option value="pt"${app.locale === 'pt' ? ' selected' : ''}>Português</option>
        </select>
      </div>

      <div class="ios-row">
        <div>
          <div class="ios-row-label">${app.esc(d.profile.replayWelcome || 'Introducción')}</div>
          <div class="ios-row-sub">Volver a ver la guía inicial de Credo</div>
        </div>
        <button type="button" class="btn btn-sm btn-soft" id="replayOnbBtn">Abrir</button>
      </div>
    </div>

    ${app.user ? `
      <div class="ios-list">
        <div class="ios-row">
          <div>
            <div class="ios-row-label">${app.esc(app.user.full_name)}</div>
            <div class="ios-row-sub">@${app.esc(app.user.username || 'credo')} · ${app.esc(d.ranks[app.user.ecclesiastical_rank] || 'Fiel')}</div>
          </div>
          <button type="button" class="btn btn-sm" style="background:var(--live-soft);color:var(--live-red)" id="settingsLogoutBtn">${app.esc(d.profile.signOut || 'Cerrar sesión')}</button>
        </div>
      </div>
    ` : ''}

    <p class="t-caption" style="text-align:center;padding:8px 0">Credo · Plataforma Católica Universal</p>
  `;

  root.querySelectorAll('#themePicker .seg-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('#themePicker .seg-tab').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      app.setColorScheme(btn.dataset.theme);
      app.toast('Apariencia actualizada');
    });
  });

  root.querySelector('#langSelect').addEventListener('change', (ev) => {
    app.setLocale(ev.target.value);
  });

  root.querySelector('#replayOnbBtn').addEventListener('click', () => {
    app.openOnboarding(true);
  });

  root.querySelector('#settingsLogoutBtn')?.addEventListener('click', () => {
    app.setAuth('', null);
    app.toast('Sesión cerrada');
    location.hash = '#/profile';
  });

  return { cleanup() {} };
}
