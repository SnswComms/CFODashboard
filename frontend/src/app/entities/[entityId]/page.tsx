import EntityDetail from '@/components/views/EntityDetail';

// Nested static segment: /entities itself keeps resolving through the
// app/[view] route (this folder has no page.tsx of its own), so the [view]
// registry and viewKeys are untouched — this route only claims /entities/<id>.
export default async function EntityDetailPage({ params }: PageProps<'/entities/[entityId]'>) {
  const { entityId } = await params;
  return <EntityDetail entityId={entityId} />;
}
