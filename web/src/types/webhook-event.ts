export type WebhookEvent = {
  event_id: string;
  type: string;
  status: "applied" | "rejected";
  reason_code: string | null;
  occurred_at: string;
  received_at: string;
};
