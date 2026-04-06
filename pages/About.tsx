import React from 'react';

export const About: React.FC = () => {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      <h1 className="text-4xl font-bold text-white mb-6 tracking-tight">About PerDB</h1>
      <p className="text-slate-400 mb-8 text-lg leading-relaxed">
        PerDB is the missing cloud backend for Perchance generators. We provide persistent cloud storage, real-time synchronization, and simple security rules to make your generators more powerful.
      </p>
      
      <div className="space-y-6 mb-12">
        <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800">
          <h3 className="text-xl font-semibold text-white mb-3">Our Mission</h3>
          <p className="text-slate-400 leading-relaxed">
            Perchance is an incredible platform for creativity, but it lacks a native way to store data across sessions or users. PerDB fills that gap by providing a simple, key-value and document-based cloud database that anyone can use with just a few lines of code.
          </p>
        </div>

        <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800">
          <h3 className="text-xl font-semibold text-white mb-3">Open Source & Community Driven</h3>
          <p className="text-slate-400 leading-relaxed">
            We believe in keeping the web open. PerDB is currently in open beta and is free for all Perchance creators. We might explore monetization through ads in the future to keep the servers running, but we will always prioritize the community's needs.
          </p>
        </div>

        <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800">
          <h3 className="text-xl font-semibold text-white mb-3">Secure & Scalable</h3>
          <p className="text-slate-400 leading-relaxed">
            Built on top of Google Cloud and Firestore, PerDB offers enterprise-grade security and scalability. Your data is protected by customizable security rules, ensuring that only authorized users can access or modify it.
          </p>
        </div>
      </div>

      <div className="mt-12 p-6 bg-brand-900/10 rounded-xl border border-brand-500/20">
        <h3 className="text-lg font-semibold text-white mb-2 tracking-tight">Credits</h3>
        <p className="text-slate-400">
          Created by <span className="text-brand-400 font-bold">Brainiac-Goat-Dev</span>.
        </p>
      </div>
    </div>
  );
};
