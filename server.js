'use strict';
/*
 * Sistema de Mudança de Imobiliária — servidor próprio (Node.js >= 18, sem dependências).
 * Login: Microsoft Entra ID (OpenID Connect). Dados: arquivo JSON em ./data (use disco persistente).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/* ------------------------------ .env ------------------------------ */
function carregarEnv(arq) {
  if (!fs.existsSync(arq)) return;
  for (const linha of fs.readFileSync(arq, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
carregarEnv(path.join(__dirname, '.env'));
const env = process.env;

const PORT = parseInt(env.PORT || '3000', 10);
const BASE_URL = (env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const AUTH_MODE = env.AUTH_MODE || 'microsoft'; // 'microsoft' | 'dev'
const DATA_DIR = env.DATA_DIR ? path.resolve(env.DATA_DIR) : path.join(__dirname, 'data');
const SEGURO = BASE_URL.startsWith('https://');
const SECRET = env.SESSION_SECRET || '';
const CLIENT_ID = env.MS_CLIENT_ID || '';
const CLIENT_SECRET = env.MS_CLIENT_SECRET || '';
const TENANTS = { 'victa.eng.br': env.VICTA_TENANT_ID || '', 'diagonalinc.com.br': env.DIAGONAL_TENANT_ID || '' };

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'base.json'), 'utf8'));
const DOMINIOS = CONFIG.dominiosPermitidos.map((d) => d.toLowerCase());
const ADMINS = (CONFIG.administradores || []).map((e) => e.toLowerCase());
const APROVADORES = CONFIG.aprovadores; // nome -> {chave, apelido, email, whatsapp}
const POR_EMAIL = {};
for (const [nome, a] of Object.entries(APROVADORES)) POR_EMAIL[a.email.toLowerCase()] = nome;

const ST = { AG: 'Aguardando aprovação', OK: 'Aprovado', NO: 'Não aprovado', INF: 'Informativo', CAN: 'Cancelada' };

if (require.main === module) {
  if (AUTH_MODE === 'microsoft') {
    const faltas = ['SESSION_SECRET', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'VICTA_TENANT_ID'].filter((k) => !env[k]);
    if (faltas.length) { console.error('Faltam variáveis no .env: ' + faltas.join(', ')); process.exit(1); }
  } else if (AUTH_MODE === 'dev') {
    console.warn('\n*** AUTH_MODE=dev: QUALQUER PESSOA entra com qualquer e-mail. Use somente para testes. ***\n');
  }
  if (SECRET.length < 32 && AUTH_MODE !== 'dev') { console.error('SESSION_SECRET precisa ter 32+ caracteres.'); process.exit(1); }
}
const SEGREDO = SECRET || crypto.randomBytes(32).toString('hex'); // dev: muda a cada início

/* ------------------------------ armazenamento ------------------------------ */
const ARQ = () => path.join(DATA_DIR, 'solicitacoes.json');
let solicitacoes = [];
function carregar() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  solicitacoes = fs.existsSync(ARQ()) ? JSON.parse(fs.readFileSync(ARQ(), 'utf8')) : [];
}
function salvar() {
  const tmp = ARQ() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(solicitacoes));
  fs.renameSync(tmp, ARQ());
}
function auditar(evento) {
  try { fs.appendFileSync(path.join(DATA_DIR, 'auditoria.log'), JSON.stringify({ em: new Date().toISOString(), ...evento }) + '\n'); } catch (e) { /* ignora */ }
}

