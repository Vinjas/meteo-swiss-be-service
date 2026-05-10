import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  ASSETS_URL,
  CACHE_RETENTION_SECONDS,
  CACHE_TTL_SECONDS,
  DEFAULT_BATTERY_STATUS_PATH,
  DEFAULT_LATITUDE,
  DEFAULT_LONGITUDE,
  DEFAULT_TIMEZONE,
  FIXED_METEOSWISS_POINT,
  ITEM_URL,
  META_POINT_ASSET,
  METADATA_TTL_SECONDS,
  PARAMETERS,
} from './meteoswiss.constants';
import { BatteryStatus, MeteoSwissPoint, MeteoSwissSettings, MeteoSwissWeather, TimedValue } from './types';
import { dateKey, hourInTimeZone, spanishDayAbbr, spanishLongDate, timeLabel } from './timezone';

type ForecastItem = {
  id?: string;
  itemId: string;
  assets?: Record<string, { href: string; updated?: string; created?: string }>;
};

type ParameterName = keyof typeof PARAMETERS;
type ParameterRows = Record<ParameterName, TimedValue[]>;

@Injectable()
export class MeteoSwissService {
  private readonly logger = new Logger(MeteoSwissService.name);

  async loadWeather(settings: MeteoSwissSettings = {}, timezone = DEFAULT_TIMEZONE): Promise<MeteoSwissWeather> {
    await this.cleanupCache();

    const lat = Number(settings.latitude ?? DEFAULT_LATITUDE);
    const lon = Number(settings.longitude ?? DEFAULT_LONGITUDE);
    const point = await this.resolvePoint(String(settings.pointId ?? '').trim(), String(settings.pointTypeId ?? '').trim(), lat, lon);
    const item = await this.getForecastItem();
    const rows = {} as ParameterRows;

    for (const [name, parameter] of Object.entries(PARAMETERS) as [ParameterName, string][]) {
      rows[name] = await this.readParameterRows(item, parameter, point.pointId, point.pointTypeId);
    }

    const now = new Date();
    const currentTemp = this.currentValue(rows.temperatureHourly, now);
    const currentIconCode = this.currentValue(rows.weatherHourly, now);
    const forecast = this.mergeDaily(rows, dateKey(now, timezone), Number(settings.forecastDays ?? 7), timezone);

    return {
      title: spanishLongDate(now, timezone),
      location: point.pointName,
      point,
      updated: new Date(),
      currentDate: timeLabel(now, timezone),
      currentTemperature: currentTemp,
      currentIcon: this.mapMeteoSwissIcon(currentIconCode, true),
      currentPrecip: Number(this.currentValue(rows.precipHourly, now, 0) ?? 0),
      currentPop: this.currentValue(rows.precipProbabilityHourly, now, null),
      currentWind: this.currentValue(rows.windSpeedHourly, now, null),
      currentGust: this.currentValue(rows.windGustHourly, now, null),
      currentWindDir: this.currentValue(rows.windDirectionHourly, now, null),
      currentHigh: forecast[0]?.high,
      currentLow: forecast[0]?.low,
      currentPrecipLow: forecast[0]?.precipLow,
      currentPrecipHigh: forecast[0]?.precipHigh,
      hourly: this.mergeHourly(rows, now, timezone),
      forecast,
      battery: await this.loadBatteryStatus(settings, now),
    };
  }

  private async resolvePoint(pointId: string, pointTypeId: string, lat: number, lon: number): Promise<MeteoSwissPoint> {
    if (!pointId && !pointTypeId && FIXED_METEOSWISS_POINT) {
      return { ...FIXED_METEOSWISS_POINT };
    }

    if (pointId && pointTypeId) {
      const found = await this.findPointById(pointId, pointTypeId);
      return found ?? { pointId, pointTypeId, pointName: `Point ${pointId}`, distanceKm: null };
    }

    const points = await this.readPoints();
    let nearest = points[0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const point of points) {
      if (point.lat === undefined || point.lon === undefined) {
        continue;
      }
      const distance = this.haversineKm(lat, lon, point.lat, point.lon);
      if (distance < nearestDistance) {
        nearest = point;
        nearestDistance = distance;
      }
    }
    return { ...nearest, distanceKm: nearestDistance };
  }

