# 庆师易校圈后端 · 云托管镜像
# 说明：容器只负责 Express API（以及仓库内的静态前端文件）

FROM node:lts-slim

WORKDIR /app

ENV NODE_ENV=production

# 先装依赖，利用 Docker 层缓存
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts

# 再复制源码（前端也会一并复制，由 Express 静态托管）
COPY . .

# 云托管默认通过 PORT 注入端口；本地/未注入时回退 80
ENV PORT=80
EXPOSE 80

CMD ["node", "server/app.js"]
