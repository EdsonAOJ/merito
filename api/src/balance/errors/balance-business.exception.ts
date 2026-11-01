import { HttpException, HttpStatus } from '@nestjs/common';
import { BalanceReasonCode } from './balance-reason-code';

export class BalanceBusinessException extends HttpException {
  constructor(
    public readonly reasonCode: BalanceReasonCode,
    message: string,
    status: HttpStatus,
  ) {
    super(message, status);
  }
}
