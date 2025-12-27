import React, { useMemo, useState, useRef } from 'react';
import { MessageSquarePlus, Image, FileText, Search, PanelLeftClose, Trash2, ChevronRight, Pin, Plus, MoreVertical, Edit2, FolderInput, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Popover } from './ui/Popover';
import { Dialog } from './ui/Dialog';
import { AccountDialog } from './dialogs/AccountDialog';
import { StorageService } from '../services/StorageService';
import type { Conversation } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import { SessionManager } from '../lib/controllers/SessionManager';
import { AuthService } from '../services/AuthService';

interface SidebarProps {
  activeView: 'chat' | 'image';
  setActiveView: (view: 'chat' | 'image') => void;

  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeView, setActiveView, onNewChat, onSelectConversation, onCollapse }) => {
  // Connect to SessionManager for current selection
  const [sessionState, setSessionState] = useState(SessionManager.getInstance().getState());
  
  // Subscribe to SessionManager
  React.useEffect(() => {
      return SessionManager.getInstance().subscribe(setSessionState);
  }, []);

  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(AuthService.isSignedIn());
  const [googleProfile, setGoogleProfile] = useState(AuthService.getGoogleProfile());

  React.useEffect(() => {
      const update = () => {
          setIsSignedIn(AuthService.isSignedIn());
          setGoogleProfile(AuthService.getGoogleProfile());
      };

      update();

      const onAuthChanged = () => update();
      window.addEventListener('everytalk-auth-changed', onAuthChanged);
      return () => window.removeEventListener('everytalk-auth-changed', onAuthChanged);
  }, []);

  // Fetch conversations from DB
  const conversations = useLiveQuery(() => StorageService.getAllConversations(activeView === 'chat' ? 'TEXT' : 'IMAGE'), [activeView]);
  const groups = useLiveQuery(() => StorageService.getAllGroups(), []);
  
  const pinnedConversations = conversations?.filter(c => c.isPinned) || [];
  const recentConversations = conversations?.filter(c => !c.isPinned) || [];

  const conversationMap = useMemo(() => {
      return new Map((conversations || []).map(c => [c.id, c] as const));
  }, [conversations]);

  const conversationToGroupId = useMemo(() => {
      const map: Record<string, string> = {};
      for (const g of groups || []) {
          for (const cid of g.conversationIds || []) {
              map[cid] = g.id;
          }
      }
      return map;
  }, [groups]);

  const ungroupedRecentConversations = useMemo(() => {
      return recentConversations.filter(c => !conversationToGroupId[c.id]);
  }, [recentConversations, conversationToGroupId]);

  const [isGroupExpanded, setIsGroupExpanded] = useState(false);
  const [isPinnedExpanded, setIsPinnedExpanded] = useState(false);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Record<string, boolean>>({});

  React.useEffect(() => {
      try {
          const raw = localStorage.getItem('everytalk.sidebar.expandedGroupIds');
          if (!raw) return;
          const ids = JSON.parse(raw);
          if (!Array.isArray(ids)) return;

          const next: Record<string, boolean> = {};
          for (const id of ids) {
              if (typeof id === 'string') next[id] = true;
          }
          setExpandedGroupIds(next);
      } catch {
          // ignore
      }
  }, []);

  React.useEffect(() => {
      try {
          const ids = Object.entries(expandedGroupIds)
              .filter(([, v]) => !!v)
              .map(([k]) => k);
          localStorage.setItem('everytalk.sidebar.expandedGroupIds', JSON.stringify(ids));
      } catch {
          // ignore
      }
  }, [expandedGroupIds]);
  
  // State for Rename
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  

  // State for Delete Confirm
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  // State for Group Select
  const [showGroupSelect, setShowGroupSelect] = useState<string | null>(null);
  const [showCreateGroupDialog, setShowCreateGroupDialog] = useState(false);
  const [groupNameValue, setGroupNameValue] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [showDeleteGroupConfirm, setShowDeleteGroupConfirm] = useState<string | null>(null);
  const [pendingAssignConversationId, setPendingAssignConversationId] = useState<string | null>(null);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);

  // State for Search
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const searchResults = useMemo(() => {
      if (!searchQuery.trim()) return [];
      return (conversations || []).filter(c =>
          (c.title || 'New Chat').toLowerCase().includes(searchQuery.toLowerCase())
      ).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [conversations, searchQuery]);

  React.useEffect(() => {
      if (isSearchMode && searchInputRef.current) {
          searchInputRef.current.focus();
      }
  }, [isSearchMode]);

  React.useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
          if (isSearchMode &&
              searchInputRef.current &&
              !searchInputRef.current.contains(e.target as Node) &&
              !(e.target as HTMLElement).closest('.search-container')) {
              setIsSearchMode(false);
              setSearchQuery('');
          }
      };

      if (isSearchMode) {
          document.addEventListener('mousedown', handleClickOutside);
      }
      return () => {
          document.removeEventListener('mousedown', handleClickOutside);
      };
  }, [isSearchMode]);

  return (
    <>
    <div className="w-[260px] h-screen bg-black border-r border-white/10 flex flex-col py-4 px-3 font-sans">
      <style>{`
        .scrollbar-none::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-none {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
      <div className="flex items-center justify-between mb-6 px-2">
        <h1 className="text-xl font-bold tracking-tight text-white">EveryTalk</h1>
        <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            className="text-gray-500 hover:text-white transition-colors"
            onClick={onCollapse}
        >
          <PanelLeftClose size={20} strokeWidth={1.5} />
        </motion.button>
      </div>

      <nav className="space-y-1 mb-2">
        {/* 动态按钮 1: 新建当前模式的会话 */}
        <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={async () => {
                const type = activeView === 'chat' ? 'TEXT' : 'IMAGE';
                await SessionManager.getInstance().createNewChat(type);
                onNewChat();
            }}
            className="flex items-center space-x-3 text-gray-400 hover:text-white hover:bg-white/5 w-full px-3 py-2.5 rounded-lg transition-all duration-200 group hover:shadow-[0_0_15px_rgba(255,255,255,0.05)]"
        >
          <MessageSquarePlus size={18} strokeWidth={2} className="group-hover:text-white group-hover:scale-110 transition-transform duration-200" />
          <span className="text-sm font-medium">
            {activeView === 'chat' ? '新建会话' : '新建图像生成'}
          </span>
        </motion.button>

        <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowClearAllConfirm(true)}
            className="flex items-center space-x-3 text-gray-400 hover:text-red-400 hover:bg-red-500/10 w-full px-3 py-2.5 rounded-lg transition-all duration-200 group hover:shadow-[0_0_15px_rgba(255,255,255,0.05)]"
        >
          <Trash2 size={18} strokeWidth={2} className="group-hover:text-red-400 group-hover:scale-110 transition-transform duration-200" />
          <span className="text-sm font-medium">清空记录</span>
        </motion.button>

        {/* 动态按钮 2: 切换到另一种模式 */}
        <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
                const newMode = activeView === 'chat' ? 'IMAGE' : 'TEXT';
                SessionManager.getInstance().switchMode(newMode);
                setActiveView(activeView === 'chat' ? 'image' : 'chat');
            }}
            className="flex items-center space-x-3 text-gray-400 hover:text-white hover:bg-white/5 w-full px-3 py-2.5 rounded-lg transition-all duration-200 group hover:shadow-[0_0_15px_rgba(255,255,255,0.05)]"
        >
          {activeView === 'chat' ? (
            <Image size={18} strokeWidth={2} className="group-hover:text-white group-hover:scale-110 transition-transform duration-200" />
          ) : (
            <FileText size={18} strokeWidth={2} className="group-hover:text-white group-hover:scale-110 transition-transform duration-200" />
          )}
          <span className="text-sm font-medium">
            {activeView === 'chat' ? '图像生成' : '文本生成'}
          </span>
        </motion.button>

        <div className="relative h-[42px]">
        <AnimatePresence mode='popLayout'>
            {!isSearchMode ? (
              <motion.button
                  key="search-btn"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                  layout
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setIsSearchMode(true)}
                  className="absolute inset-0 flex items-center space-x-3 text-gray-400 hover:text-white hover:bg-white/5 w-full px-3 rounded-lg transition-all duration-200 group hover:shadow-[0_0_15px_rgba(255,255,255,0.05)]"
              >
                <Search size={18} strokeWidth={2} className="group-hover:text-white group-hover:scale-110 transition-transform duration-200" />
                <span className="text-sm font-medium">搜索历史记录</span>
              </motion.button>
            ) : (
              <motion.div
                key="search-input"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.2 }}
                layout
                className="absolute inset-0 px-2 py-0.5 search-container flex items-center"
              >
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索..."
                    className="w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded-lg pl-9 pr-8 py-2 focus:outline-none focus:border-emerald-500 transition-colors"
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setIsSearchMode(false);
                        setSearchQuery('');
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      setIsSearchMode(false);
                      setSearchQuery('');
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              </motion.div>
            )}
        </AnimatePresence>
        </div>
      </nav>

      <div className="flex-1 overflow-y-auto scrollbar-none relative">
        <AnimatePresence mode="popLayout">
          {isSearchMode && searchQuery ? (
            <motion.div
                key="search-results"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="space-y-1 pt-2 absolute inset-0"
            >
                <div className="px-2 py-1 mb-1">
                    <span className="text-gray-500 font-bold text-xs uppercase tracking-wider">搜索结果 ({searchResults.length})</span>
                </div>
                {searchResults.map(item => (
                    <HistoryItem
                        key={item.id}
                        item={item}
                        isEditing={editingId === item.id}
                        editValue={editValue}
                        onEditChange={setEditValue}
                        onEditConfirm={async () => {
                            if (editingId && editValue.trim()) {
                                await StorageService.updateConversation(editingId, { title: editValue.trim() });
                            }
                            setEditingId(null);
                        }}
                        onEditCancel={() => setEditingId(null)}
                        isSelected={sessionState.currentConversationId === item.id}
                        onSelect={() => {
                            onSelectConversation(item.id);
                            SessionManager.getInstance().loadConversation(item.id);
                        }}
                        onMenuAction={async (action) => {
                            if (action === 'rename') {
                                setEditingId(item.id);
                                setEditValue(item.title || '');
                            } else if (action === 'delete') {
                                setShowDeleteConfirm(item.id);
                            } else if (action === 'group') {
                                setShowGroupSelect(item.id);
                            } else if (action === 'pin') {
                                await StorageService.updateConversation(item.id, { isPinned: !item.isPinned });
                            }
                        }}
                    />
                ))}
                {searchResults.length === 0 && (
                    <div className="px-4 py-8 text-center text-gray-500 text-sm">
                        未找到相关会话
                    </div>
                )}
            </motion.div>
          ) : (
            <motion.div
                key="normal-list"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
                className="space-y-4 pt-2 absolute inset-0"
            >
        
        {/* 分组 Section */}
        <div>
            <div className="flex items-center justify-between px-2 py-1 mb-1 group cursor-pointer hover:bg-white/5 rounded-md" onClick={() => setIsGroupExpanded(!isGroupExpanded)}>
                <div className="flex items-center space-x-2">
                    <span className="text-gray-500 font-bold text-xs uppercase tracking-wider">分组</span>
                </div>
                <div className="flex items-center space-x-1">
                    <button
                        className="p-1 text-gray-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                            e.stopPropagation();
                            setEditingGroupId(null);
                            setGroupNameValue('');
                            setPendingAssignConversationId(null);
                            setShowCreateGroupDialog(true);
                        }}
                    >
                        <Plus size={14} />
                    </button>
                    <motion.div
                        animate={{ rotate: isGroupExpanded ? 90 : 0 }}
                        transition={{ duration: 0.2 }}
                    >
                        <ChevronRight size={14} className="text-gray-500" />
                    </motion.div>
                </div>
            </div>
            
            <AnimatePresence>
                {isGroupExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden space-y-1 pl-2"
                    >
                        {(groups?.length || 0) === 0 ? (
                            <div className="px-3 py-2 text-sm text-gray-500 bg-white/5 rounded-lg text-center mx-2">
                                暂无分组
                            </div>
                        ) : (
                            <div className="space-y-1">
                                {(groups || []).map(g => {
                                    const groupExpanded = !!expandedGroupIds[g.id];
                                    const groupConversations = (g.conversationIds || [])
                                        .map(cid => conversationMap.get(cid))
                                        .filter((c): c is Conversation => !!c)
                                        ;

                                    return (
                                        <div key={g.id} className="space-y-1">
                                            <div
                                                className="flex items-center justify-between px-2 py-1 rounded-md hover:bg-white/5"
                                                onClick={() => {
                                                    setExpandedGroupIds(prev => ({
                                                        ...prev,
                                                        [g.id]: !prev[g.id]
                                                    }));
                                                }}
                                            >
                                                <div className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                                                    <motion.div
                                                        animate={{ rotate: groupExpanded ? 90 : 0 }}
                                                        transition={{ duration: 0.2 }}
                                                        className="flex-shrink-0"
                                                    >
                                                        <ChevronRight size={12} className="text-gray-500" />
                                                    </motion.div>
                                                    <span className="text-sm text-gray-300 truncate">{g.name}</span>
                                                    <span className="text-xs text-gray-600 flex-shrink-0">{groupConversations.length}</span>
                                                </div>

                                                <div className="flex items-center gap-1 flex-shrink-0">
                                                    <GroupActions
                                                        onRename={() => {
                                                            setEditingGroupId(g.id);
                                                            setGroupNameValue(g.name);
                                                            setShowCreateGroupDialog(true);
                                                        }}
                                                        onDelete={() => setShowDeleteGroupConfirm(g.id)}
                                                    />
                                                </div>
                                            </div>

                                            <AnimatePresence>
                                                {groupExpanded && (
                                                    <motion.div
                                                        initial={{ height: 0, opacity: 0 }}
                                                        animate={{ height: "auto", opacity: 1 }}
                                                        exit={{ height: 0, opacity: 0 }}
                                                        transition={{ duration: 0.2 }}
                                                        className="overflow-hidden space-y-1 pl-2"
                                                    >
                                                        {groupConversations.length === 0 ? (
                                                            <div className="px-3 py-2 text-xs text-gray-600 bg-white/5 rounded-lg text-center mx-2">
                                                                空分组
                                                            </div>
                                                        ) : (
                                                            groupConversations.map(item => (
                                                                <HistoryItem
                                                                    key={item.id}
                                                                    item={item}
                                                                    isEditing={editingId === item.id}
                                                                    editValue={editValue}
                                                                    onEditChange={setEditValue}
                                                                    onEditConfirm={async () => {
                                                                        if (editingId && editValue.trim()) {
                                                                            await StorageService.updateConversation(editingId, { title: editValue.trim() });
                                                                        }
                                                                        setEditingId(null);
                                                                    }}
                                                                    onEditCancel={() => setEditingId(null)}
                                                                    isSelected={sessionState.currentConversationId === item.id}
                                                                    onSelect={() => {
                                                                        onSelectConversation(item.id);
                                                                        SessionManager.getInstance().loadConversation(item.id);
                                                                    }}
                                                                    onMenuAction={async (action) => {
                                                                        if (action === 'rename') {
                                                                            setEditingId(item.id);
                                                                            setEditValue(item.title || '');
                                                                        } else if (action === 'delete') {
                                                                            setShowDeleteConfirm(item.id);
                                                                        } else if (action === 'group') {
                                                                            setShowGroupSelect(item.id);
                                                                        } else if (action === 'pin') {
                                                                            await StorageService.updateConversation(item.id, { isPinned: !item.isPinned });
                                                                        }
                                                                    }}
                                                                />
                                                            ))
                                                        )}
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>

        {/* 会话 List */}
        <div>
            <div className="px-2 py-1 mb-1">
                <span className="text-gray-500 font-bold text-xs uppercase tracking-wider">会话</span>
            </div>

            <motion.div
                className="space-y-1"
                key={activeView} // Key change triggers re-animation
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
            >
                {/* Pinned */}
                {pinnedConversations.length > 0 && (
                <div className="mb-2">
                    <div
                        className="flex items-center space-x-2 px-3 py-2 bg-white/5 rounded-lg cursor-pointer hover:bg-white/10 transition-colors mb-1"
                        onClick={() => setIsPinnedExpanded(!isPinnedExpanded)}
                    >
                        <motion.div
                            animate={{ rotate: isPinnedExpanded ? 90 : 0 }}
                            transition={{ duration: 0.2 }}
                        >
                            <ChevronRight size={12} className="text-gray-400" />
                        </motion.div>
                        <span className="text-xs font-bold text-gray-300">已置顶</span>
                    </div>
                    <AnimatePresence mode='wait'>
                        {isPinnedExpanded && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="overflow-hidden space-y-1 pl-2"
                            >
                                {pinnedConversations.map(item => (
                                    <HistoryItem
                                        key={item.id}
                                        item={item}
                                        isEditing={editingId === item.id}
                                        editValue={editValue}
                                        onEditChange={setEditValue}
                                        onEditConfirm={async () => {
                                            if (editingId && editValue.trim()) {
                                                await StorageService.updateConversation(editingId, { title: editValue.trim() });
                                            }
                                            setEditingId(null);
                                        }}
                                        onEditCancel={() => setEditingId(null)}
                                        isSelected={sessionState.currentConversationId === item.id}
                                        onSelect={() => {
                                            onSelectConversation(item.id);
                                            SessionManager.getInstance().loadConversation(item.id);
                                        }}
                                        onMenuAction={async (action) => {
                                            if (action === 'rename') {
                                                setEditingId(item.id);
                                                setEditValue(item.title || '');
                                            } else if (action === 'delete') {
                                                setShowDeleteConfirm(item.id);
                                            } else if (action === 'group') {
                                                setShowGroupSelect(item.id);
                                            } else if (action === 'pin') {
                                                await StorageService.updateConversation(item.id, { isPinned: !item.isPinned });
                                            }
                                        }}
                                    />
                                ))}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
                )}

                {/* Normal History */}
                {ungroupedRecentConversations.map(item => (
                    <HistoryItem
                        key={item.id}
                        item={item}
                        isEditing={editingId === item.id}
                        editValue={editValue}
                        onEditChange={setEditValue}
                        onEditConfirm={async () => {
                            if (editingId && editValue.trim()) {
                                await StorageService.updateConversation(editingId, { title: editValue.trim() });
                            }
                            setEditingId(null);
                        }}
                        onEditCancel={() => setEditingId(null)}
                        isSelected={sessionState.currentConversationId === item.id}
                        onSelect={() => {
                            onSelectConversation(item.id);
                            SessionManager.getInstance().loadConversation(item.id);
                        }}
                        onMenuAction={async (action) => {
                            if (action === 'rename') {
                                setEditingId(item.id);
                                setEditValue(item.title || '');
                            } else if (action === 'delete') {
                                setShowDeleteConfirm(item.id);
                            } else if (action === 'group') {
                                setShowGroupSelect(item.id);
                            } else if (action === 'pin') {
                                await StorageService.updateConversation(item.id, { isPinned: !item.isPinned });
                            }
                        }}
                    />
                ))}
            </motion.div>
        </div>
    
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="pt-4 border-t border-white/10 space-y-1 mt-2 z-10 bg-black">
        <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setIsAccountOpen(true)}
            className="flex items-center space-x-3 text-gray-400 hover:text-white hover:bg-white/5 w-full px-3 py-2 rounded-lg transition-all duration-200 group"
        >
          {isSignedIn && googleProfile?.picture ? (
            <img
              src={googleProfile.picture}
              alt="avatar"
              className="h-6 w-6 rounded-full object-cover border border-white/10"
              referrerPolicy="no-referrer"
            />
          ) : null}
          <span className="text-sm font-medium truncate">
            {googleProfile?.name || (isSignedIn ? '已登录' : '登录')}
          </span>
        </motion.button>
      </div>
    </div>

    {/* Clear All Confirm Dialog */}
    <Dialog
        isOpen={showClearAllConfirm}
        onClose={() => setShowClearAllConfirm(false)}
        title="清空所有记录"
        maxWidth="max-w-sm"
    >
        <div className="p-1">
            <p className="text-gray-300 mb-6">确定要清空所有{activeView === 'chat' ? '文本' : '图像'}生成记录吗？此操作无法撤销。</p>
            <div className="flex justify-end gap-3">
                <button
                    onClick={() => setShowClearAllConfirm(false)}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/10"
                >
                    取消
                </button>
                <button
                    onClick={async () => {
                        const type = activeView === 'chat' ? 'TEXT' : 'IMAGE';
                        await SessionManager.getInstance().clearAllConversations(type);
                        setShowClearAllConfirm(false);
                    }}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-900/20"
                >
                    确认清空
                </button>
            </div>
        </div>
    </Dialog>

    <AccountDialog
        isOpen={isAccountOpen}
        onClose={() => setIsAccountOpen(false)}
    />

    {/* Delete Confirm Dialog */}
    <Dialog 
        isOpen={!!showDeleteConfirm} 
        onClose={() => setShowDeleteConfirm(null)} 
        title="删除会话" 
        maxWidth="max-w-sm"
    >
        <div className="p-1">
            <p className="text-gray-300 mb-6">确定要删除此会话吗？此操作无法撤销。</p>
            <div className="flex justify-end gap-3">
                <button 
                    onClick={() => setShowDeleteConfirm(null)}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/10"
                >
                    取消
                </button>
                <button
                    onClick={async () => {
                        if (showDeleteConfirm) {
                            await SessionManager.getInstance().deleteConversation(showDeleteConfirm);
                            setShowDeleteConfirm(null);
                        }
                    }}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-900/20"
                >
                    删除
                </button>
            </div>
        </div>
    </Dialog>

    {/* Group Select Dialog */}
    <Dialog 
        isOpen={!!showGroupSelect} 
        onClose={() => setShowGroupSelect(null)} 
        title="添加到分组" 
        maxWidth="max-w-sm"
    >
        <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar">
            {(() => {
                const conversationId = showGroupSelect;
                if (!conversationId) return null;
                const currentGroupId = conversationToGroupId[conversationId];

                return (
                    <>
                        {currentGroupId ? (
                            <button
                                onClick={async () => {
                                    await StorageService.removeConversationFromGroup(currentGroupId, conversationId);
                                    setShowGroupSelect(null);
                                }}
                                className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-white/10 text-left transition-colors group"
                            >
                                <span className="text-gray-300 group-hover:text-white">移出分组</span>
                            </button>
                        ) : null}

                        {(groups || []).map(group => (
                            <button
                                key={group.id}
                                onClick={async () => {
                                    await StorageService.addConversationToGroup(group.id, conversationId, { exclusive: true });
                                    setShowGroupSelect(null);
                                }}
                                className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-white/10 text-left transition-colors group"
                            >
                                <span className="text-gray-300 group-hover:text-white">{group.name}</span>
                                <Plus size={16} className="opacity-0 group-hover:opacity-100 text-gray-400" />
                            </button>
                        ))}
                    </>
                );
            })()}
            <button
                onClick={() => {
                    setPendingAssignConversationId(showGroupSelect);
                    setShowGroupSelect(null);
                    setEditingGroupId(null);
                    setGroupNameValue('');
                    setShowCreateGroupDialog(true);
                }}
                className="w-full p-3 rounded-xl border border-dashed border-white/20 text-gray-400 hover:text-white hover:border-white/40 text-center text-sm mt-2"
            >
                新建分组
            </button>
        </div>
    </Dialog>

    {/* Create Group Dialog */}
    <Dialog
        isOpen={showCreateGroupDialog}
        onClose={() => {
            setShowCreateGroupDialog(false);
            setEditingGroupId(null);
            setGroupNameValue('');
            setPendingAssignConversationId(null);
        }}
        title={editingGroupId ? "重命名分组" : "新建分组"}
        maxWidth="max-w-sm"
    >
        <div className="p-1">
            <input
                placeholder="请输入分组名称"
                className="w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-500"
                autoFocus
                value={groupNameValue}
                onChange={(e) => setGroupNameValue(e.target.value)}
                onKeyDown={async (e) => {
                    if (e.key !== 'Enter') return;
                    const name = groupNameValue.trim();
                    if (!name) return;

                    if (editingGroupId) {
                        await StorageService.renameGroup(editingGroupId, name);
                    } else {
                        const newGroupId = await StorageService.createGroup(name);
                        if (pendingAssignConversationId) {
                            await StorageService.addConversationToGroup(newGroupId, pendingAssignConversationId, { exclusive: true });
                        }
                    }

                    setShowCreateGroupDialog(false);
                    setEditingGroupId(null);
                    setGroupNameValue('');
                    setPendingAssignConversationId(null);
                }}
            />
            <div className="flex justify-end gap-3">
                <button
                    onClick={() => {
                        setShowCreateGroupDialog(false);
                        setEditingGroupId(null);
                        setGroupNameValue('');
                        setPendingAssignConversationId(null);
                    }}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/10"
                >
                    取消
                </button>
                <button
                    onClick={async () => {
                        const name = groupNameValue.trim();
                        if (!name) return;

                        if (editingGroupId) {
                            await StorageService.renameGroup(editingGroupId, name);
                        } else {
                            const newGroupId = await StorageService.createGroup(name);
                            if (pendingAssignConversationId) {
                                await StorageService.addConversationToGroup(newGroupId, pendingAssignConversationId, { exclusive: true });
                            }
                        }

                        setShowCreateGroupDialog(false);
                        setEditingGroupId(null);
                        setGroupNameValue('');
                        setPendingAssignConversationId(null);
                    }}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20"
                >
                    {editingGroupId ? "保存" : "创建"}
                </button>
            </div>
        </div>
    </Dialog>

    {/* Delete Group Confirm Dialog */}
    <Dialog 
        isOpen={!!showDeleteGroupConfirm} 
        onClose={() => setShowDeleteGroupConfirm(null)} 
        title="删除分组" 
        maxWidth="max-w-sm"
    >
        <div className="p-1">
            <p className="text-gray-300 mb-6">确定要删除此分组吗？分组会被删除，但会话不会被删除。</p>
            <div className="flex justify-end gap-3">
                <button 
                    onClick={() => setShowDeleteGroupConfirm(null)}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/10"
                >
                    取消
                </button>
                <button
                    onClick={async () => {
                        if (showDeleteGroupConfirm) {
                            await StorageService.deleteGroup(showDeleteGroupConfirm);
                            setShowDeleteGroupConfirm(null);
                        }
                    }}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-900/20"
                >
                    删除
                </button>
            </div>
        </div>
    </Dialog>
    </>
  );
};

const GroupActions = ({
    onRename,
    onDelete
}: {
    onRename: () => void;
    onDelete: () => void;
}) => {
    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef<HTMLButtonElement>(null);

    return (
        <>
            <button
                ref={menuRef}
                onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(prev => !prev);
                }}
                className={`p-1 hover:bg-white/10 rounded-md transition-colors ${showMenu ? 'text-white bg-white/10 opacity-100' : 'text-gray-500 hover:text-white'}`}
            >
                <MoreVertical size={14} />
            </button>

            <Popover
                isOpen={showMenu}
                onClose={() => setShowMenu(false)}
                triggerRef={menuRef}
                align="start"
                side="right"
                alignOffset={20}
                offset={4}
            >
                <div className="p-1 min-w-[140px] bg-[#1a1a1a] border border-white/10 rounded-xl shadow-xl z-50">
                    <button 
                        onClick={() => { setShowMenu(false); onRename(); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/10 rounded-lg text-left"
                    >
                        <Edit2 size={14} /> 重命名
                    </button>
                    <div className="h-px bg-white/10 my-1 mx-2"></div>
                    <button 
                        onClick={() => { setShowMenu(false); onDelete(); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg text-left"
                    >
                        <Trash2 size={14} /> 删除分组
                    </button>
                </div>
            </Popover>
        </>
    );
};

const HistoryItem = ({
    item,
    isEditing,
    editValue,
    onEditChange,
    onEditConfirm,
    onEditCancel,
    onSelect,
    onMenuAction,
    isSelected
}: {
    item: Conversation,
    isEditing: boolean,
    editValue: string,
    onEditChange: (val: string) => void,
    onEditConfirm: () => void,
    onEditCancel: () => void,
    onSelect: () => void,
    onMenuAction: (action: 'rename' | 'delete' | 'pin' | 'group') => void,
    isSelected?: boolean
}) => {
    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef<HTMLButtonElement>(null);

    if (isEditing) {
        return (
            <div className="flex items-center gap-1 px-2 py-1">
                <input 
                    autoFocus
                    value={editValue}
                    onChange={(e) => onEditChange(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') onEditConfirm();
                        if (e.key === 'Escape') onEditCancel();
                    }}
                    onBlur={onEditConfirm}
                    className="w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded px-2 py-1 focus:outline-none focus:border-emerald-500"
                />
            </div>
        );
    }

    return (
        <div className="group relative">
            <motion.button
                whileHover={{ x: 2 }}
                onClick={onSelect}
                className={`w-full text-left pl-3 pr-8 py-2 text-sm rounded-lg truncate transition-colors flex items-center justify-between ${
                    isSelected
                        ? 'text-white bg-white/10 shadow-[0_0_10px_rgba(255,255,255,0.05)]'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
            >
                <div className="flex items-center gap-2 truncate">
                    {isSelected && <div className="w-1.5 h-1.5 bg-white rounded-full flex-shrink-0 shadow-[0_0_8px_rgba(255,255,255,0.8)]" />}
                    <span className="truncate">{item.title}</span>
                </div>
                {item.isPinned && <Pin size={12} className="text-jan-400 flex-shrink-0 ml-2" />}
            </motion.button>
            
            {/* Menu Trigger */}
            <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    ref={menuRef}
                    onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(prev => !prev);
                    }}
                    className={`p-1 hover:bg-white/10 rounded-md transition-colors ${showMenu ? 'text-white bg-white/10 opacity-100' : 'text-gray-400 hover:text-white'}`}
                >
                    <MoreVertical size={14} />
                </button>
            </div>

            <Popover
                isOpen={showMenu}
                onClose={() => setShowMenu(false)}
                triggerRef={menuRef}
                align="start"
                side="right"
                alignOffset={20}
                offset={4}
            >
                <div className="p-1 min-w-[140px] bg-[#1a1a1a] border border-white/10 rounded-xl shadow-xl z-50">
                    <button 
                        onClick={() => { setShowMenu(false); onMenuAction('rename'); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/10 rounded-lg text-left"
                    >
                        <Edit2 size={14} /> 重命名
                    </button>
                    <button 
                        onClick={() => { setShowMenu(false); onMenuAction('pin'); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/10 rounded-lg text-left"
                    >
                        <Pin size={14} className={item.isPinned ? "fill-current" : ""} /> {item.isPinned ? "取消置顶" : "置顶会话"}
                    </button>
                    <button 
                        onClick={() => { setShowMenu(false); onMenuAction('group'); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/10 rounded-lg text-left"
                    >
                        <FolderInput size={14} /> 添加到分组
                    </button>
                    <div className="h-px bg-white/10 my-1 mx-2"></div>
                    <button 
                        onClick={() => { setShowMenu(false); onMenuAction('delete'); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg text-left"
                    >
                        <Trash2 size={14} /> 删除会话
                    </button>
                </div>
            </Popover>
        </div>
    );
};