import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UsePipes,
} from '@nestjs/common';

import { WebhookSignatureGuard } from './guards/webhook-signature.guard';
import { WebhookValidationPipe } from './pipes/webhook-validation.pipe';
import type { WebhookEventDto } from './dto/webhook-event.schema';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @UseGuards(WebhookSignatureGuard)
  @UsePipes(WebhookValidationPipe)
  @Post('events')
  @HttpCode(HttpStatus.ACCEPTED)
  receive(@Body() body: WebhookEventDto) {
    return this.webhooksService.receive(body);
  }

  @Get('events')
  getRecentEvents() {
    return this.webhooksService.getRecentEvents();
  }
}
