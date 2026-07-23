#!/bin/bash
# 南孚 DSR 销售培训系统 - 一键启动脚本
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "============================================"
echo "  南孚 DSR 销售培训系统"
echo "============================================"

# 安装后端依赖
echo ""
echo "[1/4] 安装后端依赖..."
cd "$SCRIPT_DIR/server"
npm install --silent

# 初始化数据库
echo "[2/4] 初始化数据库..."
rm -f data/nanfu_dsr.db
node database.js --reset --seed

# 安装前端依赖
echo "[3/4] 安装前端依赖..."
cd "$SCRIPT_DIR/client"
npm install --silent

# 启动
echo "[4/4] 启动服务..."
echo ""
echo "============================================"
echo "  后端 API:  http://localhost:3030"
echo "  前端页面:  http://localhost:5252 (需另行启动)"
echo "  管理员:    admin / admin123"
echo "  业务员:    sales01 / sales123"
echo "============================================"
echo ""

cd "$SCRIPT_DIR/server"
node index.js
