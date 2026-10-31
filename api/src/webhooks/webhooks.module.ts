import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhookValidationPipe } from './pipes/webhook-validation.pipe';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard';

@Module({
  controllers: [WebhooksController],
  providers: [WebhookValidationPipe, WebhookSignatureGuard],
})
export class WebhooksModule {}
