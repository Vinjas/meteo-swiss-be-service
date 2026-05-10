# InkyPi Backend

Backend NestJS para generar imagenes listas para pantallas InkyPi.

## Endpoints

- `GET /health` devuelve estado basico.
- `GET /inkypi/meteoswiss/weather` devuelve los datos MeteoSwiss agregados.
- `GET /inkypi/meteoswiss/image` devuelve `image/png` con el dashboard renderizado.
- `POST /inkypi/meteoswiss/battery` guarda el ultimo estado de bateria enviado por la Raspberry.

Ejemplo:

```bash
npm install
npm run start:dev
curl "http://localhost:8010/inkypi/meteoswiss/image?width=800&height=480" --output meteoswiss.png
```

Actualizar bateria desde la Raspberry:

```bash
curl -X POST "http://localhost:8010/inkypi/meteoswiss/battery" \
  -H "Content-Type: application/json" \
  -d '{"vin":3.91,"charging":false}'
```

Tambien acepta `percent` si la Raspberry ya lo calcula:

```bash
curl -X POST "http://localhost:8010/inkypi/meteoswiss/battery" \
  -H "Content-Type: application/json" \
  -d '{"vin":3.91,"percent":58,"charging":false}'
```

## Docker

```bash
docker compose up -d --build
```

El proyecto incluye los iconos y fuentes necesarios en `assets/`.
