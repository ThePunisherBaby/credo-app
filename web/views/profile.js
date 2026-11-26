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
    return `
      <img src="${app.esc(proxySrc(p.image_url))}" alt="${app.esc(p.title || '')}" loading="lazy" />
      ${p.video_url ? `<span style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.62);color:#fff;width:22px;height:22px;border-radius:6px;display:grid;place-items:center"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>` : ''}
    `;
  }
  if (p.video_url) {
    return `
      <video src="${app.esc(p.video_url)}" muted playsinline preload="metadata" width="320" height="320" style="width:100%;height:100%;object-fit:cover"></video>
      <span style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.62);color:#fff;width:22px;height:22px;border-radius:6px;display:grid;place-items:center">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      </span>`;
  }
  if (p.youtube_id) {
    return `
      <img src="https://i.ytimg.com/vi/${app.esc(p.youtube_id)}/hqdefault.jpg" alt="${app.esc(p.title || '')}" loading="lazy" />
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
      app.api(`/api/v1/users/${u.id}`, { signal, noCache: true }).catch(() => ({ user: u })),
      app.api(`/api/v1/posts?author_id=${u.id}&limit=36`, { signal }).catch(() => ({ posts: [] })),
      app.api('/api/v1/posts?scope=saved&limit=36', { signal }).catch(() => ({ posts: [] })),
    ]);

    const profile = { ...u, ...(profRes.user || {}) };
    const isCto = app.isCtoUser(profile);
    const planMeta = app.getPlanMeta(profile);
    if (
      profile.active_plan_sku !== app.user?.active_plan_sku ||
      profile.is_cto !== app.user?.is_cto ||
      profile.can_publish !== app.user?.can_publish
    ) {
      app.user = { ...app.user, ...profile };
      app.renderChrome();
    }
    const myPosts = postsRes.posts || [];
    const myVids = myPosts.filter((p) => p.media_kind === 'video' || Boolean(p.youtube_id) || Boolean(p.video_url));
    const savedPosts = savedRes.posts || [];
    const avUrl = proxySrc(profile.avatar_url);
    const links = Array.isArray(profile.website_links) ? profile.website_links : [];
    let activeTab = 'posts';

    const openEditModal = () => {
      const firstLink = links[0] || { label: '', url: '' };
      let nextAvatarUrl = profile.avatar_url || '';
      const dlg = app.openModal(
        isCto ? 'Personalizar Perfil CTO' : 'Editar perfil',
        `
        <form id="editProfForm" style="display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;align-items:center;gap:12px">
            <span class="avatar" id="epAvatarPreview" style="--av-sz:58px;--av-bg:${app.esc(profile.avatar_color || '#081226')}">
              ${avUrl ? `<img src="${app.esc(avUrl)}" alt="" />` : app.initials(profile.full_name)}
            </span>
            <div style="display:flex;flex-direction:column;gap:4px">
              <label class="btn btn-soft btn-sm" style="cursor:pointer;width:fit-content">
                <input type="file" id="epAvatarFile" accept="image/*" hidden />
                <span id="epAvatarBtnLbl">📷 Cambiar foto HD</span>
              </label>
              <small class="t-caption" id="epAvatarHint">Subida directa a Credo Turbo Edge CDN</small>
            </div>
          </div>
          <div class="field">
            <label for="epName">Nombre completo</label>
            <input id="epName" name="full_name" required value="${app.esc(profile.full_name || '')}" />
          </div>
          ${isCto || profile.is_ceo ? `
          <div class="field">
            <label for="epOffice">Cargo / Rol ejecutivo</label>
            <input id="epOffice" name="current_office_title" value="${app.esc(profile.current_office_title || '')}" placeholder="Chief Technology Officer · Arquitectura & Edge Cloud" />
          </div>` : ''}
          <div class="field">
            <label for="epBio">Biografía</label>
            <textarea id="epBio" name="bio" placeholder="Comparte tu servicio, ingeniería o comunidad...">${app.esc(profile.bio || '')}</textarea>
          </div>
          <div class="field">
            <label for="epMotto">Lema personal</label>
            <input id="epMotto" name="motto" value="${app.esc(profile.motto || '')}" placeholder="Ej. Fiat Lux · Ad maiorem Dei gloriam" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1.4fr;gap:8px">
            <div class="field">
              <label for="epLinkLabel">Etiqueta enlace</label>
              <input id="epLinkLabel" name="link_label" value="${app.esc(firstLink.label || '')}" placeholder="Ej. Paulino's Studios" />
            </div>
            <div class="field">
              <label for="epLinkUrl">URL (https://...)</label>
              <input id="epLinkUrl" name="link_url" type="url" value="${app.esc(firstLink.url || '')}" placeholder="https://..." />
            </div>
          </div>
          <button type="submit" class="btn btn-gold btn-block" id="epSaveBtn">Guardar cambios</button>
        </form>
        `
      );

      const avInput = dlg.querySelector('#epAvatarFile');
      const avPreview = dlg.querySelector('#epAvatarPreview');
      const avHint = dlg.querySelector('#epAvatarHint');
      const avBtnLbl = dlg.querySelector('#epAvatarBtnLbl');

      avInput?.addEventListener('change', async () => {
        const file = avInput.files?.[0];
        if (!file) return;
        avBtnLbl.textContent = 'Subiendo HD…';
        try {
          const uploaded = await app.uploadMediaFast(file, {
            maxDim: 900,
            onProgress: ({ pct, mbPerSec }) => {
              if (avHint) avHint.textContent = `Turbo Edge: ${pct}% · ${mbPerSec.toFixed(1)} MB/s`;
            },
          });
          nextAvatarUrl = uploaded.url;
          if (avPreview) avPreview.innerHTML = `<img src="${app.esc(nextAvatarUrl)}" alt="" />`;
          if (avHint) avHint.textContent = '✓ Foto HD lista en Edge CDN';
        } catch (err) {
          if (avHint) avHint.textContent = err.message || 'No se pudo subir la imagen';
        } finally {
          avBtnLbl.textContent = '📷 Cambiar foto HD';
        }
      });

      dlg.querySelector('#editProfForm').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.currentTarget);
        const linkLabel = String(fd.get('link_label') || '').trim();
        const linkUrl = String(fd.get('link_url') || '').trim();
        const nextLinks =
          linkLabel && /^https?:\/\//i.test(linkUrl)
            ? [{ label: linkLabel, url: linkUrl }, ...links.slice(1)]
            : linkUrl === '' && linkLabel === ''
              ? links.slice(1)
              : links;

        try {
          const bodyPayload = {
            full_name: fd.get('full_name'),
            bio: fd.get('bio'),
            motto: fd.get('motto'),
            avatar_url: nextAvatarUrl,
            website_links: nextLinks,
          };
          if (fd.has('current_office_title')) {
            bodyPayload.current_office_title = fd.get('current_office_title');
          }
          const res = await app.api('/api/v1/users/me', {
            method: 'PUT',
            body: bodyPayload,
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
          ${p.video_url ? `<video src="${app.esc(p.video_url)}" controls playsinline preload="metadata" width="640" height="640" ${p.image_url ? `poster="${app.esc(proxySrc(p.image_url))}"` : ''} style="width:100%;max-height:70vh;background:#000;border-radius:10px"></video>` : (p.image_url ? `<img src="${app.esc(proxySrc(p.image_url))}" alt="" style="width:100%;aspect-ratio:1/1;object-fit:cover" />` : '')}
          ${!p.video_url && p.youtube_id ? `<div style="aspect-ratio:16/9;overflow:hidden;background:#000"><iframe src="https://www.youtube.com/embed/${app.esc(p.youtube_id)}?playsinline=1&rel=0" style="width:100%;height:100%;border:0" allowfullscreen></iframe></div>` : ''}
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

    const planStripHtml = planMeta
      ? `
        <button type="button" class="co-prof-plan-strip co-prof-plan-strip--${planMeta.tier}" id="profPlanStripBtn">
          <span class="co-prof-plan-left">
            ${app.renderPlanInsignia(profile, { showLabel: false })}
            <span class="co-prof-plan-meta">
              <strong>${app.esc(planMeta.name)}</strong>
              <small>${app.esc(planMeta.subtitle)}</small>
            </span>
          </span>
          <span class="co-prof-plan-action">Pagos y plan ›</span>
        </button>`
      : '';

    const linksHtml =
      links.length > 0
        ? `
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
          ${links.map((lk) => `
            <a href="${app.esc(lk.url)}" target="_blank" rel="noopener noreferrer" class="source-pill-box">
              <span>🔗 ${app.esc(lk.label)}</span>
              <span class="source-pill-arrow" aria-hidden="true">↗</span>
            </a>`).join('')}
        </div>`
        : '';

    const ctoHeroHtml = isCto
      ? `
        <section class="cto-hero-card" aria-label="Perfil Ejecutivo CTO">
          <div class="cto-hero-inner">
            <div class="cto-telemetry-bar">
              <span class="cto-telemetry-status">
                <span class="cto-status-dot" aria-hidden="true"></span>
                <span>ARQUITECTURA CREDO · CORE LEAD</span>
              </span>
              <span class="cto-telemetry-serial" id="ctoEdgeTelemetry">EDGE 4TB · HTTP/3 ONLINE</span>
            </div>

            <div class="cto-identity-grid">
              <div class="cto-avatar-wrap">
                <div class="cto-avatar-ring">
                  <div
                    class="ig-prof-avatar"
                    data-zoomable
                    data-zoom-name="${app.esc(profile.full_name || 'CTO · Credo')}"
                    data-zoom-src="${app.esc(avUrl)}"
                    data-zoom-bg="${app.esc(profile.avatar_color || '#081226')}"
                    title="Mantén presionado para ampliar"
                  >
                    ${avUrl ? `<img src="${app.esc(avUrl)}" alt="${app.esc(profile.full_name)}" />` : '&lt;P/&gt;'}
                  </div>
                </div>
                <span class="cto-avatar-crest" aria-hidden="true">&lt;/&gt; CTO</span>
              </div>

              <div class="cto-stats-glass">
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
            </div>

            <div class="cto-bio-block">
              <div class="cto-name-row">
                <span class="cto-name-title">${app.esc(profile.full_name || 'Paulino Studios')}</span>
                ${app.renderCtoInsignia(profile, { variant: 'executive' })}
                ${app.renderPlanInsignia(profile)}
              </div>
              <span class="cto-role-line">${app.esc(profile.current_office_title || 'Chief Technology Officer · Arquitectura & Edge Cloud')}</span>
              <p class="cto-bio-copy">${app.esc(profile.bio || 'Ingeniería principal de Credo · F# Core Kernel (.NET 8), Liquid Glass UI y red global Credo Turbo Edge 4 TB.')}</p>
              ${profile.motto ? `<p class="cto-motto-line">«${app.esc(profile.motto)}»</p>` : ''}
              ${linksHtml}
            </div>

            <div class="cto-pillars-grid" aria-label="Infraestructura dirigida">
              <div class="cto-pillar-card">
                <strong>⚡ Turbo Edge CDN</strong>
                <span id="ctoStorageSub">4.0 TB ZFS · HTTP/3</span>
              </div>
              <div class="cto-pillar-card">
                <strong>◈ F# Core Kernel</strong>
                <span>.NET 8 · PostgreSQL</span>
              </div>
              <div class="cto-pillar-card">
                <strong>✦ Liquid Glass UI</strong>
                <span>PWA · Android OTA</span>
              </div>
            </div>

            ${planStripHtml}

            <div class="cto-cta-row">
              <button type="button" class="cto-btn-primary" id="igEditProfBtn">✦ Personalizar perfil CTO</button>
              <button type="button" class="cto-btn-secondary" id="igShareProfBtn">Compartir perfil</button>
            </div>

            <a href="#/studio/overview" class="cto-studio-bar">
              <span>◈ Credo One Studio · Consola Ejecutiva CTO</span>
              <span>Abrir ›</span>
            </a>
          </div>
        </section>
      `
      : `
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
          <strong style="font-size:0.96rem;display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span>${app.esc(profile.title_prefix ? `${profile.title_prefix} ` : '')}${app.esc(profile.full_name)}</span>
            ${app.renderPlanInsignia(profile)}
          </strong>
          <span class="t-footnote">${app.esc(profile.current_office_title || d.ranks[profile.ecclesiastical_rank] || 'Miembro de Credo')}</span>
          ${profile.bio ? `<p style="margin:4px 0 0;font-size:0.88rem;line-height:1.42">${app.esc(profile.bio)}</p>` : ''}
          ${profile.motto ? `<p style="margin:2px 0 0;font-size:0.84rem;font-style:italic;color:var(--gold-text)">«${app.esc(profile.motto)}»</p>` : ''}
          ${planStripHtml}
          ${linksHtml}
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
      `;

    root.innerHTML = `
      <div class="ig-prof-top${isCto ? ' ig-prof-top--cto' : ''}">
        <div class="ig-prof-username">
          <span>@${app.esc(profile.username || 'credo')}</span>
          ${profile.is_ceo ? '<span class="rank-tag" style="background:#0A84FF;color:#FFFFFF;font-size:0.68rem">CEO</span>' : ''}
          ${app.renderCtoInsignia(profile)}
          ${app.renderPlanInsignia(profile)}
        </div>
        <div class="ig-prof-actions" style="gap:6px">
          <button type="button" class="credo-one-trigger" id="profCredoOneBtn" aria-label="Plan Credo One"></button>
          ${profile.can_publish ? `
            <button type="button" class="ig-icon-btn" id="igAddPostBtn" aria-label="Nueva publicación">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
            </button>` : ''}
          <a href="#/settings" class="ig-icon-btn" aria-label="Configuración">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
          </a>
        </div>
      </div>

      ${ctoHeroHtml}

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

    if (isCto) {
      app.api('/api/v1/media/storage-status', { signal, ttlMs: 30_000 })
        .then((st) => {
          if (signal.aborted || !st) return;
          const badgeEl = root.querySelector('#ctoEdgeTelemetry');
          const subEl = root.querySelector('#ctoStorageSub');
          if (badgeEl && st.healthy) {
            badgeEl.textContent = `EDGE 4TB · ${st.objects_count ?? 0} OBJ · H3`;
          }
          if (subEl && st.capacity_bytes) {
            const tb = (Number(st.capacity_bytes) / 1e12).toFixed(1);
            subEl.textContent = `${tb} TB ZFS · ONLINE`;
          }
        })
        .catch(() => {});
    }

    const profCoBtn = root.querySelector('#profCredoOneBtn');
    app.syncCredoOneButton(profCoBtn, profile);
    profCoBtn?.addEventListener('click', () => app.openCredoOne(planMeta ? { view: 'billing' } : {}));
    root.querySelector('#profPlanStripBtn')?.addEventListener('click', () => app.openCredoOne({ view: 'billing' }));
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
