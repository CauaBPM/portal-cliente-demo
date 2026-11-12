/* Servidor SIMULADO da demonstração estática (GitHub Pages).
 *
 * O portal de verdade fala com uma API em Python. Aqui não há servidor: este arquivo responde no próprio
 * navegador com as respostas REAIS gravadas do portal rodando com dados fictícios (demo-data.js).
 * Algumas ações (marcar como lida, analisar envio, enviar documento, confirmar pagamento, convidar usuário)
 * mudam o estado nesta aba; o resto é aceito sem efeito. Nada sai do navegador.
 */
(function () {
  'use strict';
  const DATA = window.__DEMO_DATA__ || {};
  const SENHA = 'demo';
  const CODIGO = '123456';
  const CONTAS = { 'cliente@demo.test': 'cliente', 'funcionaria@demo.test': 'funcionaria', 'admin@demo.test': 'admin' };
  const STAFF = { funcionaria: true, admin: true };

  // ------------------------------------------------------------------ rotas por "#" (GitHub Pages)
  window.__demoPath = () => (location.hash.replace(/^#/, '').split('?')[0] || '/');
  window.__demoSearch = () => { const i = location.hash.indexOf('?'); return i >= 0 ? location.hash.slice(i) : ''; };
  window.__demoNav = (kind, path) => {
    const url = location.pathname + location.search + '#' + path;
    if (kind === 'pushState') history.pushState({}, '', url); else history.replaceState({}, '', url);
  };

  // ----------------------------------------------------------------------------- estado da aba
  const load = (k, d) => { try { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const save = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento: só memória */ } };
  let perfil = load('demo-perfil', null);
  let pendente = null; // perfil aguardando o código de 2FA
  const extras = load('demo-alteracoes', {}); // respostas alteradas nesta aba, por perfil
  const persist = () => save('demo-alteracoes', extras);

  function normKey(url) {
    const u = new URL(url, location.origin);
    const params = [...u.searchParams.entries()].filter(([, v]) => v !== '').sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
    const q = new URLSearchParams(params).toString();
    return { full: u.pathname + (q ? '?' + q : ''), path: u.pathname, params: Object.fromEntries(params) };
  }
  function base(p) { return DATA[p] || {}; }
  function lookup(k) {
    const own = (extras[perfil] || {});
    if (k.full in own) return own[k.full];
    if (k.path in own) return own[k.path];
    const d = base(perfil);
    if (k.full in d) return clone(d[k.full]);
    if (k.path in d) return clone(d[k.path]);
    // Filtros não gravados: usa a resposta gravada do mesmo endereço (a lista completa).
    const near = Object.keys(own).concat(Object.keys(d)).find(x => x.startsWith(k.path + '?'));
    if (near) return near in own ? own[near] : clone(d[near]);
    return undefined;
  }
  const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  function put(path, value) { (extras[perfil] = extras[perfil] || {})[path] = value; persist(); }
  function current(path) { const v = lookup({ full: path, path }); return v === undefined ? [] : v; }
  function updateEverywhere(match, change) {
    // Aplica a mudança em todas as respostas gravadas que contêm o item (listas e detalhes).
    const d = base(perfil);
    const keys = new Set([...Object.keys(d), ...Object.keys(extras[perfil] || {})]);
    keys.forEach(k => {
      const v = lookup({ full: k, path: k });
      if (v === undefined) return;
      let changed = false;
      const visit = o => {
        if (Array.isArray(o)) o.forEach(visit);
        else if (o && typeof o === 'object') { if (match(o)) { change(o); changed = true; } Object.values(o).forEach(visit); }
      };
      visit(v);
      if (changed) put(k, v);
    });
  }
  const nowIso = () => new Date().toISOString();

  // ------------------------------------------------------------------------------- respostas
  const json = (status, body) => ({ status, body });
  const erro = (status, msg) => json(status, { error: msg });
  const SIMULADO = { ok: true, message: 'Demonstração: ação simulada, nada foi gravado.' };

  function login(body) {
    const p = CONTAS[(body.email || '').trim().toLowerCase()];
    if (!p || body.password !== SENHA) return erro(401, 'E-mail ou senha incorretos. Na demonstração, a senha de todas as contas é "demo".');
    // Na demonstração nenhum perfil pede o código de 2FA (no sistema real, equipe e administrador pedem).
    return entrar(p);
  }
  function entrar(p) {
    perfil = p; pendente = null; save('demo-perfil', p);
    return json(200, { status: 'ok', csrf_token: 'demo', user: lookup({ full: '/api/auth/me', path: '/api/auth/me' }) });
  }

  function handle(method, url, body) {
    const k = normKey(url);
    const p = k.path;
    if (p === '/api/auth/login') return login(body || {});
    if (p === '/api/auth/login/mfa') {
      const alvo = pendente || ((body && body.mfa_token) || '').replace('demo-', '');
      if (!CONTAS[alvo + '@demo.test'] && !STAFF[alvo]) return erro(401, 'Sessão de login expirada. Entre de novo.');
      if ((body.code || '').trim() !== CODIGO && !body.recovery_code) return erro(401, `Código inválido. Na demonstração, o código é ${CODIGO}.`);
      return entrar(alvo);
    }
    if (p === '/api/auth/refresh') return perfil ? json(200, { ok: true }) : erro(401, 'Sessão expirada.');
    if (p === '/api/auth/logout' || p === '/api/auth/logout-all') { perfil = null; save('demo-perfil', null); return json(204, null); }
    if (p === '/api/auth/password/forgot') return json(202, { message: 'Se o e-mail estiver cadastrado, você receberá as instruções em instantes. (Na demonstração nenhum e-mail é enviado.)' });
    if (p.startsWith('/api/auth/') && method !== 'GET' && !perfil) return erro(400, 'Indisponível na demonstração.');
    if (!perfil) return erro(401, 'Não autenticado.');

    if (method === 'GET') {
      const v = lookup(k);
      if (v !== undefined) return json(200, v);
      if (/^\/api\/(notifications|guides|submissions|obligations|inbox|companies\/\d+\/(documents|records)|admin\/(holidays|users|audit))/.test(p)) return json(200, []);
      return erro(404, 'Esta informação não faz parte da demonstração.');
    }

    // ---- ações que mudam o que aparece na tela
    let m;
    if ((m = p.match(/^\/api\/notifications\/(\d+)\/read$/))) {
      updateEverywhere(o => o.id === +m[1] && 'read_at' in o, o => { o.read_at = nowIso(); });
      return json(200, SIMULADO);
    }
    if (p === '/api/notifications/read-all') { updateEverywhere(o => 'read_at' in o && !o.read_at, o => { o.read_at = nowIso(); }); return json(200, SIMULADO); }
    if ((m = p.match(/^\/api\/inbox\/(\d+)\/review$/))) {
      updateEverywhere(o => o.id === +m[1] && 'category' in o && 'status' in o, o => {
        o.status = body.status; if (body.rejection_reason) o.rejection_reason = body.rejection_reason;
        o.reviewed_at = nowIso();
      });
      return json(200, { ok: true, status: body.status });
    }
    if ((m = p.match(/^\/api\/documents\/(\d+)\/payment$/))) {
      if (body.status === 'pago' && (body.note || '').trim().length < 3) return erro(422, 'Informe a fonte da confirmação (ex.: comprovante recebido, consulta ao e-CAC).');
      updateEverywhere(o => (o.id === +m[1] || o.document_id === +m[1]) && 'payment' in o, o => { o.payment = body.status; if (body.status === 'pago') o.due_state = null; });
      updateEverywhere(o => o.id === +m[1] && 'payment_status' in o, o => { o.payment_status = body.status; });
      return json(200, { payment: body.status });
    }
    if (p === '/api/admin/users' && method === 'POST') {
      const users = current('/api/admin/users');
      const novo = { id: 100 + users.length, email: body.email, full_name: body.full_name, user_type: body.user_type, is_active: true,
        mfa_enabled: false, status: 'convidado', invite_pending: true, companies: (body.company_cnpjs || []).map(c => ({ cnpj: c })), created_at: nowIso() };
      users.push(novo); put('/api/admin/users', users);
      return json(201, novo);
    }
    return json(200, SIMULADO);
  }

  function handleUpload(url, form) {
    const k = normKey(url);
    const files = form ? form.getAll('files').concat(form.getAll('file')).filter(f => f && f.name) : [];
    let m;
    if ((m = k.path.match(/^\/api\/companies\/(\d{14})\/documents$/))) {
      const listKey = `/api/companies/${m[1]}/documents`;
      const docs = current(listKey);
      const results = files.map((f, i) => {
        const id = 900 + docs.length + i;
        docs.unshift({ id, company: m[1], module: 'documentos', doc_type: form.get('doc_type'), doc_type_label: form.get('doc_type'),
          period: form.get('period') || null, title: f.name, status: 'available', current_version: 1, created_at: nowIso(),
          available_at: nowIso(), file: { name: f.name, size: f.size } });
        return { file: f.name, ok: true, document_id: id, status: 'available', error: null, link: null };
      });
      put(listKey, docs);
      return json(200, { results, uploaded: results.length, failed: 0 });
    }
    if ((m = k.path.match(/^\/api\/companies\/(\d{14})\/submissions$/))) {
      const subs = current('/api/submissions');
      const model = subs[0] || {};
      const novo = Object.assign(clone(model), { id: 900 + subs.length, company: m[1], category: form.get('category'),
        period: form.get('period'), description: form.get('description') || '', status: 'recebido', submitted_at: nowIso(),
        files: files.map((f, i) => ({ id: 9000 + i, name: f.name, size: f.size, blocked: false, available: true })) });
      subs.unshift(novo); put('/api/submissions', subs);
      return json(201, novo);
    }
    return json(200, Object.assign({ results: files.map(f => ({ file: f.name, ok: true })), uploaded: files.length, failed: 0 }, SIMULADO));
  }

  // ------------------------------------------------------------------- troca do fetch e do XHR
  const realFetch = window.fetch.bind(window);
  const isApi = u => typeof u === 'string' && (u.startsWith('/api/') || u.startsWith(location.origin + '/api/'));
  const toResponse = r => new Response(r.status === 204 || r.body === null ? null : JSON.stringify(r.body),
    { status: r.status, headers: { 'content-type': 'application/json' } });
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!isApi(url)) return realFetch(input, init);
    const method = (init.method || 'GET').toUpperCase();
    let body = init.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* corpo não-JSON */ } }
    await new Promise(r => setTimeout(r, 120)); // pequena espera, como uma rede de verdade
    if (body instanceof FormData) return toResponse(handleUpload(url, body));
    return toResponse(handle(method, url, body));
  };

  const RealXHR = window.XMLHttpRequest;
  function FakeXHR() { this.upload = {}; this.status = 0; this.responseText = ''; this._real = null; }
  FakeXHR.prototype.open = function (method, url) {
    this._method = method; this._url = url;
    if (!isApi(url)) { this._real = new RealXHR(); this._real.open(method, url); }
  };
  FakeXHR.prototype.setRequestHeader = function (k, v) { if (this._real) this._real.setRequestHeader(k, v); };
  FakeXHR.prototype.send = function (body) {
    if (this._real) { this._real.onload = this.onload; this._real.onerror = this.onerror; return this._real.send(body); }
    let step = 0;
    const tick = () => {
      step += 1;
      if (this.upload.onprogress) this.upload.onprogress({ lengthComputable: true, loaded: step, total: 5 });
      if (step < 5) return setTimeout(tick, 120);
      const r = body instanceof FormData ? handleUpload(this._url, body) : handle(this._method, this._url, body);
      this.status = r.status; this.responseText = r.body === null ? '' : JSON.stringify(r.body);
      if (this.onload) this.onload();
    };
    setTimeout(tick, 120);
  };
  window.XMLHttpRequest = FakeXHR;

  // ----------------------------------------------------------------------------- downloads
  const PDF_VAZIO = 'JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNTk1IDg0Ml0+PmVuZG9iagp0cmFpbGVyPDwvUm9vdCAxIDAgUj4+CiUlRU9G';
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href^="/api/"]');
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    const k = normKey(a.getAttribute('href'));
    const rec = perfil ? lookup(k) : undefined;
    const b64 = rec && rec.__binary__ ? rec.__binary__ : PDF_VAZIO;
    const type = (rec && rec.type) || 'application/pdf';
    const name = ((rec && rec.disposition) || '').match(/filename\*=UTF-8''([^;]+)/);
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const href = URL.createObjectURL(new Blob([bytes], { type }));
    const link = document.createElement('a');
    link.href = href; link.download = name ? decodeURIComponent(name[1]) : 'documento-ficticio.pdf';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 2000);
  }, true);

  // ------------------------------------------------------------------------------ faixa de aviso
  function banner() {
    if (document.getElementById('demo-faixa')) return;
    const bar = document.createElement('div');
    bar.id = 'demo-faixa';
    bar.innerHTML = '<strong>DEMONSTRAÇÃO</strong> · dados fictícios · nada é salvo · ' +
      'contas: <code>cliente@demo.test</code>, <code>funcionaria@demo.test</code>, <code>admin@demo.test</code> · ' +
      'senha <code>demo</code>';
    document.body.prepend(bar);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner); else banner();
})();
