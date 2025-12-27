import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Info, LogOut, UserPlus, X } from 'lucide-react';
import { AuthService } from '../../services/AuthService';
import { AboutDialog } from './AboutDialog';

interface AccountDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AccountDialog: React.FC<AccountDialogProps> = ({ isOpen, onClose }) => {
  const [authBusy, setAuthBusy] = useState(false);
  const [profile, setProfile] = useState(AuthService.getGoogleProfile());
  const [isSignedIn, setIsSignedIn] = useState(AuthService.isSignedIn());
  const [showAbout, setShowAbout] = useState(false);

  const googleBtnRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const update = () => {
      setIsSignedIn(AuthService.isSignedIn());
      setProfile(AuthService.getGoogleProfile());
    };

    update();

    const onAuthChanged = () => update();
    window.addEventListener('everytalk-auth-changed', onAuthChanged);
    return () => window.removeEventListener('everytalk-auth-changed', onAuthChanged);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const clientId = (import.meta as any).env?.VITE_GOOGLE_WEB_CLIENT_ID as string | undefined;
    if (!clientId) return;

    const w = window as any;
    let cleared = false;
    let intervalId: number | null = null;
    let timeoutId: number | null = null;

    const tryRender = (): boolean => {
      const hasGis = !!w?.google?.accounts?.id;
      if (!hasGis) return false;
      if (!googleBtnRef.current) return false;

      try {
        w.google.accounts.id.initialize({
          client_id: clientId,
          callback: async (resp: any) => {
            const cred = resp?.credential;
            if (!cred) return;
            setAuthBusy(true);
            try {
              await AuthService.signInWithGoogleIdToken(cred);
            } catch {
              // ignore
            } finally {
              setAuthBusy(false);
            }
          },
        });

        googleBtnRef.current.innerHTML = '';
        w.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: 'outline',
          size: 'large',
          width: 320,
        });

        return true;
      } catch {
        return true;
      }
    };

    if (!tryRender()) {
      intervalId = window.setInterval(() => {
        if (cleared) return;
        if (tryRender() && intervalId != null) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
      }, 300);

      timeoutId = window.setTimeout(() => {
        if (intervalId != null) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
      }, 6000);
    }

    return () => {
      cleared = true;
      if (intervalId != null) window.clearInterval(intervalId);
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, [isOpen]);

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
              onClick={onClose}
            />

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 30 }}
              transition={{ type: 'spring', stiffness: 260, damping: 30 }}
              className="fixed inset-0 z-50 bg-black text-white"
            >
              <div className="h-full w-full max-w-3xl mx-auto flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                  <button
                    onClick={onClose}
                    className="inline-flex items-center gap-2 text-gray-300 hover:text-white"
                  >
                    <ArrowLeft size={18} />
                    返回
                  </button>
                  <div className="text-sm font-bold">账户</div>
                  <button
                    onClick={onClose}
                    className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/5"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-4">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center gap-3">
                      {profile?.picture ? (
                        <img
                          src={profile.picture}
                          alt="avatar"
                          className="h-14 w-14 rounded-full object-cover border border-white/10"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="h-14 w-14 rounded-full bg-white/10 border border-white/10" />
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="text-base font-bold text-white truncate">
                          {profile?.name || (isSignedIn ? '已登录' : '未登录')}
                        </div>
                        <div className="text-xs text-gray-400 truncate">{profile?.email || ''}</div>
                      </div>

                      <div className={`text-xs font-bold ${isSignedIn ? 'text-emerald-400' : 'text-zinc-400'}`}>
                        {isSignedIn ? '已登录' : '未登录'}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-col gap-3">
                      <div className="flex flex-wrap gap-2">
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          disabled={!isSignedIn}
                          onClick={() => {
                            AuthService.signOut();
                          }}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
                        >
                          <LogOut size={16} />
                          退出登录
                        </motion.button>

                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => setShowAbout(true)}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold bg-zinc-800 hover:bg-zinc-700"
                        >
                          <Info size={16} />
                          关于
                        </motion.button>
                      </div>

                      <div>
                        <div className="text-xs text-gray-400 mb-2">添加账号 / 切换账号</div>
                        <div className="flex items-center gap-3">
                          <div ref={googleBtnRef} className={authBusy ? 'opacity-60 pointer-events-none' : ''} />
                          <div className="text-xs text-gray-500 flex items-center gap-2">
                            <UserPlus size={14} />
                            {isSignedIn ? '可用于切换账号' : '用于登录'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AboutDialog isOpen={showAbout} onClose={() => setShowAbout(false)} />
    </>
  );
};
