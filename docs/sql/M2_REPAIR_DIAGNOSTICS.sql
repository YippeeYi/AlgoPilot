-- 只读：不读取配置、签名、JWT、草稿、消息正文或 pg_stat_activity.query。
-- M1 原始函数体移除空白后的 MD5（不是数据库/认证密码哈希）。
select p.oid::regprocedure::text as function_name,
       md5(regexp_replace(p.prosrc, '\s', '', 'g')) as body_md5,
       md5(regexp_replace(p.prosrc, '\s', '', 'g')) = '919777c4cd97052e9286c049242c08e1' as matches_m1,
       p.prosecdef as security_definer, p.proconfig as function_settings
from pg_proc p
where p.oid = 'public.save_training_draft(uuid,text,text,integer)'::regprocedure;

-- 仅查看此前验收已成功请求的真实用量；不触发 Gemini，不输出请求 nonce/context。
select u.model, u.input_tokens, u.output_tokens, u.total_tokens,
       u.unclassified_tokens, u.duration_ms, u.status, u.cost_usd,
       count(m.id)::int as persisted_message_count
from public.llm_usage u
join public.tutor_requests r on r.id = u.request_id
left join public.tutor_messages m on m.request_id = r.id
where r.session_id = 'fa7d0dc7-a788-49b5-980b-78df93e9cae3'::uuid
and u.status = 'success'
group by u.id
order by u.created_at desc;

-- 不读取正在执行的 SQL 原文；仅观察 PostgREST 后端数量及持续时间。
select state, count(*)::int as connections,
       max(clock_timestamp() - query_start) as longest_query_age
from pg_stat_activity where usename = 'authenticator' group by state;
