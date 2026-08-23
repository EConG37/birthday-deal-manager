# 微信云托管镜像：轻量 Node 20，仅装生产依赖
FROM node:20-alpine

WORKDIR /app

# 先装依赖，利用 Docker 层缓存（package-lock 保证版本一致）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 业务代码 + 种子数据（server/data/ 的 deals.jsonl 与 stores.json 随镜像分发）
COPY server ./server
COPY scripts ./scripts
COPY public ./public

# 云托管将流量转发到服务端口（默认 80）；平台部署时会注入 PORT，此处兜底
ENV PORT=80
EXPOSE 80

CMD ["node", "server/index.js"]
