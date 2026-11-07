#!/usr/bin/env bash
# =============================================================================
# build_h5.sh —— 用于前端静态资源压缩打包
# -----------------------------------------------------------------------------
# 现状：Sprint 1 占位符，尚未接入压缩/打包工具链。
# 计划：Sprint 2 接入 esbuild（terser 压缩 JS + lightningcss 压缩 CSS），
#       产物输出到 dist/h5/，并生成带内容 Hash 的文件名以便 CDN 长缓存。
# 用法：bash scripts/build_h5.sh
# =============================================================================
set -euo pipefail

echo "[build_h5] 用于前端静态资源压缩打包"

# TODO(Sprint 2):
#   1. 压缩 frontend/css/*.css        → dist/h5/css/*.min.css
#   2. 压缩 frontend/js/**/*.js       → dist/h5/js/*.min.js
#   3. 内联关键 CSS、生成 manifest.json（内容寻址，见计划书 8.1 / 8.2）
#   4. 输出 gzip / brotli 预压缩文件

echo "[build_h5] 占位脚本，打包逻辑待实现"
