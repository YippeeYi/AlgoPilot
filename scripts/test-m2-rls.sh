#!/usr/bin/env bash
set -euo pipefail
if [[ "${M2_ALLOW_DATABASE_TESTS:-}" != "isolated" || -z "${M2_TEST_DATABASE_URL:-}" ]]; then
  echo "拒绝运行：仅为隔离且已应用 M1/M2 迁移的测试库设置 M2_ALLOW_DATABASE_TESTS=isolated 与 M2_TEST_DATABASE_URL。" >&2
  exit 1
fi
command -v psql >/dev/null || { echo "需要 psql；未连接任何数据库。" >&2; exit 1; }
psql "$M2_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f supabase/tests/m2_rls.sql
