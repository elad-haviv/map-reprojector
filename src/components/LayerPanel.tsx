import React, { useState } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, Folder, FileJson, Palette, Type } from "lucide-react";
import type { VectorGroup, VectorFeature } from "./types";

interface LayerPanelProps {
  root: VectorGroup;
  hiddenIds: Set<string>;
  onToggleVisibility: (id: string, isGroup: boolean) => void;
  onUpdateProperties: (id: string, updates: any) => void;
}

const TreeNode: React.FC<{
  item: VectorGroup | VectorFeature;
  depth: number;
  hiddenIds: Set<string>;
  onToggleVisibility: (id: string, isGroup: boolean) => void;
  onUpdateProperties: (id: string, updates: any) => void;
}> = ({ item, depth, hiddenIds, onToggleVisibility, onUpdateProperties }) => {
  const [isOpen, setIsOpen] = useState(true);
  const [isEditingName, setIsEditingName] = useState(false);
  const [showStyles, setShowStyles] = useState(false);
  
  const isHidden = hiddenIds.has(item.id);
  const isGroup = "children" in item;

  const handleNameChange = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      onUpdateProperties(item.id, { name: e.currentTarget.value });
      setIsEditingName(false);
    }
    if (e.key === "Escape") setIsEditingName(false);
  };

  return (
    <div className="flex flex-col">
      <div 
        className={`flex items-center gap-2 py-1.5 px-2 hover:bg-white/5 rounded-lg cursor-pointer transition-colors group ${isHidden ? 'opacity-40' : 'opacity-100'}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0" onClick={() => isGroup && setIsOpen(!isOpen)}>
          {isGroup ? (
            <>
              {isOpen ? <ChevronDown size={14} className="text-white/40" /> : <ChevronRight size={14} className="text-white/40" />}
              <Folder size={14} className="text-blue-400/60" />
            </>
          ) : (
            <FileJson size={14} className="text-blue-400/40" />
          )}
          
          {isEditingName ? (
            <input
              autoFocus
              className="bg-blue-500/20 text-white text-xs border-none outline-none rounded px-1 w-full"
              defaultValue={("name" in item && item.name) || item.id}
              onKeyDown={handleNameChange}
              onBlur={() => setIsEditingName(false)}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="text-xs text-white/70 truncate font-medium flex-1">
              {("name" in item && item.name) || item.id}
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button 
            onClick={(e) => { e.stopPropagation(); setIsEditingName(true); }}
            className="p-1 hover:bg-white/10 rounded transition-colors text-white/30 hover:text-white/60"
            title="Rename"
          >
            <Type size={12} />
          </button>
          {!isGroup && (
            <button 
              onClick={(e) => { e.stopPropagation(); setShowStyles(!showStyles); }}
              className={`p-1 hover:bg-white/10 rounded transition-colors ${showStyles ? 'text-blue-400' : 'text-white/30'}`}
              title="Styles"
            >
              <Palette size={12} />
            </button>
          )}
          <button 
            onClick={(e) => { e.stopPropagation(); onToggleVisibility(item.id, isGroup); }}
            className="p-1 hover:bg-white/10 rounded transition-colors text-white/30 hover:text-white/60"
          >
            {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      {!isGroup && showStyles && (
        <div 
          className="flex flex-col gap-2 p-3 mx-2 my-1 bg-white/5 border border-white/5 rounded-xl shadow-inner"
          style={{ marginLeft: `${depth * 16 + 24}px` }}
        >
          <div className="flex justify-between items-center gap-4">
            <span className="text-[10px] uppercase tracking-wider text-white/40 font-bold">Stroke Color</span>
            <input 
              type="color" 
              className="w-6 h-6 bg-transparent border-none cursor-pointer"
              value={("properties" in item ? item.properties.stroke : "#3b82f6")}
              onChange={(e) => onUpdateProperties(item.id, { stroke: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center">
              <span className="text-[10px] uppercase tracking-wider text-white/40 font-bold">Stroke Width</span>
              <span className="text-[10px] font-mono text-blue-400">{"properties" in item ? item.properties.strokeWidth.toFixed(1) : 1.5}px</span>
            </div>
            <input 
              type="range" 
              min="0.1" max="10" step="0.1"
              className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-blue-500"
              value={("properties" in item ? item.properties.strokeWidth : 1.5)}
              onChange={(e) => onUpdateProperties(item.id, { strokeWidth: parseFloat(e.target.value) })}
            />
          </div>
        </div>
      )}

      {isGroup && isOpen && item.children.map((child) => (
        <TreeNode 
          key={child.id} 
          item={child} 
          depth={depth + 1} 
          hiddenIds={hiddenIds} 
          onToggleVisibility={onToggleVisibility}
          onUpdateProperties={onUpdateProperties}
        />
      ))}
    </div>
  );
};

export const LayerPanel: React.FC<LayerPanelProps> = ({ root, hiddenIds, onToggleVisibility, onUpdateProperties }) => {
  return (
    <div className="flex flex-col gap-2 h-full">
      <div className="flex items-center gap-2 mb-2 text-blue-400">
        <Folder size={16} />
        <h3 className="text-xs font-bold uppercase tracking-widest">SVG Structure</h3>
      </div>
      <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden py-2 custom-scrollbar flex-1 overflow-y-auto">
        {root.children.map((child) => (
          <TreeNode 
            key={child.id} 
            item={child} 
            depth={0} 
            hiddenIds={hiddenIds} 
            onToggleVisibility={onToggleVisibility} 
            onUpdateProperties={onUpdateProperties}
          />
        ))}
      </div>
    </div>
  );
};
