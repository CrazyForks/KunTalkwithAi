import { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { MainContent } from './components/MainContent';
import { ImageGenerationScreen } from './components/ImageGenerationScreen';
import { AnimatePresence, motion } from 'framer-motion';
import { FileText, Image as ImageIcon, MessageSquarePlus, PanelLeftOpen, Search } from 'lucide-react';
import { SessionManager } from './lib/controllers/SessionManager';
import { AutoCloudSyncService } from './services/AutoCloudSyncService';

function App() {
  const [activeView, setActiveView] = useState<'chat' | 'image'>('chat');
  const [sessionKey, setSessionKey] = useState(0);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const collapsedNewChatTitle = activeView === 'chat' ? '新建会话' : '新建图像生成';
  const collapsedToggleModeTitle = activeView === 'chat' ? '图像生成' : '文本生成';

  const handleCollapsedNewChat = async () => {
    const type = activeView === 'chat' ? 'TEXT' : 'IMAGE';
    await SessionManager.getInstance().createNewChat(type);
    setSessionKey(prev => prev + 1);
  };

  const handleCollapsedToggleMode = () => {
    const newMode = activeView === 'chat' ? 'IMAGE' : 'TEXT';
    SessionManager.getInstance().switchMode(newMode);
    setActiveView(activeView === 'chat' ? 'image' : 'chat');
  };

  useEffect(() => {
    try {
      const stored = localStorage.getItem('everytalk.sidebar.collapsed');
      if (stored === '1') setIsSidebarCollapsed(true);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    return AutoCloudSyncService.start();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('everytalk.sidebar.collapsed', isSidebarCollapsed ? '1' : '0');
    } catch {
      // ignore
    }
  }, [isSidebarCollapsed]);

  const handleNewChat = () => {
    setSessionKey(prev => prev + 1);
  };

  const handleSelectConversation = (id: string) => {
      setSessionKey(prev => prev + 1); // Force re-render for visual effect
      // Trigger event or context update if needed.
      // Since MainContent reads current ID from StorageService on mount, we might need a way to tell it to switch.
      // A simple custom event or context is better, but let's use a custom event for decoupling for now.
      window.dispatchEvent(new CustomEvent('everytalk-conversation-selected', { detail: { id } }));
  };

  const handleCollapseSidebar = () => setIsSidebarCollapsed(true);
  const handleExpandSidebar = () => setIsSidebarCollapsed(false);

  return (
    <AnimatePresence>
      {activeView === 'chat' ? (
        <motion.div
          key={`chat-${sessionKey}`}
          initial={{ opacity: 0, scale: 1.1, filter: 'blur(20px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
          transition={{
            duration: 0.5,
            ease: [0.22, 1, 0.36, 1] // Custom bezier for smoother "silky" feel
          }}
          className="flex h-screen bg-black text-white overflow-hidden font-sans fixed inset-0 z-10"
        >
          <motion.div
            animate={{ width: isSidebarCollapsed ? 56 : 260 }}
            transition={{ duration: 0.2 }}
            className="h-screen overflow-hidden flex-shrink-0"
          >
            {isSidebarCollapsed ? (
              <div className="w-[56px] h-screen bg-black border-r border-white/10 flex flex-col items-center py-4 gap-3">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleExpandSidebar}
                  className="p-2 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:text-white hover:bg-white/10"
                  title="展开侧边栏"
                >
                  <PanelLeftOpen size={20} strokeWidth={1.5} />
                </motion.button>

                <div className="w-full px-2 pt-2 flex flex-col items-center gap-2">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleCollapsedNewChat}
                    className="w-full flex items-center justify-center p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5"
                    title={collapsedNewChatTitle}
                  >
                    <MessageSquarePlus size={20} strokeWidth={2} />
                  </motion.button>

                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleCollapsedToggleMode}
                    className="w-full flex items-center justify-center p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5"
                    title={collapsedToggleModeTitle}
                  >
                    <ImageIcon size={20} strokeWidth={2} />
                  </motion.button>

                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="w-full flex items-center justify-center p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5"
                    title="搜索历史记录"
                  >
                    <Search size={20} strokeWidth={2} />
                  </motion.button>
                </div>
              </div>
            ) : (
              <Sidebar
                activeView="chat"
                setActiveView={(v) => {
                  setActiveView(v);
                  setIsSidebarCollapsed(false);
                }}
                onNewChat={handleNewChat}
                onSelectConversation={handleSelectConversation}
                onCollapse={handleCollapseSidebar}
              />
            )}
          </motion.div>
          <MainContent />
        </motion.div>
      ) : (
        <motion.div
          key={`image-${sessionKey}`}
          initial={{ opacity: 0, scale: 1.1, filter: 'blur(20px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
          transition={{
            duration: 0.5,
            ease: [0.22, 1, 0.36, 1]
          }}
          className="flex h-screen bg-black text-white overflow-hidden font-sans fixed inset-0 z-10"
        >
          <motion.div
            animate={{ width: isSidebarCollapsed ? 56 : 260 }}
            transition={{ duration: 0.2 }}
            className="h-screen overflow-hidden flex-shrink-0"
          >
            {isSidebarCollapsed ? (
              <div className="w-[56px] h-screen bg-black border-r border-white/10 flex flex-col items-center py-4 gap-3">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={handleExpandSidebar}
                  className="p-2 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:text-white hover:bg-white/10"
                  title="展开侧边栏"
                >
                  <PanelLeftOpen size={20} strokeWidth={1.5} />
                </motion.button>

                <div className="w-full px-2 pt-2 flex flex-col items-center gap-2">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleCollapsedNewChat}
                    className="w-full flex items-center justify-center p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5"
                    title={collapsedNewChatTitle}
                  >
                    <MessageSquarePlus size={20} strokeWidth={2} />
                  </motion.button>

                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleCollapsedToggleMode}
                    className="w-full flex items-center justify-center p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5"
                    title={collapsedToggleModeTitle}
                  >
                    <FileText size={20} strokeWidth={2} />
                  </motion.button>

                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="w-full flex items-center justify-center p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5"
                    title="搜索历史记录"
                  >
                    <Search size={20} strokeWidth={2} />
                  </motion.button>
                </div>
              </div>
            ) : (
              <Sidebar
                activeView="image"
                setActiveView={(v) => {
                  setActiveView(v);
                  setIsSidebarCollapsed(false);
                }}
                onNewChat={handleNewChat}
                onSelectConversation={handleSelectConversation}
                onCollapse={handleCollapseSidebar}
              />
            )}
          </motion.div>
          <ImageGenerationScreen />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default App;
