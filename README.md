# InkyPi Backend

NestJS backend for generating images ready for InkyPi displays.

## Endpoints

- `GET /health` returns the basic service status.
- `GET /inkypi/meteoswiss/weather` returns aggregated MeteoSwiss data.
- `GET /inkypi/meteoswiss/image` returns `image/png` with the rendered dashboard.
- `POST /inkypi/meteoswiss/battery` stores the latest battery status sent by the Raspberry Pi.

Example:

```bash
npm install
npm run start:dev
curl "http://localhost:8010/inkypi/meteoswiss/image?width=800&height=480" --output meteoswiss.png
```

Update battery status from the Raspberry Pi:

```bash
curl -X POST "http://localhost:8010/inkypi/meteoswiss/battery" \
  -H "Content-Type: application/json" \
  -d '{"vin":3.91,"charging":false}'
```

It also accepts `percent` if the Raspberry Pi already calculates it:

```bash
curl -X POST "http://localhost:8010/inkypi/meteoswiss/battery" \
  -H "Content-Type: application/json" \
  -d '{"vin":3.91,"percent":58,"charging":false}'
```

## Docker

```bash
docker compose up -d --build
```

The project includes the required icons and fonts in `assets/`.
