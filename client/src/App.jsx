import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import AdminLayout from './layouts/AdminLayout';
import SalesLayout from './layouts/SalesLayout';
import Login from './pages/Login';

// 管理员页面
import AdminDashboard from './pages/admin/Dashboard';
import AdminKnowledge from './pages/admin/Knowledge';
import AdminQuestions from './pages/admin/Questions';
import AdminExams from './pages/admin/Exams';
import AdminCourses from './pages/admin/Courses';
import AdminAIConfig from './pages/admin/AIConfig';
import AdminTrainingScenarios from './pages/admin/TrainingScenarios';
import AdminTrainingRecords from './pages/admin/TrainingRecords';
import AdminUsers from './pages/admin/Users';
import AdminChatLogs from './pages/admin/ChatLogs';
import AdminLogs from './pages/admin/Logs';
import AdminPointRules from './pages/admin/PointRules';
import AdminRadarDimensions from './pages/admin/RadarDimensions';
import AdminShop from './pages/admin/Shop';
import AdminSubmissions from './pages/admin/Submissions';
import AdminShares from './pages/admin/Shares';
import AdminUserStatistics from './pages/admin/UserStatistics';
import AdminAnnouncements from './pages/admin/Announcements';

// 业务员页面
import SalesCheckIn from './pages/sales/CheckIn';
import SalesChat from './pages/sales/Chat';
import SalesLearning from './pages/sales/Learning';
import SalesExam from './pages/sales/Exam';
import SalesTraining from './pages/sales/Training';
import SalesStatistics from './pages/sales/Statistics';
import SalesProfile from './pages/sales/Profile';
import SalesShop from './pages/sales/Shop';
import SalesSubmission from './pages/sales/Submission';
import SalesShares from './pages/sales/Shares';
import SalesAnnouncements from './pages/sales/Announcements';

const MANAGER_ALLOWED_PATHS = ['', '/users', '/exams', '/training-records', '/submissions', '/shares', '/user-statistics', '/announcements'];

function canUseSalesExperience(user) {
  return user?.role === 'sales' || ['system_admin', 'region_manager', 'area_manager', 'city_manager'].includes(user?.manager_type);
}

function isCitySalesOnly(user) {
  return user?.manager_type === 'city_manager';
}

function ProtectedRoute({ children, role }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;
  if (!user) return <Navigate to="/login" />;
  if (role === 'admin' && isCitySalesOnly(user)) return <Navigate to="/sales/chat" replace />;
  if (role === 'sales' && !canUseSalesExperience(user)) return <Navigate to="/admin" replace />;
  if (role && user.role !== role && !(role === 'sales' && canUseSalesExperience(user))) return <Navigate to={canUseSalesExperience(user) ? '/sales' : '/admin'} />;
  if (role === 'admin' && user.manager_type && user.manager_type !== 'system_admin') {
    const adminPath = location.pathname.replace(/^\/admin/, '').replace(/\/$/, '');
    if (!MANAGER_ALLOWED_PATHS.includes(adminPath)) return <Navigate to="/admin" replace />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/admin/*" element={<ProtectedRoute role="admin"><AdminLayout /></ProtectedRoute>}>
        <Route index element={<AdminDashboard />} />
        <Route path="knowledge" element={<AdminKnowledge />} />
        <Route path="questions" element={<AdminQuestions />} />
        <Route path="exams" element={<AdminExams />} />
        <Route path="courses" element={<AdminCourses />} />
        <Route path="ai-config" element={<AdminAIConfig />} />
        <Route path="training-scenarios" element={<AdminTrainingScenarios />} />
        <Route path="training-records" element={<AdminTrainingRecords />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="point-rules" element={<AdminPointRules />} />
        <Route path="radar-dimensions" element={<AdminRadarDimensions />} />
        <Route path="shop" element={<AdminShop />} />
        <Route path="chat-logs" element={<AdminChatLogs />} />
        <Route path="logs" element={<AdminLogs />} />
        <Route path="submissions" element={<AdminSubmissions />} />
        <Route path="shares" element={<AdminShares />} />
        <Route path="user-statistics" element={<AdminUserStatistics />} />
        <Route path="announcements" element={<AdminAnnouncements />} />
      </Route>
      <Route path="/sales/*" element={<ProtectedRoute role="sales"><SalesLayout /></ProtectedRoute>}>
        <Route index element={<SalesChat />} />
        <Route path="chat" element={<SalesChat />} />
        <Route path="checkin" element={<SalesCheckIn />} />
        <Route path="learning" element={<SalesLearning />} />
        <Route path="exam" element={<SalesExam />} />
        <Route path="training" element={<SalesTraining />} />
        <Route path="statistics" element={<SalesStatistics />} />
        <Route path="profile" element={<SalesProfile />} />
        <Route path="shop" element={<SalesShop />} />
        <Route path="submission" element={<SalesSubmission />} />
        <Route path="shares" element={<SalesShares />} />
        <Route path="announcements" element={<SalesAnnouncements />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" />} />
    </Routes>
  );
}
