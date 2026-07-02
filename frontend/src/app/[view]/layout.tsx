'use client';

import { useParams } from 'next/navigation';
import Shell from '@/components/Shell';
import { isViewKey } from '@/lib/designData';
import type { ViewKey } from '@/lib/designData';

// Client layout so the shell (sidebar, header, range picker, session) stays
// mounted while the [view] param changes underneath it.
export default function ViewLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ view: string }>();
  const view: ViewKey = isViewKey(params.view) ? params.view : 'overview';
  return <Shell view={view}>{children}</Shell>;
}
