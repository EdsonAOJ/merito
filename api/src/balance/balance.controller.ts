import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { getBalanceQuerySchema } from './dto/get-balance-query.schema';

@Controller('balances')
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  @Get()
  getBalance(@Query() query: unknown) {
    const result = getBalanceQuerySchema.safeParse(query);

    if (!result.success) {
      throw new BadRequestException('Invalid balance query parameters');
    }

    return this.balanceService.getBalance(
      result.data.account_id,
      result.data.resource_key,
    );
  }
}
