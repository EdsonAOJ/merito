import { useState } from "react";
import { Button, Drawer, Portal, Stack, Text } from "@chakra-ui/react";
import type { Page } from "../App";

type AppDrawerProps = {
  currentPage: Page;
  onNavigate: (page: Page) => void;
};

const pages: { id: Page; label: string }[] = [
  { id: "balances", label: "Consulta de saldos" },
  { id: "events", label: "Histórico de eventos" },
  { id: "reconciliation", label: "Reconciliação CSV" },
];

export function AppDrawer({ currentPage, onNavigate }: AppDrawerProps) {
  const [open, setOpen] = useState(false);

  function handleNavigate(page: Page) {
    onNavigate(page);
    setOpen(false);
  }

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(details) => setOpen(details.open)}
      placement="start"
      size="xs"
    >
      <Drawer.Trigger asChild>
        <Button variant="outline" size="sm" colorPalette="blue">
          ☰ Menu
        </Button>
      </Drawer.Trigger>

      <Portal>
        <Drawer.Backdrop />

        <Drawer.Positioner>
          <Drawer.Content bg="gray.900" color="gray.100">
            <Drawer.Header borderBottomWidth="1px" borderColor="gray.800">
              <Drawer.Title>Mérito</Drawer.Title>
            </Drawer.Header>

            <Drawer.Body py="6">
              <Text fontSize="sm" color="gray.400" mb="5">
                Navegação
              </Text>

              <Stack gap="2">
                {pages.map((page) => (
                  <Button
                    key={page.id}
                    variant={currentPage === page.id ? "subtle" : "ghost"}
                    colorPalette={currentPage === page.id ? "blue" : "gray"}
                    justifyContent="flex-start"
                    width="100%"
                    onClick={() => handleNavigate(page.id)}
                  >
                    {page.label}
                  </Button>
                ))}
              </Stack>
            </Drawer.Body>

            <Drawer.Footer borderTopWidth="1px" borderColor="gray.800">
              <Button
                variant="outline"
                colorPalette="gray"
                onClick={() => setOpen(false)}
              >
                Fechar
              </Button>
            </Drawer.Footer>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
}
