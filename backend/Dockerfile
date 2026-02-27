FROM python:3.12-slim

LABEL maintainer="seclink-team"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Install minimal system dependencies (curl used for HEALTHCHECK)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        build-essential \
        libpq-dev \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies first to leverage layer caching
COPY requirements.txt /app/
RUN python -m pip install --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Create a non-root user and set permissions
RUN groupadd -r app && useradd -r -g app -d /home/app -s /sbin/nologin app \
    && mkdir -p /home/app \
    && chown -R app:app /home/app /app

# Copy application code and set ownership in one step
COPY --chown=app:app . /app

# Add entrypoint script and make it executable
COPY --chown=app:app docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 8000

# Switch to non-root user for better security
USER app

# Entrypoint will run migrations and optional collectstatic, then exec the CMD
# Use shell to invoke the script to avoid exec permission errors on some hosts
ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]