-- Supabase default privileges grant EXECUTE on new functions in the public
-- schema to anon. Revoking from PUBLIC alone does not remove those grants, so
-- revoke anon explicitly and keep trigger functions unavailable to clients.

revoke all on function public.set_updated_at() from anon, authenticated;
revoke all on function public.handle_new_user() from anon, authenticated;

revoke all on function public.is_business_member(uuid) from anon;
revoke all on function public.has_business_role(uuid, text[]) from anon;
revoke all on function public.shares_business_with(uuid) from anon;
revoke all on function public.create_business(text, text, text, text, text, text) from anon;
