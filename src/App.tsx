import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import type { Role } from '../shared/types.ts';
import { Shell } from './components/Shell.tsx';
import { Loading } from './components/ui.tsx';
import { homePath, useAuth } from './lib/auth.tsx';
import AccountPage from './pages/Account.tsx';
import ForgotPasswordPage from './pages/ForgotPassword.tsx';
import LoginPage from './pages/Login.tsx';
import ResetPasswordPage from './pages/ResetPassword.tsx';
import SignupPage from './pages/Signup.tsx';
import SignupMentorPage from './pages/SignupMentor.tsx';
import SignupParentPage from './pages/SignupParent.tsx';
import ParentHome from './pages/parent/Home.tsx';
import ParentStudent from './pages/parent/StudentPage.tsx';
import AdminApprovals from './pages/admin/Approvals.tsx';
import AdminMatch from './pages/admin/MatchDetail.tsx';
import AdminMatches from './pages/admin/Matches.tsx';
import AdminMentors from './pages/admin/Mentors.tsx';
import MentorProfilePage from './pages/mentor/Profile.tsx';
import StudentProfilePage from './pages/student/Profile.tsx';
import AdminClasses from './pages/admin/Classes.tsx';
import AdminCurricula from './pages/admin/Curricula.tsx';
import AdminEmails from './pages/admin/Emails.tsx';
import AdminHome from './pages/admin/Home.tsx';
import AdminReports from './pages/admin/Reports.tsx';
import AdminSettings from './pages/admin/Settings.tsx';
import AdminUsers from './pages/admin/Users.tsx';
import MentorClass from './pages/mentor/ClassPage.tsx';
import MentorHome from './pages/mentor/Home.tsx';
import MentorHomework from './pages/mentor/HomeworkReview.tsx';
import MentorQuiz from './pages/mentor/QuizReview.tsx';
import MentorSchedule from './pages/mentor/Schedule.tsx';
import MentorSession from './pages/mentor/SessionPage.tsx';
import MentorStudent from './pages/mentor/StudentProgress.tsx';
import StudentClass from './pages/student/ClassPage.tsx';
import StudentHome from './pages/student/Home.tsx';
import StudentHomework from './pages/student/Homework.tsx';
import StudentHomeworkDetail from './pages/student/HomeworkDetail.tsx';
import StudentProgress from './pages/student/Progress.tsx';
import StudentQuiz from './pages/student/QuizTake.tsx';
import StudentQuizzes from './pages/student/Quizzes.tsx';
import StudentRecordings from './pages/student/Recordings.tsx';
import StudentSchedule from './pages/student/Schedule.tsx';

function Protected({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homePath(user)} replace />;
  return <Shell>{children}</Shell>;
}

export default function App() {
  const { user, loading } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/signup/mentor" element={<SignupMentorPage />} />
      <Route path="/signup/parent" element={<SignupParentPage />} />
      <Route path="/" element={loading ? <Loading /> : <Navigate to={user ? homePath(user) : '/login'} replace />} />
      <Route path="/account" element={<Protected><AccountPage /></Protected>} />

      <Route path="/student" element={<Protected roles={['student']}><StudentHome /></Protected>} />
      <Route path="/student/schedule" element={<Protected roles={['student']}><StudentSchedule /></Protected>} />
      <Route path="/student/classes/:id" element={<Protected roles={['student']}><StudentClass /></Protected>} />
      <Route path="/student/homework" element={<Protected roles={['student']}><StudentHomework /></Protected>} />
      <Route path="/student/homework/:id" element={<Protected roles={['student']}><StudentHomeworkDetail /></Protected>} />
      <Route path="/student/recordings" element={<Protected roles={['student']}><StudentRecordings /></Protected>} />
      <Route path="/student/quizzes" element={<Protected roles={['student']}><StudentQuizzes /></Protected>} />
      <Route path="/student/quizzes/:id" element={<Protected roles={['student']}><StudentQuiz /></Protected>} />
      <Route path="/student/progress" element={<Protected roles={['student']}><StudentProgress /></Protected>} />
      <Route path="/student/profile" element={<Protected roles={['student']}><StudentProfilePage /></Protected>} />

      <Route path="/parent" element={<Protected roles={['parent']}><ParentHome /></Protected>} />
      <Route path="/parent/students/:id" element={<Protected roles={['parent']}><ParentStudent /></Protected>} />

      <Route path="/mentor" element={<Protected roles={['mentor', 'admin']}><MentorHome /></Protected>} />
      <Route path="/mentor/schedule" element={<Protected roles={['mentor', 'admin']}><MentorSchedule /></Protected>} />
      <Route path="/mentor/classes/:id" element={<Protected roles={['mentor', 'admin']}><MentorClass /></Protected>} />
      <Route path="/mentor/sessions/:id" element={<Protected roles={['mentor', 'admin']}><MentorSession /></Protected>} />
      <Route path="/mentor/homework/:id" element={<Protected roles={['mentor', 'admin']}><MentorHomework /></Protected>} />
      <Route path="/mentor/quizzes/:id" element={<Protected roles={['mentor', 'admin']}><MentorQuiz /></Protected>} />
      <Route path="/mentor/students/:id" element={<Protected roles={['mentor', 'admin']}><MentorStudent /></Protected>} />
      <Route path="/mentor/profile" element={<Protected roles={['mentor']}><MentorProfilePage /></Protected>} />

      <Route path="/admin" element={<Protected roles={['admin']}><AdminHome /></Protected>} />
      <Route path="/admin/approvals" element={<Protected roles={['admin']}><AdminApprovals /></Protected>} />
      <Route path="/admin/matches" element={<Protected roles={['admin']}><AdminMatches /></Protected>} />
      <Route path="/admin/matches/:id" element={<Protected roles={['admin']}><AdminMatch /></Protected>} />
      <Route path="/admin/mentors" element={<Protected roles={['admin']}><AdminMentors /></Protected>} />
      <Route path="/admin/users" element={<Protected roles={['admin']}><AdminUsers /></Protected>} />
      <Route path="/admin/classes" element={<Protected roles={['admin']}><AdminClasses /></Protected>} />
      <Route path="/admin/curricula" element={<Protected roles={['admin']}><AdminCurricula /></Protected>} />
      <Route path="/admin/reports" element={<Protected roles={['admin']}><AdminReports /></Protected>} />
      <Route path="/admin/emails" element={<Protected roles={['admin']}><AdminEmails /></Protected>} />
      <Route path="/admin/settings" element={<Protected roles={['admin']}><AdminSettings /></Protected>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
