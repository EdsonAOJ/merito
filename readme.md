# Mérito — API de Saldos e Webhooks

API desenvolvida em **NestJS**, **TypeScript**, **Prisma** e **PostgreSQL** para receber eventos financeiros via webhook, manter saldos por conta e recurso e consultar o saldo atual.

O processamento considera **assinatura HMAC-SHA256**, **idempotência**, **concorrência**, **precisão decimal** e **auditoria de eventos**.

## Tecnologias

- Node.js 24 e NestJS 12
- TypeScript e Zod (validação)
- PostgreSQL 17, Prisma ORM 7 e adapter `@prisma/adapter-pg`
- Docker e Docker Compose
- Jest e Supertest (testes E2E)

## Pré-requisitos

- Docker com suporte a Docker Compose
- Portas locais **3000** (API) e **5433** (PostgreSQL) disponíveis

Não é necessário instalar Node.js ou PostgreSQL diretamente no computador para executar o projeto via Docker.

## Como executar (Docker)

**Pré-requisito:** Docker Desktop instalado e aberto, com as portas 3000 e 5433 disponíveis.

1. Baixe o repositório pelo GitHub (**Code → Download ZIP**) e extraia os arquivos.
2. Abra um terminal na pasta extraída, onde está `docker-compose.yml`.
3. Execute:

```bash
docker compose up -d --build
```

Pronto. A API estará disponível em **http://localhost:3000** quando a inicialização terminar. O Compose aguarda o PostgreSQL ficar saudável; o container da API executa automaticamente `prisma generate`, `prisma migrate deploy` e `npm run start:dev`.

Para acompanhar a inicialização:

```bash
docker compose logs -f api
```

Para executar os testes E2E:

```bash
docker compose exec api npm run test:e2e -- --runInBand
```

Para parar os contêineres sem apagar os dados:

```bash
docker compose down
```

**Atenção:** o `docker-compose.yml` deste exemplo usa valores padrão **exclusivamente para avaliação local**. Não exponha essa instalação à internet nem reutilize as credenciais em produção. Para personalizar as credenciais, configure `POSTGRES_PASSWORD`, `DATABASE_URL` e `WEBHOOK_SECRET` juntos no arquivo `.env` na raiz do projeto. O banco fica acessível a partir da máquina em `127.0.0.1:5433`.

## Endpoints

### `POST /webhooks/events`

Recebe um evento autenticado no cabeçalho:

```http
X-Webhook-Signature: sha256=<assinatura-hexadecimal>
Content-Type: application/json
```

A assinatura é um **HMAC-SHA256 do corpo JSON exato enviado na requisição**, usando `WEBHOOK_SECRET` como chave. Assinaturas inválidas são rejeitadas antes do processamento financeiro.

Tipos de evento disponíveis:

**`BALANCE_SNAPSHOT`** — define o saldo informado pela origem para uma data de referência:

```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440001",
  "type": "BALANCE_SNAPSHOT",
  "occurred_at": "2026-11-01T18:00:00.000Z",
  "payload": {
    "account_id": "ACC-1001",
    "resource_key": "BRL",
    "reference_date": "2026-10-31",
    "amount": "100.00"
  }
}
```

**`DELTA_APPLIED`** — aplica um crédito ou débito ao saldo existente:

```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440002",
  "type": "DELTA_APPLIED",
  "occurred_at": "2026-11-01T18:00:00.000Z",
  "payload": {
    "account_id": "ACC-1001",
    "resource_key": "BRL",
    "transaction_id": "TX-001",
    "amount_delta": "-30.00",
    "effective_date": "2026-10-31"
  }
}
```

**`DELTA_REVERTED`** — reverte uma transação aplicada anteriormente:

```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440003",
  "type": "DELTA_REVERTED",
  "occurred_at": "2026-11-01T18:00:00.000Z",
  "payload": {
    "account_id": "ACC-1001",
    "resource_key": "BRL",
    "transaction_id": "TX-001"
  }
}
```

> **Atenção:** os horários `occurred_at` acima são ilustrativos. Para enviar eventos novos, use a data e hora atuais: existe uma janela de tolerância de **5 minutos** para eventos novos, incluindo pequenas diferenças de relógio para o futuro.

