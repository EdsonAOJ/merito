# Mérito — Teste Fullstack

Projeto desenvolvido com NestJS e React para processar eventos financeiros via webhook, consultar saldos de contas e reconciliar valores a partir de arquivos CSV.

## Tecnologias

**Backend**

- Node.js, TypeScript e NestJS
- PostgreSQL e Prisma
- Jest e Supertest

**Frontend**

- React, TypeScript e Vite
- Chakra UI

**Ambiente**

- Docker Compose

## Executando o projeto

É necessário ter Docker e Docker Compose instalados.

Primeiro, copie o arquivo `.env.example` para `.env`:

```bash
cp .env.example .env
```

No Windows, usando PowerShell:

```powershell
Copy-Item .env.example .env
```

Confira as variáveis de ambiente antes de iniciar:

```dotenv
PORT=3000
POSTGRES_PASSWORD=merito-local
DATABASE_URL=postgresql://merito:merito-local@postgres:5432/merito_db?schema=public
WEBHOOK_SECRET=WEBHOOK_SECRET_123
RECONCILIATION_ADMIN_KEY=RECONCILIATION_ADMIN_KEY_123
```

Esses valores são apenas para execução local.

Na raiz do projeto, execute:

```bash
docker compose up -d --build
```

O Compose inicia o banco, a API e o frontend. A API aplica as migrations do Prisma na inicialização.

Depois de iniciar, os serviços estarão disponíveis em:

| Serviço      | Endereço                           |
| ------------ | ---------------------------------- |
| Frontend     | http://localhost:5173              |
| API          | http://localhost:3000              |
| Health check | http://localhost:3000/health/ready |

Para acompanhar os logs:

```bash
docker compose logs -f api
```

Para parar o ambiente:

```bash
docker compose down
```

## Funcionalidades

### Processamento de webhooks

A API recebe três tipos de evento:

- `BALANCE_SNAPSHOT`: define o saldo de uma conta para um recurso.
- `DELTA_APPLIED`: adiciona ou desconta um valor do saldo.
- `DELTA_REVERTED`: reverte uma movimentação já aplicada.

Os eventos são validados antes do processamento. A assinatura é conferida usando HMAC-SHA256 sobre o corpo original da requisição.

Também são tratados eventos duplicados, operações que deixariam o saldo negativo, reversões inválidas e snapshots antigos.

O processamento utiliza transações no PostgreSQL com isolamento `Serializable` e tentativas de repetição em caso de conflito de serialização.

### Consulta de saldos

Os saldos são armazenados por conta e recurso.

O frontend permite consultar uma conta pelo identificador e visualizar seus saldos atuais.

### Histórico de eventos

A aplicação apresenta os últimos eventos recebidos, mostrando o tipo, o status, a data e o motivo quando houver rejeição.

### Reconciliação CSV

É possível importar um CSV para comparar seus valores com os saldos armazenados no banco.

O arquivo deve seguir este formato:

```csv
account_id,resource_key,reference_date,amount
ACC-1001,BRL,2026-11-02,100.00000000
ACC-1001,POINTS,2026-11-02,250.00000000
```

A comparação retorna:

- `MATCH`: o valor informado corresponde ao saldo encontrado.
- `MISMATCH`: os valores são diferentes ou não existe saldo para a conta e o recurso.

São aceitos até 100 registros por importação, com limite de 64 KB.

A reconciliação consulta os saldos atuais, não reconstrói o saldo histórico da data informada no CSV. O resultado fica registrado no banco, mas a importação não altera o saldo oficial.

Para tratar uma divergência, o operador deve conferir o arquivo e o histórico de eventos antes de realizar qualquer correção pelos mecanismos normais de movimentação.

## Endpoints

### Webhooks

**POST `/webhooks/events`**

Recebe e processa um evento.

Exemplo de snapshot:

```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "BALANCE_SNAPSHOT",
  "occurred_at": "2026-11-02T00:00:00Z",
  "payload": {
    "account_id": "ACC-1001",
    "resource_key": "BRL",
    "reference_date": "2026-11-02",
    "amount": "100.00000000"
  }
}
```

É obrigatório enviar o header `X-Webhook-Signature` no formato:

```text
sha256=<assinatura>
```

A assinatura é gerada com o segredo definido em `WEBHOOK_SECRET`.

O campo `occurred_at` precisa estar dentro da janela de cinco minutos em relação ao horário do servidor. Para testar o exemplo, substitua a data pelo horário UTC atual e gere novamente a assinatura do corpo enviado.

**GET `/webhooks/events`**

Retorna os últimos 20 eventos registrados.

### Saldos

**GET `/accounts/:accountId/balances`**

Retorna todos os saldos de uma conta.

Exemplo:

```http
GET /accounts/ACC-1001/balances
```

A resposta contém `resource_key`, `amount` e `updated_at`.

**GET `/balances?account_id=ACC-1001&resource_key=BRL`**

Consulta o saldo de um recurso específico.

### Reconciliação

**POST `/reconciliations/import-csv`**

Importa um CSV e compara os valores com os saldos atuais.

**POST `/reconciliations/import`**

Recebe os registros de reconciliação em JSON.

**GET `/reconciliations`**

Consulta as últimas reconciliações registradas.

Os endpoints de reconciliação exigem o header `X-Admin-Key`, com o valor configurado em `RECONCILIATION_ADMIN_KEY`.

No ambiente local, o proxy do Vite encaminha essa chave nas importações CSV realizadas pelo frontend. Esse comportamento existe apenas para facilitar a execução do teste; não é um mecanismo de autenticação adequado para produção.

### Health check

**GET `/health/ready`**

Verifica a disponibilidade da API.

## Testes

Com os contêineres em execução, os testes podem ser executados diretamente pelo Docker.

Testes unitários:

```bash
docker compose exec api npm run test -- --runInBand
```

Testes de integração (E2E):

```bash
docker compose exec api npm run test:e2e -- --runInBand
```

Para verificar build e lint:

```bash
docker compose exec api npm run build
docker compose exec api npm run lint
docker compose exec web npm run build
docker compose exec web npm run lint
```

Na última execução, passaram 23 testes unitários e 57 testes E2E.

Os testes cobrem os principais cenários de processamento: idempotência, snapshots, aplicação e reversão de deltas, saldo insuficiente, assinatura inválida, anti-replay e operações concorrentes.

Também há testes para importação CSV, validação dos arquivos, controle de acesso e rollback de transações.

## Decisões técnicas

Algumas decisões tomadas durante a implementação:

- Utilização de `Decimal(28,8)` para armazenar valores financeiros.
- Uso do `event_id` para garantir que o mesmo evento não seja aplicado duas vezes.
- Persistência dos eventos para auditoria, incluindo o motivo de rejeição.
- Transações `Serializable` para manter a consistência dos saldos.
- Rejeição de snapshots mais antigos que o snapshot já registrado.
- Controle de versão do saldo para impedir reversões de movimentações anteriores a um novo snapshot.
- Separação entre processamento financeiro e reconciliação. O CSV serve apenas para comparar e registrar diferenças.

O Docker Compose foi configurado para desenvolvimento e avaliação local.

## HMAC solicitado no enunciado

Mensagem: `li o enunciado inteiro`

Chave: `test-only-not-production`

HMAC-SHA256:

```text
sha256=6fab1e5859bef17dc0aecb7e493d4b8cdc533f620ddf2afe5400c8429a0dd448
```
