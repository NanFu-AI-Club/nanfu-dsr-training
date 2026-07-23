import { createContext, useContext, useState, useCallback, useRef } from 'react';

const ChatContext = createContext(null);

export function ChatProvider({ children }) {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // TTS related refs/state — kept in context for persistence
  const [ttsPlaying, setTtsPlaying] = useState({});
  const ttsAudioRef = useRef(null);

  const clearChat = useCallback(() => {
    setMessages([]);
    setInputValue('');
    setActiveConversationId(null);
    setError('');
  }, []);

  return (
    <ChatContext.Provider value={{
      messages, setMessages,
      inputValue, setInputValue,
      conversations, setConversations,
      activeConversationId, setActiveConversationId,
      loading, setLoading,
      error, setError,
      ttsPlaying, setTtsPlaying,
      ttsAudioRef,
      clearChat,
    }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatContext must be used within ChatProvider');
  return ctx;
}
