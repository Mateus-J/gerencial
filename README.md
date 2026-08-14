# Gerencial v2

Reescrita do app de controle interno (`gerencial.pages.dev`) em **React + Vite + Tailwind**,
mantendo o mesmo backend Firebase (`id-liquidacao`) — nenhum dado é perdido na troca,
só a interface muda.

## Rodar localmente

```bash
npm install
npm run dev
```

## Build de produção

```bash
npm run build
```
Gera a pasta `dist/` com os arquivos estáticos.

## Deploy no Cloudflare Pages (mesmo fluxo que você já usa)

1. Suba este projeto para um repositório Git (GitHub/GitLab).
2. No painel do Cloudflare Pages: **Create project → Connect to Git**.
3. Configurações de build:
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Cada push na branch `main` faz deploy automático em produção;
   use outra branch (ex: `dev`) para preview antes de ir pro ar.

O arquivo `public/_redirects` já está incluso para o roteamento funcionar
corretamente como SPA no Cloudflare Pages.

## Estrutura

```
src/
  lib/firebase.js       # mesma config do projeto Firebase atual
  hooks/useFirebaseStatus.js
  components/           # Sidebar, Topbar, KpiCard, StatusBadge, PageShell
  pages/
    Dashboard.jsx        # já migrado como exemplo completo (Pendências Liquidação)
    Saldos.jsx            # esqueleto — portar lógica de switchToSaldos()
    TaxaAdministracao.jsx # esqueleto — portar lógica de switchToTaxaAdm()
    PortalSaldos.jsx       # esqueleto — portar lógica de switchToPortalSaldos()
    MultasJuros.jsx         # esqueleto — portar cálculo Selic (IOF/IR)
    HomeOffice.jsx           # esqueleto — portar renderHoView() etc.
    Agenda.jsx                # esqueleto — portar renderCalendar()
    Usuarios.jsx                # esqueleto — portar renderUsersTable()
    Auditoria.jsx                 # esqueleto — portar renderAuditLog()
    Configuracoes.jsx              # esqueleto — portar renderAdminContent()
```

## Migrando cada aba

Cada página em `src/pages/` já está no menu (`src/components/Sidebar.jsx`) e no
roteador (`src/App.jsx`). Para portar uma aba do app antigo:

1. Copie a lógica de leitura/escrita no Firestore da função `render*()`/`switchTo*()`
   correspondente no HTML antigo (linhas indicadas nos comentários `TODO` de cada página).
2. Troque `getDocs`/`onSnapshot` para usar `db` já importado de `../lib/firebase`.
3. Use `Dashboard.jsx` como referência de layout (KPIs + tabela + busca).

## Segurança

A `apiKey` do Firebase em `src/lib/firebase.js` não é secreta — é normal ela
aparecer no bundle de apps client-side do Firebase. Quem protege os dados de
verdade são as **Regras de Segurança do Firestore**, configuradas no console
do projeto `id-liquidacao`. Confirme que elas continuam restritas por
usuário/role antes de publicar.
