// views/profile.js — Instagram-Style Profile + In-View Auth Gate (Three-dots -> #/settings)

function proxySrc(url) {
  if (!url) return '';
  if (/^https?:\/\/(aire96fm\.com\.do|reflexionandolapalabra\.com)/i.test(url)) {
    return `/api/v1/media/proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

function renderAuthGate({ root, app, signal }) {
  let mode = 'login';
  const render = () => {
    const isReg = mode === 'register';
    root.innerHTML = `
      <div class="ig-prof-top">
        <div class="ig-prof-username">
          <img class="brand-logo" src="/icons/credo-192.png" alt="" width="30" height="30" />
          <span>Credo</span>
        </div>
        <div class="ig-prof-actions" style="gap:8px">
          <button type="button" class="credo-one-trigger" id="authGateCredoOneBtn" aria-label="Abrir Familia Credo One">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z"/></svg>
            <span>Credo One</span>
          </button>
          <a href="#/settings" class="ig-icon-btn" aria-label="Configuración">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
          </a>
        </div>
      </div>

      <div class="ig-auth-gate">
        <div class="ig-auth-card">
          <div style="text-align:center;margin-bottom:4px">
            <img src="/icons/credo-192.png" alt="Credo" width="64" height="64" style="display:block;margin:0 auto 10px" />
            <h1 class="t-title-2" style="margin:0">${isReg ? 'Crear cuenta en Credo' : 'Inicia sesión en Credo'}</h1>
            <p class="t-footnote" style="margin:4px 0 0">Tu comunidad católica, tus publicaciones y tu parroquia cercana</p>
          </div>

          <div class="seg-tabs" style="margin-bottom:4px">
            <button type="button" class="seg-tab${!isReg ? ' is-active' : ''}" data-auth-mode="login">Iniciar sesión</button>
            <button type="button" class="seg-tab${isReg ? ' is-active' : ''}" data-auth-mode="register">Crear cuenta</button>
          </div>

          <form id="igAuthForm" style="display:flex;flex-direction:column;gap:12px">
            ${isReg ? `
              <div class="field">
                <label for="authName">Nombre completo</label>
                <input id="authName" name="full_name" required placeholder="Ej. María Pérez" />
              </div>
              <div class="field">
                <label for="authUser">Usuario</label>
                <input id="authUser" name="username" placeholder="Ej. maria_perez" autocomplete="username" />
              </div>
              <div class="field">
                <label for="authCountry">País (para conectar con tu parroquia)</label>
                <select id="authCountry" name="country_code">
                  <option value="DO" selected>República Dominicana</option>
                  <option value="ES">España</option>
                  <option value="MX">México</option>
                  <option value="CO">Colombia</option>
                  <option value="US">Estados Unidos</option>
                  <option value="AR">Argentina</option>
                  <option value="PE">Perú</option>
                  <option value="VA">Ciudad del Vaticano / Universal</option>
                </select>
              </div>` : ''}
            <div class="field">
              <label for="authEmail">Correo electrónico</label>
              <input id="authEmail" name="email" type="email" required placeholder="tu@correo.com" autocomplete="email" />
            </div>
            <div class="field">
              <label for="authPass">Contraseña</label>
              <input id="authPass" name="password" type="password" required minlength="6" placeholder="Mínimo 6 caracteres" autocomplete="${isReg ? 'new-password' : 'current-password'}" />
            </div>
            <div id="igAuthError" style="color:var(--live-red);font-size:0.82rem;font-weight:700;display:none"></div>
            <button type="submit" class="btn btn-gold btn-block" id="igAuthSubmit">
              ${isReg ? 'Crear cuenta' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    `;

    root.querySelector('#authGateCredoOneBtn')?.addEventListener('click', () => app.openCredoOne());
    root.querySelectorAll('[data-auth-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        mode = btn.dataset.authMode;
        render();
      });
    });

    root.querySelector('#igAuthForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.currentTarget);
      const errBox = root.querySelector('#igAuthError');
      const submitBtn = root.querySelector('#igAuthSubmit');
      errBox.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = isReg ? 'Creando cuenta...' : 'Entrando...';

      try {
        const endpoint = isReg ? '/api/v1/auth/register' : '/api/v1/auth/login';
        const payload = Object.fromEntries(fd.entries());
        const res = await app.api(endpoint, { method: 'POST', body: payload });
        app.setAuth(res.token, res.user);
        app.toast(`Bienvenido, ${res.user.full_name}`);
        await mount({ root, app, signal });
      } catch (err) {
        errBox.textContent = err.message || 'No se pudo completar el acceso';
        errBox.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = isReg ? 'Crear cuenta' : 'Entrar';
      }
    });
  };

  render();
  return { cleanup() {} };
}

function renderTilePreview(p, app) {
  if (p.image_url) {
    return `<img src="${app.esc(proxySrc(p.image_url))}" alt="${app.esc(p.title || '')}" />`;
  }
  if (p.youtube_id) {
    return `
      <img src="https://i.ytimg.com/vi/${app.esc(p.youtube_id)}/hqdefault.jpg" alt="${app.esc(p.title || '')}" />
      <span style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.62);color:#fff;width:22px;height:22px;border-radius:6px;display:grid;place-items:center">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      </span>`;
  }
  return `<div class="ig-tile-text">${app.esc(p.title || p.content || '')}</div>`;
}

