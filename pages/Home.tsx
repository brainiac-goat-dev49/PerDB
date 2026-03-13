import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Cloud, Lock, Zap, Code } from 'lucide-react';
import { Button } from '../components/ui';

export const Home: React.FC = () => {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col min-h-[calc(100vh-64px)]">
      {/* Hero */}
      <section className="flex-1 flex items-center justify-center py-20 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        {/* Abstract Background */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-brand-500/20 blur-[120px] rounded-full pointer-events-none" />
        
        <div className="max-w-4xl w-full text-center relative z-10">
          <div className="inline-flex items-center px-3 py-1 rounded-full border border-brand-500/30 bg-brand-500/10 text-brand-300 text-xs font-medium mb-6">
            <span className="relative flex h-2 w-2 mr-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-500"></span>
            </span>
            Now in Public Beta
          </div>
          
          <h1 className="text-5xl md:text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400 tracking-tight mb-6">
            Cloud Superpowers for <br className="hidden md:block" />
            <span className="text-brand-400">Perchance Generators</span>
          </h1>
          
          <p className="text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            Stop relying on browser localStorage. PerDB gives your generators real, persistent cloud storage. Sync world states, create leaderboards, and more with one line of code.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button onClick={() => navigate('/dashboard')} className="w-full sm:w-auto px-8 py-3 text-lg h-auto">
              Get Started Free
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
            <Button onClick={() => navigate('/playground')} variant="outline" className="w-full sm:w-auto px-8 py-3 text-lg h-auto">
              Try the Playground
            </Button>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="bg-slate-900/50 border-t border-slate-800 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {[
              {
                icon: Cloud,
                title: "Persistent Storage",
                desc: "Data lives in the cloud, not the user's browser cache. It survives clear-cache and device switching."
              },
              {
                icon: Zap,
                title: "Real-time Sync",
                desc: "Changes update instantly. Perfect for multiplayer text RPGs or live community events."
              },
              {
                icon: Lock,
                title: "Simple Security",
                desc: "Built-in API keys and simple rule sets allow you to control who can read or write data."
              }
            ].map((feature, i) => (
              <div key={i} className="bg-slate-800/50 p-8 rounded-2xl border border-slate-700/50 hover:border-brand-500/30 transition-colors">
                <div className="bg-brand-900/30 w-12 h-12 rounded-lg flex items-center justify-center mb-6">
                  <feature.icon className="w-6 h-6 text-brand-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">{feature.title}</h3>
                <p className="text-slate-400 leading-relaxed">
                  {feature.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Code Snippet */}
      <section className="py-20 px-4">
        <div className="max-w-3xl mx-auto bg-slate-950 rounded-xl overflow-hidden shadow-2xl border border-slate-800">
          <div className="bg-slate-900 px-4 py-2 flex items-center space-x-2 border-b border-slate-800">
             <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50" />
             <div className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/50" />
             <div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500/50" />
             <span className="ml-2 text-xs text-slate-500 font-mono">perchance-module.html</span>
          </div>
          <div className="p-6 overflow-x-auto">
            <pre className="font-mono text-sm text-slate-300">
              <span className="text-slate-500">// PerDB SDK Class</span>
              {'\n'}
              <span className="text-purple-400">class</span> <span className="text-blue-300">PerDB</span> {'{'}
              {'\n'}  <span className="text-purple-400">constructor</span>(apiKey) {'{'} <span className="text-yellow-200">this</span>.apiKey = apiKey; {'}'}
              {'\n'}  <span className="text-purple-400">async</span> add(collection, data) {'{'} ... {'}'}
              {'\n'}  <span className="text-purple-400">async</span> get(collection, limit) {'{'} ... {'}'}
              {'\n'} {'}'}
              {'\n\n'}
              <span className="text-slate-500">// Initialize</span>
              {'\n'}
              <span className="text-purple-400">const</span> <span className="text-yellow-200">db</span> = <span className="text-purple-400">new</span> <span className="text-blue-300">PerDB</span>(<span className="text-emerald-300">"pk_live_..."</span>);
              {'\n\n'}
              <span className="text-slate-500">// Save Data</span>
              {'\n'}
              <span className="text-purple-400">await</span> <span className="text-yellow-200">db</span>.add(<span className="text-emerald-300">"heroes"</span>, {'{'}
              {'\n'}  name: <span className="text-emerald-300">"Aragorn"</span>,
              {'\n'}  level: <span className="text-orange-300">20</span>
              {'\n'}{'}'});
            </pre>
          </div>
        </div>
      </section>
    </div>
  );
};
