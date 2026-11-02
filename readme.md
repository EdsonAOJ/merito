# Mérito — Teste Fullstack

Aplicação desenvolvida com NestJS e React para receber eventos de saldo via webhook, consultar saldos consolidados e realizar reconciliação de arquivos CSV.

## Tecnologias

- Node.js e TypeScript
- NestJS
- React, Vite e Chakra UI
- PostgreSQL e Prisma
- Docker Compose
- Jest e Supertest

## Como executar

É necessário ter o Docker Desktop instalado e em execução.

Na raiz do projeto, copie o `.env.example` para `.env` e configure as variáveis de ambiente.

As principais variáveis são:

- `DATABASE_URL`: conexão com o PostgreSQL.
- `POSTGRES_PASSWORD`: senha do banco local.
- `WEBHOOK_SECRET`: segredo para validar a assinatura dos webhooks.
- `RECONCILIATION_ADMIN_KEY`: chave utilizada nos endpoints administrativos de reconciliação.

Depois execute:

```bash
docker compose up -d --build
```

O Docker inicia o PostgreSQL, a API e o frontend. O Prisma Client é gerado e as migrations são aplicadas automaticamente durante a inicialização da API.

- Frontend: http://localhost:5173
- API: http://localhost:3000
- Health check: http://localhost:3000/health/ready

Para acompanhar os logs:

```bash
docker compose logs -f api
docker compose logs -f web
```

Para parar os contêineres:

```bash
docker compose down
```

## Funcionalidades

### Webhooks

`POST /webhooks/events`

Recebe três tipos de evento:

- `BALANCE_SNAPSHOT`: define ou redefine o saldo oficial.
- `DELTA_APPLIED`: adiciona ou desconta um valor.
- `DELTA_REVERTED`: reverte uma movimentação anterior.

As requisições precisam enviar o header `X-Webhook-Signature` com o HMAC-SHA256 do corpo original, no formato `sha256=<assinatura>`, utilizando `WEBHOOK_SECRET`.

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

Para testar, atualize `occurred_at` para o horário UTC atual e gere a assinatura correspondente. Eventos fora da janela de ±5 minutos são recusados, inclusive eventos duplicados.

### Consulta de saldos

`GET /accounts/:accountId/balances`

Retorna os saldos de uma conta com `resource_key`, `amount` e `updated_at`.

Exemplo:

```http
GET /accounts/ACC-1001/balances
```

Também existe a consulta por recurso:

```http
GET /balances?account_id=ACC-1001&resource_key=BRL
```

### Histórico de eventos

`GET /webhooks/events`

Retorna os últimos 20 eventos persistidos, incluindo tipo, status, motivo de rejeição e datas.

O histórico registra eventos aplicados e rejeitados. Requisições duplicadas são identificadas pela idempotência, mas não criam novos registros de eventos.

### Reconciliação CSV

`POST /reconciliations/import-csv`

Permite comparar um arquivo CSV com os saldos atuais armazenados no banco.

Formato esperado:

```csv
account_id,resource_key,reference_date,amount
ACC-1001,BRL,2026-11-02,100.00000000
ACC-1001,POINTS,2026-11-02,250.00000000
```

O resultado pode ser:

- `MATCH`: o valor do CSV corresponde ao saldo armazenado.
- `MISMATCH`: existe divergência ou o saldo não foi encontrado.

A importação aceita até 100 registros e possui limite de 64 KB.

**O CSV não altera os saldos oficiais.** Os valores calculados pelos webhooks continuam sendo a fonte operacional. Divergências ficam registradas para investigação e eventual correção por um operador.

A comparação utiliza o saldo atual no momento da importação. Não é realizada uma reconstrução histórica do saldo para a data de referência.

Os endpoints administrativos são protegidos por `X-Admin-Key`. No ambiente Docker local, o proxy de desenvolvimento do Vite encaminha a chave configurada no servidor para facilitar a demonstração do upload. Esse mecanismo não deve ser exposto publicamente e não substitui autenticação de produção.

Também estão disponíveis:

- `POST /reconciliations/import`: importação de registros JSON.
- `GET /reconciliations`: consulta das últimas reconciliações.

### Interface web

O frontend possui três telas:

- **Saldos:** consulta por identificador da conta.
- **Eventos:** histórico dos webhooks recebidos.
- **Reconciliação:** seleção de arquivo CSV e visualização dos resultados.

As telas possuem tratamento de carregamento, ausência de dados e erros de requisição.

## Testes

Com os contêineres em execução:

Testes unitários:

```bash
docker compose exec api npm run test -- --runInBand
```

Testes E2E:

```bash
docker compose exec api npm run test:e2e -- --runInBand
```

Build e lint da API:

```bash
docker compose exec api npm run build
docker compose exec api npm run lint
```

Build e lint do frontend:

```bash
docker compose exec web npm run build
docker compose exec web npm run lint
```

### Casos obrigatórios cobertos

- [x] Idempotência do mesmo `event_id`.
- [x] Snapshot seguido de delta.
- [x] Rejeição de operação que deixaria o saldo negativo.
- [x] Reversão de delta aplicado.
- [x] Delta sem snapshot prévio.
- [x] Assinatura HMAC inválida.
- [x] Rejeição de evento fora da janela anti-replay.
- [x] Reversão sem transação anterior.

Também foram implementados testes de concorrência, validação, duplicidade, importação CSV, autenticação administrativa, reconciliação e atomicidade.

Última execução validada: 23 testes unitários e 57 testes E2E.

## Decisões de implementação

- O saldo é mantido por `account_id` e `resource_key`.
- Os eventos são persistidos para auditoria.
- As operações financeiras utilizam transações PostgreSQL com isolamento `Serializable`.
- Conflitos de serialização dos webhooks possuem tentativas de reprocessamento.
- Valores financeiros utilizam `Decimal`, sem cálculos com ponto flutuante.
- Snapshots antigos são rejeitados; snapshots da mesma data podem redefinir o saldo.
- Reversões de transações de versões anteriores do snapshot são rejeitadas.
- A reconciliação registra diferenças sem modificar os saldos.
- O ambiente Docker é destinado ao desenvolvimento e à avaliação local, não à produção.

## Bônus do enunciado

HMAC-SHA256 da frase `li o enunciado inteiro`, utilizando o segredo de teste `test-only-not-production`:

```text
sha256=6fab1e5859bef17dc0aecb7e493d4b8cdc533f620ddf2afe5400c8429a0dd448
```

O valor acima utiliza exclusivamente o segredo demonstrativo fornecido no enunciado.
