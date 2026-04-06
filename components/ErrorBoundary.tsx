import * as React from 'react';
import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<any, any> {
  constructor(props: Props) {
    super(props);
    (this as any).state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if ((this as any).state.hasError) {
      let errorMessage = 'Something went wrong.';
      let isFirestoreError = false;

      try {
        const parsed = JSON.parse((this as any).state.error?.message || '');
        if (parsed.operationType && parsed.authInfo) {
          isFirestoreError = true;
          errorMessage = `Firestore Error: ${parsed.error} during ${parsed.operationType} on ${parsed.path}`;
        }
      } catch (e) {
        errorMessage = (this as any).state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 border border-red-100">
            <div className="flex items-center justify-center w-12 h-12 bg-red-100 rounded-full mb-6 mx-auto">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">Application Error</h2>
            <p className="text-gray-600 text-center mb-6">
              {isFirestoreError ? 'A database permission error occurred.' : 'An unexpected error occurred while running the application.'}
            </p>
            <div className="bg-red-50 rounded-lg p-4 mb-6 overflow-auto max-h-40">
              <code className="text-sm text-red-800 break-all whitespace-pre-wrap font-mono">
                {errorMessage}
              </code>
            </div>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => window.location.reload()}
                className="w-full bg-indigo-600 text-white font-semibold py-3 px-4 rounded-lg hover:bg-indigo-700 transition-colors duration-200 shadow-md"
              >
                Reload Application
              </button>
              <button
                onClick={() => {
                  localStorage.clear();
                  sessionStorage.clear();
                  window.location.reload();
                }}
                className="w-full bg-slate-100 text-slate-600 font-semibold py-2 px-4 rounded-lg hover:bg-slate-200 transition-colors duration-200"
              >
                Clear Cache & Reset
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}
