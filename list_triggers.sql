SELECT event_object_table, trigger_name, action_statement, action_orientation, action_timing
FROM information_schema.triggers
WHERE event_object_table = 'antonia_missions';
