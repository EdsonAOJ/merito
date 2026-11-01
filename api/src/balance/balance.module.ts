import { Module } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { BalanceController } from './balance.controller';
import { AccountsController } from './accounts.controller';

@Module({
  controllers: [BalanceController, AccountsController],
  providers: [BalanceService],
  exports: [BalanceService],
})
export class BalanceModule {}
