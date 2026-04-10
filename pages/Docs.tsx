
import React, { useState } from 'react';
import { BookOpen, Code, Terminal, Cpu, Server, Shield, Database, Lock, Copy, Check, Play, ChevronRight, Layers, FileJson } from 'lucide-react';
import { Card, Button, Badge } from '../components/ui';
import { generateCodeSnippet } from '../services/aiService';

export const Docs: React.FC = () => {
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const handleAskAI = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim()) return;
    setLoading(true);
    const code = await generateCodeSnippet(aiPrompt);
    setAiResponse(code);
    setLoading(false);
  };
  
  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      const headerOffset = 100;
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.scrollY - headerOffset;
  
      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth"
      });
    }
  };

  const copyToClipboard = (text: string, sectionId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(sectionId);
    setTimeout(() => setCopiedSection(null), 2000);
  };
  
  const NavLink = ({ target, label }: { target: string, label: string }) => (
    <button 
      onClick={() => scrollToSection(target)}
      className="block w-full text-left pl-4 py-1 text-slate-400 hover:text-brand-400 hover:border-l hover:border-brand-500 -ml-[1px] transition-all"
    >
      {label}
    </button>
  );

  const apiEndpoint = typeof window !== 'undefined' ? window.location.origin + '/api' : 'https://perdb.app/api';

  const CLIENT_SDK_CODE = `/**
 * PerDB SDK (v1.1)
 * Copy and paste this into your Perchance HTML Panel
 */

class PerDB {
  constructor(apiKey, secretKey = null) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.auth = null;
    // The Live PerDB Platform Endpoint
    this.endpoint = "${apiEndpoint}"; 
    this.cache = new Map();
    this.CACHE_TTL = 2000; // 2 seconds client-side throttle
  }

  /**
   * Set the authentication context for rules
   * @param {object|string} authData - User data or ID
   */
  setAuth(authData) {
    this.auth = authData;
  }

  /**
   * Add a document to a collection
   * @param {string} collection - The collection name (e.g., 'scores')
   * @param {object} data - The JSON object to save
   */
  async add(collection, data) {
    try {
      const headers = {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey
      };
      
      if (this.secretKey) headers["x-secret-key"] = this.secretKey;
      
      if (this.auth) {
        headers["x-perdb-auth"] = typeof this.auth === 'object' 
          ? JSON.stringify(this.auth) 
          : this.auth;
      }

      const res = await fetch(\`\${this.endpoint}?collection=\${collection}\`, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (err) {
      console.error("PerDB Write Error:", err);
      return { error: err.message };
    }
  }

  /**
   * Get documents from a collection
   * @param {string} collection - The collection name
   * @param {number} limit - Max number of items (default 50, max 200)
   */
  async get(collection, limit = 50) {
    const cacheKey = \`\${collection}:\${limit}\`;
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
      return cached.data;
    }

    try {
      const headers = { "x-api-key": this.apiKey };
      if (this.secretKey) headers["x-secret-key"] = this.secretKey;
      
      if (this.auth) {
        headers["x-perdb-auth"] = typeof this.auth === 'object' 
          ? JSON.stringify(this.auth) 
          : this.auth;
      }

      const res = await fetch(\`\${this.endpoint}?collection=\${collection}&limit=\${limit}\`, {
        method: "GET",
        headers: headers
      });
      const data = await res.json();
      this.cache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch (err) {
      console.error("PerDB Read Error:", err);
      return [];
    }
  }

  /**
   * Update a document in a collection
   * @param {string} collection - The collection name
   * @param {string} id - The document ID to update
   * @param {object} data - The new data to merge
   */
  async update(collection, id, data) {
    try {
      const headers = {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey
      };
      
      if (this.secretKey) headers["x-secret-key"] = this.secretKey;
      
      if (this.auth) {
        headers["x-perdb-auth"] = typeof this.auth === 'object' 
          ? JSON.stringify(this.auth) 
          : this.auth;
      }

      const res = await fetch(\`\${this.endpoint}?collection=\${collection}&id=\${id}\`, {
        method: "PUT",
        headers: headers,
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (err) {
      console.error("PerDB Update Error:", err);
      return { error: err.message };
    }
  }

  /**
   * Delete a document from a collection
   * @param {string} collection - The collection name
   * @param {string} id - The document ID to delete
   */
  async delete(collection, id) {
    try {
      const headers = { "x-api-key": this.apiKey };
      if (this.secretKey) headers["x-secret-key"] = this.secretKey;
      
      if (this.auth) {
        headers["x-perdb-auth"] = typeof this.auth === 'object' 
          ? JSON.stringify(this.auth) 
          : this.auth;
      }

      const res = await fetch(\`\${this.endpoint}?collection=\${collection}&id=\${id}\`, {
        method: "DELETE",
        headers: headers
      });
      return await res.json();
    } catch (err) {
      console.error("PerDB Delete Error:", err);
      return { error: err.message };
    }
  }
}
`;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-16">
        <h1 className="text-4xl font-extrabold text-white tracking-tight mb-4">Documentation</h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto">
          Add cloud storage to your Perchance generator in less than 2 minutes.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        
        {/* Left Nav / Core Concepts */}
        <div className="lg:col-span-1 space-y-6">
           <div className="sticky top-24">
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-4">Quick Start</h3>
              <nav className="space-y-2 border-l border-slate-800 ml-2">
                <NavLink target="concepts" label="Core Concepts" />
                <NavLink target="quickstart" label="SDK Setup" />
                <NavLink target="configuration" label="Configuration" />
                <NavLink target="writing" label="Writing Data" />
                <NavLink target="reading" label="Reading Data" />
                <NavLink target="management" label="Data Management" />
                <NavLink target="limits" label="Limits & Quotas" />
                <NavLink target="usecases" label="Common Use Cases" />
                <NavLink target="security" label="Security Rules" />
              </nav>

              <div className="mt-8 p-4 bg-gradient-to-br from-brand-900/50 to-slate-900 border border-brand-500/20 rounded-xl">
                 <h4 className="flex items-center text-brand-300 font-semibold mb-2">
                   <Cpu className="w-4 h-4 mr-2" /> AI Assistant
                 </h4>
                 <p className="text-xs text-slate-400 mb-3">Not sure how to code it? Describe what you want.</p>
                 <form onSubmit={handleAskAI}>
                   <textarea 
                      className="w-full bg-slate-950 border border-slate-700 rounded-md p-2 text-xs text-slate-300 focus:border-brand-500 focus:outline-none resize-none"
                      rows={3}
                      placeholder="e.g., 'Save a player's high score named generic-rpg'"
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                   />
                   <Button 
                    type="submit" 
                    variant="primary" 
                    className="w-full mt-2 text-xs py-1" 
                    isLoading={loading}
                    disabled={!aiPrompt}
                   >
                     Generate Code
                   </Button>
                 </form>
              </div>
           </div>
        </div>

        {/* Main Content */}
        <div className="lg:col-span-3 space-y-16">
          
          {/* Core Concepts */}
          <section id="concepts" className="scroll-mt-24">
            <h2 className="text-3xl font-bold text-white mb-6 flex items-center">
              <Database className="w-8 h-8 mr-3 text-brand-500" /> Core Concepts
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="bg-slate-900/40 border-slate-800">
                <h3 className="text-lg font-bold text-brand-400 mb-2 flex items-center">
                  <Layers className="w-5 h-5 mr-2" /> Collections
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Think of a <strong>Collection</strong> as a folder or a table. It's a container for your data. 
                  You might have a collection for <code>scores</code>, another for <code>users</code>, and one for <code>world_state</code>.
                  Collections are created automatically the first time you add data to them.
                </p>
              </Card>
              <Card className="bg-slate-900/40 border-slate-800">
                <h3 className="text-lg font-bold text-brand-400 mb-2 flex items-center">
                  <FileJson className="w-5 h-5 mr-2" /> Entries (Documents)
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  An <strong>Entry</strong> is a single piece of data inside a collection. It's a standard JSON object.
                  Every entry automatically gets a unique <code>id</code> and a <code>_created</code> timestamp when saved.
                  You can store strings, numbers, booleans, arrays, and even nested objects.
                </p>
              </Card>
            </div>
          </section>

          {/* AI Result Section */}
          {aiResponse && (
            <div className="animate-in fade-in slide-in-from-top-4 duration-500">
               <Card className="border-brand-500/50 shadow-lg shadow-brand-500/10">
                 <div className="flex justify-between items-center mb-2">
                   <h3 className="text-brand-400 font-semibold flex items-center"><Terminal className="w-4 h-4 mr-2"/> Generated Solution</h3>
                   <div className="flex items-center space-x-2">
                     <Button 
                       size="sm" 
                       variant="outline" 
                       onClick={() => copyToClipboard(aiResponse, 'ai')}
                       icon={copiedSection === 'ai' ? Check : Copy}
                       className="h-7 text-[10px]"
                     >
                       {copiedSection === 'ai' ? 'Copied' : 'Copy'}
                     </Button>
                     <button onClick={() => setAiResponse('')} className="text-xs text-slate-500 hover:text-white">Clear</button>
                   </div>
                 </div>
                 <pre className="bg-slate-950 p-4 rounded-lg overflow-x-auto text-sm font-mono text-emerald-400">
                   {aiResponse}
                 </pre>
               </Card>
            </div>
          )}

          {/* Setup Guide */}
          <div className="space-y-12">
            
             <section id="quickstart">
               <div className="flex items-center justify-between mb-4">
                 <div className="flex items-center space-x-3">
                    <span className="bg-slate-800 rounded-lg w-8 h-8 flex items-center justify-center text-sm font-bold border border-slate-700">1</span>
                    <h2 className="text-2xl font-bold text-white">SDK Setup</h2>
                 </div>
                 <Button 
                   size="sm" 
                   variant="outline" 
                   onClick={() => copyToClipboard(CLIENT_SDK_CODE, 'sdk')}
                   icon={copiedSection === 'sdk' ? Check : Copy}
                 >
                   {copiedSection === 'sdk' ? 'Copied' : 'Copy Code'}
                 </Button>
               </div>
               <p className="text-slate-400 mb-4">
                 Copy the code below and paste it at the top of your Perchance HTML Panel (or inside your HTML module). 
                 This connects your generator to the PerDB Cloud.
               </p>
               <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
                 <div className="bg-[#0f172a] p-4 overflow-x-auto">
                   <pre className="font-mono text-sm leading-relaxed text-emerald-300">
                     {CLIENT_SDK_CODE}
                   </pre>
                 </div>
               </div>
            </section>

            <div className="w-full h-px bg-slate-800" />

            <section id="configuration">
               <div className="flex items-center justify-between mb-4">
                 <div className="flex items-center space-x-3">
                    <span className="bg-slate-800 rounded-lg w-8 h-8 flex items-center justify-center text-sm font-bold border border-slate-700">2</span>
                    <h2 className="text-2xl font-bold text-white">Configuration</h2>
                 </div>
                 <Button 
                   size="sm" 
                   variant="outline" 
                   onClick={() => copyToClipboard('const db = new PerDB("pk_live_YOUR_API_KEY_HERE");', 'config')}
                   icon={copiedSection === 'config' ? Check : Copy}
                 >
                   {copiedSection === 'config' ? 'Copied' : 'Copy Code'}
                 </Button>
               </div>
               <p className="text-slate-400 mb-4">
                 Initialize the SDK by creating a new <code>PerDB</code> instance with your unique API key. This key is used by the SDK to authenticate all your requests.
               </p>
               <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl mb-6">
                 <div className="bg-[#0f172a] p-4 overflow-x-auto">
                   <pre className="font-mono text-sm leading-relaxed text-slate-300">
                     {`const db = new PerDB("pk_live_YOUR_API_KEY_HERE");
 // Optional: Use secret key to bypass rules (admin tasks)
 // const db = new PerDB("pk_live_API_KEY", "sk_live_SECRET_KEY");`}
                   </pre>
                 </div>
               </div>
               
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                 <div className="p-4 bg-slate-900/50 border border-slate-800 rounded-lg">
                   <h4 className="text-brand-400 font-bold text-xs uppercase mb-2 flex items-center">
                     <Shield className="w-3 h-3 mr-2" /> Domain Locking
                   </h4>
                   <p className="text-xs text-slate-400">
                     Protect your API key by restricting it to specific Perchance generators in the dashboard. This prevents others from using your key in their own projects.
                   </p>
                 </div>
                 <div className="p-4 bg-slate-900/50 border border-slate-800 rounded-lg">
                   <h4 className="text-red-400 font-bold text-xs uppercase mb-2 flex items-center">
                     <Lock className="w-3 h-3 mr-2" /> Secret Admin Key
                   </h4>
                   <p className="text-xs text-slate-400">
                     Use the Secret Key for administrative tasks. It bypasses all security rules and domain locking. <strong>Never expose this key in public code.</strong>
                   </p>
                 </div>
               </div>
            </section>

            <div className="w-full h-px bg-slate-800" />

            <section id="writing">
               <div className="flex items-center justify-between mb-4">
                 <div className="flex items-center space-x-3">
                    <span className="bg-slate-800 rounded-lg w-8 h-8 flex items-center justify-center text-sm font-bold border border-slate-700">3</span>
                    <h2 className="text-2xl font-bold text-white">Writing Data</h2>
                 </div>
                 <Button 
                   size="sm" 
                   variant="outline" 
                   onClick={() => copyToClipboard('await db.add("characters", {\n  name: "Sir Lancelot",\n  class: "Paladin",\n  level: 5,\n  inventory: ["sword", "shield"]\n});', 'writing')}
                   icon={copiedSection === 'writing' ? Check : Copy}
                 >
                   {copiedSection === 'writing' ? 'Copied' : 'Copy Code'}
                 </Button>
               </div>
               <p className="text-slate-400 mb-6">
                 Use <code>db.add(collection, data)</code> to save JSON data. If the collection doesn't exist, it will be created automatically.
               </p>
               <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
                 <div className="bg-[#0f172a] p-4 overflow-x-auto">
                   <pre className="font-mono text-sm leading-relaxed text-slate-300">
                     {`await db.add("characters", {
  name: "Sir Lancelot",
  class: "Paladin",
  level: 5,
  inventory: ["sword", "shield"]
});`}
                   </pre>
                 </div>
               </div>
            </section>

            <section id="reading">
               <div className="flex items-center justify-between mb-4">
                 <div className="flex items-center space-x-3">
                    <span className="bg-slate-800 rounded-lg w-8 h-8 flex items-center justify-center text-sm font-bold border border-slate-700">4</span>
                    <h2 className="text-2xl font-bold text-white">Reading Data</h2>
                 </div>
                 <Button 
                   size="sm" 
                   variant="outline" 
                   onClick={() => copyToClipboard('const scores = await db.get("scores", 10);\n\nscores.forEach(s => {\n  console.log(s.name + ": " + s.points);\n});', 'reading')}
                   icon={copiedSection === 'reading' ? Check : Copy}
                 >
                   {copiedSection === 'reading' ? 'Copied' : 'Copy Code'}
                 </Button>
               </div>
               <p className="text-slate-400 mb-6">
                 Use <code>db.get(collection, limit)</code> to retrieve the most recent entries. (Default: 50, Max: 200)
               </p>
               <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
                 <div className="bg-[#0f172a] p-4 overflow-x-auto">
                   <pre className="font-mono text-sm leading-relaxed text-slate-300">
                     {`const scores = await db.get("scores", 10);

scores.forEach(s => {
  // Access properties like normal JS objects
  console.log(s.name + ": " + s.points);
});`}
                   </pre>
                 </div>
               </div>
            </section>

            <div className="w-full h-px bg-slate-800" />

            <section id="management">
               <div className="flex items-center space-x-3 mb-6">
                  <Server className="w-6 h-6 text-brand-400" />
                  <h2 className="text-2xl font-bold text-white">Data Management</h2>
               </div>
               <p className="text-slate-400 mb-6">
                  The PerDB Dashboard provides powerful tools to manage your data without writing code.
               </p>
               <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 bg-slate-900/50 border border-slate-800 rounded-lg">
                     <h4 className="text-slate-200 font-bold text-xs uppercase mb-2">View All</h4>
                     <p className="text-xs text-slate-500">Open the full collection view to see every entry in a paginated list.</p>
                  </div>
                  <div className="p-4 bg-slate-900/50 border border-slate-800 rounded-lg">
                     <h4 className="text-slate-200 font-bold text-xs uppercase mb-2">Search</h4>
                     <p className="text-xs text-slate-500">Instantly filter through thousands of entries using the built-in search bar.</p>
                  </div>
                  <div className="p-4 bg-slate-900/50 border border-slate-800 rounded-lg">
                     <h4 className="text-slate-200 font-bold text-xs uppercase mb-2">Bulk Actions</h4>
                     <p className="text-xs text-slate-500">Select multiple entries to delete them all at once, saving you time.</p>
                  </div>
               </div>
            </section>

            <div className="w-full h-px bg-slate-800" />

            <section id="limits">
               <div className="flex items-center space-x-3 mb-6">
                  <Cpu className="w-6 h-6 text-brand-400" />
                  <h2 className="text-2xl font-bold text-white">Limits & Quotas</h2>
               </div>
               <p className="text-slate-400 mb-6">
                  To ensure the platform remains free and performant for everyone, we enforce the following limits:
               </p>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card className="bg-slate-900/40 border-slate-800">
                    <h3 className="text-lg font-bold text-white mb-2">Project Limits</h3>
                    <ul className="space-y-2 text-sm text-slate-400">
                      <li className="flex justify-between">
                        <span>Max Projects per User</span>
                        <span className="text-brand-400 font-mono">5</span>
                      </li>
                      <li className="flex justify-between">
                        <span>Max Collections per Project</span>
                        <span className="text-brand-400 font-mono">Unlimited</span>
                      </li>
                      <li className="flex justify-between">
                        <span>Max Entries per Collection</span>
                        <span className="text-brand-400 font-mono">10,000*</span>
                      </li>
                    </ul>
                  </Card>
                  <Card className="bg-slate-900/40 border-slate-800">
                    <h3 className="text-lg font-bold text-white mb-2">API Quotas</h3>
                    <ul className="space-y-2 text-sm text-slate-400">
                      <li className="flex justify-between">
                        <span>Rate Limit (per API Key)</span>
                        <span className="text-brand-400 font-mono">60 req/min</span>
                      </li>
                      <li className="flex justify-between">
                        <span>Max Request Payload</span>
                        <span className="text-brand-400 font-mono">100 KB</span>
                      </li>
                      <li className="flex justify-between">
                        <span>Read Cache TTL</span>
                        <span className="text-brand-400 font-mono">30 seconds</span>
                      </li>
                    </ul>
                  </Card>
               </div>
               <div className="mt-6 p-4 bg-brand-900/10 border border-brand-500/20 rounded-xl">
                  <p className="text-xs text-slate-400 leading-relaxed">
                    <strong>Note on Caching:</strong> PerDB uses aggressive server-side caching to reduce database load. 
                    If you write data and then immediately read it, you might see the "old" data for up to 30 seconds due to the read cache.
                  </p>
               </div>
            </section>

            <div className="w-full h-px bg-slate-800" />

            <section id="pricing">
               <div className="flex items-center space-x-3 mb-6">
                  <Badge variant="info">Free Beta</Badge>
                  <h2 className="text-2xl font-bold text-white">Pricing & Availability</h2>
               </div>
               <p className="text-slate-400 mb-4">
                 PerDB is currently <strong>100% free</strong> during our open beta phase. We want to help the Perchance community build amazing things without worrying about costs.
               </p>
               <div className="bg-amber-900/10 border border-amber-500/20 p-4 rounded-xl mb-6">
                 <h4 className="text-amber-400 font-bold text-xs uppercase mb-2 flex items-center">
                   <Shield className="w-3 h-3 mr-2" /> Domain Restriction
                 </h4>
                 <p className="text-xs text-slate-400">
                   To prevent abuse and keep the service free, PerDB currently only accepts requests from projects hosted on <strong>perchance.org</strong> (e.g., <code>perchance.org/your-project</code>). Local development (localhost) is also supported.
                 </p>
               </div>
               <p className="text-sm text-slate-500 italic">
                 Note: We may monetize with non-intrusive ads in the future to cover server costs while keeping the platform open-source and community-focused.
               </p>
            </section>

            <div className="w-full h-px bg-slate-800" />

            <section id="examples">
               <div className="flex items-center space-x-3 mb-6">
                  <Play className="w-6 h-6 text-brand-400" />
                  <h2 className="text-2xl font-bold text-white">Live Examples</h2>
               </div>
               <Card className="bg-slate-900/50 border-brand-500/20 hover:border-brand-500/40 transition-colors group">
                 <div className="flex justify-between items-start">
                   <div>
                     <h3 className="text-lg font-semibold text-white mb-2">Per-Chat</h3>
                     <p className="text-sm text-slate-400 mb-4">A real-time chat application built entirely on Perchance using PerDB for message persistence.</p>
                     <a 
                       href="https://perchance.org/per-chat" 
                       target="_blank" 
                       rel="noopener noreferrer"
                       className="inline-flex items-center text-brand-400 hover:text-brand-300 font-medium text-sm"
                     >
                       Try Per-Chat <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                     </a>
                   </div>
                   <div className="w-12 h-12 bg-brand-500/10 rounded-lg flex items-center justify-center">
                     <Database className="w-6 h-6 text-brand-400" />
                   </div>
                 </div>
               </Card>
            </section>

            <div className="w-full h-px bg-slate-800" />

            <section id="usecases">
               <div className="flex items-center space-x-3 mb-6">
                  <Database className="w-6 h-6 text-brand-400" />
                  <h2 className="text-2xl font-bold text-white">Common Use Cases</h2>
               </div>
               
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card className="bg-slate-900/50 border-slate-800">
                    <h3 className="text-lg font-semibold text-white mb-2">Global Leaderboards</h3>
                    <p className="text-sm text-slate-400 mb-4">Store player scores and fetch them to display a top-10 list.</p>
                    <pre className="bg-slate-950 p-3 rounded text-xs text-brand-300 overflow-x-auto">
{`// Save score
await db.add("leaderboard", { 
  user: "Player1", 
  score: 500 
});

// Fetch top 10
const top = await db.get("leaderboard", 10);`}
                    </pre>
                  </Card>

                  <Card className="bg-slate-900/50 border-slate-800">
                    <h3 className="text-lg font-semibold text-white mb-2">Persistent World State</h3>
                    <p className="text-sm text-slate-400 mb-4">Save the state of a shared world that all users can see and modify.</p>
                    <pre className="bg-slate-950 p-3 rounded text-xs text-brand-300 overflow-x-auto">
{`// Update world time
await db.add("world", { 
  time: "Day", 
  weather: "Sunny" 
});

// Get latest state
const state = await db.get("world", 1);`}
                    </pre>
                  </Card>
               </div>
            </section>

            <div className="w-full h-px bg-slate-800" />

            <section id="security">
               <div className="flex items-center justify-between mb-4">
                 <div className="flex items-center space-x-3">
                    <span className="bg-slate-800 rounded-lg w-8 h-8 flex items-center justify-center text-sm font-bold border border-slate-700">5</span>
                    <h2 className="text-2xl font-bold text-white">Security Rules</h2>
                 </div>
                 <Button 
                   size="sm" 
                   variant="outline" 
                   onClick={() => copyToClipboard('{\n  "scores": {\n    ".read": "true",\n    ".write": "newData.score > 0"\n  }\n}', 'security')}
                   icon={copiedSection === 'security' ? Check : Copy}
                 >
                   {copiedSection === 'security' ? 'Copied' : 'Copy Code'}
                 </Button>
               </div>
               <p className="text-slate-400 mb-6">
                 Protect your data by defining rules in the Dashboard. Rules are JSON objects where keys are collection names, and values define <code>.read</code> and <code>.write</code> permissions.
               </p>
               
               <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl mb-8">
                 <div className="bg-[#0f172a] p-4 overflow-x-auto">
                   <pre className="font-mono text-sm leading-relaxed text-slate-300">
                     {`{
  "scores": {
    ".read": "true",
    ".write": "newData.score > 0"
  },
  "private_data": {
    ".read": "auth.id == 'admin'",
    ".write": "auth.id == 'admin'"
  }
}`}
                   </pre>
                 </div>
               </div>

               <div className="space-y-6">
                  <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800">
                    <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
                      <Lock className="w-5 h-5 mr-2 text-brand-400" /> Rule Context Variables
                    </h3>
                    <ul className="space-y-4 text-sm text-slate-400">
                      <li className="flex gap-3">
                        <code className="text-brand-300 shrink-0">auth</code>
                        <span>The authentication context passed via <code>setAuth()</code>. Usually an object with an <code>id</code>.</span>
                      </li>
                      <li className="flex gap-3">
                        <code className="text-brand-300 shrink-0">newData</code>
                        <span>The data being written (available in <code>.write</code>).</span>
                      </li>
                      <li className="flex gap-3">
                        <code className="text-brand-300 shrink-0">data</code>
                        <span>The existing data in the database (available in <code>.write</code> for updates/deletes).</span>
                      </li>
                    </ul>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-emerald-900/10 border border-emerald-500/20 rounded-lg">
                      <h4 className="text-emerald-400 font-bold text-xs uppercase mb-2">Public Read</h4>
                      <code className="text-xs text-slate-300">".read": "true"</code>
                    </div>
                    <div className="p-4 bg-amber-900/10 border border-amber-500/20 rounded-lg">
                      <h4 className="text-amber-400 font-bold text-xs uppercase mb-2">Authenticated Write</h4>
                      <code className="text-xs text-slate-300">".write": "auth != null"</code>
                    </div>
                    <div className="p-4 bg-blue-900/10 border border-blue-500/20 rounded-lg">
                      <h4 className="text-blue-400 font-bold text-xs uppercase mb-2">Data Validation</h4>
                      <code className="text-xs text-slate-300">".write": "newData.score &gt; 0"</code>
                    </div>
                    <div className="p-4 bg-purple-900/10 border border-purple-500/20 rounded-lg">
                      <h4 className="text-purple-400 font-bold text-xs uppercase mb-2">Owner Only</h4>
                      <code className="text-xs text-slate-300">".write": "auth.id == data.ownerId"</code>
                    </div>
                  </div>
               </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