/* ------------------------------ regras de negócio ------------------------------ */
function aprovadoresDaTroca(corretor, nova) {
  if (corretor.g === 'SEM EQUIPE') return [];
  const out = [corretor.g];
  const g2 = BASE.equipeDaImobiliaria[nova] || '';
  if (g2 && g2 !== corretor.g && g2 !== 'SEM EQUIPE') out.push(g2);
  return out.filter((g) => APROVADORES[g]);
}
function visao(r) {
  const req = r.aprovadores || [];
  const ap = r.aprovacoes || {};
  let status, ult = null;
  for (const g of req) { const x = ap[APROVADORES[g].chave]; if (x && (!ult || x.data > ult.data)) ult = x; }
  if (r.cancelamento) status = ST.CAN;
  else if (!req.length) status = ST.INF;
  else if (req.some((g) => ap[APROVADORES[g].chave] && ap[APROVADORES[g].chave].decisao === ST.NO)) status = ST.NO;
  else if (req.every((g) => ap[APROVADORES[g].chave] && ap[APROVADORES[g].chave].decisao === ST.OK)) status = ST.OK;
  else status = ST.AG;
  return { status, dataDecisao: status === ST.OK || status === ST.NO ? (ult && ult.data) || '' : '' };
}
function pendentes(r) {
  const ap = r.aprovacoes || {};
  return (r.aprovadores || []).filter((g) => !ap[APROVADORES[g].chave]);
}
function emailValido(e) {
  const m = /^[^\s@]+@([^\s@]+)$/.exec(e || '');
  return !!m && DOMINIOS.includes(m[1].toLowerCase());
}
function dominioDe(e) { return (e.split('@')[1] || '').toLowerCase(); }

/* usuário autorizado: domínio permitido e, no modo Microsoft, tenant correspondente ao domínio */
function autorizado(u) {
  if (!u || !emailValido(u.e)) return false;
  if (AUTH_MODE === 'dev') return true;
  const tid = TENANTS[dominioDe(u.e)];
  return !!tid && u.t === tid;
}
function slotDoUsuario(u) { return autorizado(u) ? POR_EMAIL[u.e] || null : null; }
function ehAdmin(u) { return autorizado(u) && ADMINS.includes(u.e); }

function paraCliente(r, u) {
  const v = visao(r);
  const slot = slotDoUsuario(u);
  const podeDecidir = !!slot && v.status === ST.AG && pendentes(r).includes(slot);
  const podeCancelar = (v.status === ST.AG || v.status === ST.INF) && (ehAdmin(u) || r.emailSolicitante === u.e);
  const aprovacoes = {};
  for (const [k, x] of Object.entries(r.aprovacoes || {})) aprovacoes[k] = { decisao: x.decisao, data: x.data, nome: x.nome };
  return {
    id: r.id, protocolo: r.protocolo, corretor: r.corretor, documento: r.documento,
    imobiliariaAntiga: r.imobiliariaAntiga, imobiliariaNova: r.imobiliariaNova,
    solicitante: r.solicitante, emailSolicitante: r.emailSolicitante,
    aprovadores: r.aprovadores, aprovacoes, status: v.status, dataDecisao: v.dataDecisao,
    dataSolicitacao: r.dataSolicitacao, cancelamento: r.cancelamento || null,
    gerente: r.gerente, acoes: { decidir: podeDecidir ? slot : null, cancelar: podeCancelar },
  };
}

/* ------------------------------ sessão (cookie assinado) ------------------------------ */
function assinar(obj) {
  const p = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return p + '.' + crypto.createHmac('sha256', SEGREDO).update(p).digest('base64url');
}
function verificarAssinatura(s) {
  if (!s) return null;
  const i = s.lastIndexOf('.');
  if (i < 0) return null;
  const p = s.slice(0, i), m = s.slice(i + 1);
  const e = crypto.createHmac('sha256', SEGREDO).update(p).digest('base64url');
  if (m.length !== e.length || !crypto.timingSafeEqual(Buffer.from(m), Buffer.from(e))) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.x && o.x < Date.now() ? null : o; } catch (e2) { return null; }
}
function cookies(req) {
  const o = {};
  for (const par of (req.headers.cookie || '').split(';')) { const i = par.indexOf('='); if (i > 0) o[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim()); }
  return o;
}
function setCookie(res, nome, valor, maxAgeSeg) {
  const attrs = [`${nome}=${encodeURIComponent(valor)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeg}`];
  if (SEGURO) attrs.push('Secure');
  const atual = res.getHeader('Set-Cookie') || [];
  res.setHeader('Set-Cookie', [].concat(atual, attrs.join('; ')));
}
function usuarioDe(req) { return verificarAssinatura(cookies(req).sid); }
function iniciarSessao(res, u) { setCookie(res, 'sid', assinar({ ...u, x: Date.now() + 8 * 3600 * 1000 }), 8 * 3600); }

