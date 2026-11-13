/* Capital Compliance — interface web (sem dependências externas).
 * Segurança: todo texto vindo da API entra na página via textContent (função h), nunca innerHTML.
 * Autorização é sempre do servidor: esconder um botão aqui é só conveniência.
 */
'use strict';
(() => {
  const $app = document.getElementById('app');
  const state = { me: null, docTypes: {}, unread: 0 };
  const REGIMES = ['Simples Nacional', 'Lucro Presumido', 'Lucro Real', 'Não informado'];
  // Só módulos disponíveis nesta versão (Financeiro, Relatórios e Gestão Operacional ficam ocultos).
  const MODULES = { painel_fiscal: 'Painel Fiscal', documentos: 'Documentos', obrigacoes: 'Obrigações e Vencimentos' };
  const SUB_STATUS = { recebido: ['Recebido', 'warn'], em_analise: ['Em análise', 'warn'], aceito: ['Aceito', 'ok'],
    rejeitado: ['Rejeitado', 'bad'], arquivado: ['Arquivado', ''] };
  const GUIDE_AVAIL = { disponivel: ['Disponível', 'ok'], pendente: ['Guia pendente', 'warn'],
    substituida: ['Substituída (nova versão)', 'warn'], arquivada: ['Arquivada', ''] };
  const DOC_STATUS = { pending: ['Pendente', 'warn'], processing: ['Em processamento', 'warn'], available: ['Disponível', 'ok'],
    viewed: ['Visualizado', ''], downloaded: ['Baixado', ''], rejected: ['Rejeitado', 'bad'], replaced: ['Substituído', ''],
    archived: ['Arquivado', ''] };
  const OB_STATUS = { pendente: ['Pendente', 'warn'], em_preparacao: ['Em preparação', 'warn'],
    aguardando_conferencia: ['Aguardando conferência', 'warn'], concluido: ['Concluído', 'ok'], vencido: ['Vencido', 'bad'],
    nao_aplicavel: ['Não aplicável', ''] };
  const TYPE_LABEL = { admin: 'Administrador', employee: 'Funcionário', client: 'Cliente' };
  const TAX = ['IRPJ', 'CSLL', 'COFINS', 'PIS', 'CPP', 'ICMS', 'IPI', 'ISS'];

  // ------------------------------------------------------------------------------ utilidades
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const link = (href, text, cls) => h('a', { href, 'data-link': true, class: cls }, text);
  const money = c => c === null || c === undefined ? h('span', { class: 'na', text: 'Não informado' })
    : (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const moneyText = c => c === null || c === undefined ? 'Não informado'
    : (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const cnpj = s => (s || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  const period = p => p ? `${p.slice(5)}/${p.slice(0, 4)}` : '—';
  const dateTime = iso => iso ? new Date(iso).toLocaleString('pt-BR') : '—';
  const day = d => d ? d.split('-').reverse().join('/') : null;
  const badge = (map, key) => { const [t, c] = map[key] || [key, '']; return h('span', { class: `badge ${c}`, text: t }); };
  const can = p => !!state.me && state.me.permissions.includes(p);
  const isStaff = () => state.me && state.me.user_type !== 'client';
  const bytes = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
  function cookie(name) {
    const m = document.cookie.split('; ').find(c => c.startsWith(name + '='));
    return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
  }
  function toast(msg, kind = 'ok') {
    const t = h('div', { class: `alert toast ${kind}`, role: 'status', text: msg });
    document.body.append(t);
    setTimeout(() => t.remove(), 4500);
  }
  const errorBox = e => h('div', { class: 'alert error', role: 'alert', text: e.message || String(e) });
  function storage(key, value) {
    try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch { return null; }
  }
  function field(labelText, input, hint) {
    return h('div', { class: 'field' }, h('label', {}, labelText, input), hint ? h('div', { class: 'small muted', text: hint }) : null);
  }
  function busy(btn, fn) {
    return async (...args) => {
      btn.disabled = true;
      try { await fn(...args); } catch (e) { toast(e.message, 'error'); } finally { btn.disabled = false; }
    };
  }

  // ------------------------------------------------------------------------------------- API
  class ApiError extends Error { constructor(status, message, body) { super(message); this.status = status; this.body = body; } }
  let refreshing = null;
  function tryRefresh() {
    if (!refreshing) {
      refreshing = fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin',
        headers: { 'X-CSRF-Token': cookie('cc_csrf') } }).then(r => r.ok).catch(() => false)
        .finally(() => setTimeout(() => { refreshing = null; }, 0));
    }
    return refreshing;
  }
  function messageOf(data, status) {
    if (data && typeof data.error === 'string') return data.error;
    if (data && typeof data.detail === 'string') return data.detail;
    if (data && data.detail && typeof data.detail.error === 'string') return data.detail.error;
    if (data && Array.isArray(data.detail) && data.detail[0]) return `Dados inválidos: ${data.detail[0].msg}`;
    return status >= 500 ? 'Erro interno. Tente novamente.' : `Erro ${status}`;
  }
  async function api(method, path, body, opts = {}) {
    const doFetch = () => {
      const headers = {};
      let payload;
      if (body instanceof FormData) payload = body;
      else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
      if (method !== 'GET') headers['X-CSRF-Token'] = cookie('cc_csrf');
      return fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
    };
    let r = await doFetch();
    if (r.status === 401 && !path.startsWith('/api/auth/login') && !opts.noRefresh && await tryRefresh()) r = await doFetch();
    let data = (r.headers.get('content-type') || '').includes('json') ? await r.json() : null;
    if (r.status === 403 && data && data.detail && data.detail.code === 'reauth_required' && !opts.noReauth) {
      if (await askReauth()) {
        r = await doFetch();
        data = (r.headers.get('content-type') || '').includes('json') ? await r.json() : null;
      }
    }
    if (!r.ok) {
      if (r.status === 401 && state.me && !opts.noRedirect) { state.me = null; go('/entrar'); }
      throw new ApiError(r.status, messageOf(data, r.status), data);
    }
    return data;
  }
  function askReauth() {
    // Ações críticas da equipe exigem confirmar senha + código se o login tiver mais de 15 minutos.
    return new Promise(resolve => {
      const pass = h('input', { type: 'password', autocomplete: 'current-password' });
      const code = h('input', { inputmode: 'numeric', maxlength: '6', autocomplete: 'one-time-code' });
      const msg = h('div');
      const ok = h('button', { class: 'btn', type: 'submit' }, 'Confirmar');
      const cancel = h('button', { class: 'btn secondary', type: 'button' }, 'Cancelar');
      const box = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' }, h('form', { class: 'card dialog' },
        h('h2', { class: 'mt0', text: 'Confirme sua identidade' }),
        h('p', { class: 'muted', text: 'Esta é uma ação sensível. Digite sua senha e o código do autenticador.' }),
        msg, field('Senha', pass), field('Código do autenticador', code), h('div', { class: 'row' }, ok, cancel)));
      const close = v => { box.remove(); resolve(v); };
      cancel.addEventListener('click', () => close(false));
      box.querySelector('form').addEventListener('submit', async e => {
        e.preventDefault();
        ok.disabled = true;
        try { await api('POST', '/api/auth/reauth', { password: pass.value, code: code.value || null }, { noReauth: true }); close(true); }
        catch (err) { msg.replaceChildren(errorBox(err)); ok.disabled = false; }
      });
      document.body.append(box);
      pass.focus();
    });
  }
  function uploadWithProgress(path, form, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', path);
      xhr.setRequestHeader('X-CSRF-Token', cookie('cc_csrf'));
      xhr.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch { /* resposta não-JSON */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new ApiError(xhr.status, messageOf(data, xhr.status), data));
      };
      xhr.onerror = () => reject(new ApiError(0, 'Falha de conexão.'));
      xhr.send(form);
    });
  }
  async function downloadJson(path, filename) {
    const data = await api('GET', path);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = h('a', { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------------------------------------------------------------------------------- rotas
  const routes = [
    [/^\/entrar$/, viewLogin, { public: true }],
    [/^\/esqueci-senha$/, viewForgot, { public: true }],
    [/^\/convite$/, viewInvite, { public: true }],
    [/^\/redefinir-senha$/, viewReset, { public: true }],
    [/^\/$/, viewHome],
    [/^\/empresas$/, viewCompanies],
    [/^\/empresas\/(\d{14})$/, viewCompany],
    [/^\/documentos\/(\d+)$/, viewDocument],
    [/^\/obrigacoes$/, viewObligations],
    [/^\/obrigacoes\/(\d+)$/, viewObligation],
    [/^\/importar$/, viewImport, { perm: 'fiscal:import' }],
    [/^\/notificacoes$/, viewNotifications],
    [/^\/conta$/, viewAccount],
    [/^\/guias$/, viewGuides, { perm: 'guides:read' }],
    [/^\/enviar-documentos$/, viewSubmit, { perm: 'submissions:create' }],
    [/^\/recebidos$/, viewInbox, { perm: 'inbox:manage' }],
    [/^\/recebidos\/(\d+)$/, viewInboxItem, { perm: 'inbox:manage' }],
    [/^\/admin\/usuarios$/, viewAdminUsers, { perm: 'users:manage' }],
    [/^\/admin\/empresas\/nova$/, viewAdminNewCompany, { perm: 'companies:manage' }],
    [/^\/admin\/importar-empresas$/, viewAdminImport, { perm: 'companies:manage' }],
    [/^\/admin\/regras$/, viewAdminRules, { perm: 'obligation_rules:manage' }],
    [/^\/admin\/auditoria$/, viewAdminAudit, { perm: 'audit:read' }],
    [/^\/admin\/config$/, viewAdminConfig, { perm: 'notifications:manage' }],
  ];
  function go(path) { if (__demoPath() + __demoSearch() !== path) __demoNav('pushState', path); render(); }
  window.addEventListener('popstate', render);
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-link]');
    if (a && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); go(a.getAttribute('href')); }
  });

  async function loadMe() {
    try { state.me = await api('GET', '/api/auth/me', undefined, { noRedirect: true }); } catch { state.me = null; }
    return state.me;
  }
  async function render() {
    const path = __demoPath();
    const found = routes.find(([re]) => re.test(path));
    if (!found) { __demoNav('replaceState', '/'); return render(); }
    const [re, view, opts = {}] = found;
    const params = path.match(re).slice(1);
    if (opts.public) { $app.replaceChildren(publicShell(await safe(view, params))); return; }
    if (!state.me && !(await loadMe())) { __demoNav('replaceState', '/entrar'); return render(); }
    const main = h('main', { id: 'conteudo', tabindex: '-1' }, h('p', { class: 'muted', text: 'Carregando…' }));
    $app.replaceChildren(shell(main));
    if (opts.perm && !can(opts.perm)) { main.replaceChildren(h('div', { class: 'alert error', text: 'Você não tem permissão para esta área.' })); return; }
    main.replaceChildren(await safe(view, params));
    refreshUnread();
  }
  async function safe(view, params) {
    try { return await view(...params); } catch (e) { if (e.status === 401) return h('p'); return errorBox(e); }
  }

  // ------------------------------------------------------------------------------- moldura
  function applyTheme(t) { document.documentElement.dataset.theme = t; storage('cc-theme', t); }
  applyTheme(storage('cc-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const themeBtn = () => h('button', { type: 'button', 'aria-label': 'Alternar tema claro/escuro',
    onclick: () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') }, '◐');

  function shell(main) {
    const me = state.me;
    const nav = [];
    const item = (href, text) => {
      const active = href === '/' ? __demoPath() === '/' : __demoPath().startsWith(href);
      return link(href, text, active ? 'active' : null);
    };
    nav.push(item('/', 'Início'));
    if (me.user_type === 'client') {
      nav.push(item('/guias', 'Guias do Mês'));
      nav.push(item('/empresas', 'Minhas empresas'));
      nav.push(item('/enviar-documentos', 'Enviar documentos'));
    } else {
      nav.push(item('/empresas', me.user_type === 'employee' ? 'Minha carteira' : 'Empresas'));
      nav.push(item('/recebidos', 'Documentos recebidos'));
      nav.push(item('/guias', 'Guias do Mês'));
      if (can('fiscal:import')) nav.push(item('/importar', 'Importar PDF'));
    }
    nav.push(item('/obrigacoes', 'Obrigações'));
    nav.push(item('/notificacoes', 'Notificações'));
    if (me.user_type === 'admin') {
      nav.push(h('div', { class: 'group', text: 'Administração' }));
      nav.push(item('/admin/usuarios', 'Usuários e carteiras'));
      nav.push(item('/admin/importar-empresas', 'Importar empresas'));
      nav.push(item('/admin/regras', 'Modelos de obrigações'));
      nav.push(item('/admin/auditoria', 'Auditoria'));
      nav.push(item('/admin/config', 'Configurações'));
    }
    nav.push(h('div', { class: 'group', text: 'Conta' }));
    nav.push(item('/conta', 'Minha conta'));
    const bell = h('a', { href: '/notificacoes', 'data-link': true, class: 'icon bell', 'aria-label': 'Notificações' }, '🔔',
      state.unread ? h('span', { class: 'count', text: String(state.unread) }) : null);
    return h('div', {},
      h('header', { class: 'topbar' },
        h('a', { href: '/', 'data-link': true, class: 'brand' }, h('img', { src: 'static/logo.png', alt: '' }), 'Capital Compliance'),
        h('span', { class: 'spacer' }),
        h('span', { class: 'who', text: `${me.full_name} · ${TYPE_LABEL[me.user_type]}` }),
        bell, themeBtn(),
        h('button', { type: 'button', onclick: logout }, 'Sair')),
      h('div', { class: 'layout' }, h('nav', { class: 'sidebar', 'aria-label': 'Menu' }, nav), main));
  }
  function publicShell(content) {
    return h('div', { class: 'auth' }, h('div', { class: 'box' },
      h('div', { class: 'logo' }, h('img', { src: 'static/logo.png', alt: '' }), h('strong', { text: 'Capital Compliance' })),
      h('div', { class: 'card' }, content)));
  }
  async function refreshUnread() {
    try {
      const list = await api('GET', '/api/notifications?unread=true&limit=100');
      if (list.length !== state.unread) {
        state.unread = list.length;
        const bell = document.querySelector('.bell');
        if (bell) {
          bell.querySelector('.count')?.remove();
          if (state.unread) bell.append(h('span', { class: 'count', text: String(state.unread) }));
        }
      }
    } catch { /* silencioso */ }
  }
  async function logout() {
    try { await api('POST', '/api/auth/logout', undefined, { noRedirect: true }); } catch { /* já expirada */ }
    state.me = null; go('/entrar');
  }

  // ------------------------------------------------------------------------ telas públicas
  function viewLogin() {
    const box = h('div');
    const msg = h('div');
    const email = h('input', { type: 'email', autocomplete: 'username', required: true });
    const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Entrar');
    const form = h('form', { onsubmit: e => { e.preventDefault(); submit(); } },
      h('h1', { text: 'Entrar' }), msg, field('E-mail', email), field('Senha', pass), btn,
      h('p', { class: 'small' }, link('/esqueci-senha', 'Esqueci minha senha')));
    const submit = busy(btn, async () => {
      msg.replaceChildren();
      try {
        const r = await api('POST', '/api/auth/login', { email: email.value, password: pass.value });
        if (r.status === 'ok') return done(r);
        if (r.status === 'mfa_required') return box.replaceChildren(mfaStep(r.mfa_token));
        return box.replaceChildren(await mfaSetupStep(r.mfa_token));
      } catch (e) { msg.replaceChildren(errorBox(e)); }
    });
    box.append(form);
    return box;
  }
  function done(r) {
    state.me = r.user;
    if (r.recovery_codes) {
      $app.replaceChildren(publicShell(h('div', {}, h('h1', { text: 'Guarde seus códigos de recuperação' }),
        h('p', { text: 'Cada código pode ser usado uma única vez se você perder o celular. Guarde em local seguro; eles não serão mostrados de novo.' }),
        h('div', { class: 'codes' }, r.recovery_codes.map(c => h('div', { text: c }))),
        h('p', {}, h('button', { class: 'btn', type: 'button', onclick: () => go('/') }, 'Já guardei, continuar')))));
      return;
    }
    go('/');
  }
  function mfaStep(token) {
    const msg = h('div');
    const code = h('input', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', required: true });
    const rec = h('input', { autocomplete: 'off', placeholder: 'XXXXX-XXXXX' });
    const recField = field('Código de recuperação', rec);
    recField.hidden = true;
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Confirmar');
    const submit = busy(btn, async () => {
      msg.replaceChildren();
      try {
        const body = recField.hidden ? { mfa_token: token, code: code.value } : { mfa_token: token, recovery_code: rec.value };
        done(await api('POST', '/api/auth/login/mfa', body));
      } catch (e) { msg.replaceChildren(errorBox(e)); if (e.status === 401 && /expirada/.test(e.message)) setTimeout(() => go('/entrar'), 1500); }
    });
    return h('form', { onsubmit: e => { e.preventDefault(); submit(); } },
      h('h1', { text: 'Verificação em duas etapas' }), h('p', { class: 'muted', text: 'Digite o código de 6 dígitos do seu aplicativo autenticador.' }),
      msg, field('Código', code), recField, btn,
      h('p', { class: 'small' }, h('a', { href: '#', onclick: e => { e.preventDefault(); recField.hidden = false; code.required = false; } },
        'Perdi o celular: usar código de recuperação')));
  }
  async function mfaSetupStep(token) {
    const setup = await api('POST', '/api/auth/login/mfa-setup/start', { mfa_token: token });
    const msg = h('div');
    const code = h('input', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', required: true });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Ativar e entrar');
    const submit = busy(btn, async () => {
      msg.replaceChildren();
      try { done(await api('POST', '/api/auth/login/mfa-setup/confirm', { mfa_token: token, code: code.value })); }
      catch (e) { msg.replaceChildren(errorBox(e)); }
    });
    return h('form', { onsubmit: e => { e.preventDefault(); submit(); } },
      h('h1', { text: 'Ative a verificação em duas etapas' }),
      h('p', { class: 'muted', text: 'Obrigatória para o seu perfil. Escaneie o QR code com um aplicativo autenticador (Google Authenticator, Microsoft Authenticator…).' }),
      setup.qr_svg ? h('img', { class: 'qr', src: setup.qr_svg, alt: 'QR code para o aplicativo autenticador' }) : null,
      h('p', { class: 'small' }, 'Ou digite a chave: ', h('span', { class: 'mono', text: setup.secret })),
      msg, field('Código gerado pelo aplicativo', code), btn);
  }
  function viewForgot() {
    const msg = h('div');
    const email = h('input', { type: 'email', required: true });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Enviar instruções');
    const submit = busy(btn, async () => {
      try { const r = await api('POST', '/api/auth/password/forgot', { email: email.value }); msg.replaceChildren(h('div', { class: 'alert ok', text: r.message })); }
      catch (e) { msg.replaceChildren(errorBox(e)); }
    });
    return h('form', { onsubmit: e => { e.preventDefault(); submit(); } }, h('h1', { text: 'Esqueci minha senha' }), msg,
      field('E-mail cadastrado', email), btn, h('p', { class: 'small' }, link('/entrar', 'Voltar ao login')));
  }
  function takeToken() {
    // O token vem no fragmento (#token=...) e é retirado da barra de endereço logo após a leitura.
    const m = location.hash.match(/token=([\w-]+)/);
    if (m) { sessionStorage.setItem('cc-token', m[1]); __demoNav('replaceState', __demoPath()); }
    return m ? m[1] : sessionStorage.getItem('cc-token');
  }
  function passwordPair() {
    const p1 = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '12' });
    const p2 = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '12' });
    return { p1, p2, nodes: [field('Nova senha', p1, 'Mínimo de 12 caracteres.'), field('Repita a senha', p2)],
      check() { if (p1.value !== p2.value) throw new Error('As senhas não conferem.'); return p1.value; } };
  }
  async function viewInvite() {
    const token = takeToken();
    if (!token) return h('div', { class: 'alert error', text: 'Link de convite inválido.' });
    let info;
    try { info = await api('POST', '/api/auth/invite/inspect', { token }); }
    catch (e) { return h('div', {}, errorBox(e), link('/entrar', 'Ir para o login')); }
    const msg = h('div');
    const name = h('input', { value: info.full_name, required: true });
    const pw = passwordPair();
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Criar senha');
    const form = h('form', { onsubmit: e => { e.preventDefault(); submit(); } },
      h('h1', { text: 'Bem-vindo(a)!' }),
      h('p', {}, 'Acesso de ', h('strong', { text: info.email }), ` como ${TYPE_LABEL[info.user_type]}.`),
      info.companies.length ? h('p', { class: 'small muted', text: 'Empresas: ' + info.companies.join(', ') }) : null,
      msg, field('Seu nome', name), pw.nodes, btn);
    const submit = busy(btn, async () => {
      msg.replaceChildren();
      try {
        const r = await api('POST', '/api/auth/invite/accept', { token, password: pw.check(), full_name: name.value });
        sessionStorage.removeItem('cc-token');
        form.replaceChildren(h('div', { class: 'alert ok', text: 'Senha criada.' + (r.mfa_setup_required ? ' No primeiro acesso você vai ativar a verificação em duas etapas.' : '') }),
          link('/entrar', 'Entrar agora', 'btn'));
      } catch (e) { msg.replaceChildren(errorBox(e)); }
    });
    return form;
  }
  function viewReset() {
    const token = takeToken();
    const msg = h('div');
    const pw = passwordPair();
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Redefinir senha');
    const form = h('form', { onsubmit: e => { e.preventDefault(); submit(); } }, h('h1', { text: 'Nova senha' }), msg, pw.nodes, btn);
    const submit = busy(btn, async () => {
      msg.replaceChildren();
      try {
        await api('POST', '/api/auth/password/reset', { token, password: pw.check() });
        sessionStorage.removeItem('cc-token');
        form.replaceChildren(h('div', { class: 'alert ok', text: 'Senha redefinida. As outras sessões foram encerradas.' }), link('/entrar', 'Entrar', 'btn'));
      } catch (e) { msg.replaceChildren(errorBox(e)); }
    });
    if (!token) return h('div', { class: 'alert error', text: 'Link inválido.' });
    return form;
  }

  // ------------------------------------------------------------------------------- início
  async function viewHome() {
    const me = state.me;
    const out = h('div', {}, h('h1', { text: `Olá, ${me.full_name.split(' ')[0]}` }));
    const today = new Date();
    const ym = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const [notes, obs] = await Promise.all([
      api('GET', '/api/notifications?unread=true&limit=8').catch(() => []),
      api('GET', `/api/obligations?start=${ym(new Date(today.getFullYear(), today.getMonth() - 2, 1))}`).catch(() => []),
    ]);
    const upcoming = obs.filter(o => !['concluido', 'nao_aplicavel'].includes(o.status)).slice(0, 8);
    if (me.user_type === 'client') {
      out.append(h('p', { class: 'muted', text: 'Seus documentos, vencimentos e indicadores em um só lugar.' }));
      const g = await api('GET', '/api/guides').catch(() => ({ items: [] }));
      const relevant = g.items.filter(i => i.availability !== 'arquivada' && i.payment !== 'pago').slice(0, 4);
      if (relevant.length) out.append(h('div', { class: 'row between' }, h('h2', { text: 'Guias do mês' }), link('/guias', 'Ver todas')),
        h('div', { class: 'grid' }, relevant.map(guideCard)));
      for (const c of me.companies) out.append(await clientCompanyCard(c));
      if (!me.companies.length) out.append(h('div', { class: 'alert', text: 'Nenhuma empresa vinculada à sua conta. Fale com o escritório.' }));
    } else {
      out.append(h('div', { class: 'grid' },
        kpi(me.user_type === 'admin' ? 'Empresas' : 'Empresas na carteira', String(me.companies.length)),
        kpi('Obrigações em aberto (recentes)', String(upcoming.length)),
        kpi('Notificações não lidas', String(notes.length))));
    }
    out.append(h('h2', { text: 'Próximos vencimentos' }), obligationsTable(upcoming, true));
    out.append(h('h2', { text: 'Notificações recentes' }), notes.length ? notesList(notes) : h('p', { class: 'muted', text: 'Nenhuma notificação nova.' }));
    return out;
  }
  function kpi(label, value, hint) {
    return h('div', { class: 'card kpi' }, h('div', { class: 'label', text: label }),
      h('div', { class: 'value' }, value), hint ? h('div', { class: 'hint', text: hint }) : null);
  }
  async function clientCompanyCard(c) {
    const card = h('div', { class: 'card' }, h('div', { class: 'row between' },
      h('div', {}, h('h2', { class: 'm0',text: c.name }), h('div', { class: 'small muted', text: cnpj(c.cnpj) })),
      link(`/empresas/${c.cnpj}`, 'Abrir', 'btn secondary small')));
    const parts = h('div', { class: 'grid' });
    if (c.modules.includes('painel_fiscal')) {
      try {
        const s = await api('GET', `/api/companies/${c.cnpj}/fiscal/summary`);
        const last = s.months[s.months.length - 1];
        parts.append(kpi(`Receita ${last ? period(last.period) : ''}`, last ? money(last.revenue) : money(null)),
          kpi(`Acumulado ${s.ytd ? s.ytd.year : ''}`, s.ytd ? money(s.ytd.revenue) : money(null)),
          kpi('Apurado no período', last ? money(last.due) : money(null), 'Não indica pagamento nem saldo em aberto.'));
      } catch { /* módulo indisponível */ }
    }
    if (c.modules.includes('documentos')) {
      try {
        const docs = await api('GET', `/api/companies/${c.cnpj}/documents`);
        const fresh = docs.filter(d => d.status === 'available');
        parts.append(kpi('Documentos novos', String(fresh.length), fresh.length ? fresh.slice(0, 3).map(d => d.title).join(' · ') : 'Nada pendente de visualização.'));
      } catch { /* módulo indisponível */ }
    }
    card.append(parts);
    return card;
  }
  function notesList(notes) {
    return h('div', { class: 'stack' }, notes.map(n => h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('strong', { text: n.title }), h('span', { class: 'small muted', text: dateTime(n.created_at) })),
      h('div', { text: n.body }),
      n.link ? h('div', { class: 'small' }, link(n.link, 'Ver no portal')) : null)));
  }

  // ------------------------------------------------------------------------------ empresas
  async function viewCompanies() {
    if (state.me.user_type === 'admin') return viewAdminCompanies();
    const q = h('input', { type: 'search', placeholder: 'Razão social ou CNPJ', value: new URLSearchParams(__demoSearch()).get('q') || '' });
    const regime = h('select', {}, h('option', { value: '', text: 'Todos os regimes' }), REGIMES.map(r => h('option', { value: r, text: r })));
    const inactive = h('input', { type: 'checkbox' });
    const tableBox = h('div');
    const load = async () => {
      const params = new URLSearchParams();
      if (q.value) params.set('q', q.value);
      if (inactive.checked) params.set('include_inactive', 'true');
      let list = await api('GET', '/api/companies?' + params);
      if (regime.value) list = list.filter(c => c.regime === regime.value);
      tableBox.replaceChildren(h('p', { class: 'small muted', text: `${list.length} empresa(s)` }),
        h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Razão social', 'CNPJ', 'Regime', 'Início', 'Módulos'].map(t => h('th', { text: t })))),
          h('tbody', {}, list.map(c => h('tr', {},
            h('td', {}, link(`/empresas/${c.cnpj}`, c.name), c.is_active ? null : h('span', { class: 'badge', text: ' inativa' })),
            h('td', { class: 'nowrap mono', text: cnpj(c.cnpj) }), h('td', { text: c.regime }), h('td', { text: period(c.start) }),
            h('td', { class: 'small', text: c.modules.map(m => MODULES[m] || m).join(', ') || '—' })))))));
    };
    let timer;
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => load().catch(e => tableBox.replaceChildren(errorBox(e))), 250); });
    regime.addEventListener('change', load);
    inactive.addEventListener('change', load);
    await load();
    return h('div', {}, h('div', { class: 'row between' }, h('h1', { text: state.me.user_type === 'employee' ? 'Minha carteira' : 'Empresas' }),
      can('companies:manage') ? link('/admin/empresas/nova', '+ Nova empresa', 'btn') : null),
      h('div', { class: 'row' }, h('div', { class: 'field grow' }, q), h('div', { class: 'field' }, regime),
        state.me.user_type === 'admin' ? h('label', { class: 'check' }, inactive, 'Incluir inativas') : null),
      tableBox);
  }

  async function viewCompany(cnpjValue) {
    const c = await api('GET', `/api/companies/${cnpjValue}`);
    const tabs = [];
    const admin = can('companies:manage');
    if (c.modules.includes('painel_fiscal') || admin) tabs.push(['Painel Fiscal', () => fiscalTab(c)]);
    if (c.modules.includes('documentos') || admin) tabs.push(['Documentos', () => documentsTab(c)]);
    if (c.modules.includes('obrigacoes') || admin) tabs.push(['Obrigações', () => companyObligationsTab(c)]);
    if (admin) tabs.push(['Administração', () => adminCompanyTab(c)]);
    const body = h('div');
    const bar = h('div', { class: 'tabs', role: 'tablist' });
    const open = async i => {
      [...bar.children].forEach((b, j) => b.classList.toggle('active', i === j));
      body.replaceChildren(h('p', { class: 'muted', text: 'Carregando…' }));
      try { body.replaceChildren(await tabs[i][1]()); } catch (e) { body.replaceChildren(errorBox(e)); }
    };
    tabs.forEach(([t], i) => bar.append(h('button', { type: 'button', role: 'tab', onclick: () => open(i) }, t)));
    const head = h('div', {}, h('h1', { text: c.name }),
      h('div', { class: 'row small muted' }, h('span', { class: 'mono', text: cnpj(c.cnpj) }), h('span', { text: '·' }), h('span', { text: c.regime }),
        h('span', { text: `· acompanhamento desde ${period(c.start)}` }), c.is_active ? null : h('span', { class: 'badge bad', text: 'Inativa' })));
    if (!tabs.length) return h('div', {}, head, h('div', { class: 'alert', text: 'Nenhum módulo habilitado para esta empresa.' }));
    open(0);
    return h('div', {}, head, bar, body);
  }

  async function fiscalTab(c) {
    if (!c.modules.includes('painel_fiscal')) return h('div', { class: 'alert', text: 'Módulo Painel Fiscal desativado para esta empresa.' });
    const [s, records] = await Promise.all([api('GET', `/api/companies/${c.cnpj}/fiscal/summary`), api('GET', `/api/companies/${c.cnpj}/records`)]);
    const last = s.months[s.months.length - 1];
    const cmp = s.comparison;
    const out = h('div', {},
      h('div', { class: 'grid' },
        kpi(`Receita bruta ${last ? period(last.period) : ''}`, last ? money(last.revenue) : money(null)),
        kpi(`Receita acumulada ${s.ytd ? s.ytd.year : ''}`, s.ytd ? money(s.ytd.revenue) : money(null),
          s.ytd ? `${s.ytd.months_with_data} mês(es) com dados` : null),
        kpi('Apurado no último período', last ? money(last.due) : money(null), s.due_label),
        kpi('Variação da receita', cmp && cmp.variation_pct !== null ? `${cmp.variation_pct.toLocaleString('pt-BR')}%` : h('span', { class: 'na', text: 'Não informado' }),
          cmp ? `${period(cmp.period)} × ${period(cmp.previous_period)}` : null)),
      s.missing_periods.length ? h('div', { class: 'alert warn', text: `Competências sem informações: ${s.missing_periods.map(period).join(', ')}` }) : null,
      h('p', { class: 'small muted', text: `Última atualização: ${dateTime(s.last_update)}. Fonte: relatórios importados (PGDAS-D / Domínio) e lançamentos do escritório.` }),
      h('div', { class: 'row no-print' },
        h('button', { class: 'btn secondary small', type: 'button', onclick: () => print() }, 'Imprimir'),
        h('button', { class: 'btn secondary small', type: 'button', onclick: () => downloadJson(`/api/fiscal/export?cnpj=${c.cnpj}`, `fiscal-${c.cnpj}.json`).catch(e => toast(e.message, 'error')) }, 'Exportar dados'),
        can('fiscal:write') ? h('button', { class: 'btn small', type: 'button', onclick: () => manualForm(c, null, out) }, 'Lançar competência manualmente') : null));
    out.append(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', { text: 'Competência' }), h('th', { class: 'num', text: 'Receita bruta' }),
        h('th', { class: 'num', text: 'Apurado' }), h('th', { class: 'num', text: 'Receita (acumuladores)' }), h('th', { text: 'Origem' }))),
      h('tbody', {}, records.slice().reverse().map(({ record: r, meta }) => h('tr', {},
        h('td', {}, h('strong', { text: period(r.period) }), recordDetails(r)),
        h('td', { class: 'num' }, money(r.revenue)), h('td', { class: 'num' }, money(r.due)), h('td', { class: 'num' }, money(r.accum)),
        h('td', { class: 'small' }, r.source || '—',
          h('div', { class: 'muted', text: `${ORIGIN[meta.origin] || meta.origin}${meta.entered_by ? ' por ' + meta.entered_by : ''} · ${dateTime(meta.updated_at)}` }),
          can('fiscal:write') ? h('button', { class: 'btn small secondary no-print', type: 'button', onclick: () => manualForm(c, { record: r, meta }, out) }, 'Corrigir') : null)))))));
    if (!records.length) out.append(h('p', { class: 'muted', text: 'Nenhuma competência importada ainda.' }));
    out.append(await movementsSection(c, records.map(x => x.record.period)));
    return out;
  }
  const ORIGIN = { importacao: 'Importação automática', manual: 'Lançamento manual', migracao_legado: 'Migração histórica' };

  // -------------------------------------------------------------- lançamento manual (Etapa 2)
  async function manualForm(c, existing, container) {
    const layouts = await api('GET', '/api/fiscal/manual-layouts');
    const layoutKey = Object.keys(layouts).find(k => layouts[k].regimes.includes(c.regime));
    if (!layoutKey) { toast('Defina o regime tributário da empresa antes do lançamento manual.', 'error'); return; }
    const spec = layouts[layoutKey];
    const r = existing ? existing.record : {};
    const dec = cents => (cents === null || cents === undefined ? '' : (cents / 100).toFixed(2));
    const per = h('input', { type: 'month', value: r.period || '', required: true, disabled: !!existing });
    const revenue = h('input', { inputmode: 'decimal', value: dec(r.revenue), placeholder: '0,00' });
    const rbt12 = h('input', { inputmode: 'decimal', value: dec(r.rbt12), placeholder: '0,00' });
    const apuracao = h('select', {}, h('option', { value: 'mensal', text: 'Mensal' }), h('option', { value: 'trimestral', text: 'Trimestral' }));
    if (r.apuracao) apuracao.value = r.apuracao;
    const taxes = Object.fromEntries(spec.taxes.map(t => [t, h('input', { inputmode: 'decimal', value: dec((r.taxes || {})[t]), placeholder: '—' })]));
    const notes = h('textarea', { value: r.review || '' });
    const justification = h('input', { placeholder: 'Obrigatória para corrigir uma competência existente' });
    const msg = h('div');
    const btn = h('button', { class: 'btn', type: 'submit' }, existing ? 'Salvar correção' : 'Salvar lançamento');
    // Aceita "1.234,56" ou "1234.56": envia texto decimal (o servidor converte com Decimal).
    const norm = v => { v = (v || '').trim(); if (!v) return null; return v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v; };
    const box = h('form', { class: 'card' }, h('h3', { class: 'mt0', text: existing ? `Corrigir competência ${period(r.period)}` : 'Lançar competência manualmente' }),
      h('p', { class: 'small muted', text: `${spec.label}. Campos vazios ficam "não informado" (não viram zero). O total apurado é a soma dos tributos e não indica pagamento.` }),
      msg, h('div', { class: 'form-grid' }, field('Competência', per), field('Receita do mês (R$)', revenue),
        layoutKey === 'simples' ? field('Receita bruta acumulada 12 meses — RBT12 (R$)', rbt12) : field('Periodicidade da apuração', apuracao)),
      h('h3', { text: layoutKey === 'simples' ? 'Composição do DAS (R$)' : 'Tributos apurados (R$)' }),
      h('div', { class: 'form-grid' }, spec.taxes.map(t => field(t, taxes[t]))),
      field('Observações', notes), existing ? field('Justificativa da alteração', justification) : null,
      h('div', { class: 'row' }, btn, h('button', { class: 'btn secondary', type: 'button', onclick: () => box.remove() }, 'Cancelar')));
    box.addEventListener('submit', busy(btn, async e => {
      e && e.preventDefault && e.preventDefault();
      msg.replaceChildren();
      try {
        const body = { period: existing ? r.period : per.value, layout: layoutKey, revenue: norm(revenue.value), notes: notes.value || null,
          taxes: Object.fromEntries(spec.taxes.map(t => [t, norm(taxes[t].value)]).filter(([, v]) => v !== null)) };
        if (layoutKey === 'simples') body.rbt12 = norm(rbt12.value); else body.apuracao = apuracao.value;
        if (existing) { body.replace = true; body.justification = justification.value; }
        await api('POST', `/api/companies/${c.cnpj}/records/manual`, body);
        toast('Competência gravada.'); render();
      } catch (err) { msg.replaceChildren(errorBox(err)); }
    }));
    box.addEventListener('submit', e => e.preventDefault(), { capture: true });
    container.prepend(box);
    box.scrollIntoView();
  }

  // ----------------------------------------------------- movimentos por acumulador (Etapa 2)
  async function movementsSection(c, periods) {
    const sec = h('div', {}, h('h2', { text: 'Movimentos por acumulador' }),
      h('p', { class: 'small muted', text: 'Dados do Resumo por Acumulador do Domínio. Seções não são somadas entre si e saída não é automaticamente receita.' }));
    if (!periods.length) { sec.append(h('p', { class: 'muted', text: 'Sem competências importadas.' })); return sec; }
    const sorted = periods.slice().sort();
    const start = h('input', { type: 'month', value: sorted[0] });
    const end = h('input', { type: 'month', value: sorted[sorted.length - 1] });
    const section = h('select', {}, h('option', { value: '', text: 'Todas as seções' }), ['ENTRADAS', 'SAÍDAS', 'SERVIÇOS'].map(s => h('option', { value: s, text: s })));
    const code = h('input', { placeholder: 'Código' });
    const q = h('input', { type: 'search', placeholder: 'Descrição' });
    const listBox = h('div');
    const loadList = async () => {
      const p = new URLSearchParams({ start: start.value, end: end.value, sort: 'period' });
      if (section.value) p.set('section', section.value);
      if (code.value) p.set('code', code.value.trim());
      if (q.value) p.set('q', q.value);
      const rows = await api('GET', `/api/companies/${c.cnpj}/fiscal/movements?${p}`);
      listBox.replaceChildren(rows.length ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Competência', 'Seção', 'Acumulador', 'Descrição', 'Valor', 'Origem'].map((t, i) => h('th', { class: i === 4 ? 'num' : null, text: t })))),
        h('tbody', {}, rows.map(r => h('tr', {}, h('td', { text: period(r.period) }), h('td', { text: r.section }), h('td', { class: 'mono', text: r.code }),
          h('td', { text: r.description }), h('td', { class: 'num', text: moneyText(r.amount) }),
          h('td', { class: 'small', text: `${ORIGIN[r.origin] || r.origin} · ${r.source || ''}` })))))) : h('p', { class: 'muted', text: 'Nenhum movimento com esses filtros.' }));
    };
    [start, end, section].forEach(el => el.addEventListener('change', () => loadList().catch(e => listBox.replaceChildren(errorBox(e)))));
    let t; [code, q].forEach(el => el.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => loadList().catch(e => listBox.replaceChildren(errorBox(e))), 300); }));
    // comparação
    const checks = sorted.map(p => ({ p, el: h('input', { type: 'checkbox', checked: sorted.slice(-2).includes(p) }) }));
    const cmpSection = h('select', {}, ['SAÍDAS', 'ENTRADAS', 'SERVIÇOS'].map(s => h('option', { value: s, text: s })));
    const cmpBox = h('div');
    const cmpBtn = h('button', { class: 'btn small', type: 'button' }, 'Comparar');
    cmpBtn.addEventListener('click', busy(cmpBtn, async () => {
      const sel = checks.filter(x => x.el.checked).map(x => x.p);
      const p = new URLSearchParams({ section: cmpSection.value });
      sel.forEach(x => p.append('periods', x));
      const data = await api('GET', `/api/companies/${c.cnpj}/fiscal/movements/compare?${p}`);
      cmpBox.replaceChildren(compareView(data));
    }));
    await loadList();
    sec.append(h('div', { class: 'form-grid' }, field('De', start), field('Até', end), field('Seção', section), field('Código', code), field('Descrição', q)), listBox,
      h('h3', { text: 'Comparar competências' }),
      h('div', { class: 'card' }, h('div', { class: 'row' }, checks.map(x => h('label', { class: 'check' }, x.el, period(x.p)))),
        h('div', { class: 'row' }, field('Seção', cmpSection), cmpBtn)), cmpBox);
    return sec;
  }
  function pctText(d) {
    if (d.pct === null) return h('span', { class: 'na', text: d.note === 'base zero' ? 'base zero' : 'sem dado' });
    return h('span', { class: d.pct >= 0 ? 'pos' : 'neg', text: `${d.pct > 0 ? '+' : ''}${d.pct.toLocaleString('pt-BR')}%` });
  }
  function compareView(data) {
    if (!data.sections.length) return h('p', { class: 'muted', text: 'Nenhum movimento nessas competências.' });
    const s = data.sections[0];
    const ps = data.periods;
    const out = h('div');
    if (data.missing_periods.length) out.append(h('div', { class: 'alert warn', text: `Sem relatório de acumuladores em: ${data.missing_periods.map(period).join(', ')} (não informado ≠ zero).` }));
    const head = ['Acumulador', ...ps.map(period), ...ps.slice(1).map((p, i) => `Variação ${period(ps[i])}→${period(p)}`)];
    const selected = new Set();
    const chartBox = h('div');
    const drawChart = () => chartBox.replaceChildren(lineChart(ps, selected.size ? s.rows.filter(r => selected.has(r.code)).map(r => ({ label: `${r.code} ${r.description}`, values: r.values }))
      : [{ label: `Total ${s.section}`, values: s.totals }]));
    out.append(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, head.map((t, i) => h('th', { class: i ? 'num' : null, text: t })))),
      h('tbody', {}, s.rows.map(r => {
        const cb = h('input', { type: 'checkbox', 'aria-label': `Mostrar ${r.code} no gráfico` });
        cb.addEventListener('change', () => { if (cb.checked) selected.add(r.code); else selected.delete(r.code); drawChart(); });
        return h('tr', {}, h('td', {}, cb, ' ', h('span', { class: 'mono', text: r.code }), ` ${r.description}`, r.description_changed ? h('span', { class: 'badge warn', text: 'descrição mudou' }) : null),
          ps.map(p => h('td', { class: 'num' }, r.values[p] === null ? h('span', { class: 'na', text: 'não informado' }) : moneyText(r.values[p]))),
          r.diffs.map(d => h('td', { class: 'num' }, d.abs === null ? h('span', { class: 'na', text: '—' }) : moneyText(d.abs), ' ', pctText(d))));
      }), h('tr', {}, h('td', {}, h('strong', { text: `Total ${s.section}` })),
        ps.map(p => h('td', { class: 'num' }, h('strong', {}, s.totals[p] === null ? 'não informado' : moneyText(s.totals[p])))),
        s.total_diffs.map(d => h('td', { class: 'num' }, pctText(d))))))));
    out.append(h('p', { class: 'small muted', text: 'Marque acumuladores para vê-los no gráfico (sem seleção: total da seção).' }), chartBox);
    drawChart();
    return out;
  }
  function svg(tag, attrs, ...kids) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    kids.flat().forEach(k => k && el.append(k instanceof Node ? k : document.createTextNode(String(k))));
    return el;
  }
  function lineChart(periods, series) {
    const W = 760, H = 260, L = 80, R = 20, T = 16, B = 34;
    const vals = series.flatMap(s => periods.map(p => s.values[p]).filter(v => v !== null && v !== undefined));
    const max = Math.max(1, ...vals);
    const x = i => L + (periods.length === 1 ? 0 : i * (W - L - R) / (periods.length - 1));
    const y = v => T + (H - T - B) * (1 - v / max);
    const g = svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Evolução por competência' },
      svg('line', { class: 'axis', x1: L, y1: H - B, x2: W - R, y2: H - B }),
      [0, 0.5, 1].map(f => svg('text', { x: 4, y: y(max * f) + 4 }, moneyText(Math.round(max * f)))),
      periods.map((p, i) => svg('text', { x: x(i) - 18, y: H - 10 }, period(p))));
    series.slice(0, 6).forEach((s, idx) => {
      // Quebra a linha onde não há dado (não liga pontos por cima de um "não informado").
      let segment = [];
      const flush = () => { if (segment.length > 1) g.append(svg('polyline', { class: `swatch-${idx}`, points: segment.join(' ') })); segment = []; };
      periods.forEach((p, i) => {
        const v = s.values[p];
        if (v === null || v === undefined) { flush(); return; }
        segment.push(`${x(i)},${y(v)}`);
        g.append(svg('circle', { class: `swatch-${idx}`, cx: x(i), cy: y(v), r: 3 }));
      });
      flush();
    });
    return h('div', {}, g, h('div', { class: 'legend' }, series.slice(0, 6).map((s, i) => h('span', {}, h('i', { class: `swatch-${i}` }), s.label))));
  }
  function recordDetails(r) {
    const taxes = Object.entries(r.taxes || {});
    const movs = r.movements || [];
    if (!taxes.length && !movs.length && !r.review) return null;
    return h('details', { class: 'small' }, h('summary', {}, 'detalhes'),
      taxes.length ? h('table', {}, h('tbody', {}, TAX.filter(t => r.taxes[t] !== undefined).map(t => h('tr', {}, h('td', { text: t }), h('td', { class: 'num', text: moneyText(r.taxes[t]) }))))) : null,
      movs.length ? h('table', {}, h('tbody', {}, movs.map(m => h('tr', {}, h('td', { text: m.section }), h('td', { class: 'mono', text: m.code }),
        h('td', { text: m.description }), h('td', { class: 'num', text: moneyText(m.amount) }))))) : null,
      r.review ? h('p', { class: 'muted', text: r.review }) : null);
  }

  // ----------------------------------------------------------------------------- documentos
  async function loadDocTypes() {
    if (!Object.keys(state.docTypes).length) state.docTypes = (await api('GET', '/api/documents/catalog')).doc_types;
    return state.docTypes;
  }
  async function documentsTab(c) {
    if (!c.modules.includes('documentos')) return h('div', { class: 'alert', text: 'Módulo Documentos desativado para esta empresa.' });
    const types = await loadDocTypes();
    const listBox = h('div');
    const periodFilter = h('input', { type: 'month' });
    const showArchived = h('input', { type: 'checkbox' });
    const load = async () => {
      const p = new URLSearchParams();
      if (periodFilter.value) p.set('period', periodFilter.value);
      if (showArchived.checked) p.set('include_archived', 'true');
      const docs = await api('GET', `/api/companies/${c.cnpj}/documents?${p}`);
      listBox.replaceChildren(docs.length ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Documento', 'Tipo', 'Competência', 'Status', 'Disponível em', ''].map(t => h('th', { text: t })))),
        h('tbody', {}, docs.map(d => h('tr', {},
          h('td', {}, link(`/documentos/${d.id}`, d.title), d.file ? h('div', { class: 'small muted', text: `${d.file.original_name} · ${bytes(d.file.size_bytes)}` }) : null),
          h('td', { text: types[d.doc_type] || d.doc_type }), h('td', { text: period(d.period) }), h('td', {}, badge(DOC_STATUS, d.status)),
          h('td', { class: 'small', text: dateTime(d.available_at) }),
          h('td', {}, d.file ? h('a', { class: 'btn small', href: `/api/documents/${d.id}/download`, download: '' }, 'Baixar') : null))))))
        : h('p', { class: 'muted', text: 'Nenhum documento.' }));
    };
    periodFilter.addEventListener('change', load);
    showArchived.addEventListener('change', load);
    await load();
    return h('div', {}, can('documents:upload') ? uploadBox(c, types, load) : null,
      h('div', { class: 'row' }, h('div', { class: 'field' }, h('label', {}, 'Competência', periodFilter)),
        isStaff() ? h('label', { class: 'check' }, showArchived, 'Mostrar arquivados') : null),
      listBox);
  }
  const TAX_OPTIONS = { DAS: 'DAS — Simples Nacional', DCTFWEB: 'DARF DCTFWeb', FGTS: 'FGTS Digital', DARF: 'DARF', GPS: 'GPS', ICMS: 'ICMS', ISS: 'ISS', OUTRO: 'Outro' };
  function uploadBox(c, types, onDone) {
    const type = h('select', {}, Object.entries(types).map(([k, v]) => h('option', { value: k, text: v })));
    const per = h('input', { type: 'month' });
    const tax = h('select', {}, h('option', { value: '', text: '— informe o tributo —' }), Object.entries(TAX_OPTIONS).map(([k, v]) => h('option', { value: k, text: v })));
    const amount = h('input', { inputmode: 'decimal', placeholder: 'Opcional (DAS usa o valor do PGDAS-D)' });
    const guideFields = h('div', { class: 'form-grid' }, field('Tributo da guia', tax), field('Valor (R$)', amount));
    const syncGuide = () => { guideFields.hidden = type.value !== 'guia'; };
    type.addEventListener('change', syncGuide);
    syncGuide();
    const input = h('input', { type: 'file', multiple: true, hidden: true });
    const drop = h('div', { class: 'drop', tabindex: '0', role: 'button', onclick: () => input.click(),
      onkeydown: e => (e.key === 'Enter' || e.key === ' ') && input.click() }, 'Arraste arquivos aqui ou clique para escolher (PDF, XML, XLSX, CSV, imagens…)');
    const progress = h('progress', { max: '1', value: '0', hidden: true });
    const result = h('div');
    const send = async files => {
      if (!files.length) return;
      const form = new FormData();
      [...files].forEach(f => form.append('files', f));
      form.append('doc_type', type.value);
      if (per.value) form.append('period', per.value);
      if (type.value === 'guia') {
        if (tax.value) form.append('tax_code', tax.value);
        const a = amount.value.trim();
        if (a) form.append('amount', a.includes(',') ? a.replace(/\./g, '').replace(',', '.') : a);
      }
      progress.hidden = false; progress.value = 0;
      try {
        const r = await uploadWithProgress(`/api/companies/${c.cnpj}/documents`, form, v => { progress.value = v; });
        const linkInfo = x => {
          if (!x.link) return null;
          if (x.link.linked) return h('div', { class: 'small alert ok', text: `${x.file}: vinculada automaticamente à obrigação #${x.link.linked}.` });
          return h('div', { class: 'small alert warn' }, `${x.file}: não vinculada (${x.link.reason || 'sem correspondência'}). `,
            link(`/documentos/${x.document_id}`, 'Vincular manualmente'));
        };
        result.replaceChildren(h('div', { class: `alert ${r.failed ? 'warn' : 'ok'}`, text: `${r.uploaded} enviado(s), ${r.failed} com problema.` }),
          r.results.filter(x => !x.ok).map(x => h('div', { class: 'small alert error', text: x.error })),
          r.results.filter(x => x.ok).map(linkInfo));
        await onDone();
      } catch (e) { result.replaceChildren(errorBox(e)); } finally { progress.hidden = true; input.value = ''; }
    };
    input.addEventListener('change', () => send(input.files));
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); send(e.dataTransfer.files); });
    return h('div', { class: 'card' }, h('h3', { class: 'mt0', text: 'Enviar documentos' }),
      h('div', { class: 'form-grid' }, field('Tipo', type), field('Competência', per, 'Obrigatória para vincular guias')), guideFields,
      drop, input, progress, result);
  }
  async function viewDocument(id) {
    const d = await api('GET', `/api/documents/${id}`);
    const types = await loadDocTypes();
    const out = h('div', {}, h('p', { class: 'small' }, link(`/empresas/${d.company}`, '← Voltar à empresa')),
      h('h1', { text: d.title }),
      h('div', { class: 'row' }, badge(DOC_STATUS, d.status), h('span', { class: 'muted', text: `${types[d.doc_type] || d.doc_type} · competência ${period(d.period)}` })),
      d.rejection_reason ? h('div', { class: 'alert error', text: d.rejection_reason }) : null,
      h('div', { class: 'card' },
        d.file ? h('div', {}, h('p', {}, h('strong', { text: d.file.original_name }), ` · ${bytes(d.file.size_bytes)} · versão ${d.current_version}`),
          h('p', { class: 'small muted' }, 'SHA-256: ', h('span', { class: 'mono', text: d.file.sha256 })),
          h('a', { class: 'btn', href: `/api/documents/${d.id}/download`, download: '' }, 'Baixar')) : h('p', { class: 'muted', text: 'Arquivo indisponível.' }),
        h('p', { class: 'small muted', text: d.retention })));
    if (d.versions) {
      out.append(h('h2', { text: 'Versões e acessos do cliente' }), h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Versão', 'Arquivo', 'Status', 'Antivírus', 'Enviado', 'Cliente visualizou', 'Cliente baixou', ''].map(t => h('th', { text: t })))),
        h('tbody', {}, d.versions.map(v => h('tr', {}, h('td', { text: String(v.version) }), h('td', { text: v.original_name }), h('td', { text: v.status }),
          h('td', { text: { clean: 'limpo', infected: 'bloqueado', not_scanned: 'não verificado' }[v.scan_status] || v.scan_status }),
          h('td', { class: 'small', text: dateTime(v.uploaded_at) }), h('td', { class: 'small', text: dateTime(v.client_viewed_at) }),
          h('td', { class: 'small', text: dateTime(v.client_downloaded_at) }),
          h('td', {}, v.status !== 'rejected' ? h('a', { class: 'btn small secondary', href: `/api/documents/${d.id}/download?version=${v.version}`, download: '' }, 'Baixar') : null)))))));
    }
    if (d.doc_type === 'guia' && can('guides:manage')) out.append(await guideLinkCard(d));
    if (can('documents:upload') && d.status !== 'archived') {
      const file = h('input', { type: 'file' });
      const confirm = h('input', { type: 'checkbox' });
      const btn = h('button', { class: 'btn', type: 'button' }, 'Enviar nova versão');
      btn.addEventListener('click', busy(btn, async () => {
        if (!file.files[0]) throw new Error('Escolha o arquivo.');
        const form = new FormData();
        form.append('file', file.files[0]);
        form.append('confirm_replace', confirm.checked ? 'true' : 'false');
        await uploadWithProgress(`/api/documents/${d.id}/versions`, form, () => {});
        toast('Nova versão enviada.'); render();
      }));
      const archiveReason = h('input', { placeholder: 'Motivo (opcional)' });
      const archiveBtn = h('button', { class: 'btn danger', type: 'button' }, 'Arquivar');
      archiveBtn.addEventListener('click', busy(archiveBtn, async () => {
        if (!window.confirm('Arquivar este documento? Ele deixa de aparecer para o cliente, mas o arquivo e o histórico são mantidos.')) return;
        await api('POST', `/api/documents/${d.id}/archive`, { reason: archiveReason.value || null });
        toast('Documento arquivado.'); render();
      }));
      out.append(h('div', { class: 'card' }, h('h3', { class: 'mt0',text: 'Substituir arquivo' }), file,
        h('label', { class: 'check' }, confirm, 'Confirmo a substituição (a versão atual fica no histórico)'), btn),
        h('div', { class: 'card' }, h('h3', { class: 'mt0',text: 'Arquivar' }), archiveReason, h('p'), archiveBtn));
    }
    return out;
  }

  async function guideLinkCard(d) {
    const s = await api('GET', `/api/documents/${d.id}/obligation-suggestions`);
    const card = h('div', { class: 'card' }, h('h3', { class: 'mt0', text: 'Guia: vínculo e pagamento' }),
      h('p', {}, `Tributo: ${d.tax_code || 'não informado'} · Valor: `, money(d.amount),
        d.amount_source ? h('span', { class: 'small muted', text: d.amount_source === 'pgdas' ? ' (do PGDAS-D importado)' : ' (informado pelo escritório)' }) : null),
      s.linked.length ? h('p', {}, 'Vinculada à(s) obrigação(ões): ', s.linked.map(id => link(`/obrigacoes/${id}`, `#${id} `)))
        : h('div', { class: 'alert warn', text: 'Ainda não vinculada a uma obrigação.' }));
    if (s.hint && (s.hint.tax_code || s.hint.period)) card.append(h('p', { class: 'small muted', text: `Indício pelo nome do arquivo (não usado automaticamente): ${s.hint.tax_code || '?'} ${s.hint.period ? period(s.hint.period) : ''}` }));
    const options = s.items.filter(i => !s.linked.includes(i.id));
    if (options.length) {
      const sel = h('select', {}, options.map(o => h('option', { value: o.id, text: `${o.match ? '★ ' : ''}${o.name} — ${period(o.period)}${o.due_date ? ' — vence ' + day(o.due_date) : ''}` })));
      const btn = h('button', { class: 'btn small', type: 'button' }, 'Vincular');
      btn.addEventListener('click', busy(btn, async () => { await api('POST', `/api/documents/${d.id}/link-obligation`, { obligation_id: +sel.value }); toast('Guia vinculada.'); render(); }));
      card.append(h('div', { class: 'row' }, sel, btn));
    }
    const note = h('input', { placeholder: 'Fonte da confirmação (ex.: comprovante recebido)' });
    const paid = h('button', { class: 'btn small secondary', type: 'button' }, d.payment === 'pago' ? 'Desfazer confirmação de pagamento' : 'Registrar pagamento confirmado');
    paid.addEventListener('click', busy(paid, async () => {
      await api('PATCH', `/api/documents/${d.id}/payment`, d.payment === 'pago' ? { status: 'nao_informado' } : { status: 'pago', note: note.value });
      toast('Situação de pagamento atualizada.'); render();
    }));
    card.append(h('p', { class: 'small' }, 'Pagamento: ', h('strong', { text: d.payment === 'pago' ? 'confirmado pelo escritório' : 'não informado' }),
      '. Baixar a guia ou passar o vencimento não marca como paga.'), d.payment === 'pago' ? null : note, h('p'), paid);
    return card;
  }

  // ----------------------------------------------------------------------------- obrigações
  function obligationsTable(list, showCompany) {
    if (!list.length) return h('p', { class: 'muted', text: 'Nenhuma obrigação.' });
    return h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, [showCompany ? 'Empresa' : null, 'Obrigação', 'Competência', 'Vencimento', 'Status'].filter(Boolean).map(t => h('th', { text: t })))),
      h('tbody', {}, list.map(o => h('tr', {},
        showCompany ? h('td', { class: 'small', text: o.company_name }) : null,
        h('td', {}, link(`/obrigacoes/${o.id}`, o.name)), h('td', { text: period(o.period) }),
        h('td', {}, o.due_date ? day(o.due_date) : h('span', { class: 'na', text: o.due_note || 'Prazo a confirmar' })),
        h('td', {}, badge(OB_STATUS, o.status)))))));
  }
  async function viewObligations() {
    const start = h('input', { type: 'month' });
    const end = h('input', { type: 'month' });
    const status = h('select', {}, h('option', { value: '', text: 'Todos' }), Object.entries(OB_STATUS).map(([k, [t]]) => h('option', { value: k, text: t })));
    const regime = h('select', {}, h('option', { value: '', text: 'Todos' }), REGIMES.map(r => h('option', { value: r, text: r })));
    const box = h('div');
    const load = async () => {
      const p = new URLSearchParams();
      if (start.value) p.set('start', start.value);
      if (end.value) p.set('end', end.value);
      if (status.value) p.set('status', status.value);
      if (regime.value) p.set('regime', regime.value);
      box.replaceChildren(obligationsTable(await api('GET', '/api/obligations?' + p), true));
    };
    [start, end, status, regime].forEach(el => el.addEventListener('change', () => load().catch(e => box.replaceChildren(errorBox(e)))));
    await load();
    return h('div', {}, h('h1', { text: 'Obrigações e vencimentos' }),
      h('p', { class: 'small muted', text: 'Prazos vêm de regras validadas pelo escritório. O calendário não substitui a conferência contábil.' }),
      h('div', { class: 'form-grid' }, field('De', start), field('Até', end), field('Status', status), state.me.user_type !== 'client' ? field('Regime', regime) : null), box);
  }
  async function companyObligationsTab(c) {
    if (!c.modules.includes('obrigacoes')) return h('div', { class: 'alert', text: 'Módulo Obrigações desativado para esta empresa.' });
    const list = await api('GET', `/api/obligations?cnpj=${c.cnpj}`);
    const out = h('div', {}, obligationsTable(list, false));
    if (can('obligations:manage')) {
      const name = h('input', { required: true });
      const per = h('input', { type: 'month', required: true });
      const due = h('input', { type: 'date' });
      const notes = h('textarea', {});
      const btn = h('button', { class: 'btn', type: 'submit' }, 'Criar obrigação');
      const form = h('form', { class: 'card', onsubmit: e => { e.preventDefault(); submit(); } }, h('h3', { class: 'mt0',text: 'Obrigação específica da empresa' }),
        h('div', { class: 'form-grid' }, field('Nome', name), field('Competência', per), field('Vencimento', due, 'Em branco: "prazo a confirmar"')),
        field('Observações internas (não aparecem para o cliente)', notes), btn);
      const submit = busy(btn, async () => {
        await api('POST', `/api/companies/${c.cnpj}/obligations`, { name: name.value, period: per.value, due_date: due.value || null, internal_notes: notes.value || null });
        toast('Obrigação criada.'); render();
      });
      out.append(form);
    }
    return out;
  }
  async function viewObligation(id) {
    const o = await api('GET', `/api/obligations/${id}`);
    const out = h('div', {}, h('p', { class: 'small' }, link(`/empresas/${o.company}`, `← ${o.company_name}`)),
      h('h1', { text: o.name }),
      h('div', { class: 'row' }, badge(OB_STATUS, o.status), h('span', { class: 'muted', text: `Competência ${period(o.period)}` })),
      h('div', { class: 'card' },
        h('p', {}, 'Vencimento: ', o.due_date ? h('strong', { text: day(o.due_date) }) : h('span', { class: 'na', text: o.due_note })),
        o.client_note ? h('p', { text: o.client_note }) : null,
        o.rule ? h('p', { class: 'small muted', text: `Regra ${o.rule.code} v${o.rule.version} — fonte: ${o.rule.legal_source}` }) : null,
        o.documents.length ? h('p', {}, 'Documentos: ', o.documents.map(d => link(`/documentos/${d}`, `#${d} `))) : null));
    if (can('obligations:manage')) {
      const status = h('select', {}, Object.entries(OB_STATUS).filter(([k]) => k !== 'vencido').map(([k, [t]]) => h('option', { value: k, text: t })));
      status.value = o.stored_status;
      const due = h('input', { type: 'date', value: o.due_date || '' });
      const notes = h('textarea', { value: o.internal_notes || '' });
      const clientNote = h('textarea', { value: o.client_note || '' });
      const docs = h('input', { value: o.documents.join(', '), placeholder: 'IDs separados por vírgula' });
      const btn = h('button', { class: 'btn', type: 'submit' }, 'Salvar');
      const mine = h('button', { class: 'btn secondary', type: 'button' }, 'Assumir responsabilidade');
      mine.addEventListener('click', busy(mine, async () => { await api('PATCH', `/api/obligations/${o.id}`, { responsible_user_id: state.me.id }); toast('Responsável atualizado.'); render(); }));
      const form = h('form', { class: 'card', onsubmit: e => { e.preventDefault(); submit(); } }, h('h3', { class: 'mt0',text: 'Atualizar' }),
        h('div', { class: 'form-grid' }, field('Status', status), field('Vencimento', due)),
        field('Observações internas', notes), field('Recado para o cliente', clientNote), field('Documentos associados', docs),
        h('p', { class: 'small muted', text: o.responsible_user_id ? `Responsável: usuário #${o.responsible_user_id}` : 'Sem responsável.' }),
        h('div', { class: 'row' }, btn, mine));
      const submit = busy(btn, async () => {
        const body = { status: status.value, internal_notes: notes.value, client_note: clientNote.value,
          document_ids: docs.value.split(',').map(s => parseInt(s, 10)).filter(n => !Number.isNaN(n)) };
        if (due.value) body.due_date = due.value; else if (o.due_date) body.clear_due_date = true;
        await api('PATCH', `/api/obligations/${o.id}`, body);
        toast('Obrigação atualizada.'); render();
      });
      out.append(form);
    }
    return out;
  }

  // ------------------------------------------------------------------------------ importar
  function viewImport() {
    const input = h('input', { type: 'file', accept: 'application/pdf' });
    const box = h('div');
    const btn = h('button', { class: 'btn', type: 'button' }, 'Ler PDF');
    btn.addEventListener('click', busy(btn, async () => {
      if (!input.files[0]) throw new Error('Escolha um PDF.');
      const form = new FormData();
      form.append('file', input.files[0]);
      box.replaceChildren(h('p', { class: 'muted', text: 'Lendo…' }));
      try { showPreview(box, await uploadWithProgress('/api/imports/preview', form, () => {})); } catch (e) { box.replaceChildren(errorBox(e)); }
    }));
    return h('div', {}, h('h1', { text: 'Importar relatório (PDF)' }),
      h('p', { class: 'muted', text: 'Formatos suportados: extrato do PGDAS-D e Resumo por Acumulador do Domínio (PDF com texto, uma competência). PDFs em imagem exigem lançamento manual.' }),
      h('div', { class: 'card row' }, input, btn), box);
  }
  function showPreview(box, p) {
    const r = p.record;
    const replace = h('input', { type: 'checkbox' });
    const btn = h('button', { class: 'btn', type: 'button' }, 'Confirmar e gravar');
    btn.addEventListener('click', busy(btn, async () => {
      const res = await api('POST', `/api/companies/${r.company}/records`, { record: r, replace: replace.checked,
        parser_name: p.parser_name, parser_version: p.parser_version });
      box.replaceChildren(h('div', { class: 'alert ok' }, `Competência ${period(r.period)} gravada (${res.status === 'created' ? 'nova' : res.status === 'replaced' ? 'substituída' : 'sem alterações'}). `,
        link(`/empresas/${r.company}`, 'Ver empresa')));
    }));
    box.replaceChildren(h('div', { class: 'card' },
      h('h2', { class: 'mt0',text: `Prévia — ${cnpj(r.company)} · ${period(r.period)}` }),
      h('p', { class: 'small muted', text: `Leitor ${p.parser_name} ${p.parser_version}. ${p.note}` }),
      p.already_exists ? h('div', { class: 'alert warn' }, 'Esta competência já existe. ', h('label', { class: 'check' }, replace, 'Substituir (a versão atual vai para o histórico)')) : null,
      h('div', { class: 'grid' }, kpi('Receita bruta', money(r.revenue)), kpi('Apurado', money(r.due), 'Não indica pagamento.'), kpi('Receita (acumuladores)', money(r.accum))),
      recordDetails(r) || h('p'), r.review ? h('div', { class: 'alert', text: r.review }) : null, btn));
  }

  // --------------------------------------------------------------------------- notificações
  async function viewNotifications() {
    const list = await api('GET', '/api/notifications?limit=100');
    const all = h('button', { class: 'btn secondary small', type: 'button' }, 'Marcar todas como lidas');
    all.addEventListener('click', busy(all, async () => { await api('POST', '/api/notifications/read-all'); state.unread = 0; render(); }));
    return h('div', {}, h('div', { class: 'row between' }, h('h1', { text: 'Notificações' }), list.some(n => !n.read) ? all : null),
      list.length ? h('div', { class: 'stack' }, list.map(n => {
        const mark = h('button', { class: 'btn small secondary', type: 'button' }, 'Marcar como lida');
        mark.addEventListener('click', busy(mark, async () => { await api('POST', `/api/notifications/${n.id}/read`); render(); }));
        return h('div', { class: 'card' }, h('div', { class: 'row between' }, h('strong', { text: n.title }), n.read ? h('span', { class: 'badge', text: 'lida' }) : h('span', { class: 'badge warn', text: 'nova' })),
          h('div', { text: n.body }), h('div', { class: 'row small' }, h('span', { class: 'muted', text: dateTime(n.created_at) }), n.link ? link(n.link, 'Abrir') : null, n.read ? null : mark));
      })) : h('p', { class: 'muted', text: 'Nenhuma notificação.' }));
  }

  // -------------------------------------------------------------------------------- conta
  async function viewAccount() {
    const me = await api('GET', '/api/auth/me');
    state.me = me;
    const sessions = await api('GET', '/api/auth/sessions');
    const out = h('div', {}, h('h1', { text: 'Minha conta' }),
      h('div', { class: 'card' }, h('p', {}, h('strong', { text: me.full_name }), ` · ${me.email} · ${TYPE_LABEL[me.user_type]}`)));
    // senha
    const cur = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const pw = passwordPair();
    const pbtn = h('button', { class: 'btn', type: 'submit' }, 'Alterar senha');
    const pform = h('form', { class: 'card', onsubmit: e => { e.preventDefault(); psubmit(); } }, h('h2', { class: 'mt0',text: 'Senha' }), field('Senha atual', cur), pw.nodes, pbtn);
    const psubmit = busy(pbtn, async () => { await api('POST', '/api/auth/password/change', { current_password: cur.value, new_password: pw.check() }); toast('Senha alterada. As outras sessões foram encerradas.'); render(); });
    out.append(pform);
    // 2FA
    const mfa = h('div', { class: 'card' }, h('h2', { class: 'mt0',text: 'Verificação em duas etapas' }),
      h('p', {}, me.mfa_enabled ? h('span', { class: 'badge ok', text: 'Ativa' }) : h('span', { class: 'badge warn', text: 'Desativada' }),
        me.mfa_enabled ? ` · ${me.recovery_codes_remaining} código(s) de recuperação restantes` : ''));
    const reauth = () => { const p = h('input', { type: 'password', placeholder: 'Sua senha' }); const c = h('input', { inputmode: 'numeric', maxlength: '6', placeholder: 'Código atual do aplicativo' }); return { p, c, nodes: h('div', { class: 'form-grid' }, field('Senha', p), field('Código', c)) }; };
    if (!me.mfa_enabled) {
      const start = h('button', { class: 'btn', type: 'button' }, 'Ativar');
      start.addEventListener('click', busy(start, async () => {
        const s = await api('POST', '/api/auth/mfa/start');
        const code = h('input', { inputmode: 'numeric', maxlength: '6' });
        const ok = h('button', { class: 'btn', type: 'button' }, 'Confirmar');
        ok.addEventListener('click', busy(ok, async () => {
          const r = await api('POST', '/api/auth/mfa/confirm', { code: code.value });
          mfa.replaceChildren(h('h2', { text: 'Códigos de recuperação' }), h('p', { text: 'Guarde em local seguro. Cada código vale uma vez.' }),
            h('div', { class: 'codes' }, r.recovery_codes.map(x => h('div', { text: x }))), h('p'), h('button', { class: 'btn', type: 'button', onclick: render }, 'Concluído'));
        }));
        mfa.replaceChildren(h('h2', { text: 'Ativar verificação em duas etapas' }), h('img', { class: 'qr', src: s.qr_svg, alt: 'QR code' }),
          h('p', { class: 'small' }, 'Chave: ', h('span', { class: 'mono', text: s.secret })), field('Código do aplicativo', code), ok);
      }));
      mfa.append(start);
    } else {
      const r1 = reauth();
      const regen = h('button', { class: 'btn secondary', type: 'button' }, 'Gerar novos códigos de recuperação');
      regen.addEventListener('click', busy(regen, async () => {
        const codes = await api('POST', '/api/auth/mfa/recovery-codes', { password: r1.p.value, code: r1.c.value });
        mfa.append(h('div', { class: 'codes' }, codes.map(x => h('div', { text: x }))));
      }));
      mfa.append(r1.nodes, h('div', { class: 'row' }, regen));
      if (!me.mfa_required) {
        const off = h('button', { class: 'btn danger', type: 'button' }, 'Desativar');
        off.addEventListener('click', busy(off, async () => { await api('POST', '/api/auth/mfa/disable', { password: r1.p.value, code: r1.c.value }); toast('Verificação desativada.'); render(); }));
        mfa.lastChild.append(off);
      } else mfa.append(h('p', { class: 'small muted', text: 'Obrigatória para o seu perfil.' }));
    }
    out.append(mfa);
    // sessões
    const all = h('button', { class: 'btn danger small', type: 'button' }, 'Sair de todos os dispositivos');
    all.addEventListener('click', busy(all, async () => { await api('POST', '/api/auth/logout-all'); state.me = null; go('/entrar'); }));
    out.append(h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h2', { class: 'm0',text: 'Sessões ativas' }), all),
      h('div', { class: 'table-wrap mt10' }, h('table', {}, h('tbody', {}, sessions.map(s => {
        const end = h('button', { class: 'btn small secondary', type: 'button' }, 'Encerrar');
        end.addEventListener('click', busy(end, async () => { await api('DELETE', `/api/auth/sessions/${s.id}`); render(); }));
        return h('tr', {}, h('td', { class: 'small', text: s.user_agent || 'Navegador desconhecido' }), h('td', { class: 'small', text: s.ip || '' }),
          h('td', { class: 'small', text: `último uso ${dateTime(s.last_used_at)}` }), h('td', {}, s.current ? h('span', { class: 'badge ok', text: 'esta sessão' }) : end));
      }))))));
    return out;
  }

  // ------------------------------------------------------------------------- administração
  async function companyChecklist(selected) {
    const all = await api('GET', '/api/companies');
    const filter = h('input', { type: 'search', placeholder: 'Filtrar empresas' });
    const boxes = all.map(c => ({ c, el: h('input', { type: 'checkbox', value: c.cnpj, checked: selected.includes(c.cnpj) }) }));
    const list = h('div', { class: 'checklist' }, boxes.map(({ c, el }) => h('label', { class: 'check', 'data-name': `${c.name} ${c.cnpj}`.toLowerCase() }, el, `${c.name} (${cnpj(c.cnpj)})`)));
    filter.addEventListener('input', () => [...list.children].forEach(l => { l.hidden = !l.dataset.name.includes(filter.value.toLowerCase()); }));
    return { node: h('div', {}, filter, list), values: () => boxes.filter(b => b.el.checked).map(b => b.c.cnpj) };
  }
  async function viewAdminUsers() {
    const out = h('div', {}, h('h1', { text: 'Usuários e carteiras' }));
    const tbox = h('div');
    const typeFilter = h('select', {}, h('option', { value: '', text: 'Todos os perfis' }), Object.entries(TYPE_LABEL).map(([k, v]) => h('option', { value: k, text: v })));
    const load = async () => {
      const users = await api('GET', '/api/admin/users' + (typeFilter.value ? `?user_type=${typeFilter.value}` : ''));
      tbox.replaceChildren(h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Nome', 'Perfil', 'Convite', '2FA', 'Empresas', 'Último acesso', 'Ações'].map(t => h('th', { text: t })))),
        h('tbody', {}, users.map(u => h('tr', {},
          h('td', {}, h('strong', { text: u.full_name }), h('div', { class: 'small muted', text: u.email }), u.is_active ? null : h('span', { class: 'badge bad', text: 'desativado' })),
          h('td', { text: TYPE_LABEL[u.user_type] }), h('td', {}, h('span', { class: 'badge', text: u.invite_status })),
          h('td', { text: u.mfa_enabled ? 'sim' : 'não' }), h('td', { text: u.user_type === 'admin' ? 'todas' : String(u.companies.length) }),
          h('td', { class: 'small', text: dateTime(u.last_login_at) }), h('td', {}, userActions(u, load))))))));
    };
    typeFilter.addEventListener('change', load);
    await load();
    // criação
    const name = h('input', { required: true });
    const email = h('input', { type: 'email', required: true });
    const type = h('select', {}, Object.entries(TYPE_LABEL).map(([k, v]) => h('option', { value: k, text: v })));
    type.value = 'employee';
    const picker = await companyChecklist([]);
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Criar e enviar convite');
    const form = h('form', { class: 'card', onsubmit: e => { e.preventDefault(); submit(); } }, h('h2', { class: 'mt0',text: 'Novo usuário' }),
      h('div', { class: 'form-grid' }, field('Nome', name), field('E-mail', email), field('Perfil', type)),
      field('Empresas (carteira do funcionário ou empresas do cliente)', picker.node), btn);
    const submit = busy(btn, async () => {
      await api('POST', '/api/admin/users', { full_name: name.value, email: email.value, user_type: type.value,
        company_cnpjs: type.value === 'admin' ? [] : picker.values() });
      toast('Convite enviado.'); render();
    });
    out.append(h('div', { class: 'row' }, field('Perfil', typeFilter)), tbox, form);
    return out;
  }
  function userActions(u, reload) {
    const act = (label, fn, cls = 'secondary') => { const b = h('button', { class: `btn small ${cls}`, type: 'button' }, label); b.addEventListener('click', busy(b, async () => { await fn(); await reload(); })); return b; };
    const items = [];
    if (u.invite_status !== 'aceito') {
      items.push(act('Reenviar convite', () => api('POST', `/api/admin/users/${u.id}/invite/resend`).then(() => toast('Convite reenviado.'))));
      if (u.invite_status === 'pendente') items.push(act('Revogar convite', () => api('POST', `/api/admin/users/${u.id}/invite/revoke`)));
    }
    if (u.user_type !== 'admin') {
      items.push(act('Empresas', async () => {
        const picker = await companyChecklist(u.companies);
        const save = h('button', { class: 'btn', type: 'button' }, 'Salvar empresas');
        const dlg = h('div', { class: 'card' }, h('h3', { class: 'mt0',text: `Empresas de ${u.full_name}` }), picker.node, h('p'), save);
        save.addEventListener('click', busy(save, async () => { await api('PUT', `/api/admin/users/${u.id}/companies`, { cnpjs: picker.values() }); toast('Empresas atualizadas.'); dlg.remove(); reload(); }));
        document.querySelector('main').prepend(dlg);
        dlg.scrollIntoView();
      }));
    }
    if (u.invite_status === 'aceito' && u.is_active && u.id !== state.me.id) {
      items.push(act('Enviar redefinição de senha', async () => {
        if (!window.confirm(`Enviar a ${u.email} um link para criar nova senha? A senha atual continua valendo até o link ser usado.`)) return;
        const r = await api('POST', `/api/admin/users/${u.id}/password-reset`);
        toast(r.message);
      }));
    }
    if (u.mfa_enabled && u.id !== state.me.id) items.push(act('Redefinir 2FA', () => window.confirm('O usuário terá de cadastrar o 2FA de novo no próximo login. Continuar?') && api('POST', `/api/admin/users/${u.id}/mfa/reset`)));
    if (u.id !== state.me.id) items.push(act(u.is_active ? 'Desativar' : 'Reativar', () => api('PATCH', `/api/admin/users/${u.id}`, { is_active: !u.is_active }), u.is_active ? 'danger' : 'secondary'));
    return h('div', { class: 'row' }, items);
  }
  function viewAdminNewCompany() {
    const f = { cnpj: h('input', { required: true, placeholder: '00.000.000/0000-00' }), name: h('input', { required: true }),
      regime: h('select', {}, REGIMES.map(r => h('option', { value: r, text: r }))), start: h('input', { type: 'month', required: true }),
      regime_since: h('input', { type: 'month' }) };
    const mods = Object.entries(MODULES).map(([k, v]) => ({ k, el: h('input', { type: 'checkbox', checked: k === 'painel_fiscal' || k === 'documentos' }), v }));
    const rName = h('input'); const rEmail = h('input', { type: 'email' });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Cadastrar');
    const msg = h('div');
    const form = h('form', { onsubmit: e => { e.preventDefault(); submit(); } }, h('h1', { text: 'Nova empresa' }), msg,
      h('div', { class: 'card' }, h('div', { class: 'form-grid' }, field('CNPJ', f.cnpj), field('Razão social', f.name), field('Regime tributário', f.regime),
        field('Início do acompanhamento', f.start), field('Vigência do regime', f.regime_since, 'Opcional'))),
      h('div', { class: 'card' }, h('h3', { class: 'mt0',text: 'Módulos contratados' }), mods.map(m => h('label', { class: 'check' }, m.el, m.v))),
      h('div', { class: 'card' }, h('h3', { class: 'mt0',text: 'Responsável (recebe convite de acesso)' }),
        h('div', { class: 'form-grid' }, field('Nome', rName), field('E-mail', rEmail)), h('p', { class: 'small muted', text: 'Opcional. Se o e-mail já for de um cliente, a empresa é vinculada à conta existente.' })), btn);
    const submit = busy(btn, async () => {
      msg.replaceChildren();
      try {
        const c = await api('POST', '/api/admin/companies', {
          company: { cnpj: f.cnpj.value, name: f.name.value, regime: f.regime.value, start: f.start.value, regime_since: f.regime_since.value || null },
          modules: mods.filter(m => m.el.checked).map(m => m.k),
          responsible: rEmail.value ? { name: rName.value, email: rEmail.value } : null });
        toast('Empresa cadastrada.'); go(`/empresas/${c.cnpj}`);
      } catch (e) { msg.replaceChildren(errorBox(e)); }
    });
    return form;
  }
  async function adminCompanyTab(c) {
    const data = await api('GET', `/api/admin/companies/${c.cnpj}`);
    const rules = await api('GET', `/api/admin/companies/${c.cnpj}/revenue-rules`);
    const out = h('div');
    const name = h('input', { value: data.name }); const regime = h('select', {}, REGIMES.map(r => h('option', { value: r, text: r }))); regime.value = data.regime;
    const start = h('input', { type: 'month', value: data.start }); const since = h('input', { type: 'month', value: data.regime_since || '' });
    const save = h('button', { class: 'btn', type: 'button' }, 'Salvar cadastro');
    save.addEventListener('click', busy(save, async () => { await api('PATCH', `/api/admin/companies/${c.cnpj}`, { name: name.value, regime: regime.value, start: start.value, regime_since: since.value || null }); toast('Cadastro salvo.'); render(); }));
    out.append(h('div', { class: 'card' }, h('h3', { class: 'mt0',text: 'Cadastro' }), h('div', { class: 'form-grid' }, field('Razão social', name), field('Regime', regime), field('Início', start), field('Vigência do regime', since)),
      h('p', { class: 'small muted', text: 'O CNPJ não pode ser alterado (é a chave do histórico).' }), save));
    const mods = Object.entries(MODULES).map(([k, v]) => ({ k, el: h('input', { type: 'checkbox', checked: data.modules[k] }), v }));
    const msave = h('button', { class: 'btn', type: 'button' }, 'Salvar módulos');
    msave.addEventListener('click', busy(msave, async () => { await api('PUT', `/api/admin/companies/${c.cnpj}/modules`, { modules: Object.fromEntries(mods.map(m => [m.k, m.el.checked])) }); toast('Módulos atualizados.'); render(); }));
    out.append(h('div', { class: 'card' }, h('h3', { class: 'mt0',text: 'Módulos' }), mods.map(m => h('label', { class: 'check' }, m.el, m.v)),
      h('p', { class: 'small muted', text: 'Desativar um módulo bloqueia o acesso, mas não apaga dados.' }), msave));
    const codes = h('input', { value: rules.map(r => r.code).join(', ') });
    const rsave = h('button', { class: 'btn', type: 'button' }, 'Salvar acumuladores');
    rsave.addEventListener('click', busy(rsave, async () => {
      const list = codes.value.split(',').map(s => s.trim()).filter(Boolean).map(code => ({ code, note: 'Conferido pelo escritório' }));
      await api('PUT', `/api/admin/companies/${c.cnpj}/revenue-rules`, { rules: list }); toast('Regras de receita salvas.');
    }));
    out.append(h('div', { class: 'card' }, h('h3', { class: 'mt0',text: 'Acumuladores do Domínio que são receita' }),
      field('Códigos (separados por vírgula)', codes, 'Só informe códigos conferidos. Sem regra, a receita por acumulador fica "não informada".'), rsave));
    const toggle = h('button', { class: `btn ${data.is_active ? 'danger' : ''}`, type: 'button' }, data.is_active ? 'Desativar empresa' : 'Reativar empresa');
    toggle.addEventListener('click', busy(toggle, async () => { await api('POST', `/api/admin/companies/${c.cnpj}/${data.is_active ? 'deactivate' : 'activate'}`); toast('Situação atualizada.'); render(); }));
    out.append(h('div', { class: 'card' }, h('h3', { class: 'mt0',text: 'Quem tem acesso' }),
      data.users.length ? h('ul', {}, data.users.map(u => h('li', { text: `${u.full_name} (${TYPE_LABEL[u.user_type]}) — ${u.email}` }))) : h('p', { class: 'muted', text: 'Ninguém além dos administradores.' }), toggle));
    return out;
  }
  async function viewAdminRules() {
    const [rules, holidays] = await Promise.all([api('GET', '/api/admin/obligation-rules'), api('GET', '/api/admin/holidays')]);
    const out = h('div', {}, h('h1', { text: 'Modelos de obrigações' }),
      h('div', { class: 'alert warn', text: 'Os modelos são sugestões para conferência, não garantia de prazo. Modelos com fonte marcada como "SUGESTÃO" só podem ser validados depois que você informar a norma conferida. Só modelos validados geram vencimentos; validar cria histórico e nunca altera obrigações já geradas.' }));
    const prazo = r => r.due_kind === 'dia_util' ? `${r.due_day}º dia útil, +${r.due_month_offset} mês(es)` : `dia ${r.due_day}, +${r.due_month_offset} mês(es), ${r.business_day_rule}`;
    const editBox = h('div');
    out.append(h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Modelo', 'Tributo', 'Regimes', 'Prazo', 'Vigência', 'Fonte', 'Status / revisão', ''].map(t => h('th', { text: t })))),
      h('tbody', {}, rules.map(r => {
        const actions = [];
        if (r.status === 'rascunho') {
          const e = h('button', { class: 'btn small secondary', type: 'button' }, 'Editar');
          e.addEventListener('click', () => { editBox.replaceChildren(ruleForm(r)); editBox.scrollIntoView(); });
          const b = h('button', { class: 'btn small', type: 'button', disabled: r.needs_source_review }, 'Validar');
          b.addEventListener('click', busy(b, async () => { if (window.confirm(`Confirma que conferiu "${r.name}" com a fonte: ${r.legal_source}?`)) { await api('POST', `/api/admin/obligation-rules/${r.id}/validate`); render(); } }));
          actions.push(e, b);
        }
        if (r.status === 'validada') {
          const v = h('button', { class: 'btn small secondary', type: 'button' }, 'Nova versão');
          v.addEventListener('click', () => { editBox.replaceChildren(ruleForm({ ...r, id: null })); editBox.scrollIntoView(); });
          actions.push(v);
        }
        if (r.status !== 'revogada') { const b = h('button', { class: 'btn small danger', type: 'button' }, 'Desativar'); b.addEventListener('click', busy(b, async () => { if (window.confirm('Desativar este modelo? As obrigações já geradas continuam.')) { await api('POST', `/api/admin/obligation-rules/${r.id}/revoke`); render(); } })); actions.push(b); }
        return h('tr', {}, h('td', {}, h('strong', { text: r.name }), h('div', { class: 'small mono muted', text: `${r.code} v${r.version} · ${r.obligation_type}` })),
          h('td', { class: 'mono', text: r.tax_code || '—' }), h('td', { class: 'small', text: r.regimes.join(', ') }), h('td', { class: 'small', text: `${r.periodicity}: ${prazo(r)}` }),
          h('td', { class: 'small', text: `${period(r.valid_from)} – ${r.valid_to ? period(r.valid_to) : 'atual'}` }),
          h('td', { class: 'small' }, r.legal_source, r.needs_source_review ? h('div', { class: 'badge warn', text: 'fonte a conferir' }) : null),
          h('td', {}, h('span', { class: `badge ${r.status === 'validada' ? 'ok' : r.status === 'rascunho' ? 'warn' : ''}`, text: r.status }),
            r.validated_at ? h('div', { class: 'small muted', text: `revisado em ${dateTime(r.validated_at)}` }) : null),
          h('td', {}, h('div', { class: 'row' }, actions)));
      })))), editBox);
    out.append(ruleForm(null));
    out.append(await applyRulesCard(rules.filter(r => r.status === 'validada')));
    const gper = h('input', { type: 'month', required: true });
    const gbtn = h('button', { class: 'btn', type: 'button' }, 'Gerar obrigações da competência');
    const gmsg = h('div');
    gbtn.addEventListener('click', busy(gbtn, async () => { const r = await api('POST', '/api/admin/obligations/generate', { period: gper.value }); gmsg.replaceChildren(h('div', { class: 'alert ok', text: `${r.created} criada(s), ${r.existing} já existente(s), ${r.validated_rules} regra(s) validada(s).` })); }));
    out.append(h('div', { class: 'card' }, h('h2', { class: 'mt0',text: 'Gerar vencimentos' }), h('div', { class: 'row' }, gper, gbtn), gmsg));
    const hday = h('input', { type: 'date' }); const hdesc = h('input', { placeholder: 'Descrição' });
    const hbtn = h('button', { class: 'btn', type: 'button' }, 'Adicionar feriado');
    hbtn.addEventListener('click', busy(hbtn, async () => { await api('POST', '/api/admin/holidays', { day: hday.value, description: hdesc.value }); render(); }));
    out.append(h('div', { class: 'card' }, h('h2', { class: 'mt0',text: 'Feriados nacionais (para ajuste de dia útil)' }),
      holidays.length ? h('ul', {}, holidays.map(x => { const del = h('button', { class: 'btn small secondary', type: 'button' }, 'remover'); del.addEventListener('click', busy(del, async () => { await api('DELETE', `/api/admin/holidays/${x.id}`); render(); })); return h('li', {}, `${day(x.day)} — ${x.description} `, del); })) : h('p', { class: 'muted', text: 'Nenhum feriado cadastrado.' }),
      h('div', { class: 'row' }, hday, hdesc, hbtn)));
    return out;
  }
  function ruleForm(r) {
    // r = null (novo), rascunho com id (editar), ou validada com id=null (nova versão do mesmo código)
    const editing = r && r.id;
    const f = { code: h('input', { required: true, value: r ? r.code : '', disabled: !!r }), name: h('input', { required: true, value: r ? r.name : '' }),
      tax_code: h('input', { value: r ? r.tax_code || '' : '', placeholder: 'DAS, FGTS, DCTFWEB…' }),
      obligation_type: h('select', {}, [['guia', 'Guia'], ['declaracao', 'Declaração'], ['escrituracao', 'Escrituração']].map(([v, t]) => h('option', { value: v, text: t }))),
      periodicity: h('select', {}, ['mensal', 'trimestral', 'anual'].map(p => h('option', { value: p, text: p }))),
      due_kind: h('select', {}, [['dia_fixo', 'Dia fixo do mês'], ['dia_util', 'N-ésimo dia útil']].map(([v, t]) => h('option', { value: v, text: t }))),
      due_day: h('input', { type: 'number', min: '1', max: '31', required: true, value: r ? r.due_day : '' }),
      due_month_offset: h('input', { type: 'number', min: '0', max: '24', required: true, value: r ? r.due_month_offset : '1' }),
      business_day_rule: h('select', {}, [['antecipar', 'Antecipa para o dia útil anterior'], ['postergar', 'Posterga para o próximo dia útil'], ['nenhum', 'Sem ajuste']].map(([v, t]) => h('option', { value: v, text: t }))),
      valid_from: h('input', { type: 'month', required: true, value: r ? r.valid_from : '' }), valid_to: h('input', { type: 'month', value: r ? r.valid_to || '' : '' }),
      legal_source: h('textarea', { required: true, value: r ? r.legal_source : '' }) };
    if (r) { f.obligation_type.value = r.obligation_type; f.periodicity.value = r.periodicity; f.due_kind.value = r.due_kind; f.business_day_rule.value = r.business_day_rule; }
    const regimes = REGIMES.slice(0, 3).map(x => ({ x, el: h('input', { type: 'checkbox', checked: r ? r.regimes.includes(x) : false }) }));
    const btn = h('button', { class: 'btn', type: 'submit' }, editing ? 'Salvar rascunho' : 'Salvar como rascunho');
    const msg = h('div');
    const form = h('form', { class: 'card' }, h('h2', { class: 'mt0', text: editing ? `Editar rascunho: ${r.name}` : r ? `Nova versão de ${r.code}` : 'Novo modelo' }), msg,
      h('div', { class: 'form-grid' }, field('Código', f.code), field('Nome', f.name), field('Tributo (para casar guias)', f.tax_code), field('Tipo', f.obligation_type),
        field('Periodicidade', f.periodicity), field('Tipo de vencimento', f.due_kind), field('Dia (ou N-ésimo dia útil)', f.due_day),
        field('Meses após a competência', f.due_month_offset), field('Dia não útil', f.business_day_rule), field('Vigente desde', f.valid_from), field('Vigente até', f.valid_to)),
      h('div', { class: 'field' }, h('label', { text: 'Regimes' }), regimes.map(x => h('label', { class: 'check' }, x.el, x.x))),
      field('Fonte normativa (obrigatória; substitua "SUGESTÃO" pela norma conferida)', f.legal_source), btn);
    form.addEventListener('submit', e => {
      e.preventDefault();
      busy(btn, async () => {
        msg.replaceChildren();
        const body = { name: f.name.value, tax_code: f.tax_code.value || null, obligation_type: f.obligation_type.value, periodicity: f.periodicity.value,
          due_kind: f.due_kind.value, due_day: +f.due_day.value, due_month_offset: +f.due_month_offset.value, business_day_rule: f.business_day_rule.value,
          valid_from: f.valid_from.value, valid_to: f.valid_to.value || null, legal_source: f.legal_source.value, regimes: regimes.filter(x => x.el.checked).map(x => x.x) };
        try {
          if (editing) await api('PATCH', `/api/admin/obligation-rules/${r.id}`, body);
          else await api('POST', '/api/admin/obligation-rules', { ...body, code: f.code.value });
          toast('Modelo salvo como rascunho.'); render();
        } catch (err) { msg.replaceChildren(errorBox(err)); }
      })();
    });
    return form;
  }
  async function applyRulesCard(validated) {
    const card = h('div', { class: 'card' }, h('h2', { class: 'mt0', text: 'Aplicar modelos às empresas' }));
    if (!validated.length) { card.append(h('p', { class: 'muted', text: 'Nenhum modelo validado ainda.' })); return card; }
    const picks = validated.map(r => ({ r, el: h('input', { type: 'checkbox' }) }));
    const target = h('select', {}, h('option', { value: 'all', text: 'Todas as empresas ativas' }), REGIMES.slice(0, 3).map(x => h('option', { value: x, text: `Empresas do ${x}` })));
    const start = h('input', { type: 'month' }); const end = h('input', { type: 'month' });
    const result = h('div');
    const body = dry => ({ rule_ids: picks.filter(p => p.el.checked).map(p => p.r.id), start: start.value, end: end.value, dry_run: dry,
      selection: { filter: target.value === 'all' ? { status: 'ativa' } : { status: 'ativa', regime: target.value } } });
    const prev = h('button', { class: 'btn secondary', type: 'button' }, 'Ver prévia');
    const go_ = h('button', { class: 'btn', type: 'button', disabled: true }, 'Gerar obrigações');
    prev.addEventListener('click', busy(prev, async () => {
      const r = await api('POST', '/api/admin/obligations/apply', body(true));
      result.replaceChildren(h('div', { class: 'alert' }, `${r.criar} obrigação(ões) serão criadas para ${r.empresas} empresa(s) em ${r.competencias.length} competência(s).`),
        Object.entries(r.por_regra).map(([k, s]) => h('div', { class: 'small' }, h('strong', { text: s.name }), ` — criar ${s.criar}, já existentes ${s.ja_existentes}, não aplicável ${s.nao_aplicavel}. `,
          s.exemplos.length ? `Ex.: ${s.exemplos.map(x => `${x.empresa} ${period(x.competencia)} vence ${day(x.vencimento)}`).join('; ')}` : '',
          (s.sem_data_valida || []).length ? h('div', { class: 'alert error small', text: `Sem data válida (não será criada): ${s.sem_data_valida.map(x => `${period(x.competencia)} — ${x.motivo}`).join('; ')}` }) : null)));
      go_.disabled = r.criar === 0;
    }));
    go_.addEventListener('click', busy(go_, async () => {
      const r = await api('POST', '/api/admin/obligations/apply', body(false));
      result.replaceChildren(h('div', { class: 'alert ok', text: `${r.criar} obrigação(ões) criadas.` })); go_.disabled = true;
    }));
    card.append(h('div', { class: 'field' }, h('label', { text: 'Modelos validados' }), picks.map(p => h('label', { class: 'check' }, p.el, `${p.r.name} (v${p.r.version})`))),
      h('div', { class: 'form-grid' }, field('Empresas', target), field('De (competência)', start), field('Até', end)), h('div', { class: 'row' }, prev, go_), result);
    return card;
  }
  async function viewAdminAudit() {
    const action = h('input', { placeholder: 'Ação (prefixo, ex.: auth., security., documents.)' });
    const result = h('select', {}, ['', 'success', 'denied', 'failure'].map(v => h('option', { value: v, text: v || 'Todos os resultados' })));
    const box = h('tbody');
    let before = null;
    const more = h('button', { class: 'btn secondary', type: 'button' }, 'Carregar mais');
    const load = async reset => {
      if (reset) { before = null; box.replaceChildren(); }
      const p = new URLSearchParams({ limit: '100' });
      if (action.value) p.set('action', action.value);
      if (result.value) p.set('result', result.value);
      if (before) p.set('before_id', before);
      const r = await api('GET', '/api/admin/audit?' + p);
      r.events.forEach(e => box.append(h('tr', {}, h('td', { class: 'small nowrap', text: dateTime(e.occurred_at) }), h('td', { class: 'mono small', text: e.action }),
        h('td', {}, h('span', { class: `badge ${e.result === 'success' ? 'ok' : e.result === 'denied' ? 'bad' : 'warn'}`, text: e.result })),
        h('td', { class: 'small', text: e.user_id ? `#${e.user_id}` : '—' }), h('td', { class: 'small', text: e.resource_type ? `${e.resource_type} ${e.resource_id || ''}` : '' }),
        h('td', { class: 'small mono', text: e.details ? JSON.stringify(e.details) : '' }), h('td', { class: 'small', text: e.ip || '' }))));
      before = r.next_before_id; more.hidden = !before;
    };
    more.addEventListener('click', busy(more, () => load(false)));
    action.addEventListener('change', () => load(true));
    result.addEventListener('change', () => load(true));
    await load(true);
    return h('div', {}, h('h1', { text: 'Auditoria' }), h('p', { class: 'small muted', text: 'Registros somente de inclusão: não podem ser alterados nem apagados.' }),
      h('div', { class: 'form-grid' }, field('Ação', action), field('Resultado', result)),
      h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Quando', 'Ação', 'Resultado', 'Usuário', 'Recurso', 'Detalhes', 'IP'].map(t => h('th', { text: t })))), box)), more);
  }
  async function viewAdminConfig() {
    const s = await api('GET', '/api/admin/settings/notifications');
    const days = h('input', { value: s.reminder_days.join(', ') });
    const save = h('button', { class: 'btn', type: 'button' }, 'Salvar');
    save.addEventListener('click', busy(save, async () => {
      const r = await api('PUT', '/api/admin/settings/notifications', { reminder_days: days.value.split(',').map(x => parseInt(x, 10)).filter(n => !Number.isNaN(n)) });
      days.value = r.reminder_days.join(', '); toast('Lembretes atualizados.');
    }));
    const title = h('input'); const body = h('textarea'); const audience = h('select', {}, [['clients', 'Clientes'], ['staff', 'Equipe'], ['all', 'Todos']].map(([v, t]) => h('option', { value: v, text: t })));
    const send = h('button', { class: 'btn', type: 'button' }, 'Enviar aviso');
    send.addEventListener('click', busy(send, async () => { const r = await api('POST', '/api/admin/notices', { title: title.value, body: body.value, audience: audience.value }); toast(`Aviso enviado a ${r.recipients} pessoa(s).`); title.value = ''; body.value = ''; }));
    return h('div', {}, h('h1', { text: 'Configurações' }),
      h('div', { class: 'card' }, h('h2', { class: 'mt0',text: 'Lembretes de vencimento' }), field('Dias antes do vencimento', days, 'Ex.: 7, 3, 1, 0 (0 = no dia).'), save),
      h('div', { class: 'card' }, h('h2', { class: 'mt0',text: 'Aviso administrativo' }), h('div', { class: 'form-grid' }, field('Título', title), field('Público', audience)),
        field('Mensagem', body, 'Não inclua valores fiscais ou dados sensíveis: o aviso também vai por e-mail.'), send));
  }

  // --------------------------------------------------------- empresas em lote (admin, Etapa 1)
  async function viewAdminCompanies() {
    const cat = await api('GET', '/api/admin/catalog');
    const f = { q: h('input', { type: 'search', placeholder: 'Razão social, nome fantasia ou CNPJ' }),
      regime: h('select', {}, h('option', { value: '', text: 'Todos os regimes' }), REGIMES.map(r => h('option', { value: r, text: r }))),
      status: h('select', {}, [['', 'Ativas e inativas'], ['ativa', 'Ativas'], ['inativa', 'Inativas']].map(([v, t]) => h('option', { value: v, text: t }))),
      module: h('select', {}, h('option', { value: '', text: 'Qualquer módulo' }), Object.entries(MODULES).map(([k, v]) => [h('option', { value: k, text: `Com ${v}` }), h('option', { value: '!' + k, text: `Sem ${v}` })])),
      employee: h('select', {}, h('option', { value: '', text: 'Qualquer responsável' }), cat.employees.map(e => h('option', { value: e.id, text: e.full_name }))) };
    f.status.value = 'ativa';
    let page = 1, total = 0, items = [];
    const selected = new Set();
    let allFiltered = false;
    const exclude = new Set();
    const filterObj = () => {
      const o = {};
      if (f.q.value) o.q = f.q.value;
      if (f.regime.value) o.regime = f.regime.value;
      if (f.status.value) o.status = f.status.value;
      if (f.module.value) { if (f.module.value.startsWith('!')) o.without_module = f.module.value.slice(1); else o.module = f.module.value; }
      if (f.employee.value) o.employee_id = +f.employee.value;
      return o;
    };
    const count = () => allFiltered ? total - exclude.size : selected.size;
    const tableBox = h('div');
    const bar = h('div', { class: 'bulkbar' });
    const bulkResult = h('div');  // fora da barra: não some quando a lista recarrega
    const pager = h('div', { class: 'row' });
    const selection = () => allFiltered ? { filter: filterObj(), exclude: [...exclude] } : { cnpjs: [...selected] };
    const drawBar = () => {
      const mod = h('select', {}, Object.entries(MODULES).map(([k, v]) => h('option', { value: k, text: v })));
      const act = h('select', {}, h('option', { value: 'on', text: 'Ativar' }), h('option', { value: 'off', text: 'Desativar' }));
      const prev = h('button', { class: 'btn small', type: 'button', disabled: !count() }, 'Ver impacto');
      const res = h('div');
      prev.addEventListener('click', busy(prev, async () => {
        const body = { selection: selection(), modules: { [mod.value]: act.value === 'on' } };
        const p = await api('POST', '/api/admin/companies/bulk/modules', { ...body, dry_run: true });
        const s = p.summary[mod.value];
        const conf = h('button', { class: `btn small ${act.value === 'off' ? 'danger' : ''}`, type: 'button', disabled: !s.alterar }, `Confirmar (${s.alterar} empresa(s))`);
        conf.addEventListener('click', busy(conf, async () => {
          if (act.value === 'off' && !window.confirm('Desativar bloqueia o acesso ao módulo (os dados são mantidos). Continuar?')) return;
          const r = await api('POST', '/api/admin/companies/bulk/modules', { ...body, dry_run: false });
          const errs = r.results.filter(x => x.status === 'erro');
          bulkResult.replaceChildren(h('div', { class: `alert ${errs.length ? 'warn' : 'ok'}`, text: `${MODULES[mod.value]}: ${r.results.filter(x => x.status === 'alterado').length} empresa(s) alterada(s), ${errs.length} com erro.` }),
            errs.map(x => h('div', { class: 'small alert error', text: `${x.name}: ${x.error}` })));
          load();
        }));
        res.replaceChildren(h('div', { class: 'alert' }, `${MODULES[mod.value]}: ${s.alterar} empresa(s) serão alteradas, ${s.ja_no_estado} já estão assim. `, conf));
      }));
      bar.replaceChildren(h('strong', { text: `${count()} selecionada(s)` }),
        h('button', { class: 'btn small secondary', type: 'button', onclick: () => { allFiltered = true; exclude.clear(); selected.clear(); drawTable(); drawBar(); } }, `Selecionar todas do filtro (${total})`),
        h('button', { class: 'btn small secondary', type: 'button', onclick: () => { allFiltered = false; selected.clear(); exclude.clear(); drawTable(); drawBar(); } }, 'Limpar seleção'),
        act, mod, prev, res);
    };
    const isSel = c => allFiltered ? !exclude.has(c.cnpj) : selected.has(c.cnpj);
    const drawTable = () => {
      const all = h('input', { type: 'checkbox', 'aria-label': 'Selecionar a página', checked: items.length && items.every(isSel) });
      all.addEventListener('change', () => { items.forEach(c => { if (allFiltered) { if (all.checked) exclude.delete(c.cnpj); else exclude.add(c.cnpj); } else if (all.checked) selected.add(c.cnpj); else selected.delete(c.cnpj); }); drawTable(); drawBar(); });
      tableBox.replaceChildren(h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, all), ['Empresa', 'CNPJ', 'Regime', 'Módulos', 'Responsáveis', 'Situação'].map(t => h('th', { text: t })))),
        h('tbody', {}, items.map(c => {
          const cb = h('input', { type: 'checkbox', checked: isSel(c), 'aria-label': `Selecionar ${c.name}` });
          cb.addEventListener('change', () => { if (allFiltered) { if (cb.checked) exclude.delete(c.cnpj); else exclude.add(c.cnpj); } else if (cb.checked) selected.add(c.cnpj); else selected.delete(c.cnpj); drawBar(); });
          return h('tr', {}, h('td', {}, cb), h('td', {}, link(`/empresas/${c.cnpj}`, c.name), c.trade_name ? h('div', { class: 'small muted', text: c.trade_name }) : null),
            h('td', { class: 'mono nowrap', text: cnpj(c.cnpj) }), h('td', { text: c.regime }), h('td', { class: 'small', text: c.modules.map(m => MODULES[m]).join(', ') || '—' }),
            h('td', { class: 'small', text: c.employees.join(', ') || '—' }), h('td', {}, c.is_active ? h('span', { class: 'badge ok', text: 'ativa' }) : h('span', { class: 'badge', text: 'inativa' })));
        })))));
      const pages = Math.max(1, Math.ceil(total / 50));
      pager.replaceChildren(h('span', { class: 'small muted', text: `${total} empresa(s) · página ${page} de ${pages}` }),
        h('button', { class: 'btn small secondary', type: 'button', disabled: page <= 1, onclick: () => { page--; load(); } }, 'Anterior'),
        h('button', { class: 'btn small secondary', type: 'button', disabled: page >= pages, onclick: () => { page++; load(); } }, 'Próxima'));
    };
    const load = async () => {
      const p = new URLSearchParams({ ...filterObj(), page: String(page), page_size: '50' });
      const r = await api('GET', '/api/admin/companies?' + p);
      total = r.total; items = r.items; drawTable(); drawBar();
    };
    const reset = () => { page = 1; allFiltered = false; selected.clear(); exclude.clear(); load().catch(e => tableBox.replaceChildren(errorBox(e))); };
    let t; f.q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(reset, 300); });
    [f.regime, f.status, f.module, f.employee].forEach(el => el.addEventListener('change', reset));
    await load();
    return h('div', {}, h('div', { class: 'row between' }, h('h1', { text: 'Empresas' }),
      h('div', { class: 'row' }, link('/admin/importar-empresas', 'Importar planilha', 'btn secondary'), link('/admin/empresas/nova', '+ Nova empresa', 'btn'))),
      h('div', { class: 'form-grid' }, field('Busca', f.q), field('Regime', f.regime), field('Situação', f.status), field('Módulo', f.module), field('Funcionário', f.employee)),
      bar, bulkResult, tableBox, pager);
  }

  // ------------------------------------------------------- importação de planilha (Etapa 1)
  function viewAdminImport() {
    const input = h('input', { type: 'file', accept: '.csv,.xlsx' });
    const box = h('div');
    const btn = h('button', { class: 'btn', type: 'button' }, 'Ver prévia');
    btn.addEventListener('click', busy(btn, async () => {
      if (!input.files[0]) throw new Error('Escolha um arquivo .csv ou .xlsx.');
      const form = new FormData(); form.append('file', input.files[0]);
      box.replaceChildren(h('p', { class: 'muted', text: 'Lendo planilha…' }));
      try { importPreview(box, await uploadWithProgress('/api/admin/imports/companies', form, () => {})); } catch (e) { box.replaceChildren(errorBox(e)); }
    }));
    return h('div', {}, h('h1', { text: 'Importar empresas e responsáveis' }),
      h('p', { class: 'muted' }, 'Use o modelo, preencha e envie. Nada é gravado antes da sua confirmação, e nenhum convite sai sem você pedir. ',
        h('a', { href: '/api/admin/imports/companies/template.csv', download: '' }, 'Baixar modelo (CSV)')),
      h('div', { class: 'card row' }, input, btn), box);
  }
  function importPreview(box, imp) {
    const KIND = { nova: ['Nova', 'ok'], existente: ['Já cadastrada', ''], erro: ['Erro', 'bad'], duplicada: ['Repetida', 'bad'] };
    const s = imp.summary;
    const upd = h('input', { type: 'checkbox' });
    const inv = h('input', { type: 'checkbox' });
    const mods = Object.entries(MODULES).map(([k, v]) => ({ k, el: h('input', { type: 'checkbox', checked: true }), v }));
    const conf = h('button', { class: 'btn', type: 'button' }, 'Confirmar importação');
    const result = h('div');
    conf.addEventListener('click', busy(conf, async () => {
      const r = await api('POST', `/api/admin/imports/companies/${imp.id}/confirm`, { update_existing: upd.checked, send_invites: inv.checked,
        modules: mods.filter(m => m.el.checked).map(m => m.k) });
      const rep = r.report;
      const sendBtn = h('button', { class: 'btn secondary', type: 'button' }, `Enviar convites agora (${rep.usuarios_sem_convite.length})`);
      sendBtn.addEventListener('click', busy(sendBtn, async () => { const x = await api('POST', '/api/admin/invites/send', { user_ids: rep.usuarios_sem_convite }); toast(`${x.sent} convite(s) enviados, ${x.already_pending} já pendentes.`); sendBtn.disabled = true; }));
      result.replaceChildren(h('div', { class: 'alert ok' }, `Concluído: ${rep.criadas} criada(s), ${rep.atualizadas} atualizada(s), ${rep.existentes_sem_alteracao} sem alteração, ${rep.ignoradas_com_erro} ignorada(s) com erro. Responsáveis: ${rep.responsaveis_criados} novo(s), ${rep.responsaveis_vinculados} vínculo(s). Convites: ${rep.convites_enviados} enviados, ${rep.convites_ja_pendentes} já pendentes.`),
        rep.usuarios_sem_convite.length ? sendBtn : null);
      conf.disabled = true;
    }));
    box.replaceChildren(h('div', { class: 'grid' }, kpi('Novas', String(s.nova || 0)), kpi('Já cadastradas', String(s.existente || 0)), kpi('Com erro', String((s.erro || 0) + (s.duplicada || 0)))),
      h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Linha', 'Situação', 'CNPJ', 'Razão social', 'Responsável', 'Observações'].map(t => h('th', { text: t })))),
        h('tbody', {}, imp.rows.map(r => h('tr', {}, h('td', { text: String(r.line) }), h('td', {}, badge(KIND, r.kind)), h('td', { class: 'mono nowrap', text: r.cnpj ? cnpj(r.cnpj) : r.input.cnpj || '' }),
          h('td', { text: r.name || '' }), h('td', { class: 'small', text: `${r.email || r.input.email || ''}${r.responsible === 'existente' ? ' (já tem acesso)' : ''}` }),
          h('td', { class: 'small' }, r.errors.join(' '), r.differences && Object.keys(r.differences).length ? `Diferenças: ${Object.entries(r.differences).map(([k, d]) => `${k}: "${d.atual || '—'}" → "${d.planilha}"`).join('; ')}` : '')))))),
      h('div', { class: 'card' }, h('label', { class: 'check' }, upd, 'Atualizar dados das empresas já cadastradas (diferenças acima)'),
        h('div', { class: 'field' }, h('label', { text: 'Módulos para as empresas novas' }), mods.map(m => h('label', { class: 'check' }, m.el, m.v))),
        h('label', { class: 'check' }, inv, 'Enviar convites aos responsáveis agora'), conf, result));
  }

  // ------------------------------------------------------------------ guias do mês (Etapa 4)
  async function viewGuides() {
    const now = new Date();
    const companies = state.me.companies.filter(c => c.modules.includes('documentos'));
    const f = { cnpj: h('select', {}, h('option', { value: '', text: 'Todas as empresas' }), companies.map(c => h('option', { value: c.cnpj, text: c.name }))),
      period: h('input', { type: 'month' }), year: h('input', { type: 'number', min: '2020', max: '2100', placeholder: String(now.getFullYear()) }),
      tax: h('select', {}, h('option', { value: '', text: 'Todos os tributos' }), Object.entries(TAX_OPTIONS).map(([k, v]) => h('option', { value: k, text: v }))),
      status: h('select', {}, [['', 'Todas'], ['disponivel', 'Disponíveis'], ['pendente', 'Pendentes'], ['vencida', 'Vencidas'], ['substituida', 'Substituídas'], ['arquivada', 'Arquivadas']].map(([v, t]) => h('option', { value: v, text: t }))) };
    const box = h('div');
    const load = async () => {
      const p = new URLSearchParams();
      if (f.cnpj.value) p.set('cnpj', f.cnpj.value);
      if (f.period.value) p.set('period', f.period.value);
      if (f.year.value) p.set('year', f.year.value);
      if (f.tax.value) p.set('tax_code', f.tax.value);
      if (f.status.value) p.set('status', f.status.value);
      const r = await api('GET', '/api/guides?' + p);
      box.replaceChildren(r.items.length ? h('div', { class: 'grid' }, r.items.map(guideCard)) : h('p', { class: 'muted', text: 'Nenhuma guia com esses filtros.' }),
        h('p', { class: 'small muted', text: r.payment_note }));
    };
    Object.values(f).forEach(el => el.addEventListener('change', () => load().catch(e => box.replaceChildren(errorBox(e)))));
    await load();
    return h('div', {}, h('h1', { text: 'Guias do Mês' }),
      h('div', { class: 'form-grid' }, companies.length > 1 || isStaff() ? field('Empresa', f.cnpj) : null, field('Competência', f.period), field('Ano', f.year), field('Tributo', f.tax), field('Situação', f.status)),
      box);
  }
  function guideCard(g) {
    const due = g.due_date ? day(g.due_date) : null;
    return h('div', { class: 'card guide-card' },
      h('div', { class: 'row between' }, h('strong', { text: `${g.tax_code || 'Guia'} — ${period(g.period)}` }), badge(GUIDE_AVAIL, g.availability)),
      h('div', { class: 'small muted', text: g.company_name }),
      h('div', { class: 'amount' }, g.amount === null ? h('span', { class: 'na', text: 'Valor não informado' }) : moneyText(g.amount)),
      h('div', {}, 'Vencimento: ', due ? h('strong', { text: due }) : h('span', { class: 'na', text: 'a confirmar' }),
        g.due_state === 'vencida' ? h('span', { class: 'badge bad', text: ' vencida — pagamento não confirmado' }) : null),
      h('div', { class: 'small' }, 'Pagamento: ', g.payment === 'pago' ? h('span', { class: 'badge ok', text: 'confirmado pelo escritório' }) : h('span', { class: 'muted', text: 'não informado' })),
      g.document_id ? h('div', { class: 'row' }, h('a', { class: 'btn', href: `/api/documents/${g.document_id}/download`, download: '' }, 'Baixar guia'),
        link(`/documentos/${g.document_id}`, 'Detalhes')) : h('div', { class: 'small muted', text: 'O escritório ainda não disponibilizou esta guia.' }));
  }

  // ------------------------------------------------------------- enviar documentos (cliente)
  async function viewSubmit() {
    const cats = (await api('GET', '/api/submissions/categories')).filter(c => c.active);
    const companies = state.me.companies.filter(c => c.modules.includes('documentos'));
    if (!companies.length) return h('div', { class: 'alert', text: 'O envio de documentos não está habilitado para suas empresas. Fale com o escritório.' });
    const company = h('select', {}, companies.map(c => h('option', { value: c.cnpj, text: c.name })));
    const category = h('select', {}, cats.map(c => h('option', { value: c.code, text: c.label })));
    const per = h('input', { type: 'month' });
    const desc = h('input', { placeholder: 'Opcional' });
    const resub = new URLSearchParams(__demoSearch()).get('reenviar');
    const input = h('input', { type: 'file', multiple: true, hidden: true });
    const drop = h('div', { class: 'drop', tabindex: '0', role: 'button', onclick: () => input.click(), onkeydown: e => (e.key === 'Enter' || e.key === ' ') && input.click() },
      'Arraste os arquivos aqui ou clique para escolher (PDF, XML, XLSX, CSV, imagens; até 50 MB cada)');
    const progress = h('progress', { max: '1', value: '0', hidden: true });
    const result = h('div');
    const history = h('div');
    const send = async files => {
      if (!files.length) return;
      const form = new FormData();
      [...files].forEach(x => form.append('files', x));
      form.append('category', category.value);
      if (per.value) form.append('period', per.value);
      if (desc.value) form.append('description', desc.value);
      if (resub) form.append('resubmission_of', resub);
      progress.hidden = false;
      try {
        const r = await uploadWithProgress(`/api/companies/${company.value}/submissions`, form, v => { progress.value = v; });
        result.replaceChildren(h('div', { class: `alert ${r.status === 'rejeitado' ? 'error' : 'ok'}`, text: r.status === 'rejeitado' ? `Envio bloqueado: ${r.rejection_reason}` : `Enviado! ${r.files.length} arquivo(s) aguardando conferência do escritório.` }));
        loadHistory();
      } catch (e) { result.replaceChildren(errorBox(e)); } finally { progress.hidden = true; input.value = ''; }
    };
    input.addEventListener('change', () => send(input.files));
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); send(e.dataTransfer.files); });
    const loadHistory = async () => {
      const list = await api('GET', '/api/submissions');
      history.replaceChildren(list.length ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Enviado em', 'Empresa', 'Categoria', 'Competência', 'Arquivos', 'Situação'].map(t => h('th', { text: t })))),
        h('tbody', {}, list.map(s => h('tr', {}, h('td', { class: 'small', text: dateTime(s.submitted_at) }), h('td', { class: 'small', text: s.company_name }),
          h('td', { text: (cats.find(c => c.code === s.category) || {}).label || s.category }), h('td', { text: period(s.period) }),
          h('td', { class: 'small' }, s.files.map(x => h('div', {}, x.available ? h('a', { href: `/api/submissions/${s.id}/files/${x.id}/download`, download: '' }, x.name) : `${x.name} (bloqueado)`))),
          h('td', {}, badge(SUB_STATUS, s.status), s.rejection_reason ? h('div', { class: 'small', text: s.rejection_reason }) : null,
            s.status === 'rejeitado' ? link(`/enviar-documentos?reenviar=${s.id}`, 'Reenviar', 'btn small') : null)))))) : h('p', { class: 'muted', text: 'Nenhum envio ainda.' }));
    };
    await loadHistory();
    return h('div', {}, h('h1', { text: 'Enviar documentos ao escritório' }),
      resub ? h('div', { class: 'alert warn', text: `Reenvio do envio #${resub} (rejeitado).` }) : null,
      h('div', { class: 'card' }, h('div', { class: 'form-grid' }, field('Empresa', company), field('Categoria', category), field('Competência', per), field('Descrição', desc)),
        drop, input, progress, result),
      h('h2', { text: 'Meus envios' }), history);
  }

  // ------------------------------------------------------------- documentos recebidos (equipe)
  async function viewInbox() {
    const cats = await api('GET', '/api/submissions/categories');
    const f = { status: h('select', {}, [['', 'Pendentes (recebido/em análise)'], ...Object.entries(SUB_STATUS).map(([k, [t]]) => [k, t])].map(([v, t]) => h('option', { value: v, text: t }))),
      category: h('select', {}, h('option', { value: '', text: 'Todas as categorias' }), cats.map(c => h('option', { value: c.code, text: c.label }))),
      period: h('input', { type: 'month' }), start: h('input', { type: 'date' }), end: h('input', { type: 'date' }) };
    const box = h('div');
    const load = async () => {
      const p = new URLSearchParams();
      Object.entries({ status: f.status.value, category: f.category.value, period: f.period.value, start: f.start.value, end: f.end.value }).forEach(([k, v]) => v && p.set(k, v));
      const list = await api('GET', '/api/inbox?' + p);
      box.replaceChildren(list.length ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Recebido em', 'Empresa', 'Categoria', 'Competência', 'Arquivos', 'Enviado por', 'Situação'].map(t => h('th', { text: t })))),
        h('tbody', {}, list.map(s => h('tr', {}, h('td', {}, link(`/recebidos/${s.id}`, dateTime(s.submitted_at))), h('td', { class: 'small', text: s.company_name }),
          h('td', { text: (cats.find(c => c.code === s.category) || {}).label || s.category }), h('td', { text: period(s.period) }), h('td', { text: String(s.files.length) }),
          h('td', { class: 'small', text: s.submitted_by || '—' }), h('td', {}, badge(SUB_STATUS, s.status)))))))
        : h('p', { class: 'muted', text: 'Nada aguardando triagem.' }));
    };
    Object.values(f).forEach(el => el.addEventListener('change', () => load().catch(e => box.replaceChildren(errorBox(e)))));
    await load();
    return h('div', {}, h('h1', { text: 'Documentos recebidos' }),
      h('div', { class: 'form-grid' }, field('Situação', f.status), field('Categoria', f.category), field('Competência', f.period), field('Enviado desde', f.start), field('Até', f.end)), box);
  }
  async function viewInboxItem(id) {
    const [s, cats] = await Promise.all([api('GET', `/api/submissions/${id}`), api('GET', '/api/submissions/categories')]);
    const category = h('select', {}, cats.map(c => h('option', { value: c.code, text: c.label }))); category.value = s.category;
    const per = h('input', { type: 'month', value: s.period || '' });
    const note = h('textarea', { value: s.internal_note || '' });
    const reason = h('input', { placeholder: 'Motivo (aparece para o cliente)' });
    const previewBox = h('div');
    const act = (label, status, cls = '') => {
      const b = h('button', { class: `btn ${cls}`, type: 'button' }, label);
      b.addEventListener('click', busy(b, async () => {
        await api('POST', `/api/inbox/${s.id}/review`, { status, reason: status === 'rejeitado' ? reason.value : null, internal_note: note.value, category: category.value, period: per.value || '' });
        toast('Envio atualizado.'); render();
      }));
      return b;
    };
    const save = h('button', { class: 'btn secondary', type: 'button' }, 'Salvar classificação e observação');
    save.addEventListener('click', busy(save, async () => { await api('POST', `/api/inbox/${s.id}/review`, { internal_note: note.value, category: category.value, period: per.value || '' }); toast('Salvo.'); }));
    const next = { recebido: [act('Em análise', 'em_analise', 'secondary'), act('Aceitar', 'aceito'), act('Rejeitar', 'rejeitado', 'danger')],
      em_analise: [act('Aceitar', 'aceito'), act('Rejeitar', 'rejeitado', 'danger')], aceito: [act('Arquivar', 'arquivado', 'secondary')],
      rejeitado: [act('Arquivar', 'arquivado', 'secondary')], arquivado: [] }[s.status];
    return h('div', {}, h('p', { class: 'small' }, link('/recebidos', '← Documentos recebidos')),
      h('h1', { text: `Envio #${s.id} — ${s.company_name}` }),
      h('div', { class: 'row' }, badge(SUB_STATUS, s.status), h('span', { class: 'muted', text: `enviado por ${s.submitted_by || '—'} em ${dateTime(s.submitted_at)}` })),
      s.description ? h('p', { text: s.description }) : null,
      s.rejection_reason ? h('div', { class: 'alert error', text: `Motivo informado ao cliente: ${s.rejection_reason}` }) : null,
      h('div', { class: 'card' }, h('h3', { class: 'mt0', text: 'Arquivos' }), h('ul', {}, s.files.map(x => h('li', {},
        x.available ? h('a', { href: `/api/submissions/${s.id}/files/${x.id}/download`, download: '' }, x.name) : `${x.name} — bloqueado pelo antivírus`,
        ` (${bytes(x.size)}) `,
        x.available && x.name.toLowerCase().endsWith('.pdf') && can('fiscal:import') ? h('button', { class: 'btn small secondary', type: 'button', onclick: async () => {
          try { const r = await api('POST', `/api/inbox/${s.id}/files/${x.id}/fiscal-preview`); showPreview(previewBox, { ...r, already_exists: false, note: 'Prévia a partir do documento recebido.' }); }
          catch (e) { previewBox.replaceChildren(errorBox(e)); }
        } }, 'Ler no Painel Fiscal') : null))), previewBox),
      h('div', { class: 'card' }, h('h3', { class: 'mt0', text: 'Conferência' }),
        h('div', { class: 'form-grid' }, field('Categoria', category), field('Competência', per)), field('Observação interna (não aparece para o cliente)', note), save,
        next.length ? h('div', {}, h('h3', { text: 'Decisão' }), s.status !== 'aceito' ? field('Motivo da rejeição', reason) : null, h('div', { class: 'row' }, next)) : null));
  }

  render();
})();
