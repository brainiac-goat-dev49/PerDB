import React from 'react';

export const About: React.FC = () => {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      <h1 className="text-4xl font-bold text-white mb-6 tracking-tight">About PerDB</h1>
      <p className="text-slate-400 mb-8 text-lg leading-relaxed">
        PerDB is the missing cloud backend for Perchance generators. We provide persistent cloud storage, real-time synchronization, and simple security rules to make your generators more powerful.
      </p>
      
      <div className="space-y-6 mb-12">
        <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800 hover:border-brand-500/30 transition-colors">
          <h3 className="text-xl font-semibold text-white mb-3">Our Mission</h3>
          <p className="text-slate-400 leading-relaxed">
            Perchance is an incredible platform for creativity, but it lacks a native way to store data across sessions or users. PerDB fills that gap by providing a simple, key-value and document-based cloud database that anyone can use with just a few lines of code. We want to empower creators to build multiplayer games, global leaderboards, and persistent worlds without needing to learn complex backend engineering.
          </p>
        </div>

        <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800 hover:border-brand-500/30 transition-colors">
          <h3 className="text-xl font-semibold text-white mb-3">Open Source & Community Driven</h3>
          <p className="text-slate-400 leading-relaxed">
            We believe in keeping the web open. PerDB is currently in open beta and is free for all Perchance creators. Our goal is to maintain a service that is sustainable and reliable. While we may explore non-intrusive monetization in the future to cover infrastructure costs, our core commitment is to provide a powerful, accessible tool for the community.
          </p>
        </div>

        <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800 hover:border-brand-500/30 transition-colors">
          <h3 className="text-xl font-semibold text-white mb-3">Secure & Scalable</h3>
          <p className="text-slate-400 leading-relaxed">
            Built on top of Google Cloud and Firestore, PerDB offers enterprise-grade security and scalability. Your data is protected by customizable security rules and our new **Domain Locking** feature, ensuring that only authorized generators can access your database. Whether you have 10 users or 10,000, PerDB scales with you.
          </p>
        </div>

        <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800 hover:border-brand-500/30 transition-colors">
          <h3 className="text-xl font-semibold text-white mb-3">How it Works</h3>
          <p className="text-slate-400 leading-relaxed">
            When you use the PerDB SDK, your requests are routed through our secure proxy server. This server validates your API key, checks domain restrictions, and evaluates your custom security rules before interacting with the database. This architecture keeps your database credentials safe while giving you full control over your data.
          </p>
        </div>

        <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800 hover:border-brand-500/30 transition-colors">
          <h3 className="text-xl font-semibold text-white mb-3">The Future of PerDB</h3>
          <p className="text-slate-400 leading-relaxed">
            We are constantly working to improve PerDB. Upcoming features include real-time subscriptions (WebSockets), more advanced query capabilities (filtering, sorting), and a more robust rule engine. Our goal is to make PerDB the standard for data persistence in the Perchance ecosystem.
          </p>
        </div>
      </div>

      <div className="mt-12 p-8 bg-gradient-to-br from-brand-900/20 to-slate-900 rounded-2xl border border-brand-500/20 shadow-xl">
        <h3 className="text-xl font-bold text-white mb-4 tracking-tight">The Team</h3>
        <div className="flex items-center space-x-4">
          <div className="w-16 h-16 rounded-full bg-brand-500 flex items-center justify-center text-white font-bold text-2xl shadow-lg shadow-brand-500/20">
            BG
          </div>
          <div>
            <h4 className="text-lg font-bold text-white">Brainiac-Goat-Dev</h4>
            <p className="text-slate-400 text-sm">Lead Developer & Architect</p>
            <p className="text-slate-500 text-xs mt-1 italic">"Building tools to unlock creativity."</p>
          </div>
        </div>
      </div>
    </div>
  );
};