  private async findPointById(pointId: string, pointTypeId: string): Promise<MeteoSwissPoint | undefined> {
    const points = await this.readPoints();
    return points.find((point) => point.pointId === pointId && point.pointTypeId === pointTypeId);
  }

  private async readPoints(): Promise<MeteoSwissPoint[]> {
    const file = await this.downloadCollectionAsset(META_POINT_ASSET);
    const rows = parseCsv(await fs.readFile(file, 'latin1'));
    const points = rows
      .map((row) => ({
        pointId: row.point_id,
        pointTypeId: row.point_type_id,
        pointName: row.point_name || row.station_abbr || '',
        postalCode: row.postal_code || '',
        lat: toNumber(row.point_coordinates_wgs84_lat),
        lon: toNumber(row.point_coordinates_wgs84_lon),
      }))
      .filter((point) => point.pointId && point.pointTypeId && point.lat !== undefined && point.lon !== undefined);

    if (!points.length) {
      throw new Error('MeteoSwiss point metadata is empty.');
    }
    return points;
  }

  private async getForecastItem(): Promise<ForecastItem> {
    let lastError: unknown;
    for (let offset = 0; offset < 4; offset += 1) {
      const day = new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
      const itemId = `${day.getUTCFullYear()}${String(day.getUTCMonth() + 1).padStart(2, '0')}${String(day.getUTCDate()).padStart(2, '0')}-ch`;
      const cached = await this.readCachedItem(itemId);
      if (cached && (await this.isFresh(path.join(this.cacheDir(), `${itemId}.json`), CACHE_TTL_SECONDS))) {
        return cached;
      }

      try {
        const response = await fetch(ITEM_URL.replace('{item_id}', itemId));
        if (response.status === 404) {
          continue;
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} for forecast item ${itemId}`);
        }
        const item = (await response.json()) as ForecastItem;
        item.itemId = itemId;
        await this.cacheItem(item);
        return item;
      } catch (error) {
        lastError = error;
        if (cached) {
          this.logger.warn(`Using cached MeteoSwiss item after request failure: ${itemId}`);
          return cached;
        }
      }
    }
    throw new Error(`No MeteoSwiss forecast item available: ${String(lastError)}`);
  }

  private async readCachedItem(itemId: string): Promise<ForecastItem | null> {
    const file = path.join(this.cacheDir(), `${itemId}.json`);
    try {
      const item = JSON.parse(await fs.readFile(file, 'utf8')) as ForecastItem;
      item.itemId = itemId;
      return item;
    } catch {
      return null;
    }
  }

  private async cacheItem(item: ForecastItem): Promise<void> {
    const itemId = item.itemId || item.id;
    if (!itemId) {
      return;
    }
    await fs.mkdir(this.cacheDir(), { recursive: true });
    await fs.writeFile(path.join(this.cacheDir(), `${itemId}.json`), JSON.stringify(item), 'utf8');
  }

  private async readParameterRows(item: ForecastItem, parameter: string, pointId: string, pointTypeId: string): Promise<TimedValue[]> {
    const asset = this.findParameterAsset(item, parameter);
    if (!asset) {
      this.logger.warn(`MeteoSwiss parameter ${parameter} not available in ${item.itemId}`);
      return [];
    }
    const file = await this.downloadFile(asset.href, path.basename(asset.href));
    return this.cachedFilteredParameter(file, item.itemId, parameter, pointId, pointTypeId);
  }

  private async cachedFilteredParameter(
    csvPath: string,
    itemId: string,
    parameter: string,
    pointId: string,
    pointTypeId: string,
  ): Promise<TimedValue[]> {
    const filteredPath = path.join(this.cacheDir(), `${path.parse(csvPath).name}_${itemId}_${parameter}_${pointTypeId}_${pointId}.json`);
    try {
      const [cachedStat, csvStat] = await Promise.all([fs.stat(filteredPath), fs.stat(csvPath)]);
      if (cachedStat.mtimeMs >= csvStat.mtimeMs) {
        const cachedRows = JSON.parse(await fs.readFile(filteredPath, 'utf8')) as { time: string; value: string | number }[];
        return cachedRows.map((row) => ({ time: new Date(row.time), value: row.value }));
      }
    } catch {
      // Cache miss.
    }

    const rows = await this.filterParameterCsv(csvPath, parameter, pointId, pointTypeId);
    await fs.writeFile(filteredPath, JSON.stringify(rows.map((row) => ({ time: row.time.toISOString(), value: row.value }))), 'utf8');
    return rows;
  }

  private findParameterAsset(item: ForecastItem, parameter: string) {
    const suffix = `.${parameter}.csv`;
    const assets = Object.entries(item.assets ?? {}).filter(([name]) => name.endsWith(suffix));
    assets.sort((a, b) => {
      const left = `${a[1].updated ?? a[1].created ?? ''}${a[0]}`;
      const right = `${b[1].updated ?? b[1].created ?? ''}${b[0]}`;
      return right.localeCompare(left);
    });
    return assets[0]?.[1];
  }

  private async downloadCollectionAsset(assetName: string): Promise<string> {
    const cachedPath = path.join(this.cacheDir(), assetName);
    if (await this.isFresh(cachedPath, METADATA_TTL_SECONDS)) {
      return cachedPath;
    }

    const response = await fetch(ASSETS_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for MeteoSwiss assets`);
    }
    const payload = (await response.json()) as { assets?: { id: string; href: string }[] };
    const asset = payload.assets?.find((entry) => entry.id === assetName);
    if (!asset) {
      throw new Error(`MeteoSwiss collection asset not found: ${assetName}`);
    }
    return this.downloadFile(asset.href, assetName);
  }

