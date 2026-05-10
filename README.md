# InkyPi Backend

Backend NestJS para generar imagenes listas para pantallas InkyPi.

## Endpoints

- `GET /health` devuelve estado basico.
- `GET /inkypi/meteoswiss/weather` devuelve los datos MeteoSwiss agregados.
- `GET /inkypi/meteoswiss/image` devuelve `image/png` con el dashboard renderizado.

Ejemplo:

```bash
npm install
npm run start:dev
curl "http://localhost:8010/inkypi/meteoswiss/image?width=800&height=480" --output meteoswiss.png
```

## Docker

```bash
docker compose up -d --build
```

El proyecto incluye los iconos y fuentes necesarios en `assets/`.
