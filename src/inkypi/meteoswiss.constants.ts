export const COLLECTION_URL =
  'https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-local-forecasting';
export const ASSETS_URL = `${COLLECTION_URL}/assets`;
export const ITEM_URL = `${COLLECTION_URL}/items/{item_id}`;
export const META_POINT_ASSET = 'ogd-local-forecasting_meta_point.csv';

export const DEFAULT_LATITUDE = 47.384278;
export const DEFAULT_LONGITUDE = 8.120444;
export const DEFAULT_TIMEZONE = 'Europe/Zurich';
export const CACHE_TTL_SECONDS = 3 * 60 * 60;
export const METADATA_TTL_SECONDS = 7 * 24 * 60 * 60;
export const CACHE_RETENTION_SECONDS = 3 * 24 * 60 * 60;
export const DEFAULT_BATTERY_STATUS_PATH = 'battery.json';

export const FIXED_METEOSWISS_POINT = {
  pointId: '550200',
  pointTypeId: '2',
  pointName: 'Hunzenschwil',
  postalCode: '5502',
  lat: 47.385344,
  lon: 8.123061,
  distanceKm: 0.23,
};

export const PARAMETERS = {
  temperatureHourly: 'tre200h0',
  weatherHourly: 'jww003i0',
  precipHourly: 'rre150h0',
  precipHourlyLow: 'rreq10h0',
  precipHourlyHigh: 'rreq90h0',
  precipProbabilityHourly: 'rp0003i0',
  sunshineHourly: 'sre000h0',
  windSpeedHourly: 'fu3010h0',
  windGustHourly: 'fu3010h1',
  windDirectionHourly: 'dkl010h0',
  temperatureMaxDaily: 'tre200px',
  temperatureMinDaily: 'tre200pn',
  precipDaily: 'rka150p0',
  precipDailyLow: 'rreq10p0',
  precipDailyHigh: 'rreq90p0',
  weatherDaily: 'jp2000d0',
} as const;
