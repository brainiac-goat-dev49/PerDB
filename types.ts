
export interface DBEntry {
  id: string;
  [key: string]: any;
}

export interface Collection {
  name: string;
  entries: DBEntry[];
  totalCount?: number;
  isLoading?: boolean;
  hasLoaded?: boolean;
}

export interface ProjectPermissions {
  allowPublicRead: boolean;
  allowPublicWrite: boolean; // Dangerous, but sometimes needed
  allowedOrigins: string[]; // CORS support
}

export interface Project {
  id: string;
  ownerId: string; // Link to User
  name: string;
  description?: string;
  apiKey: string; // Public key for frontend
  secretKey?: string; // Private key for server-side admin
  permissions: ProjectPermissions;
  rules?: string; // JSON string of security rules
  stats?: {
    reads: number;
    writes: number;
    activeUsers: number;
  };
  collections: Collection[];
  collectionList: string[];
  createdAt: string;
  updatedAt: string;
}

export interface User {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
}

export type LogType = 'info' | 'success' | 'error' | 'warning';

export interface LogEntry {
  timestamp: string;
  type: LogType;
  message: string;
}

export enum ViewState {
  LANDING = 'LANDING',
  DASHBOARD = 'DASHBOARD',
  DOCS = 'DOCS',
  PLAYGROUND = 'PLAYGROUND',
  AUTH = 'AUTH'
}
