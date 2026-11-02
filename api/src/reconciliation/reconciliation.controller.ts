import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationAdminGuard } from './guards/reconciliation-admin.guard';
import { reconciliationRowSchema } from './reconciliation.schema';
import { parseReconciliationCsv } from './reconciliation-csv';

@Controller('reconciliations')
@UseGuards(ReconciliationAdminGuard)
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Post('import')
  async importRows(@Body() body: { rows: unknown }) {
    if (
      !Array.isArray(body?.rows) ||
      body.rows.length === 0 ||
      body.rows.length > 100
    ) {
      throw new BadRequestException('Invalid format');
    }

    const parsed = reconciliationRowSchema.array().safeParse(body.rows);

    if (!parsed.success) {
      throw new BadRequestException('Invalid format');
    }

    return this.reconciliationService.reconcile(parsed.data);
  }

  @Post('import-csv')
  async importCsv(@Req() request: Request) {
    if (typeof request.body !== 'string') {
      throw new BadRequestException('Invalid format');
    }

    const rows = parseReconciliationCsv(request.body);

    return this.reconciliationService.reconcile(rows);
  }

  @Get()
  getRecentReconciliations() {
    return this.reconciliationService.getRecentReconciliations();
  }
}
