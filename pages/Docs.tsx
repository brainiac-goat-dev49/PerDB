
import React, { useState } from 'react';
import { BookOpen, Code, Terminal, Cpu, Server, Shield, Database, Lock, Copy, Check } from 'lucide-react';
import { Card, Button } from '../components/ui';
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

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://perdb.vercel.app';
  const apiEndpoint = `${currentOrigin}/api`;

  const CLIENT_SDK_CODE = `/**
 * PerDB SDK (v1.0)
 * Copy and paste this into your Perchance HTML Panel
 */

class PerDB {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.auth = null;
    // The Live PerDB Platform Endpoint
    this.endpoint = "${apiEndpoint}"; 
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
   * @param {number} limit - Max number of items (default 50)
   */
  async get(collection, limit = 50) {
    try {
      const headers = { "x-api-key": this.apiKey };
      
      if (this.auth) {
        headers["x-perdb-auth"] = typeof this.auth === 'object' 
          ? JSON.stringify(this.auth) 
          : this.auth;
      }

      const res = await fetch(\`\${this.endpoint}?collection=\${collection}&limit=\${limit}\`, {
        method: "GET",
        headers: headers
      });
      return await res.json();
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
                <NavLink target="quickstart" label="SDK Setup" />
                <NavLink target="configuration" label="Configuration" />
                <NavLink target="writing" label="Writing Data" />
                <NavLink target="reading" label="Reading Data" />
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
                     {`const db = new PerDB("pk_live_YOUR_API_KEY_HERE");`}
                   </pre>
                 </div>
               </div>
               
               <div className="space-y-4 text-sm text-slate-400">
                 <p>
                   <strong>Endpoint URL:</strong> You do not need to configure an endpoint. The <code>PerDB</code> class automatically sets the endpoint to <code>{apiEndpoint}</code> internally upon initialization.
                 </p>
                 <p>
                   <strong>Multi-device Login:</strong> Yes! Because PerDB stores your project data in the cloud, your users can log in from any device. As long as they use the same authentication method you've implemented in your Perchance project, their data will sync automatically across all their devices.
                 </p>
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
                 Use <code>db.get(collection, limit)</code> to retrieve the most recent entries.
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

            <section id="security">
               <div className="flex items-center justify-between mb-4">
                 <div className="flex items-center space-x-3">
                    <span className="bg-slate-800 rounded-lg w-8 h-8 flex items-center justify-center text-sm font-bold border border-slate-700">5</span>
                    <h2 className="text-2xl font-bold text-white">Security Rules</h2>
                 </div>
                 <Button 
                   size="sm" 
                   variant="outline" 
                   onClick={() => copyToClipboard('{\n  "scores": {\n    ".read": "true",\n    ".write": "auth != null"\n  }\n}', 'security')}
                   icon={copiedSection === 'security' ? Check : Copy}
                 >
                   {copiedSection === 'security' ? 'Copied' : 'Copy Code'}
                 </Button>
               </div>
               <p className="text-slate-400 mb-6">
                 Protect your data by defining rules in the Dashboard. Rules are JSON objects where keys are collection names, and values define <code>.read</code> and <code>.write</code> permissions.
               </p>
               <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
                 <div className="bg-[#0f172a] p-4 overflow-x-auto">
                   <pre className="font-mono text-sm leading-relaxed text-slate-300">
                     {`{
  "scores": {
    ".read": "true",
    ".write": "auth != null"
  }
}`}
                   </pre>
                 </div>
               </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
