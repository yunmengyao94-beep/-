#!/usr/bin/env bash
# =============================================================================
# build_apk.sh —— 调用 HBuilderX CLI 执行云打包生成 APK
# -----------------------------------------------------------------------------
# 现状：Sprint 1 占位符。云打包需要 HBuilderX 账号、AppID 与证书，无法在本地
#       离线完成，故先固化调用形态与参数位。
# 前置：安装 HBuilderX 并将其 cli 目录加入 PATH（Windows: HBuilderX/cli.exe）。
# 用法：bash scripts/build_apk.sh
# =============================================================================
set -euo pipefail

echo "[build_apk] 调用 HBuilderX CLI 执行云打包生成 APK"

# TODO(Sprint 3):
#   1. 校验 HBuilderX CLI 是否存在：command -v cli
#   2. 执行云打包（示例参数，按实际 AppID/证书调整）：
#      cli pack --config ./manifest.json --project yxx --platform android --type app
#   3. 轮询打包状态，成功后把 APK 取回 dist/apk/
#   4. 输出产物 SHA-256 摘要写入构建元数据

echo "[build_apk] 占位脚本，CLI 调用待实现"