  private async downloadFile(url: string, filename: string): Promise<string> {
    await fs.mkdir(this.cacheDir(), { recursive: true });
    const file = path.join(this.cacheDir(), filename);
    if (await this.isFresh(file, CACHE_TTL_SECONDS)) {
      return file;
    }

    const etagPath = `${file}.etag`;
    const headers: Record<string, string> = {};
    try {
      headers['If-None-Match'] = (await fs.readFile(etagPath, 'utf8')).trim();
    } catch {
      // No ETag yet.
    }

    try {
      const response = await fetch(url, { headers });
      if (response.status === 304) {
        return file;
      }
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      const tempPath = `${file}.${createHash('sha1').update(url).digest('hex')}.tmp`;
      await pipeline(response.body as unknown as NodeJS.ReadableStream, createWriteStream(tempPath));
      await fs.rename(tempPath, file);
      const etag = response.headers.get('etag');
      if (etag) {
        await fs.writeFile(etagPath, etag, 'utf8');
      }
      return file;
    } catch (error) {
      try {
        await fs.access(file);
        this.logger.warn(`Using cached MeteoSwiss file after download failure: ${file}`);
        return file;
      } catch {
        throw error;
      }
    }
  }

  private async filterParameterCsv(file: string, parameter: string, pointId: string, pointTypeId: string): Promise<TimedValue[]> {
    const rows = parseCsv(await fs.readFile(file, 'latin1'));
    return rows
      .filter((row) => row.point_id === pointId && row.point_type_id === pointTypeId && row[parameter] !== undefined && row[parameter] !== '')
      .map((row) => ({
        time: parseMeteoSwissTime(row.Date),
        value: parseValue(row[parameter]),
      }));
  }

  private currentValue(rows: TimedValue[], now: Date, defaultValue: string | number | null = null): string | number | null {
    if (!rows.length) {
      return defaultValue;
    }
    let previous = rows[0];
    for (const row of rows) {
      if (row.time <= now) {
        previous = row;
      } else {
        return previous.value;
      }
    }
    return previous.value;
  }

