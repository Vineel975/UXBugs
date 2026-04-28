"use client";

import { useRef } from "react";
import { Document, Page } from "react-pdf";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RotateCw, RotateCcw } from "lucide-react";

interface PdfViewerPanelProps {
  activePdfFile: "hospital" | "tariff" | "benefitPlan";
  onActivePdfChange: (value: string) => void;
  hospitalBill?: string | File | null;
  tariffFile?: string | File | null;
  claimId?: string;
  pdfContainerRef?: React.RefObject<HTMLDivElement>;
  onPdfWidthChange?: (width: number) => void;
  pdfPages: { hospital: number; tariff: number };
  setPdfPages: React.Dispatch<React.SetStateAction<{ hospital: number; tariff: number }>>;
  onDocumentLoadSuccess?: (info: { numPages: number }) => void;
  onDocumentLoadError?: (error: Error) => void;
  pdfWidth?: number;
  pdfError?: Error | null;
  showSampleData?: boolean;
  pageRotations?: Record<string, number>;
  onRotatePage?: (fileType: string, pageIndex: number, direction: "cw" | "ccw") => void;
}

export function PdfViewerPanel({
  activePdfFile,
  onActivePdfChange,
  hospitalBill,
  tariffFile,
  claimId,
  pdfContainerRef,
  onPdfWidthChange,
  pdfPages,
  setPdfPages,
  onDocumentLoadSuccess,
  onDocumentLoadError,
  pdfWidth = 600,
  pdfError,
  showSampleData,
  pageRotations = {},
  onRotatePage,
}: PdfViewerPanelProps) {
  const containerRef = pdfContainerRef ?? useRef<HTMLDivElement>(null);

  const activePdf =
    activePdfFile === "hospital" ? hospitalBill :
    activePdfFile === "tariff"   ? tariffFile   : null;

  const activePages =
    activePdfFile === "hospital" ? pdfPages.hospital :
    activePdfFile === "tariff"   ? pdfPages.tariff   : 0;

  const fileKey = activePdfFile === "benefitPlan" ? "tariff" : activePdfFile;

  const getRotation = (pageIndex: number) =>
    pageRotations[`${fileKey}-${pageIndex}`] ?? 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tab switcher */}
      <div className="shrink-0 border-b bg-white px-3 py-2">
        <Tabs value={activePdfFile} onValueChange={onActivePdfChange}>
          <TabsList className="h-8">
            <TabsTrigger value="hospital" className="text-xs px-3 py-1">
              Hospital Bill
            </TabsTrigger>
            <TabsTrigger value="tariff" className="text-xs px-3 py-1">
              Tariff
            </TabsTrigger>
            <TabsTrigger value="benefitPlan" className="text-xs px-3 py-1">
              Benefit Plan
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* PDF pages */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto bg-gray-100 px-3 py-3 space-y-4"
      >
        {!activePdf ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            No document available
          </div>
        ) : (
          <Document
            file={activePdf}
            onLoadSuccess={(info) => {
              const n = info.numPages;
              if (activePdfFile === "hospital") setPdfPages((p) => ({ ...p, hospital: n }));
              else if (activePdfFile === "tariff") setPdfPages((p) => ({ ...p, tariff: n }));
              onDocumentLoadSuccess?.({ numPages: n });
            }}
            onLoadError={onDocumentLoadError}
            loading={
              <div className="flex items-center justify-center py-10 text-sm text-gray-400">
                Loading PDF...
              </div>
            }
          >
            {Array.from({ length: activePages }, (_, i) => {
              const pageNum   = i + 1;
              const rotation  = getRotation(i);
              const isRotated = rotation === 90 || rotation === 270;

              return (
                <div
                  key={`page-${pageNum}`}
                  className="relative group bg-white shadow-sm rounded-sm overflow-hidden"
                >
                  {/* Rotation buttons — appear on hover */}
                  {onRotatePage && (
                    <div className="absolute top-2 right-2 z-10 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {/* Page number badge */}
                      <span className="flex items-center rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
                        {pageNum}
                      </span>
                      <button
                        type="button"
                        title="Rotate counter-clockwise"
                        onClick={() => onRotatePage(fileKey, i, "ccw")}
                        className="flex items-center justify-center rounded bg-black/50 p-1 text-white hover:bg-black/70 transition-colors"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Rotate clockwise"
                        onClick={() => onRotatePage(fileKey, i, "cw")}
                        className="flex items-center justify-center rounded bg-black/50 p-1 text-white hover:bg-black/70 transition-colors"
                      >
                        <RotateCw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}

                  {/* PDF page — react-pdf Page accepts rotate prop */}
                  <div
                    className="flex items-center justify-center"
                    style={{
                      // When rotated 90/270, swap dimensions so page fits container
                      minHeight: isRotated ? pdfWidth : undefined,
                    }}
                  >
                    <Page
                      pageNumber={pageNum}
                      width={isRotated ? undefined : pdfWidth}
                      height={isRotated ? pdfWidth : undefined}
                      rotate={rotation}
                      renderAnnotationLayer={false}
                      renderTextLayer={true}
                    />
                  </div>
                </div>
              );
            })}
          </Document>
        )}
      </div>
    </div>
  );
}
