# Sistema de Mudança de Imobiliária — versão para hospedagem própria

Mesmo sistema que roda no claude.ai, mas com **servidor próprio** (Node.js, sem dependências para instalar).
Faz o papel do banco de dados e do login que, lá, eram do claude.ai.

## O que ele faz
- Formulário com busca de corretor (nome ou CNPJ/CPF), imobiliária atual automática, nova imobiliária, solicitante.
- **Quem aprova é decidido pela planilha:** troca dentro de uma equipe → só o gerente dela; troca entre as equipes do Felipe e do Anderson → **os dois**; corretor sem equipe → **Informativo** (sem aprovação).
- Painel com colunas **Aprovação Felipe** e **Aprovação Anderson**, filtros (texto, status, datas) e **cancelamento**.
- **Só Felipe e Anderson aprovam, cada um a sua etapa, logados com a própria conta.** A regra é verificada **no servidor**, não só na tela.
- O e-mail do solicitante é sempre o do login (não dá para digitar outro). Domínios aceitos: `@victa.eng.br` e `@diagonalinc.com.br`.
- Avisos por WhatsApp semi-automáticos (botão abre o WhatsApp com a mensagem pronta; a pessoa aperta Enviar).
- Registro de auditoria (`data/auditoria.log`): quem solicitou, aprovou, cancelou e quando.

## O que você precisa
1. Uma hospedagem com **Node.js 18 ou mais novo**, **HTTPS** e **disco que não apague ao reiniciar** (os dados ficam em `data/solicitacoes.json`).
2. Um registro de aplicativo no **Microsoft Entra ID** (grátis) para o login.

## Passo 1 — Hospedar
Escolha uma opção:
- **Servidor/VPS:** copie a pasta, rode `node server.js` (use `systemd` ou `pm2` para manter ligado) e coloque Caddy ou nginx na frente para o HTTPS.
- **Azure App Service (Linux, Node 20):** envie a pasta; defina `DATA_DIR=/home/dados` (a pasta `/home` é persistente).
- **Docker:** `docker build -t sistema-mudanca .` e `docker run -d -p 3000:3000 -v dados:/dados --env-file .env sistema-mudanca`.
- Atenção: planos gratuitos de várias hospedagens **apagam o disco** a cada reinício. Nesses casos você perderia as solicitações. Use disco persistente.

## Passo 2 — Login Microsoft (Entra ID)
1. Entre em https://entra.microsoft.com → **Aplicativos → Registros de aplicativo → Novo registro**.
2. **Tipos de conta com suporte:** *Contas em qualquer diretório organizacional (multilocatário)*. É necessário para aceitar tanto Victa quanto Diagonal.
3. **URI de redirecionamento** (tipo *Web*): `https://SEU-ENDERECO/auth/callback` (igual ao `BASE_URL` do `.env`, mais `/auth/callback`).
4. Em **Certificados e segredos → Novo segredo do cliente**, copie o **Valor** (aparece uma vez só).
5. Anote: **ID do aplicativo (cliente)** → `MS_CLIENT_ID`; o segredo → `MS_CLIENT_SECRET`; o **ID do diretório (locatário)** da Victa → `VICTA_TENANT_ID`.
6. Peça à TI da Diagonal o **ID do locatário** dela → `DIAGONAL_TENANT_ID`. **Se a Diagonal não usa Microsoft 365, os e-mails @diagonalinc.com.br não conseguirão entrar por este login.**
7. Se a conta da Diagonal pedir aprovação do administrador no primeiro acesso, a TI deles precisa autorizar o aplicativo.

## Passo 3 — Configurar e ligar
```
cp .env.example .env      # preencha com os valores acima
node server.js
```
Abra o endereço no navegador e entre com uma conta de teste.

## Antes de usar de verdade (teste obrigatório)
O login Microsoft foi **verificado só com tokens de teste**, não contra a Microsoft de verdade, porque isso exige a sua conta e o seu endereço. No primeiro acesso:
1. Entre com a conta do Felipe (ou peça a ele) e confira que aparece "Aprovador: Felipe Freire".
2. Entre com uma conta comum e confira que ela **não** vê botões de aprovar.
3. Faça uma solicitação e aprove com as duas contas.
Se o login falhar, olhe `data/auditoria.log` (registra `login_erro` com o motivo).

Para checar o servidor sem mexer nos seus dados: `node teste-rapido.js` (31 verificações; não usa o login da Microsoft).

## Arquivos que você edita
- `config.json`: e-mails dos aprovadores, WhatsApp de cada pessoa, domínios permitidos e administradores.
- `data/base.json`: corretores, imobiliárias e equipes. Para atualizar a partir de uma planilha: `python3 atualizar-base.py planilha.xlsx` e reinicie.
- `data/solicitacoes.json`: as solicitações (**faça backup**, junto com `data/auditoria.log`).

## Limites e cuidados
- **Nunca use `AUTH_MODE=dev` em produção:** nesse modo qualquer pessoa entra com qualquer e-mail (existe só para testes).
- Funciona com **uma única cópia do servidor** (os dados ficam em arquivo). Para o volume de uma imobiliária isso basta.
- Quem administra o servidor consegue ler e alterar os arquivos de dados. A proteção das aprovações vale contra os usuários do sistema, não contra o administrador da hospedagem.
- Não há limitação de tentativas de acesso. Se a página ficar exposta à internet aberta, coloque um proxy com limite de requisições.
- Os números de WhatsApp ficam em `config.json` e são enviados a qualquer usuário logado.
