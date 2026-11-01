import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhookValidationPipe } from './pipes/webhook-validation.pipe';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard';
import { WebhooksService } from './webhooks.service';

import { BalanceModule } from '../balance/balance.module';

@Module({
  imports: [BalanceModule],
  controllers: [WebhooksController],
  providers: [WebhookValidationPipe, WebhookSignatureGuard, WebhooksService],
})
export class WebhooksModule {}
