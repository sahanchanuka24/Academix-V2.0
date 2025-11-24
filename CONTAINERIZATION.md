# AcademiX Containerization

The project now ships with Dockerfiles for both the backend and frontend plus a single `docker-compose.yml` at the repository root. This document explains how to build and run everything.

## Prerequisites

- Docker Engine 24+ (or Docker Desktop on macOS/Windows)
- Docker Compose v2 (bundled with modern Docker Desktop installations)

## First-Time Setup

```bash
cd /Users/sahanchanuka/Desktop/AcademiX/Academix-V2.0
docker compose build
```

The build step runs `npm ci` inside each image, generates the React production build, and prepares the Express API.

## Running the Stack

```bash
docker compose up
```

- Frontend: http://localhost:3000 (served by Nginx using the CRA production build)
- Backend API: http://localhost:8080

Compose automatically recreates the containers if they stop (`restart: unless-stopped`). Use `docker compose down` to stop everything.

## Persisted Data

Two bind mounts keep user-generated content outside the container layers:

- `./backend/data ↔ /app/data` stores the LowDB JSON database.
- `./backend/src/uploads ↔ /app/src/uploads` keeps uploaded media.

As long as you run compose from the repo root, these directories retain their contents between container rebuilds.

## Environment Variables

The backend only needs `PORT` (defaults to 8080). Adjust it in `docker-compose.yml` if a different host port is required.

The frontend still contains hard-coded `http://localhost:8080` API URLs. If you plan to deploy to another hostname, refactor those references to use `REACT_APP_API_BASE_URL` (already provided in `docker-compose.yml`).

## Useful Commands

```bash
# Rebuild after dependency changes
docker compose build --no-cache

# View logs
docker compose logs -f backend
docker compose logs -f frontend
```

