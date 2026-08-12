import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Play, FileText, File, Clock, BookOpen, ChevronRight,
  X, CheckCircle, Circle, BarChart3, Loader2, AlertCircle,
  ExternalLink, RefreshCw, Flag, Download,
} from 'lucide-react';
import api from '../../api';
import PDFViewer from '../../components/PDFViewer';

// 课程类型图标与颜色
const TYPE_CONFIG = {
  video: {
    icon: Play,
    bg: 'bg-sky-400',
    gradient: 'from-sky-300 via-primary-400 to-sky-500',
    label: '视频',
    color: 'text-sky-600',
    iconBg: 'bg-white/90 text-sky-600',
  },
  ppt: {
    icon: FileText,
    bg: 'bg-accent-400',
    gradient: 'from-amber-300 via-accent-400 to-orange-300',
    label: 'PPT',
    color: 'text-accent-600',
    iconBg: 'bg-white/90 text-accent-600',
  },
  pdf: {
    icon: File,
    bg: 'bg-emerald-400',
    gradient: 'from-emerald-300 via-teal-400 to-green-300',
    label: 'PDF',
    color: 'text-emerald-600',
    iconBg: 'bg-white/90 text-emerald-600',
  },
};

export default function Learning() {
  const [courses, setCourses] = useState([]);
  const [categories, setCategories] = useState([]); // 动态分类列表
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [roadmap, setRoadmap] = useState([]);
  const [courseProgress, setCourseProgress] = useState({});
  const [loading, setLoading] = useState(false);
  const [roadmapLoading, setRoadmapLoading] = useState(false);
  const [progressLoading, setProgressLoading] = useState({});
  const [error, setError] = useState('');
  const videoRef = useRef(null);
  const lastProgressRef = useRef(0);

  // 加载课程列表 + 批量加载进度
  const loadCourses = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get('/courses');
      const list = res.data?.list || res.data || res || [];
      setCourses(list);

      // 从课程数据中提取分类
      const cats = [...new Set(list.map(c => c.category).filter(Boolean))];
      setCategories(cats);

      // 批量加载所有课程进度
      try {
        const progRes = await api.get('/courses/my-progress');
        const progList = progRes.data?.list || progRes.data || [];
        const progMap = {};
        progList.forEach(p => {
          progMap[p.course_id] = { progress: p.progress, completed: p.completed === 1 || p.completed === true, watch_time: p.watch_time };
        });
        setCourseProgress(progMap);
      } catch (e) {
        console.error('批量加载进度失败:', e);
      }
    } catch (err) {
      console.error('加载课程失败:', err);
      setError(err?.message || '加载课程失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载通关路线图
  const loadRoadmap = useCallback(async () => {
    try {
      setRoadmapLoading(true);
      const res = await api.get('/courses/roadmap');
      setRoadmap(res.data?.stages || res.data || res || []);
    } catch (err) {
      console.error('加载路线图失败:', err);
    } finally {
      setRoadmapLoading(false);
    }
  }, []);

  // 加载课程进度
  const loadCourseProgress = useCallback(async (courseId) => {
    try {
      setProgressLoading((prev) => ({ ...prev, [courseId]: true }));
      const res = await api.get(`/courses/${courseId}/progress`);
      const data = res.data?.data || res.data || res || {};
      // 后端返回 data.progress = { progress, completed, watch_time, ... }
      const progressInfo = data.progress || {};
      setCourseProgress((prev) => ({ ...prev, [courseId]: progressInfo }));
    } catch (err) {
      console.error('加载课程进度失败:', err);
    } finally {
      setProgressLoading((prev) => ({ ...prev, [courseId]: false }));
    }
  }, []);

  // 更新进度到后端
  const updateProgress = useCallback(async (courseId, percent) => {
    try {
      await api.post(`/courses/${courseId}/progress`, { progress: percent });
      setCourseProgress((prev) => ({ ...prev, [courseId]: { ...prev[courseId], progress: percent, completed: percent >= 100 } }));
    } catch (err) {
      console.error('更新进度失败:', err);
    }
  }, []);

  // 视频播放进度跟踪
  const handleVideoTimeUpdate = (courseId) => {
    const video = videoRef.current;
    if (!video || !video.duration) return;
    const percent = Math.min(100, Math.round((video.currentTime / video.duration) * 100));
    // 每进度变化 5% 以上才更新，避免频繁请求
    if (percent - lastProgressRef.current >= 5) {
      lastProgressRef.current = percent;
      updateProgress(courseId, percent);
    }
  };

  const handleVideoEnded = (courseId) => {
    lastProgressRef.current = 100;
    updateProgress(courseId, 100);
    loadRoadmap();
  };

  // 标记课程完成
  const handleMarkComplete = async (courseId) => {
    try {
      setProgressLoading((prev) => ({ ...prev, [courseId]: true }));
      await api.post(`/courses/${courseId}/progress`, { progress: 100 });
      setCourseProgress((prev) => ({ ...prev, [courseId]: { progress: 100, completed: true } }));
      loadRoadmap();
    } catch (err) {
      console.error('标记完成失败:', err);
    } finally {
      setProgressLoading((prev) => ({ ...prev, [courseId]: false }));
    }
  };

  useEffect(() => {
    loadCourses();
    loadRoadmap();
  }, [loadCourses, loadRoadmap]);

  // 打开课程详情时加载进度
  useEffect(() => {
    if (selectedCourse && showDetail) {
      lastProgressRef.current = 0;
      loadCourseProgress(selectedCourse.id);
    }
  }, [selectedCourse, showDetail, loadCourseProgress]);

  // 筛选课程（按分类）
  const filteredCourses =
    activeCategory === 'all'
      ? courses
      : courses.filter((c) => c.category === activeCategory);

  // 格式化时长（分钟 -> "XX 分钟"）
  const formatDuration = (minutes) => {
    if (!minutes) return '';
    if (minutes < 60) return `${minutes} 分钟`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
  };

  // 获取进度百分比
  const getProgressPercent = (courseId) => {
    const p = courseProgress[courseId];
    if (!p) return 0;
    if (p.completed) return 100;
    return p.progress || 0;
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4 md:gap-6 md:flex-row">
      {/* ===== 左侧：课程主区域 ===== */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <h2 className="page-title mb-6 shrink-0">销冠闯关秘籍</h2>

        {/* 滚动容器 */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Tab 切换 - 按课程分类 */}
          <div className="flex gap-2 mb-6 border-b pb-2 overflow-x-auto">
            <button
              onClick={() => setActiveCategory('all')}
              className={`px-4 py-2 rounded-t-xl text-sm font-medium transition border-b-2 -mb-[2px] whitespace-nowrap ${
                activeCategory === 'all'
                  ? 'text-primary-600 border-primary-600 bg-primary-50/50'
                  : 'text-warm-500 border-transparent hover:text-warm-700'
              }`}
            >
              全部课程
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-2 rounded-t-xl text-sm font-medium transition border-b-2 -mb-[2px] whitespace-nowrap ${
                  activeCategory === cat
                    ? 'text-primary-600 border-primary-600 bg-primary-50/50'
                    : 'text-warm-500 border-transparent hover:text-warm-700'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

        {/* 错误提示 */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-2 bg-rose-50 text-rose-600 rounded-xl mb-4">
            <AlertCircle size={16} />
            <span className="text-sm">{error}</span>
            <button onClick={loadCourses} className="ml-auto underline text-sm">
              重试
            </button>
          </div>
        )}

        {/* 课程卡片网格 */}
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 size={32} className="animate-spin text-primary-600" />
          </div>
        ) : filteredCourses.length === 0 ? (
          <div className="text-center py-16">
            <BookOpen size={48} className="mx-auto mb-3 text-warm-300" />
            <p className="text-warm-400">
              {activeCategory === 'all' ? '暂无课程' : `${activeCategory} 分类暂无课程`}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-5">
            {filteredCourses.map((course) => {
              const TypeIcon = TYPE_CONFIG[course.type]?.icon || BookOpen;
              const typeBg = TYPE_CONFIG[course.type]?.bg || 'bg-gray-500';
              const typeGradient = TYPE_CONFIG[course.type]?.gradient || 'from-gray-500 to-gray-700';
              const progress = getProgressPercent(course.id);
              const isCompleted = progress >= 100;

              return (
                <div
                  key={course.id}
                  onClick={() => {
                    setSelectedCourse(course);
                    setShowDetail(true);
                  }}
                  className="card cursor-pointer hover:shadow-soft-lg transition group"
                >
                  {/* 封面区 */}
                  <div className="relative aspect-video rounded-xl mb-4 overflow-hidden group/cover">
                    {/* 封面图片（有 cover_url 时） */}
                    {course.cover_url ? (
                      <img
                        src={`/api/course-media/${course.id}?type=cover&token=${encodeURIComponent(localStorage.getItem('token') || '')}`}
                        alt={course.title}
                        className="absolute inset-0 w-full h-full object-cover group-hover/cover:scale-105 transition-transform duration-500"
                        loading="lazy"
                      />
                    ) : (
                      <>
                        {/* 吉卜力风格装饰背景 */}
                        <div className={`absolute inset-0 bg-gradient-to-br ${typeGradient}`} />
                        {/* 白云装饰 */}
                        <div className="absolute top-2 left-4 w-20 h-8 bg-white/30 rounded-full blur-md" />
                        <div className="absolute top-6 right-8 w-16 h-6 bg-white/25 rounded-full blur-sm" />
                        <div className="absolute bottom-12 left-1/2 w-24 h-10 bg-white/20 rounded-full blur-md" />
                        {/* 草地/山坡 */}
                        <div className="absolute bottom-0 inset-x-0 h-1/3 bg-gradient-to-t from-white/20 to-transparent rounded-t-[50%]" />
                        {/* 中央图标 */}
                        <div className="absolute inset-0 flex items-center justify-center pb-8">
                          <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-soft-lg">
                            <TypeIcon size={32} className="text-white drop-shadow-md" />
                          </div>
                        </div>
                        {/* 底部标题 */}
                        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/30 to-transparent pt-10 pb-3 px-4">
                          <p className="text-white text-sm font-medium truncate drop-shadow-md">{course.title}</p>
                        </div>
                      </>
                    )}

                    {/* 视频播放按钮（始终可见，覆盖在上层） */}
                    {course.type === 'video' && (
                      <div className="absolute inset-0 flex items-center justify-center z-10">
                        <div className={`
                          w-16 h-16 rounded-full flex items-center justify-center shadow-2xl
                          transition-all duration-300 group-hover/cover:scale-110 group-hover/cover:shadow-2xl
                          ${course.cover_url
                            ? 'bg-white/90 group-hover/cover:bg-white'
                            : 'bg-white/30 backdrop-blur-sm group-hover/cover:bg-white/50'
                          }
                        `}>
                          <Play size={28} className={course.cover_url ? 'text-sky-600 ml-1' : 'text-white ml-1 drop-shadow-lg'} />
                        </div>
                      </div>
                    )}

                    {/* PPT/PDF 角标图标 — 有封面时显示小图标，无封面时中央大图标已展示 */}
                    {course.type !== 'video' && course.cover_url && (
                      <div className="absolute top-3 right-3 z-10">
                        <div className="w-10 h-10 rounded-xl bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-soft-lg">
                          <TypeIcon size={20} className={TYPE_CONFIG[course.type]?.color || 'text-warm-600'} />
                        </div>
                      </div>
                    )}

                    {/* 时长角标 */}
                    {course.duration && (
                      <div className="absolute top-3 left-3 z-10">
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm text-white text-xs font-medium">
                          <Clock size={11} />
                          {formatDuration(course.duration)}
                        </span>
                      </div>
                    )}

                    {/* 封面图上的渐变覆盖 + 标题 */}
                    {course.cover_url && (
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/50 to-transparent pt-10 pb-3 px-4 z-10">
                        <p className="text-white text-sm font-medium truncate drop-shadow-md">
                          {course.title}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* 标题 */}
                  <h3 className="font-semibold text-warm-900 mb-1 line-clamp-2">
                    {course.title}
                  </h3>

                  {/* 描述 */}
                  {course.description && (
                    <p className="text-sm text-warm-500 mb-3 line-clamp-2">
                      {course.description}
                    </p>
                  )}

                  {/* 标签行 */}
                  <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <span className={`badge text-xs ${
                      course.type === 'video' ? 'badge-blue' :
                      course.type === 'ppt' ? 'badge-yellow' :
                      'badge-red'
                    }`}>
                      {TYPE_CONFIG[course.type]?.label || course.type}
                    </span>

                    {course.duration && (
                      <span className="flex items-center gap-1 text-xs text-warm-400">
                        <Clock size={12} />
                        {formatDuration(course.duration)}
                      </span>
                    )}
                  </div>

                  {/* 学习进度条 */}
                  <div className="mt-auto">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-warm-500">
                        {isCompleted ? '已完成' : `进度 ${progress}%`}
                      </span>
                      <span className="text-warm-400">{progress}%</span>
                    </div>
                    <div className="w-full bg-warm-200 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full transition-all ${
                          isCompleted ? 'bg-emerald-500' : 'bg-sky-500'
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </div>
      </div>

      {/* ===== 右侧：通关路线图 ===== */}
      <aside className="w-64 shrink-0 hidden xl:block">
        <div className="card sticky top-6">
          <div className="flex items-center gap-2 mb-4">
            <Flag size={18} className="text-primary-600" />
            <h3 className="font-semibold text-warm-900">通关路线图</h3>
          </div>

          {roadmapLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={20} className="animate-spin text-warm-400" />
            </div>
          ) : roadmap.length === 0 ? (
            <p className="text-sm text-warm-400 text-center py-8">暂无路线图</p>
          ) : (
            <div className="space-y-0">
              {roadmap.map((stage, idx) => (
                <div key={stage.id || idx} className="relative pl-6 pb-4 last:pb-0">
                  {/* 连接线 */}
                  {idx < roadmap.length - 1 && (
                    <div
                      className={`absolute left-[11px] top-6 w-0.5 h-full ${
                        stage.done ? 'bg-primary-400' : 'bg-warm-200'
                      }`}
                    />
                  )}

                  {/* 状态图标 */}
                  <div className="absolute left-0 top-0.5">
                    {stage.done ? (
                      <CheckCircle size={22} className="text-emerald-500" />
                    ) : (
                      <Circle size={22} className="text-warm-300" />
                    )}
                  </div>

                  {/* 阶段信息 */}
                  <div>
                    <p
                      className={`text-sm font-medium ${
                        stage.done ? 'text-warm-500' : 'text-warm-900'
                      }`}
                    >
                      {stage.name || `阶段 ${idx + 1}`}
                    </p>
                    {stage.description && (
                      <p className="text-xs text-warm-400 mt-0.5">
                        {stage.description}
                      </p>
                    )}
                    {stage.done && (
                      <span className="badge-green text-xs mt-1">
                        已完成
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* ===== 课程详情弹窗 ===== */}
      {showDetail && selectedCourse && (
        <div className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center bg-black/50 p-0 md:p-4">
          <div className="bg-white md:rounded-2xl shadow-2xl w-full h-screen md:h-auto md:max-h-[90vh] flex flex-col overflow-hidden md:mx-4 md:max-w-3xl"
            style={{ height: '100dvh' }}>
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between p-3 md:p-5 border-b shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-9 h-9 md:w-10 md:h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    TYPE_CONFIG[selectedCourse.type]?.bg || 'bg-gray-500'
                  }`}
                >
                  {(() => {
                    const Icon = TYPE_CONFIG[selectedCourse.type]?.icon || BookOpen;
                    return <Icon size={18} className="text-white" />;
                  })()}
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-warm-900 truncate text-sm md:text-base">
                    {selectedCourse.title}
                  </h3>
                  <p className="text-xs text-warm-400">
                    {TYPE_CONFIG[selectedCourse.type]?.label || selectedCourse.type}
                    {selectedCourse.duration && ` · ${formatDuration(selectedCourse.duration)}`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowDetail(false);
                  setSelectedCourse(null);
                }}
                className="p-2 hover:bg-warm-100 rounded-xl transition shrink-0"
              >
                <X size={20} />
              </button>
            </div>

            {/* 弹窗内容 */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-5">
              {/* 视频类型 */}
              {selectedCourse.type === 'video' && (
                <div className="space-y-4">
                  <div className="bg-black rounded-xl overflow-hidden aspect-video flex items-center justify-center relative">
                    {selectedCourse.resource_url ? (
                      <video
                        ref={videoRef}
                        key={selectedCourse.resource_url}
                        className="w-full h-full"
                        controls
                        controlsList="nodownload noremoteplayback"
                        disablePictureInPicture
                        playsInline
                        preload="metadata"
                        onContextMenu={(e) => e.preventDefault()}
                        onTimeUpdate={() => handleVideoTimeUpdate(selectedCourse.id)}
                        onEnded={() => handleVideoEnded(selectedCourse.id)}
                        crossOrigin="anonymous"
                        poster={selectedCourse.cover_url ? `/api/course-media/${selectedCourse.id}?type=cover&token=${encodeURIComponent(localStorage.getItem('token') || '')}` : undefined}
                      >
                        <source src={`/api/course-media/${selectedCourse.id}?type=resource&token=${encodeURIComponent(localStorage.getItem('token') || '')}`} type="video/mp4" />
                        您的浏览器不支持视频播放，请使用 Safari / Chrome / Edge 浏览器
                      </video>
                    ) : selectedCourse.cover_url ? (
                      <>
                        <img
                          src={`/api/course-media/${selectedCourse.id}?type=cover&token=${encodeURIComponent(localStorage.getItem('token') || '')}`}
                          alt={selectedCourse.title}
                          className="absolute inset-0 w-full h-full object-cover opacity-40"
                        />
                        <div className="relative z-10 text-center text-warm-300">
                          <Play size={48} className="mx-auto mb-3 opacity-60" />
                          <p className="text-sm">暂无可播放的视频资源</p>
                        </div>
                      </>
                    ) : (
                      <div className="text-center text-warm-400">
                        <Play size={48} className="mx-auto mb-3 opacity-50" />
                        <p className="text-sm">暂无可播放的视频资源</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* PDF/PPT 类型 - 使用 pdf.js 直接在页面内渲染 */}
              {(selectedCourse.type === 'pdf' || selectedCourse.type === 'ppt') && selectedCourse.resource_url && (
                <div className={`${selectedCourse.type === 'pdf' ? 'bg-rose-50' : 'bg-purple-50'} rounded-xl p-4 sm:p-6`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      {selectedCourse.type === 'pdf' ? (
                        <File size={24} className="text-rose-500" />
                      ) : (
                        <FileText size={24} className="text-purple-500" />
                      )}
                      <span className="font-medium text-sm sm:text-base">{selectedCourse.title}</span>
                    </div>
                    {/* PDF/PPT 标记完成按钮 */}
                    {getProgressPercent(selectedCourse.id) < 100 ? (
                      <button
                        onClick={() => handleMarkComplete(selectedCourse.id)}
                        disabled={progressLoading[selectedCourse.id]}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white text-sm font-medium rounded-xl shadow-soft hover:shadow-soft-lg transition-all duration-200 disabled:opacity-50"
                      >
                        {progressLoading[selectedCourse.id] ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <CheckCircle size={16} />
                        )}
                        标记为已完成
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 text-sm font-medium rounded-full border border-emerald-200">
                        <CheckCircle size={16} />
                        已完成
                      </span>
                    )}
                  </div>
                  <PDFViewer
                    url={`/api/${selectedCourse.type === 'ppt' ? 'ppt-to-pdf' : 'course-media'}/${selectedCourse.id}?type=resource`}
                    token={localStorage.getItem('token') || ''}
                  />
                </div>
              )}

              {/* PPT/PDF 类型 - 无资源（统一处理） */}
              {(selectedCourse.type === 'ppt' || selectedCourse.type === 'pdf') && !selectedCourse.resource_url && (
                <div className={`${selectedCourse.type === 'ppt' ? 'bg-purple-50' : 'bg-rose-50'} rounded-xl p-8 text-center`}>
                  {selectedCourse.type === 'ppt' ? (
                    <>
                      <FileText size={64} className="mx-auto mb-4 text-purple-400" />
                      <p className="text-purple-700 font-medium mb-2">PPT 课件</p>
                    </>
                  ) : (
                    <>
                      <File size={64} className="mx-auto mb-4 text-red-400" />
                      <p className="text-red-700 font-medium mb-2">PDF 文档</p>
                    </>
                  )}
                  <p className="text-sm text-warm-400">暂无可预览的资源</p>
                </div>
              )}

              {/* 课程描述 */}
              {selectedCourse.description && (
                <div className="mt-6 p-4 bg-warm-50/80 rounded-xl">
                  <p className="text-sm font-medium text-warm-700 mb-2">课程简介</p>
                  <p className="text-sm text-warm-600 leading-relaxed">
                    {selectedCourse.description}
                  </p>
                </div>
              )}
            </div>

            {/* 弹窗底部：学习进度 */}
            <div className="border-t p-3 md:p-5 shrink-0 bg-white">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                {/* 进度 */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 shrink-0">
                    <BarChart3 size={16} className="text-warm-400" />
                    <span className="text-sm text-warm-600">
                      进度：<span className="font-semibold text-primary-600">{getProgressPercent(selectedCourse.id)}%</span>
                    </span>
                  </div>
                  <div className="flex-1 md:w-32 md:flex-none bg-warm-200 rounded-full h-2 max-w-[200px]">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        getProgressPercent(selectedCourse.id) >= 100
                          ? 'bg-emerald-500'
                          : 'bg-sky-500'
                      }`}
                      style={{ width: `${getProgressPercent(selectedCourse.id)}%` }}
                    />
                  </div>
                </div>

                {/* 按钮 */}
                <div className="flex items-center gap-2 md:gap-3">
                  {progressLoading[selectedCourse.id] && (
                    <Loader2 size={16} className="animate-spin text-warm-400" />
                  )}
                  {getProgressPercent(selectedCourse.id) >= 100 && (
                    <span className="badge-green text-sm flex items-center gap-1">
                      <CheckCircle size={14} />
                      已完成
                    </span>
                  )}
                  <button
                    onClick={() => {
                      setShowDetail(false);
                      setSelectedCourse(null);
                    }}
                    className="btn-secondary text-sm"
                  >
                    返回列表
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
