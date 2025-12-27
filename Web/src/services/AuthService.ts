const DEVICE_ID_KEY = 'everytalk.deviceId';
const ACCESS_TOKEN_KEY = 'everytalk.accessToken';
const GOOGLE_PROFILE_KEY = 'everytalk.googleProfile';

export type GoogleProfile = {
  name?: string;
  picture?: string;
  email?: string;
};

function notifyAuthChanged() {
  try {
    window.dispatchEvent(new Event('everytalk-auth-changed'));
  } catch {
    // ignore
  }
}

function base64UrlToJson(base64Url: string): any {
  const b64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (b64.length % 4)) % 4;
  const padded = b64 + '='.repeat(padLen);
  const json = atob(padded);
  return JSON.parse(json);
}

function decodeGoogleProfileFromIdToken(idToken: string): GoogleProfile | null {
  try {
    const parts = idToken.split('.');
    if (parts.length < 2) return null;
    const payload = base64UrlToJson(parts[1]);
    if (!payload || typeof payload !== 'object') return null;
    const out: GoogleProfile = {};
    if (typeof payload.name === 'string') out.name = payload.name;
    if (typeof payload.picture === 'string') out.picture = payload.picture;
    if (typeof payload.email === 'string') out.email = payload.email;
    return out;
  } catch {
    return null;
  }
}

function getGoogleProfile(): GoogleProfile | null {
  try {
    const raw = localStorage.getItem(GOOGLE_PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      name: typeof (parsed as any).name === 'string' ? (parsed as any).name : undefined,
      picture: typeof (parsed as any).picture === 'string' ? (parsed as any).picture : undefined,
      email: typeof (parsed as any).email === 'string' ? (parsed as any).email : undefined,
    };
  } catch {
    return null;
  }
}

function setGoogleProfile(profile: GoogleProfile | null) {
  try {
    if (!profile) {
      localStorage.removeItem(GOOGLE_PROFILE_KEY);
    } else {
      localStorage.setItem(GOOGLE_PROFILE_KEY, JSON.stringify(profile));
    }
  } catch {
    // ignore
  }
}

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
  getGoogleProfile,
  isSignedIn(): boolean {
    return !!getAccessToken();
  },
  signOut() {
    setAccessToken(null);
    setGoogleProfile(null);
    notifyAuthChanged();
  },
  async signInWithGoogleIdToken(idToken: string): Promise<void> {
    const profile = decodeGoogleProfileFromIdToken(idToken);
    if (profile) setGoogleProfile(profile);
    const token = await exchangeGoogleIdToken(idToken);
    setAccessToken(token);
    notifyAuthChanged();
  },
};
