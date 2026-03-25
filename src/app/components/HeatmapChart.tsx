import React, { useMemo, useState, useRef, useCallback } from 'react';
import { RotateCcw } from 'lucide-react';

interface HeatmapChartProps {
  matrix: number[][];
  labels: string[];
  colorMode: 'rdbu' | 'viridis';
  title?: string;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function rdbuColor(value: number): string {
  // RdBu: -1=red, 0=white, 1=blue
  const t = (value + 1) / 2; // normalize to [0,1]
  if (t < 0.5) {
    const s = t / 0.5;
    const r = Math.round(lerp(178, 247, s));
    const g = Math.round(lerp(24, 247, s));
    const b = Math.round(lerp(43, 247, s));
    return `rgb(${r},${g},${b})`;
  } else {
    const s = (t - 0.5) / 0.5;
    const r = Math.round(lerp(247, 33, s));
    const g = Math.round(lerp(247, 102, s));
    const b = Math.round(lerp(247, 172, s));
    return `rgb(${r},${g},${b})`;
  }
}

function viridisColor(value: number, min: number, max: number): string {
  // Simplified viridis
  const t = max === min ? 0.5 : (value - min) / (max - min);
  const viridisColors = [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ];
  const idx = Math.min(Math.floor(t * (viridisColors.length - 1)), viridisColors.length - 2);
  const frac = t * (viridisColors.length - 1) - idx;
  const c1 = viridisColors[idx];
  const c2 = viridisColors[idx + 1];
  const r = Math.round(lerp(c1[0], c2[0], frac));
  const g = Math.round(lerp(c1[1], c2[1], frac));
  const b = Math.round(lerp(c1[2], c2[2], frac));
  return `rgb(${r},${g},${b})`;
}

export function HeatmapChart({ matrix, labels, colorMode }: HeatmapChartProps) {
  const [scale, setScale] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const n = labels.length;

  const { min, max } = useMemo(() => {
    let mn = Infinity, mx = -Infinity;
    for (const row of matrix) {
      for (const v of row) {
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    return { min: mn, max: mx };
  }, [matrix]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale(prev => Math.max(0.5, Math.min(5, prev * delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - translateX, y: e.clientY - translateY });
    }
  }, [translateX, translateY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging) {
      setTranslateX(e.clientX - dragStart.x);
      setTranslateY(e.clientY - dragStart.y);
    }
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleReset = useCallback(() => {
    setScale(1);
    setTranslateX(0);
    setTranslateY(0);
  }, []);

  if (n === 0 || matrix.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">
        Нет данных
      </div>
    );
  }

  const labelMaxLen = Math.max(...labels.map(l => l.length));
  const labelW = Math.min(Math.max(labelMaxLen * 6, 30), 70);
  const bottomPad = 40;
  const rightPad = 60;
  // Increased cell size for better screenshot quality (min 1000px)
  const cellSize = Math.max(60, Math.floor(1000 / n));

  const svgW = labelW + n * cellSize + rightPad;
  const svgH = labelW + n * cellSize + bottomPad;

  return (
    <div 
      ref={containerRef}
      className="w-full h-full relative overflow-hidden" 
      style={{ minHeight: 100, cursor: isDragging ? 'grabbing' : 'grab' }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {scale !== 1 || translateX !== 0 || translateY !== 0 ? (
        <button
          onClick={handleReset}
          className="absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-1 rounded text-xs bg-gray-700 hover:bg-gray-600 text-white transition-colors"
          title="Сбросить масштаб"
        >
          <RotateCcw size={12} />
          Сброс
        </button>
      ) : null}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${svgW} ${svgH}`}
        style={{ 
          width: '100%', 
          height: '100%', 
          display: 'block',
          transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
          transformOrigin: 'center center',
          transition: isDragging ? 'none' : 'transform 0.1s ease-out'
        }}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Column labels (top) */}
        {labels.map((label, j) => (
          <text
            key={`col-${j}`}
            x={labelW + j * cellSize + cellSize / 2}
            y={labelW - 4}
            fill="#9ca3af"
            fontSize={Math.max(8, cellSize / 8)}
            textAnchor="middle"
            dominantBaseline="auto"
            transform={`rotate(-45, ${labelW + j * cellSize + cellSize / 2}, ${labelW - 4})`}
          >
            {label.length > 8 ? label.slice(0, 8) : label}
          </text>
        ))}

        {/* Row labels (left) */}
        {labels.map((label, i) => (
          <text
            key={`row-${i}`}
            x={labelW - 4}
            y={labelW + i * cellSize + cellSize / 2}
            fill="#9ca3af"
            fontSize={Math.max(8, cellSize / 8)}
            textAnchor="end"
            dominantBaseline="middle"
          >
            {label.length > 8 ? label.slice(0, 8) : label}
          </text>
        ))}

        {/* Cells */}
        {matrix.map((row, i) =>
          row.map((val, j) => {
            const x = labelW + j * cellSize;
            const y = labelW + i * cellSize;
            const color =
              colorMode === 'rdbu'
                ? rdbuColor(Math.max(-1, Math.min(1, val)))
                : viridisColor(val, min, max);
            const textColor =
              colorMode === 'viridis'
                ? (val - min) / (max - min) > 0.5
                  ? '#000'
                  : '#fff'
                : Math.abs(val) > 0.5
                ? '#fff'
                : '#111';
            return (
              <g key={`${i}-${j}`}>
                <rect
                  x={x}
                  y={y}
                  width={cellSize}
                  height={cellSize}
                  fill={color}
                  stroke="#252526"
                  strokeWidth={1}
                />
                {cellSize >= 28 && (
                  <text
                    x={x + cellSize / 2}
                    y={y + cellSize / 2}
                    fill={textColor}
                    fontSize={Math.max(7, cellSize / 10)}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontFamily="monospace"
                  >
                    {val.toFixed(2)}
                  </text>
                )}
              </g>
            );
          })
        )}

        {/* Color bar */}
        {[...Array(20)].map((_, k) => {
          const t = k / 19;
          const barColor =
            colorMode === 'rdbu'
              ? rdbuColor(t * 2 - 1)
              : viridisColor(min + t * (max - min), min, max);
          const barH = (n * cellSize) / 20;
          return (
            <rect
              key={`bar-${k}`}
              x={labelW + n * cellSize + 8}
              y={labelW + k * barH}
              width={10}
              height={barH + 0.5}
              fill={barColor}
            />
          );
        })}
        <text
          x={labelW + n * cellSize + 10}
          y={labelW - 4}
          fill="#9ca3af"
          fontSize={7}
          textAnchor="middle"
        >
          {colorMode === 'rdbu' ? '1' : max.toExponential(1)}
        </text>
        <text
          x={labelW + n * cellSize + 10}
          y={labelW + n * cellSize + 10}
          fill="#9ca3af"
          fontSize={7}
          textAnchor="middle"
        >
          {colorMode === 'rdbu' ? '-1' : min.toExponential(1)}
        </text>
      </svg>
    </div>
  );
}