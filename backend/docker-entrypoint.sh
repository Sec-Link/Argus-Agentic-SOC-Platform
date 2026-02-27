#!/bin/sh
set -e

echo "Starting docker-entrypoint..."

# Run database migrations
echo "Running migrations..."
python manage.py makemigrations --noinput
python manage.py migrate --noinput
python manage.py seed_tenants

# Collect static files unless explicitly disabled
if [ "${DJANGO_COLLECTSTATIC:-1}" != "0" ]; then
  echo "Collecting static files..."
  python manage.py collectstatic --noinput
fi


echo "Entrypoint finished — executing command: $@"
exec "$@"