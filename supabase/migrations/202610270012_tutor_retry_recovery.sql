-- Gate integration needs an existing, expired Tutor receipt to terminate safely.
-- Ordinary JWTs cannot inspect private lease/status columns; keep that decision in the narrow RPC.
-- Only a function body is patched. No tables, history, quotas, signatures or user rows are rewritten.
begin;
do $$
declare
  definition text := pg_get_functiondef('public.tutor_reserve(text,text)'::regprocedure);
  old_clause text := 'if r.status = ''failed'' then raise exception ''request failed; use new request id'' using errcode=''AP006''; end if;';
  new_clause text := 'if r.status = ''failed'' or (r.status = ''pending'' and r.lease_until <= clock_timestamp()) then raise exception ''request failed; use new request id'' using errcode=''AP006''; end if;';
begin
  if position(new_clause in definition) > 0 then return; end if;
  if (length(definition) - length(replace(definition,old_clause,''))) / length(old_clause) <> 1 then
    raise exception 'unexpected tutor reserve definition' using errcode='23514';
  end if;
  execute replace(definition,old_clause,new_clause);
end $$;
revoke all on function public.tutor_reserve(text,text) from public,anon,authenticated;
grant execute on function public.tutor_reserve(text,text) to authenticated;
commit;
