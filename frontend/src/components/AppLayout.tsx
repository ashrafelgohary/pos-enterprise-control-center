import {
  ActionIcon, AppShell, Avatar, Badge, Box, Burger, Group, Menu, NavLink, ScrollArea, Text, Tooltip, UnstyledButton,
  useComputedColorScheme, useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure, useLocalStorage, useMediaQuery } from '@mantine/hooks';
import {
  IconActivity, IconAlertTriangle, IconBuildingStore, IconChevronDown, IconCloudUpload, IconDeviceDesktop, IconHistory,
  IconLayoutDashboard, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconListDetails, IconLock, IconLogout,
  IconMoon, IconPlayerPlay, IconSettings, IconShieldCheck, IconSun, IconUsers, IconWifi, IconWifiOff,
} from '@tabler/icons-react';
import { Fragment, type ElementType } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { PERMS, useAuth, type Perm } from '@/auth/AuthContext';

interface Item { label: string; to: string; icon: ElementType; perm?: Perm; exact?: boolean }
interface NavGroup { label: string; icon: ElementType; perm?: Perm; children: Item[] }

const NAV: { section?: string; entries: (Item | NavGroup)[] }[] = [
  { entries: [{ label: 'Dashboard', to: '/', icon: IconLayoutDashboard, exact: true }] },
  {
    section: 'Operations',
    entries: [
      {
        label: 'POS Management', icon: IconDeviceDesktop, perm: PERMS.POS_READ, children: [
          { label: 'All POS', to: '/pos', icon: IconListDetails, exact: true },
          { label: 'Online', to: '/pos/online', icon: IconWifi },
          { label: 'Offline', to: '/pos/offline', icon: IconWifiOff },
        ],
      },
      {
        label: 'Deployments', icon: IconCloudUpload, perm: PERMS.JOBS_READ, children: [
          { label: 'New Deployment', to: '/deployments/new', icon: IconCloudUpload, perm: PERMS.XML_UPLOAD },
          { label: 'Running Jobs', to: '/deployments/running', icon: IconPlayerPlay },
          { label: 'History', to: '/deployments/history', icon: IconHistory },
          { label: 'Failed Jobs', to: '/deployments/failed', icon: IconAlertTriangle },
        ],
      },
    ],
  },
  {
    section: 'Administration',
    entries: [
      { label: 'Users', to: '/admin/users', icon: IconUsers, perm: PERMS.USERS_MANAGE },
      { label: 'Stores', to: '/admin/stores', icon: IconBuildingStore, perm: PERMS.USERS_MANAGE },
      { label: 'Roles', to: '/admin/roles', icon: IconShieldCheck },
      { label: 'Audit Logs', to: '/admin/audit', icon: IconActivity, perm: PERMS.AUDIT_READ },
      { label: 'Settings', to: '/settings', icon: IconSettings },
    ],
  },
];

const ROLE_COLOR: Record<string, string> = { admin: 'red', operator: 'blue', viewer: 'gray' };
const FOOTER = 'Ashraf Elgohary · Alshaya Group · Internal use only';

