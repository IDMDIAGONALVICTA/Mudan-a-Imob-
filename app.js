(function () {
"use strict";
var ST = { AG: "Aguardando aprovação", OK: "Aprovado", NO: "Não aprovado", INF: "Informativo", CAN: "Cancelada" };
var CFG = null, ME = null, lista = [], selecionado = null, confirmando = null, cancelando = null, timerBusca = null;
var $ = function (id) { return document.getElementById(id); };

function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function norm(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function bonito(s) { return String(s || "").toLowerCase().replace(/(^|\s)\S/g, function (m) { return m.toUpperCase(); }); }
function fmtDoc(d, t) {
  if (t === "CPF" && d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return d;
}
function fmtData(iso) {
  if (!iso) return "";
  try { return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(",", ""); } catch (e) { return iso; }
}
function diaSP(iso) { try { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso)); } catch (e) { return ""; } }
function toast(msg, err) {
  var t = $("toast"); t.textContent = msg; t.className = "show" + (err ? " err" : "");
  clearTimeout(toast.h); toast.h = setTimeout(function () { t.className = ""; }, 4500);
}

/* ---------------- comunicação com o servidor ---------------- */
async function api(metodo, url, corpo) {
  var r = await fetch(url, { method: metodo, credentials: "same-origin", headers: corpo ? { "Content-Type": "application/json" } : {}, body: corpo ? JSON.stringify(corpo) : undefined });
  if (r.status === 401) { mostrarLogin(); throw { codigo: 401 }; }
  var j = {}; try { j = await r.json(); } catch (e) { /* vazio */ }
  if (!r.ok) throw { codigo: r.status, msg: j.erro };
  return j;
}
function mostrarLogin() {
  var erro = new URLSearchParams(location.search).get("erro");
  $("who").textContent = "Acesso restrito";
  $("bloqTitulo").textContent = "Acesso restrito aos colaboradores";
  $("bloqMsg").textContent = erro === "acesso" ? "Esta conta não tem permissão para usar o sistema. Entre com sua conta corporativa (@victa.eng.br ou @diagonalinc.com.br)."
    : erro === "login" ? "Não foi possível concluir o login. Tente novamente." : "Entre com sua conta corporativa (@victa.eng.br ou @diagonalinc.com.br) para continuar.";
  $("bloqLogin").classList.remove("hidden");
  $("app").classList.add("hidden"); $("bloqueio").classList.remove("hidden");
}

/* ---------------- formulário ---------------- */
function aprovadoresDaTroca(c, nova) {
  if (c.g === "SEM EQUIPE") return [];
  var out = [c.g], g2 = (CFG.equipeDaImobiliaria || {})[nova] || "";
  if (g2 && g2 !== c.g && g2 !== "SEM EQUIPE") out.push(g2);
  return out;
}
function buscar() {
  var q = $("busca").value.trim(), ul = $("resultados");
  ul.textContent = "";
  if (q.length < 3) { ul.classList.add("hidden"); return; }
  api("GET", "/api/corretores?q=" + encodeURIComponent(q)).then(function (res) {
    if ($("busca").value.trim() !== q) return;
    ul.textContent = "";
    if (!res.length) { var li0 = el("li"), b0 = el("button", null, "Nenhum corretor encontrado"); b0.disabled = true; li0.appendChild(b0); ul.appendChild(li0); ul.classList.remove("hidden"); return; }
    res.forEach(function (c) {
      var li = el("li"), b = el("button"); b.type = "button";
      b.appendChild(el("strong", null, c.n));
      b.appendChild(el("small", null, c.t + " " + fmtDoc(c.d, c.t) + " · " + c.i + " · " + (c.g === "SEM EQUIPE" ? "Sem equipe" : "Gerente: " + c.g)));
      b.addEventListener("click", function () { selecionar(c); });
      li.appendChild(b); ul.appendChild(li);
    });
    ul.classList.remove("hidden");
  }).catch(function () { /* 401 já tratado */ });
}
function selecionar(c) {
  selecionado = c; $("posEnvio").classList.add("hidden");
  $("resultados").classList.add("hidden"); $("boxBusca").classList.add("hidden"); $("boxSel").classList.remove("hidden");
  $("selNome").textContent = c.n; $("selDoc").textContent = c.t + " " + fmtDoc(c.d, c.t);
  $("atual").value = c.i;
  $("gerente").value = c.g === "SEM EQUIPE" ? "Sem equipe (apenas informativo)" : c.g;
  $("avisoInf").classList.toggle("hidden", c.g !== "SEM EQUIPE");
  var sel = $("nova"); sel.textContent = ""; sel.disabled = false;
  var o = el("option", null, "Selecione a nova imobiliária"); o.value = ""; sel.appendChild(o);
  CFG.imobiliarias.filter(function (x) { return x !== c.i; }).forEach(function (x) { var op = el("option", null, x); op.value = x; sel.appendChild(op); });
  validar();
}
function trocar() {
  selecionado = null; $("boxSel").classList.add("hidden"); $("boxBusca").classList.remove("hidden");
  $("busca").value = ""; $("busca").focus(); $("atual").value = ""; $("gerente").value = ""; $("avisoInf").classList.add("hidden");
  var sel = $("nova"); sel.textContent = ""; var o = el("option", null, "Selecione o corretor primeiro"); o.value = ""; sel.appendChild(o); sel.disabled = true;
  validar();
}
function validar() {
  var av = $("avisoAprov");
  if (selecionado && $("nova").value && selecionado.g !== "SEM EQUIPE") {
    var a = aprovadoresDaTroca(selecionado, $("nova").value);
    av.textContent = a.length > 1 ? "Troca entre as equipes de " + bonito(a[0]) + " e " + bonito(a[1]) + ": os dois precisam aprovar." : "Aprovação necessária: " + bonito(a[0]) + ".";
  } else av.textContent = "";
  $("enviar").disabled = !(selecionado && $("nova").value && $("solicitante").value.trim().length >= 3);
}
async function enviar() {
  var c = selecionado; if (!c) return;
  $("enviar").disabled = true; $("msgEnvio").textContent = "Enviando…";
  try {
    var r = await api("POST", "/api/solicitacoes", { documento: c.d, nova: $("nova").value, solicitante: $("solicitante").value.trim() });
    toast(r.status === ST.INF ? "Registrado como informativo." : "Solicitação enviada para aprovação de " + r.aprovadores.map(bonito).join(" e ") + ".");
    trocar(); $("msgEnvio").textContent = ""; mostrarPos(r); await carregar();
  } catch (e) {
    $("msgEnvio").textContent = ""; if (e.codigo !== 401) toast(e.msg || "Não foi possível enviar agora. Tente novamente.", true);
  }
  validar();
}

/* ---------------- WhatsApp (semi-automático) ---------------- */
function waUrl(tel, msg) { return "https://wa.me/" + tel + "?text=" + encodeURIComponent(msg); }
function resumo(r) { return "Corretor: " + r.corretor + "\nImobiliária antiga: " + r.imobiliariaAntiga + "\nImobiliária nova: " + r.imobiliariaNova + "\nSolicitante: " + r.solicitante + (r.protocolo ? "\nProtocolo: " + r.protocolo : ""); }
function pendentesDe(r) { return r.aprovadores.filter(function (g) { return !r.aprovacoes[CFG.aprovadores[g].chave]; }); }
function destinosWa(r, forcar) {
  var out = [], A = CFG.aprovadores, fim = "\n\n(Mensagem apenas informativa.)";
  if (r.status === ST.AG) {
    pendentesDe(r).forEach(function (g) {
      if (!forcar && ME.aprovador === g) return;
      out.push({ grupo: "Avisar para aprovar", nome: A[g].apelido, tel: A[g].whatsapp, msg: "Olá, " + A[g].apelido + "! Há uma nova solicitação de mudança de imobiliária aguardando sua aprovação." + (r.aprovadores.length > 1 ? " Esta troca é entre as equipes de " + r.aprovadores.map(bonito).join(" e ") + ": os dois precisam aprovar." : "") + "\n\n" + resumo(r) + "\n\nEntre no sistema e aprove: " + CFG.urlSistema + fim });
    });
  } else if (r.status === ST.INF) {
    Object.keys(A).forEach(function (g) { out.push({ grupo: "Avisar gerentes", nome: A[g].apelido, tel: A[g].whatsapp, msg: "Olá, " + A[g].apelido + "! Aviso: um corretor sem equipe mudou de imobiliária (não precisa de aprovação).\n\n" + resumo(r) + fim }); });
  } else if (r.status === ST.CAN) {
    r.aprovadores.forEach(function (g) { out.push({ grupo: "Avisar cancelamento", nome: A[g].apelido, tel: A[g].whatsapp, msg: "Olá, " + A[g].apelido + "! A solicitação de mudança de imobiliária abaixo foi CANCELADA pelo solicitante e não precisa mais de aprovação.\n\n" + resumo(r) + fim }); });
  }
  if (r.status === ST.OK || r.status === ST.INF) {
    CFG.executores.forEach(function (x) {
      out.push({ grupo: "Avisar quem faz a troca", nome: x.nome, tel: x.whatsapp, msg: "Olá, " + x.nome + "! " + (r.status === ST.OK ? "Mudança de imobiliária APROVADA" : "Mudança de imobiliária comunicada (corretor sem equipe, sem necessidade de aprovação)") + ". Por favor, faça a troca.\n\n" + resumo(r) + (r.status === ST.OK ? "\nAprovado por: " + r.aprovadores.map(bonito).join(" e ") + (r.dataDecisao ? " em " + fmtData(r.dataDecisao) : "") : "") + fim });
    });
  }
  return out;
}
function waBox(r, forcar) {
  var d = destinosWa(r, forcar); if (!d.length) return null;
  var box = el("div", "wa"), grupos = {}, ordem = [];
  d.forEach(function (x) { if (!grupos[x.grupo]) { grupos[x.grupo] = []; ordem.push(x.grupo); } grupos[x.grupo].push(x); });
  ordem.forEach(function (g) {
    var row = el("div", "wagrp"); row.appendChild(el("span", "muted", g + ": "));
    grupos[g].forEach(function (x) { var a = el("a", "wabtn", x.nome); a.href = waUrl(x.tel, x.msg); a.target = "_blank"; a.rel = "noopener noreferrer"; row.appendChild(a); });
    box.appendChild(row);
  });
  return box;
}
function mostrarPos(r) {
  var b = $("posEnvio"); b.textContent = "";
  var w = waBox(r, true); if (!w) { b.classList.add("hidden"); return; }
  var card = el("div", "note info");
  card.appendChild(el("strong", null, "Solicitação " + r.protocolo + " registrada. Envie o aviso pelo WhatsApp (basta apertar Enviar lá):"));
  card.appendChild(w); b.appendChild(card); b.classList.remove("hidden");
}

/* ---------------- ações ---------------- */
async function decidir(r, resultado) {
  confirmando = null;
  try {
    var n = await api("POST", "/api/solicitacoes/" + r.id + "/decisao", { decisao: resultado });
    var falta = pendentesDe(n).map(bonito);
    toast(resultado === ST.NO ? "Marcado como não aprovado." : falta.length ? "Aprovado. Falta a aprovação de " + falta.join(" e ") + "." : "Aprovado. A mudança está liberada.");
  } catch (e) { if (e.codigo !== 401) toast(e.msg || "Não foi possível registrar a decisão.", true); }
  await carregar();
}
async function cancelar(r) {
  cancelando = null;
  try { await api("POST", "/api/solicitacoes/" + r.id + "/cancelar", {}); toast("Solicitação cancelada."); }
  catch (e) { if (e.codigo !== 401) toast(e.msg || "Não foi possível cancelar agora.", true); }
  await carregar();
}

/* ---------------- painel ---------------- */
function render() {
  var tb = $("linhas"), q = norm($("filtro").value), fs = $("filtroStatus").value, de = $("dtDe").value, ate = $("dtAte").value;
  var vis = lista.filter(function (r) {
    var dia = diaSP(r.dataSolicitacao);
    return (!fs || r.status === fs) && (!q || norm(r.corretor).indexOf(q) > -1 || norm(r.solicitante).indexOf(q) > -1) && (!de || dia >= de) && (!ate || dia <= ate);
  });
  var pend = lista.filter(function (r) { return r.acoes.decidir; }), bn = $("banner");
  if (pend.length) {
    bn.classList.remove("hidden"); bn.textContent = "";
    bn.appendChild(el("span", null, "Você tem " + pend.length + (pend.length > 1 ? " solicitações aguardando" : " solicitação aguardando") + " sua decisão."));
    var bt = el("button", "btn small ghost", "Ver só as minhas pendências"); bt.type = "button";
    bt.addEventListener("click", function () { $("filtroStatus").value = ST.AG; render(); }); bn.appendChild(bt);
  } else bn.classList.add("hidden");

  tb.textContent = "";
  vis.forEach(function (r) {
    var tr = el("tr", r.acoes.decidir ? "mine" : "");
    var c1 = el("td"); c1.appendChild(el("strong", null, r.corretor)); c1.appendChild(el("div", "muted", r.protocolo || "")); tr.appendChild(c1);
    tr.appendChild(el("td", null, r.imobiliariaAntiga));
    tr.appendChild(el("td", null, r.imobiliariaNova));
    tr.appendChild(el("td", null, r.solicitante));
    tr.appendChild(el("td", null, r.emailSolicitante));
    tr.appendChild(el("td", null, r.gerente === "SEM EQUIPE" ? "Felipe e Anderson (informativo)" : r.aprovadores.map(bonito).join(" e ")));
    tr.appendChild(el("td", null, fmtData(r.dataSolicitacao)));
    var cs = el("td"), cls = {}; cls[ST.AG] = "b-ag"; cls[ST.OK] = "b-ok"; cls[ST.NO] = "b-no"; cls[ST.INF] = "b-inf"; cls[ST.CAN] = "b-can";
    cs.appendChild(el("span", "badge " + (cls[r.status] || "b-inf"), r.status));
    if (r.status === ST.AG && r.aprovadores.length > 1) cs.appendChild(el("div", "muted", Object.keys(r.aprovacoes).length + " de " + r.aprovadores.length + " aprovações"));
    tr.appendChild(cs);

    ["FELIPE FREIRE", "ANDERSON VITAL"].forEach(function (g) {
      var td = el("td"), chave = CFG.aprovadores[g].chave, x = r.aprovacoes[chave];
      if (r.status === ST.INF || r.aprovadores.indexOf(g) < 0) { td.appendChild(el("span", "muted", "Não necessário")); }
      else if (x) {
        var ok = x.decisao === ST.OK;
        td.appendChild(el("span", "badge " + (ok ? "b-ok" : "b-no"), ok ? "Aprovado" : "Não aprovado"));
        td.appendChild(el("div", "muted", fmtData(x.data)));
      } else if (r.status === ST.NO || r.status === ST.CAN) { td.appendChild(el("span", "muted", "Encerrada")); }
      else {
        td.appendChild(el("span", "badge b-ag", "Aguardando"));
        if (r.acoes.decidir === g) {
          if (confirmando && confirmando.id === r.id) {
            td.appendChild(el("div", null, "Confirmar “" + confirmando.res + "”?"));
            var ac = el("div", "actions");
            var sim = el("button", "btn small" + (confirmando.res === ST.NO ? " no" : ""), "Sim, confirmar"); sim.type = "button";
            sim.addEventListener("click", function () { var res = confirmando.res; sim.disabled = true; decidir(r, res); });
            var nao = el("button", "btn small ghost", "Cancelar"); nao.type = "button";
            nao.addEventListener("click", function () { confirmando = null; render(); });
            ac.appendChild(sim); ac.appendChild(nao); td.appendChild(ac);
          } else {
            var ac2 = el("div", "actions");
            var ap = el("button", "btn small", "Aprovar"); ap.type = "button";
            ap.addEventListener("click", function () { confirmando = { id: r.id, res: ST.OK }; render(); });
            var rp = el("button", "btn small no", "Não aprovar"); rp.type = "button";
            rp.addEventListener("click", function () { confirmando = { id: r.id, res: ST.NO }; render(); });
            ac2.appendChild(ap); ac2.appendChild(rp); td.appendChild(ac2);
          }
        }
      }
      tr.appendChild(td);
    });
    tr.appendChild(el("td", null, r.dataDecisao ? fmtData(r.dataDecisao) : "—"));
    var wbc = el("td"), wb = waBox(r, false);
    if (wb) wbc.appendChild(wb); else wbc.appendChild(el("span", "muted", "—"));
    tr.appendChild(wbc);

    var cc = el("td");
    if (r.status === ST.CAN) {
      cc.appendChild(el("div", null, "Cancelada"));
      if (r.cancelamento) { cc.appendChild(el("div", "muted", fmtData(r.cancelamento.em))); cc.appendChild(el("div", "muted", "por " + r.cancelamento.por)); }
    } else if (r.acoes.cancelar) {
      if (cancelando === r.id) {
        cc.appendChild(el("div", null, "Cancelar esta solicitação?"));
        var acx = el("div", "actions");
        var s2 = el("button", "btn small no", "Sim, cancelar"); s2.type = "button";
        s2.addEventListener("click", function () { s2.disabled = true; cancelar(r); });
        var n2 = el("button", "btn small ghost", "Voltar"); n2.type = "button";
        n2.addEventListener("click", function () { cancelando = null; render(); });
        acx.appendChild(s2); acx.appendChild(n2); cc.appendChild(acx);
      } else {
        var cb = el("button", "btn small ghost", "Cancelar solicitação"); cb.type = "button";
        cb.addEventListener("click", function () { cancelando = r.id; render(); });
        cc.appendChild(cb);
      }
    } else cc.appendChild(el("span", "muted", "—"));
    tr.appendChild(cc);
    tb.appendChild(tr);
  });
  var v = $("vazio");
  if (!vis.length) { v.classList.remove("hidden"); v.textContent = lista.length ? "Nenhuma solicitação com esse filtro." : "Nenhuma solicitação registrada ainda."; }
  else v.classList.add("hidden");
  $("contador").textContent = vis.length + " de " + lista.length + " solicitações";
}
async function carregar() {
  try { lista = await api("GET", "/api/solicitacoes"); render(); } catch (e) { /* mantém a lista atual */ }
}

/* ---------------- início ---------------- */
async function init() {
  try {
    ME = await api("GET", "/api/me");
  } catch (e) { if (e.codigo !== 401) { $("bloqTitulo").textContent = "Sistema indisponível"; $("bloqMsg").textContent = "Não foi possível conectar ao servidor. Tente novamente em instantes."; } return; }
  CFG = await api("GET", "/api/config");
  $("bloqueio").classList.add("hidden"); $("app").classList.remove("hidden"); $("sair").classList.remove("hidden");
  $("who").textContent = (ME.nome || ME.email) + " · " + (ME.aprovador ? "Aprovador: " + bonito(ME.aprovador) : ME.admin ? "Administrador" : "Solicitante");
  $("email").value = ME.email; if (ME.nome && !$("solicitante").value) $("solicitante").value = ME.nome;
  $("busca").addEventListener("input", function () { clearTimeout(timerBusca); timerBusca = setTimeout(buscar, 250); });
  $("trocar").addEventListener("click", trocar);
  ["nova", "solicitante"].forEach(function (i) { $(i).addEventListener("input", validar); $(i).addEventListener("change", validar); });
  $("enviar").addEventListener("click", enviar);
  ["filtro", "filtroStatus", "dtDe", "dtAte"].forEach(function (i) { $(i).addEventListener(i === "filtro" ? "input" : "change", render); });
  $("limpar").addEventListener("click", function () { $("filtro").value = ""; $("filtroStatus").value = ""; $("dtDe").value = ""; $("dtAte").value = ""; render(); });
  validar(); await carregar();
  setInterval(function () { if (!document.hidden && !confirmando && !cancelando) carregar(); }, 20000);
}
init();
})();