/* ------------------------------ Microsoft Entra ID (OIDC) ------------------------------ */
let jwksCache = { chaves: null, em: 0 };
async function obterJwks() {
  if (jwksCache.chaves && Date.now() - jwksCache.em < 3600e3) return jwksCache.chaves;
  const r = await fetch('https://login.microsoftonline.com/common/discovery/v2.0/keys');
  if (!r.ok) throw new Error('JWKS indisponível');
  jwksCache = { chaves: (await r.json()).keys, em: Date.now() };
  return jwksCache.chaves;
}
/* verifica assinatura RS256 e as declarações do id_token; "chaves" = lista JWKS */
function verificarIdToken(token, chaves, { clientId, nonce, agora = Date.now() }) {
  const partes = String(token).split('.');
  if (partes.length !== 3) throw new Error('token malformado');
  const cab = JSON.parse(Buffer.from(partes[0], 'base64url').toString());
  const cor = JSON.parse(Buffer.from(partes[1], 'base64url').toString());
  if (cab.alg !== 'RS256') throw new Error('algoritmo inválido');
  const jwk = chaves.find((k) => k.kid === cab.kid);
  if (!jwk) throw new Error('chave desconhecida');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(partes[0] + '.' + partes[1]), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(partes[2], 'base64url'));
  if (!ok) throw new Error('assinatura inválida');
  if (cor.aud !== clientId) throw new Error('audiência inválida');
  if (!cor.tid || cor.iss !== `https://login.microsoftonline.com/${cor.tid}/v2.0`) throw new Error('emissor inválido');
  if (!cor.exp || cor.exp * 1000 < agora) throw new Error('token expirado');
  if (cor.nbf && cor.nbf * 1000 > agora + 60e3) throw new Error('token ainda não válido');
  if (!nonce || cor.nonce !== nonce) throw new Error('nonce inválido');
  return cor;
}

/* ------------------------------ HTTP ------------------------------ */
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const ESTATICOS = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };

function cabecalhos(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (SEGURO) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}
function json(res, codigo, obj) {
  res.statusCode = codigo;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}
function redirecionar(res, url) { res.statusCode = 302; res.setHeader('Location', url); res.end(); }
function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let t = 0; const partes = [];
    req.on('data', (c) => { t += c.length; if (t > 20000) { reject(new Error('grande')); req.destroy(); } else partes.push(c); });
    req.on('end', () => resolve(Buffer.concat(partes).toString()));
    req.on('error', reject);
  });
}
async function corpoJson(req) {
  try { return JSON.parse((await lerCorpo(req)) || '{}'); } catch (e) { return null; }
}
function origemOk(req) {
  const o = req.headers.origin;
  return !o || o === new URL(BASE_URL).origin;
}
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const protocolo = () => 'SOL-' + new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).replace(/-/g, '') + '-' + crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4);

