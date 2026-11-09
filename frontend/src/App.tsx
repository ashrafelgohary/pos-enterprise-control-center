import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth, RequirePerm } from './auth/guards';
import { PERMS } from './auth/AuthContext';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import PosListPage from './pages/PosListPage';
import PosDetailPage from './pages/PosDetailPage';
import NewDeploymentPage from './pages/NewDeploymentPage';
import JobsPage from './pages/JobsPage';
import JobDetailPage from './pages/JobDetailPage';
import UsersPage from './pages/UsersPage';
import RolesPage from './pages/RolesPage';
import AuditLogsPage from './pages/AuditLogsPage';
import SettingsPage from './pages/SettingsPage';
import StoreManagementPage from './pages/StoreManagementPage';
import { ErrorState } from './components/States';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="pos" element={<PosListPage />} />
          <Route path="pos/online" element={<PosListPage fixedStatus="online" />} />
          <Route path="pos/offline" element={<PosListPage fixedStatus="offline" />} />
          <Route path="pos/:id" element={<PosDetailPage />} />
          <Route path="deployments" element={<Navigate to="/deployments/history" replace />} />
          <Route path="deployments/new" element={<RequirePerm perm={PERMS.XML_UPLOAD}><NewDeploymentPage /></RequirePerm>} />
          <Route path="deployments/running" element={<RequirePerm perm={PERMS.JOBS_READ}><JobsPage view="running" /></RequirePerm>} />
          <Route path="deployments/history" element={<RequirePerm perm={PERMS.JOBS_READ}><JobsPage view="all" /></RequirePerm>} />
          <Route path="deployments/failed" element={<RequirePerm perm={PERMS.JOBS_READ}><JobsPage view="failed" /></RequirePerm>} />
          <Route path="deployments/jobs/:id" element={<RequirePerm perm={PERMS.JOBS_READ}><JobDetailPage /></RequirePerm>} />
          <Route path="admin/users" element={<RequirePerm perm={PERMS.USERS_MANAGE}><UsersPage /></RequirePerm>} />
          <Route path="admin/stores" element={<RequirePerm perm={PERMS.USERS_MANAGE}><StoreManagementPage /></RequirePerm>} />
          <Route path="administration/stores" element={<RequirePerm perm={PERMS.USERS_MANAGE}><StoreManagementPage /></RequirePerm>} />
          <Route path="admin/roles" element={<RolesPage />} />
          <Route path="admin/audit" element={<RequirePerm perm={PERMS.AUDIT_READ}><AuditLogsPage /></RequirePerm>} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<ErrorState title="Page not found" message="The page you requested does not exist." />} />
        </Route>
      </Route>
    </Routes>
  );
}
