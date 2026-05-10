import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { InkyPiModule } from './inkypi/inkypi.module';

@Module({
  imports: [InkyPiModule],
  controllers: [HealthController],
})
export class AppModule {}