export default function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure();
  const [expanded, setExpanded] = useLocalStorage({ key: 'pcc-sidebar', defaultValue: true });
  const isMobile = useMediaQuery('(max-width: 48em)') ?? false;
  const rail = !expanded && !isMobile; // collapsed icon rail on desktop only
  const { user, can, logout } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('light');

  const visible = (i: { perm?: Perm }) => !i.perm || can(i.perm);
  const isActive = (i: Item) =>
    i.exact ? pathname === i.to : pathname === i.to || pathname.startsWith(i.to + '/');
  const sections = NAV.map((s) => ({ ...s, entries: s.entries.filter(visible) })).filter((s) => s.entries.length);

  const renderItem = (i: Item) => (
    <NavLink key={i.to} component={Link} to={i.to} label={i.label} active={isActive(i)} onClick={close}
      leftSection={<i.icon size={18} stroke={1.6} />} />
  );

  const renderRailItem = (i: Item) => (
    <Tooltip key={i.to} label={i.label} position="right" withArrow openDelay={120}>
      <UnstyledButton component={Link} to={i.to} onClick={close} aria-label={i.label}
        className="pcc-rail-item" data-active={isActive(i) || undefined}>
        <i.icon size={20} stroke={1.7} />
      </UnstyledButton>
    </Tooltip>
  );

  return (
    <AppShell header={{ height: 60 }} padding="lg"
      navbar={{ width: rail ? 76 : 264, breakpoint: 'sm', collapsed: { mobile: !opened } }}>
      <AppShell.Header px="md">
        <Group h="100%" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
            <Tooltip label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}>
              <ActionIcon variant="subtle" color="gray" size="lg" visibleFrom="sm" aria-label="Toggle sidebar"
                onClick={() => setExpanded((v) => !v)}>
                {expanded ? <IconLayoutSidebarLeftCollapse size={20} /> : <IconLayoutSidebarLeftExpand size={20} />}
              </ActionIcon>
            </Tooltip>
            <Group gap={10} wrap="nowrap">
              <img src="/alshaya-mark.png" alt="Alshaya Group" style={{ height: 34, width: 34, objectFit: 'contain' }} />
              <div>
                <Text fw={700} size="sm" lh={1.1}>POS Control Center</Text>
                <Text size="xs" c="dimmed" lh={1.1} visibleFrom="xs">Retail IT · Configuration Management</Text>
              </div>
            </Group>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Tooltip label={scheme === 'dark' ? 'Light mode' : 'Dark mode'}>
              <ActionIcon variant="default" size="lg" aria-label="Toggle color scheme"
                onClick={() => setColorScheme(scheme === 'dark' ? 'light' : 'dark')}>
                {scheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
              </ActionIcon>
            </Tooltip>
            <Menu width={220} position="bottom-end" shadow="md">
              <Menu.Target>
                <UnstyledButton px={6} py={4} style={{ borderRadius: 8 }}>
                  <Group gap={8} wrap="nowrap">
                    <Avatar color="brand" radius="xl" size={32}>{user?.username.slice(0, 2).toUpperCase()}</Avatar>
                    <Box visibleFrom="sm">
                      <Text size="sm" fw={600} lh={1.1}>{user?.full_name || user?.username}</Text>
                      <Text size="xs" c="dimmed" lh={1.1} tt="capitalize">{user?.role}</Text>
                    </Box>
                    <IconChevronDown size={14} />
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>
                  Signed in as <b>{user?.username}</b>{' '}
                  <Badge size="xs" color={ROLE_COLOR[user?.role ?? 'viewer']} variant="light">{user?.role}</Badge>
                </Menu.Label>
                <Menu.Item leftSection={<IconSettings size={16} />} onClick={() => navigate('/settings')}>Settings</Menu.Item>
                <Menu.Item leftSection={<IconLock size={16} />} onClick={() => navigate('/settings?tab=security')}>Change password</Menu.Item>
                <Menu.Divider />
                <Menu.Item color="red" leftSection={<IconLogout size={16} />}
                  onClick={async () => { await logout(); navigate('/login'); }}>Sign out</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar className="pcc-navbar" p="sm" data-rail={rail || undefined}>
        <AppShell.Section grow component={ScrollArea}>
          {sections.map((sec, idx) => (
            <Box key={idx}>
              {rail
                ? idx > 0 && <div className="pcc-rail-sep" />
                : sec.section && <div className="pcc-section-label">{sec.section}</div>}
              {sec.entries.map((e) => {
                if ('children' in e) {
                  const kids = e.children.filter(visible);
                  if (rail) return <Fragment key={e.label}>{kids.map(renderRailItem)}</Fragment>;
                  return (
                    <NavLink key={e.label} label={e.label} leftSection={<e.icon size={18} stroke={1.6} />}
                      defaultOpened childrenOffset={0} active={kids.some(isActive)} variant="subtle">
                      {kids.map(renderItem)}
                    </NavLink>
                  );
                }
                return rail ? renderRailItem(e) : renderItem(e);
              })}
            </Box>
          ))}
        </AppShell.Section>
        <AppShell.Section>
          {rail
            ? <Text size="xs" c="dimmed" ta="center" py="xs">v1.0</Text>
            : <Text size="xs" c="dimmed" px="sm" py="xs" lh={1.5}>v1.0.0<br />{FOOTER}</Text>}
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main className="pcc-main">
        <Box maw={1600} mx="auto"><Outlet /></Box>
      </AppShell.Main>
    </AppShell>
  );
}