export async function mount({ root, app, signal }) {
  if (!app.user) {
    return renderAuthGate({ root, app, signal });
  }

  const d = app.dict();
  const u = app.user;
  root.innerHTML = `<div class="skeleton" style="height:260px"></div>`;

  try {
    const [profRes, postsRes, savedRes] = await Promise.all([
      app.api(`/api/v1/users/${u.id}`, { signal }).catch(() => ({ user: u })),
      app.api(`/api/v1/posts?author_id=${u.id}&limit=36`, { signal }).catch(() => ({ posts: [] })),
      app.api('/api/v1/posts?scope=saved&limit=36', { signal }).catch(() => ({ posts: [] })),
    ]);

    const profile = profRes.user || u;
    const myPosts = postsRes.posts || [];
    const myVids = myPosts.filter((p) => p.media_kind === 'video' || Boolean(p.youtube_id));
    const savedPosts = savedRes.posts || [];
    const avUrl = proxySrc(profile.avatar_url);
    let activeTab = 'posts';

    const openEditModal = () => {
      const dlg = app.openModal(
        'Editar perfil',
        `
        <form id="editProfForm" style="display:flex;flex-direction:column;gap:12px">
          <div class="field">
            <label for="epName">Nombre completo</label>
            <input id="epName" name="full_name" required value="${app.esc(profile.full_name || '')}" />
          </div>
          <div class="field">
            <label for="epBio">Biografía</label>
            <textarea id="epBio" name="bio" placeholder="Comparte tu servicio o comunidad...">${app.esc(profile.bio || '')}</textarea>
          </div>
          <div class="field">
            <label for="epMotto">Lema personal</label>
            <input id="epMotto" name="motto" value="${app.esc(profile.motto || '')}" placeholder="Ej. Ad maiorem Dei gloriam" />
          </div>
          <button type="submit" class="btn btn-gold btn-block">Guardar cambios</button>
        </form>
        `
      );
      dlg.querySelector('#editProfForm').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.currentTarget);
        try {
          const res = await app.api('/api/v1/users/me', {
            method: 'PUT',
            body: {
              full_name: fd.get('full_name'),
              bio: fd.get('bio'),
              motto: fd.get('motto'),
            },
          });
          if (res.user) {
            app.user = res.user;
            app.renderChrome();
          }
          app.closeModal();
          app.toast('Perfil actualizado');
          mount({ root, app, signal });
        } catch (err) {
          app.toast(err.message);
        }
      });
    };

    const openPostDetail = (p) => {
      const dlg = app.openModal(
        p.title || profile.full_name,
        `
        <div style="display:flex;flex-direction:column;gap:12px">
          ${p.image_url ? `<img src="${app.esc(proxySrc(p.image_url))}" alt="" style="width:100%;aspect-ratio:1/1;object-fit:cover" />` : ''}
          ${p.youtube_id ? `<div style="aspect-ratio:16/9;overflow:hidden;background:#000"><iframe src="https://www.youtube.com/embed/${app.esc(p.youtube_id)}?playsinline=1&rel=0" style="width:100%;height:100%;border:0" allowfullscreen></iframe></div>` : ''}
          ${p.scripture_ref ? `<span class="post-scripture-pill">📖 ${app.esc(p.scripture_ref)}</span>` : ''}
          <p style="margin:0;font-size:0.94rem;line-height:1.55;white-space:pre-line">${app.esc(p.content || '')}</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn btn-gold btn-sm" id="profOpenCommentsBtn">💬 Comentarios (${p.comments_count || 0})</button>
          </div>
        </div>
        `
      );
      dlg.querySelector('#profOpenCommentsBtn')?.addEventListener('click', () => app.openCommentsModal(p));
    };

    const renderGrid = () => {
      const list = activeTab === 'vids' ? myVids : activeTab === 'saved' ? savedPosts : myPosts;
      const gridEl = root.querySelector('#igProfGrid');
      if (!gridEl) return;
      if (list.length === 0) {
        gridEl.className = '';
        gridEl.innerHTML = `<div class="empty-box" style="margin-top:12px">${activeTab === 'saved' ? 'Aún no tienes publicaciones guardadas.' : activeTab === 'vids' ? 'Aún no has publicado videos.' : 'Aún no hay publicaciones en tu perfil.'}</div>`;
        return;
      }
      gridEl.className = 'ig-prof-grid';
      gridEl.innerHTML = list.map((p, idx) => `
        <button type="button" class="ig-prof-tile" data-tile-idx="${idx}" aria-label="${app.esc(p.title || 'Publicación')}">
          ${renderTilePreview(p, app)}
        </button>
      `).join('');
      gridEl.querySelectorAll('.ig-prof-tile').forEach((btn) => {
        btn.addEventListener('click', () => openPostDetail(list[Number(btn.dataset.tileIdx)]));
      });
    };

    root.innerHTML = `
      <div class="ig-prof-top">
        <div class="ig-prof-username">
          <span>@${app.esc(profile.username || 'credo')}</span>
          ${profile.is_ceo ? '<span class="rank-tag" style="background:#0A84FF;color:#FFFFFF;font-size:0.68rem">CEO</span>' : ''}
        </div>
        <div class="ig-prof-actions" style="gap:6px">
          <button type="button" class="credo-one-trigger" id="profCredoOneBtn" aria-label="Abrir Familia Credo One">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z"/></svg>
            <span>Credo One</span>
          </button>
          ${profile.can_publish ? `
            <button type="button" class="ig-icon-btn" id="igAddPostBtn" aria-label="Nueva publicación">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
            </button>` : ''}
          <a href="#/settings" class="ig-icon-btn" aria-label="Configuración">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
          </a>
        </div>
      </div>

      <section class="ig-prof-head">
        <div
          class="ig-prof-avatar"
          data-zoomable
          data-zoom-name="${app.esc(`${profile.title_prefix ? `${profile.title_prefix} ` : ''}${profile.full_name || 'Mi Perfil'}`)}"
          data-zoom-src="${app.esc(avUrl)}"
          data-zoom-bg="${app.esc(profile.avatar_color || '#0F1E36')}"
          style="${profile.avatar_color ? `background:${app.esc(profile.avatar_color)}` : ''}"
          title="Mantén presionado para ampliar"
        >
          ${avUrl ? `<img src="${app.esc(avUrl)}" alt="${app.esc(profile.full_name)}" />` : app.initials(profile.full_name)}
        </div>
        <div class="ig-prof-stats">
          <div>
            <span class="ig-stat-val">${profile.posts_count ?? myPosts.length}</span>
            <span class="ig-stat-lbl">Publicaciones</span>
          </div>
          <div>
            <span class="ig-stat-val">${profile.followers_count ?? 0}</span>
            <span class="ig-stat-lbl">Seguidores</span>
          </div>
          <div>
            <span class="ig-stat-val">${profile.following_count ?? 0}</span>
            <span class="ig-stat-lbl">Siguiendo</span>
          </div>
        </div>
      </section>

      <div class="ig-prof-bio">
        <strong style="font-size:0.96rem">${app.esc(profile.title_prefix ? `${profile.title_prefix} ` : '')}${app.esc(profile.full_name)}</strong>
        <span class="t-footnote">${app.esc(profile.current_office_title || d.ranks[profile.ecclesiastical_rank] || 'Miembro de Credo')}</span>
        ${profile.bio ? `<p style="margin:4px 0 0;font-size:0.88rem;line-height:1.42">${app.esc(profile.bio)}</p>` : ''}
        ${profile.motto ? `<p style="margin:2px 0 0;font-size:0.84rem;font-style:italic;color:var(--gold-text)">«${app.esc(profile.motto)}»</p>` : ''}
        ${Array.isArray(profile.website_links) && profile.website_links.length > 0 ? `
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
            ${profile.website_links.map((lk) => `
              <a href="${app.esc(lk.url)}" target="_blank" rel="noopener noreferrer" class="source-pill-box">
                <span>🔗 ${app.esc(lk.label)}</span>
                <span class="source-pill-arrow" aria-hidden="true">↗</span>
              </a>`).join('')}
          </div>` : ''}
      </div>

      <div class="ig-prof-cta">
        <button type="button" class="btn btn-soft btn-sm" id="igEditProfBtn">Editar perfil</button>
        <button type="button" class="btn btn-soft btn-sm" id="igShareProfBtn">Compartir perfil</button>
      </div>
      ${profile.studio_eligible ? `
        <div style="margin-top:8px">
          <a href="#/studio/overview" class="co-cta-btn ${profile.active_plan_sku === 'biz_one_enterprise' || profile.is_ceo ? 'co-cta-gold' : 'co-cta-sapphire'}" style="min-height:40px;font-size:0.84rem">
            <span>✦ Abrir Credo One Studio</span>
          </a>
        </div>` : ''}

      <div class="ig-prof-tabs" role="tablist">
        <button type="button" class="ig-prof-tab is-active" data-ptab="posts" aria-label="Publicaciones">
          <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        </button>
        <button type="button" class="ig-prof-tab" data-ptab="vids" aria-label="Vids">
          <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="m10 8.5 6 3.5-6 3.5z" fill="currentColor" stroke="none"/></svg>
        </button>
        <button type="button" class="ig-prof-tab" data-ptab="saved" aria-label="Guardados">
          <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        </button>
      </div>

      <div id="igProfGrid"></div>
    `;

    root.querySelector('#profCredoOneBtn')?.addEventListener('click', () => app.openCredoOne());
    root.querySelector('#igAddPostBtn')?.addEventListener('click', () => app.openComposer());
    root.querySelector('#igEditProfBtn').addEventListener('click', openEditModal);
    root.querySelector('#igShareProfBtn').addEventListener('click', async () => {
      const shareUrl = `${location.origin}/#/user/${profile.id}`;
      try {
        if (navigator.share) await navigator.share({ title: profile.full_name, url: shareUrl });
        else {
          await navigator.clipboard?.writeText(shareUrl);
          app.toast('Enlace de perfil copiado');
        }
      } catch {}
    });

    root.querySelectorAll('.ig-prof-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        activeTab = tab.dataset.ptab;
        root.querySelectorAll('.ig-prof-tab').forEach((t) => t.classList.toggle('is-active', t === tab));
        renderGrid();
      });
    });

    renderGrid();
  } catch (err) {
    if (err.name !== 'AbortError') root.innerHTML = `<div class="empty-box">${app.esc(err.message)}</div>`;
  }

  return { cleanup() {} };
}
