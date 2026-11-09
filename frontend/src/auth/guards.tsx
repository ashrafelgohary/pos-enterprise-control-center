import { Center, Loader } from '@mantine/core';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth, type Perm } from './AuthContext';
import { ErrorState } from '@/components/States';

export function RequireAuth() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Center h="100vh"><Loader /></Center>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <Outlet />;
}

export function RequirePerm({ perm, children }: { perm: Perm; children: JSX.Element }) {
  const { can } = useAuth();
  if (!can(perm)) {
    return <ErrorState title="Access denied" message="Your role does not have permission to view this page." />;
  }
  return children;
}
