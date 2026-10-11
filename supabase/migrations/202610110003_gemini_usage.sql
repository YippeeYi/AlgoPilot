-- Append-only compatibility repair. M1/M2 records and access boundaries are preserved.
begin;
-- Replace only M2's cross-column arithmetic constraint, leaving all other checks intact.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.llm_usage'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%total_tokens = (input_tokens + output_tokens)%'
  loop
    execute format('alter table public.llm_usage drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.llm_usage add constraint llm_usage_consistent_counts check (
  (input_tokens is null and output_tokens is null and total_tokens is null) or
  (input_tokens is not null and output_tokens is not null and total_tokens is not null
   and input_tokens between 0 and 100000000 and output_tokens between 0 and 100000000
   and total_tokens between 0 and 100000000
   and total_tokens::bigint >= input_tokens::bigint + output_tokens::bigint)
);
-- Unknown extra counts are NOT verified reasoning tokens. Original vendor total stays intact.
alter table public.llm_usage add column unclassified_tokens integer
  generated always as (total_tokens - input_tokens - output_tokens) stored;
comment on column public.llm_usage.unclassified_tokens is
  'Reported total minus reported input and visible output; unclassified, not verified reasoning or a billing category.';
-- SELECT remains session-owner RLS; no new DML grants or service-role writes.
commit;