  private mergeHourly(rows: ParameterRows, now: Date, timezone: string) {
    const byTime = (items: TimedValue[]) => new Map(items.map((row) => [row.time.toISOString(), row.value]));
    const tempByTime = byTime(rows.temperatureHourly);
    const iconByTime = byTime(rows.weatherHourly);
    const precipByTime = byTime(rows.precipHourly);
    const precipLowByTime = byTime(rows.precipHourlyLow);
    const precipHighByTime = byTime(rows.precipHourlyHigh);
    const popByTime = byTime(rows.precipProbabilityHourly);
    const sunByTime = byTime(rows.sunshineHourly);
    const windByTime = byTime(rows.windSpeedHourly);
    const gustByTime = byTime(rows.windGustHourly);
    const windDirByTime = byTime(rows.windDirectionHourly);
    const hourly = [];

    for (const row of rows.temperatureHourly) {
      if (row.time < now) {
        continue;
      }
      const key = row.time.toISOString();
      hourly.push({
        time: row.time,
        label: timeLabel(row.time, timezone),
        temperature: tempByTime.get(key),
        icon: this.mapMeteoSwissIcon(iconByTime.get(key), hourInTimeZone(row.time, timezone) >= 7 && hourInTimeZone(row.time, timezone) <= 19),
        precip: Number(precipByTime.get(key) ?? 0),
        precipLow: precipLowByTime.get(key),
        precipHigh: precipHighByTime.get(key),
        pop: popByTime.get(key) ?? null,
        sunshine: Number(sunByTime.get(key) ?? 0),
        wind: windByTime.get(key) ?? null,
        gust: gustByTime.get(key) ?? null,
        windDir: windDirByTime.get(key) ?? null,
      });
      if (hourly.length >= 24) {
        break;
      }
    }
    return hourly;
  }

  private mergeDaily(rows: ParameterRows, todayKey: string, forecastDays: number, timezone: string) {
    const byDate = (items: TimedValue[]) => new Map(items.map((row) => [dateKey(row.time, timezone), row.value]));
    const highs = byDate(rows.temperatureMaxDaily);
    const lows = byDate(rows.temperatureMinDaily);
    const rain = byDate(rows.precipDaily);
    const rainLow = byDate(rows.precipDailyLow);
    const rainHigh = byDate(rows.precipDailyHigh);
    const icons = byDate(rows.weatherDaily);
    const forecast = [];
    const today = new Date(`${todayKey}T12:00:00Z`);

    for (let offset = 0; offset <= forecastDays; offset += 1) {
      const day = new Date(today.getTime() + offset * 24 * 60 * 60 * 1000);
      const key = day.toISOString().slice(0, 10);
      if (!highs.has(key) && !lows.has(key) && !icons.has(key)) {
        continue;
      }
      forecast.push({
        date: key,
        day: spanishDayAbbr(key),
        high: highs.get(key),
        low: lows.get(key),
        precip: Number(rain.get(key) ?? 0),
        precipLow: rainLow.get(key),
        precipHigh: rainHigh.get(key),
        icon: this.mapMeteoSwissIcon(icons.get(key), true),
      });
    }
    return forecast;
  }

  private async loadBatteryStatus(settings: MeteoSwissSettings, now: Date): Promise<BatteryStatus | null> {
    if (String(settings.displayBattery ?? 'true') !== 'true') {
      return null;
    }
    const batteryPath = settings.batteryStatusPath || DEFAULT_BATTERY_STATUS_PATH;
    const candidates = [
      batteryPath,
      path.join(process.cwd(), batteryPath),
      path.join(process.cwd(), '..', batteryPath),
      path.join(process.cwd(), '..', 'src', batteryPath),
      path.join(process.cwd(), 'src', batteryPath),
    ];
    for (const candidate of candidates) {
      try {
        const data = JSON.parse(await fs.readFile(candidate, 'utf8')) as { vin?: unknown; percent?: unknown; charging?: unknown; updated?: string };
        const vin = toNumber(data.vin);
        if (vin === undefined) {
          return null;
        }
        const percent = toNumber(data.percent) ?? this.estimateLipoPercent(vin);
        let ageMinutes: number | null = null;
        if (data.updated) {
          const updated = new Date(data.updated);
          if (!Number.isNaN(updated.getTime())) {
            ageMinutes = Math.max(Math.floor((now.getTime() - updated.getTime()) / 60000), 0);
          }
        }
        return { vin, percent: Math.max(0, Math.min(100, Math.round(percent))), charging: Boolean(data.charging), ageMinutes };
      } catch {
        // Try next candidate.
      }
    }
    return null;
  }

