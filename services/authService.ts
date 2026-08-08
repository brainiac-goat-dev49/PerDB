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

export const AuthService = {
  getUser: (): User | null => {
    try {
      const stored = localStorage.getItem(USER_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch (e) {
      return null;
    }
  },

  getToken: (): string | null => {
    return localStorage.getItem(TOKEN_KEY);
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
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Registration failed');
    }
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
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    AuthService.notifyListeners(data.user);
    return data.user;
  },

  signOut: async (): Promise<void> => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
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
      const err = await res.json();
      if (res.status === 403) {
        await AuthService.signOut();
      }
      throw new Error(err.error || 'Failed to sync user');
    }
  }
};
