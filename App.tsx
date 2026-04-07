import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Database, Home as HomeIcon, LayoutDashboard, Book, Code, Menu, X, LogOut, User, Info, MessageSquare } from 'lucide-react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './lib/firebase';
import { Home } from './pages/Home';
import { Dashboard } from './pages/Dashboard';
import { Docs } from './pages/Docs';
import { Playground } from './pages/Playground';
import { Auth } from './pages/Auth';
import { About } from './pages/About';
import { Contact } from './pages/Contact';
import { ErrorBoundary } from './components/ErrorBoundary';

const AppContent: React.FC = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [user, setUser] = useState<any>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await signOut(auth);
    navigate('/');
  };

  const NavItem = ({ to, icon: Icon, label }: { to: string; icon: any; label: string }) => (
    <button
      onClick={() => { navigate(to); setIsMobileMenuOpen(false); }}
      className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
        location.pathname === to 
          ? 'bg-brand-900/50 text-brand-400' 
          : 'text-slate-400 hover:text-white hover:bg-slate-800'
      }`}
    >
      <Icon className="w-4 h-4" />
      <span>{label}</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-brand-500/30 selection:text-brand-200">
      
      {/* Navigation */}
      <nav className="sticky top-0 z-50 w-full border-b border-slate-800 bg-slate-950/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            {/* Logo */}
            <div className="flex items-center cursor-pointer" onClick={() => navigate('/')}>
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center mr-3 shadow-lg shadow-brand-500/20">
                <Database className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-xl tracking-tight text-white">PerDB</span>
            </div>

            {/* Desktop Nav */}
            <div className="hidden md:flex items-center space-x-1">
              <NavItem to="/" icon={HomeIcon} label="Home" />
              <NavItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
              <NavItem to="/docs" icon={Book} label="Docs" />
              <NavItem to="/playground" icon={Code} label="Playground" />
              <NavItem to="/about" icon={Info} label="About" />
              <NavItem to="/contact" icon={MessageSquare} label="Contact" />
            </div>

            {/* Desktop User Menu */}
            <div className="hidden md:flex items-center ml-4 border-l border-slate-800 pl-4">
              {user ? (
                <div className="flex items-center gap-3">
                  <div className="text-right hidden lg:block">
                     <div className="text-xs text-brand-400 font-medium">{user.displayName || 'User'}</div>
                     <div className="text-[10px] text-slate-500">{user.email}</div>
                  </div>
                  <button 
                    onClick={handleSignOut}
                    className="p-2 text-slate-400 hover:text-white rounded-md hover:bg-slate-800 transition-colors"
                    title="Sign Out"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => navigate('/auth')}
                  className="bg-brand-600 hover:bg-brand-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-brand-900/20"
                >
                  Sign In
                </button>
              )}
            </div>

            {/* Mobile Menu Button */}
            <div className="md:hidden">
              <button 
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} 
                className="p-2 text-slate-400 hover:text-white rounded-md hover:bg-slate-800 transition-colors"
              >
                {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Nav Dropdown */}
        {isMobileMenuOpen && (
          <div className="md:hidden border-b border-slate-800 bg-slate-950 px-4 pt-2 pb-4 space-y-2 shadow-xl animate-in slide-in-from-top-2">
            <NavItem to="/" icon={HomeIcon} label="Home" />
            <NavItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
            <NavItem to="/docs" icon={Book} label="Docs" />
            <NavItem to="/playground" icon={Code} label="Playground" />
            <NavItem to="/about" icon={Info} label="About" />
            <NavItem to="/contact" icon={MessageSquare} label="Contact" />
            
            <div className="border-t border-slate-800 pt-2 mt-2">
               {user ? (
                 <button
                   onClick={handleSignOut}
                   className="flex items-center w-full px-3 py-3 rounded-lg text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-white"
                 >
                   <LogOut className="w-4 h-4 mr-3" /> Sign Out ({user.email})
                 </button>
               ) : (
                 <button
                   onClick={() => navigate('/auth')}
                   className="flex items-center w-full px-3 py-3 rounded-lg text-sm font-medium text-brand-400 hover:bg-brand-900/20"
                 >
                   <User className="w-4 h-4 mr-3" /> Sign In
                 </button>
               )}
            </div>
          </div>
        )}
      </nav>

      {/* Main Content */}
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/dashboard" element={user ? <Dashboard /> : <Navigate to="/auth" />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/playground" element={<Playground />} />
          <Route path="/auth" element={user ? <Navigate to="/dashboard" /> : <Auth />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
        </Routes>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-12">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-slate-500 text-sm">
            © {new Date().getFullYear()} PerDB. Built for the Perchance Community.
          </p>
        </div>
      </footer>
    </div>
  );
};

const App: React.FC = () => (
  <ErrorBoundary>
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  </ErrorBoundary>
);

export default App;
;