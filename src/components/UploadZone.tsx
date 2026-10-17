import React, { useCallback } from "react";

interface UploadZoneProps {
  onImageUploaded: (img: HTMLImageElement) => void;
  onVectorUploaded?: (svg: string) => void;
}

export const UploadZone: React.FC<UploadZoneProps> = ({ onImageUploaded, onVectorUploaded }) => {
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const isSVG = file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
      if (isSVG && onVectorUploaded) {
        const reader = new FileReader();
        reader.onload = (event) => {
          onVectorUploaded(event.target?.result as string);
        };
        reader.readAsText(file);
      } else {
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => onImageUploaded(img);
          img.src = event.target?.result as string;
        };
        reader.readAsDataURL(file);
      }
    }
  }, [onImageUploaded, onVectorUploaded]);

  return (
    <div className="w-full">
      <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-600 rounded-lg cursor-pointer bg-gray-800 hover:bg-gray-700 transition-colors group">
        <div className="flex flex-col items-center justify-center pt-5 pb-6">
          <svg className="w-8 h-8 mb-4 text-gray-400 group-hover:text-blue-400" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 16">
            <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2" />
          </svg>
          <p className="mb-2 text-sm text-gray-400">
            <span className="font-semibold text-blue-400">Click to upload</span> or drag and drop
          </p>
          <p className="text-xs text-gray-500">Raster (PNG, JPG) or Vector (SVG)</p>
        </div>
        <input type="file" className="hidden" accept="image/*,.svg" onChange={handleFileChange} />
      </label>
    </div>
  );
};
