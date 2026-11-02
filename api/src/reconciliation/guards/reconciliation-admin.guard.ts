import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

@Injectable()
export class ReconciliationAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    const secret = process.env.RECONCILIATION_ADMIN_KEY;
    const provided = request.get('X-Admin-Key');

    if (!secret) {
      throw new InternalServerErrorException('Internal server error');
    }

    if (!provided) {
      throw new UnauthorizedException('Unauthorized');
    }

    const expectedBuffer = Buffer.from(secret);
    const providedBuffer = Buffer.from(provided);

    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      throw new UnauthorizedException('Unauthorized');
    }

    return true;
  }
}
