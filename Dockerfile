# ---- build the React frontend ----
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- Python API serving the API and the built frontend ----
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 STATIC_DIR=/app/static PORT=8000
WORKDIR /app
COPY requirements.txt ./
# Optional local cross-encoder reranker for container deployments (too large for serverless):
#   docker build --build-arg EXTRA="flashrank" .
ARG EXTRA=""
RUN pip install --no-cache-dir -r requirements.txt "uvicorn[standard]==0.54.0" $EXTRA
COPY server/ ./server/
COPY --from=web /web/dist ./static
RUN useradd --create-home app && chown -R app /app
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,os;urllib.request.urlopen(f'http://localhost:{os.environ[\"PORT\"]}/api/health')"
CMD ["sh", "-c", "cd server && uvicorn documind.main:app --host 0.0.0.0 --port ${PORT} --workers 2 --proxy-headers"]
