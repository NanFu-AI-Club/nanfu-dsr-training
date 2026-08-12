import { Routes, Route, Navigate } from 'react-router-dom';
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

function ProtectedRoute({ children, role }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;
  if (!user) return <Navigate to="/login" />;
  if (role && user.role !== role) return <Navigate to={user.role === 'admin' ? '/admin' : '/sales'} />;
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
      </Route>
      <Route path="*" element={<Navigate to="/login" />} />
    </Routes>
  );
}
