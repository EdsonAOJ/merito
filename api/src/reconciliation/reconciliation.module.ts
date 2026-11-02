import { Module } from '@nestjs/common';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationAdminGuard } from './guards/reconciliation-admin.guard';

@Module({
  controllers: [ReconciliationController],
  providers: [ReconciliationService, ReconciliationAdminGuard],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
