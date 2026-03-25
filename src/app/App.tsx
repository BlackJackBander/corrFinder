import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Radio, Plus, RotateCcw, RefreshCw, Loader2,
  Calculator, TrendingUp, Activity, Thermometer, BarChart2, Camera, ZoomIn
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer
} from 'recharts';
import { PredictorCard } from './components/PredictorCard';
import { HeatmapChart } from './components/HeatmapChart';
import { Predictor } from './types';
import {
  logReturns, lagArray, elementwiseMedian,
  adfTest, correlation, covariance, normalizeZ,
} from './utils/math';
import { fetchMoexChunk, synchronizeByDate } from './utils/moex';
import html2canvas from 'html2canvas';

const DARK_BG = '#252526';
const DARK_BG2 = '#1e1e1e';
const GRID_COLOR = '#3d3d3d';

// Predefined colors for predictors
const PREDICTOR_COLORS = [
  '#ff6b6b', '#4ecdc4', '#45b7d1', '#ffa07a', '#98d8c8',
  '#f7dc6f', '#bb8fce', '#85c1e2', '#f8b739', '#52b788'
];

export default function App() {
  const [targetTicker, setTargetTicker] = useState('SBER');
  const [historyDays, setHistoryDays] = useState(300);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [status, setStatus] = useState('ожидание загрузки');
  const [predictors, setPredictors] = useState<Predictor[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [baseLogPrice, setBaseLogPrice] = useState<(number | null)[]>([]);
  const [baseReturns, setBaseReturns] = useState<(number | null)[]>([]);
  const [stationary, setStationary] = useState(false);
  const [adfStat, setAdfStat] = useState<number | null>(null);

  // ── Zoom/Pan state for main chart ────────────────────────────────────────
  const [mainZoom, setMainZoom] = useState<{ start: number; end: number } | null>(null);
  // Refs for imperative handlers (avoid stale closures)
  const mainZoomRef = useRef<{ start: number; end: number } | null>(null);
  const mainDataLenRef = useRef(0);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ mouseX: 0, zoomStart: 0, zoomEnd: 0 });
  const mainChartAreaRef = useRef<HTMLDivElement>(null);

  const nextIdRef = useRef(1);
  const predictorsRef = useRef<Predictor[]>([]);
  const datesRef = useRef<string[]>([]);
  
  // Refs for screenshots
  const mainChartRef = useRef<HTMLDivElement>(null);
  const indexChartRef = useRef<HTMLDivElement>(null);
  const corrHeatmapRef = useRef<HTMLDivElement>(null);
  const covHeatmapRef = useRef<HTMLDivElement>(null);

  // ── Build main chart data ────────────────────────────────────────────────
  function buildMainChartData() {
    const n = dates.length;
    if (n === 0) return [];

    // Subsample for performance: max 300 points
    const step = Math.max(1, Math.floor(n / 300));
    const result: any[] = [];

    const syntheticLog: (number | null)[] = new Array(n).fill(null);
    if (n > 1) {
      syntheticLog[1] = baseLogPrice[1];
      for (let i = 2; i < n; i++) {
        if (baseReturns[i] === null) continue;
        let totalPredShift = 0;
        for (const p of predictors) {
          if (p.weight !== 0 && p.normLagged && p.normLagged[i] != null) {
            const corrValue = parseFloat(p.corr) || 0;
            totalPredShift += p.weight * corrValue * p.normLagged[i] * 0.005;
          }
        }
        syntheticLog[i] = (syntheticLog[i - 1] as number) + (baseReturns[i] as number) + totalPredShift;
      }
    }

    // Convert log prices to real prices for visualization
    for (let i = 0; i < n; i += step) {
      const point: any = {
        date: dates[i],
        real: baseLogPrice[i] !== null ? parseFloat(Math.exp(baseLogPrice[i] as number).toFixed(2)) : null,
        synthetic: syntheticLog[i] !== null ? parseFloat(Math.exp(syntheticLog[i] as number).toFixed(2)) : null,
      };
      result.push(point);
    }
    return result;
  }

  // ── Build industry index data ────────────────────────────────────────────
  function buildIndexChartData() {
    const n = dates.length;
    if (n === 0 || predictors.length === 0) return [];

    const allPredReturns = predictors.map(p => p.returns || []).filter(arr => arr.length > 0);
    const indexReturns = elementwiseMedian(allPredReturns);
    const industryIndex: (number | null)[] = new Array(n).fill(null);
    if (n > 0) {
      industryIndex[0] = 0;
      for (let i = 1; i < n; i++) {
        industryIndex[i] = (industryIndex[i - 1] as number) + (indexReturns[i] || 0);
      }
    }

    const step = Math.max(1, Math.floor(n / 300));
    const result: { date: string; index: number | null }[] = [];
    for (let i = 0; i < n; i += step) {
      result.push({
        date: dates[i],
        index: industryIndex[i] !== null ? parseFloat((industryIndex[i] as number).toFixed(4)) : null,
      });
    }
    return result;
  }

  // ── Build heatmap matrices ───────────────────────────────────────────────
  function buildCorrMatrix(): { matrix: number[][]; labels: string[] } {
    if (predictors.length === 0) return { matrix: [], labels: [] };
    const labels = [targetTicker, ...predictors.map(p => p.ticker)];
    const corrMatrix: number[][] = [];
    const baseCorrRow = [1.0, ...predictors.map(p => parseFloat(p.corr) || 0)];
    corrMatrix.push(baseCorrRow);
    for (let i = 0; i < predictors.length; i++) {
      const row = [parseFloat(predictors[i].corr) || 0];
      for (let j = 0; j < predictors.length; j++) {
        if (i === j) row.push(1.0);
        else row.push(correlation(predictors[i].laggedReturns || [], predictors[j].laggedReturns || []));
      }
      corrMatrix.push(row);
    }
    return { matrix: corrMatrix, labels };
  }

  function buildCovMatrix(): { matrix: number[][]; labels: string[] } {
    if (predictors.length === 0) return { matrix: [], labels: [] };
    const labels = [targetTicker, ...predictors.map(p => p.ticker)];
    const covMatrix: number[][] = [];
    const baseCovRow = [covariance(baseReturns, baseReturns), ...predictors.map(p => parseFloat(p.cov) || 0)];
    covMatrix.push(baseCovRow);
    for (let i = 0; i < predictors.length; i++) {
      const row = [parseFloat(predictors[i].cov) || 0];
      for (let j = 0; j < predictors.length; j++) {
        if (i === j) row.push(covariance(predictors[i].laggedReturns || [], predictors[i].laggedReturns || []));
        else row.push(covariance(predictors[i].laggedReturns || [], predictors[j].laggedReturns || []));
      }
      covMatrix.push(row);
    }
    return { matrix: covMatrix, labels };
  }

  // ── Process data ──────────────────────────────────────────────────────────
  const processData = useCallback(async () => {
    setLoading(true);
    setLoadingText('Загрузка ...');
    setStatus('Загрузка ...');

    try {
      const tick = targetTicker.trim().toUpperCase();
      const predTickers: string[] = predictorsRef.current
        .filter(p => !p.ticker.includes('_VOL'))
        .map(p => p.ticker.trim().toUpperCase());

      const volTicker = `${tick}_VOL`;
      const allTickers = [volTicker, ...predTickers];

      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - historyDays);
      const endStr = end.toISOString().split('T')[0];
      const startStr = start.toISOString().split('T')[0];

      setLoadingText(`MOEX: загрузка ${tick}`);
      const baseRaw = await fetchMoexChunk(tick, startStr, endStr);
      if (baseRaw.length === 0) throw new Error(`Нет данных по ${tick}`);

      const predictorMaps: Map<string, { date: string; close: number | null }>[] = [];

      for (const t of allTickers) {
        if (t === volTicker) {
          const volMap = new Map(baseRaw.map(d => [d.date, { date: d.date, close: d.volume }]));
          predictorMaps.push(volMap);
        } else {
          setLoadingText(`загрузка ${t} ...`);
          const data = await fetchMoexChunk(t, startStr, endStr);
          predictorMaps.push(new Map(data.map(d => [d.date, d])));
        }
      }

      const baseDates = baseRaw.map(d => d.date);
      const baseClose = baseRaw.map(d => d.close);
      const blp = baseClose.map(v => (v ? Math.log(v) : null));
      const br = logReturns(baseClose);

      const { stationary: st, adf } = adfTest(br);
      setStationary(st);
      setAdfStat(adf);

      const predictorArrays = synchronizeByDate(baseDates, predictorMaps);

      const newPredictors: Predictor[] = [];
      for (let i = 0; i < allTickers.length; i++) {
        const t = allTickers[i];
        const rawPrices = predictorArrays[i];
        const returns = logReturns(rawPrices);
        const lagged = lagArray(returns, 1);
        const existing = predictorsRef.current.find(p => p.ticker === t);
        const weight = existing ? existing.weight : 0;
        newPredictors.push({
          id: existing ? existing.id : nextIdRef.current++,
          ticker: t,
          weight,
          rawPrices,
          returns,
          laggedReturns: lagged,
          normLagged: normalizeZ(lagged),
          corr: correlation(br, lagged).toFixed(3),
          cov: covariance(br, lagged).toFixed(6),
        });
      }

      predictorsRef.current = newPredictors;
      datesRef.current = baseDates;

      setPredictors([...newPredictors]);
      setDates(baseDates);
      setBaseLogPrice(blp);
      setBaseReturns(br);

      setStatus(`OK · стационарность лог-доходности: ${st ? 'ДА' : 'НЕТ'}`);
      // Reset zoom on new data load
      mainZoomRef.current = null;
      setMainZoom(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Неизвестная ошибка';
      alert(msg);
      setStatus('Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [targetTicker, historyDays]);

  const handleWeightChange = useCallback((id: number, weight: number) => {
    setPredictors(prev => {
      const updated = prev.map(p => (p.id === id ? { ...p, weight } : p));
      predictorsRef.current = updated;
      return updated;
    });
  }, []);

  const handleRemove = useCallback((id: number) => {
    setPredictors(prev => {
      const updated = prev.filter(p => p.id !== id);
      predictorsRef.current = updated;
      return updated;
    });
  }, []);

  const handleTickerChange = useCallback((id: number, ticker: string) => {
    setPredictors(prev => {
      const updated = prev.map(p => (p.id === id ? { ...p, ticker } : p));
      predictorsRef.current = updated;
      return updated;
    });
  }, []);

  const addPredictor = useCallback(() => {
    if (datesRef.current.length === 0) {
      alert('Сначала загрузите базовые данные');
      return;
    }
    const n = datesRef.current.length;
    const newPred: Predictor = {
      id: nextIdRef.current++,
      ticker: 'GAZP',
      weight: 0,
      rawPrices: new Array(n).fill(null),
      returns: new Array(n).fill(null),
      laggedReturns: new Array(n).fill(null),
      normLagged: new Array(n).fill(0),
      corr: '?',
      cov: '?',
    };
    setPredictors(prev => {
      const updated = [...prev, newPred];
      predictorsRef.current = updated;
      return updated;
    });
  }, []);

  const resetWeights = useCallback(() => {
    setPredictors(prev => {
      const updated = prev.map(p => ({ ...p, weight: 0 }));
      predictorsRef.current = updated;
      return updated;
    });
  }, []);

  const mainChartData = buildMainChartData();
  // Update data length ref (always fresh at render time)
  mainDataLenRef.current = mainChartData.length;

  // ── Visible slice for zoom ───────────────────────────────────────────────
  const visibleMainData = mainZoom
    ? mainChartData.slice(mainZoom.start, mainZoom.end + 1)
    : mainChartData;

  // Auto Y domain from visible data (real + synthetic, with padding)
  const mainYDomain: [number, number] | undefined = (() => {
    const vals = visibleMainData
      .flatMap(d => [d.real, d.synthetic])
      .filter((v): v is number => v != null);
    if (!vals.length) return undefined;
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo) * 0.06 || 1;
    return [+(lo - pad).toFixed(2), +(hi + pad).toFixed(2)];
  })();

  const indexChartData = buildIndexChartData();
  const { matrix: corrMatrix, labels: corrLabels } = buildCorrMatrix();
  const { matrix: covMatrix, labels: covLabels } = buildCovMatrix();

  // Tick formatter: show every ~8th label
  const tickFormatter = (val: string, index: number, total: number) => {
    const step = Math.max(1, Math.floor(total / 8));
    return index % step === 0 ? val : '';
  };

  // ── Screenshot functions ────────────────────────────────────────────────
  const captureScreenshot = useCallback(async (ref: React.RefObject<HTMLDivElement>, filename: string) => {
    if (!ref.current) return;
    const canvas = await html2canvas(ref.current);
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = filename;
    link.click();
  }, []);

  const captureMainChart = useCallback(() => {
    captureScreenshot(mainChartRef, `${targetTicker}_main_chart.png`);
  }, [captureScreenshot, targetTicker]);

  const captureIndexChart = useCallback(() => {
    captureScreenshot(indexChartRef, `${targetTicker}_index_chart.png`);
  }, [captureScreenshot, targetTicker]);

  const captureCorrHeatmap = useCallback(() => {
    captureScreenshot(corrHeatmapRef, `${targetTicker}_corr_heatmap.png`);
  }, [captureScreenshot, targetTicker]);

  const captureCovHeatmap = useCallback(() => {
    captureScreenshot(covHeatmapRef, `${targetTicker}_cov_heatmap.png`);
  }, [captureScreenshot, targetTicker]);

  // ── Native wheel listener (passive: false required for preventDefault) ───
  useEffect(() => {
    const el = mainChartAreaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const n = mainDataLenRef.current;
      if (n < 2) return;
      const cur = mainZoomRef.current;
      const curStart = cur?.start ?? 0;
      const curEnd = cur?.end ?? n - 1;
      const range = curEnd - curStart;
      const rect = el.getBoundingClientRect();
      // Zoom around cursor X position
      const relX = Math.max(0.01, Math.min(0.99, (e.clientX - rect.left) / rect.width));
      const centerIdx = curStart + relX * range;
      const factor = e.deltaY > 0 ? 1.22 : 0.82;
      const newRange = Math.round(Math.max(8, Math.min(n - 1, range * factor)));
      let newStart = Math.round(centerIdx - relX * newRange);
      let newEnd = newStart + newRange;
      if (newStart < 0) { newStart = 0; newEnd = Math.min(n - 1, newRange); }
      if (newEnd >= n) { newEnd = n - 1; newStart = Math.max(0, n - 1 - newRange); }
      const newZoom = (newStart === 0 && newEnd >= n - 1) ? null : { start: newStart, end: newEnd };
      mainZoomRef.current = newZoom;
      setMainZoom(newZoom);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── Pan handlers ─────────────────────────────────────────────────────────
  const handleMainMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const n = mainDataLenRef.current;
    if (n < 2) return;
    e.preventDefault();
    isPanningRef.current = true;
    const cur = mainZoomRef.current;
    panStartRef.current = {
      mouseX: e.clientX,
      zoomStart: cur?.start ?? 0,
      zoomEnd: cur?.end ?? n - 1,
    };
    if (mainChartAreaRef.current) mainChartAreaRef.current.style.cursor = 'grabbing';
  }, []);

  const handleMainMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPanningRef.current) return;
    const n = mainDataLenRef.current;
    if (n < 2) return;
    const { mouseX, zoomStart, zoomEnd } = panStartRef.current;
    const range = zoomEnd - zoomStart;
    const rect = mainChartAreaRef.current!.getBoundingClientRect();
    const pixelDelta = e.clientX - mouseX;
    const idxDelta = -Math.round((pixelDelta / rect.width) * range);
    let newStart = zoomStart + idxDelta;
    let newEnd = zoomEnd + idxDelta;
    if (newStart < 0) { newStart = 0; newEnd = Math.min(n - 1, range); }
    if (newEnd >= n) { newEnd = n - 1; newStart = Math.max(0, n - 1 - range); }
    const newZoom = (newStart === 0 && newEnd >= n - 1) ? null : { start: newStart, end: newEnd };
    mainZoomRef.current = newZoom;
    setMainZoom(newZoom);
  }, []);

  const handleMainMouseUp = useCallback(() => {
    isPanningRef.current = false;
    if (mainChartAreaRef.current) mainChartAreaRef.current.style.cursor = 'grab';
  }, []);

  const handleMainZoomReset = useCallback(() => {
    mainZoomRef.current = null;
    setMainZoom(null);
  }, []);

  return (
    <div
      className="h-screen flex flex-col overflow-hidden select-none"
      style={{ backgroundColor: DARK_BG2, color: '#e0e0e0', fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", fontSize: 13 }}
    >
      {/* ── Header ── */}
      <header
        className="h-12 flex items-center px-4 justify-between shrink-0"
        style={{ backgroundColor: DARK_BG, borderBottom: `1px solid ${GRID_COLOR}` }}
      >
        <div className="flex items-center gap-2 text-white font-bold text-lg">
          <Radio size={18} className="text-blue-500" />
          <span>
            Предиктивный Эквалайзер
            <span className="text-xs text-gray-500 font-normal ml-2">
              Лог-доходности (Log Returns) + Lag 1
            </span>
          </span>
        </div>
        <div className="text-xs text-gray-400 font-mono">{status}</div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden p-2 gap-2 min-h-0">

        {/* ── Left Panel ── */}
        <div className="w-80 flex flex-col gap-2 shrink-0 min-h-0">

          {/* Target ticker */}
          <div className="rounded flex flex-col shrink-0" style={{ backgroundColor: DARK_BG, border: `1px solid ${GRID_COLOR}` }}>
            <div
              className="flex justify-between px-3 py-2 text-gray-400 text-xs font-semibold rounded-t"
              style={{ borderBottom: `1px solid ${GRID_COLOR}`, backgroundColor: '#2d2d2d' }}
            >
              <span>Базовый актив (MOEX)</span>
              <span className="text-[10px] font-normal text-gray-500">t (сегодня)</span>
            </div>
            <div className="p-3 space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={targetTicker}
                  onChange={e => setTargetTicker(e.target.value.toUpperCase())}
                  placeholder="тикер"
                  className="flex-1 text-white text-xs rounded px-2 py-1.5 outline-none"
                  style={{ backgroundColor: DARK_BG2, border: `1px solid ${GRID_COLOR}` }}
                />
                <input
                  type="number"
                  value={historyDays}
                  onChange={e => setHistoryDays(parseInt(e.target.value) || 300)}
                  min={60} max={1000}
                  className="w-20 text-white text-xs rounded px-2 py-1.5 outline-none"
                  style={{ backgroundColor: DARK_BG2, border: `1px solid ${GRID_COLOR}` }}
                />
              </div>
              <div className="flex items-center gap-2 text-[11px] text-gray-400">
                <TrendingUp size={11} />
                Цель: Стационарная лог-доходность (r)
              </div>
            </div>
          </div>

          {/* Predictors */}
          <div className="flex-1 flex flex-col rounded overflow-hidden min-h-0" style={{ backgroundColor: DARK_BG, border: `1px solid ${GRID_COLOR}` }}>
            <div
              className="flex justify-between items-center px-3 py-2 text-gray-400 text-xs font-semibold shrink-0 rounded-t"
              style={{ borderBottom: `1px solid ${GRID_COLOR}`, backgroundColor: '#2d2d2d' }}
            >
              <span className="flex items-center gap-1">
                <Activity size={11} className="mr-1" />
                Предикторы (Lag 1)
                <span
                  title="Сдвиг 1 день назад. Сравниваем доходность предиктора ВЧЕРА с базовым активом СЕГОДНЯ."
                  className="cursor-help text-[10px]"
                  style={{ borderBottom: '1px dotted #666' }}
                >ⓘ</span>
              </span>
              <button
                onClick={addPredictor}
                className="flex items-center gap-1 text-[10px] text-white px-2 py-0.5 rounded transition-colors bg-blue-600 hover:bg-blue-500"
              >
                <Plus size={10} /> добавить
              </button>
            </div>

            <div
              className="p-2 space-y-3 overflow-y-auto flex-1"
              style={{ scrollbarWidth: 'thin', scrollbarColor: `${GRID_COLOR} ${DARK_BG}` }}
            >
              {predictors.length === 0 && (
                <div className="text-gray-600 text-xs text-center py-6">
                  Загрузите данные чтобы увидеть предикторы
                </div>
              )}
              {predictors.map(p => (
                <PredictorCard
                  key={p.id}
                  predictor={p}
                  onRemove={handleRemove}
                  onWeightChange={handleWeightChange}
                  onTickerChange={handleTickerChange}
                />
              ))}
            </div>

            <div
              className="flex justify-between items-center px-3 py-2 text-[11px] text-gray-400 shrink-0"
              style={{ borderTop: `1px solid ${GRID_COLOR}` }}
            >
              <span className="flex items-center gap-1">
                <Calculator size={11} /> Влияние = вес × ρ
              </span>
              <button onClick={resetWeights} className="flex items-center gap-1 hover:text-white transition-colors text-gray-300">
                <RotateCcw size={11} /> сброс весов
              </button>
            </div>
          </div>

          {/* Load button */}
          <button
            onClick={processData}
            disabled={loading}
            className="w-full text-white rounded py-2.5 text-xs font-bold flex justify-center items-center gap-2 shrink-0 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Загрузить и рассчитать
          </button>
        </div>

        {/* ── Right Panel ── */}
        <div className="flex-1 flex flex-col gap-2 min-w-0 h-full overflow-hidden">

          {/* Metrics bar */}
          <div
            className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded text-[10px] font-mono shrink-0"
            style={{ backgroundColor: DARK_BG2, border: `1px solid ${GRID_COLOR}` }}
          >
            <span className="text-blue-300 font-bold">{targetTicker}</span>
            {predictors.length === 0
              ? <span className="text-gray-600">нет предикторов</span>
              : predictors.map(p => (
                <span key={p.id} className="flex items-center gap-1">
                  <span className="text-gray-500">|</span>
                  <span className="text-purple-400">{p.ticker}</span>
                  <span className="text-gray-400">ρ={p.corr}</span>
                </span>
              ))
            }
          </div>

          {/* ── Main chart: Log price reconstruction ── */}
          <div
            ref={mainChartRef}
            className="flex flex-col rounded min-h-0"
            style={{ backgroundColor: DARK_BG, border: `1px solid ${GRID_COLOR}`, flex: '0 0 55%' }}
          >
            <div
              className="flex justify-between items-center px-3 py-1.5 text-xs text-gray-400 font-semibold shrink-0 rounded-t"
              style={{ borderBottom: `1px solid ${GRID_COLOR}`, backgroundColor: '#2d2d2d' }}
            >
              <span className="flex items-center gap-2">
                <BarChart2 size={12} className="text-blue-400" />
                Цена актива: Реальная vs Синтетическая модель
                <span
                  title="Колесо мыши — зум по X и Y, перетаскивание — панорамирование"
                  className="cursor-help text-[10px] text-gray-500"
                  style={{ borderBottom: '1px dotted #666' }}
                >⌖</span>
              </span>
              <div className="flex items-center gap-2">
                {mainZoom && (
                  <button
                    onClick={handleMainZoomReset}
                    className="flex items-center gap-1 text-[10px] text-gray-300 hover:text-white px-2 py-0.5 rounded transition-colors"
                    style={{ backgroundColor: DARK_BG2, border: `1px solid ${GRID_COLOR}` }}
                    title="Сбросить зум"
                  >
                    <ZoomIn size={9} /> сброс зума
                  </button>
                )}
                <div
                  className={`text-[10px] font-mono px-2 py-0.5 rounded ${stationary ? 'text-green-400' : 'text-yellow-400'}`}
                  style={{ backgroundColor: DARK_BG2, border: `1px solid ${GRID_COLOR}` }}
                >
                  {adfStat !== null
                    ? (stationary
                      ? `🟢 стационарна (ADF: ${adfStat.toFixed(2)})`
                      : `🔴 нестационарна (ADF: ${adfStat.toFixed(2)})`)
                    : 'тест ADF (лог-доходность)'}
                </div>
              </div>
            </div>
            <div
              ref={mainChartAreaRef}
              className="flex-1 min-h-0 p-1"
              style={{ cursor: 'grab', userSelect: 'none' }}
              onMouseDown={handleMainMouseDown}
              onMouseMove={handleMainMouseMove}
              onMouseUp={handleMainMouseUp}
              onMouseLeave={handleMainMouseUp}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={visibleMainData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#9ca3af', fontSize: 9 }}
                    tickLine={false}
                    tickFormatter={(val, idx) => {
                      const total = visibleMainData.length;
                      const step = Math.max(1, Math.floor(total / 8));
                      return idx % step === 0 ? val : '';
                    }}
                    stroke={GRID_COLOR}
                  />
                  <YAxis
                    tick={{ fill: '#9ca3af', fontSize: 9 }}
                    tickLine={false}
                    stroke={GRID_COLOR}
                    label={{ value: 'цена (₽)', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 9 }}
                    width={55}
                    domain={mainYDomain ?? ['auto', 'auto']}
                    allowDataOverflow
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e1e1e', border: `1px solid ${GRID_COLOR}`, fontSize: 10, color: '#e0e0e0' }}
                    labelStyle={{ color: '#9ca3af' }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 9, color: '#9ca3af', paddingTop: 4 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="real"
                    name={`${targetTicker} (Реальная цена)`}
                    stroke="#6c757d"
                    dot={false}
                    strokeWidth={2}
                    connectNulls
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="synthetic"
                    name="Модель (Синтетика)"
                    stroke="#00a8ff"
                    dot={false}
                    strokeWidth={2.5}
                    connectNulls
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {/* Predictor influence legend */}
            {predictors.length > 0 && (
              <div
                className="px-3 pb-2 flex flex-wrap gap-2"
                style={{ borderTop: `1px solid ${GRID_COLOR}` }}
              >
                <span className="text-[10px] text-gray-500 flex items-center mr-1 shrink-0">Влияние предикторов:</span>
                {predictors.map((p, idx) => {
                  const corr = parseFloat(p.corr) || 0;
                  const influence = p.weight * corr;
                  const absCorr = Math.abs(corr);
                  const direction = corr > 0 ? '↑' : corr < 0 ? '↓' : '–';
                  const dirColor = corr > 0 ? '#2ecc71' : corr < 0 ? '#e74c3c' : '#9ca3af';
                  const influenceAbs = Math.abs(influence);
                  const strengthLabel = absCorr >= 0.5 ? 'сильная' : absCorr >= 0.2 ? 'умеренная' : 'слабая';
                  return (
                    <div
                      key={p.id}
                      className="flex items-center gap-1 rounded px-2 py-0.5"
                      style={{
                        backgroundColor: DARK_BG2,
                        border: `1px solid ${GRID_COLOR}`,
                        fontSize: 10,
                      }}
                      title={`${p.ticker}: ρ=${p.corr}, ков=${p.cov}, вес=${p.weight}, влияние=${influence.toFixed(3)}`}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          backgroundColor: PREDICTOR_COLORS[idx % PREDICTOR_COLORS.length],
                          display: 'inline-block',
                          flexShrink: 0,
                        }}
                      />
                      <span className="text-gray-300 font-mono">{p.ticker}</span>
                      <span style={{ color: dirColor }}>{direction}</span>
                      <span className="text-gray-500">ρ=</span>
                      <span style={{ color: dirColor }}>{p.corr}</span>
                      {p.weight !== 0 && (
                        <>
                          <span className="text-gray-600">·</span>
                          <span className="text-gray-500">вл=</span>
                          <span style={{ color: influenceAbs > 0.05 ? '#f7dc6f' : '#9ca3af' }}>
                            {influence.toFixed(3)}
                          </span>
                        </>
                      )}
                      <span className="text-gray-600 text-[9px]">({strengthLabel})</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex justify-end px-3 py-1.5">
              <button
                onClick={captureMainChart}
                className="flex items-center gap-1 text-[10px] text-white px-2 py-0.5 rounded transition-colors bg-blue-600 hover:bg-blue-500"
              >
                <Camera size={10} /> скриншот
              </button>
            </div>
          </div>

          {/* ── Industry Index Chart ── */}
          <div
            ref={indexChartRef}
            className="flex flex-col rounded min-h-0"
            style={{ backgroundColor: DARK_BG, border: `1px solid ${GRID_COLOR}`, flex: '0 0 17%' }}
          >
            <div
              className="flex items-center gap-2 px-3 py-1 text-xs text-gray-400 font-semibold shrink-0 rounded-t"
              style={{ borderBottom: `1px solid ${GRID_COLOR}`, backgroundColor: '#2d2d2d' }}
            >
              <Activity size={11} className="text-green-400" />
              Кумулятивный медианный индекс предикторов
              <span
                title="Сумма медианных доходностей всех предикторов. Показывает общий вектор направления. Используйте ползунок снизу для масштабирования"
                className="cursor-help text-[10px]"
                style={{ borderBottom: '1px dotted #666' }}
              >ⓘ</span>
            </div>
            <div className="flex-1 min-h-0 p-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={indexChartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#9ca3af', fontSize: 8 }}
                    tickLine={false}
                    tickFormatter={(val, idx) => {
                      const total = indexChartData.length;
                      const step = Math.max(1, Math.floor(total / 6));
                      return idx % step === 0 ? val : '';
                    }}
                    stroke={GRID_COLOR}
                  />
                  <YAxis
                    tick={{ fill: '#9ca3af', fontSize: 8 }}
                    tickLine={false}
                    stroke={GRID_COLOR}
                    width={50}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e1e1e', border: `1px solid ${GRID_COLOR}`, fontSize: 10, color: '#e0e0e0' }}
                    labelStyle={{ color: '#9ca3af' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="index"
                    name="Кумулятивный медианный индекс"
                    stroke="#2ecc71"
                    dot={false}
                    strokeWidth={2}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-end px-3 py-1.5">
              <button
                onClick={captureIndexChart}
                className="flex items-center gap-1 text-[10px] text-white px-2 py-0.5 rounded transition-colors bg-blue-600 hover:bg-blue-500"
              >
                <Camera size={10} /> скриншот
              </button>
            </div>
          </div>

          {/* ── Heatmaps ── */}
          <div className="flex gap-2 min-h-0" style={{ flex: '0 0 23%' }}>

            {/* Correlation heatmap */}
            <div
              ref={corrHeatmapRef}
              className="flex-1 flex flex-col rounded min-w-0"
              style={{ backgroundColor: DARK_BG, border: `1px solid ${GRID_COLOR}` }}
            >
              <div
                className="flex items-center gap-1 px-3 py-1 text-xs text-gray-400 font-semibold shrink-0 rounded-t"
                style={{ borderBottom: `1px solid ${GRID_COLOR}`, backgroundColor: '#2d2d2d' }}
              >
                <Thermometer size={11} className="text-red-400" />
                Корреляция лог-доходностей (Сдвиг 1)
                <span
                  title="Колесико мыши - зум, перетаскивание - панорамирование"
                  className="cursor-help text-[10px] text-gray-500"
                  style={{ borderBottom: '1px dotted #666' }}
                >⌖</span>
              </div>
              <div className="flex-1 min-h-0 overflow-auto p-1">
                {corrMatrix.length > 0
                  ? <HeatmapChart matrix={corrMatrix} labels={corrLabels} colorMode="rdbu" />
                  : <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">Нет данных</div>
                }
              </div>
              <div className="flex justify-end px-3 py-1.5">
                <button
                  onClick={captureCorrHeatmap}
                  className="flex items-center gap-1 text-[10px] text-white px-2 py-0.5 rounded transition-colors bg-blue-600 hover:bg-blue-500"
                >
                  <Camera size={10} /> скриншот
                </button>
              </div>
            </div>

            {/* Covariance heatmap */}
            <div
              ref={covHeatmapRef}
              className="flex-1 flex flex-col rounded min-w-0"
              style={{ backgroundColor: DARK_BG, border: `1px solid ${GRID_COLOR}` }}
            >
              <div
                className="flex items-center gap-1 px-3 py-1 text-xs text-gray-400 font-semibold shrink-0 rounded-t"
                style={{ borderBottom: `1px solid ${GRID_COLOR}`, backgroundColor: '#2d2d2d' }}
              >
                <BarChart2 size={11} className="text-yellow-400" />
                Ковариация лог-доходностей
                <span
                  title="Колесико мыши - зум, перетаскивание - панорамирование"
                  className="cursor-help text-[10px] text-gray-500"
                  style={{ borderBottom: '1px dotted #666' }}
                >⌖</span>
              </div>
              <div className="flex-1 min-h-0 overflow-auto p-1">
                {covMatrix.length > 0
                  ? <HeatmapChart matrix={covMatrix} labels={covLabels} colorMode="viridis" />
                  : <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">Нет данных</div>
                }
              </div>
              <div className="flex justify-end px-3 py-1.5">
                <button
                  onClick={captureCovHeatmap}
                  className="flex items-center gap-1 text-[10px] text-white px-2 py-0.5 rounded transition-colors bg-blue-600 hover:bg-blue-500"
                >
                  <Camera size={10} /> скриншот
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Loading Overlay ── */}
      {loading && (
        <div
          className="fixed inset-0 flex flex-col items-center justify-center z-50"
          style={{ backgroundColor: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
        >
          <Loader2 size={48} className="text-blue-500 animate-spin mb-4" />
          <div className="text-white font-bold text-sm animate-pulse">{loadingText}</div>
        </div>
      )}
    </div>
  );
}