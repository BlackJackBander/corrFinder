import React from 'react';
import { X, Waves, Box } from 'lucide-react';
import { Predictor } from '../types';

interface PredictorCardProps {
  predictor: Predictor;
  onRemove: (id: number) => void;
  onWeightChange: (id: number, weight: number) => void;
  onTickerChange: (id: number, ticker: string) => void;
}

export function PredictorCard({ predictor, onRemove, onWeightChange, onTickerChange }: PredictorCardProps) {
  const isVol = predictor.ticker.includes('_VOL');
  const corrValue = parseFloat(predictor.corr) || 0;
  const corrPercent = Math.abs(corrValue) * 100;
  const isPositiveCorr = corrValue >= 0;

  return (
    <div
      className={`p-2 rounded border space-y-2 ${
        isVol ? 'border-blue-500/50 bg-[#1a1a2e]' : 'border-[#3d3d3d] bg-[#1e1e1e]'
      }`}
    >
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-1">
          {isVol ? (
            <Waves size={10} className="text-blue-300" />
          ) : (
            <Box size={10} className="text-blue-400" />
          )}
          <input
            type="text"
            disabled={isVol}
            className={`bg-transparent border-b border-[#3d3d3d] text-white text-xs w-20 p-0 outline-none focus:border-blue-500 ${
              isVol ? 'text-blue-300 font-bold cursor-not-allowed' : ''
            }`}
            value={predictor.ticker}
            onChange={e => onTickerChange(predictor.id, e.target.value.toUpperCase())}
            placeholder="тикер"
          />
        </div>
        {isVol ? (
          <span className="text-[9px] text-blue-400 border border-blue-500/30 px-1 rounded">AUTO</span>
        ) : (
          <button
            onClick={() => onRemove(predictor.id)}
            className="text-gray-500 hover:text-red-400 transition-colors"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Correlation indicator */}
      <div className="flex items-center gap-1 text-[10px]">
        <span className="text-gray-400 w-8">ρ(lag)</span>
        <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${isPositiveCorr ? 'bg-blue-500' : 'bg-red-500'}`}
            style={{ width: `${corrPercent}%` }}
          />
        </div>
        <span className="text-purple-300 w-10 text-right font-mono">{predictor.corr}</span>
      </div>

      {/* Weight slider */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] w-12 text-gray-400">вес</span>
        <input
          type="range"
          min="-5"
          max="5"
          step="0.1"
          value={predictor.weight}
          onChange={e => onWeightChange(predictor.id, parseFloat(e.target.value))}
          className="flex-1 h-1 accent-blue-500"
        />
        <span className="w-8 text-right text-[10px] text-blue-300 font-mono">
          {predictor.weight.toFixed(1)}
        </span>
      </div>
    </div>
  );
}
