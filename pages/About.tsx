import React from 'react';

export const About: React.FC = () => {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      <h1 className="text-4xl font-bold text-white mb-6">About PerDB</h1>
      <p className="text-slate-400 mb-4">
        PerDB is the missing cloud backend for Perchance generators. We provide persistent cloud storage, real-time synchronization, and simple security rules to make your generators more powerful.
      </p>
      <p className="text-slate-400 mb-4">
        Built with passion for the Perchance community.
      </p>
      <div className="mt-12 p-6 bg-slate-900 rounded-xl border border-slate-800">
        <h3 className="text-lg font-semibold text-white mb-2">Credits</h3>
        <p className="text-slate-400">
          Created by <span className="text-brand-400 font-bold">Brainiac-Goat-Dev</span>.
        </p>
      </div>
    </div>
  );
};
