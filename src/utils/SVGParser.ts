import type { VectorGeometry, VectorGroup, VectorFeature } from "../components/types";

export const parseSVGToGeometry = (svgString: string): VectorGeometry => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");
  const svg = doc.querySelector("svg");
  
  let viewBox = [0, 0, 360, 180];
  if (svg?.getAttribute("viewBox")) {
    viewBox = svg.getAttribute("viewBox")!.trim().split(/[\s,]+/).map(Number);
  } else {
    const w = parseFloat(svg?.getAttribute("width") || "360");
    const h = parseFloat(svg?.getAttribute("height") || "180");
    viewBox = [0, 0, w, h];
  }

  const [vx, vy, vw, vh] = viewBox;
  const flatFeatures: VectorFeature[] = [];

  const toLonLat = (x: number, y: number): [number, number] => {
    return [((x - vx) / vw) * 360 - 180, 90 - ((y - vy) / vh) * 180];
  };

  let elementCounter = 0;

  const processNode = (node: Element): (VectorGroup | VectorFeature)[] => {
    const results: (VectorGroup | VectorFeature)[] = [];
    
    node.childNodes.forEach((child) => {
      if (!(child instanceof Element)) return;
      
      const tagName = child.tagName.toLowerCase();
      const id = child.getAttribute("id") || `${tagName}-${++elementCounter}`;
      const name = child.getAttribute("name") || child.getAttribute("class") || id;

      if (tagName === "g") {
        const children = processNode(child);
        if (children.length > 0) {
          results.push({
            id,
            name,
            type: "group",
            children
          });
        }
      } else if (tagName === "path") {
        const d = child.getAttribute("d");
        if (!d) return;

        const tokens = d.match(/[a-df-z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/gi) || [];
        let subpaths: [number, number][][] = [];
        let currentSubpath: [number, number][] = [];
        let cur: [number, number] = [0, 0];
        let startPos: [number, number] = [0, 0];
        let cmd = '';

        for (let j = 0; j < tokens.length; j++) {
          const token = tokens[j];
          if (/[a-z]/i.test(token)) { cmd = token; } else {
            const type = cmd.toUpperCase();
            const isRel = cmd === cmd.toLowerCase();
            const getArgs = (n: number) => {
              const args = [];
              for (let k = 0; k < n; k++) args.push(parseFloat(tokens[j + k] || "0"));
              j += n - 1;
              return args;
            };

            if (type === 'M') {
              const [x, y] = getArgs(2);
              if (isRel) { cur[0] += x; cur[1] += y; } else { cur[0] = x; cur[1] = y; }
              if (currentSubpath.length > 0) subpaths.push(currentSubpath);
              currentSubpath = [toLonLat(cur[0], cur[1])];
              startPos = [...cur];
              cmd = isRel ? 'l' : 'L';
            } else if (type === 'L') {
              const [x, y] = getArgs(2);
              if (isRel) { cur[0] += x; cur[1] += y; } else { cur[0] = x; cur[1] = y; }
              currentSubpath.push(toLonLat(cur[0], cur[1]));
            } else if (type === 'H') {
              const [x] = getArgs(1); if (isRel) cur[0] += x; else cur[0] = x;
              currentSubpath.push(toLonLat(cur[0], cur[1]));
            } else if (type === 'V') {
              const [y] = getArgs(1); if (isRel) cur[1] += y; else cur[1] = y;
              currentSubpath.push(toLonLat(cur[0], cur[1]));
            } else if (type === 'C') {
              const [, , , , x, y] = getArgs(6);
              if (isRel) { cur[0] += x; cur[1] += y; } else { cur[0] = x; cur[1] = y; }
              currentSubpath.push(toLonLat(cur[0], cur[1]));
            } else if (type === 'Z') {
              cur[0] = startPos[0]; cur[1] = startPos[1];
              currentSubpath.push(toLonLat(cur[0], cur[1]));
              subpaths.push(currentSubpath);
              currentSubpath = [];
            }
          }
        }
        if (currentSubpath.length > 0) subpaths.push(currentSubpath);

        subpaths.forEach((points, subIdx) => {
          if (points.length < 2) return;
          const feature: VectorFeature = {
            id: `${id}-${subIdx}`,
            type: "Feature",
            geometry: { type: "LineString", coordinates: points },
            properties: { 
              id: `${id}-${subIdx}`, 
              name: name, 
              stroke: child.getAttribute("stroke") || "#3b82f6", 
              strokeWidth: parseFloat(child.getAttribute("stroke-width") || "1.5"),
              fill: child.getAttribute("fill") || "none" 
            }
          };
          results.push(feature);
          flatFeatures.push(feature);
        });
      }
    });
    return results;
  };

  const rootChildren = svg ? processNode(svg) : [];

  return {
    type: "FeatureCollection",
    root: { id: "root", name: "SVG Root", type: "group", children: rootChildren },
    features: flatFeatures
  };
};
