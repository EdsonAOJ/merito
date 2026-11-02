import { useState } from "react";
import type { FormEvent } from "react";
import {
  Badge,
  Box,
  Button,
  Field,
  Heading,
  Input,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";

type ReconciliationResult = {
  account_id: string;
  resource_key: string;
  expected_amount: string;
  actual_amount: string | null;
  status: "MATCH" | "MISMATCH";
};

export function ReconciliationPage() {
  const [file, setFile] = useState<File | null>(null);
  const [results, setResults] = useState<ReconciliationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [imported, setImported] = useState(false);

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      setError("Selecione um arquivo CSV.");
      return;
    }

    setLoading(true);
    setError("");
    setResults([]);
    setImported(false);

    try {
      if (file.size > 64 * 1024) {
        throw new Error("O arquivo excede o limite de 64 KB.");
      }

      const csv = await file.text();

      const response = await fetch("/reconciliations/import-csv", {
        method: "POST",
        headers: {
          "Content-Type": "text/csv",
        },
        body: csv,
      });

      if (!response.ok) {
        if (response.status === 400) {
          throw new Error("Arquivo CSV inválido.");
        }

        throw new Error("Não foi possível importar o arquivo.");
      }

      const data: ReconciliationResult[] = await response.json();

      setResults(data);
      setImported(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível importar o arquivo.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack gap="6">
      <Box
        bg="gray.900"
        borderWidth="1px"
        borderColor="gray.800"
        borderRadius="xl"
        p={{ base: "4", md: "6" }}
      >
        <Stack gap="5">
          <Heading size="lg">Importar CSV</Heading>

          <Text color="gray.400" fontSize="sm">
            Compare os valores do arquivo com os saldos atuais. A importação não
            altera o saldo oficial.
          </Text>

          <form onSubmit={(event) => void handleImport(event)}>
            <Stack gap="4">
              <Field.Root>
                <Field.Label>Arquivo CSV</Field.Label>
                <Input
                  type="file"
                  accept=".csv,text/csv"
                  bg="gray.950"
                  p="2"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setError("");
                    setImported(false);
                    setResults([]);
                  }}
                />
                <Field.HelperText color="gray.400">
                  Até 100 linhas e 64 KB.
                </Field.HelperText>
              </Field.Root>

              <Button
                type="submit"
                colorPalette="blue"
                loading={loading}
                alignSelf="flex-start"
              >
                Importar e reconciliar
              </Button>
            </Stack>
          </form>

          {error && (
            <Text role="alert" color="red.300">
              {error}
            </Text>
          )}
        </Stack>
      </Box>

      {imported && (
        <Box
          bg="gray.900"
          borderWidth="1px"
          borderColor="gray.800"
          borderRadius="xl"
          p={{ base: "4", md: "6" }}
        >
          <Stack gap="5">
            <Heading size="lg">Resultado da reconciliação</Heading>

            <Table.ScrollArea>
              <Table.Root size="sm" variant="line">
                <Table.Header>
                  <Table.Row bg="gray.800">
                    <Table.ColumnHeader color="gray.300">
                      Conta
                    </Table.ColumnHeader>
                    <Table.ColumnHeader color="gray.300">
                      Recurso
                    </Table.ColumnHeader>
                    <Table.ColumnHeader color="gray.300">
                      CSV
                    </Table.ColumnHeader>
                    <Table.ColumnHeader color="gray.300">
                      Banco
                    </Table.ColumnHeader>
                    <Table.ColumnHeader color="gray.300">
                      Status
                    </Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>

                <Table.Body>
                  {results.map((result, index) => (
                    <Table.Row key={index}>
                      <Table.Cell>{result.account_id}</Table.Cell>
                      <Table.Cell>{result.resource_key}</Table.Cell>
                      <Table.Cell>{result.expected_amount}</Table.Cell>
                      <Table.Cell>{result.actual_amount ?? "—"}</Table.Cell>
                      <Table.Cell>
                        <Badge
                          colorPalette={
                            result.status === "MATCH" ? "green" : "red"
                          }
                        >
                          {result.status}
                        </Badge>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Table.ScrollArea>
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
