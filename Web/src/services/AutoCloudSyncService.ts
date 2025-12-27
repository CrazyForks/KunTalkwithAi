import { AuthService } from './AuthService';
import { CloudSyncManager } from './CloudSyncManager';

type TriggerReason = 'interval' | 'focus' | 'visible' | 'online' | 'manual';

class AutoCloudSyncServiceImpl {
  private inFlight: Promise<void> | null = null;
  private nextAllowedAt = 0;
  private backoffMs = 5000;

  async trigger(reason: TriggerReason): Promise<void> {
    if ((import.meta as any).env?.DEV) {
      // eslint-disable-next-line no-console
      console.debug('[AutoCloudSync] trigger', reason);
    }
    if (!AuthService.isSignedIn()) return;

    const now = Date.now();
    if (now < this.nextAllowedAt) return;
    if (this.inFlight) return;

    this.inFlight = (async () => {
      try {
        await CloudSyncManager.syncOnce();
        this.backoffMs = 5000;
        this.nextAllowedAt = Date.now() + 30_000;
      } catch {
        this.nextAllowedAt = Date.now() + this.backoffMs;
        this.backoffMs = Math.min(this.backoffMs * 2, 5 * 60_000);
      } finally {
        this.inFlight = null;
      }
    })();

    await this.inFlight;
  }

  start() {
    // trigger once quickly after start
    void this.trigger('visible');

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void this.trigger('visible');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const onFocus = () => void this.trigger('focus');
    window.addEventListener('focus', onFocus);

    const onOnline = () => void this.trigger('online');
    window.addEventListener('online', onOnline);

    const timer = window.setInterval(() => {
      void this.trigger('interval');
    }, 60_000);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }
}

export const AutoCloudSyncService = new AutoCloudSyncServiceImpl();
