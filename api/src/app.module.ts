import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { WebhooksModule } from './webhooks/webhooks.module';
import { BalanceModule } from './balance/balance.module';

@Module({
  imports: [PrismaModule, WebhooksModule, BalanceModule],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
