import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { WebhookEventDto } from './dto/webhook-event.schema';
import { isWithinReplayWindow } from './security/webhook-replay';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookEventStatus } from '../generated/prisma/enums';
import { Prisma, type WebhookEvent } from '../generated/prisma/client';
import { BalanceService } from '../balance/balance.service';
import { isDeepStrictEqual } from 'node:util';
import { BalanceBusinessException } from '../balance/errors/balance-business.exception';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balanceService: BalanceService,
  ) {}

  async receive(event: WebhookEventDto) {
    if (!isWithinReplayWindow(new Date(event.occurred_at))) {
      throw new UnauthorizedException('Unauthorized');
    }

    const existingEvent = await this.prisma.webhookEvent.findUnique({
      where: {
        eventId: event.event_id,
      },
    });

    if (existingEvent) {
      this.validateDuplicate(existingEvent, event);
      return this.duplicateResponse(existingEvent);
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await this.prisma.$transaction(
          async (tx) => {
            await tx.webhookEvent.create({
              data: {
                eventId: event.event_id,
                type: event.type,
                occurredAt: new Date(event.occurred_at),
                payload: event.payload,
                status: WebhookEventStatus.APPLIED,
              },
            });

            try {
              await this.balanceService.apply(tx, event);

              return {
                event_id: event.event_id,
                status: 'applied',
              };
            } catch (err) {
              if (err instanceof BalanceBusinessException) {
                await tx.webhookEvent.update({
                  where: {
                    eventId: event.event_id,
                  },
                  data: {
                    status: WebhookEventStatus.REJECTED,
                    reasonCode: err.reasonCode,
                  },
                });

                return {
                  event_id: event.event_id,
                  status: 'rejected',
                  reason_code: err.reasonCode,
                };
              }

              throw err;
            }
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );

        return result;
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError)) {
          throw err;
        }

        if (err.code === 'P2002') {
          const duplicateEvent = await this.prisma.webhookEvent.findUnique({
            where: {
              eventId: event.event_id,
            },
          });

          if (duplicateEvent) {
            this.validateDuplicate(duplicateEvent, event);
            return this.duplicateResponse(duplicateEvent);
          }

          if (attempt < 2) {
            continue;
          }
        }

        if (err.code === 'P2034') {
          if (attempt < 2) {
            continue;
          }

          throw new HttpException(
            'Transaction temporarily unavailable. Retry later.',
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }

        throw err;
      }
    }

    throw new HttpException(
      'Transaction temporarily unavailable. Retry later.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  async getRecentEvents() {
    const events = await this.prisma.webhookEvent.findMany({
      orderBy: { receivedAt: 'desc' },
      take: 20,
      select: {
        eventId: true,
        type: true,
        status: true,
        reasonCode: true,
        occurredAt: true,
        receivedAt: true,
      },
    });

    return events.map((event) => ({
      event_id: event.eventId,
      type: event.type,
      status: event.status.toLowerCase(),
      reason_code: event.reasonCode,
      occurred_at: event.occurredAt.toISOString(),
      received_at: event.receivedAt.toISOString(),
    }));
  }

  private validateDuplicate(
    existingEvent: WebhookEvent,
    event: WebhookEventDto,
  ): void {
    if (existingEvent.type !== event.type) {
      throw new ConflictException('Event conflict');
    }

    if (!isDeepStrictEqual(existingEvent.payload, event.payload)) {
      throw new ConflictException('Event conflict');
    }

    if (
      existingEvent.occurredAt.getTime() !==
      new Date(event.occurred_at).getTime()
    ) {
      throw new ConflictException('Event conflict');
    }
  }

  private duplicateResponse(existingEvent: WebhookEvent) {
    if (existingEvent.status === WebhookEventStatus.REJECTED) {
      return {
        event_id: existingEvent.eventId,
        status: 'rejected',
        reason_code: existingEvent.reasonCode,
      };
    }

    return {
      event_id: existingEvent.eventId,
      status: 'duplicate',
    };
  }
}
