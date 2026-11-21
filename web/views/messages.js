// views/messages.js — Grupos Pastorales y Mensajería Directa (On-demand view)
// Polls ONLY while an active conversation is open; stops immediately on cleanup().

export async function mount({ root, app, signal, params }) {
  let activeId = params?.id ? Number(params.id) : null;
  let pollTimer = null;

  if (!app.user) {
    root.innerHTML = `
      <div style="margin-bottom:12px"><a href="#/parishes" class="btn btn-sm btn-soft">← Parroquias</a></div>
      <div class="empty-box">
        <h2 class="t-title-3" style="margin-bottom:8px">Comunidad y Grupos Pastorales</h2>
        <p class="t-subhead" style="margin-bottom:14px">Inicia sesión para unirte a grupos parroquiales o escribir mensajes directos.</p>
        <button type="button" class="btn btn-gold" id="msgLoginBtn">Iniciar sesión</button>
      </div>
    `;
    root.querySelector('#msgLoginBtn').onclick = () => app.openAuthModal();
    return { cleanup() {} };
  }

  root.innerHTML = `
    <header class="page-head">
      <div>
        <a href="#/parishes" class="t-footnote">← Parroquias</a>
        <h1 class="t-large-title">Comunidad</h1>
      </div>
    </header>
    <div id="msgHost"><div class="skeleton" style="height:180px"></div></div>
  `;

  const host = root.querySelector('#msgHost');

  async function renderList() {
    clearInterval(pollTimer);
    pollTimer = null;
    try {
      const [mineRes, discRes] = await Promise.all([
        app.api('/api/v1/conversations', { signal }),
        app.api('/api/v1/conversations/discover', { signal }),
      ]);
      const mine = mineRes.conversations || [];
      const discover = discRes.groups || [];
      host.innerHTML = `
        <div class="section-bar" style="margin-top:0"><h2 class="t-title-3">Tus conversaciones</h2></div>
        <div class="entity-list">
          ${mine.length === 0 ? `<div class="empty-box">Aún no tienes mensajes.</div>` : mine.map((c) => `
            <a href="#/messages/${c.id}" class="entity-row">
              <span class="avatar" style="--av-bg:#0F1E36">${c.kind === 'pastoral_group' ? '⛪' : '💬'}</span>
              <div class="entity-main">
                <div class="entity-title">${app.esc(c.display_title || c.title || 'Conversación')}</div>
                <div class="entity-sub">${app.esc(c.last_message?.content || c.description || 'Abrir chat')}</div>
              </div>
              <span class="t-caption">›</span>
            </a>`).join('')}
        </div>
        ${discover.length > 0 ? `
          <div class="section-bar"><h2 class="t-title-3">Grupos Pastorales</h2></div>
          <div class="entity-list">
            ${discover.map((g) => `
              <div class="entity-row" style="justify-content:space-between">
                <div class="entity-main">
                  <div class="entity-title">${app.esc(g.title)}</div>
                  <div class="entity-sub">${app.esc(g.unit_name || '')}</div>
                </div>
                <button type="button" class="btn btn-sm btn-gold" data-join-group="${g.id}">Unirme</button>
              </div>`).join('')}
          </div>` : ''}
      `;
      host.querySelectorAll('[data-join-group]').forEach((b) => {
        b.onclick = async () => {
          await app.api(`/api/v1/conversations/${b.dataset.joinGroup}/join`, { method: 'POST' });
          location.hash = `#/messages/${b.dataset.joinGroup}`;
        };
      });
    } catch (err) {
      if (err.name !== 'AbortError') host.innerHTML = `<div class="empty-box">${app.esc(err.message)}</div>`;
    }
  }

  async function renderChat(convId) {
    host.innerHTML = `
      <div style="margin-bottom:10px"><a href="#/messages" class="btn btn-sm btn-soft">← Todas las conversaciones</a></div>
      <div class="card" style="display:flex;flex-direction:column;gap:12px;min-height:420px">
        <div id="chatMsgs" style="flex:1;display:flex;flex-direction:column;gap:8px;max-height:55dvh;overflow-y:auto"></div>
        <form id="chatForm" style="display:flex;gap:8px">
          <input type="text" name="content" placeholder="Escribe un mensaje…" required style="flex:1;min-height:44px;border-radius:999px;border:1px solid var(--sep-strong);background:var(--surface-2);padding:0 14px" />
          <button type="submit" class="btn btn-gold btn-sm">Enviar</button>
        </form>
      </div>
    `;
    const msgsEl = host.querySelector('#chatMsgs');
    const loadMsgs = async () => {
      try {
        const res = await app.api(`/api/v1/conversations/${convId}/messages`, { signal });
        const msgs = res.messages || [];
        msgsEl.innerHTML =
          msgs.length === 0
            ? `<p class="t-footnote" style="text-align:center;margin:auto">Inicia la conversación.</p>`
            : msgs
                .map((m) => {
                  const mine = m.sender_id === app.user?.id;
                  return `<div class="dm-bubble${mine ? ' mine' : ''}">
                    ${!mine ? `<div style="font-size:0.72rem;font-weight:700;margin-bottom:2px;color:var(--gold-text)">${app.esc(m.sender?.full_name || '')}</div>` : ''}
                    <div>${app.esc(m.content)}</div>
                  </div>`;
                })
                .join('');
        msgsEl.scrollTop = msgsEl.scrollHeight;
      } catch {}
    };

    await loadMsgs();
    pollTimer = setInterval(loadMsgs, 5000);

    host.querySelector('#chatForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const content = ev.target.content.value.trim();
      if (!content) return;
      ev.target.content.value = '';
      await app.api(`/api/v1/conversations/${convId}/messages`, { method: 'POST', body: { content } });
      loadMsgs();
    });
  }

  if (activeId) await renderChat(activeId);
  else await renderList();

  return {
    cleanup() {
      if (pollTimer) clearInterval(pollTimer);
    },
  };
}
