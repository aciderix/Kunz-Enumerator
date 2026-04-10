import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Play, Square, Download, Upload, Database, Activity, Clock, FileJson, BarChart2, Globe, AlertTriangle, CheckCircle2, Menu, X } from 'lucide-react';
import { saveResult, getResult, getAllResults, getAllKeys, KunzTaskResult } from './lib/db';
import { KunzResult } from './lib/kunz';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface Config {
  mStart: number;
  mEnd: number;
  kStart: number;
  kEnd: number;
  dMin: number;
  dMax: number;
  wMax: number;
  hasWMax: boolean;
}

export default function App() {
  const [config, setConfig] = useState<Config>({
    mStart: 3,
    mEnd: 5,
    kStart: 1,
    kEnd: 5,
    dMin: 0,
    dMax: 64,
    wMax: 0,
    hasWMax: false,
  });

  const [isRunning, setIsRunning] = useState(false);
  const [isContinuous, setIsContinuous] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [activeTab, setActiveTab] = useState<'analysis' | 'stats' | 'saturation'>('analysis');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  const [currentTask, setCurrentTask] = useState<{ m: number; k_max: number } | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentResult, setCurrentResult] = useState<KunzResult | null>(null);
  const [results, setResults] = useState<KunzTaskResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<KunzTaskResult | null>(null);
  const [selectedM, setSelectedM] = useState<number>(3);

  const workerRef = useRef<Worker | null>(null);
  const queueRef = useRef<{ m: number; k_max: number }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const isRunningRef = useRef(false);
  const isContinuousRef = useRef(false);
  const currentTaskRef = useRef<{ m: number; k_max: number } | null>(null);
  const cursorRef = useRef({ S: 4, m: 3 }); // S = m + k_max

  useEffect(() => {
    isRunningRef.current = isRunning;
    isContinuousRef.current = isContinuous;
  }, [isRunning, isContinuous]);

  useEffect(() => {
    loadResults();
    workerRef.current = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    
    workerRef.current.onmessage = async (e) => {
      if (e.data.type === 'PROGRESS') {
        setProgress(e.data.payload.progress);
        setCurrentResult(e.data.payload.currentResult);
      } else if (e.data.type === 'DONE') {
        const { result, timeTakenMs } = e.data.payload;
        const task = currentTaskRef.current;
        if (task) {
          const taskResult: KunzTaskResult = {
            m: task.m,
            k_max: task.k_max,
            d_min: config.dMin,
            d_max: config.dMax,
            w_max: config.wMax,
            has_w_max: config.hasWMax,
            res: result,
            timestamp: Date.now(),
            timeTakenMs
          };
          await saveResult(taskResult);
          await loadResults();
        }
        if (isRunningRef.current) {
          runNextTask();
        }
      } else if (e.data.type === 'STOPPED') {
        setIsRunning(false);
        setCurrentTask(null);
        currentTaskRef.current = null;
      }
    };

    return () => {
      workerRef.current?.terminate();
    };
  }, [config]);

  const loadResults = async () => {
    const res = await getAllResults();
    setResults(res.sort((a, b) => b.timestamp - a.timestamp));
  };

  const getNextContinuousTask = async () => {
    const keys = await getAllKeys();
    const keySet = new Set(keys.map(k => `${k[0]}-${k[1]}`));

    let { S, m } = cursorRef.current;

    while (true) {
      let k_max = S - m;

      if (!keySet.has(`${m}-${k_max}`)) {
        cursorRef.current = { S, m: m + 1 };
        if (cursorRef.current.m >= S) {
          cursorRef.current.S += 1;
          cursorRef.current.m = 3;
        }
        return { m, k_max };
      }

      m++;
      if (m >= S) {
        S++;
        m = 3;
      }
      cursorRef.current = { S, m };
    }
  };

  const handleStart = async () => {
    if (isRunning) return;
    setIsRunning(true);
    isRunningRef.current = true;
    setIsSidebarOpen(false); // Close sidebar on mobile when starting
    
    if (isContinuous) {
      runNextTask();
    } else {
      const queue: { m: number; k_max: number }[] = [];
      for (let m = config.mStart; m <= config.mEnd; m++) {
        for (let k = config.kStart; k <= config.kEnd; k++) {
          const existing = await getResult(m, k);
          if (!existing) {
            queue.push({ m, k_max: k });
          }
        }
      }
      
      queueRef.current = queue;
      if (queue.length > 0) {
        runNextTask();
      } else {
        setIsRunning(false);
        isRunningRef.current = false;
        alert("All tasks in the specified range are already completed and cached.");
      }
    }
  };

  const runNextTask = async () => {
    if (!isRunningRef.current) return;

    let nextTask;
    if (isContinuousRef.current) {
      nextTask = await getNextContinuousTask();
    } else {
      if (queueRef.current.length === 0) {
        setIsRunning(false);
        isRunningRef.current = false;
        setCurrentTask(null);
        currentTaskRef.current = null;
        return;
      }
      nextTask = queueRef.current.shift()!;
    }

    setCurrentTask(nextTask);
    currentTaskRef.current = nextTask;
    setProgress(0);
    setCurrentResult(null);
    
    workerRef.current?.postMessage({
      type: 'START_TASK',
      payload: {
        m: nextTask.m,
        k_max: nextTask.k_max,
        d_min: config.dMin,
        d_max: config.dMax,
        w_max: config.wMax,
        has_w_max: config.hasWMax
      }
    });
  };

  const handleStop = () => {
    workerRef.current?.postMessage({ type: 'STOP' });
    queueRef.current = [];
    setIsRunning(false);
    isRunningRef.current = false;
  };

  const handleExport = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(results, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "kunz_results.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      if (!Array.isArray(data)) {
        throw new Error("Invalid file format. Expected an array of results.");
      }

      let importedCount = 0;
      for (const item of data) {
        // Basic validation to ensure it's a KunzTaskResult
        if (item.m !== undefined && item.k_max !== undefined && item.res) {
          await saveResult(item as KunzTaskResult);
          importedCount++;
        }
      }
      
      await loadResults();
      alert(`Successfully imported ${importedCount} results!`);
    } catch (err) {
      console.error(err);
      alert("Failed to import JSON file. Please make sure it's a valid export file from this application.");
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = ''; // Reset input so the same file can be selected again if needed
      }
    }
  };

  const formatNumber = (num: number) => new Intl.NumberFormat().format(num);
  const formatTime = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = s / 60;
    if (m < 60) return `${m.toFixed(1)}m`;
    const h = m / 60;
    return `${h.toFixed(1)}h`;
  };

  const getChartData = (res: KunzResult) => {
    const data = [];
    for (let d = 0; d < res.counts.length; d++) {
      if (res.counts[d] > 0) {
        data.push({
          d,
          count: res.counts[d],
          wMin: res.W_min[d] === Number.MAX_SAFE_INTEGER ? null : res.W_min[d]
        });
      }
    }
    return data;
  };

  const availableMs = useMemo(() => Array.from(new Set(results.map(r => r.m))).sort((a, b) => a - b), [results]);
  
  useEffect(() => {
    if (!availableMs.includes(selectedM) && availableMs.length > 0) {
      setSelectedM(availableMs[0]);
    }
  }, [availableMs, selectedM]);

  const saturationData = useMemo(() => {
    const mRes = results.filter(r => r.m === selectedM).sort((a, b) => a.k_max - b.k_max);
    const validDs = new Set<number>();
    mRes.forEach(r => {
      r.res.W_min.forEach((w, d) => {
        if (w !== Number.MAX_SAFE_INTEGER) validDs.add(d);
      });
    });
    const chartData = mRes.map(r => {
      const dataPoint: any = { k_max: r.k_max };
      validDs.forEach(d => {
        const val = r.res.W_min[d];
        dataPoint[`d=${d}`] = val === Number.MAX_SAFE_INTEGER ? null : val;
      });
      return dataPoint;
    });
    return { chartData, validDs: Array.from(validDs).sort((a,b)=>a-b) };
  }, [results, selectedM]);

  const globalStats = useMemo(() => {
    let totalLeaves = 0;
    let totalTime = 0;
    let maxM = 0;
    let maxK = 0;
    let wNegFound = false;

    results.forEach(r => {
      totalLeaves += r.res.leaves_raw;
      totalTime += r.timeTakenMs;
      if (r.m > maxM) maxM = r.m;
      if (r.k_max > maxK) maxK = r.k_max;
      if (r.res.W_neg.some(v => v > 0)) wNegFound = true;
    });

    return { totalLeaves, totalTime, maxM, maxK, wNegFound, totalTasks: results.length };
  }, [results]);

  const COLORS = ['#2563eb', '#16a34a', '#dc2626', '#d97706', '#7c3aed', '#0891b2', '#be185d', '#15803d', '#b91c1c', '#4338ca'];

  return (
    <div className="flex flex-col md:flex-row h-screen bg-gray-50 text-gray-900 font-sans overflow-hidden">
      
      {/* Mobile Header */}
      <div className="md:hidden bg-white border-b border-gray-200 p-4 flex justify-between items-center z-20 flex-shrink-0">
        <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-600" />
          Kunz Enumerator
        </h1>
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
          className="p-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
        >
          {isSidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-40 transform transition-transform duration-300 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        md:relative md:translate-x-0 md:flex w-4/5 max-w-[320px] md:w-80 bg-white border-r border-gray-200 flex-col shadow-xl md:shadow-sm h-full
      `}>
        <div className="p-6 border-b border-gray-200 hidden md:block">
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Activity className="w-6 h-6 text-blue-600" />
            Kunz Enumerator
          </h1>
          <p className="text-sm text-gray-500 mt-1">Automated spectrum analysis</p>
        </div>

        <div className="p-6 flex-1 overflow-y-auto space-y-6 mt-16 md:mt-0">
          <div className="space-y-4">
            <div className="flex items-center justify-between bg-gray-100 p-1 rounded-lg border border-gray-200">
              <button
                className={`flex-1 text-xs font-medium py-2 md:py-1.5 rounded-md transition-colors ${!isContinuous ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                onClick={() => setIsContinuous(false)}
                disabled={isRunning || isImporting}
              >
                Fixed Range
              </button>
              <button
                className={`flex-1 text-xs font-medium py-2 md:py-1.5 rounded-md transition-colors ${isContinuous ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                onClick={() => setIsContinuous(true)}
                disabled={isRunning || isImporting}
              >
                Infinite Auto
              </button>
            </div>

            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Spectrum Range</h2>
            
            {isContinuous ? (
              <div className="bg-blue-50 border border-blue-100 rounded-md p-3 text-sm text-blue-800">
                <p><strong>Infinite Auto Mode</strong></p>
                <p className="mt-1 text-xs text-blue-600">
                  Automatically explores all (m, k_max) pairs by expanding diagonally. Skips already cached results. Can be paused and resumed at any time.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Start m</label>
                    <input type="number" value={config.mStart} onChange={e => setConfig({...config, mStart: parseInt(e.target.value) || 2})} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500" disabled={isRunning || isImporting} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">End m</label>
                    <input type="number" value={config.mEnd} onChange={e => setConfig({...config, mEnd: parseInt(e.target.value) || 2})} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500" disabled={isRunning || isImporting} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Start k_max</label>
                    <input type="number" value={config.kStart} onChange={e => setConfig({...config, kStart: parseInt(e.target.value) || 1})} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500" disabled={isRunning || isImporting} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">End k_max</label>
                    <input type="number" value={config.kEnd} onChange={e => setConfig({...config, kEnd: parseInt(e.target.value) || 1})} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500" disabled={isRunning || isImporting} />
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Constraints</h2>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Min d</label>
                <input type="number" value={config.dMin} onChange={e => setConfig({...config, dMin: parseInt(e.target.value) || 0})} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500" disabled={isRunning || isImporting} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Max d</label>
                <input type="number" value={config.dMax} onChange={e => setConfig({...config, dMax: parseInt(e.target.value) || 64})} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500" disabled={isRunning || isImporting} />
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <input type="checkbox" id="hasWMax" checked={config.hasWMax} onChange={e => setConfig({...config, hasWMax: e.target.checked})} disabled={isRunning || isImporting} className="rounded text-blue-600 focus:ring-blue-500" />
                <label htmlFor="hasWMax" className="text-xs font-medium text-gray-700">Enable Max W</label>
              </div>
              <input type="number" value={config.wMax} onChange={e => setConfig({...config, wMax: parseInt(e.target.value) || 0})} disabled={!config.hasWMax || isRunning || isImporting} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-400" />
            </div>
          </div>
        </div>

        <div className="p-4 md:p-6 border-t border-gray-200 bg-gray-50 flex-shrink-0">
          {!isRunning ? (
            <button onClick={handleStart} disabled={isImporting} className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 md:py-2.5 rounded-md font-medium transition-colors shadow-sm disabled:opacity-50">
              <Play className="w-4 h-4" /> Start Analysis
            </button>
          ) : (
            <button onClick={handleStop} className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-3 md:py-2.5 rounded-md font-medium transition-colors shadow-sm">
              <Square className="w-4 h-4" /> Stop Analysis
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header / Status */}
        <div className="bg-white border-b border-gray-200 p-4 md:p-6 flex-shrink-0">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4 mb-4">
            <div>
              <h2 className="text-xl md:text-2xl font-bold text-gray-900">Analysis Dashboard</h2>
              <p className="text-sm text-gray-500 mt-1">
                {isRunning 
                  ? (isContinuous ? 'Exploring infinite spectrum diagonally...' : `Running task ${queueRef.current.length + 1} remaining in queue`) 
                  : isImporting ? 'Importing data...' : 'Idle'}
              </p>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <input 
                type="file" 
                accept=".json,application/json,text/plain,*/*" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                className="hidden" 
              />
              <button 
                onClick={handleImportClick} 
                disabled={isImporting || isRunning}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 text-gray-600 hover:text-gray-900 bg-white border border-gray-300 px-3 py-2 md:py-1.5 rounded-md text-sm font-medium transition-colors shadow-sm disabled:opacity-50"
              >
                <Upload className="w-4 h-4" /> {isImporting ? 'Importing...' : 'Import JSON'}
              </button>
              <button 
                onClick={handleExport} 
                disabled={isImporting || results.length === 0}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 text-gray-600 hover:text-gray-900 bg-white border border-gray-300 px-3 py-2 md:py-1.5 rounded-md text-sm font-medium transition-colors shadow-sm disabled:opacity-50"
              >
                <Download className="w-4 h-4" /> Export JSON
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-4 md:gap-6 mt-4 border-b border-gray-200 overflow-x-auto whitespace-nowrap pb-1">
            <button 
              className={`pb-2 font-medium text-sm transition-colors ${activeTab === 'analysis' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`} 
              onClick={() => setActiveTab('analysis')}
            >
              Live Analysis
            </button>
            <button 
              className={`pb-2 font-medium text-sm transition-colors ${activeTab === 'stats' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`} 
              onClick={() => setActiveTab('stats')}
            >
              Global Stats
            </button>
            <button 
              className={`pb-2 font-medium text-sm transition-colors ${activeTab === 'saturation' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`} 
              onClick={() => setActiveTab('saturation')}
            >
              k* Saturation
            </button>
          </div>

          {currentTask && activeTab === 'analysis' && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 md:p-4 mt-4">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2 md:gap-4">
                  <span className="font-semibold text-blue-900 text-sm md:text-base">Current: m={currentTask.m}, k_max={currentTask.k_max}</span>
                  <span className="text-xs md:text-sm text-blue-700">{Math.round(progress * 100)}% complete</span>
                </div>
                {currentResult && (
                  <span className="text-xs md:text-sm text-blue-700 font-mono hidden sm:inline">
                    Leaves: {formatNumber(currentResult.leaves_raw)}
                  </span>
                )}
              </div>
              <div className="w-full bg-blue-200 rounded-full h-2 md:h-2.5 overflow-hidden">
                <div className="bg-blue-600 h-full rounded-full transition-all duration-300 ease-out" style={{ width: `${progress * 100}%` }}></div>
              </div>
            </div>
          )}
        </div>

        {/* Content Area */}
        {activeTab === 'analysis' && (
          <div className="flex-1 overflow-y-auto p-4 md:p-6 flex flex-col lg:flex-row gap-4 md:gap-6">
            {/* Results Table */}
            <div className="w-full lg:w-1/3 flex flex-col bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden h-64 lg:h-auto flex-shrink-0">
              <div className="p-3 md:p-4 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
                <Database className="w-4 h-4 text-gray-500" />
                <h3 className="font-semibold text-gray-900 text-sm md:text-base">Cached Results</h3>
              </div>
              <div className="flex-1 overflow-y-auto">
                {results.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 text-sm">No results cached yet.</div>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {results.map((r, i) => (
                      <li 
                        key={`${r.m}-${r.k_max}`} 
                        className={`p-3 hover:bg-blue-50 cursor-pointer transition-colors ${selectedResult === r ? 'bg-blue-50 border-l-4 border-blue-500' : 'border-l-4 border-transparent'}`}
                        onClick={() => setSelectedResult(r)}
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-medium text-gray-900 text-sm">m={r.m}, k_max={r.k_max}</span>
                          <span className="text-xs text-gray-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {(r.timeTakenMs / 1000).toFixed(1)}s
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          Leaves: {formatNumber(r.res.leaves_raw)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Visualization */}
            <div className="flex-1 flex flex-col bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden min-h-[400px]">
              <div className="p-3 md:p-4 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
                <FileJson className="w-4 h-4 text-gray-500" />
                <h3 className="font-semibold text-gray-900 text-sm md:text-base truncate">
                  {selectedResult ? `Analysis for m=${selectedResult.m}, k_max=${selectedResult.k_max}` : currentResult ? 'Live Analysis' : 'Select a result to view'}
                </h3>
              </div>
              <div className="flex-1 p-4 md:p-6 flex flex-col">
                {(selectedResult || currentResult) ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4 mb-6 md:mb-8">
                      <div className="bg-gray-50 p-3 md:p-4 rounded-lg border border-gray-100">
                        <div className="text-xs md:text-sm text-gray-500 mb-1">Raw Leaves</div>
                        <div className="text-lg md:text-xl font-semibold text-gray-900 font-mono">
                          {formatNumber((selectedResult?.res || currentResult!).leaves_raw)}
                        </div>
                      </div>
                      <div className="bg-gray-50 p-3 md:p-4 rounded-lg border border-gray-100">
                        <div className="text-xs md:text-sm text-gray-500 mb-1">Valid Leaves</div>
                        <div className="text-lg md:text-xl font-semibold text-gray-900 font-mono">
                          {formatNumber((selectedResult?.res || currentResult!).leaves_valid)}
                        </div>
                      </div>
                      <div className="bg-gray-50 p-3 md:p-4 rounded-lg border border-gray-100">
                        <div className="text-xs md:text-sm text-gray-500 mb-1">Kept Leaves</div>
                        <div className="text-lg md:text-xl font-semibold text-gray-900 font-mono">
                          {formatNumber((selectedResult?.res || currentResult!).leaves_kept)}
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 min-h-[250px] md:min-h-[300px]">
                      <h4 className="text-xs md:text-sm font-semibold text-gray-700 mb-4 text-center">Distribution of d vs W_min</h4>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={getChartData(selectedResult?.res || currentResult!)} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="d" label={{ value: 'd', position: 'insideBottomRight', offset: -5 }} tick={{fontSize: 12}} />
                          <YAxis yAxisId="left" tick={{fontSize: 12}} />
                          <YAxis yAxisId="right" orientation="right" tick={{fontSize: 12}} />
                          <Tooltip />
                          <Legend wrapperStyle={{ fontSize: '12px' }} />
                          <Line yAxisId="left" type="monotone" dataKey="count" stroke="#2563eb" activeDot={{ r: 6 }} name="Count" strokeWidth={2} />
                          <Line yAxisId="right" type="monotone" dataKey="wMin" stroke="#16a34a" name="W_min" strokeWidth={2} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                    No data to display
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="flex-1 overflow-y-auto p-4 md:p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4 md:mb-6">Global Exploration Statistics</h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 mb-6 md:mb-8">
              <div className="bg-white p-4 md:p-6 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
                <div className="p-3 bg-blue-100 text-blue-600 rounded-lg"><Database className="w-5 h-5 md:w-6 md:h-6" /></div>
                <div>
                  <p className="text-xs md:text-sm font-medium text-gray-500">Tasks Completed</p>
                  <h4 className="text-xl md:text-2xl font-bold text-gray-900">{formatNumber(globalStats.totalTasks)}</h4>
                </div>
              </div>
              
              <div className="bg-white p-4 md:p-6 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
                <div className="p-3 bg-green-100 text-green-600 rounded-lg"><Activity className="w-5 h-5 md:w-6 md:h-6" /></div>
                <div>
                  <p className="text-xs md:text-sm font-medium text-gray-500">Raw Leaves Explored</p>
                  <h4 className="text-xl md:text-2xl font-bold text-gray-900">{formatNumber(globalStats.totalLeaves)}</h4>
                </div>
              </div>
              
              <div className="bg-white p-4 md:p-6 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
                <div className="p-3 bg-purple-100 text-purple-600 rounded-lg"><Clock className="w-5 h-5 md:w-6 md:h-6" /></div>
                <div>
                  <p className="text-xs md:text-sm font-medium text-gray-500">Total Compute Time</p>
                  <h4 className="text-xl md:text-2xl font-bold text-gray-900">{formatTime(globalStats.totalTime)}</h4>
                </div>
              </div>
              
              <div className="bg-white p-4 md:p-6 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
                <div className="p-3 bg-orange-100 text-orange-600 rounded-lg"><BarChart2 className="w-5 h-5 md:w-6 md:h-6" /></div>
                <div>
                  <p className="text-xs md:text-sm font-medium text-gray-500">Max Multiplicity (m)</p>
                  <h4 className="text-xl md:text-2xl font-bold text-gray-900">{globalStats.maxM}</h4>
                </div>
              </div>
              
              <div className="bg-white p-4 md:p-6 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
                <div className="p-3 bg-teal-100 text-teal-600 rounded-lg"><Globe className="w-5 h-5 md:w-6 md:h-6" /></div>
                <div>
                  <p className="text-xs md:text-sm font-medium text-gray-500">Max Depth (k_max)</p>
                  <h4 className="text-xl md:text-2xl font-bold text-gray-900">{globalStats.maxK}</h4>
                </div>
              </div>
            </div>

            <div className={`p-4 md:p-6 rounded-xl border ${globalStats.wNegFound ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                {globalStats.wNegFound ? (
                  <AlertTriangle className="w-8 h-8 text-red-600 flex-shrink-0" />
                ) : (
                  <CheckCircle2 className="w-8 h-8 text-green-600 flex-shrink-0" />
                )}
                <div>
                  <h4 className={`text-base md:text-lg font-bold ${globalStats.wNegFound ? 'text-red-900' : 'text-green-900'}`}>
                    {globalStats.wNegFound ? 'Wilf Conjecture Violation Found!' : 'Wilf Conjecture Holds'}
                  </h4>
                  <p className={`mt-1 text-sm md:text-base ${globalStats.wNegFound ? 'text-red-700' : 'text-green-700'}`}>
                    {globalStats.wNegFound 
                      ? 'Incredible! The algorithm has found a semigroup where the Wilf number is negative (W < 0). Check the exported data immediately.' 
                      : 'No counter-examples found so far. All analyzed semigroups have a Wilf number W ≥ 0.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'saturation' && (
          <div className="flex-1 overflow-y-auto p-4 md:p-6">
            <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden p-4 md:p-6 h-full flex flex-col">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-base md:text-lg font-bold text-gray-900">k* Saturation Analysis</h3>
                  <p className="text-xs md:text-sm text-gray-500">Observe how W_min stabilizes as depth (k_max) increases.</p>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs md:text-sm font-medium text-gray-700">Multiplicity (m):</label>
                  <select 
                    value={selectedM} 
                    onChange={e => setSelectedM(Number(e.target.value))}
                    className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:ring-blue-500 focus:border-blue-500"
                  >
                    {availableMs.map(m => <option key={m} value={m}>m = {m}</option>)}
                  </select>
                </div>
              </div>
              
              <div className="flex-1 min-h-[300px] md:min-h-[400px]">
                {saturationData.chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={saturationData.chartData} margin={{ top: 10, right: 10, bottom: 20, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="k_max" label={{ value: 'Depth (k_max)', position: 'insideBottom', offset: -10 }} tick={{fontSize: 12}} />
                      <YAxis label={{ value: 'W_min', angle: -90, position: 'insideLeft', offset: 15 }} tick={{fontSize: 12}} />
                      <Tooltip />
                      <Legend wrapperStyle={{ paddingTop: '10px', fontSize: '12px' }} />
                      {saturationData.validDs.slice(0, 10).map((d, i) => (
                        <Line 
                          key={d} 
                          type="monotone" 
                          dataKey={`d=${d}`} 
                          stroke={COLORS[i % COLORS.length]} 
                          name={`d=${d}`} 
                          strokeWidth={2}
                          connectNulls 
                          activeDot={{ r: 6 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                    No data available for m={selectedM}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
