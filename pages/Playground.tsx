
import React, { useState, useEffect, useRef } from 'react';
import { Play, RotateCcw, Database, Cpu } from 'lucide-react';
import { Button } from '../components/ui';
import { FirebaseService } from '../services/firebaseService';
import { LogEntry } from '../types';
import { generateCodeSnippet } from '../services/aiService';

// --- Tab: JS Runtime ---

const INITIAL_CODE = `// 1. Initialize DB 
// (Replace with a key from your Dashboard)
const apiKey = "pk_live_REPLACE_ME";
// Optional: Use your Secret Key to bypass rules for admin tasks
const secretKey = ""; 

// 2. Define some data
const hero = {
  name: "Hero_" + Math.floor(Math.random() * 1000),
  hp: 100,
  gold: 50
};

// 3. Save to 'players' collection
log("Saving hero...", "info");
const result = await db.save(apiKey, "players", hero);
log("Saved! ID: " + result.id, "success");

// 4. Update the hero
log("Updating hero gold...", "info");
await db.update(apiKey, "players", result.id, { gold: 75 }, secretKey);
log("Updated!", "success");

// 5. Fetch all players
log("Fetching leaderboard...", "info");
const players = await db.fetch(apiKey, "players");
log("Found " + players.length + " players.", "info");
console.log(players); // Check console for full object

// 6. Delete the hero (uncomment to test)
// log("Deleting hero...", "info");
// await db.delete(apiKey, "players", result.id, secretKey);
// log("Deleted!", "success");
`;

export const Playground: React.FC = () => {
  const [code, setCode] = useState(INITIAL_CODE);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const logsEndRef = useRef<HTMLDivElement>(null);

  const addLog = (message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    setLogs(prev => [...prev, {
      timestamp: new Date().toLocaleTimeString(),
      type,
      message
    }]);
  };

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const runCode = async () => {
    setIsRunning(true);
    setLogs([]);
    addLog("Starting execution...", "info");

    try {
      const executionContext = async () => {
        const db = {
          save: (key: string, col: string, data: any) => FirebaseService.runtimeAdd(key, col, data),
          fetch: (key: string, col: string) => FirebaseService.runtimeGet(key, col),
          update: (key: string, col: string, id: string, data: any, secretKey?: string) => FirebaseService.runtimeUpdate(key, col, id, data, secretKey),
          delete: (key: string, col: string, id: string, secretKey?: string) => FirebaseService.runtimeDelete(key, col, id, secretKey)
        };
        const log = (msg: string, type: any) => addLog(msg, type);

        // Basic safety wrapper
        const userFunction = new Function('db', 'log', 'FirebaseService', `
          return (async () => {
            try {
              ${code}
            } catch (err) {
              log(err.message, "error");
              console.error(err);
            }
          })();
        `);

        await userFunction(db, log, FirebaseService);
      };

      await executionContext();
      
    } catch (error: any) {
      addLog(`Runtime Error: ${error.message}`, 'error');
    } finally {
      setIsRunning(false);
      addLog("Execution finished.", "warning");
    }
  };

  const generateCode = async () => {
    if (!aiPrompt.trim()) return;
    setIsGenerating(true);
    const newCode = await generateCodeSnippet(aiPrompt);
    setCode(newCode);
    setIsGenerating(false);
  };

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col lg:flex-row bg-slate-950 overflow-hidden">
      <div className="flex-1 flex flex-col border-r border-slate-800">
        <div className="h-12 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4">
          <div className="flex items-center text-slate-400 text-sm">
            <Database className="w-4 h-4 mr-2" />
            <span>script.js runner</span>
          </div>
          <div className="flex space-x-2">
            <Button size="sm" variant="secondary" onClick={() => setCode(INITIAL_CODE)} icon={RotateCcw} title="Reset Code">
              Reset
            </Button>
            <Button size="sm" onClick={runCode} disabled={isRunning} icon={Play}>
              {isRunning ? 'Running...' : 'Run Code'}
            </Button>
          </div>
        </div>
        <div className="flex-1 relative">
          <textarea
            className="absolute inset-0 w-full h-full bg-[#0f172a] text-slate-300 font-mono text-sm p-4 resize-none focus:outline-none leading-relaxed"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck="false"
          />
        </div>
        
        {/* AI Generator */}
        <div className="p-4 bg-slate-900 border-t border-slate-800">
          <div className="flex gap-2">
            <input 
              className="flex-1 bg-slate-950 border border-slate-700 rounded-md p-2 text-sm text-slate-300 focus:border-brand-500 focus:outline-none"
              placeholder="Describe what you want to build..."
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
            />
            <Button onClick={generateCode} isLoading={isGenerating} icon={Cpu}>Generate</Button>
          </div>
        </div>
      </div>

      <div className="w-full lg:w-[400px] flex flex-col bg-[#0b1120]">
        <div className="h-12 bg-slate-900 border-b border-slate-800 flex items-center px-4">
          <span className="text-slate-400 text-sm font-medium">Console Output</span>
        </div>
        <div className="flex-1 p-4 overflow-y-auto font-mono text-xs space-y-2">
          {logs.length === 0 && (
            <div className="text-slate-600 italic">Ready to execute...</div>
          )}
          {logs.map((log, i) => (
            <div key={i} className="flex gap-2 animate-in fade-in duration-300">
              <span className="text-slate-600 shrink-0">[{log.timestamp}]</span>
              <span className={`${
                log.type === 'error' ? 'text-red-400' :
                log.type === 'success' ? 'text-emerald-400' :
                log.type === 'warning' ? 'text-amber-400' :
                'text-slate-300'
              }`}>
                {log.type === 'error' && '❌ '}
                {log.type === 'success' && '✓ '}
                {log.message}
              </span>
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
};
