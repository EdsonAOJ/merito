import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

import {
  type WebhookEventDto,
  webhookEventSchema,
} from '../dto/webhook-event.schema';

@Injectable()
export class WebhookValidationPipe implements PipeTransform {
  transform(value: unknown): WebhookEventDto {
    const validationResult = webhookEventSchema.safeParse(value);

    if (validationResult.success === false)
      throw new BadRequestException('Invalid format');

    return validationResult.data;
  }
}
