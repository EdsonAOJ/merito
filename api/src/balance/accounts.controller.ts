import { BadRequestException, Controller, Get, Param } from '@nestjs/common';

import { BalanceService } from './balance.service';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly balanceService: BalanceService) {}

  @Get(':accountId/balances')
  getBalances(@Param('accountId') accountId: string) {
    if (!accountId || accountId.length > 64) {
      throw new BadRequestException('Invalid account id');
    }

    return this.balanceService.getBalancesByAccountId(accountId);
  }
}
