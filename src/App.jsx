import React, { useState, useEffect, useRef } from 'react';
import { Search, Home, Library, Settings, Sparkles, Share2, ChevronRight, Loader2, Globe, MessageSquare, Plus, Menu, Trash2, Edit2, Check, X, Moon, Sun, BookOpen, Layers, PlusCircle, MoreVertical } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { supabase } from './supabase';
import { generateSearchQueries } from './services/api';

const FUNCTION_URL = import.meta.env.VITE_SUPABASE_FUNCTION_URL;

const App = () => {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [threads, setThreads] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 768);
  // const skipFetchRef = useRef(false); // Deprecated: handling state more explicitly now

  // Theme State
  const [theme, setTheme] = useState('dark');

  // Rename Logic
  const [editingThreadId, setEditingThreadId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [searchStatus, setSearchStatus] = useState('');

  // Space State
  const [spaces, setSpaces] = useState([]);
  const [activeSpaceId, setActiveSpaceId] = useState('default'); // 'default' or UUID
  const [isSpaceModalOpen, setIsSpaceModalOpen] = useState(false);
  const [newSpaceData, setNewSpaceData] = useState({ name: '', system_prompt: '' });
  const [editingSpaceId, setEditingSpaceId] = useState(null);

  // API Key State
  const [apiKeys, setApiKeys] = useState([]);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');

  // Search/Deep Research State
  const [isDeepResearch, setIsDeepResearch] = useState(false);
  const [showSourcesSidebar, setShowSourcesSidebar] = useState(false);
  const [sidebarSources, setSidebarSources] = useState([]);
  const [generatedQueries, setGeneratedQueries] = useState([]); // Multi-query flow


  const messagesEndRef = useRef(null);

  useEffect(() => {
    fetchSpaces();
    fetchThreads();
    // Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      setTheme('light');
    }
  }, []);

  // Fetch threads when active space changes
  useEffect(() => {
    fetchThreads();
    setActiveThreadId(null);
    setMessages([]);
  }, [activeSpaceId]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // Load messages when active thread changes
  useEffect(() => {
    if (activeThreadId) {
      // Only fetch if we don't have messages yet.
      // This prevents handleSearch from being overwritten by an empty/partial fetch
      // right after a new thread is created.
      if (messages.length === 0) {
        fetchMessages(activeThreadId);
      }
      if (window.innerWidth < 768) setIsSidebarOpen(false);
    } else {
      setMessages([]);
    }
  }, [activeThreadId]);

  useEffect(() => {
    const wrapper = document.querySelector('.content-wrapper');
    if (!wrapper) return;

    // Threshold: Is the user within 200px of the bottom?
    const isAtBottom = wrapper.scrollHeight - wrapper.scrollTop <= wrapper.clientHeight + 200;

    // Auto-scroll ONLY if we are already at the bottom
    if (isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isSearching]);

  // Handle initial scroll when a new search starts
  useEffect(() => {
    if (isSearching) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isSearching]);

  const fetchThreads = async () => {
    try {
      let query = supabase
        .from('conversations')
        .select('*')
        .order('updated_at', { ascending: false });

      if (activeSpaceId === 'default') {
        query = query.is('space_id', null);
      } else {
        query = query.eq('space_id', activeSpaceId);
      }

      const { data, error } = await query;
      if (error) throw error;
      setThreads(data || []);
    } catch (err) {
      console.error("Failed to fetch threads", err.message);
    }
  };

  const fetchSpaces = async () => {
    try {
      const { data, error } = await supabase
        .from('spaces')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSpaces(data || []);
    } catch (err) {
      console.error("Failed to fetch spaces", err.message);
    }
  };

  const handleCreateSpace = async () => {
    if (!newSpaceData.name.trim()) return;
    try {
      if (editingSpaceId) {
        await supabase
          .from('spaces')
          .update(newSpaceData)
          .eq('id', editingSpaceId);
      } else {
        await supabase
          .from('spaces')
          .insert(newSpaceData);
      }
      setNewSpaceData({ name: '', system_prompt: '' });
      setIsSpaceModalOpen(false);
      setEditingSpaceId(null);
      fetchSpaces();
    } catch (err) {
      console.error("Failed to save space", err);
    }
  };

  const handleDeleteSpace = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm("Delete this space and all its chats?")) return;
    try {
      await supabase
        .from('spaces')
        .delete()
        .eq('id', id);
      if (activeSpaceId === id) setActiveSpaceId('default');
      fetchSpaces();
    } catch (err) {
      console.error("Failed to delete space", err);
    }
  };

  const fetchApiKeys = async () => {
    try {
      const { data, error } = await supabase
        .from('api_keys')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setApiKeys(data || []);
    } catch (err) {
      console.error("Failed to fetch API keys", err);
    }
  };

  const createApiKey = async () => {
    if (!newKeyName.trim()) return;
    const { nanoid } = await import('https://esm.sh/nanoid');
    const newKey = `pk-${nanoid()}`;
    try {
      await supabase
        .from('api_keys')
        .insert({ name: newKeyName, key: newKey });
      setNewKeyName('');
      fetchApiKeys();
    } catch (err) {
      console.error("Failed to create API key", err);
    }
  };

  const deleteApiKey = async (id) => {
    if (!window.confirm("Delete this API key? This will break any apps using it.")) return;
    try {
      await supabase
        .from('api_keys')
        .delete()
        .eq('id', id);
      fetchApiKeys();
    } catch (err) {
      console.error("Failed to delete API key", err);
    }
  };

  const fetchMessages = async (threadId) => {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', threadId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setMessages(data || []);
    } catch (err) {
      console.error("Failed to fetch messages", err);
    }
  };

  const createNewThread = async (firstQuery) => {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .insert({
          title: firstQuery,
          space_id: activeSpaceId === 'default' ? null : activeSpaceId
        })
        .select()
        .single();
      if (error) throw error;
      setThreads(prev => [data, ...prev]);
      return data.id;
    } catch (err) {
      console.error("Failed to create thread", err);
      return null;
    }
  };

  const handleRenameThread = async (e, threadId) => {
    e.stopPropagation();
    if (!editTitle.trim()) {
      setEditingThreadId(null);
      return;
    }

    const oldThreads = [...threads];
    setThreads(prev => prev.map(t => t.id === threadId ? { ...t, title: editTitle } : t));
    setEditingThreadId(null);

    try {
      await supabase
        .from('conversations')
        .update({ title: editTitle })
        .eq('id', threadId);
    } catch (err) {
      console.error("Failed to rename thread", err);
      setThreads(oldThreads);
    }
  };

  const handleDeleteThread = async (e, threadId) => {
    e.stopPropagation();
    if (!window.confirm("Delete this chat?")) return;

    const oldThreads = [...threads];
    setThreads(prev => prev.filter(t => t.id !== threadId));
    if (activeThreadId === threadId) {
      setActiveThreadId(null);
      setMessages([]);
    }

    try {
      await supabase
        .from('conversations')
        .delete()
        .eq('id', threadId);
    } catch (err) {
      console.error("Failed to delete thread", err);
      setThreads(oldThreads);
    }
  };

  const saveMessage = async (threadId, role, content, searchResults = null) => {
    try {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: threadId,
          role,
          content,
          search_results: searchResults
        })
        .select()
        .single();

      if (error) throw error;

      // Update timestamp
      await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', threadId);

      return data;
    } catch (err) {
      console.error("Failed to save message", err);
    }
  };

  const updateThreadTitle = async (threadId, newTitle) => {
    try {
      await supabase
        .from('conversations')
        .update({ title: newTitle })
        .eq('id', threadId);
      setThreads(prev => prev.map(t => t.id === threadId ? { ...t, title: newTitle } : t));
    } catch (err) {
      console.error("Failed to update thread title auto", err);
    }
  };

  const generateSmartTitle = async (query, answer) => {
    let title = query;
    if (title.length > 30) title = title.substring(0, 30) + '...';
    return title;
  };

  const handleSearch = async (e, customQuery = null) => {
    if (e) e.preventDefault();
    const searchQuery = customQuery || query;
    if (!searchQuery.trim()) return;

    const tempUserMsgId = 'user-' + Date.now();
    const userMsg = { role: 'user', content: searchQuery, id: tempUserMsgId };

    const tempAiMsgId = 'ai-temp-' + Date.now();
    const tempAiMsg = {
      role: 'assistant',
      content: '',
      id: tempAiMsgId,
      isLoading: true
    };

    setMessages(prev => [...prev, userMsg, tempAiMsg]);
    setQuery('');
    setIsSearching(true);
    setGeneratedQueries([]);

    let currentThreadId = activeThreadId;

    try {
      let isNewThread = false;
      if (!currentThreadId) {
        currentThreadId = await createNewThread(searchQuery);
        if (currentThreadId) {
          setActiveThreadId(currentThreadId);
          isNewThread = true;
        }
      } else {
        await saveMessage(currentThreadId, 'user', searchQuery);
      }

      setSearchStatus('Generating search paths...');
      const queryCount = isDeepResearch ? 8 : 3;
      const frontQueries = await generateSearchQueries(searchQuery, queryCount);
      setGeneratedQueries(frontQueries);

      setSearchStatus(`Searching ${frontQueries.length} paths...`);

      setSearchStatus('Planning strategy...');
      const currentSpace = spaces.find(s => s.id === activeSpaceId);

      const { data, error } = await supabase.functions.invoke('monolith-chat', {
        body: {
          query: searchQuery,
          queries: frontQueries,
          history: messages.map(m => ({ role: m.role, content: m.content })),
          deep: isDeepResearch,
          space_id: activeSpaceId,
          custom_prompt: currentSpace?.system_prompt
        }
      });

      if (error) throw error;

      setMessages(prev => prev.map(msg => {
        if (msg.id === tempAiMsgId) {
          return {
            role: 'assistant',
            content: data.answer,
            id: 'ai-' + Date.now(),
            search_results: data.sources,
            all_sources: data.all_sources,
            search_queries: data.search_queries,
            isLoading: false
          };
        }
        return msg;
      }));

      await saveMessage(currentThreadId, 'assistant', data.answer, data.sources);

      if (isNewThread) {
        const smartTitle = await generateSmartTitle(searchQuery, data.answer);
        await updateThreadTitle(currentThreadId, smartTitle);
      }

    } catch (err) {
      console.error("Search error", err);
      setMessages(prev => prev.map(msg => {
        if (msg.id === tempAiMsgId) {
          return {
            role: 'assistant',
            content: `Error: ${err.message || 'The search engine is currently unavailable.'}`,
            id: 'error-' + Date.now(),
            isLoading: false
          };
        }
        return msg;
      }));
    } finally {
      setIsSearching(false);
      setSearchStatus('');
    }
  };

  const [allSourcesForSidebar, setAllSourcesForSidebar] = useState([]); // All searched sources
  const [sourceViewMode, setSourceViewMode] = useState('used'); // 'used' or 'all'

  const openSources = (usedSources, allSources = []) => {
    setSidebarSources(usedSources);
    setAllSourcesForSidebar(allSources);
    setSourceViewMode('used');
    setShowSourcesSidebar(true);
  };

  const renderConversation = () => {
    const packs = [];
    let currentPack = {};

    messages.forEach(msg => {
      if (msg.role === 'user') {
        if (currentPack.user) packs.push(currentPack);
        currentPack = { user: msg.content, id: msg.id };
      } else if (msg.role === 'assistant') {
        currentPack.ai = msg.content;
        currentPack.sources = msg.search_results ? (typeof msg.search_results === 'string' ? JSON.parse(msg.search_results) : msg.search_results) : [];
        currentPack.allSources = msg.all_sources || []; // ALL sources searched
        currentPack.searchQueries = msg.search_queries || [];
        currentPack.isLoading = msg.isLoading;
        packs.push(currentPack);
        currentPack = {};
      }
    });
    if (currentPack.user) packs.push(currentPack);

    return packs.map((pack, idx) => (
      <div key={idx} className="results-container">
        <motion.header
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="results-header"
        >
          {pack.user && (
            <>
              <div className="section-label">
                <Globe size={14} className="section-icon" /> Query
              </div>
              <h2 className="results-query">{pack.user}</h2>
            </>
          )}
        </motion.header>

        {(pack.ai !== undefined || pack.isLoading) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="mb-6"
          >
            {/* Show search status and generated queries while loading */}
            {pack.isLoading && (
              <div className="search-status-container">
                <div className="search-status-text">
                  <Search size={14} className="animate-pulse" />
                  <span>{searchStatus || 'Thinking...'}</span>
                </div>
                {generatedQueries.length > 0 && (
                  <div className="generated-queries">
                    {generatedQueries.map((q, i) => (
                      <motion.span
                        key={i}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: i * 0.1 }}
                        className="query-pill"
                      >
                        {q}
                      </motion.span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="section-label">
              <Sparkles size={14} className="section-icon" /> {pack.isLoading ? 'Searching...' : 'Intelligent Answer'}
            </div>

            {pack.isLoading ? (
              <div className="skeleton" style={{ height: '100px', width: '100%' }} />
            ) : (
              <div className="answer-content markdown-body">
                {pack.ai ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{pack.ai}</ReactMarkdown>
                ) : (
                  <span className="blinking-cursor">▍</span>
                )}
              </div>
            )}

            {/* View Sources Button - Shows used sources + total searched */}
            {!pack.isLoading && pack.sources && pack.sources.length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="sources-buttons-row"
              >
                <button
                  className="view-sources-btn"
                  onClick={() => openSources(pack.sources, pack.allSources)}
                >
                  <BookOpen size={16} />
                  <span>View {pack.sources.length} Sources</span>
                  {pack.allSources && pack.allSources.length > pack.sources.length && (
                    <span className="sources-total-badge">
                      of {pack.allSources.length} searched
                    </span>
                  )}
                </button>
              </motion.div>
            )}
          </motion.div>
        )}
      </div>
    ));
  };

  return (
    <div className="app-container">
      {/* Mobile Top Bar */}
      <div className="mobile-header">
        <button onClick={() => setIsSidebarOpen(true)} className="mobile-menu-btn">
          <Menu size={20} />
        </button>
        <div className="mobile-brand">monolith</div>
        <button onClick={() => { setActiveThreadId(null); if (window.innerWidth < 768) setIsSidebarOpen(false); }} className="mobile-new-chat">
          <Plus size={20} />
        </button>
      </div>

      {/* Mobile Backdrop Overlay */}
      <AnimatePresence>
        {isSidebarOpen && window.innerWidth < 768 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mobile-sidebar-backdrop"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      <aside className={`sidebar ${!isSidebarOpen ? 'collapsed' : ''} ${isSidebarOpen ? 'mobile-open' : ''}`}>
        {/* Mobile Sidebar Close Button */}
        <button className="mobile-close-sidebar" onClick={() => setIsSidebarOpen(false)}>
          <X size={20} />
        </button>

        <div className="brand-icon-row">
          <div className="brand-icon" onClick={() => { setActiveThreadId(null); if (window.innerWidth < 768) setIsSidebarOpen(false); }} title="New Chat">
            <Plus size={24} />
          </div>
          <button className="toggle-sidebar-btn" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
            <Menu size={20} />
          </button>
        </div>

        {isSidebarOpen && (
          <nav className="nav-menu">
            {/* Spaces Section */}
            <div className="nav-section-title">
              <span>Spaces</span>
              <button
                onClick={() => { setEditingSpaceId(null); setNewSpaceData({ name: '', system_prompt: '' }); setIsSpaceModalOpen(true); }}
                title="Create New Space"
              >
                <PlusCircle size={16} />
              </button>
            </div>
            <div className="spaces-list mb-4">
              <div
                className={`nav-item ${activeSpaceId === 'default' ? 'active' : ''}`}
                onClick={() => setActiveSpaceId('default')}
              >
                <Layers size={16} className="shrink-0" />
                <span className="nav-text">monolith</span>
              </div>
              {spaces.map(space => (
                <div
                  key={space.id}
                  className={`nav-item group ${activeSpaceId === space.id ? 'active' : ''}`}
                  onClick={() => { setActiveSpaceId(space.id); if (window.innerWidth < 768) setIsSidebarOpen(false); }}
                >
                  <Layers size={16} className="shrink-0" />
                  <span className="nav-text">{space.name}</span>
                  <div className="nav-item-actions opacity-0 group-hover:opacity-100 flex gap-1">
                    <button className="action-btn" onClick={(e) => {
                      e.stopPropagation();
                      setEditingSpaceId(space.id);
                      setNewSpaceData({ name: space.name, system_prompt: space.system_prompt });
                      setIsSpaceModalOpen(true);
                    }}>
                      <Edit2 size={12} />
                    </button>
                    <button className="action-btn delete" onClick={(e) => handleDeleteSpace(e, space.id)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="nav-section-title">History</div>
            <div className="threads-list">
              {threads.map(thread => (
                <div
                  key={thread.id}
                  className={`nav-item ${activeThreadId === thread.id ? 'active' : ''}`}
                  onClick={() => {
                    if (editingThreadId !== thread.id && activeThreadId !== thread.id) {
                      setMessages([]); // Clear immediately
                      setActiveThreadId(thread.id);
                    }
                    if (window.innerWidth < 768) setIsSidebarOpen(false);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <MessageSquare size={16} className="shrink-0" />

                  {editingThreadId === thread.id ? (
                    <div className="flex flex-1 items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        autoFocus
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleRenameThread(e, thread.id)}
                        className="nav-edit-input"
                      />
                      <button className="action-btn" onClick={(e) => handleRenameThread(e, thread.id)}><Check size={14} /></button>
                      <button className="action-btn" onClick={(e) => { e.stopPropagation(); setEditingThreadId(null); }}><X size={14} /></button>
                    </div>
                  ) : (
                    <>
                      <span className="nav-text">{thread.title}</span>
                      <div className={`nav-item-actions ${editingThreadId === thread.id ? 'active' : ''}`}>
                        <button className="action-btn" onClick={(e) => startEditing(e, thread)} title="Rename">
                          <Edit2 size={12} />
                        </button>
                        <button className="action-btn delete"
                          onMouseDown={(e) => { e.stopPropagation(); }}
                          onClick={(e) => { e.stopPropagation(); handleDeleteThread(e, thread.id); }}
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </nav>
        )}

        <div className="sidebar-footer">
          <button className="nav-item w-full" onClick={() => { fetchApiKeys(); setIsApiKeyModalOpen(true); }} title="Manage API Keys">
            <Settings size={20} />
            {isSidebarOpen && <span className="nav-text">API Settings</span>}
          </button>
          <button className="theme-toggle-btn" onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            {isSidebarOpen && <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        <div className="content-wrapper">
          <AnimatePresence mode="wait">
            {!activeThreadId && messages.length === 0 && !isSearching ? (
              // Landing View
              <motion.div
                key="landing"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="landing-view"
              >
                <div className="brand-label">monolith</div>
                <h1 className="hero-title">
                  Unlock the <span className="highlight">future</span><br />of search.
                </h1>

                <div className="search-container">
                  <form onSubmit={handleSearch} className="search-wrapper">
                    <button
                      type="button"
                      className={`deep-research-btn ${isDeepResearch ? 'active' : ''}`}
                      onClick={() => setIsDeepResearch(!isDeepResearch)}
                      title="Deep Research Mode"
                    >
                      <Sparkles size={14} className="sparkle-icon" />
                      Deep Research
                    </button>
                    <input
                      type="text"
                      className="search-input"
                      placeholder="Ask anything..."
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <button type="submit" className="search-submit">
                      <ChevronRight size={24} />
                    </button>
                  </form>
                </div>

                <div className="quick-tags">
                  {['Latest Tech', 'World News', 'Science'].map(tag => (
                    <button
                      key={tag}
                      className="tag-btn"
                      onClick={() => { setQuery(tag); handleSearch(null, tag); }}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </motion.div>
            ) : (
              // Results View (Conversation Mode)
              <div className="flex flex-col gap-12 pb-32 relative">
                <div className="space-sticky-label">
                  <Layers size={12} className="shrink-0" />
                  <span>{activeSpaceId === 'default' ? 'monolith' : spaces.find(s => s.id === activeSpaceId)?.name || 'monolith'}</span>
                </div>
                {/* Render Conversation logic handles the loading state now */}
                {renderConversation()}
                <div className="chat-bottom-spacer" />
                <div ref={messagesEndRef} />
              </div>
            )}
          </AnimatePresence>
        </div>

        {/* Sources Sidebar Overlay */}
        <AnimatePresence>
          {showSourcesSidebar && (
            <>
              <motion.div
                className="sidebar-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowSourcesSidebar(false)}
              />
              <motion.div
                className="sources-sidebar"
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
              >
                <div className="sources-sidebar-header">
                  <div className="flex items-center gap-2">
                    <Library size={18} className="text-[var(--accent-primary)]" />
                    <h3 className="font-bold">Sources</h3>
                  </div>
                  <button onClick={() => setShowSourcesSidebar(false)} className="close-sidebar-btn">
                    <X size={20} />
                  </button>
                </div>

                {/* Toggle between Used and All sources */}
                {allSourcesForSidebar.length > 0 && allSourcesForSidebar.length > sidebarSources.length && (
                  <div className="sources-toggle-container">
                    <button
                      className={`sources-toggle-btn ${sourceViewMode === 'used' ? 'active' : ''}`}
                      onClick={() => setSourceViewMode('used')}
                    >
                      Used by AI ({sidebarSources.length})
                    </button>
                    <button
                      className={`sources-toggle-btn ${sourceViewMode === 'all' ? 'active' : ''}`}
                      onClick={() => setSourceViewMode('all')}
                    >
                      All Searched ({allSourcesForSidebar.length})
                    </button>
                  </div>
                )}

                <div className="sources-sidebar-content">
                  {(sourceViewMode === 'used' ? sidebarSources : allSourcesForSidebar).map((source, idx) => (
                    <a
                      key={idx}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="source-card sidebar-card"
                    >
                      <div className="source-header">
                        <img
                          src={`https://www.google.com/s2/favicons?sz=64&domain=${new URL(source.url).hostname}`}
                          className="source-favicon"
                          alt=""
                          onError={(e) => e.target.style.display = 'none'}
                        />
                        <span className="source-domain">{new URL(source.url).hostname}</span>
                        {sourceViewMode === 'used' && source.relevance_score && (
                          <span className="relevance-badge">
                            {Math.round(source.relevance_score * 100)}% match
                          </span>
                        )}
                      </div>
                      <h3 className="source-title">{source.name}</h3>
                      <p className="source-snippet">{source.snippet}</p>
                    </a>
                  ))}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Global Loader (Polygon) */}


        {/* Follow-up Bar */}
        {(activeThreadId || messages.length > 0) && (
          <div className="follow-up-bar">
            <form onSubmit={handleSearch} className="search-wrapper">
              <button
                type="button"
                className={`deep-research-btn ${isDeepResearch ? 'active' : ''}`}
                onClick={() => setIsDeepResearch(!isDeepResearch)}
                title="Deep Research Mode"
              >
                <Sparkles size={14} className="sparkle-icon" />
                Deep Research
              </button>
              <input
                type="text"
                className="search-input"
                placeholder="Ask a follow-up..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button type="submit" className="search-submit">
                <ChevronRight size={24} />
              </button>
            </form>
          </div>
        )}
      </main>

      {/* Space Creation Modal */}
      <AnimatePresence>
        {isSpaceModalOpen && (
          <div className="modal-overlay">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="modal-content"
            >
              <div className="modal-header">
                <h3>{editingSpaceId ? 'Edit Space' : 'Create New Space'}</h3>
                <button onClick={() => setIsSpaceModalOpen(false)}><X size={20} /></button>
              </div>
              <div className="modal-body">
                <div className="input-group">
                  <label>Space Name</label>
                  <input
                    placeholder="e.g. Legal Research, Coding Sidekick..."
                    value={newSpaceData.name}
                    onChange={(e) => setNewSpaceData({ ...newSpaceData, name: e.target.value })}
                  />
                </div>
                <div className="input-group">
                  <label>System Prompt (The space's "Personality")</label>
                  <textarea
                    placeholder="e.g. You are a legal expert... Always focus on case law..."
                    rows={5}
                    value={newSpaceData.system_prompt}
                    onChange={(e) => setNewSpaceData({ ...newSpaceData, system_prompt: e.target.value })}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn-secondary" onClick={() => setIsSpaceModalOpen(false)}>Cancel</button>
                <button className="btn-primary" onClick={handleCreateSpace}>
                  {editingSpaceId ? 'Update Space' : 'Create Space'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* API Key Modal */}
      <AnimatePresence>
        {isApiKeyModalOpen && (
          <div className="modal-overlay">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="modal-content max-w-2xl"
            >
              <div className="modal-header">
                <h3>API Management</h3>
                <button onClick={() => setIsApiKeyModalOpen(false)}><X size={20} /></button>
              </div>
              <div className="modal-body">
                <p className="text-secondary text-sm mb-6">
                  Use your own Perplexity-like API in external applications. All requests use your internal search & AI pool.
                </p>

                <div className="flex gap-2 mb-8">
                  <input
                    placeholder="Key name (e.g. My Website)"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    className="flex-1"
                  />
                  <button className="btn-primary whitespace-nowrap" onClick={createApiKey}>Generate New Key</button>
                </div>

                <div className="api-keys-list" style={{ maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {apiKeys.map(key => (
                    <div key={key.id} className="p-4 rounded-xl" style={{ background: 'var(--bg-main)', border: '1px solid var(--border)' }}>
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h4 className="font-bold text-sm">{key.name}</h4>
                          <p className="text-[10px] text-muted">Created: {new Date(key.created_at).toLocaleDateString()}</p>
                        </div>
                        <button className="text-red-500 hover:text-red-400" onClick={() => deleteApiKey(key.id)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="flex gap-2 items-center">
                        <code className="text-xs flex-1 rounded p-2 overflow-x-auto" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
                          {key.key}
                        </code>
                        <button
                          className="btn-secondary text-xs py-1"
                          onClick={() => {
                            navigator.clipboard.writeText(key.key);
                            alert("API Key copied to clipboard!");
                          }}
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  ))}
                  {apiKeys.length === 0 && (
                    <div className="text-center py-8 text-muted italic">
                      No API keys generated yet.
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
