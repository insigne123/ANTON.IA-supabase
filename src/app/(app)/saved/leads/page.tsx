import { redirect } from 'next/navigation';

// «Por completar» is gone: saved contacts without email wait in «Por escribir», at a click from their lookup, and the step
// right after saving a search already offers it. Old links land there.
export default function SavedLeadsPage() {
  redirect('/saved/leads/enriched');
}
