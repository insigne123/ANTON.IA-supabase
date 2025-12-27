-- Check details of the reported tasks to understand timing and scheduling

SELECT id, type, status, error_message, created_at, scheduled_for, payload
FROM antonia_tasks
WHERE id IN (
    'cad67373-f0bd-4647-801d-2e0b7299e053', -- GEN CAMPAIGN (Completed)
    'df8c2763-5168-4986-8b1c-317e2c122fb4', -- SEARCH (Failed)
    '28fffabd-191b-41c6-9072-cf031921b6e0', -- SEARCH (Completed)
    '0d6423aa-a12a-4ac2-8fe5-48468c07dfe8'  -- CONTACT (Pending)
);
