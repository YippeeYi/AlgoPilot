#!/usr/bin/env bash
set -euo pipefail
if [[ "${M1_ALLOW_DATABASE_TESTS:-}" != "isolated" || -z "${M1_TEST_DATABASE_URL:-}" ]]; then
  echo "拒绝运行：请仅为隔离测试数据库设置 M1_ALLOW_DATABASE_TESTS=isolated 和 M1_TEST_DATABASE_URL。" >&2
  exit 1
fi
command -v psql >/dev/null || { echo "需要安装 psql；未连接任何数据库。" >&2; exit 1; }
psql "$M1_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f supabase/tests/m1_rls.sql
