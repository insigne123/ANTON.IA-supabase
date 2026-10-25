-- «Fijar» a Cowork conversation (COW-12): the recurring ones («Licitaciones del lunes») stay on top of the list, whatever their date.
-- One nullable column on the row each conversation already has (20261003120000): when its owner pinned it, or null. Same access as
-- the rest of the row: the owner reads it with their session, only the server writes it. Forward-only and inert on its own: the app
-- reads the row without this column until it exists.
alter table public.cowork_thread_settings add column pinned_at timestamptz;

notify pgrst, 'reload schema';
