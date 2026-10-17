import { useState, useEffect, useRef, useCallback, memo } from "react";
import { MapCanvas } from "./components/MapCanvas";
import { PROJECTIONS } from "./utils/projections";
import type { MapCanvasHandle, VectorGeometry, VectorGroup, VectorFeature } from "./components/types";
import { parseSVGToGeometry } from "./utils/SVGParser";
import { ControlPanel } from "./components/ControlPanel";
import { LayerPanel } from "./components/LayerPanel";
import { UploadZone } from "./components/UploadZone";
import { Menu, X, ZoomIn, ZoomOut, Layers, Globe, Move, Maximize2, Download, ListTree, Crosshair } from "lucide-react";

const MemoLayerPanel = memo(LayerPanel);

function App() {
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [vectorData, setVectorData] = useState<VectorGeometry | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [rotation, setRotation] = useState<[number, number, number]>([0, 0, 0]);
  const [zoom, setZoom] = useState(1);
  const [projectionId, setProjectionId] = useState("orthographic");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isLayerPanelOpen, setIsLayerPanelOpen] = useState(true);
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [focusMode, setFocusMode] = useState(false);
  const exitFocusMode = useCallback(() => setFocusMode(false), []);
  
  const mapCanvasRef = useRef<MapCanvasHandle>(null);

  // Update window size on resize
  useEffect(() => {
    const handleResize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Keyboard: F toggles region focus, Esc cancels it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") setFocusMode(false);
      else if (e.key === "f" || e.key === "F") setFocusMode((m) => !m);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleInteraction = useCallback((newRotation: [number, number, number], newZoom: number) => {
    setRotation(newRotation);
    setZoom(newZoom);
  }, []);

  const handleVectorUpload = (svgString: string) => {
    console.log("SVG data received, length:", svgString.length);
    const geometry = parseSVGToGeometry(svgString);
    console.log("Geometry parsed, features:", geometry.features.length);
    setVectorData(geometry);
    setHiddenIds(new Set());
    setIsLayerPanelOpen(true);
  };

  const toggleVisibility = useCallback((id: string) => {
    setHiddenIds(prev => {
      const next = new Set(prev);
      const isCurrentlyHidden = next.has(id);
      
      const toggleRecursive = (item: VectorGroup | VectorFeature, force?: boolean) => {
        const shouldHide = force !== undefined ? force : !isCurrentlyHidden;
        if (shouldHide) next.add(item.id); else next.delete(item.id);
        if ("children" in item) {
          item.children.forEach(child => toggleRecursive(child, shouldHide));
        }
      };

      const findAndToggle = (items: (VectorGroup | VectorFeature)[]) => {
        for (const item of items) {
          if (item.id === id) {
            toggleRecursive(item);
            return true;
          }
          if ("children" in item && findAndToggle(item.children)) return true;
        }
        return false;
      };

      if (vectorData) findAndToggle([vectorData.root]);
      return next;
    });
  }, [vectorData]);

  const updateVectorProperties = useCallback((id: string, updates: any) => {
    if (!vectorData) return;

    setVectorData(prev => {
      if (!prev) return null;
      const next = { ...prev };
      
      const updateRecursive = (items: (VectorGroup | VectorFeature)[]) => {
        for (const item of items) {
          if (item.id === id) {
            if (updates.name !== undefined && "name" in item) item.name = updates.name;
            if ("properties" in item) {
              item.properties = { ...item.properties, ...updates };
            }
            return true;
          }
          if ("children" in item && updateRecursive(item.children)) return true;
        }
        return false;
      };

      updateRecursive([next.root]);
      next.features = next.features.map(f => {
        if (f.id === id) {
          return { ...f, properties: { ...f.properties, ...updates } };
        }
        return f;
      });

      return next;
    });
  }, [vectorData]);

  const hasData = sourceImage || vectorData;

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden select-none">
      {/* Immersive Background Map Canvas */}
      <div className="absolute inset-0 z-0">
        {!hasData ? (
          <div className="w-full h-full flex flex-col items-center justify-center bg-[#0a0a0c] text-gray-500 gap-6">
             <div className="relative">
               <Globe className="w-24 h-24 text-blue-500/20 animate-pulse" />
               <div className="absolute inset-0 bg-blue-500/10 blur-3xl rounded-full" />
             </div>
             <div className="text-center space-y-2 max-w-md px-6">
                <h2 className="text-2xl font-light text-gray-300">Start Your Exploration</h2>
                <p className="text-sm text-gray-500">Upload an equirectangular image (raster) or an equirectangular SVG (vector) to reproject.</p>
                <div className="pt-4">
                  <UploadZone 
                    onImageUploaded={setSourceImage} 
                    onVectorUploaded={handleVectorUpload}
                  />
                </div>
             </div>
          </div>
        ) : (
            <MapCanvas
                ref={mapCanvasRef}
                sourceImage={sourceImage}
                vectorData={vectorData}
                hiddenIds={hiddenIds}
                projectionId={projectionId}
                width={windowSize.width}
                height={windowSize.height}
                rotation={rotation}
                zoom={zoom}
                onInteraction={handleInteraction}
                focusMode={focusMode}
                onFocusComplete={exitFocusMode}
              />
        )}
      </div>

      {/* Floating Header (Glass) */}
      <header className="absolute top-6 left-6 right-6 z-20 pointer-events-none">
        <div className="flex justify-between items-center max-w-screen-2xl mx-auto">
          <div className="flex items-center gap-4 bg-black/40 backdrop-blur-xl border border-white/10 p-3 pl-4 pr-6 rounded-2xl pointer-events-auto shadow-2xl">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <div className="h-6 w-px bg-white/10 mx-1" />
            <div className="flex flex-col">
              <span className="text-xs font-bold text-blue-400 uppercase tracking-widest leading-none mb-1">Reprojector</span>
              <h1 className="text-lg font-medium text-white/90 leading-none">Global Perspective</h1>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-3 bg-black/40 backdrop-blur-xl border border-white/10 p-2 rounded-2xl pointer-events-auto shadow-2xl">
            <button onClick={() => setZoom(z => z * 1.2)} className="p-2.5 hover:bg-white/10 rounded-xl transition-all" title="Zoom In"><ZoomIn size={18}/></button>
            <button onClick={() => setZoom(z => z / 1.2)} className="p-2.5 hover:bg-white/10 rounded-xl transition-all" title="Zoom Out"><ZoomOut size={18}/></button>
            <div className="h-4 w-px bg-white/10 mx-1" />
            <button onClick={() => setRotation([0, 0, 0])} className="p-2.5 hover:bg-white/10 rounded-xl transition-all" title="Reset Rotation"><Move size={18}/></button>
            <button onClick={() => setZoom(1)} className="p-2.5 hover:bg-white/10 rounded-xl transition-all" title="Reset Zoom"><Maximize2 size={18}/></button>
            {hasData && (
              <>
                <div className="h-4 w-px bg-white/10 mx-1" />
                <button
                  id="focus-region-btn"
                  onClick={() => setFocusMode((m) => !m)}
                  className={`p-2.5 rounded-xl transition-all ${focusMode ? 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-400/40' : 'hover:bg-white/10'}`}
                  title="Focus Region (F) — drag a box to center the projection on it"
                >
                  <Crosshair size={18}/>
                </button>
              </>
            )}
            {vectorData && (
              <>
                <div className="h-4 w-px bg-white/10 mx-1" />
                <button 
                  onClick={() => setIsLayerPanelOpen(!isLayerPanelOpen)} 
                  className={`p-2.5 rounded-xl transition-all ${isLayerPanelOpen ? 'bg-blue-500/20 text-blue-400' : 'hover:bg-white/10'}`} 
                  title="Toggle Layers"
                >
                  <ListTree size={18}/>
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Left Sidebar (Controls) */}
      <aside 
        className={`absolute top-28 left-6 bottom-6 w-80 z-20 transition-all duration-500 ease-in-out transform pointer-events-auto ${
          isSidebarOpen ? "translate-x-0 opacity-100" : "-translate-x-[calc(100%+24px)] opacity-0"
        }`}
      >
        <div className="h-full bg-black/40 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
          <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
            <div className="space-y-8">
              <section>
                <div className="flex items-center gap-2 mb-4 text-blue-400">
                  <Layers size={16} />
                  <h3 className="text-xs font-bold uppercase tracking-widest">Projection System</h3>
                </div>
                <div className="relative group">
                   <select
                    value={projectionId}
                    onChange={(e) => setProjectionId(e.target.value)}
                    className="w-full bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all appearance-none text-white/80 cursor-pointer"
                  >
                    {PROJECTIONS.map((p) => (
                      <option key={p.id} value={p.id} className="bg-gray-900">{p.name}</option>
                    ))}
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/30">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                  </div>
                </div>
              </section>

              <div className="h-px bg-white/5 w-full" />

              <ControlPanel
                rotation={rotation}
                onRotationChange={setRotation}
                projectionId={projectionId}
                onProjectionChange={setProjectionId}
                projections={[]}
                minimal={true}
              />

              {hasData && (
                <section className="space-y-4">
                   <div className="flex items-center gap-2 mb-2 text-blue-400">
                    <Download size={16} />
                    <h3 className="text-xs font-bold uppercase tracking-widest">Output</h3>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    <button 
                      onClick={() => mapCanvasRef.current?.exportImage()}
                      className="w-full flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 text-white font-medium py-3 px-4 rounded-xl transition-all shadow-lg shadow-blue-500/20 active:scale-[0.98]"
                    >
                      <Download size={18} />
                      Export PNG
                    </button>
                    {vectorData && (
                      <button 
                        onClick={() => mapCanvasRef.current?.exportSVG()}
                        className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-white border border-white/10 font-medium py-3 px-4 rounded-xl transition-all active:scale-[0.98]"
                      >
                        <Layers size={18} className="text-blue-400" />
                        Export Reprojected SVG
                      </button>
                    )}
                  </div>
                  
                  <div className="h-px bg-white/5 w-full my-4" />
                  
                   <div className="flex items-center gap-2 mb-4 text-blue-400">
                    <Move size={16} />
                    <h3 className="text-xs font-bold uppercase tracking-widest">Change Source</h3>
                  </div>
                  <UploadZone 
                    onImageUploaded={setSourceImage} 
                    onVectorUploaded={handleVectorUpload}
                  />
                </section>
              )}
            </div>
          </div>
          
          <div className="p-6 bg-white/5 border-t border-white/10">
            <p className="text-[10px] text-white/30 uppercase tracking-[0.2em] font-medium text-center">
              Vector Reprojector Suite v1.2
            </p>
          </div>
        </div>
      </aside>

      {/* Right Sidebar (Layer Hierarchy) */}
      {vectorData && (
        <aside 
          className={`absolute top-28 right-6 bottom-6 w-80 z-20 transition-all duration-500 ease-in-out transform pointer-events-auto ${
            isLayerPanelOpen ? "translate-x-0 opacity-100" : "translate-x-[calc(100%+24px)] opacity-0"
          }`}
        >
          <div className="h-full bg-black/40 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
            <div className="p-6 overflow-hidden flex flex-col h-full">
              <MemoLayerPanel 
                root={vectorData.root} 
                hiddenIds={hiddenIds} 
                onToggleVisibility={toggleVisibility} 
                onUpdateProperties={updateVectorProperties}
              />
            </div>
          </div>
        </aside>
      )}

      {/* Focus mode hint */}
      {focusMode && (
         <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 px-4 py-2 bg-blue-500/15 backdrop-blur-md border border-blue-400/30 rounded-full pointer-events-none animate-pulse">
            <p className="text-[10px] text-blue-200 font-bold uppercase tracking-widest">Lasso a region to focus &bull; Esc to cancel</p>
         </div>
      )}

      {/* Bottom Help (Glass) */}
      {!hasData && (
         <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 px-4 py-2 bg-blue-500/10 backdrop-blur-md border border-blue-500/20 rounded-full">
            <p className="text-[10px] text-blue-300 font-bold uppercase tracking-widest">Equirectangular Projections &bull; Real-time Rendering</p>
         </div>
      )}
    </div>
  );
}

export default App;
