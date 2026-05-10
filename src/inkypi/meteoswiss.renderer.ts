import { Injectable } from '@nestjs/common';
import { readFileSync, promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { BatteryStatus, DailyWeather, HourlyWeather, MeteoSwissWeather, RenderOptions } from './types';

type Rect = { left: number; top: number; right: number; bottom: number };
type Palette = {
  bg: string;
  panel: string;
  panelSoft: string;
  ink: string;
  muted: string;
  grid: string;
  accent: string;
  rainBlue: string;
  sunGold: string;
};

@Injectable()
export class MeteoSwissRenderer {
  async render(weather: MeteoSwissWeather, options: RenderOptions): Promise<Buffer> {
    const svg = await this.buildSvg(weather, options);
    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  private async buildSvg(weather: MeteoSwissWeather, options: RenderOptions): Promise<string> {
    const { width, height, settings } = options;
    const colors: Palette = {
      bg: settings.backgroundColor || '#111820',
      panel: '#1f2d39',
      panelSoft: '#243543',
      ink: settings.textColor || '#f4f7fb',
      muted: '#a3b0bc',
      grid: '#566979',
      accent: settings.accentColor || '#ff5a52',
      rainBlue: '#6bbcff',
      sunGold: '#b18b1f',
    };
    const margin = Math.max(Math.floor(Math.min(width, height) * 0.035), 10);
    const gap = Math.max(Math.floor(Math.min(width, height) * 0.018), 6);
    const titleSize = fitText(weather.title, width * 0.7, Math.max(Math.floor(height * 0.065), 20));
    const dateSize = Math.max(Math.floor(height * 0.03), 12);
    const tempSize = Math.max(Math.floor(height * 0.14), 42);
    const metricSize = Math.max(Math.floor(height * 0.034), 14);
    const smallSize = Math.max(Math.floor(height * 0.024), 10);

    const contentTop = margin + titleSize + dateSize + gap * 2;
    const forecastHeight = Math.max(Math.floor(height * 0.22), 82);
    const chartBottom = height - margin - forecastHeight - gap;
    const currentWidth = Math.floor(width * 0.25);

    let currentBox = rect(margin, contentTop, margin + currentWidth, chartBottom);
    let chartBox = rect(margin + currentWidth + gap, contentTop, width - margin, chartBottom);
    let forecastBox = rect(margin, chartBottom + gap, width - margin, height - margin * 2);

    if (width < height) {
      currentBox = rect(margin, contentTop, width - margin, contentTop + Math.floor(height * 0.28));
      chartBox = rect(margin, currentBox.bottom + gap, width - margin, chartBottom);
      forecastBox = rect(margin, chartBottom + gap, width - margin, height - margin * 2);
    }

    const topStatusOffset = width >= height ? 3 : 6;
    const battery = this.batteryIndicator(weather.battery, width - margin - 2, margin + topStatusOffset, smallSize, colors);
    const refresh =
      String(settings.displayRefreshTime ?? 'true') === 'true'
        ? svgText(width - margin - 2, margin + topStatusOffset + smallSize * (weather.battery ? 2.05 : 1.15), weather.currentDate, {
            anchor: 'end',
            fill: colors.muted,
            size: smallSize,
            weight: 700,
          })
        : '';

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      @font-face{font-family:Jost;src:url('${this.fontDataUrl('Jost.ttf')}')}
      @font-face{font-family:Jost;font-weight:700;src:url('${this.fontDataUrl('Jost-SemiBold.ttf')}')}
      text{font-family:Jost,"DejaVu Sans",Arial,sans-serif;dominant-baseline:auto}
    </style>
  </defs>
  <rect width="100%" height="100%" fill="${colors.bg}"/>
  ${svgText(margin, margin + titleSize * 0.82, weather.title, { fill: colors.ink, size: titleSize, weight: 700 })}
  ${svgText(margin, margin + titleSize * 1.05 + dateSize * 0.82, weather.location, { fill: colors.muted, size: dateSize, weight: 700 })}
  ${battery}
  ${refresh}
  ${await this.currentPanel(weather, currentBox, { tempSize, metricSize, smallSize }, colors)}
  ${await this.forecastCharts(weather.hourly, chartBox, smallSize, colors)}
  ${await this.forecastCards(weather.forecast.slice(1), forecastBox, metricSize, smallSize, colors)}
</svg>`;
  }

  private async currentPanel(
    weather: MeteoSwissWeather,
    box: Rect,
    fonts: { tempSize: number; metricSize: number; smallSize: number },
    colors: Palette,
  ): Promise<string> {
    const width = box.right - box.left;
    const height = box.bottom - box.top;
    const iconSize = Math.floor(Math.min(width * 0.54, height * 0.3));
    const icon = await this.iconDataUrl(weather.currentIcon);
    const temp = `${formatNumber(weather.currentTemperature)} C`;
    const tempDrawSize = fitText(temp, width * 0.82, Math.min(fonts.tempSize, Math.floor(height * 0.28)));
    const metricsX = box.left + width * 0.1;
    const metricsY = box.top + height * 0.66;
    const lineGap = fonts.metricSize * 1.35;
    const rainRange = formatPrecipRange(weather.currentPrecipLow, weather.currentPrecipHigh);
    const rain = rainRange || `${formatNumber(weather.currentPrecip, 1)} mm`;
    const high = formatNumber(weather.currentHigh);
    const low = formatNumber(weather.currentLow);
    const gust = formatNumber(weather.currentGust);
    const pop = formatNumber(weather.currentPop);

    return `
  ${roundedRect(box, 8, colors.panel, '#374959')}
  <image href="${icon}" x="${box.left + width * 0.1}" y="${box.top + height * 0.09}" width="${iconSize}" height="${iconSize}" preserveAspectRatio="xMidYMid meet"/>
  ${svgText(box.left + width * 0.1, box.top + height * 0.38 + tempDrawSize * 0.82, temp, {
    fill: colors.ink,
    size: tempDrawSize,
    weight: 700,
  })}
  ${svgText(metricsX, metricsY, `Lluvia ${rain}`, { fill: colors.rainBlue, size: fonts.metricSize, weight: 700 })}
  ${svgText(metricsX, metricsY + lineGap, high !== '-' && low !== '-' ? `${high}/${low} C` : '-', {
    fill: colors.ink,
    size: fonts.smallSize,
    weight: 700,
  })}
  ${
    gust !== '-'
      ? svgText(metricsX, metricsY + lineGap * 1.85, `Racha ${gust} km/h`, { fill: colors.muted, size: fonts.smallSize, weight: 700 })
      : ''
  }
  ${
    pop !== '-'
      ? svgText(metricsX, metricsY + lineGap * 2.7, `Prob. lluvia ${pop}%`, { fill: colors.muted, size: fonts.smallSize, weight: 700 })
      : ''
  }`;
  }

  private async forecastCharts(hourly: HourlyWeather[], box: Rect, fontSize: number, colors: Palette): Promise<string> {
    const samples = hourly.slice(0, 16);
    if (!samples.length) return '';

    const width = box.right - box.left;
    const height = box.bottom - box.top;
    const pad = Math.max(Math.floor(Math.min(width, height) * 0.025), 6);
    const labelWidth = Math.max(Math.floor(width * 0.075), 34);
    const rightAxisWidth = Math.max(Math.floor(width * 0.045), 20);
    const plotLeft = box.left + labelWidth;
    const plotRight = box.right - pad - rightAxisWidth;
    const plotWidth = Math.max(plotRight - plotLeft, 1);
    const cellWidth = plotWidth / samples.length;
    const iconRowHeight = Math.max(Math.floor(height * 0.14), fontSize * 2.8);
    const chartTop = box.top + pad + iconRowHeight + fontSize * 0.65;
    const plotBottom = box.bottom - pad;
    const bandHeight = Math.max(plotBottom - chartTop, 1) / 3;
    const precipTop = chartTop;
    const sunTop = precipTop + bandHeight;
    const windTop = sunTop + bandHeight;
    const iconSamples = samples.filter((_, index) => index % 2 === 0);
    const iconCellWidth = plotWidth / Math.max(iconSamples.length, 1);
    const iconSize = Math.floor(Math.min(iconRowHeight * 0.58, iconCellWidth * 0.48));

    const iconRows = await Promise.all(
      iconSamples.map(async (hour, index) => {
        const sampleIndex = index * 2;
        const cx = plotLeft + cellWidth * (sampleIndex + 0.5);
        const icon = await this.iconDataUrl(hour.icon);
        const pop = formatNumber(hour.pop);
        return `
  <image href="${icon}" x="${cx - iconSize / 2}" y="${box.top + pad}" width="${iconSize}" height="${iconSize}" preserveAspectRatio="xMidYMid meet"/>
  ${svgText(cx, box.top + pad + iconSize + fontSize * 0.65, pop !== '-' ? `${pop}%` : '-', {
    anchor: 'middle',
    fill: colors.rainBlue,
    size: fontSize,
    weight: 700,
  })}`;
      }),
    );

    const temps = samples.map((hour) => toFiniteNumber(hour.temperature)).filter((value) => value !== null) as number[];
    let minTemp = temps.length ? Math.floor(Math.min(...temps) - 1) : 0;
    let maxTemp = temps.length ? Math.ceil(Math.max(...temps) + 1) : 1;
    if (maxTemp <= minTemp) maxTemp = minTemp + 1;
    const maxRainAxis = Math.max(1, Math.ceil(Math.max(...samples.map((hour) => Number(hour.precip) || 0), 0.5)));
    const barWidth = Math.max(Math.floor(cellWidth * 0.58), 3);
    const tempTop = precipTop + bandHeight * 0.12;
    const tempBase = precipTop + bandHeight * 0.82;
    const rainBase = precipTop + bandHeight;
    const rainAxisTop = precipTop + fontSize * 0.35;
    const rainAxisBottom = rainBase - fontSize * 0.35;
    const tempPoints: string[] = [];
    const rainBars: string[] = [];

    samples.forEach((hour, index) => {
      const cx = plotLeft + cellWidth * (index + 0.5);
      const rain = Number(hour.precip) || 0;
      if (rain > 0) {
        const rainTop = rainBase - (bandHeight * 0.78 * rain) / maxRainAxis;
        rainBars.push(`<rect x="${cx - barWidth / 2}" y="${rainTop}" width="${barWidth}" height="${rainBase - rainTop}" fill="${colors.rainBlue}"/>`);
      } else {
        rainBars.push(`<line x1="${cx - barWidth / 2}" y1="${rainBase - 2}" x2="${cx + barWidth / 2}" y2="${rainBase - 2}" stroke="${colors.rainBlue}" stroke-width="1"/>`);
      }

      const temp = toFiniteNumber(hour.temperature);
      if (temp !== null) {
        const y = tempBase - ((temp - minTemp) / (maxTemp - minTemp)) * (tempBase - tempTop);
        tempPoints.push(`${cx},${y}`);
      }
    });

    const sunBase = sunTop + bandHeight;
    const sunBars = samples
      .map((hour, index) => {
        const cx = plotLeft + cellWidth * (index + 0.5);
        const sun = Math.min(Number(hour.sunshine) || 0, 60);
        const rawHeight = (bandHeight * 0.78 * sun) / 60;
        const height = Math.max(rawHeight, 1);
        const y = sunBase - height;
        return `<rect x="${cx - barWidth / 2}" y="${y}" width="${barWidth}" height="${height}" fill="#e8c62a"/>`;
      })
      .join('\n');

    const windTopPlot = windTop + bandHeight * 0.12;
    const windBase = windTop + bandHeight * 0.88;
    const windValues = samples.map((hour) => Number(hour.wind) || 0);
    const gustValues = samples.map((hour) => Number(hour.gust) || 0);
    const maxWindAxis = Math.max(10, Math.ceil(Math.max(...windValues, ...gustValues, 10) / 10) * 10);
    const windPoints: string[] = [];
    const gustPoints: string[] = [];
    samples.forEach((hour, index) => {
      const cx = plotLeft + cellWidth * (index + 0.5);
      windPoints.push(`${cx},${windBase - ((Number(hour.wind) || 0) / maxWindAxis) * (windBase - windTopPlot)}`);
      gustPoints.push(`${cx},${windBase - ((Number(hour.gust) || 0) / maxWindAxis) * (windBase - windTopPlot)}`);
    });
    const gustArea = `${plotLeft + cellWidth * 0.5},${windBase} ${gustPoints.join(' ')} ${plotLeft + cellWidth * (samples.length - 0.5)},${windBase}`;

    return `
  ${roundedRect(box, 8, '#192531', '#3b4d5e')}
  ${iconRows.join('\n')}
  ${this.bandLines(box.left + pad, box.right - pad, [precipTop, sunTop, windTop], colors.grid)}
  ${this.timeAxis(samples, plotLeft, plotRight, chartTop - fontSize * 0.6, fontSize, colors.muted)}
  ${this.timeGrid(samples, plotLeft, cellWidth, precipTop, precipTop + bandHeight)}
  ${this.timeGrid(samples, plotLeft, cellWidth, sunTop, sunTop + bandHeight)}
  ${this.timeGrid(samples, plotLeft, cellWidth, windTop, windTop + bandHeight)}
  ${this.horizontalGrid(plotLeft, plotRight, tempTop, tempBase, [minTemp, (minTemp + maxTemp) / 2, maxTemp])}
  ${this.yAxis(plotLeft, tempTop, tempBase, [minTemp, (minTemp + maxTemp) / 2, maxTemp], fontSize, colors.muted, 'left')}
  ${this.yAxis(plotRight, rainAxisTop, rainAxisBottom, [0, maxRainAxis / 2, maxRainAxis], fontSize, colors.rainBlue, 'right')}
  ${rainBars.join('\n')}
  <polyline points="${tempPoints.join(' ')}" fill="none" stroke="#ff565e" stroke-width="${Math.max(3, Math.floor(fontSize * 0.28))}" stroke-linecap="round" stroke-linejoin="round"/>
  ${svgText(plotRight, precipTop + bandHeight - fontSize * 0.25, 'mm/h', { anchor: 'end', fill: colors.rainBlue, size: fontSize, weight: 700 })}
  ${this.horizontalGrid(plotLeft, plotRight, sunTop, sunTop + bandHeight, [0, 30, 60])}
  ${sunBars}
  ${this.horizontalGrid(plotLeft, plotRight, windTopPlot, windBase, [0, maxWindAxis / 2, maxWindAxis])}
  ${this.yAxis(plotLeft, windTopPlot, windBase, [0, maxWindAxis / 2, maxWindAxis], fontSize, colors.muted, 'left')}
  <polygon points="${gustArea}" fill="#373a5c"/>
  <polyline points="${gustPoints.join(' ')}" fill="none" stroke="#968bff" stroke-width="${Math.max(2, Math.floor(fontSize * 0.16))}" stroke-linejoin="round"/>
  <polyline points="${windPoints.join(' ')}" fill="none" stroke="#d48bed" stroke-width="${Math.max(2, Math.floor(fontSize * 0.14))}" stroke-linejoin="round"/>`;
  }

  private async forecastCards(forecast: DailyWeather[], box: Rect, bodySize: number, smallSize: number, colors: Palette): Promise<string> {
    if (!forecast.length) return '';
    const gap = 6;
    let dayCount = Math.min(forecast.length, 7);
    while (dayCount > 3 && (box.right - box.left - gap * (dayCount - 1)) / dayCount < 64) {
      dayCount -= 1;
    }
    const days = forecast.slice(0, dayCount);
    const cardWidth = (box.right - box.left - gap * (days.length - 1)) / days.length;
    const cardHeight = box.bottom - box.top;
    const cards = await Promise.all(
      days.map(async (day, index) => {
        const x1 = box.left + index * (cardWidth + gap);
        const x2 = x1 + cardWidth;
        const daySize = Math.min(bodySize, Math.max(Math.floor(cardWidth * 0.18), 12));
        const valueSize = Math.min(smallSize, Math.max(Math.floor(cardWidth * 0.13), 10));
        const rainSize = Math.min(smallSize + 1, Math.max(Math.floor(cardWidth * 0.14), 11));
        const iconSize = Math.floor(cardHeight * 0.34);
        const icon = await this.iconDataUrl(day.icon);
        return `
  <g>
    <rect x="${x1}" y="${box.top}" width="${cardWidth}" height="${cardHeight}" rx="8" fill="${colors.panel}" stroke="#374959"/>
    ${svgText((x1 + x2) / 2, box.top + 8 + daySize * 0.82, day.day, { anchor: 'middle', fill: colors.ink, size: daySize })}
    <image href="${icon}" x="${(x1 + x2 - iconSize) / 2}" y="${box.top + cardHeight * 0.31}" width="${iconSize}" height="${iconSize}" preserveAspectRatio="xMidYMid meet"/>
    ${svgText((x1 + x2) / 2, box.bottom - valueSize * 2.0, `${formatNumber(day.high)}/${formatNumber(day.low)} C`, {
      anchor: 'middle',
      fill: colors.ink,
      size: valueSize,
      weight: 700,
    })}
    ${svgText((x1 + x2) / 2, box.bottom - rainSize * 0.62, `${formatNumber(day.precip, 1)} mm`, {
      anchor: 'middle',
      fill: colors.rainBlue,
      size: rainSize,
      weight: 700,
    })}
  </g>`;
      }),
    );
    return cards.join('\n');
  }

  private batteryIndicator(battery: BatteryStatus | null | undefined, right: number, top: number, fontSize: number, colors: Palette): string {
    if (!battery || battery.percent === undefined) return '';
    const color = batteryColor(battery.percent, colors.ink);
    const label = `${Math.round(battery.percent)}%`;
    const labelWidth = label.length * fontSize * 0.62;
    const bodyW = Math.max(Math.floor(fontSize * 1.8), 22);
    const bodyH = Math.max(Math.floor(fontSize * 0.95), 10);
    const nubW = Math.max(Math.floor(bodyW * 0.12), 3);
    const gap = Math.max(Math.floor(fontSize * 0.35), 4);
    const totalW = bodyW + nubW + gap + labelWidth;
    const left = right - totalW;
    const y = top + Math.max(Math.floor(fontSize * 0.12), 1);
    const fillPad = 3;
    const fillW = Math.max(Math.floor(((bodyW - fillPad * 2) * Math.max(0, Math.min(100, battery.percent))) / 100), 1);
    return `
  <rect x="${left}" y="${y}" width="${bodyW}" height="${bodyH}" rx="2" fill="none" stroke="${color}" stroke-width="2"/>
  <rect x="${left + bodyW}" y="${y + bodyH * 0.3}" width="${nubW}" height="${bodyH * 0.4}" fill="${color}"/>
  <rect x="${left + fillPad}" y="${y + fillPad}" width="${fillW}" height="${Math.max(bodyH - fillPad * 2, 1)}" fill="${color}"/>
  ${battery.charging ? svgText(left + bodyW / 2, y + bodyH * 0.72, '+', { anchor: 'middle', fill: colors.ink, size: fontSize, weight: 700 }) : ''}
  ${svgText(left + bodyW + nubW + gap, y + bodyH * 0.74, label, { fill: color, size: fontSize, weight: 700 })}`;
  }

  private bandLines(left: number, right: number, ys: number[], color: string): string {
    return ys.map((y) => `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="${color}" stroke-width="1"/>`).join('\n');
  }

  private timeAxis(samples: HourlyWeather[], plotLeft: number, plotRight: number, y: number, fontSize: number, color: string): string {
    const cellWidth = (plotRight - plotLeft) / samples.length;
    return samples
      .map((hour, index) => {
        if (index % 2 !== 0 || index >= samples.length - 1) return '';
        const cx = plotLeft + cellWidth * (index + 0.5);
        return svgText(cx, y, `${hour.label.slice(0, 2)}:00`, { anchor: 'middle', fill: color, size: fontSize });
      })
      .join('\n');
  }

  private timeGrid(samples: HourlyWeather[], plotLeft: number, cellWidth: number, top: number, bottom: number): string {
    return samples
      .map((_, index) => {
        if (index % 2 !== 0) return '';
        const x = plotLeft + cellWidth * (index + 0.5);
        return `<line x1="${x}" y1="${top + 2}" x2="${x}" y2="${bottom - 2}" stroke="#3a4b5b" stroke-width="1"/>`;
      })
      .join('\n');
  }

  private horizontalGrid(left: number, right: number, top: number, bottom: number, values: number[]): string {
    const min = Math.min(...values);
    let max = Math.max(...values);
    if (max <= min) max = min + 1;
    return values
      .map((value) => {
        const y = bottom - ((value - min) / (max - min)) * (bottom - top);
        return `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="#31404e" stroke-width="1"/>`;
      })
      .join('\n');
  }

  private yAxis(axisX: number, top: number, bottom: number, values: number[], fontSize: number, color: string, side: 'left' | 'right'): string {
    const min = Math.min(...values);
    let max = Math.max(...values);
    if (max <= min) max = min + 1;
    return values
      .map((value) => {
        const y = bottom - ((value - min) / (max - min)) * (bottom - top);
        const label = Number.isInteger(value) ? String(Math.round(value)) : value.toFixed(1);
        if (side === 'right') {
          return `<line x1="${axisX}" y1="${y}" x2="${axisX + 3}" y2="${y}" stroke="${color}" stroke-width="1"/>${svgText(axisX + 5, y + fontSize * 0.32, label, { fill: color, size: fontSize })}`;
        }
        return `<line x1="${axisX - 3}" y1="${y}" x2="${axisX}" y2="${y}" stroke="${color}" stroke-width="1"/>${svgText(axisX - 5, y + fontSize * 0.32, label, { anchor: 'end', fill: color, size: fontSize })}`;
      })
      .join('\n');
  }

  private async iconDataUrl(name: string): Promise<string> {
    const file = path.join(this.assetsDir(), ...this.assetParts('weather', 'icons', `${name}.png`));
    try {
      const buffer = await fs.readFile(file);
      return `data:image/png;base64,${buffer.toString('base64')}`;
    } catch {
      return '';
    }
  }

  private fontDataUrl(filename: string): string {
    try {
      const file = path.join(this.assetsDir(), ...this.assetParts('fonts', filename));
      return `data:font/ttf;base64,${readFileSync(file).toString('base64')}`;
    } catch {
      return '';
    }
  }

  private assetsDir(): string {
    if (process.env.INKYPI_ASSETS_DIR) return process.env.INKYPI_ASSETS_DIR;
    return path.resolve(process.cwd(), 'assets');
  }

  private assetParts(...parts: string[]): string[] {
    const base = this.assetsDir();
    if (base.endsWith(`${path.sep}src`) || base.endsWith('/src')) {
      if (parts[0] === 'weather') return ['plugins', ...parts];
      if (parts[0] === 'fonts') return ['static', ...parts];
    }
    return parts;
  }
}

function rect(left: number, top: number, right: number, bottom: number): Rect {
  return { left, top, right, bottom };
}

function roundedRect(box: Rect, radius: number, fill: string, stroke: string): string {
  return `<rect x="${box.left}" y="${box.top}" width="${box.right - box.left}" height="${box.bottom - box.top}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`;
}

function svgText(
  x: number,
  y: number,
  value: string,
  options: { anchor?: 'start' | 'middle' | 'end'; fill: string; size: number; weight?: number } = { fill: '#fff', size: 12 },
): string {
  return `<text x="${x}" y="${y}" fill="${options.fill}" font-size="${options.size}"${options.weight ? ` font-weight="${options.weight}"` : ''}${
    options.anchor ? ` text-anchor="${options.anchor}"` : ''
  }>${escapeXml(value)}</text>`;
}

function formatNumber(value: unknown, decimals = 0): string {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return decimals === 0 ? String(Math.round(number)) : number.toFixed(decimals);
}

function formatPrecipRange(low: unknown, high: unknown): string {
  if (low === null || low === undefined || high === null || high === undefined) return '';
  const lowValue = Number(low);
  const highValue = Number(high);
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue)) return '';
  return `${Math.round(lowValue)}-${Math.round(highValue)} mm`;
}

function toFiniteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function fitText(text: string, maxWidth: number, startSize: number): number {
  let size = startSize;
  while (size > 10 && text.length * size * 0.58 > maxWidth) {
    size -= 2;
  }
  return size;
}

function batteryColor(percent: number, defaultColor: string): string {
  if (percent <= 15) return '#ff7070';
  if (percent <= 30) return '#e8c62a';
  return defaultColor;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
