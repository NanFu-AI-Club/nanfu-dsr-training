import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Send, Menu, ChevronLeft, Plus, ThumbsUp, ThumbsDown,
  Star, MessageSquare, Trash2, Loader2, AlertCircle, BookOpen,
  Sparkles, Lightbulb, Zap, Search, ChevronRight, X,
  Mic, MicOff, Volume2, VolumeX,
} from 'lucide-react';
import api from '../../api';

/* ========== 推荐问题图标颜色 ========== */
const ICON_STYLES = [
  { icon: Zap, color: 'text-amber-500', bg: 'bg-amber-50' },
  { icon: Lightbulb, color: 'text-sky-500', bg: 'bg-sky-50' },
  { icon: Search, color: 'text-emerald-500', bg: 'bg-emerald-50' },
  { icon: Sparkles, color: 'text-purple-500', bg: 'bg-purple-50' },
];

function Chat() {
  // 核心状态使用 sessionStorage 持久化（切换频道不丢失）
  const [messages, setMessages] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('chat_messages') || '[]'); } catch { return []; }
  });
  const [conversations, setConversations] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('chat_conversations') || '[]'); } catch { return []; }
  });
  const [activeConversationId, setActiveConversationId] = useState(() => {
    return sessionStorage.getItem('chat_activeConvId') || null;
  });
  const [inputValue, setInputValue] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [favLoading, setFavLoading] = useState({});
  const [feedbackLoading, setFeedbackLoading] = useState({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const btnRefs = useRef({});
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [recording, setRecording] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState({});
  // 手机端对话历史抽屉
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const ttsAudioRef = useRef(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // 停止所有语音播放
  const stopAllTTS = useCallback(() => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }
    setTtsPlaying({});
  }, []);

  // 组件卸载时停止所有语音
  useEffect(() => {
    return () => stopAllTTS();
  }, [stopAllTTS]);

  // 同步到 sessionStorage（debounce 避免频繁写入卡顿）
  const saveTimerRef = useRef(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try { sessionStorage.setItem('chat_messages', JSON.stringify(messages)); } catch(_){}
    }, 500);
  }, [messages]);
  useEffect(() => {
    try { sessionStorage.setItem('chat_conversations', JSON.stringify(conversations)); } catch(_){}
  }, [conversations]);
  useEffect(() => { sessionStorage.setItem('chat_activeConvId', activeConversationId || ''); }, [activeConversationId]);

  const scrollToBottom = useCallback((instant = false) => {
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? 'instant' : 'smooth' });
  }, []);

  // 只在消息变化且不在加载中时自动滚动（避免加载时滚动导致输入框跳动）
  useEffect(() => {
    if (!loading) {
      scrollToBottom(messages.length <= 2);
    }
  }, [messages, loading, scrollToBottom]);

  // 加载对话历史列表
  const loadConversations = useCallback(async () => {
    try {
      setHistoryLoading(true);
      const res = await api.get('/ai/history');
      const list = res.data?.list || res.data || [];
      let convList;
      if (list.length > 0 && list[0].items) {
        convList = list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      } else {
        const grouped = {};
        list.forEach((item) => {
          const convId = item.conversation_id;
          if (!grouped[convId]) {
            grouped[convId] = {
              conversation_id: convId,
              title: item.question ? item.question.substring(0, 30) : (item.title || `对话 ${(convId || '').slice(0, 8)}`),
              updated_at: item.updated_at || item.created_at,
              messages: [],
            };
          }
          grouped[convId].messages.push(item);
        });
        convList = Object.values(grouped).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
      }
      setConversations(convList);
    } catch (err) {
      console.error('加载对话历史失败:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // 加载推荐问题（从知识库随机获取）
  useEffect(() => {
    let cancelled = false;
    api.get('/knowledge/suggestions').then(res => {
      if (cancelled) return;
      const data = res.data?.list || res.data || res || [];
      if (Array.isArray(data) && data.length > 0) {
        setSuggestions(data);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // 加载指定对话的消息
  const loadMessages = useCallback(async (conversationId) => {
    try {
      setLoading(true);
      const res = await api.get('/ai/history');
      const allConvs = res.data?.list || res.data || [];
      const conv = allConvs.find(c => c.conversation_id === conversationId);
      const items = conv?.items || [];
      const deduped = [];
      for (const item of items) {
        if (item.question) {
          deduped.push({ id: item.id + '_q', dbId: item.id, favoriteId: item.favorite_id || null, role: 'user', content: item.question, sources: item.sources || [], isFavorite: !!item.is_favorite, feedback: item.rating || null });
        }
        if (item.answer) {
          deduped.push({ id: item.id + '_a', dbId: item.id, favoriteId: item.favorite_id || null, role: 'assistant', content: item.answer, sources: item.sources || [], isFavorite: !!item.is_favorite, feedback: item.rating || null });
        }
      }
      const msgs = items.map((item) => ({
        id: item.id,
        dbId: item.id,
        favoriteId: item.favorite_id || null,
        role: item.role || (item.question ? 'user' : 'assistant'),
        content: item.content || item.question || item.answer || '',
        sources: item.sources || [],
        isFavorite: !!item.is_favorite,
        feedback: item.rating || null,
      }));
      setMessages(deduped.length > 0 ? deduped : msgs);
    } catch (err) {
      console.error('加载消息失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const switchConversation = (conversationId) => {
    setActiveConversationId(conversationId);
    if (conversationId) {
      loadMessages(conversationId);
    } else {
      setMessages([]);
    }
  };

  const newConversation = () => {
    setActiveConversationId(null);
    setMessages([]);
    setInputValue('');
    inputRef.current?.focus();
  };

  // 删除对话
  const deleteConversation = async (conversationId, e) => {
    e.stopPropagation();
    if (deleteConfirm === conversationId) {
      try {
        await api.delete(`/ai/conversations/${conversationId}`);
        if (activeConversationId === conversationId) {
          newConversation();
        }
        loadConversations();
      } catch (err) {
        console.error('删除对话失败:', err);
      }
      setDeleteConfirm(null);
    } else {
      setDeleteConfirm(conversationId);
      setTimeout(() => setDeleteConfirm(null), 3000);
    }
  };

  // ==================== 语音输入（浏览器 SpeechRecognition，兜底火山 ASR） ====================
  const startRecording = async () => {
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

    // 桌面端 Chrome/Edge 优先用浏览器内置语音识别
    // 手机端直接走录音上传（兼容性更好），跳过 SpeechRecognition（很多手机浏览器有 bug）
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition && !isMobile) {
      try {
        const recognition = new SpeechRecognition();
        recognition.lang = 'zh-CN';
        recognition.interimResults = false;
        recognition.continuous = false;

        recognition.onstart = () => setRecording(true);
        recognition.onend = () => setRecording(false);
        recognition.onerror = (e) => {
          console.error('语音识别错误:', e.error);
          setRecording(false);
          if (e.error === 'no-speech') {
            alert('未检测到语音，请重试');
          } else if (e.error === 'not-allowed') {
            alert('请允许麦克风权限后重试');
          } else if (e.error === 'network') {
            alert('语音识别需要网络连接，请检查网络后重试');
          } else if (e.error !== 'aborted') {
            alert('语音识别失败，请尝试打字输入（错误码：' + e.error + '）');
          }
        };
        recognition.onresult = (e) => {
          const text = e.results[0][0].transcript.trim();
          if (text) {
            setInputValue(text);
            setTimeout(() => handleSend(text), 100);
          }
        };

        recognition.start();
        return;
      } catch (e) {
        console.error('SpeechRecognition 启动失败，降级到录音上传:', e);
      }
    }

    // 手机端 / 不支持 SpeechRecognition → 录音上传到腾讯云ASR
    try {
      // HTTPS 检查：mediaDevices 只能在安全上下文中使用
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const isHTTP = location.protocol === 'http:';
        if (isHTTP) {
          alert('麦克风需要 HTTPS 安全连接。\n\n请在浏览器地址栏输入：\nhttps://1.15.172.36\n\n（首次打开会提示"不安全"，点击"高级"→"继续访问"即可）');
        } else {
          alert('当前浏览器不支持麦克风功能，请使用 Chrome/Safari/Edge 浏览器');
        }
        return;
      }

      // 检测支持的音频格式
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'audio/mp4';
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = ''; // 让浏览器选择默认格式
          }
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const opts = mimeType ? { mimeType } : {};
      const mediaRecorder = new MediaRecorder(stream, opts);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType || 'audio/mp4' });
        if (audioBlob.size < 200) {
          alert('录音太短，请点麦克风后说出完整问题再点停止');
          return;
        }

        const formData = new FormData();
        formData.append('audio', audioBlob, `recording.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`);

        try {
          setLoading(true);
          const res = await api.post('/ai/speech-to-text', formData);
          const data = res.data || res;
          const text = data?.data?.text || data?.text || '';
          if (text.trim()) {
            setInputValue(text);
            setTimeout(() => handleSend(text), 100);
          } else {
            alert('未识别到语音内容，请重试');
          }
        } catch (err) {
          console.error('语音上传识别失败:', err);
          alert('语音识别失败: ' + (err?.message || '请重试'));
        } finally {
          setLoading(false);
        }
      };

      mediaRecorder.start();
      setRecording(true);
    } catch (err) {
      console.error('麦克风启动失败:', err);
      let errMsg;
      if (err.name === 'NotAllowedError') {
        const isHTTP = location.protocol === 'http:';
        errMsg = isHTTP
          ? '麦克风需要HTTPS安全连接。\n\n请访问 https://1.15.172.36\n（首次打开需点击"高级"→"继续访问"）'
          : '请允许麦克风权限后重试（在浏览器设置中开启麦克风权限）';
      } else if (err.name === 'NotFoundError') {
        errMsg = '未检测到麦克风设备';
      } else {
        errMsg = '无法访问麦克风: ' + (err.message || '请检查浏览器权限');
      }
      alert(errMsg);
    }
  };

  const stopRecording = () => {
    // 先尝试停止浏览器 SpeechRecognition
    setRecording(false);
    // 再停止 MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  // ==================== 提取"回答的话术"用于语音播放 ====================
  const extractSpeechText = (content) => {
    // 匹配 "2. 回答的话术" 或 "回答的话术：" 后面的内容
    const patterns = [
      /2\.\s*回答的话术\s*[：:]*\s*\n([\s\S]*?)(?=\n\s*\d+\.\s|$)/,
      /回答的话术\s*[：:]\s*\n?([\s\S]*?)(?=\n\s*\d+\.\s|$)/,
    ];
    for (const p of patterns) {
      const match = content.match(p);
      if (match && match[1]?.trim()) return match[1].trim();
    }
    return content; // 兜底：全文播放
  };

  // ==================== TTS 语音播放（浏览器 SpeechSynthesis，兜底火山 TTS） ====================
  const playTTS = async (msgId, text) => {
    // 如果正在播放同一条，停止
    if (ttsPlaying[msgId]) {
      window.speechSynthesis?.cancel();
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
      }
      setTtsPlaying(prev => ({ ...prev, [msgId]: false }));
      return;
    }

    // 优先使用浏览器内置语音合成
    if (window.speechSynthesis) {
      try {
        setTtsPlaying(prev => ({ ...prev, [msgId]: true }));

        // 清理旧语音
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN';
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        let hasEnded = false;
        const timeout = setTimeout(() => {
          if (!hasEnded) {
            // 超时：可能语音无声但未触发 error，降级到火山 TTS
            window.speechSynthesis.cancel();
            playVolcanoTTS(msgId, text);
          }
        }, 4000);

        utterance.onend = () => {
          hasEnded = true;
          clearTimeout(timeout);
          setTtsPlaying(prev => ({ ...prev, [msgId]: false }));
        };
        utterance.onerror = () => {
          hasEnded = true;
          clearTimeout(timeout);
          playVolcanoTTS(msgId, text);
        };

        window.speechSynthesis.speak(utterance);
        return;
      } catch {
        playVolcanoTTS(msgId, text);
        return;
      }
    }

    playVolcanoTTS(msgId, text);
  };

  // 火山 TTS 兜底（使用 fetch 绕过 axios 拦截器的 res.data 变换）
  const playVolcanoTTS = async (msgId, text) => {
    try {
      setTtsPlaying(prev => ({ ...prev, [msgId]: 'loading' }));
      // 用原生 fetch 获取 blob，避免 axios 拦截器破坏二进制响应
      const token = localStorage.getItem('token');
      const resp = await fetch('/api/ai/text-to-speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ text }),
      });
      if (!resp.ok) throw new Error(`TTS HTTP ${resp.status}`);
      const blob = await resp.blob();
      const audioUrl = URL.createObjectURL(blob);

      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        URL.revokeObjectURL(ttsAudioRef.current.src);
      }

      const audio = new Audio(audioUrl);
      ttsAudioRef.current = audio;

      audio.onended = () => {
        setTtsPlaying(prev => ({ ...prev, [msgId]: false }));
        URL.revokeObjectURL(audioUrl);
        ttsAudioRef.current = null;
      };
      audio.onerror = () => {
        setTtsPlaying(prev => ({ ...prev, [msgId]: false }));
        URL.revokeObjectURL(audioUrl);
        ttsAudioRef.current = null;
      };
      await audio.play();
      setTtsPlaying(prev => ({ ...prev, [msgId]: true }));
    } catch (err) {
      console.error('TTS 失败:', err);
      setTtsPlaying(prev => ({ ...prev, [msgId]: false }));
    }
  };

  // 发送消息
  const handleSend = async (overrideText) => {
    const text = (overrideText || inputValue).trim();
    if (!text || loading) return;

    // 发送新问题时停止所有正在播放的语音
    stopAllTTS();

    const userMsg = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      sources: [],
      isFavorite: false,
      feedback: null,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setError('');

    try {
      setLoading(true);
      const res = await api.post('/ai/chat', {
        question: text,
        conversation_id: activeConversationId,
      });

      const data = res.data || res;
      const feedbackId = data.id;
      const aiMsg = {
        id: feedbackId ? (feedbackId + '_a') : `ai-${Date.now()}`,
        dbId: feedbackId || null,
        favoriteId: null,
        role: 'assistant',
        content: data.answer || data.reply || data.content || '',
        sources: data.sources || [],
        isFavorite: false,
        feedback: null,
      };

      setMessages((prev) => [...prev, aiMsg]);

      // 自动播放 TTS（只播放"回答的话术"部分）
      setTimeout(() => playTTS(aiMsg.id, extractSpeechText(aiMsg.content)), 500);

      if (!activeConversationId && data.conversation_id) {
        setActiveConversationId(data.conversation_id);
        loadConversations();
      }
    } catch (err) {
      const errMsg = err?.message || '发送失败，请重试';
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Web Animations API - 按钮点击特效
  const playAnimation = useCallback((msgId, type) => {
    const el = btnRefs.current[`${msgId}-${type}`];
    if (!el) return;

    if (type === 'like') {
      el.animate([
        { transform: 'scale(1)', offset: 0 },
        { transform: 'scale(1.35)', offset: 0.3 },
        { transform: 'scale(0.9)', offset: 0.6 },
        { transform: 'scale(1)', offset: 1 },
      ], { duration: 480, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
    } else if (type === 'dislike') {
      el.animate([
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(-5px)', offset: 0.15 },
        { transform: 'translateX(5px)', offset: 0.3 },
        { transform: 'translateX(-4px)', offset: 0.45 },
        { transform: 'translateX(4px)', offset: 0.6 },
        { transform: 'translateX(-2px)', offset: 0.75 },
        { transform: 'translateX(0)', offset: 1 },
      ], { duration: 450, easing: 'ease' });
    } else if (type === 'star') {
      el.animate([
        { transform: 'scale(1) rotate(0deg)', offset: 0 },
        { transform: 'scale(1.5) rotate(180deg)', offset: 0.4 },
        { transform: 'scale(1) rotate(360deg)', offset: 1 },
      ], { duration: 580, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
    }
  }, []);

  const handleFeedback = async (messageId, type) => {
    const msg = messages.find(m => m.id === messageId);
    const apiId = msg?.dbId || messageId;
    try {
      setFeedbackLoading((prev) => ({ ...prev, [messageId]: type }));
      await api.post(`/ai/feedback/${apiId}`, { rating: type });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, feedback: m.feedback === type ? null : type } : m
        )
      );
      playAnimation(messageId, type);
    } catch (err) {
      console.error('反馈失败:', err);
      alert('反馈操作失败: ' + (err?.message || '请重试'));
    } finally {
      setFeedbackLoading((prev) => ({ ...prev, [messageId]: null }));
    }
  };

  const handleFavorite = async (messageId, currentFav) => {
    const msg = messages.find(m => m.id === messageId);
    const dbId = msg?.dbId || messageId;
    const favoriteId = msg?.favoriteId || null;
    try {
      setFavLoading((prev) => ({ ...prev, [messageId]: true }));
      if (currentFav) {
        // DELETE 用 ai_favorites 表的 id
        if (!favoriteId) throw new Error('favoriteId 缺失');
        await api.delete(`/ai/favorites/${favoriteId}`);
      } else {
        // POST 用 ai_feedbacks 表的 id; 返回值包含新创建的 ai_favorites.id
        const res = await api.post(`/ai/favorites/${dbId}`);
        const newFavId = res?.data?.favorite_id || res?.favorite_id;
        if (newFavId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId ? { ...m, isFavorite: true, favoriteId: newFavId } : m
            )
          );
          playAnimation(messageId, 'star');
          return;
        }
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, isFavorite: !currentFav } : m
        )
      );
      playAnimation(messageId, 'star');
    } catch (err) {
      console.error('收藏操作失败:', err);
      alert('收藏操作失败: ' + (err?.message || '请重试'));
    } finally {
      setFavLoading((prev) => ({ ...prev, [messageId]: false }));
    }
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  /* ========== 过滤 emoji（防止显示为 □□）========== */
  const filterEmoji = useCallback((text) => {
    if (!text) return text;
    return text
      .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
      .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
      .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
      .replace(/[\u{1F700}-\u{1F77F}]/gu, '')
      .replace(/[\u{1F780}-\u{1F7FF}]/gu, '')
      .replace(/[\u{1F800}-\u{1F8FF}]/gu, '')
      .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
      .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '')
      .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '')
      .replace(/[\u{2600}-\u{26FF}]/gu, '')
      .replace(/[\u{2700}-\u{27BF}]/gu, '')
      .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
      .replace(/[\u{200D}]/gu, '')
      .replace(/\uFFFD/g, ''); // 替换字符
  }, []);

  /* ========== 渲染 AI 回复内容（支持 Markdown 基础格式）========== */
  const renderContent = useCallback((content) => {
    if (!content) return null;
    // 先过滤 emoji
    const filtered = filterEmoji(content);
    const lines = filtered.split('\n');
    return lines.map((line, i) => {
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      const rendered = parts.map((part, j) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={j}>{part.slice(2, -2)}</strong>;
        }
        return <span key={j}>{part}</span>;
      });
      return (
        <span key={i}>
          {rendered}
          {i < lines.length - 1 && <br />}
        </span>
      );
    });
  }, [filterEmoji]);

  const isEmpty = useMemo(() => messages.length === 0 && !loading, [messages.length, loading]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden md:flex-row">
      {/* ===== 侧边栏：仅桌面端显示 ===== */}
      <aside
        className={`bg-white/80 backdrop-blur-xl border-r border-warm-100/60 flex-col shrink-0 transition-all duration-300 overflow-hidden hidden md:flex ${
          sidebarOpen ? 'w-64' : 'w-0'
        }`}
      >
        <div className="h-full flex flex-col">
          <div className="p-4 border-b border-warm-100/60 flex items-center justify-between">
            <span className="font-semibold text-sm text-warm-700">对话历史</span>
            <button
              onClick={newConversation}
              className="p-1.5 rounded-xl hover:bg-primary-50 text-primary-600 transition-all duration-200"
              title="新建对话"
            >
              <Plus size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {historyLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 size={20} className="animate-spin text-warm-400" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="text-center py-8 text-warm-400 text-sm">
                <MessageSquare size={28} className="mx-auto mb-2 opacity-50" />
                暂无对话历史
              </div>
            ) : (
              conversations.map((conv) => (
                <div
                  key={conv.conversation_id}
                  className={`group relative w-full text-left p-3 rounded-xl transition-all duration-200 text-sm cursor-pointer ${
                    activeConversationId === conv.conversation_id
                      ? 'bg-primary-50 text-primary-700 shadow-inner-soft'
                      : 'hover:bg-warm-50/80 text-warm-700'
                  }`}
                  onClick={() => switchConversation(conv.conversation_id)}
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare size={14} className="shrink-0 opacity-40" />
                    <div className="truncate font-medium flex-1">{conv.title}</div>
                    <button
                      onClick={(e) => deleteConversation(conv.conversation_id, e)}
                      className={`p-1 rounded-lg transition-all duration-200 ${
                        deleteConfirm === conv.conversation_id
                          ? 'opacity-100 bg-rose-50 text-rose-500'
                          : 'opacity-0 group-hover:opacity-100 hover:bg-rose-50 text-warm-400 hover:text-rose-500'
                      }`}
                      title={deleteConfirm === conv.conversation_id ? '再次点击确认删除' : '删除对话'}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div className="text-xs text-warm-400 mt-1 ml-[22px]">
                    {formatTime(conv.updated_at)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>

      {/* ===== 主对话区域 ===== */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-gradient-to-b from-sky-50/30 via-white to-warm-50/30">
        {/* 顶部标题栏：仅桌面端显示 */}
        <div className="hidden md:flex bg-white/70 backdrop-blur-xl border-b border-warm-100/60 px-4 py-3 items-center gap-3 shrink-0">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded-xl hover:bg-warm-100 transition-all duration-200"
            title={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
          >
            {sidebarOpen ? <ChevronLeft size={20} /> : <Menu size={20} />}
          </button>
          <div className="flex items-center gap-2.5 flex-1">
            <div className="w-8 h-8 bg-gradient-to-br from-sky-400 to-primary-600 rounded-xl flex items-center justify-center shadow-soft">
              <Sparkles size={16} className="text-white" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-warm-900">智囊小助手</h2>
              <p className="text-[11px] text-warm-400">基于知识库和题库的 AI 智能回答</p>
            </div>
          </div>
          {Object.values(ttsPlaying).some(v => v) && (
            <button
              onClick={stopAllTTS}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100 transition text-sm font-medium shrink-0"
              title="停止所有语音播放"
            >
              <VolumeX size={15} />
              停止播放
            </button>
          )}
        </div>

        {/* 消息区域 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
          {/* 手机端：对话历史入口 + 新建对话 */}
          <div className="md:hidden flex items-center justify-between mb-3">
            <span className="text-xs text-warm-400 font-medium">智囊小助手</span>
            <div className="flex items-center gap-1">
              <button
                onClick={newConversation}
                className="p-1.5 rounded-lg text-warm-400 hover:bg-warm-100 hover:text-primary-600 transition-colors"
                title="新建对话"
              >
                <Plus size={16} />
              </button>
              <button
                onClick={() => { setMobileDrawerOpen(true); loadConversations(); }}
                className="p-1.5 rounded-lg text-warm-400 hover:bg-warm-100 hover:text-primary-600 transition-colors flex items-center gap-1"
                title="对话历史"
              >
                <MessageSquare size={16} />
                <span className="text-xs">历史</span>
              </button>
            </div>
          </div>

          {/* ===== 手机端对话历史抽屉 ===== */}
          {mobileDrawerOpen && (
            <div className="md:hidden fixed inset-0 z-[60]">
              <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setMobileDrawerOpen(false)} />
              <div className="absolute right-0 top-0 bottom-0 w-72 bg-white shadow-2xl flex flex-col animate-slide-in">
                <div className="p-4 border-b border-warm-100 flex items-center justify-between">
                  <span className="font-semibold text-sm text-warm-800">对话历史</span>
                  <button onClick={() => setMobileDrawerOpen(false)} className="p-1 rounded-lg hover:bg-warm-100">
                    <X size={18} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                  {historyLoading ? (
                    <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-warm-400" /></div>
                  ) : conversations.length === 0 ? (
                    <div className="text-center py-8 text-xs text-warm-400">暂无历史对话</div>
                  ) : (
                    conversations.map((conv) => {
                      const cid = conv.conversation_id || conv.id;
                      return (
                        <div
                          key={cid}
                          onClick={() => { switchConversation(cid); setMobileDrawerOpen(false); }}
                          className={`group flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all ${
                            activeConversationId === cid
                              ? 'bg-primary-50 text-primary-700'
                              : 'hover:bg-warm-50 text-warm-700'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate">{conv.title || `对话 ${(cid || '').slice(0, 8)}`}</p>
                            <p className="text-[10px] text-warm-400 mt-0.5">{formatTime(conv.updated_at)}</p>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteConversation(cid, e); }}
                            className={`ml-2 p-1 rounded-lg transition-all ${
                              deleteConfirm === cid
                                ? 'opacity-100 bg-rose-50 text-rose-500'
                                : 'opacity-0 group-hover:opacity-100 hover:bg-rose-50 text-warm-400 hover:text-rose-500'
                            }`}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {isEmpty ? (
            /* ===== 欢迎界面（手机端精简） ===== */
            <div className="flex flex-col items-center pt-4 md:pt-0 md:justify-center md:min-h-full">
              <div className="w-12 h-12 md:w-20 md:h-20 bg-gradient-to-br from-sky-400 to-primary-600 rounded-2xl md:rounded-3xl flex items-center justify-center shadow-soft-lg mb-3 md:mb-6">
                <Sparkles size={22} className="text-white md:size-36" />
              </div>
              <h3 className="text-base md:text-2xl font-bold text-warm-900 mb-1 md:mb-2">你好，我是智答助手</h3>
              <p className="text-warm-500 text-xs md:text-sm mb-4 md:mb-8 text-center max-w-md px-2 hidden md:block">
                我可以帮助你解答关于产品、销售技巧、公司制度等方面的问题。<br />
                试试下面的问题，或直接输入你想了解的内容。
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-lg px-2 md:px-0">
                {suggestions.slice(0, 2).map((item, idx) => {
                  const style = ICON_STYLES[idx % ICON_STYLES.length];
                  const Icon = style.icon;
                  const text = typeof item === 'string' ? item : (item.text || item.title || '');
                  return (
                    <button
                      key={idx}
                      onClick={() => handleSend(text)}
                      className="flex items-center gap-2.5 p-3 bg-white rounded-2xl border border-warm-100/80 hover:border-primary-200 hover:shadow-soft text-left transition-all duration-200 group"
                    >
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${style.bg} shrink-0`}>
                        <Icon size={16} className={style.color} />
                      </div>
                      <span className="text-sm text-warm-700 group-hover:text-primary-700 transition-colors line-clamp-2">
                        {text}
                      </span>
                      <ChevronRight size={14} className="text-warm-300 group-hover:text-primary-400 ml-auto shrink-0 transition-colors" />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            /* ===== 消息列表 ===== */
            <div className="max-w-3xl mx-auto space-y-1">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-3 py-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                >
                  {/* 头像 */}
                  <div
                    className={`w-9 h-9 rounded-2xl flex items-center justify-center text-xs font-bold shrink-0 ${
                      msg.role === 'user'
                        ? 'bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-soft'
                        : 'bg-gradient-to-br from-sky-400 to-primary-600 text-white shadow-soft'
                    }`}
                  >
                    {msg.role === 'user' ? '我' : <Sparkles size={15} />}
                  </div>

                  {/* 消息内容 */}
                  <div className={`max-w-[75%] ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col`}>
                    <div
                      className={`px-4 py-3 text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-gradient-to-br from-primary-500 to-primary-700 text-white rounded-2xl rounded-tr-sm shadow-soft'
                          : 'bg-white text-warm-800 rounded-2xl rounded-tl-sm border border-warm-100/80 shadow-soft'
                      }`}
                    >
                      {renderContent(msg.content)}
                    </div>

                    {/* 来源引用 */}
                    {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {msg.sources.map((source, idx) => (
                          <span
                            key={idx}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium ${
                              source.type === 'question'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                : 'bg-sky-50 text-sky-700 border border-sky-100'
                            }`}
                          >
                            <BookOpen size={11} />
                            {source.type === 'question' ? '题库' : '知识库'}: {source.title || `引用 ${idx + 1}`}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* AI 回复操作栏 */}
                    {msg.role === 'assistant' && (
                      <div className="flex flex-wrap items-center gap-2 mt-3">
                        {/* 点赞 */}
                        <button
                          ref={(el) => { btnRefs.current[`${msg.id}-like`] = el; }}
                          onClick={() => handleFeedback(msg.id, 'like')}
                          disabled={!!feedbackLoading[msg.id]}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-200 active:scale-95 ${
                            msg.feedback === 'like'
                              ? 'bg-blue-50 text-blue-600 border-blue-200 shadow-sm'
                              : 'bg-white/80 text-warm-500 border-warm-200 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50/50'
                          }`}
                          title="有帮助"
                        >
                          {feedbackLoading[msg.id] === 'like' ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <ThumbsUp size={14} className={msg.feedback === 'like' ? 'fill-blue-500 text-blue-500' : ''} />
                          )}
                          点赞
                        </button>

                        {/* 不点赞 */}
                        <button
                          ref={(el) => { btnRefs.current[`${msg.id}-dislike`] = el; }}
                          onClick={() => handleFeedback(msg.id, 'dislike')}
                          disabled={!!feedbackLoading[msg.id]}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-200 active:scale-95 ${
                            msg.feedback === 'dislike'
                              ? 'bg-rose-50 text-rose-600 border-rose-200 shadow-sm'
                              : 'bg-white/80 text-warm-500 border-warm-200 hover:border-rose-300 hover:text-rose-600 hover:bg-rose-50/50'
                          }`}
                          title="待改进"
                        >
                          {feedbackLoading[msg.id] === 'dislike' ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <ThumbsDown size={14} className={msg.feedback === 'dislike' ? 'fill-rose-500 text-rose-500' : ''} />
                          )}
                          踩
                        </button>

                        {/* 收藏 */}
                        <button
                          ref={(el) => { btnRefs.current[`${msg.id}-star`] = el; }}
                          onClick={() => handleFavorite(msg.id, msg.isFavorite)}
                          disabled={favLoading[msg.id]}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-200 active:scale-95 ${
                            msg.isFavorite
                              ? 'bg-amber-50 text-amber-600 border-amber-200 shadow-sm'
                              : 'bg-white/80 text-warm-500 border-warm-200 hover:border-amber-300 hover:text-amber-600 hover:bg-amber-50/50'
                          }`}
                          title={msg.isFavorite ? '取消收藏' : '收藏'}
                        >
                          {favLoading[msg.id] ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Star size={14} fill={msg.isFavorite ? 'currentColor' : 'none'} />
                          )}
                          收藏
                        </button>

                        {/* TTS 语音播报 */}
                        <button
                          onClick={() => playTTS(msg.id, extractSpeechText(msg.content))}
                          className={`p-1.5 rounded-lg transition-all duration-200 ${
                            ttsPlaying[msg.id] === true
                              ? 'text-primary-600 bg-primary-50'
                              : ttsPlaying[msg.id] === 'loading'
                              ? 'text-primary-400'
                              : 'text-warm-300 hover:text-primary-600 hover:bg-primary-50'
                          }`}
                          title={ttsPlaying[msg.id] === true ? '停止播放' : '语音播报'}
                        >
                          {ttsPlaying[msg.id] === 'loading' ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Volume2 size={13} className={ttsPlaying[msg.id] === true ? 'animate-pulse' : ''} />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* 加载中 */}
              {loading && (
                <div className="flex gap-3 py-4">
                  <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-sky-400 to-primary-600 flex items-center justify-center shadow-soft">
                    <Sparkles size={15} className="text-white" />
                  </div>
                  <div className="bg-white border border-warm-100/80 px-4 py-3 rounded-2xl rounded-tl-sm shadow-soft">
                    <div className="flex items-center gap-2.5">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-2 h-2 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2 h-2 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      <span className="text-sm text-warm-400">正在思考...</span>
                    </div>
                  </div>
                </div>
              )}

              {/* 错误提示 */}
              {error && (
                <div className="flex justify-center py-3">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-rose-50 text-rose-600 rounded-xl text-sm border border-rose-100">
                    <AlertCircle size={16} />
                    {error}
                    <button onClick={handleSend} className="ml-2 underline font-medium">重试</button>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 底部输入区 */}
        <div className="bg-white/70 backdrop-blur-xl border-t border-warm-100/60 px-3 md:px-4 py-2.5 md:py-3 shrink-0 relative z-10">
          <div className="flex items-end gap-1.5 md:gap-2 max-w-3xl mx-auto">
            {/* 麦克风按钮 */}
            <button
              onClick={recording ? stopRecording : startRecording}
              className={`p-2.5 md:p-3 rounded-2xl shrink-0 transition-all duration-200 ${
                recording
                  ? 'bg-rose-500 text-white animate-pulse shadow-lg shadow-rose-200'
                  : 'bg-warm-100 text-warm-500 hover:text-primary-600 hover:bg-primary-100 active:scale-95'
              }`}
              title={recording ? '点击停止录音' : '语音输入'}
            >
              {recording ? <MicOff size={20} /> : <Mic size={20} />}
            </button>

            <div className="flex-1 relative">
              {recording && (
                <div className="absolute inset-0 flex items-center justify-center bg-rose-50/90 rounded-2xl z-10">
                  <span className="text-rose-500 font-medium text-sm animate-pulse">正在聆听...</span>
                </div>
              )}
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={recording ? '正在录音...' : '输入问题，或点麦克风语音'}
                className="input resize-none pr-3 min-h-[44px] md:min-h-[48px] max-h-[80px] md:max-h-[120px] rounded-2xl border-warm-200 focus:border-primary-300 text-sm md:text-base"
                rows={1}
                disabled={loading}
              />
            </div>
            <button
              onClick={() => handleSend()}
              disabled={!inputValue.trim() || loading}
              className="bg-gradient-to-r from-primary-500 to-primary-700 text-white flex items-center gap-1.5 px-4 md:px-5 py-2.5 md:py-3 rounded-2xl shrink-0 shadow-soft hover:shadow-soft-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm md:text-base"
            >
              {loading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Send size={18} />
              )}
            </button>
          </div>
          <p className="text-center text-[10px] text-warm-300 mt-1.5 md:hidden">
            语音输入 / AI智能回答
          </p>
        </div>
      </div>
    </div>
  );
}

export default React.memo(Chat);
