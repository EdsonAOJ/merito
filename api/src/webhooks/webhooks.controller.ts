import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UsePipes,
} from '@nestjs/common';

import { WebhookSignatureGuard } from './guards/webhook-signature.guard';
import { WebhookValidationPipe } from './pipes/webhook-validation.pipe';
import type { WebhookEventDto } from './dto/webhook-event.schema';

@Controller('webhooks')
export class WebhooksController {
  @UseGuards(WebhookSignatureGuard)
  @UsePipes(WebhookValidationPipe)
  @Post('events')
  @HttpCode(HttpStatus.ACCEPTED)
  receive(@Body() body: WebhookEventDto) {
    console.log(body, 'body');
    return {
      status: 'received',
    };
  }
}
