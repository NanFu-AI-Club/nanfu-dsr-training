import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search, Plus, Edit3, Trash2, X, Play, FileText, Image as ImageIcon,
  Map, ChevronDown, BookOpen, Upload, Loader2, ExternalLink, Download,
} from 'lucide-react';
import api from '../../api';

const TYPE_ICONS = {
  video: { icon: Play, color: 'text-sky-500', label: '视频' },
  ppt: { icon: FileText, color: 'text-orange-500', label: 'PPT' },
  pdf: { icon: FileText, color: 'text-rose-500', label: 'PDF' },
};

const TYPE_OPTIONS = [
  { value: 'video', label: '视频' },
  { value: 'ppt', label: 'PPT' },
  { value: 'pdf', label: 'PDF' },
];

/* ================= 课程弹窗表单 ================= */
function CourseModal({ open, onClose, onSave, form, setForm, editingId }) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  if (!open) return null;

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const allowedExts = ['.mp4', '.webm', '.mov', '.pdf', '.ppt', '.pptx'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!allowedExts.includes(ext)) {
      alert('只支持视频(mp4/webm/mov)、PDF、PPT文件');
      return;
    }

    if (file.size > 500 * 1024 * 1024) {
      alert('文件大小不能超过500MB');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await api.post('/courses/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      if (res.code === 0) {
        setForm({ ...form, resource_url: res.data.url });
        if (ext === '.mp4' || ext === '.webm' || ext === '.mov') {
          setForm(prev => ({ ...prev, resource_url: res.data.url, type: 'video' }));
        } else if (ext === '.pdf') {
          setForm(prev => ({ ...prev, resource_url: res.data.url, type: 'pdf' }));
        } else if (ext === '.ppt' || ext === '.pptx') {
          setForm(prev => ({ ...prev, resource_url: res.data.url, type: 'ppt' }));
        }
      }
    } catch (err) {
      alert('上传失败: ' + (err.message || '未知错误'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-soft-xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{editingId ? '编辑课程' : '新建课程'}</h3>
          <button onClick={onClose} className="text-warm-400 hover:text-warm-600"><X size={20} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">标题 *</label>
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="课程标题" />
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">描述</label>
            <textarea className="input min-h-[80px] resize-y" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="课程描述" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">类型 *</label>
              <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="">请选择</option>
                {TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">时长（分钟）</label>
              <input className="input" type="number" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} placeholder="如 30" min="0" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">课程文件</label>
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp4,.webm,.mov,.pdf,.ppt,.pptx"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="btn-secondary flex items-center gap-1.5 text-sm"
              >
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {uploading ? '上传中...' : '上传文件'}
              </button>
              {form.resource_url && (
                <span className="text-xs text-green-600 flex items-center">✓ 已上传</span>
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">资源URL（或填写外部链接）</label>
            <input
              className="input text-sm"
              value={form.resource_url}
              onChange={(e) => setForm({ ...form, resource_url: e.target.value })}
              placeholder={form.resource_url || "上传文件或填写COS/TOS地址"}
            />
            {form.resource_url && form.resource_url.startsWith('/uploads/') && (
              <p className="text-xs text-warm-500 mt-1">本地文件：{form.resource_url}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">封面URL（可选）</label>
            <input className="input" value={form.cover_url} onChange={(e) => setForm({ ...form, cover_url: e.target.value })} placeholder="https://example.com/cover.jpg" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">分类</label>
              <input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="如：产品知识" />
            </div>
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">排序号</label>
              <input className="input" type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} placeholder="数字越小越靠前" min="0" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">标签（逗号分隔）</label>
            <input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="基础,入门,必修" />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button onClick={onClose} className="btn-secondary">取消</button>
            <button onClick={onSave} className="btn-primary">保存</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================= 阶段弹窗表单 ================= */
function StageModal({ open, onClose, onSave, form, setForm, courses, editingId }) {
  if (!open) return null;

  const toggleCourse = (courseId) => {
    const selected = form.course_ids || [];
    setForm({
      ...form,
      course_ids: selected.includes(courseId)
        ? selected.filter((id) => id !== courseId)
        : [...selected, courseId],
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-soft-xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{editingId ? '编辑阶段' : '新建阶段'}</h3>
          <button onClick={onClose} className="text-warm-400 hover:text-warm-600"><X size={20} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">阶段名称 *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：入门阶段" />
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">描述</label>
            <textarea className="input min-h-[60px] resize-y" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="阶段描述" />
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">排序号</label>
            <input className="input" type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} placeholder="数字越小越靠前" min="0" />
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-2">选择必修课程</label>
            <div className="max-h-48 overflow-y-auto border rounded-xl p-2 space-y-1">
              {courses.length === 0 && (
                <div className="text-xs text-warm-400 text-center py-4">暂无课程可选</div>
              )}
              {courses.map((course) => (
                <label key={course.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-warm-50/80 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={(form.course_ids || []).includes(course.id)}
                    onChange={() => toggleCourse(course.id)}
                    className="rounded border-warm-200 text-primary-600 focus:ring-sky-300/50"
                  />
                  <span className="text-sm text-warm-700">{course.title}</span>
                  <span className="text-xs text-warm-400 ml-auto">{course.type}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button onClick={onClose} className="btn-secondary">取消</button>
            <button onClick={onSave} className="btn-primary">保存</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================= 主页面 ================= */
export default function Courses() {
  const [activeTab, setActiveTab] = useState('courses');

  const [courses, setCourses] = useState([]);
  const [courseLoading, setCourseLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const [courseModalOpen, setCourseModalOpen] = useState(false);
  const [courseEditingId, setCourseEditingId] = useState(null);
  const [courseForm, setCourseForm] = useState({
    title: '', description: '', type: '', resource_url: '', cover_url: '',
    duration: '', category: '', tags: '', sort_order: '',
  });

  const [stages, setStages] = useState([]);
  const [stageLoading, setStageLoading] = useState(false);
  const [stageModalOpen, setStageModalOpen] = useState(false);
  const [stageEditingId, setStageEditingId] = useState(null);
  const [stageForm, setStageForm] = useState({ name: '', description: '', course_ids: [], sort_order: '' });

  const [error, setError] = useState('');

  const fetchCourses = useCallback(async () => {
    setCourseLoading(true);
    setError('');
    try {
      const params = {};
      if (search) params.keyword = search;
      if (typeFilter) params.type = typeFilter;
      if (categoryFilter) params.category = categoryFilter;
      const res = await api.get('/courses', { params });
      setCourses(res?.data?.list || res?.data || res || []);
    } catch (err) {
      setError(err?.message || '获取课程列表失败');
    } finally {
      setCourseLoading(false);
    }
  }, [search, typeFilter, categoryFilter]);

  const fetchStages = useCallback(async () => {
    setStageLoading(true);
    setError('');
    try {
      const res = await api.get('/courses/roadmap-stages');
      setStages(res?.data?.list || res?.data || res || []);
    } catch (err) {
      setError(err?.message || '获取路线图阶段失败');
    } finally {
      setStageLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'courses') fetchCourses();
    else fetchStages();
  }, [activeTab, fetchCourses, fetchStages]);

  const openAddCourse = () => {
    setCourseEditingId(null);
    setCourseForm({
      title: '', description: '', type: '', resource_url: '', cover_url: '',
      duration: '', category: '', tags: '', sort_order: '',
    });
    setCourseModalOpen(true);
  };

  const openEditCourse = (course) => {
    setCourseEditingId(course.id);
    setCourseForm({
      title: course.title || '',
      description: course.description || '',
      type: course.type || '',
      resource_url: course.resource_url || '',
      cover_url: course.cover_url || '',
      duration: course.duration ?? '',
      category: course.category || '',
      tags: Array.isArray(course.tags) ? course.tags.join(',') : (course.tags || ''),
      sort_order: course.sort_order ?? '',
    });
    setCourseModalOpen(true);
  };

  const saveCourse = async () => {
    if (!courseForm.title.trim() || !courseForm.type) return;
    try {
      const payload = {
        ...courseForm,
        duration: courseForm.duration ? Number(courseForm.duration) : undefined,
        sort_order: courseForm.sort_order ? Number(courseForm.sort_order) : undefined,
        tags: courseForm.tags ? courseForm.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      };
      if (courseEditingId) {
        await api.put(`/courses/${courseEditingId}`, payload);
      } else {
        await api.post('/courses', payload);
      }
      setCourseModalOpen(false);
      fetchCourses();
    } catch (err) {
      alert(err?.message || '保存失败');
    }
  };

  const deleteCourse = async (course) => {
    if (!window.confirm(`确定删除课程「${course.title}」？`)) return;
    try {
      await api.delete(`/courses/${course.id}`);
      fetchCourses();
    } catch (err) {
      alert(err?.message || '删除失败');
    }
  };

  const openAddStage = () => {
    setStageEditingId(null);
    setStageForm({ name: '', description: '', course_ids: [], sort_order: '' });
    setStageModalOpen(true);
  };

  const openEditStage = (stage) => {
    setStageEditingId(stage.id);
    setStageForm({
      name: stage.name || '',
      description: stage.description || '',
      course_ids: stage.required_courses || [],
      sort_order: stage.sort_order ?? '',
    });
    setStageModalOpen(true);
  };

  const saveStage = async () => {
    if (!stageForm.name.trim()) return;
    try {
      const payload = {
        name: stageForm.name,
        description: stageForm.description,
        sort_order: stageForm.sort_order ? Number(stageForm.sort_order) : undefined,
        required_courses: stageForm.course_ids,
      };
      if (stageEditingId) {
        await api.put(`/courses/roadmap-stages/${stageEditingId}`, payload);
      } else {
        await api.post('/courses/roadmap-stages', payload);
      }
      setStageModalOpen(false);
      fetchStages();
    } catch (err) {
      alert(err?.message || '保存失败');
    }
  };

  const deleteStage = async (stage) => {
    if (!window.confirm(`确定删除阶段「${stage.name}」？`)) return;
    try {
      await api.delete(`/courses/roadmap-stages/${stage.id}`);
      fetchStages();
    } catch (err) {
      alert(err?.message || '删除失败');
    }
  };

  const renderTypeIcon = (type) => {
    const config = TYPE_ICONS[type];
    if (!config) return <FileText size={18} className="text-warm-400" />;
    const Icon = config.icon;
    return <Icon size={18} className={config.color} />;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">课程管理</h1>
      </div>

      <div className="flex bg-warm-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab('courses')}
          className={`px-4 py-1.5 rounded-xl text-sm font-medium transition ${
            activeTab === 'courses' ? 'bg-white shadow text-warm-900' : 'text-warm-500'
          }`}
        >
          课程列表
        </button>
        <button
          onClick={() => setActiveTab('roadmap')}
          className={`px-4 py-1.5 rounded-xl text-sm font-medium transition flex items-center gap-1.5 ${
            activeTab === 'roadmap' ? 'bg-white shadow text-warm-900' : 'text-warm-500'
          }`}
        >
          <Map size={14} /> 通关路线图
        </button>
      </div>

      {error && (
        <div className="bg-rose-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          {error}
          <button onClick={() => setError('')} className="ml-2 underline">关闭</button>
        </div>
      )}

      {activeTab === 'courses' && (
        <>
          <div className="card">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-400" />
                <input
                  className="input pl-9"
                  placeholder="搜索课程标题..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select className="input w-32" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">全部类型</option>
                {TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <input
                className="input w-36"
                placeholder="分类筛选"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              />
              <div className="flex-1" />
              <button onClick={openAddCourse} className="btn-primary flex items-center gap-1.5 text-sm">
                <Plus size={16} /> 新建课程
              </button>
            </div>
          </div>

          <div className="card">
            {courseLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full" />
              </div>
            ) : courses.length === 0 ? (
              <div className="text-center py-16 text-sm text-warm-400">
                <BookOpen size={40} className="mx-auto mb-3 text-warm-300" />
                <p>暂无课程数据</p>
                <button onClick={openAddCourse} className="text-primary-600 hover:text-primary-800 mt-1 underline">新建课程</button>
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="table-header w-14">#</th>
                      <th className="table-header">课程信息</th>
                      <th className="table-header w-20">类型</th>
                      <th className="table-header w-20">时长</th>
                      <th className="table-header w-24">分类</th>
                      <th className="table-header w-20">排序</th>
                      <th className="table-header w-24">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-warm-100">
                    {courses.map((course) => {
                      const typeConfig = TYPE_ICONS[course.type];
                      return (
                        <tr key={course.id} className="hover:bg-warm-50/80">
                          <td className="table-cell">
                            {course.cover_url ? (
                              <img src={course.cover_url} alt="" className="w-10 h-10 rounded object-cover" />
                            ) : (
                              <div className="w-10 h-10 rounded bg-warm-100 flex items-center justify-center">
                                {renderTypeIcon(course.type)}
                              </div>
                            )}
                          </td>
                          <td className="table-cell">
                            <div className="font-medium text-warm-900">{course.title}</div>
                            {course.description && (
                              <div className="text-xs text-warm-500 mt-0.5 line-clamp-1">{course.description}</div>
                            )}
                            {course.tags && course.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {(Array.isArray(course.tags) ? course.tags : (typeof course.tags === 'string' ? course.tags.split(',') : [])).map((tag, idx) => (
                                  <span key={idx} className="inline-block bg-warm-100 text-warm-600 rounded px-1.5 py-0.5 text-xs">
                                    {typeof tag === 'string' ? tag.trim() : tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="table-cell">
                            {typeConfig && (
                              <span className={`badge text-xs ${typeConfig.color.replace('text-', 'bg-').replace('500', '100')} ${typeConfig.color}`}>
                                {typeConfig.label}
                              </span>
                            )}
                          </td>
                          <td className="table-cell text-warm-500">{course.duration ? `${course.duration}分钟` : '-'}</td>
                          <td className="table-cell">
                            {course.category && <span className="badge-gray text-xs">{course.category}</span>}
                          </td>
                          <td className="table-cell text-warm-500">{course.sort_order ?? '-'}</td>
                          <td className="table-cell">
                            <div className="flex items-center gap-1">
                              <button onClick={() => openEditCourse(course)} className="p-1.5 rounded hover:bg-warm-100 text-warm-400 hover:text-sky-600" title="编辑">
                                <Edit3 size={14} />
                              </button>
                              <button onClick={() => deleteCourse(course)} className="p-1.5 rounded hover:bg-warm-100 text-warm-400 hover:text-rose-600" title="删除">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'roadmap' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-warm-900">路线图阶段</h3>
            <button onClick={openAddStage} className="btn-primary flex items-center gap-1.5 text-sm">
              <Plus size={16} /> 新建阶段
            </button>
          </div>

          {stageLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full" />
            </div>
          ) : stages.length === 0 ? (
            <div className="text-center py-16 text-sm text-warm-400">
              <Map size={40} className="mx-auto mb-3 text-warm-300" />
              <p>暂无路线图阶段</p>
              <button onClick={openAddStage} className="text-primary-600 hover:text-primary-800 mt-1 underline">新建阶段</button>
            </div>
          ) : (
            <div className="space-y-3">
              {stages.map((stage, idx) => (
                <div key={stage.id} className="border rounded-xl p-4 hover:border-warm-200 transition">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-sm font-bold shrink-0">
                        {stage.sort_order ?? idx + 1}
                      </div>
                      <div>
                        <h4 className="font-semibold text-warm-900">{stage.name}</h4>
                        {stage.description && (
                          <p className="text-sm text-warm-500 mt-0.5">{stage.description}</p>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <span className="badge-blue text-xs">
                            <BookOpen size={12} className="mr-1" />
                            {(stage.required_courses?.length || 0)} 门课程
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => openEditStage(stage)} className="p-1.5 rounded hover:bg-warm-100 text-warm-400 hover:text-sky-600" title="编辑">
                        <Edit3 size={14} />
                      </button>
                      <button onClick={() => deleteStage(stage)} className="p-1.5 rounded hover:bg-warm-100 text-warm-400 hover:text-rose-600" title="删除">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <CourseModal
        open={courseModalOpen}
        onClose={() => setCourseModalOpen(false)}
        onSave={saveCourse}
        form={courseForm}
        setForm={setCourseForm}
        editingId={courseEditingId}
      />

      <StageModal
        open={stageModalOpen}
        onClose={() => setStageModalOpen(false)}
        onSave={saveStage}
        form={stageForm}
        setForm={setStageForm}
        courses={courses}
        editingId={stageEditingId}
      />
    </div>
  );
}