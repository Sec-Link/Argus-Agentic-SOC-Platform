# ---------- build ----------
FROM node:20-alpine AS build

WORKDIR /app

# Copy dependency manifests only for better cache reuse
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Production build (webpack)
RUN npm run build


# ---------- runtime (nginx) ----------
FROM nginx:stable-alpine AS runtime

# Remove default nginx static content and copy build output
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/dist /usr/share/nginx/html

# Use our custom nginx config (will proxy /api, /platform, /admin, /static, /media to backend)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
