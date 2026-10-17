import type { GeoProjection } from "d3-geo";

export interface PixelMapParams {
  sourceData: Uint8ClampedArray;
  sourceWidth: number;
  sourceHeight: number;
  targetData: Uint8ClampedArray;
  targetWidth: number;
  targetHeight: number;
  projection: GeoProjection;
}

/**
 * Perform inverse mapping for raster reprojection.
 * Source image is assumed to be Equirectangular (lon/lat mapping linearly to u/v).
 */
export function reprojectRaster({
  sourceData,
  sourceWidth,
  sourceHeight,
  targetData,
  targetWidth,
  targetHeight,
  projection,
}: PixelMapParams) {
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const targetIndex = (y * targetWidth + x) * 4;
      
      // Get [lon, lat] for current target pixel
      const coords = projection.invert?.([x, y]);
      
      if (coords) {
        const [lon, lat] = coords;
        
        // Map lon/lat to source pixel (Equirectangular)
        // lon: [-180, 180] -> [0, sourceWidth]
        // lat: [90, -90] -> [0, sourceHeight]
        const u = ((180 + lon) / 360) * sourceWidth;
        const v = ((90 - lat) / 180) * sourceHeight;
        
        // Nearest neighbor sampling
        const su = Math.floor(u);
        const sv = Math.floor(v);
        
        if (su >= 0 && su < sourceWidth && sv >= 0 && sv < sourceHeight) {
          const sourceIndex = (sv * sourceWidth + su) * 4;
          
          targetData[targetIndex] = sourceData[sourceIndex];
          targetData[targetIndex + 1] = sourceData[sourceIndex + 1];
          targetData[targetIndex + 2] = sourceData[sourceIndex + 2];
          targetData[targetIndex + 3] = sourceData[sourceIndex + 3];
        } else {
          // Transparent or background
          targetData[targetIndex + 3] = 0;
        }
      } else {
        // Pixel is outside projection sphere (e.g. back of Orthographic)
        targetData[targetIndex + 3] = 0;
      }
    }
  }
}
