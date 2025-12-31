-- Grant execute permission on the function to authenticated users and service_role
GRANT EXECUTE ON FUNCTION decrement_social_credit(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION decrement_social_credit(UUID) TO service_role;

-- Also verify/grant permissions on Organizations table update just in case (though Security Definer handles this mainly)
-- RLS policies might still apply if not carefully handled, but Security Definer usually bypasses RLS for the function owner (postgres).
-- However, explicitly ensuring usage is good practice.

-- Permissions granted successfully
