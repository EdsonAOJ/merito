# Mérito — API de saldos

API feita com NestJS para receber eventos de saldo e consultar o saldo atual de uma conta.

## Tecnologias

- Node.js e TypeScript
- NestJS
- PostgreSQL e Prisma
- Docker Compose
- Jest e Supertest

## Como executar

É necessário ter o Docker Desktop instalado e em execução.

Na pasta raiz do projeto:

```bash
docker compose up -d --build
```

O Docker inicia o PostgreSQL e a API. Na inicialização, o Prisma Client é gerado e as migrations são aplicadas automaticamente.

API: `http://localhost:3000`

Para acompanhar os logs:

```bash
docker compose logs -f api
```

Para parar os contêineres:

```bash
docker compose down
```

## Endpoints

### `POST /webhooks/events`

Recebe três tipos de evento:

- `BALANCE_SNAPSHOT`: define o saldo a partir de um snapshot.
- `DELTA_APPLIED`: adiciona ou desconta um valor.
- `DELTA_REVERTED`: reverte uma movimentação anterior.

As requisições precisam enviar o header `X-Webhook-Signature` com um HMAC SHA-256 do corpo original, no formato `sha256=<assinatura>`, usando o `WEBHOOK_SECRET` configurado no ambiente.

Exemplo de corpo para um snapshot:

```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "BALANCE_SNAPSHOT",
  "occurred_at": "2026-11-01T18:00:00Z",
  "payload": {
    "account_id": "ACC-1001",
    "resource_key": "BRL",
    "reference_date": "2026-11-01",
    "amount": "100.00"
  }
}
```

> Para enviar esse exemplo, atualize `occurred_at` para o horário atual e gere a assinatura HMAC correspondente. Eventos novos fora da janela de cinco minutos são recusados.

### `GET /balances`

Consulta o saldo atual de uma conta:

```http
GET /balances?account_id=ACC-1001&resource_key=BRL
```

### `GET /accounts/:accountId/balances`

Retorna todos os saldos de uma conta.

Exemplo:

GET /accounts/ACC-1001/balances

A resposta é uma lista com `resource_key`, `amount` e `updated_at`.

### `GET /health/ready`

Verifica a disponibilidade da aplicação.

## Testes

Com os contêineres em execução:

```bash
docker compose exec api npm run test:e2e -- --runInBand
```

## Regras principais

- Um mesmo `event_id` não é aplicado duas vezes.
- Não é permitido deixar um saldo negativo.
- Transações não podem ser aplicadas ou revertidas duas vezes.
- Snapshots antigos são rejeitados.
- As alterações financeiras são executadas dentro de transações no banco.

As configurações do Docker Compose são voltadas para executar o desafio localmente, não para uso em produção.
