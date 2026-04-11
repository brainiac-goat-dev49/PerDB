
import React, { useState, useEffect } from 'react';
import { 
  Users, 
  MessageSquare, 
  Shield, 
  Trash2, 
  Ban, 
  CheckCircle, 
  Mail, 
  Clock,
  Search,
  Filter,
  ArrowRight
} from 'lucide-react';
import { Card, Button, Input, Badge } from '../components/ui';
import { FirebaseService } from '../services/firebaseService';
import { auth } from '../lib/firebase';
import { motion, AnimatePresence } from 'motion/react';

export const Admin: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'users' | 'feedback'>('users');
  const [users, setUsers] = useState<any[]>([]);
  const [feedback, setFeedback] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user && user.email === 'testimonyfresh49@gmail.com') {
        setIsAdmin(true);
        loadData();
      } else {
        setIsAdmin(false);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [usersData, feedbackData] = await Promise.all([
        FirebaseService.getAllUsers(),
        FirebaseService.getAllFeedback()
      ]);
      setUsers(usersData);
      setFeedback(feedbackData);
    } catch (err) {
      console.error("Failed to load admin data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleBan = async (userId: string, currentStatus: boolean) => {
    try {
      await FirebaseService.updateUserStatus(userId, !currentStatus);
      setUsers(users.map(u => u.id === userId ? { ...u, isBanned: !currentStatus } : u));
    } catch (err) {
      alert("Failed to update user status");
    }
  };

  const handleDeleteUserFull = async (userId: string, email: string) => {
    if (!confirm(`CRITICAL: Are you sure you want to delete user ${email} and ALL their data? This will also ban their email from future use. This action is irreversible.`)) return;
    
    try {
      setLoading(true);
      await FirebaseService.deleteUserFull(userId);
      setUsers(users.filter(u => u.id !== userId));
      alert("User and all associated data deleted successfully.");
    } catch (err: any) {
      alert("Failed to delete user: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSendResetLink = async (email: string) => {
    try {
      const link = await FirebaseService.sendResetLink(email);
      // In a real app, you'd email this. Here we'll show it in a prompt so the admin can copy it.
      window.prompt("Password reset link generated. Copy and send this to the user:", link);
    } catch (err: any) {
      alert("Failed to generate reset link: " + err.message);
    }
  };

  const handleDeleteFeedback = async (id: string) => {
    if (!confirm("Are you sure you want to delete this feedback?")) return;
    try {
      await FirebaseService.deleteFeedback(id);
      setFeedback(feedback.filter(f => f.id !== id));
    } catch (err) {
      alert("Failed to delete feedback");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-brand-500"></div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto mt-20 text-center">
        <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
          <Shield className="w-10 h-10 text-red-500" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-4">Access Denied</h1>
        <p className="text-slate-400 mb-8">
          This area is restricted to administrators only. If you believe this is an error, please contact support.
        </p>
        <Button href="/">Return Home</Button>
      </div>
    );
  }

  const filteredUsers = users.filter(u => 
    u.email?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.displayName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredFeedback = feedback.filter(f => 
    f.email?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    f.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    f.message?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Shield className="w-8 h-8 text-brand-500" />
            Admin Control Center
          </h1>
          <p className="text-slate-400">Manage users, feedback, and platform health.</p>
        </div>
        <div className="flex bg-slate-900/50 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setActiveTab('users')}
            className={`px-6 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
              activeTab === 'users' ? 'bg-brand-500 text-white shadow-lg' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Users className="w-4 h-4" />
            Users
          </button>
          <button
            onClick={() => setActiveTab('feedback')}
            className={`px-6 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
              activeTab === 'feedback' ? 'bg-brand-500 text-white shadow-lg' : 'text-slate-400 hover:text-white'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            Feedback
            {feedback.length > 0 && (
              <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                {feedback.length}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="mb-6 relative">
        <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-slate-500">
          <Search className="w-5 h-5" />
        </div>
        <input
          type="text"
          placeholder={`Search ${activeTab}...`}
          className="w-full bg-slate-900/50 border border-slate-800 rounded-xl pl-12 pr-4 py-3 text-white focus:outline-none focus:border-brand-500 transition-colors"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'users' ? (
          <motion.div
            key="users-tab"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-1 gap-4"
          >
            {filteredUsers.length === 0 ? (
              <div className="text-center py-20 bg-slate-900/30 rounded-2xl border border-dashed border-slate-800">
                <Users className="w-12 h-12 text-slate-700 mx-auto mb-4" />
                <p className="text-slate-500">No users found matching your search.</p>
              </div>
            ) : (
              filteredUsers.map((user) => (
                <Card key={user.id} className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-all">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-slate-800 overflow-hidden flex-shrink-0 border-2 border-slate-700">
                        {user.photoURL ? (
                          <img src={user.photoURL} alt={user.displayName} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-500">
                            <User className="w-6 h-6" />
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-white font-semibold">{user.displayName || 'Anonymous User'}</h3>
                          {user.role === 'admin' && <Badge variant="brand">Admin</Badge>}
                          {user.isBanned && <Badge variant="danger">Banned</Badge>}
                        </div>
                        <p className="text-sm text-slate-500 flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5" />
                          {user.email}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <div className="text-right mr-4 hidden md:block">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Last Active</p>
                        <p className="text-xs text-slate-300">
                          {user.lastLogin?.toDate ? user.lastLogin.toDate().toLocaleString() : 'Never'}
                        </p>
                      </div>
                      
                      <Button
                        variant="ghost"
                        size="sm"
                        className={user.isBanned ? "text-emerald-400 hover:bg-emerald-500/10" : "text-red-400 hover:bg-red-500/10"}
                        onClick={() => handleToggleBan(user.id, user.isBanned)}
                      >
                        {user.isBanned ? <CheckCircle className="w-4 h-4 mr-2" /> : <Ban className="w-4 h-4 mr-2" />}
                        {user.isBanned ? 'Unban' : 'Ban'}
                      </Button>
                      
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-slate-400 hover:bg-slate-800"
                        onClick={() => handleSendResetLink(user.email)}
                      >
                        Reset
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:bg-red-500/10"
                        onClick={() => handleDeleteUserFull(user.id, user.email)}
                        title="Delete User and ALL Data"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </motion.div>
        ) : (
          <motion.div
            key="feedback-tab"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-1 gap-4"
          >
            {filteredFeedback.length === 0 ? (
              <div className="text-center py-20 bg-slate-900/30 rounded-2xl border border-dashed border-slate-800">
                <MessageSquare className="w-12 h-12 text-slate-700 mx-auto mb-4" />
                <p className="text-slate-500">No feedback messages found.</p>
              </div>
            ) : (
              filteredFeedback.map((item) => (
                <Card key={item.id} className="bg-slate-900/50 border-slate-800">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-brand-500/10 rounded-lg flex items-center justify-center">
                        <MessageSquare className="w-5 h-5 text-brand-400" />
                      </div>
                      <div>
                        <h3 className="text-white font-semibold">{item.name}</h3>
                        <p className="text-xs text-slate-500">{item.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500 flex items-center gap-1 bg-slate-800/50 px-2 py-1 rounded-md">
                        <Clock className="w-3 h-3" />
                        {new Date(item.timestamp).toLocaleString()}
                      </span>
                      <button 
                        onClick={() => handleDeleteFeedback(item.id)}
                        className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="bg-slate-950/50 p-4 rounded-lg border border-slate-800/50">
                    <p className="text-slate-300 whitespace-pre-wrap text-sm leading-relaxed">
                      {item.message}
                    </p>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="text-brand-400"
                      onClick={() => window.location.href = `mailto:${item.email}?subject=Re: PerDB Feedback`}
                    >
                      Reply via Email
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                </Card>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const User = ({ className }: { className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    width="24" 
    height="24" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);
