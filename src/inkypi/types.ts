export type MeteoSwissPoint = {
  pointId: string;
  pointTypeId: string;
  pointName: string;
  postalCode?: string;
  lat?: number;
  lon?: number;
  distanceKm?: number | null;
};

export type TimedValue = {
  time: Date;
  value: string | number;
};

export type HourlyWeather = {
  time: Date;
  label: string;
  temperature?: number | string;
  icon: string;
  precip: number;
  precipLow?: number | string;
  precipHigh?: number | string;
  pop?: number | string | null;
  sunshine: number;
  wind?: number | string | null;
  gust?: number | string | null;
  windDir?: number | string | null;
};

export type DailyWeather = {
  date: string;
  day: string;
  high?: number | string;
  low?: number | string;
  precip: number;
  precipLow?: number | string;
  precipHigh?: number | string;
  icon: string;
};

export type BatteryStatus = {
  vin: number;
  percent: number;
  charging: boolean;
  ageMinutes?: number | null;
};

export type MeteoSwissWeather = {
  title: string;
  location: string;
  point: MeteoSwissPoint;
  updated: Date;
  currentDate: string;
  currentTemperature?: number | string | null;
  currentIcon: string;
  currentPrecip: number;
  currentPop?: number | string | null;
  currentWind?: number | string | null;
  currentGust?: number | string | null;
  currentWindDir?: number | string | null;
  currentHigh?: number | string;
  currentLow?: number | string;
  currentPrecipLow?: number | string;
  currentPrecipHigh?: number | string;
  hourly: HourlyWeather[];
  forecast: DailyWeather[];
  battery?: BatteryStatus | null;
};

export type MeteoSwissSettings = {
  title?: string;
  latitude?: string | number;
  longitude?: string | number;
  pointId?: string;
  pointTypeId?: string;
  forecastDays?: string | number;
  displayRefreshTime?: string | boolean;
  displayBattery?: string | boolean;
  batteryStatusPath?: string;
  backgroundColor?: string;
  textColor?: string;
  accentColor?: string;
};

export type RenderOptions = {
  width: number;
  height: number;
  timezone: string;
  settings: MeteoSwissSettings;
};
