const DEVICE_ID_KEY = 'everytalk.deviceId';
const ACCESS_TOKEN_KEY = 'everytalk.accessToken';

function ensureDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing && existing.trim()) return existing;

    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? (crypto as any).randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function getAccessToken(): string | null {
  try {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

function setAccessToken(token: string | null) {
  try {
    if (!token) {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
    } else {
      localStorage.setItem(ACCESS_TOKEN_KEY, token);
    }
  } catch {
    // ignore
  }
}

function getApiBaseUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_SYNC_API_BASE_URL as string | undefined;
  return (envUrl && envUrl.trim()) ? envUrl.trim().replace(/\/$/, '') : 'https://api.everytalk.cc';
}

async function exchangeGoogleIdToken(idToken: string): Promise<string> {
  const deviceId = ensureDeviceId();
  const resp = await fetch(`${getApiBaseUrl()}/auth/google`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ idToken, deviceId }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`auth_failed(${resp.status}): ${text}`);
  }

  const data = await resp.json() as { accessToken?: string };
  if (!data?.accessToken) throw new Error('missing_access_token');
  return data.accessToken;
}

export const AuthService = {
  getApiBaseUrl,
  ensureDeviceId,
  getAccessToken,
  isSignedIn(): boolean {
    return !!getAccessToken();
  },
  signOut() {
    setAccessToken(null);
  },
  async signInWithGoogleIdToken(idToken: string): Promise<void> {
    const token = await exchangeGoogleIdToken(idToken);
    setAccessToken(token);
  },
};
