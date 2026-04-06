import React from 'react';

export const About: React.FC = () => {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      <h1 className="text-4xl font-bold text-white mb-6">About PerDB</h1>
      <p className="text-slate-400 mb-4">
        PerDB is the missing cloud backend for Perchance generators. We provide persistent cloud storage, real-time synchronization, and simple security rules to make your generators more powerful.
      </p>
      <p className="text-slate-400 mb-4">
        Our mission is to provide a reliable, easy-to-use database solution for creative coders on Perchance. Whether you're building a simple high-score table or a complex multiplayer RPG, PerDB scales with your imagination.
      </p>
      <p className="text-slate-400 mb-4">
        Currently, PerDB is in <strong>Open Source Beta</strong>. We are committed to keeping the core platform accessible and community-driven.
      </p>
      
      <div className="mt-8 p-6 bg-brand-900/10 border border-brand-500/20 rounded-xl">
        <h3 className="text-lg font-semibold text-brand-300 mb-2">Future & Monetization</h3>
        <p className="text-slate-400 text-sm">
          To ensure the long-term sustainability of the platform, we may introduce non-intrusive ad monetization in the future. Our goal is to keep the service free for the majority of users while covering infrastructure costs.
        </p>
      </div>

      <div className="mt-12 p-6 bg-slate-900 rounded-xl border border-slate-800">
        <h3 className="text-lg font-semibold text-white mb-2">Credits</h3>
        <p className="text-slate-400">
          Created by <span className="text-brand-400 font-bold">Brainiac-Goat-Dev</span>.
        </p>
      </div>
    </div>
  );
};
