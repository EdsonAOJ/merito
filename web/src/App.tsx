import { useState } from "react";
import { Box, Container, Flex, Heading, Text } from "@chakra-ui/react";
import { AppDrawer } from "./components/AppDrawer";
import { BalancePage } from "./components/BalancePage";
import { RecentEvents } from "./components/RecentEvents";
import { ReconciliationPage } from "./components/ReconciliationPage";

export type Page = "balances" | "events" | "reconciliation";

const pageInfo = {
  balances: {
    title: "Consulta de saldos",
    description: "Consulte os saldos consolidados de uma conta.",
  },
  events: {
    title: "Histórico de eventos",
    description: "Acompanhe os últimos webhooks recebidos.",
  },
  reconciliation: {
    title: "Reconciliação CSV",
    description: "Compare arquivos externos com os saldos registrados.",
  },
};

function App() {
  const [page, setPage] = useState<Page>("balances");

  return (
    <Box minH="100vh" bg="gray.950" color="gray.100">
      <Box borderBottomWidth="1px" borderColor="gray.800">
        <Container maxW="5xl" py="4">
          <Flex align="center" justify="space-between">
            <Heading size="lg">Mérito</Heading>

            <AppDrawer currentPage={page} onNavigate={setPage} />
          </Flex>
        </Container>
      </Box>

      <Container maxW="5xl" py={{ base: "6", md: "10" }}>
        <Box mb="8">
          <Heading size="2xl" mb="2">
            {pageInfo[page].title}
          </Heading>

          <Text color="gray.400">{pageInfo[page].description}</Text>
        </Box>

        {page === "balances" && <BalancePage />}

        {page === "events" && <RecentEvents />}

        {page === "reconciliation" && <ReconciliationPage />}
      </Container>
    </Box>
  );
}

export default App;
