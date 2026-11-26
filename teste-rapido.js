'use strict';
/* Testes do servidor em modo de teste. Uso: node teste-rapido.js  (não toca nos seus dados reais) */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smi-'));
process.env.AUTH_MODE = 'dev'; process.env.DATA_DIR = dir; process.env.PORT = '0'; process.env.BASE_URL = 'http://localhost:3999';
const { criarServidor, verificarIdToken } = require('./server.js');

let falhas = 0, total = 0;
function ok(cond, nome) { total++; if (!cond) { falhas++; console.log('  FALHOU:', nome); } else console.log('  ok:', nome); }

async function main() {
  const srv = criarServidor(); await new Promise((r) => srv.listen(0, r));
  const base = 'http://localhost:' + srv.address().port;
  async function entrar(email, nome) {
    const r = await fetch(base + '/dev-login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, nome }) });
    return (r.headers.get('set-cookie') || '').split(';')[0];
  }
  async function chamar(ck, metodo, rota, corpo) {
    const r = await fetch(base + rota, { method: metodo, headers: { Cookie: ck || '', ...(corpo ? { 'Content-Type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
    let j = null; try { j = await r.json(); } catch (e) { /* */ } return { s: r.status, j };
  }
  const base_ = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'base.json'), 'utf8'));
  const deFelipe = base_.corretores.find((c) => c.g === 'FELIPE FREIRE' && c.i === 'CANAL IMOB - GABRIELA SANTOS');
  const semEquipe = base_.corretores.find((c) => c.g === 'SEM EQUIPE');

  console.log('Acesso');
  ok((await chamar('', 'GET', '/api/solicitacoes')).s === 401, 'sem login é recusado');
  const gmail = await entrar('alguem@gmail.com', 'X');
  ok((await chamar(gmail, 'GET', '/api/solicitacoes')).s === 401, 'e-mail fora dos domínios é recusado');
  const ana = await entrar('ana@diagonalinc.com.br', 'Ana');
  ok((await chamar(ana, 'GET', '/api/me')).s === 200, 'e-mail @diagonalinc.com.br entra');
  const edi = await entrar('edivaniamelo@victa.eng.br', 'Edivania');
  const felipe = await entrar('felipearaujo@victa.eng.br', 'Felipe');
  const anderson = await entrar('andersonvital@victa.eng.br', 'Anderson');
  ok((await chamar(felipe, 'GET', '/api/me')).j.aprovador === 'FELIPE FREIRE', 'Felipe reconhecido como aprovador');
  ok((await chamar(ana, 'GET', '/api/me')).j.aprovador === null, 'usuário comum não é aprovador');
  ok(JSON.stringify(await (await fetch(base + '/app.js')).text()).includes('CORRETORES') === false, 'lista de corretores não vai no código da página');

  console.log('Troca entre as duas equipes (Felipe -> equipe do Anderson)');
  let r = await chamar(ana, 'POST', '/api/solicitacoes', { documento: deFelipe.d, nova: 'CANAL IMOB - ANDRESSA DA LUZ', solicitante: 'Ana Souza', emailSolicitante: 'falso@victa.eng.br' });
  ok(r.s === 201 && r.j.aprovadores.length === 2, 'exige os dois aprovadores');
  ok(r.j.emailSolicitante === 'ana@diagonalinc.com.br', 'e-mail do solicitante vem do login, não do formulário');
  const id = r.j.id;
  ok((await chamar(ana, 'POST', '/api/solicitacoes', { documento: deFelipe.d, nova: 'CANAL IMOB - ANDRESSA DA LUZ', solicitante: 'Ana Souza' })).s === 409, 'bloqueia solicitação duplicada pendente');
  ok((await chamar(ana, 'POST', `/api/solicitacoes/${id}/decisao`, { decisao: 'Aprovado' })).s === 403, 'usuário comum NÃO aprova');
  ok((await chamar(edi, 'POST', `/api/solicitacoes/${id}/decisao`, { decisao: 'Aprovado' })).s === 403, 'administrador NÃO aprova');
  r = await chamar(felipe, 'POST', `/api/solicitacoes/${id}/decisao`, { decisao: 'Aprovado' });
  ok(r.s === 200 && r.j.status === 'Aguardando aprovação', 'após o Felipe, continua aguardando o Anderson');
  ok((await chamar(felipe, 'POST', `/api/solicitacoes/${id}/decisao`, { decisao: 'Aprovado' })).s === 409, 'Felipe não decide duas vezes');
  r = await chamar(anderson, 'POST', `/api/solicitacoes/${id}/decisao`, { decisao: 'Aprovado' });
  ok(r.j.status === 'Aprovado', 'após os dois, fica Aprovado');
  ok((await chamar(ana, 'POST', `/api/solicitacoes/${id}/cancelar`, {})).s === 409, 'aprovada não pode ser cancelada');

  console.log('Troca dentro da mesma equipe e reprovação');
  r = await chamar(ana, 'POST', '/api/solicitacoes', { documento: deFelipe.d, nova: 'CANAL IMOB - MIRELLY PINHEIRO', solicitante: 'Ana Souza' });
  ok(r.s === 201 && r.j.aprovadores.length === 1 && r.j.aprovadores[0] === 'FELIPE FREIRE', 'mesma equipe: só o Felipe');
  ok((await chamar(anderson, 'POST', `/api/solicitacoes/${r.j.id}/decisao`, { decisao: 'Aprovado' })).s === 409, 'Anderson não decide etapa que não é dele');
  r = await chamar(felipe, 'POST', `/api/solicitacoes/${r.j.id}/decisao`, { decisao: 'Não aprovado' });
  ok(r.j.status === 'Não aprovado', 'reprovação encerra a solicitação');

  console.log('Sem equipe, cancelamento e validações');
  r = await chamar(ana, 'POST', '/api/solicitacoes', { documento: semEquipe.d, nova: 'CANAL IMOB - MIRELLY PINHEIRO', solicitante: 'Ana Souza' });
  ok(r.s === 201 && r.j.status === 'Informativo' && r.j.aprovadores.length === 0, 'sem equipe: Informativo, sem aprovação');
  ok((await chamar(felipe, 'POST', `/api/solicitacoes/${r.j.id}/cancelar`, {})).s === 403, 'terceiro não cancela');
  ok((await chamar(ana, 'POST', `/api/solicitacoes/${r.j.id}/cancelar`, {})).j.status === 'Cancelada', 'solicitante cancela a própria');
  ok((await chamar(ana, 'POST', '/api/solicitacoes', { documento: '000', nova: 'X', solicitante: 'Ana Souza' })).s === 400, 'corretor inexistente é recusado');
  ok((await chamar(ana, 'POST', '/api/solicitacoes', { documento: deFelipe.d, nova: deFelipe.i, solicitante: 'Ana Souza' })).s === 400, 'mesma imobiliária é recusada');
  const lista = (await chamar(felipe, 'GET', '/api/solicitacoes')).j;
  ok(lista.length === 3, 'painel lista as 3 solicitações');
  ok(fs.readFileSync(path.join(dir, 'auditoria.log'), 'utf8').split('\n').filter(Boolean).length === 7, 'auditoria registrou as 7 ações (3 solicitações, 3 decisões, 1 cancelamento)');

  console.log('Token da Microsoft (verificação)');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1' };
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const emitir = (cor, chave = privateKey) => { const d = b({ alg: 'RS256', kid: 'k1' }) + '.' + b(cor); return d + '.' + crypto.sign('RSA-SHA256', Buffer.from(d), chave).toString('base64url'); };
  const bom = { aud: 'cid', tid: 'T1', iss: 'https://login.microsoftonline.com/T1/v2.0', exp: Math.floor(Date.now() / 1000) + 600, nonce: 'n1', preferred_username: 'a@victa.eng.br' };
  const tenta = (cor, opt = {}, chave) => { try { verificarIdToken(emitir(cor, chave), [jwk], { clientId: 'cid', nonce: 'n1', ...opt }); return true; } catch (e) { return false; } };
  ok(tenta(bom), 'token válido é aceito');
  ok(!tenta({ ...bom, aud: 'outro' }), 'audiência errada é recusada');
  ok(!tenta({ ...bom, iss: 'https://evil.example/T1/v2.0' }), 'emissor falso é recusado');
  ok(!tenta({ ...bom, exp: Math.floor(Date.now() / 1000) - 10 }), 'token expirado é recusado');
  ok(!tenta(bom, { nonce: 'outro' }), 'nonce errado é recusado');
  ok(!tenta(bom, {}, crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey), 'assinatura de outra chave é recusada');

  srv.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${total - falhas}/${total} testes passaram.`);
  process.exit(falhas ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
