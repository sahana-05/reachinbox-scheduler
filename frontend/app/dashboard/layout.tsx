import { Suspense } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';

export default function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <Suspense fallback={<div className="min-h-screen bg-white" />}><DashboardShell>{children}</DashboardShell></Suspense>;
}
