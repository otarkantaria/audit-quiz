FROM python:3.11-slim AS backend

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ backend/

RUN mkdir -p /app/data /app/chroma_db

# Build frontend
FROM node:20-alpine AS frontend

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Final image
FROM python:3.11-slim

WORKDIR /app

COPY --from=backend /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=backend /usr/local/bin/uvicorn /usr/local/bin/uvicorn
COPY backend/ backend/
COPY --from=frontend /app/frontend/dist backend/static

RUN mkdir -p /app/chroma_db /app/data

EXPOSE 8000

WORKDIR /app/backend

ENV DATA_DIR=/app/data

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
