import * as d3Geo from "d3-geo";
import * as d3GeoProj from "d3-geo-projection";

/** Shared projection registry used by the UI, the canvas and the reprojection workers. */
export const PROJECTIONS: { id: string; name: string; creator: () => d3Geo.GeoProjection }[] = [
  { id: "orthographic", name: "Orthographic (Globe)", creator: () => d3Geo.geoOrthographic() },
  { id: "mercator", name: "Mercator", creator: () => d3Geo.geoMercator() },
  { id: "equirectangular", name: "Equirectangular", creator: () => d3Geo.geoEquirectangular() },
  { id: "robinson", name: "Robinson", creator: () => (d3GeoProj as any).geoRobinson() },
  { id: "mollweide", name: "Mollweide", creator: () => (d3GeoProj as any).geoMollweide() },
  { id: "winkel3", name: "Winkel Tripel", creator: () => (d3GeoProj as any).geoWinkel3() },
  { id: "fahey", name: "Fahey", creator: () => (d3GeoProj as any).geoFahey() },
  { id: "naturalEarth", name: "Natural Earth", creator: () => d3Geo.geoNaturalEarth1() },
];

export function createProjection(id: string): d3Geo.GeoProjection {
  const info = PROJECTIONS.find((p) => p.id === id) || PROJECTIONS[0];
  return info.creator();
}

/** Scale at zoom = 1 for a given projection and viewport size. */
export function baseScaleFor(id: string, width: number, height: number): number {
  return id === "orthographic" ? Math.min(width, height) / 4 : 150;
}