  private mapMeteoSwissIcon(code: unknown, isDay = true): string {
    const value = Number(code);
    if (!Number.isFinite(value)) return isDay ? '01d' : '01n';
    if ([1, 101].includes(value)) return isDay ? '01d' : '01n';
    if ([2, 102, 3, 103].includes(value)) return isDay ? '022d' : '022n';
    if ([4, 104, 5, 105].includes(value)) return isDay ? '02d' : '02n';
    if ([6, 106, 7, 107, 8, 108].includes(value)) return '04d';
    if ([9, 109, 10, 110, 11, 111].includes(value)) return '50d';
    if ([12, 112, 13, 113, 14, 114, 15, 115, 16, 116].includes(value)) return '51d';
    if ([17, 117, 18, 118, 19, 119, 20, 120, 21, 121].includes(value)) return isDay ? '10d' : '10n';
    if ([22, 122, 23, 123, 24, 124, 25, 125, 26, 126].includes(value)) return '13d';
    if ([27, 127, 28, 128, 29, 129, 30, 130, 31, 131].includes(value)) return '11d';
    return '03d';
  }

  private cacheDir(): string {
    return process.env.INKYPI_CACHE_DIR || path.resolve(process.cwd(), 'data', 'cache');
  }

  private async cleanupCache(): Promise<void> {
    const dir = this.cacheDir();
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      if (!entry.isFile() || entry.name === META_POINT_ASSET) {
        continue;
      }
      const file = path.join(dir, entry.name);
      const stat = await fs.stat(file);
      if (now - stat.mtimeMs > CACHE_RETENTION_SECONDS * 1000) {
        await fs.rm(file, { force: true });
      }
    }
  }

  private async isFresh(file: string, ttlSeconds: number): Promise<boolean> {
    try {
      const stat = await fs.stat(file);
      return Date.now() - stat.mtimeMs < ttlSeconds * 1000;
    } catch {
      return false;
    }
  }

  private haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const radius = 6371;
    const p1 = degreesToRadians(lat1);
    const p2 = degreesToRadians(lat2);
    const dp = degreesToRadians(lat2 - lat1);
    const dl = degreesToRadians(lon2 - lon1);
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private estimateLipoPercent(vin: number): number {
    const curve = [
      [4.2, 100],
      [4.1, 90],
      [4.0, 75],
      [3.9, 58],
      [3.8, 40],
      [3.7, 22],
      [3.6, 10],
      [3.5, 3],
      [3.4, 0],
    ];
    if (vin >= curve[0][0]) return curve[0][1];
    for (let index = 1; index < curve.length; index += 1) {
      const [highV, highPct] = curve[index - 1];
      const [lowV, lowPct] = curve[index];
      if (vin >= lowV) {
        return lowPct + ((vin - lowV) / (highV - lowV)) * (highPct - lowPct);
      }
    }
    return 0;
  }
}

function parseMeteoSwissTime(raw: string): Date {
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6)) - 1;
  const day = Number(raw.slice(6, 8));
  const hour = Number(raw.slice(8, 10));
  const minute = Number(raw.slice(10, 12));
  return new Date(Date.UTC(year, month, day, hour, minute));
}

function parseCsv(content: string): Record<string, string>[] {
  const lines = content.split(/\r?\n/).filter(Boolean);
  const headers = splitCsvLine(lines.shift() ?? '');
  return lines.map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ';' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function parseValue(value: string): string | number {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return Number.isInteger(parsed) ? parsed : parsed;
  }
  return value;
}

function toNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}
