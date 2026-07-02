import { notFound } from 'next/navigation';
import type { ComponentType } from 'react';
import { isViewKey, viewKeys } from '@/lib/designData';
import type { ViewKey } from '@/lib/designData';
import Overview from '@/components/views/Overview';
import Operating from '@/components/views/Operating';
import Departments from '@/components/views/Departments';
import Decisions from '@/components/views/Decisions';
import Staffing from '@/components/views/Staffing';
import Field from '@/components/views/Field';
import Entities from '@/components/views/Entities';
import Cash from '@/components/views/Cash';
import Sources from '@/components/views/Sources';
import Admin from '@/components/views/Admin';

const VIEWS: Record<ViewKey, ComponentType> = {
  overview: Overview,
  operating: Operating,
  departments: Departments,
  decisions: Decisions,
  staffing: Staffing,
  field: Field,
  entities: Entities,
  cash: Cash,
  sources: Sources,
  admin: Admin,
};

export function generateStaticParams() {
  return viewKeys.map((view) => ({ view }));
}

export default async function ViewPage({ params }: PageProps<'/[view]'>) {
  const { view } = await params;
  if (!isViewKey(view)) notFound();
  const ActiveView = VIEWS[view];
  return <ActiveView />;
}