O endpoint utiliza HTTP **202 Accepted** para eventos processados ou rejeitados por regras de negócio, indicando o resultado no corpo da resposta. Exemplos de status de negócio: `applied`, `rejected` e `duplicate` (para eventos aplicados repetidos). Requisições com formato inválido retornam **400**, assinaturas inválidas **401** e reutilização do mesmo `event_id` com conteúdo diferente **409**.

### `GET /balances`

Consulta o saldo por identificador da conta e recurso:

```http
GET /balances?account_id=ACC-1001&resource_key=BRL
```

Exemplo com `curl`:

```bash
curl "http://localhost:3000/balances?account_id=ACC-1001&resource_key=BRL"
```

## Exemplo de envio com assinatura válida

O exemplo abaixo utiliza Node.js **dentro do contêiner**. Ele gera um novo `event_id`, usa o horário atual e calcula a assinatura sobre o mesmo JSON que será enviado:

```bash
docker compose exec api node -e '
const { createHmac, randomUUID } = require("node:crypto");
const event = {
  event_id: randomUUID(),
  type: "BALANCE_SNAPSHOT",
  occurred_at: new Date().toISOString(),
  payload: {
    account_id: "ACC-EXEMPLO",
    resource_key: "BRL",
    reference_date: "2026-10-31",
    amount: "100.00"
  }
};
const body = JSON.stringify(event);
const signature = "sha256=" + createHmac("sha256", process.env.WEBHOOK_SECRET)
  .update(body)
  .digest("hex");
fetch("http://localhost:3000/webhooks/events", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Webhook-Signature": signature
  },
  body
}).then(async response => {
  console.log(response.status, await response.text());
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
'
```

Depois disso, consulte:

```bash
curl "http://localhost:3000/balances?account_id=ACC-EXEMPLO&resource_key=BRL"
```

## Regras de processamento

- **Idempotência por evento:** cada `event_id` é único. Reentregas de um evento já aplicado não reaplicam seus efeitos. O mesmo ID com dados diferentes gera conflito.
- **Idempotência por transação:** um mesmo `transaction_id` não pode ser aplicado duas vezes ao mesmo saldo.
- **Saldos não negativos:** snapshots e movimentações que tornariam o saldo negativo são rejeitados.
- **Precisão decimal:** os valores são tratados com `Decimal(28,8)` no banco, evitando aritmética financeira com ponto flutuante JavaScript.
- **Snapshots:** o snapshot substitui o valor atual do saldo e incrementa uma versão local. Snapshots com data de referência anterior à atual são rejeitados; a política atual permite outra atualização com a mesma data.
- **Reversões:** a operação inversa é aplicada apenas quando a transação existe, ainda não foi revertida, pertence à versão atual do snapshot e preserva os limites do saldo.
- **Concorrência:** operações financeiras são executadas em transações PostgreSQL com isolamento `Serializable` e tentativas de repetição para conflitos transitórios.
- **Auditoria:** os webhooks são armazenados com seu payload, data, resultado (`APPLIED` ou `REJECTED`) e motivo de rejeição, quando aplicável.

## Testes

Com os contêineres iniciados:

```bash
docker compose exec api npm run test:e2e -- --runInBand
```

Para executar os testes disponíveis na configuração padrão do Jest:

```bash
docker compose exec api npm run test -- --runInBand
```

Os testes E2E cobrem autenticação HMAC, validação do payload, snapshots, aplicação e reversão de deltas, idempotência, precisão decimal, consultas e condições de concorrência.

## Estrutura principal

```text
.
├── docker-compose.yml
├── .env                 # criado localmente, não versionar
└── api/
    ├── Dockerfile
    ├── prisma/
    │   ├── schema.prisma
    │   └── migrations/
    ├── src/
    │   ├── balance/
    │   ├── prisma/
    │   └── webhooks/
    └── test/
        └── webhooks.e2e-spec.ts
```

## Observações

Este projeto utiliza uma configuração Docker orientada a **desenvolvimento e avaliação técnica** (`start:dev` e volume de código montado). Uma implantação de produção exigiria revisão específica de build, execução, gerenciamento de segredos e migrations.
