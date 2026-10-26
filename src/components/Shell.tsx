import clsx from 'clsx';
import {
  BadgeCheck,
  BarChart3,
  BookOpenCheck,
  CalendarDays,
  ClipboardList,
  FileStack,
  GraduationCap,
  Handshake,
  Home,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mail,
  PlayCircle,
  Settings,
  Sparkles,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import type { Role } from '../../shared/types.ts';
import { useAuth } from '../lib/auth.tsx';
import { FeedbackPrompt } from './FeedbackPrompt.tsx';
import { NotificationBell } from './Notifications.tsx';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const NAV: Record<Role, NavItem[]> = {
  student: [
    { to: '/student', label: 'Home', icon: Home, end: true },
    { to: '/student/schedule', label: 'Schedule', icon: CalendarDays },
    { to: '/student/homework', label: 'Homework', icon: ClipboardList },
    { to: '/student/recordings', label: 'Recordings', icon: PlayCircle },
    { to: '/student/quizzes', label: 'Quizzes', icon: Sparkles },
    { to: '/student/progress', label: 'My progress', icon: BarChart3 },
    { to: '/student/profile', label: 'My profile', icon: UserRound },
  ],
  parent: [{ to: '/parent', label: 'My children', icon: Home, end: true }],
  mentor: [
    { to: '/mentor', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/mentor/schedule', label: 'Schedule', icon: CalendarDays },
    { to: '/mentor/profile', label: 'Availability & subjects', icon: UserRound },
  ],
  admin: [
    { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/admin/matches', label: 'Match requests', icon: Handshake },
    { to: '/admin/approvals', label: 'Approvals', icon: BadgeCheck },
    { to: '/admin/mentors', label: 'Mentors', icon: GraduationCap },
    { to: '/admin/users', label: 'People', icon: Users },
    { to: '/admin/classes', label: 'Classes', icon: BookOpenCheck },
    { to: '/admin/curricula', label: 'Curricula', icon: FileStack },
    { to: '/admin/reports', label: 'Parent reports', icon: BarChart3 },
    { to: '/admin/emails', label: 'Emails', icon: Mail },
    { to: '/admin/settings', label: 'Settings', icon: Settings },
  ],
};

const ROLE_LABEL: Record<Role, string> = { student: 'Student', parent: 'Parent', mentor: 'Mentor', admin: 'Abugida team' };

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx('flex items-center gap-2.5', className)}>
      <span className="grid size-9 place-items-center rounded-xl bg-brand-700 text-lg font-bold text-sun" aria-hidden>
        አ
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-bold tracking-tight text-ink">Abugida</span>
        <span className="block text-xs font-medium text-ink-soft">Education</span>
      </span>
    </span>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const items = NAV[user.role];

  const signOut = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-dvh lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-sand-200 bg-white px-4 py-5 lg:flex">
        <div className="mb-8 flex shrink-0 items-center justify-between gap-2 pl-2">
          <Link to="/">
            <Logo />
          </Link>
          <NotificationBell align="left" />
        </div>
        {/* The menu scrolls on short windows so the account footer (Sign out) always stays on screen. */}
        <nav className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1" aria-label="Main">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition', isActive ? 'bg-brand-50 text-brand-800' : 'text-ink-soft hover:bg-sand-100 hover:text-ink')
              }
            >
              <item.icon className="size-[18px]" aria-hidden />
              {item.label}
            </NavLink>
          ))}
          {user.role === 'admin' && (
            <>
              <p className="mt-6 px-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">Teaching</p>
              <NavLink to="/mentor" end className={({ isActive }) => clsx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold', isActive ? 'bg-brand-50 text-brand-800' : 'text-ink-soft hover:bg-sand-100')}>
                <LayoutDashboard className="size-[18px]" aria-hidden /> All classes
              </NavLink>
              <NavLink to="/mentor/schedule" className={({ isActive }) => clsx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold', isActive ? 'bg-brand-50 text-brand-800' : 'text-ink-soft hover:bg-sand-100')}>
                <CalendarDays className="size-[18px]" aria-hidden /> All schedules
              </NavLink>
            </>
          )}
        </nav>
        <div className="mt-4 shrink-0 border-t border-sand-200 pt-4">
          <p className="truncate px-2 text-sm font-semibold text-ink">{user.displayName}</p>
          <p className="px-2 text-xs text-ink-muted">
            {ROLE_LABEL[user.role]} · @{user.username}
          </p>
          <div className="mt-3 flex gap-1">
            <Link to="/account" className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold text-ink-soft hover:bg-sand-100">
              <KeyRound className="size-3.5" /> Password
            </Link>
            <button onClick={signOut} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold text-ink-soft hover:bg-sand-100">
              <LogOut className="size-3.5" /> Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile header + tab bar */}
      <header className="sticky top-0 z-30 border-b border-sand-200 bg-white/95 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Link to="/">
            <Logo />
          </Link>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <Link to="/account" className="rounded-lg p-2 text-ink-soft hover:bg-sand-100" aria-label="Change password">
              <KeyRound className="size-5" />
            </Link>
            <button onClick={signOut} className="rounded-lg p-2 text-ink-soft hover:bg-sand-100" aria-label="Sign out">
              <LogOut className="size-5" />
            </button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2" aria-label="Main">
          {[...items, ...(user.role === 'admin' ? [{ to: '/mentor', label: 'All classes', icon: LayoutDashboard, end: true }] : [])].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => clsx('flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold', isActive ? 'bg-brand-700 text-white' : 'bg-sand-100 text-ink-soft')}
            >
              <item.icon className="size-4" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</main>
      {user.role === 'student' && <FeedbackPrompt />}
    </div>
  );
}
