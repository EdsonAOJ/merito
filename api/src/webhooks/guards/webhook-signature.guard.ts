import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  RawBodyRequest,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { verifyWebhookSignature } from '../security/webhook-signature';

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();

    const webhookSecret = process.env.WEBHOOK_SECRET;
    const signature = request.get('X-Webhook-Signature');

    if (!webhookSecret) {
      throw new InternalServerErrorException('Internal server error');
    }

    if (!request.rawBody || !signature) {
      throw new UnauthorizedException('Unauthorized');
    }

    if (!verifyWebhookSignature(request.rawBody, signature, webhookSecret)) {
      throw new UnauthorizedException('Unauthorized');
    }

    return true;
  }
}
