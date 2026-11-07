#!/usr/bin/env bash
# =============================================================================
# build_exe.sh —— 调用 electron-builder 打包 Windows EXE
# -----------------------------------------------------------------------------
# 现状：Sprint 1 占位符。electron 主进程与 electron-builder 配置（electron-builder.yml）
#       尚未建立，因此不引入相关依赖，避免拖慢 CI。
# 前置：npm i -D electron electron-builder
# 用法：bash scripts/build_exe.sh
# =============================================================================
set -euo pipefail

echo "[build_exe] 调用 electron-builder 打包 Windows EXE"

# TODO(Sprint 3):
#   1. 校验 dist/h5 已就绪（先跑 build_h5.sh）
#   2. 生成 electron-builder 配置：nsis 目标、assisted 安装、图标与签名
#   3. 执行：npx electron-builder --win nsis --x64
#   4. 产物取回 dist/exe/，并校验签名与体积

echo "[build_exe] 占位脚本，electron-builder 调用待实现"
