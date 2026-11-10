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

# 云托管默认探测 3000 端口；不覆盖 PORT，交由平台注入或使用应用默认值
EXPOSE 3000

CMD ["node", "server/app.js"]
