import { useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import type { WebhookEvent } from "../types/webhook-event";

export function RecentEvents() {
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadEvents() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/webhooks/events");

      if (!response.ok) {
        throw new Error("Failed to fetch events");
      }

      const data: WebhookEvent[] = await response.json();
      setEvents(data);
    } catch {
      setError("Não foi possível carregar os eventos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadInitialEvents() {
      try {
        const response = await fetch("/webhooks/events");

        if (!response.ok) {
          throw new Error("Failed to fetch events");
        }

        const data: WebhookEvent[] = await response.json();

        if (active) {
          setEvents(data);
        }
      } catch {
        if (active) {
          setError("Não foi possível carregar os eventos.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadInitialEvents();

    return () => {
      active = false;
    };
  }, []);

  return (
    <Box
      id="events"
      bg="gray.900"
      borderWidth="1px"
      borderColor="gray.800"
      borderRadius="xl"
      p={{ base: "4", md: "6" }}
    >
      <Stack gap="5">
        <Flex
          align={{ base: "flex-start", md: "center" }}
          justify="space-between"
          gap="3"
          direction={{ base: "column", md: "row" }}
        >
          <Heading size="lg">Últimos eventos recebidos</Heading>

          <Button
            variant="outline"
            size="sm"
            loading={loading}
            onClick={() => void loadEvents()}
          >
            Atualizar eventos
          </Button>
        </Flex>

        {loading && events.length === 0 && (
          <Text color="gray.400">Carregando eventos...</Text>
        )}

        {error && (
          <Text role="alert" color="red.300">
            {error}
          </Text>
        )}

        {!loading && !error && events.length === 0 && (
          <Text color="gray.400">Nenhum evento recebido.</Text>
        )}

        {events.length > 0 && (
          <Table.ScrollArea>
            <Table.Root size="sm" variant="line">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Tipo</Table.ColumnHeader>
                  <Table.ColumnHeader>Status</Table.ColumnHeader>
                  <Table.ColumnHeader>Motivo</Table.ColumnHeader>
                  <Table.ColumnHeader>Recebido em</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>

              <Table.Body>
                {events.map((event) => (
                  <Table.Row key={event.event_id}>
                    <Table.Cell>{event.type}</Table.Cell>
                    <Table.Cell>
                      <Badge
                        colorPalette={
                          event.status === "applied" ? "green" : "red"
                        }
                      >
                        {event.status}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>{event.reason_code ?? "—"}</Table.Cell>
                    <Table.Cell>
                      {new Date(event.received_at).toLocaleString("pt-BR")}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Table.ScrollArea>
        )}
      </Stack>
    </Box>
  );
}
