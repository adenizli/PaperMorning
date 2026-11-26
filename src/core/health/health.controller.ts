import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../../common/http/authenticated-user';
import { DatabaseHealthService } from '../../service/persistence/database-health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly databaseHealth: DatabaseHealthService) {}

  @Public()
  @Get()
  async check(): Promise<{ status: 'ok'; database: 'up' }> {
    if (!(await this.databaseHealth.isHealthy())) {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
    return { status: 'ok', database: 'up' };
  }
}
