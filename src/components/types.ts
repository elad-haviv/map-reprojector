export interface MapCanvasHandle {
  exportImage: () => void;
  exportSVG: () => void;
}

export interface VectorFeature {
  id: string;
  type: "Feature";
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
  properties: {
    id: string;
    stroke: string;
    strokeWidth: number;
    fill: string;
    name?: string;
  };
}

export interface VectorGroup {
  id: string;
  name: string;
  type: "group";
  children: (VectorGroup | VectorFeature)[];
}

export interface VectorGeometry {
  type: "FeatureCollection";
  root: VectorGroup;
  features: VectorFeature[]; // Flat list for easy D3 rendering
}
