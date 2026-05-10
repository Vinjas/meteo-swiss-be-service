import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DEFAULT_TIMEZONE } from './meteoswiss.constants';
import { MeteoSwissRenderer } from './meteoswiss.renderer';
import { MeteoSwissService } from './meteoswiss.service';
import { MeteoSwissSettings } from './types';

@Controller('inkypi/meteoswiss')
export class MeteoSwissController {
  constructor(
    private readonly meteoSwiss: MeteoSwissService,
    private readonly renderer: MeteoSwissRenderer,
  ) {}

  @Get('weather')
  async weather(@Query() query: Record<string, string>) {
    const settings = this.settingsFromQuery(query);
    const timezone = query.timezone || process.env.INKYPI_TIMEZONE || DEFAULT_TIMEZONE;
    return this.meteoSwiss.loadWeather(settings, timezone);
  }

  @Get('image')
  @Header('Cache-Control', 'no-store')
  async image(@Query() query: Record<string, string>, @Res() response: Response) {
    const settings = this.settingsFromQuery(query);
    const timezone = query.timezone || process.env.INKYPI_TIMEZONE || DEFAULT_TIMEZONE;
    const width = positiveInt(query.width, Number(process.env.INKYPI_DEFAULT_WIDTH ?? 800));
    const height = positiveInt(query.height, Number(process.env.INKYPI_DEFAULT_HEIGHT ?? 480));
    const weather = await this.meteoSwiss.loadWeather(settings, timezone);
    const png = await this.renderer.render(weather, { width, height, timezone, settings });

    response.type('image/png');
    response.send(png);
  }

  private settingsFromQuery(query: Record<string, string>): MeteoSwissSettings {
    return {
      title: query.title,
      latitude: query.latitude,
      longitude: query.longitude,
      pointId: query.pointId,
      pointTypeId: query.pointTypeId,
      forecastDays: query.forecastDays,
      displayRefreshTime: query.displayRefreshTime,
      displayBattery: query.displayBattery,
      batteryStatusPath: query.batteryStatusPath,
      backgroundColor: query.backgroundColor,
      textColor: query.textColor,
      accentColor: query.accentColor,
    };
  }
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
