# Segurança do Gerencial

## Como funciona o acesso

- **Login no servidor.** Usuário, senha e 2FA são conferidos numa função do Cloudflare (`/api/auth/login`), nunca no navegador. Se estiver tudo certo, ela devolve um token do Firebase com o perfil da pessoa (`admin`, `user` ou `consulta`).
- **Senhas e 2FA.** Ficam em `segredos/usuarios`. As regras bloqueiam esse documento para qualquer navegador, inclusive de admin: só o servidor, com a conta de serviço, lê. As senhas usam PBKDF2-SHA256 com 100 mil iterações. Os hashes antigos (SHA-256) são aceitos uma vez e convertidos no primeiro login.
- **Força bruta.** Na 5ª senha errada, o usuário fica bloqueado por 15 minutos.
- **Regras do Firestore** (`firestore.rules`):
  - sem login (nem anônimo), não há acesso a nada;
  - a equipe lê e edita conforme o perfil;
  - perfis, links de consulta, Slack e auditoria são só de admin;
  - a auditoria não pode ser apagada por quem não é admin.
- **Link de consulta.** `/api/consulta` devolve uma sessão que só lê a Taxa ADM. As regras conferem a cada leitura se o link continua ativo, então revogar corta o acesso na hora.
- **Ações sensíveis passam pelo servidor e exigem admin logado:**
  - troca de senha, ligar e resetar 2FA, criar e remover usuário (`/api/auth/admin`);
  - envio de e-mail aos canais (`/api/send-email`).
- **Cabeçalhos HTTP** (`public/_headers`): CSP, bloqueio de iframe (clickjacking), HSTS, nosniff, Referrer-Policy e Permissions-Policy.

## Configuração (uma vez)

1. **Conta de serviço.** No console do Firebase, vá em Configurações do projeto → Contas de serviço → Gerar nova chave privada. Cole o JSON inteiro no Cloudflare (Pages → gerencial → Settings → Variables and Secrets) como **Secret** com o nome `FIREBASE_SERVICE_ACCOUNT`.
2. **Regras.** No console do Firebase, vá em Firestore Database → Regras, cole o conteúdo de `firestore.rules` e clique em Publicar. O mesmo texto aparece em Configurações → Copiar.
3. **Login anônimo.** Em Authentication → Método de login, desative o provedor **Anônimo**. O sistema não usa mais.
4. **Storage.** Não é usado. Deixe as regras do Storage como `allow read, write: if false;`.

## Pendências conhecidas

- **Biblioteca `xlsx`.** A versão 0.18.5 tem vulnerabilidades conhecidas: poluição de protótipo e ReDoS. O risco é baixo, porque só admins importam planilhas. A correção é a versão 0.20.3, distribuída apenas pelo site da SheetJS (cdn.sheetjs.com).
- **Permissões finas.** A matriz "Permissões por perfil" (tela Usuários) é aplicada pela tela. No banco, o controle é por perfil: admin / equipe / consulta.
