export interface User {
  uid: string;
  email: string;
  displayName: string;
  role?: string;
  photoURL?: string;
}

const TOKEN_KEY = 'perdb_auth_token';
const USER_KEY = 'perdb_auth_user';

type AuthStateCallback = (user: User | null) => void;
const listeners: Set<AuthStateCallback> = new Set();

async function parseJsonResponse(res: Response) {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    throw new Error(`Server returned non-JSON response (${res.status}): ${text.slice(0, 80)}`);
  }
  return await res.json();
}

export const AuthService = {
  getUser: (): User | null => {
    try {
      const sessionStored = sessionStorage.getItem(USER_KEY) || localStorage.getItem(USER_KEY);
      return sessionStored ? JSON.parse(sessionStored) : null;
    } catch (e) {
      return null;
    }
  },

  getToken: (): string | null => {
    return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
  },

  onAuthStateChanged: (callback: AuthStateCallback) => {
    listeners.add(callback);
    callback(AuthService.getUser());
    return () => {
      listeners.delete(callback);
    };
  },

  notifyListeners: (user: User | null) => {
    listeners.forEach(cb => cb(user));
  },

  register: async (email: string, password: string, displayName: string): Promise<User> => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName })
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Registration failed');
    }
    sessionStorage.setItem(TOKEN_KEY, data.token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(data.user));
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    AuthService.notifyListeners(data.user);
    return data.user;
  },

  login: async (email: string, password: string): Promise<User> => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }
    sessionStorage.setItem(TOKEN_KEY, data.token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(data.user));
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    AuthService.notifyListeners(data.user);
    return data.user;
  },

  signOut: async (): Promise<void> => {
    try {
      sessionStorage.clear();
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (e) {}
    AuthService.notifyListeners(null);
  },

  syncUser: async (): Promise<void> => {
    const token = AuthService.getToken();
    if (!token) return;
    const res = await fetch('/api/user/sync', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) {
      if (res.status === 403 || res.status === 401) {
        await AuthService.signOut();
      }
      let errMessage = 'Failed to sync user';
      try {
        const err = await parseJsonResponse(res);
        errMessage = err.error || errMessage;
      } catch (e) {}
      throw new Error(errMessage);
    }
  }
};
