import { Module } from '@nestjs/common';
import { MeteoSwissController } from './meteoswiss.controller';
import { MeteoSwissService } from './meteoswiss.service';
import { MeteoSwissRenderer } from './meteoswiss.renderer';

@Module({
  controllers: [MeteoSwissController],
  providers: [MeteoSwissService, MeteoSwissRenderer],
})
export class InkyPiModule {}
