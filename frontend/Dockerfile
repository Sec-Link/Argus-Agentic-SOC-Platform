# ---------- 1. 依赖安装阶段 ----------
ARG ALPINE_VERSION=3.24
FROM node:24-alpine${ALPINE_VERSION} AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- 2. 构建阶段 ----------
FROM node:24-alpine${ALPINE_VERSION} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 确保 next.config.js 中配置了 output: 'standalone'
RUN npm run build

# ---------- 3. 运行阶段 ----------
FROM alpine:${ALPINE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED 1
ENV NEXT_OUTPUT_MODE=standalone

# 运行镜像不包含 npm；只保留 Node.js 运行时与所需系统库。
RUN apk add --no-cache libstdc++ dumb-init \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs nextjs
COPY --from=builder /usr/local/bin/node /usr/local/bin/node
RUN node --version && test ! -e /usr/local/lib/node_modules/npm

# 仅拷贝 standalone 模式必需的文件
COPY --from=builder /app/public ./public
# 自动生成的 standalone 文件夹包含了 server.js 和 node_modules 最小集
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT 3000

CMD ["dumb-init", "node", "server.js"]
