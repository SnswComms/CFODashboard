'use client';

import Shell from '@/components/Shell';

// Same chrome as the [view] pages: the shell stays mounted with Entities
// highlighted in the sidebar while the [entityId] param changes underneath.
export default function EntityDetailLayout({ children }: { children: React.ReactNode }) {
  return <Shell view="entities">{children}</Shell>;
}
