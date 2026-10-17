import React, { useState } from "react";
import { Move } from "lucide-react";

interface ControlPanelProps {
  rotation: [number, number, number];
  onRotationChange: (rotation: [number, number, number]) => void;
  projectionId: string;
  onProjectionChange: (id: string) => void;
  projections: { id: string; name: string }[];
  minimal?: boolean;
}

const EditableNumber: React.FC<{
  value: number;
  min: number;
  max: number;
  onChange: (val: number) => void;
}> = ({ value, min, max, onChange }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState(value.toFixed(1));

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      const num = parseFloat(tempValue);
      if (!isNaN(num)) {
        onChange(Math.max(min, Math.min(max, num)));
      }
      setIsEditing(false);
    }
    if (e.key === "Escape") {
      setTempValue(value.toFixed(1));
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        autoFocus
        type="text"
        className="w-16 bg-blue-500/20 text-white text-sm font-mono font-bold border-none outline-none rounded text-right px-1"
        value={tempValue}
        onChange={(e) => setTempValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          const num = parseFloat(tempValue);
          if (!isNaN(num)) onChange(Math.max(min, Math.min(max, num)));
          setIsEditing(false);
        }}
      />
    );
  }

  return (
    <span 
      className="text-sm font-mono font-bold text-white/90 cursor-edit hover:text-blue-400 transition-colors"
      onClick={() => {
        setTempValue(value.toFixed(1));
        setIsEditing(true);
      }}
    >
      {value.toFixed(1)}°
    </span>
  );
};

export const ControlPanel: React.FC<ControlPanelProps> = ({
  rotation,
  onRotationChange,
  projectionId,
  onProjectionChange,
  projections,
  minimal = false,
}) => {
  const handleChange = (index: number, value: string | number) => {
    const newRotation = [...rotation] as [number, number, number];
    newRotation[index] = typeof value === "string" ? parseFloat(value) : value;
    onRotationChange(newRotation);
  };

  return (
    <div className={`flex flex-col gap-8 ${!minimal ? 'p-8 bg-black/40 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-2xl' : ''}`}>
      {!minimal && (
        <div className="flex flex-col gap-3">
          <label className="text-xs font-bold uppercase tracking-widest text-blue-400">Projection System</label>
          <select
            value={projectionId}
            onChange={(e) => onProjectionChange(e.target.value)}
            className="bg-white/5 text-white/80 rounded-xl p-3 border border-white/10 focus:ring-2 focus:ring-blue-500 outline-none appearance-none cursor-pointer transition-all hover:bg-white/10"
          >
            {projections.map((p) => (
              <option key={p.id} value={p.id} className="bg-gray-900 text-white">
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-6">
        <div className="flex items-center gap-2 mb-2 text-blue-400">
          <Move size={16} />
          <h3 className="text-xs font-bold uppercase tracking-widest">Orientation</h3>
        </div>
        
        {[
          { label: "Longitude (λ)", value: rotation[0], min: -180, max: 180 },
          { label: "Latitude (φ)", value: rotation[1], min: -90, max: 90 },
          { label: "Roll (γ)", value: rotation[2], min: -180, max: 180 },
        ].map((slider, i) => (
          <div key={i} className="flex flex-col gap-3 group">
            <div className="flex justify-between items-end">
              <label className="text-xs font-medium text-white/40 group-hover:text-white/60 transition-colors">{slider.label}</label>
              <EditableNumber 
                value={slider.value} 
                min={slider.min} 
                max={slider.max} 
                onChange={(val) => handleChange(i, val)} 
              />
            </div>
            <div className="relative flex items-center h-4">
               <input
                type="range"
                min={slider.min}
                max={slider.max}
                step="0.1"
                value={slider.value}
                onChange={(e) => handleChange(i, e.target.value)}
                className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-blue-500 hover:bg-white/20 transition-all"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
