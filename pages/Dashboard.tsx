
import React, { useState, useEffect } from 'react';
import { Plus, Database, Key, Trash2, RefreshCw, Layers, Table as TableIcon, FileJson, Search, Pencil, Save, X, ChevronLeft, ChevronRight, Shield, Play, CheckCircle, XCircle } from 'lucide-react';
import { FirebaseService } from '../services/firebaseService';
import { Project, Collection, DBEntry } from '../types';
import { Button, Card, Input, Badge, Modal } from '../components/ui';

// --- Sub-components for Data Visualization ---

const ITEMS_PER_PAGE = 10;

interface CollectionTableProps {
  entries: DBEntry[];
  onEdit: (entry: DBEntry) => void;
  onDelete: (entry: DBEntry) => void;
}

const CollectionTable: React.FC<CollectionTableProps> = ({ 
  entries, 
  onEdit, 
  onDelete 
}) => {
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [entries]);

  if (entries.length === 0) {
    return <div className="p-8 text-center text-slate-500 italic text-sm">No records in this collection. Add data to see it here.</div>;
  }

  const totalPages = Math.ceil(entries.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedEntries = entries.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const allKeys = Array.from(new Set(entries.flatMap(entry => Object.keys(entry)))) as string[];
  
  const headers = [
    'id',
    ...allKeys.filter(k => k !== 'id' && k !== '_created').sort(),
    ...(allKeys.includes('_created') ? ['_created'] : [])
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="overflow-x-auto custom-scrollbar pb-2 flex-1">
        <table className="min-w-full divide-y divide-slate-800/50 text-left border-collapse">
          <thead className="bg-slate-900 sticky top-0 z-10">
            <tr>
              {headers.map(header => (
                <th key={header} className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap border-b border-slate-700 select-none">
                  {header}
                </th>
              ))}
              <th className="px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap border-b border-slate-700 text-right sticky right-0 bg-slate-900 shadow-[-10px_0_10px_-5px_rgba(0,0,0,0.3)]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-slate-900/20 divide-y divide-slate-800/50">
            {paginatedEntries.map((entry) => (
              <tr key={entry.id} className="hover:bg-slate-800/50 transition-colors group">
                {headers.map(header => {
                  const value = entry[header];
                  let displayValue: React.ReactNode = value;
                  let isComplex = false;
                  let isEmpty = value === null || value === undefined;

                  if (isEmpty) {
                    displayValue = <span className="text-slate-700">-</span>;
                  } else if (typeof value === 'object') {
                    displayValue = JSON.stringify(value);
                    isComplex = true;
                  } else if (typeof value === 'boolean') {
                    displayValue = value ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">TRUE</span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">FALSE</span>
                    );
                  }

                  return (
                    <td key={`${entry.id}-${header}`} className="px-4 py-2 text-sm text-slate-300 whitespace-nowrap border-r border-slate-800/30 last:border-r-0 max-w-[250px]">
                      <div 
                        className={`truncate ${isComplex ? 'font-mono text-xs text-slate-500' : ''}`} 
                        title={typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                      >
                        {displayValue}
                      </div>
                    </td>
                  );
                })}
                <td className="px-4 py-2 text-right sticky right-0 bg-slate-900/90 group-hover:bg-slate-800 backdrop-blur-sm border-l border-slate-800/50 shadow-[-10px_0_10px_-5px_rgba(0,0,0,0.3)]">
                   <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => onEdit(entry)} className="p-1 text-slate-400 hover:text-brand-400 hover:bg-brand-500/10 rounded transition-colors" title="Edit JSON">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => onDelete(entry)} className="p-1 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                   </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 bg-slate-900/50 border-t border-slate-700/50">
          <div className="text-xs text-slate-400">
            Showing <span className="font-medium text-slate-200">{startIndex + 1}</span> to <span className="font-medium text-slate-200">{Math.min(startIndex + ITEMS_PER_PAGE, entries.length)}</span> of <span className="font-medium text-slate-200">{entries.length}</span> results
          </div>
          <div className="flex space-x-2">
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-2"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center px-2 text-xs font-mono text-slate-400 bg-slate-800 rounded">
              Page {currentPage} / {totalPages}
            </div>
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-2"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

interface CollectionViewerProps {
  collection: Collection;
  projectApiKey: string;
  onRefresh: () => void;
}

const CollectionViewer: React.FC<CollectionViewerProps> = ({ 
  collection, 
  projectApiKey,
  onRefresh 
}) => {
  const [viewMode, setViewMode] = useState<'table' | 'json'>('table');
  const [editingEntry, setEditingEntry] = useState<DBEntry | null>(null);
  const [editJson, setEditJson] = useState('');
  const [deletingEntry, setDeletingEntry] = useState<DBEntry | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleEditClick = (entry: DBEntry) => {
    setEditingEntry(entry);
    setEditJson(JSON.stringify(entry, null, 2));
  };

  const handleSaveEdit = async () => {
    if (!editingEntry) return;
    setIsProcessing(true);
    try {
      const parsedData = JSON.parse(editJson);
      const { id, ...dataToUpdate } = parsedData; 
      await FirebaseService.runtimeUpdate(projectApiKey, collection.name, editingEntry.id, dataToUpdate);
      setEditingEntry(null);
      onRefresh();
    } catch (e) {
      alert("Invalid JSON or Error Saving");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteClick = (entry: DBEntry) => {
    setDeletingEntry(entry);
  };

  const confirmDelete = async () => {
    if (!deletingEntry) return;
    setIsProcessing(true);
    await FirebaseService.runtimeDelete(projectApiKey, collection.name, deletingEntry.id);
    setDeletingEntry(null);
    setIsProcessing(false);
    onRefresh();
  };

  return (
    <>
      <div className="border border-slate-700/50 rounded-lg overflow-hidden mb-6 bg-slate-900/20 flex flex-col">
        <div className="bg-slate-900/80 px-4 py-3 border-b border-slate-700/50 flex flex-col sm:flex-row justify-between items-start sm:items-center backdrop-blur-sm gap-4 sm:gap-0">
           <div className="flex items-center space-x-3">
               <div className="font-mono text-sm text-brand-400 font-bold px-2.5 py-1 bg-brand-500/10 rounded border border-brand-500/20 flex items-center">
                 <Layers className="w-3.5 h-3.5 mr-2 opacity-70" />
                 {collection.name}
               </div>
               <span className="text-xs text-slate-500 border-l border-slate-700 pl-3">
                 {collection.entries.length} {collection.entries.length === 1 ? 'Entry' : 'Entries'}
               </span>
           </div>
           
           <div className="flex bg-slate-800 rounded-lg p-1 space-x-1">
              <button 
                onClick={() => setViewMode('table')}
                className={`flex items-center px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  viewMode === 'table' 
                    ? 'bg-slate-600 text-white shadow-sm' 
                    : 'text-slate-400 hover:text-slate-300 hover:bg-slate-700/50'
                }`}
              >
                <TableIcon className="w-3.5 h-3.5 mr-1.5" />
                Table
              </button>
              <button 
                onClick={() => setViewMode('json')}
                className={`flex items-center px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  viewMode === 'json' 
                    ? 'bg-slate-600 text-white shadow-sm' 
                    : 'text-slate-400 hover:text-slate-300 hover:bg-slate-700/50'
                }`}
              >
                <FileJson className="w-3.5 h-3.5 mr-1.5" />
                JSON
              </button>
           </div>
        </div>
        
        {viewMode === 'table' ? (
          <CollectionTable 
            entries={collection.entries} 
            onEdit={handleEditClick}
            onDelete={handleDeleteClick}
          />
        ) : (
          <div className="bg-slate-950 px-4 py-4 overflow-x-auto max-h-[500px] custom-scrollbar">
             <pre className="text-xs text-slate-400 font-mono leading-relaxed">
               {JSON.stringify(collection.entries, null, 2)}
             </pre>
          </div>
        )}
      </div>

      <Modal 
        isOpen={!!editingEntry} 
        onClose={() => setEditingEntry(null)} 
        title="Edit Document"
      >
        <div className="space-y-4">
           <div className="text-xs text-slate-500 font-mono mb-2">ID: {editingEntry?.id}</div>
           <textarea
             className="w-full h-64 bg-slate-950 border border-slate-700 rounded-lg p-3 font-mono text-sm text-slate-300 focus:ring-1 focus:ring-brand-500 focus:outline-none custom-scrollbar"
             value={editJson}
             onChange={(e) => setEditJson(e.target.value)}
           />
           <div className="flex justify-end gap-2">
             <Button variant="secondary" onClick={() => setEditingEntry(null)}>Cancel</Button>
             <Button icon={Save} onClick={handleSaveEdit} isLoading={isProcessing}>Save Changes</Button>
           </div>
        </div>
      </Modal>

      <Modal 
        isOpen={!!deletingEntry} 
        onClose={() => setDeletingEntry(null)} 
        title="Delete Document"
      >
        <div className="space-y-4">
           <p className="text-slate-300">Are you sure you want to delete this document?</p>
           <div className="bg-slate-950 p-3 rounded border border-slate-800 text-xs font-mono text-slate-500 overflow-hidden text-ellipsis whitespace-nowrap">
             ID: {deletingEntry?.id}
           </div>
           <div className="flex justify-end gap-2 pt-2">
             <Button variant="secondary" onClick={() => setDeletingEntry(null)}>Cancel</Button>
             <Button variant="danger" icon={Trash2} onClick={confirmDelete} isLoading={isProcessing}>Delete</Button>
           </div>
        </div>
      </Modal>
    </>
  );
};

// --- Rules Editor & Simulator ---

interface RulesEditorProps {
  project: Project;
  onUpdate: (newRules: string) => Promise<void>;
}

const RulesEditor: React.FC<RulesEditorProps> = ({ project, onUpdate }) => {
  const [rules, setRules] = useState(project.rules || "{}");
  const [isSaving, setIsSaving] = useState(false);
  const [testPath, setTestPath] = useState('users/user123');
  const [testAuth, setTestAuth] = useState('{"uid": "user123"}');
  const [testResource, setTestResource] = useState('{"id": "user123", "score": 10}');
  const [testRequestData, setTestRequestData] = useState('{"score": 20}');
  const [testAction, setTestAction] = useState<'read' | 'write'>('write');
  const [result, setResult] = useState<{ allowed: boolean; reason: string } | null>(null);

  // Sync internal state if project changes from outside
  useEffect(() => {
    setRules(project.rules || "{}");
  }, [project.id]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onUpdate(rules);
    } catch (e) {
      console.error(e);
      alert("Failed to save rules");
    } finally {
      setIsSaving(false);
    }
  };

  const simulateRequest = () => {
    try {
      const parsedRules = JSON.parse(rules);
      const collection = testPath.split('/')[0];
      
      const ctx = {
        auth: JSON.parse(testAuth),
        resource: JSON.parse(testResource),
        request: { data: JSON.parse(testRequestData) }
      };

      if (!parsedRules[collection]) {
        setResult({ allowed: false, reason: "Collection not defined in rules." });
        return;
      }

      const ruleKey = testAction === 'write' ? '.write' : '.read';
      const ruleString = parsedRules[collection][ruleKey];
      
      if (!ruleString) {
        setResult({ allowed: false, reason: "Default Deny: No rule found." });
        return;
      }

      const evaluator = new Function('auth', 'resource', 'request', `return ${ruleString};`);
      const isAllowed = evaluator(ctx.auth, ctx.resource, ctx.request);

      setResult({
        allowed: !!isAllowed,
        reason: isAllowed ? "Rule evaluated to true." : "Rule evaluated to false."
      });

    } catch (e: any) {
      setResult({ allowed: false, reason: `Syntax Error: ${e.message}` });
    }
  };

  return (
    <div className="flex flex-col lg:flex-row h-[600px] border border-slate-700 rounded-lg overflow-hidden bg-slate-950">
      {/* Editor */}
      <div className="flex-1 flex flex-col border-r border-slate-800">
        <div className="h-10 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-3">
           <span className="text-xs font-semibold text-emerald-400 font-mono">security_rules.json</span>
           <Button size="sm" onClick={handleSave} isLoading={isSaving} icon={Save} className="h-7 text-xs">Save Rules</Button>
        </div>
        <textarea
           className="flex-1 bg-[#0f172a] text-emerald-300 font-mono text-sm p-4 resize-none focus:outline-none leading-relaxed"
           value={rules}
           onChange={(e) => setRules(e.target.value)}
           spellCheck="false"
        />
      </div>

      {/* Simulator */}
      <div className="w-full lg:w-[350px] flex flex-col bg-[#0b1120] border-l border-slate-800">
         <div className="h-10 bg-slate-900 border-b border-slate-800 flex items-center px-3">
           <Shield className="w-3 h-3 mr-2 text-slate-400" />
           <span className="text-slate-400 text-xs font-medium">Simulator</span>
         </div>
         <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar">
            <div>
               <label className="text-[10px] text-slate-500 uppercase font-bold">Action</label>
               <div className="flex gap-2 mt-1">
                 <select className="bg-slate-800 border border-slate-700 rounded text-xs px-2 py-1 text-white flex-1" value={testAction} onChange={(e: any) => setTestAction(e.target.value)}>
                   <option value="read">Read</option>
                   <option value="write">Write</option>
                 </select>
               </div>
            </div>
            <div>
               <label className="text-[10px] text-slate-500 uppercase font-bold">Path</label>
               <input className="w-full bg-slate-800 border border-slate-700 rounded p-1.5 text-xs text-white mt-1 font-mono" value={testPath} onChange={(e) => setTestPath(e.target.value)} placeholder="col/doc" />
            </div>
            <div>
              <div className="flex justify-between">
                <label className="text-[10px] text-slate-500 uppercase font-bold">Auth (JSON)</label>
                <button className="text-[10px] text-brand-400 hover:text-brand-300" onClick={() => setTestAuth('null')}>Set Null</button>
              </div>
              <textarea className="w-full h-16 bg-slate-800 border border-slate-700 rounded p-2 text-[10px] text-slate-300 mt-1 font-mono resize-none" value={testAuth} onChange={(e) => setTestAuth(e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold">Existing Data (JSON)</label>
              <textarea className="w-full h-16 bg-slate-800 border border-slate-700 rounded p-2 text-[10px] text-slate-300 mt-1 font-mono resize-none" value={testResource} onChange={(e) => setTestResource(e.target.value)} />
            </div>
            <div className={testAction === 'read' ? 'opacity-50 pointer-events-none' : ''}>
              <label className="text-[10px] text-slate-500 uppercase font-bold">New Data (JSON)</label>
              <textarea className="w-full h-16 bg-slate-800 border border-slate-700 rounded p-2 text-[10px] text-slate-300 mt-1 font-mono resize-none" value={testRequestData} onChange={(e) => setTestRequestData(e.target.value)} />
            </div>
            <Button size="sm" className="w-full" onClick={simulateRequest} icon={Play}>Run Test</Button>

            {result && (
              <div className={`p-3 rounded border ${result.allowed ? 'bg-emerald-900/20 border-emerald-500/50' : 'bg-red-900/20 border-red-500/50'}`}>
                 <div className="flex items-center gap-2 mb-1">
                   {result.allowed ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-red-400" />}
                   <span className={`text-xs font-bold ${result.allowed ? 'text-emerald-400' : 'text-red-400'}`}>
                     {result.allowed ? 'ALLOWED' : 'DENIED'}
                   </span>
                 </div>
                 <p className="text-[10px] text-slate-400 pl-6">{result.reason}</p>
              </div>
            )}
         </div>
      </div>
    </div>
  );
};

// --- Main Dashboard Component ---

export const Dashboard: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<'data' | 'rules'>('data');
  const [deleteConfirmation, setDeleteConfirmation] = useState<string | null>(null);

  const fetchProjects = async () => {
    const data = await FirebaseService.getAllProjects();
    setProjects(data);
    if (selectedProject) {
      const updated = data.find(p => p.id === selectedProject.id);
      if (updated) setSelectedProject(updated);
      else setSelectedProject(null); // Project deleted
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    setLoading(true);
    try {
      await FirebaseService.createProject(newProjectName);
      setNewProjectName('');
      setIsCreating(false);
      await fetchProjects();
    } catch (err) {
      console.error(err);
      alert("Failed to create project");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!deleteConfirmation) return;
    setLoading(true);
    try {
      await FirebaseService.deleteProject(deleteConfirmation);
      setDeleteConfirmation(null);
      await fetchProjects();
    } catch (e) {
      console.error(e);
      alert("Error deleting project");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateRules = async (newRules: string) => {
    if (!selectedProject) return;
    await FirebaseService.updateProject(selectedProject.id, { rules: newRules });
    await fetchProjects(); // Refresh to ensure sync
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Dashboard</h1>
          <p className="text-slate-400 mt-1">Manage your Perchance cloud databases.</p>
        </div>
        <Button onClick={() => setIsCreating(!isCreating)} icon={Plus}>
          New Project
        </Button>
      </div>

      {isCreating && (
        <Card className="mb-8 border-brand-500/30 bg-brand-900/10">
          <form onSubmit={handleCreate} className="flex gap-4 items-end">
            <div className="flex-1">
              <Input 
                label="Project Name" 
                placeholder="e.g. My Fantasy RPG Generator" 
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                autoFocus
              />
            </div>
            <Button type="submit" disabled={!newProjectName} isLoading={loading}>
              Create Database
            </Button>
            <Button type="button" variant="secondary" onClick={() => setIsCreating(false)}>
              Cancel
            </Button>
          </form>
        </Card>
      )}

      {loading && projects.length === 0 ? (
        <div className="text-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-500 mx-auto mb-4"></div>
          <p className="text-slate-500">Loading your data...</p>
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-slate-700 rounded-2xl">
          <Database className="mx-auto h-12 w-12 text-slate-600 mb-4" />
          <h3 className="text-xl font-medium text-slate-300">No Projects Yet</h3>
          <p className="text-slate-500 mt-2 max-w-sm mx-auto">Create your first database to start syncing variables and creating leaderboards.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Project List */}
          <div className="lg:col-span-1 space-y-4">
            {projects.map(project => (
              <div 
                key={project.id}
                onClick={() => { setSelectedProject(project); setActiveTab('data'); }}
                className={`p-4 rounded-lg border cursor-pointer transition-all ${selectedProject?.id === project.id ? 'bg-brand-900/20 border-brand-500/50 shadow-lg shadow-brand-500/10' : 'bg-slate-800 border-slate-700 hover:border-slate-600'}`}
              >
                <div className="flex justify-between items-start">
                  <h3 className={`font-semibold ${selectedProject?.id === project.id ? 'text-brand-300' : 'text-slate-100'}`}>{project.name}</h3>
                  <Badge variant={selectedProject?.id === project.id ? 'info' : 'info'}>{project.collections.length} Colls</Badge>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-slate-500 font-mono">ID: {project.id}</span>
                  {selectedProject?.id === project.id && (
                    <span className="flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-brand-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-500"></span>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Project Details */}
          <div className="lg:col-span-2">
            {selectedProject ? (
              <div className="space-y-6">
                
                {/* Configuration Card with Custom Header for Delete Button */}
                <div className="bg-slate-800/50 border border-slate-700/50 backdrop-blur-sm rounded-xl p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold text-slate-100">Configuration</h3>
                    <Button 
                      variant="danger" 
                      size="sm" 
                      icon={Trash2} 
                      onClick={() => setDeleteConfirmation(selectedProject.id)}
                    >
                      Delete Project
                    </Button>
                  </div>
                  <div className="grid gap-6">
                    <div>
                      <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Public API Key</label>
                      <div className="flex mt-1.5 group">
                        <code className="flex-1 bg-slate-950 rounded-l-lg border border-r-0 border-slate-700 px-3 py-2 text-sm text-brand-300 font-mono overflow-x-auto whitespace-nowrap group-hover:border-slate-600 transition-colors">
                          {selectedProject.apiKey}
                        </code>
                        <button 
                          onClick={() => navigator.clipboard.writeText(selectedProject.apiKey)}
                          className="bg-slate-800 hover:bg-slate-700 border border-l-0 border-slate-700 group-hover:border-slate-600 px-3 rounded-r-lg text-slate-300 transition-all active:bg-slate-600"
                          title="Copy Key"
                        >
                          <Key className="w-4 h-4" />
                        </button>
                      </div>
                      <p className="text-xs text-slate-500 mt-2">
                        Use this key in your Perchance code: <span className="font-mono text-slate-400">new PerDB("{selectedProject.apiKey}")</span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Tabbed Interface for Data and Rules */}
                <div className="bg-slate-800/50 border border-slate-700/50 backdrop-blur-sm rounded-xl p-6 min-h-[500px]">
                   <div className="flex justify-between items-center mb-6">
                     <div className="flex space-x-4">
                       <button 
                         onClick={() => setActiveTab('data')}
                         className={`text-lg font-semibold transition-colors border-b-2 pb-1 ${activeTab === 'data' ? 'text-slate-100 border-brand-500' : 'text-slate-500 border-transparent hover:text-slate-300'}`}
                       >
                         Data Collections
                       </button>
                       <button 
                         onClick={() => setActiveTab('rules')}
                         className={`text-lg font-semibold transition-colors border-b-2 pb-1 ${activeTab === 'rules' ? 'text-slate-100 border-brand-500' : 'text-slate-500 border-transparent hover:text-slate-300'}`}
                       >
                         Security Rules
                       </button>
                     </div>
                     {activeTab === 'data' && (
                       <Button variant="outline" size="sm" icon={RefreshCw} onClick={fetchProjects} isLoading={loading}>
                          Refresh
                       </Button>
                     )}
                   </div>
                   
                   {activeTab === 'data' ? (
                      selectedProject.collections.length === 0 ? (
                        <div className="text-center py-12 text-slate-500 bg-slate-900/30 rounded-lg border border-slate-800 border-dashed">
                          <Layers className="w-12 h-12 mx-auto mb-3 opacity-20" />
                          <p className="text-lg font-medium text-slate-400">No data found</p>
                          <p className="text-sm mt-1 max-w-xs mx-auto">Collections will appear here automatically when you start saving data from your generator.</p>
                        </div>
                      ) : (
                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
                          {/* Analytics */}
                          <div className="grid grid-cols-2 gap-4 mb-6">
                            <Card className="p-4 border-slate-700/50 bg-slate-900/50">
                              <div className="text-xs text-slate-500 uppercase">Total Reads</div>
                              <div className="text-2xl font-bold text-white mt-1">
                                {selectedProject.totalReads?.toLocaleString() || 0}
                              </div>
                            </Card>
                            <Card className="p-4 border-slate-700/50 bg-slate-900/50">
                              <div className="text-xs text-slate-500 uppercase">Total Writes</div>
                              <div className="text-2xl font-bold text-white mt-1">
                                {selectedProject.totalWrites?.toLocaleString() || 0}
                              </div>
                            </Card>
                          </div>
                          
                          {selectedProject.collections.map(col => (
                            <CollectionViewer 
                              key={col.name} 
                              collection={col} 
                              projectApiKey={selectedProject.apiKey}
                              onRefresh={fetchProjects}
                            />
                          ))}
                        </div>
                      )
                   ) : (
                      <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                         <p className="text-sm text-slate-400 mb-4">
                           Define who can read/write to your collections. These are currently for testing/simulation.
                         </p>
                         <RulesEditor project={selectedProject} onUpdate={handleUpdateRules} />
                      </div>
                   )}
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 border-2 border-dashed border-slate-800 rounded-xl p-12 bg-slate-900/20">
                <Database className="w-16 h-16 text-slate-700 mb-4" />
                <h3 className="text-xl font-medium text-slate-300">Select a Database</h3>
                <p className="mt-2 text-center max-w-sm">Choose a project from the list on the left to view its keys and manage its data.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Modal 
        isOpen={!!deleteConfirmation} 
        onClose={() => setDeleteConfirmation(null)} 
        title="Delete Project"
      >
        <div className="space-y-4">
           <p className="text-slate-300">
             Are you sure you want to delete this project? 
             <br />
             <span className="text-red-400 font-bold">This action cannot be undone.</span>
           </p>
           <div className="flex justify-end gap-2 pt-2">
             <Button variant="secondary" onClick={() => setDeleteConfirmation(null)}>Cancel</Button>
             <Button variant="danger" icon={Trash2} onClick={handleDeleteProject} isLoading={loading}>Yes, Delete Project</Button>
           </div>
        </div>
      </Modal>
    </div>
  );
};