async function tratar(req, res) {
  cabecalhos(res);
  const url = new URL(req.url, BASE_URL);
  const rota = url.pathname;
  const metodo = req.method;

  if (metodo === 'GET' && ESTATICOS[rota]) {
    const arq = ESTATICOS[rota];
    res.statusCode = 200;
    res.setHeader('Content-Type', TIPOS[path.extname(arq)]);
    return res.end(fs.readFileSync(path.join(__dirname, 'public', arq)));
  }

  /* ---- login ---- */
  if (metodo === 'GET' && rota === '/login') {
    if (AUTH_MODE === 'dev') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end('<meta charset="utf-8"><title>Entrar (teste)</title><body style="font:16px sans-serif;max-width:420px;margin:60px auto"><h2>Entrar (modo de teste)</h2><form method="post" action="/dev-login"><p><input name="email" placeholder="e-mail" style="width:100%;padding:8px"></p><p><input name="nome" placeholder="nome" style="width:100%;padding:8px"></p><button style="padding:8px 16px">Entrar</button></form></body>');
    }
    const state = crypto.randomBytes(16).toString('hex'), nonce = crypto.randomBytes(16).toString('hex');
    setCookie(res, 'oidc', assinar({ s: state, n: nonce, x: Date.now() + 10 * 60e3 }), 600);
    const q = new URLSearchParams({
      client_id: CLIENT_ID, response_type: 'code', redirect_uri: BASE_URL + '/auth/callback', response_mode: 'query',
      scope: 'openid profile email', state, nonce, prompt: 'select_account',
    });
    return redirecionar(res, 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?' + q);
  }
  if (metodo === 'POST' && rota === '/dev-login' && AUTH_MODE === 'dev') {
    const p = new URLSearchParams(await lerCorpo(req));
    iniciarSessao(res, { e: String(p.get('email') || '').trim().toLowerCase(), n: String(p.get('nome') || '').trim(), t: 'dev', o: 'dev' });
    return redirecionar(res, '/');
  }
  if (metodo === 'GET' && rota === '/auth/callback' && AUTH_MODE === 'microsoft') {
    try {
      const c = verificarAssinatura(cookies(req).oidc);
      if (!c || url.searchParams.get('state') !== c.s || !url.searchParams.get('code')) throw new Error('estado inválido');
      const r = await fetch('https://login.microsoftonline.com/organizations/oauth2/v2.0/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: BASE_URL + '/auth/callback' }),
      });
      const t = await r.json();
      if (!t.id_token) throw new Error('sem id_token');
      const cor = verificarIdToken(t.id_token, await obterJwks(), { clientId: CLIENT_ID, nonce: c.n });
      const email = String(cor.email || cor.preferred_username || cor.upn || '').toLowerCase();
      const u = { e: email, n: cor.name || '', t: cor.tid, o: cor.oid };
      if (!autorizado(u)) { auditar({ evento: 'login_negado', email, tid: cor.tid }); return redirecionar(res, '/?erro=acesso'); }
      auditar({ evento: 'login', email });
      iniciarSessao(res, u);
      return redirecionar(res, '/');
    } catch (e) {
      auditar({ evento: 'login_erro', msg: String(e.message) });
      return redirecionar(res, '/?erro=login');
    }
  }
  if (rota === '/logout') { setCookie(res, 'sid', '', 0); return redirecionar(res, '/'); }

  /* ---- API (exige sessão autorizada) ---- */
  if (!rota.startsWith('/api/')) { res.statusCode = 404; return res.end('Não encontrado'); }
  const u = usuarioDe(req);
  if (!autorizado(u)) return json(res, 401, { erro: 'login' });
  if (metodo !== 'GET' && !origemOk(req)) return json(res, 403, { erro: 'origem' });

  if (metodo === 'GET' && rota === '/api/me') {
    return json(res, 200, { email: u.e, nome: u.n, aprovador: slotDoUsuario(u), admin: ehAdmin(u) });
  }
  if (metodo === 'GET' && rota === '/api/config') {
    return json(res, 200, {
      urlSistema: BASE_URL, imobiliarias: BASE.imobiliarias, equipeDaImobiliaria: BASE.equipeDaImobiliaria,
      aprovadores: APROVADORES, executores: CONFIG.executores, dominios: DOMINIOS,
    });
  }
  if (metodo === 'GET' && rota === '/api/corretores') {
    const q = String(url.searchParams.get('q') || '').trim();
    if (q.length < 3) return json(res, 200, []);
    const qn = norm(q), qd = q.replace(/\D/g, ''), toks = qn.split(/\s+/).filter(Boolean), out = [];
    for (const c of BASE.corretores) {
      if (out.length >= 8) break;
      if ((qd.length >= 3 && c.d.includes(qd)) || toks.every((t) => norm(c.n).includes(t))) out.push(c);
    }
    return json(res, 200, out);
  }
  if (metodo === 'GET' && rota === '/api/solicitacoes') {
    const lista = solicitacoes.slice().sort((a, b) => (a.dataSolicitacao < b.dataSolicitacao ? 1 : -1)).slice(0, 1000);
    return json(res, 200, lista.map((r) => paraCliente(r, u)));
  }

  if (metodo === 'POST' && rota === '/api/solicitacoes') {
    const b = await corpoJson(req);
    if (!b) return json(res, 400, { erro: 'JSON inválido' });
    const c = BASE.corretores.find((x) => x.d === String(b.documento || '').replace(/\D/g, ''));
    if (!c) return json(res, 400, { erro: 'Corretor não encontrado.' });
    if (!BASE.imobiliarias.includes(b.nova) || b.nova === c.i) return json(res, 400, { erro: 'Nova imobiliária inválida.' });
    const nome = String(b.solicitante || '').trim();
    if (nome.length < 3 || nome.length > 120) return json(res, 400, { erro: 'Informe o nome do solicitante.' });
    const aprov = aprovadoresDaTroca(c, b.nova);
    const dup = solicitacoes.some((r) => r.documento === c.d && visao(r).status === ST.AG);
    if (dup) return json(res, 409, { erro: 'Já existe uma solicitação aguardando aprovação para este corretor.' });
    const r = {
      id: crypto.randomBytes(10).toString('hex'), protocolo: protocolo(), corretor: c.n, documento: c.d,
      imobiliariaAntiga: c.i, imobiliariaNova: b.nova, solicitante: nome, emailSolicitante: u.e, /* sempre o e-mail do login */
      gerente: c.g === 'SEM EQUIPE' ? 'SEM EQUIPE' : c.g, aprovadores: aprov, aprovacoes: {},
      dataSolicitacao: new Date().toISOString(),
    };
    solicitacoes.push(r); salvar(); auditar({ evento: 'solicitacao', id: r.id, por: u.e, corretor: c.n });
    return json(res, 201, paraCliente(r, u));
  }

  const m = rota.match(/^\/api\/solicitacoes\/([0-9a-f]{20})\/(decisao|cancelar)$/);
  if (metodo === 'POST' && m) {
    const r = solicitacoes.find((x) => x.id === m[1]);
    if (!r) return json(res, 404, { erro: 'Solicitação não encontrada.' });
    const v = visao(r);
    if (m[2] === 'decisao') {
      const b = await corpoJson(req);
      const slot = slotDoUsuario(u);
      if (!slot) return json(res, 403, { erro: 'Somente Felipe ou Anderson, com a própria conta, podem aprovar.' });
      if (!b || (b.decisao !== ST.OK && b.decisao !== ST.NO)) return json(res, 400, { erro: 'Decisão inválida.' });
      if (v.status !== ST.AG || !pendentes(r).includes(slot)) return json(res, 409, { erro: 'Esta etapa não está mais pendente.' });
      r.aprovacoes[APROVADORES[slot].chave] = { decisao: b.decisao, data: new Date().toISOString(), por: u.e, nome: slot };
      salvar(); auditar({ evento: 'decisao', id: r.id, slot, decisao: b.decisao, por: u.e });
      return json(res, 200, paraCliente(r, u));
    }
    if (!(v.status === ST.AG || v.status === ST.INF)) return json(res, 409, { erro: 'Esta solicitação já foi decidida e não pode ser cancelada.' });
    if (!(ehAdmin(u) || r.emailSolicitante === u.e)) return json(res, 403, { erro: 'Somente quem solicitou pode cancelar.' });
    r.cancelamento = { em: new Date().toISOString(), por: u.e };
    salvar(); auditar({ evento: 'cancelamento', id: r.id, por: u.e });
    return json(res, 200, paraCliente(r, u));
  }
  return json(res, 404, { erro: 'rota' });
}

function criarServidor() {
  carregar();
  return http.createServer((req, res) => {
    tratar(req, res).catch((e) => { console.error(e); if (!res.headersSent) json(res, 500, { erro: 'Erro interno.' }); else res.end(); });
  });
}
if (require.main === module) {
  criarServidor().listen(PORT, () => console.log(`Sistema no ar em ${BASE_URL} (porta ${PORT}, modo ${AUTH_MODE})`));
}
module.exports = { criarServidor, verificarIdToken, aprovadoresDaTroca, visao };
