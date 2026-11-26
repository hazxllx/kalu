-- supabase/migrations/20261126153000_reconcile_stale_personnel_notification_processing.sql
-- KALUSAGAP: do not leave an invitation permanently stuck in PROCESSING.
--
-- Once link generation has started, a worker crash can leave the row in
-- `processing` indefinitely.  At that point we cannot prove whether SMTP was
-- reached, so this is deliberately reconciled as delivery_unknown rather than
-- failed.  The existing resend guard continues to block duplicate mail until
-- an administrator reviews the provider outcome.
create or replace function public.claim_personnel_notifications(
  p_limit integer default 10,
  p_target_id uuid default null
)
returns setof public.personnel_notification_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.personnel_notification_outbox
  set
    status = 'delivery_unknown',
    next_attempt_at = null,
    claim_token = null,
    claimed_at = null,
    last_error_code = 'PROCESSING_LEASE_EXPIRED'
  where status = 'processing'
    and claimed_at < now() - interval '5 minutes'
    and link_generation_started_at is not null;

  update public.personnel_notification_outbox
  set
    status = 'delivery_unknown',
    next_attempt_at = null,
    last_error_code = 'SMTP_ACCEPTANCE_UNKNOWN'
  where status = 'sending'
    and claimed_at < now() - interval '5 minutes';

  update public.personnel_notification_outbox
  set
    status = 'failed',
    claim_token = null,
    claimed_at = null,
    next_attempt_at = case
      when attempts < 8 then now()
      else null
    end,
    last_error_code = 'PROCESSING_LEASE_EXPIRED'
  where status = 'processing'
    and claimed_at < now() - interval '5 minutes'
    and link_generation_started_at is null;

  return query
    with due as (
      select j.id
      from public.personnel_notification_outbox j
      where j.status in ('pending', 'failed')
        and j.next_attempt_at <= now()
        and j.attempts < 8
        and (p_target_id is null or j.account_id = p_target_id)
      order by j.next_attempt_at, j.created_at, j.id
      limit greatest(1, least(coalesce(p_limit, 10), 100))
      for update skip locked
    )
    update public.personnel_notification_outbox j
    set
      status = 'processing',
      claim_token = gen_random_uuid(),
      claimed_at = now(),
      attempts = j.attempts + 1,
      next_attempt_at = null
    from due
    where j.id = due.id
    returning j.*;
end;
$$;

revoke all on function public.claim_personnel_notifications(integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_personnel_notifications(integer, uuid) to service_role;
