import { useState } from "react";
import type { FormEvent } from "react";
import {
  Box,
  Button,
  Field,
  Heading,
  Input,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import type { Balance } from "../types/balance";

export function BalancePage() {
  const [accountId, setAccountId] = useState("");
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const id = accountId.trim();

    if (!id) {
      setError("Informe o identificador da conta.");
      return;
    }

    setLoading(true);
    setError("");
    setSearched(false);
    setBalances([]);

    try {
      const response = await fetch(
        `/accounts/${encodeURIComponent(id)}/balances`,
      );

      if (!response.ok) {
        throw new Error("Failed to fetch balances");
      }

      const data: Balance[] = await response.json();

      setBalances(data);
      setSearched(true);
    } catch {
      setError("Não foi possível consultar os saldos. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box
      bg="gray.900"
      borderWidth="1px"
      borderColor="gray.800"
      borderRadius="xl"
      p={{ base: "4", md: "6" }}
    >
      <Stack gap="5">
        <Heading size="lg">Saldos da conta</Heading>

        <form onSubmit={(event) => void handleSearch(event)}>
          <Stack gap="4">
            <Field.Root>
              <Field.Label>Identificador da conta</Field.Label>

              <Input
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                placeholder="Ex.: ACC-DEMO"
                maxLength={64}
                bg="gray.950"
              />
            </Field.Root>

            <Button
              type="submit"
              colorPalette="blue"
              loading={loading}
              alignSelf="flex-start"
            >
              Consultar
            </Button>
          </Stack>
        </form>

        {error && (
          <Text role="alert" color="red.300">
            {error}
          </Text>
        )}

        {searched && !error && (
          <Stack gap="4">
            <Heading size="md">Resultado</Heading>

            {balances.length === 0 ? (
              <Text color="gray.400">
                Nenhum saldo encontrado para esta conta.
              </Text>
            ) : (
              <Table.ScrollArea>
                <Table.Root size="sm" variant="line">
                  <Table.Header>
                    <Table.Row bg="gray.800">
                      <Table.ColumnHeader color="gray.300">
                        Recurso
                      </Table.ColumnHeader>
                      <Table.ColumnHeader color="gray.300">
                        Saldo
                      </Table.ColumnHeader>
                      <Table.ColumnHeader color="gray.300">
                        Atualizado em
                      </Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>

                  <Table.Body>
                    {balances.map((balance) => (
                      <Table.Row key={balance.resource_key}>
                        <Table.Cell>{balance.resource_key}</Table.Cell>
                        <Table.Cell fontWeight="medium">
                          {balance.amount}
                        </Table.Cell>
                        <Table.Cell>
                          {new Date(balance.updated_at).toLocaleString("pt-BR")}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </Table.ScrollArea>
            )}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
