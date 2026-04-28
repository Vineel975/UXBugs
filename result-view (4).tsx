"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { tabsListVariants } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProcessingState } from "@/src/processing-service";
import type { ExtractionResult, PdfAnalysis, TariffBreakdownItem } from "@/src/types";
import { ChangeLog } from "@/src/changelog";
import { computeClaimCalculation } from "@/src/claim-calculation";
import { ProcessingLogs } from "./result-view/processing-logs";
import { PdfViewerPanel } from "./result-view/pdf-viewer-panel";
import { PatientInfoTab } from "./result-view/tabs/patient-info-tab";
import { MedicalAdmissibilityTab } from "./result-view/tabs/medical-admissibility-tab";
import { FinancialSummaryTab } from "./result-view/tabs/financial-summary-tab";
import { useMutation as useConvexMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ChevronDown, Save } from "lucide-react";

function getBasename(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

interface ResultViewProps {
  hospitalBill: File | string | null;
  tariffFile: File | string | null;
  showSampleData: boolean;
  state: ProcessingState | undefined;
  isProcessing: boolean;
  selectedFileResult: ExtractionResult | null;
  selectedAnalysis: PdfAnalysis | null;
  onDocumentLoadSuccess: ({ numPages }: { numPages: number }) => void;
  onDocumentLoadError: (error: Error) => void;
  pdfError: Error | null;
  spectraFields?: {
    availedAccommodationId?: string;
    facilityOptions?: Array<{ id: string; text: string }>;
    [key: string]: unknown;
  } | null;
}

// ── Save split-button with dropdown ──────────────────────────────────────────
function SaveDropdown({
  onSave,
  onSaveAndRaiseQuery,
  onDontSaveAndRaiseQuery,
  isSaving,
}: {
  onSave: () => void;
  onSaveAndRaiseQuery: () => void;
  onDontSaveAndRaiseQuery: () => void;
  isSaving: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex w-full">
      {/* Main Save button */}
      <Button
        type="button"
        disabled={isSaving}
        onClick={onSave}
        className="flex-1 rounded-r-none !border-emerald-700 !bg-emerald-600 !text-white hover:!bg-emerald-700"
      >
        <Save className="mr-1.5 h-4 w-4" />
        {isSaving ? "Saving..." : "Save"}
      </Button>

      {/* Chevron dropdown trigger */}
      <button
        type="button"
        disabled={isSaving}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center rounded-r-md border-l border-emerald-700 bg-emerald-600 px-2 text-white hover:bg-emerald-700 disabled:opacity-50"
        aria-label="More save options"
      >
        <ChevronDown className="h-4 w-4" />
      </button>

      {/* Dropdown menu */}
      {open && (
        <>
          {/* Click-outside overlay */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute bottom-full left-0 z-50 mb-1 w-56 rounded-md border border-border bg-background shadow-lg">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted"
              onClick={() => { setOpen(false); onSaveAndRaiseQuery(); }}
            >
              <Save className="h-4 w-4 text-emerald-600" />
              Save and raise query
            </button>
            <div className="mx-3 border-t border-border" />
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted"
              onClick={() => { setOpen(false); onDontSaveAndRaiseQuery(); }}
            >
              <ChevronDown className="h-4 w-4 text-amber-500" />
              Don&apos;t save and raise query
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function ResultView({
  hospitalBill,
  tariffFile,
  showSampleData,
  state,
  isProcessing,
  selectedFileResult,
  selectedAnalysis,
  onDocumentLoadSuccess,
  onDocumentLoadError,
  pdfError,
  spectraFields,
}: ResultViewProps) {
  const updateResult = useConvexMutation(api.processing.updateResult);
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const [pdfWidth, setPdfWidth] = useState<number>(800);
  const [activePdfFile, setActivePdfFile] = useState<
    "hospital" | "tariff" | "benefitPlan"
  >("hospital");
  const [pdfPages, setPdfPages] = useState<{
    hospital: number;
    tariff: number;
  }>({
    hospital: 0,
    tariff: 0,
  });
  // Per-page rotation state: key = "{fileType}-{pageIndex}", value = 0|90|180|270
  const [pageRotations, setPageRotations] = useState<Record<string, number>>({});
  const rotatePage = (fileType: string, pageIndex: number, direction: "cw" | "ccw") => {
    const key = `${fileType}-${pageIndex}`;
    setPageRotations((prev) => ({
      ...prev,
      [key]: ((prev[key] ?? 0) + (direction === "cw" ? 90 : -90) + 360) % 360,
    }));
  };
  const reportSections = useMemo(
    () => [
      { id: "patient", label: "Patient Info" },
      { id: "medicalAdmissibility", label: "Medical Admissibility" },
      { id: "financialSummary", label: "Summary" },
    ],
    [],
  );
  const [activeSection, setActiveSection] = useState(reportSections[0].id);
  const reportScrollRef = useRef<HTMLDivElement>(null);
  const [editedAnalysis, setEditedAnalysis] = useState<PdfAnalysis | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [presentingComplaint, setPresentingComplaint] = useState("");
  const [processingRemarks,   setProcessingRemarks]   = useState("");
  const [doctorNotes,         setDoctorNotes]         = useState("");
  const [benefitPlanSnapshot, setBenefitPlanSnapshot] = useState<Record<string, unknown> | null>(null);
  const changeLogRef = useRef(new ChangeLog());
  const pendingChangesRef = useRef(new ChangeLog()); // Track pending changes separately
  const [changeLogVersion, setChangeLogVersion] = useState(0);
  const changeLog = changeLogRef.current;
  const pendingChanges = pendingChangesRef.current;
  const [logContentVisible, setLogContentVisible] = useState(true);
  const [isLogsPanelForced, setIsLogsPanelForced] = useState(false);
  const [logs, setLogs] = useState<Array<{ id: string; message: string }>>([]);
  const [reviewDecision, setReviewDecision] = useState<
    "approve" | "deny" | "query" | null
  >(null);
  const [isQueryDialogOpen, setIsQueryDialogOpen] = useState(false);
  const [queryType, setQueryType] = useState("");
  const [queryMessage, setQueryMessage] = useState("");
  // Stores the AI-determined approved accommodation ID — computed in background
  // when analysis loads so it's ready instantly when Save is clicked
  const approvedAccommodationRef = useRef<string | null>(null);

  // Helper to trigger re-render when changelog updates
  const updateChangeLog = () => {
    setChangeLogVersion((v) => v + 1);
  };

  // Helper to add pending change entry (not added to changelog until save)
  const addChangeLogEntry = (
    tab: string,
    record: string,
    field: string,
    previousValue: string | number | null | undefined,
    newValue: string | number | null | undefined,
  ) => {
    // Add to pending changes instead of changelog
    pendingChanges.addEntry(tab, record, field, previousValue, newValue);
    updateChangeLog();
  };

  // Set active PDF file to first available file
  useEffect(() => {
    if (hospitalBill && activePdfFile !== "hospital") {
      setActivePdfFile("hospital");
    } else if (!hospitalBill && tariffFile && activePdfFile !== "tariff") {
      setActivePdfFile("tariff");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospitalBill, tariffFile]);

  // Consume backend debug logs directly from processing state
  useEffect(() => {
    if (!state?.logs) return;
    const formatted = state.logs.map((entry, idx) => ({
      id: `${entry.timestamp}-${idx}`,
      message: entry.message,
    }));
    setLogs(formatted);
  }, [state?.logs]);

  // Initialize editedAnalysis when selectedAnalysis changes
  // Use a ref to track the last initialized filePath to avoid resetting on re-renders
  const lastInitializedFilePathRef = useRef<string | null>(null);
  useEffect(() => {
    const currentFilePath = selectedFileResult?.filePath;
    // Only initialize if filePath changed (don't reset on re-renders with same file)
    if (
      selectedAnalysis &&
      selectedFileResult &&
      currentFilePath !== lastInitializedFilePathRef.current
    ) {
      setEditedAnalysis(JSON.parse(JSON.stringify(selectedAnalysis)));

      // Restore changelog from saved data instead of clearing it
      if (
        selectedFileResult.changelogEntries &&
        selectedFileResult.changelogEntries.length > 0
      ) {
        changeLog.load(selectedFileResult.changelogEntries);
      } else {
        changeLog.clear(); // Only clear if no saved changelog exists
      }
      // Clear pending changes when switching files
      pendingChanges.clear();
      updateChangeLog();
      lastInitializedFilePathRef.current = currentFilePath || null;
    }
  }, [selectedFileResult?.filePath, selectedAnalysis, selectedFileResult]);

  // Use editedAnalysis for display, fallback to selectedAnalysis
  // This ensures all tabs use the latest edited data
  const displayAnalysis = useMemo(() => {
    return editedAnalysis || selectedAnalysis;
  }, [editedAnalysis, selectedAnalysis]);

  // Handler to scroll PDF to a specific page
  const handleScrollToPage = (pageNumber: number) => {
    if (!pdfContainerRef.current || !pageNumber || pageNumber <= 0) return;

    // Ensure hospital bill is active for medical admissibility
    if (hospitalBill) {
      setActivePdfFile("hospital");
    }

    // Small delay to ensure PDF pages are rendered
    setTimeout(() => {
      if (!pdfContainerRef.current) return;

      // Find the page element by its data-page-number attribute
      const pageElements =
        pdfContainerRef.current.querySelectorAll("[data-page-number]");

      for (const el of Array.from(pageElements)) {
        const pageNum = parseInt(
          (el as HTMLElement).getAttribute("data-page-number") || "0",
        );
        if (pageNum === pageNumber) {
          // Scroll to the page element
          (el as HTMLElement).scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
          break;
        }
      }
    }, 100);
  };

  const handleScrollToTariffPage = (pageNumber?: number | null, highlightText?: string, highlightName?: string) => {
    if (!pdfContainerRef.current || !pageNumber || pageNumber <= 0) return;
    if (!tariffFile) return;

    setActivePdfFile("tariff");

    // Remove any previous highlights
    const clearHighlights = () => {
      document.querySelectorAll(".tariff-highlight").forEach((el) => {
        (el as HTMLElement).classList.remove("tariff-highlight");
        (el as HTMLElement).style.removeProperty("background");
        (el as HTMLElement).style.removeProperty("border-radius");
        (el as HTMLElement).style.removeProperty("padding");
        (el as HTMLElement).style.removeProperty("outline");
        (el as HTMLElement).style.removeProperty("outline-offset");
      });
    };

    setTimeout(() => {
      if (!pdfContainerRef.current) return;

      clearHighlights();

      const pageElements =
        pdfContainerRef.current.querySelectorAll("[data-page-number]");

      for (const el of Array.from(pageElements)) {
        const pageNum = parseInt(
          (el as HTMLElement).getAttribute("data-page-number") || "0",
        );
        if (pageNum === pageNumber) {
          (el as HTMLElement).scrollIntoView({
            behavior: "smooth",
            block: "start",
          });

          if (highlightText) {
            setTimeout(() => {
              const normalize = (s: string) =>
                s.replace(/,/g, "").replace(/\s+/g, " ").trim().toLowerCase();
              const normalizedAmount = normalize(highlightText);
              const normalizedName = highlightName ? normalize(highlightName) : null;

              const textSpans = Array.from(
                (el as HTMLElement).querySelectorAll(
                  ".react-pdf__Page__textContent span",
                ),
              ) as HTMLElement[];

              const applyHighlight = (span: HTMLElement) => {
                span.classList.add("tariff-highlight");
                span.style.background = "rgba(251, 191, 36, 0.6)";
                span.style.borderRadius = "2px";
                span.style.padding = "1px 2px";
                span.style.outline = "2px solid rgba(217, 119, 6, 0.7)";
                span.style.outlineOffset = "1px";
              };

              // Find all spans that contain the amount
              const amountSpanIndices: number[] = [];
              textSpans.forEach((span, i) => {
                const text = normalize(span.textContent || "");
                if (
                  text &&
                  (text === normalizedAmount ||
                    text.includes(normalizedAmount) ||
                    (normalizedAmount.includes(text) && text.length > 2))
                ) {
                  amountSpanIndices.push(i);
                }
              });

              if (amountSpanIndices.length === 0) return;

              // If only one amount match — highlight it directly
              if (amountSpanIndices.length === 1) {
                applyHighlight(textSpans[amountSpanIndices[0]]);
                return;
              }

              // Multiple matches — try to find the one closest to the procedure name
              if (normalizedName) {
                // Find the index of a span whose text is part of the procedure name
                let nameSpanIndex = -1;
                const nameWords = normalizedName.split(" ").filter((w) => w.length > 3);

                for (let i = 0; i < textSpans.length; i++) {
                  const text = normalize(textSpans[i].textContent || "");
                  if (
                    text &&
                    text.length > 2 &&
                    nameWords.some((word) => text.includes(word))
                  ) {
                    nameSpanIndex = i;
                    break;
                  }
                }

                if (nameSpanIndex >= 0) {
                  // Pick the amount span with the smallest index distance to the name span
                  let closestIdx = amountSpanIndices[0];
                  let minDist = Math.abs(amountSpanIndices[0] - nameSpanIndex);

                  for (const idx of amountSpanIndices) {
                    const dist = Math.abs(idx - nameSpanIndex);
                    if (dist < minDist) {
                      minDist = dist;
                      closestIdx = idx;
                    }
                  }

                  applyHighlight(textSpans[closestIdx]);
                  return;
                }
              }

              // Fallback — highlight all amount matches
              amountSpanIndices.forEach((i) => applyHighlight(textSpans[i]));
            }, 600);
          }

          break;
        }
      }
    }, 150);
  };

  const formatAmountValue = (amount?: number | null) => {
    if (amount === null || amount === undefined || Number.isNaN(amount)) {
      return "—";
    }
    return amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const claimCalculation = useMemo(() => {
    if (!displayAnalysis) return null;
    return computeClaimCalculation(displayAnalysis);
  }, [displayAnalysis]);

  // Track user-edited amounts from FinancialSummaryTab
  const [editedAmounts, setEditedAmounts] = useState<{
    claimed: number | null;
    tariff: number | null;
    approved: number | null;
  }>({ claimed: null, tariff: null, approved: null });

  // Financial Summary Calculations
  const financialSummaryTotals = useMemo(() => {
    if (!claimCalculation) {
      return {
        hospitalBillAfterDiscount: 0,
        hospitalBillBeforeDiscount: 0,
        discount: 0,
        totalTariffDeductible: 0,
        totalTariffOverflow: 0,
        policyCoverageWithinTariff: 0,
        totalNME: 0,
        insurerPayable: 0,
        patientPayable: 0,
        cataractSublimit: null,
      };
    }
    return {
      hospitalBillAfterDiscount: claimCalculation.hospitalBillAfterDiscount,
      hospitalBillBeforeDiscount: claimCalculation.hospitalBillBeforeDiscount,
      discount: claimCalculation.discount,
      totalTariffDeductible: 0,
      totalTariffOverflow: 0,
      policyCoverageWithinTariff: 0,
      totalNME: 0,
      insurerPayable: claimCalculation.insurerPayable,
      patientPayable: 0,
      cataractSublimit: null,
    };
  }, [claimCalculation]);

  const finalInsurerPayable =
    claimCalculation?.finalInsurerPayable ?? displayAnalysis?.finalInsurerPayable;
  const finalInsurerPayableNotes =
    claimCalculation?.finalInsurerPayableNotes ||
    displayAnalysis?.finalInsurerPayableNotes;

  // ── Build pre-populated query message from validation failures ───────────────
  // Collects all field mismatches and missing investigation reports,
  // formats them as a structured query message.
  const buildQueryMessage = (): { type: string; message: string } => {
    const lines: string[] = [];

    // 1. Field validation mismatches from patientInfoDb sections
    if (displayAnalysis?.patientInfoDb?.sections?.length) {
      const allRows = displayAnalysis.patientInfoDb.sections.flatMap((s) => s.rows);

      const normalizeVal = (v: string | number | boolean | null | undefined): string =>
        String(v ?? "").trim();

      const normalizeDate = (s: string): string => {
        const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
        if (iso) return iso[1];
        const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,"0")}-${dmy[1].padStart(2,"0")}`;
        return s;
      };

      const normalizeGender = (s: string): string => {
        const g = s.toLowerCase();
        if (g === "1" || g === "f" || g === "female") return "female";
        if (g === "2" || g === "m" || g === "male")   return "male";
        return g;
      };

      const fieldChecks: Array<{
        label: string;
        aiValue: string | null | undefined;
        aliases: string[];
        normalize?: (s: string) => string;
      }> = [
        { label: "Patient Name",    aiValue: displayAnalysis.patientName?.value as string,    aliases: ["membername","patientname","name"] },
        { label: "Patient Age",     aiValue: String(displayAnalysis.patientAge?.value ?? ""), aliases: ["age","patientage"] },
        { label: "Gender",          aiValue: displayAnalysis.patientGender?.value as string,  aliases: ["gender","genderid"], normalize: normalizeGender },
        { label: "Policy Number",   aiValue: displayAnalysis.policyNumber?.value as string,   aliases: ["uhidno","uhid","patientuhid","policyno","policynumber"] },
        { label: "Hospital Name",   aiValue: displayAnalysis.hospitalName?.value as string,   aliases: ["hospitalname","providername","name"] },
        { label: "Admission Date",  aiValue: displayAnalysis.admissionDate?.value as string,  aliases: ["dateofadmission","doa","admissiondate"], normalize: normalizeDate },
        { label: "Document Date",   aiValue: displayAnalysis.date?.value as string,           aliases: ["dateofbill","documentdate","billdate","date","createddate"] , normalize: normalizeDate },
      ];

      const normalizeKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

      for (const check of fieldChecks) {
        if (!check.aiValue) continue;
        const norm = check.normalize ?? ((s: string) => s.trim().toLowerCase().replace(/\s+/g," "));
        const aiNorm = norm(check.aiValue);
        if (!aiNorm) continue;

        // Find DB value using aliases
        let dbVal: string | null = null;
        for (const alias of check.aliases) {
          for (const row of allRows) {
            for (const [k, v] of Object.entries(row)) {
              if (normalizeKey(k) === alias && v !== null && v !== undefined && String(v).trim()) {
                dbVal = String(v).trim();
                break;
              }
            }
            if (dbVal) break;
          }
          if (dbVal) break;
        }

        if (!dbVal) continue;
        const dbNorm = norm(dbVal);
        if (aiNorm !== dbNorm) {
          lines.push(`• ${check.label}: "${check.aiValue}" in medical bill vs "${dbVal}" in Spectra DB`);
        }
      }
    }

    // 2. Missing investigation reports from conditionTests
    const conditionTests = (
      displayAnalysis?.medicalAdmissibility as
        | { conditionTests?: Array<{ testName: string; status: string }> }
        | null | undefined
    )?.conditionTests ?? [];

    const missingTests = conditionTests.filter((t) => t.status === "missing");
    for (const t of missingTests) {
      lines.push(`• ${t.testName} report is missing in the provided medical documents`);
    }

    if (!lines.length) return { type: "", message: "" };

    const message = "The following discrepancies/issues were found during claim review:\n\n"
      + lines.join("\n")
      + "\n\nPlease provide clarification or submit the correct documents.";

    return { type: "billing", message };
  };

  // ── Determine approved accommodation using AI ────────────────────────────────
  // Fetches benefit plan room rules + uses tariff/bill context to ask Claude
  // which facility option best matches what the patient is eligible for.
  // Sends data to Spectra parent via postMessage on Save click.
  // Populates: Aprv Accommodation + Probable Diagnosis + Present Complaint
  // Pre-populate presentingComplaint from AI extraction only
  useEffect(() => {
    if (presentingComplaint || !displayAnalysis) return;
    const admissibility = displayAnalysis?.medicalAdmissibility as {
      presentingComplaint?: string | null;
    } | null | undefined;
    if (admissibility?.presentingComplaint) {
      setPresentingComplaint(admissibility.presentingComplaint);
    }
  }, [displayAnalysis]);

  // Pre-populate doctorNotes — fetch from API using claimId (most reliable)
  useEffect(() => {
    const claimId = state?.claimId?.trim();
    if (!claimId || doctorNotes) return;
    // Try spectraFields first (fast path)
    if (spectraFields?.doctorNotes) {
      setDoctorNotes((spectraFields.doctorNotes as string) ?? "");
      return;
    }
    // Fallback: fetch directly from server
    fetch(`/api/doctor-notes?claimId=${encodeURIComponent(claimId)}`)
      .then((r) => r.json())
      .then((data) => { if (data.doctorNotes) setDoctorNotes(data.doctorNotes); })
      .catch(() => {});
  }, [state?.claimId, spectraFields]);

  // Fetch benefit plan snapshot for alignment conditions
  useEffect(() => {
    const claimId = state?.claimId?.trim();
    if (!claimId || benefitPlanSnapshot) return;
    let cancelled = false;
    fetch("/api/benefit-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimId }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setBenefitPlanSnapshot((d as { snapshot?: Record<string, unknown> }).snapshot ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.claimId]);

  const sendAccommodationToSpectra = async () => {
    if (!(window.parent && window.parent !== window)) {
      return;
    }

    // ── Approved Accommodation ───────────────────────────────────────────────
    const facilityId =
      approvedAccommodationRef.current ??
      (spectraFields?.availedAccommodationId as string | undefined) ??
      null;

    if (facilityId) {
      window.parent.postMessage(
        { source: "claimai", type: "setApprovedAccommodation", facilityId },
        "*",
      );
    } else {
      window.parent.postMessage(
        { source: "claimai", type: "copyAvailedToApproved" },
        "*",
      );
    }

    // ── Clinical / Treatment Details ─────────────────────────────────────────
    const diagnosis        = displayAnalysis?.medicalAdmissibility?.diagnosis        ?? null;
    const lineOfTreatment  = (displayAnalysis?.medicalAdmissibility as { lineOfTreatment?: string | null } | null | undefined)?.lineOfTreatment ?? null;

    // ── ICD codes — collect all 7 levels from the conditionKey "__icd__" ─────
    // icdLevels is local to medical-admissibility-tab; read from DOM state via event
    // We pass the diagnosis text so Spectra can look it up in its MasterData.ICD10

    // Infer hospital treatment type: Surgical or Medical
    const diagLower = (diagnosis ?? "").toLowerCase();
    const lineOfTreatmentLower = (lineOfTreatment ?? "").toLowerCase();
    const combined = `${diagLower} ${lineOfTreatmentLower}`;
    const hospTreatmentKeyword =
      /cataract|phaco|surger|cholecyst|appendic|hernia|fracture|ortho|laparoscop|bypass|angioplasty|stent|arthroplasty|joint replacement|spine|neurosurg|tumor|carcinoma|resection|transplant|excision|biopsy|repair|fixation/.test(combined)
        ? "surgical"
        : /pneumonia|infection|fever|diabet|hypertension|asthma|copd|bronchit|cardiac arrest|myocardial|renal failure|hepatitis|conservative|medical management|iv antibio|chemotherapy/.test(combined)
        ? "medical"
        : null;

    const procedureHint  = `${diagnosis ?? ""} ${lineOfTreatment ?? ""}`.toLowerCase();
    // Use user-edited amounts if available, else computed values
    const eligibleAmount = editedAmounts.approved
                        ?? claimCalculation?.finalInsurerPayable
                        ?? displayAnalysis?.finalInsurerPayable
                        ?? claimCalculation?.insurerPayable
                        ?? 0;
    const packageAmount  = editedAmounts.claimed
                        ?? claimCalculation?.hospitalBillAfterDiscount
                        ?? claimCalculation?.hospitalBillBeforeDiscount
                        ?? (displayAnalysis?.totalAmount?.value ?? 0);

    // Send clinical details immediately — don't wait for ICD fetch
    if (diagnosis || lineOfTreatment || presentingComplaint.trim() || hospTreatmentKeyword || processingRemarks.trim() || doctorNotes.trim()) {
      window.parent.postMessage(
        {
          source:               "claimai",
          type:                 "setClinicalDetails",
          diagnosis:            diagnosis             ?? "",
          lineOfTreatment:      lineOfTreatment       ?? "",
          presentingComplaint:  presentingComplaint.trim(),
          processingRemarks:    processingRemarks.trim(),
          doctorNotes:          doctorNotes.trim(),
          hospTreatmentKeyword: hospTreatmentKeyword  ?? "",
          icdSlots:             [],
          procedureHint:        procedureHint,
          eligibleAmount:       eligibleAmount,
          packageAmount:        packageAmount,
        },
        "*",
      );
    }

    // Send billing details to Spectra for Bill Details automation
    // tariffAmount: use edited tariff if available, else from analysis
    const tariffAmtForBilling = editedAmounts.tariff
      ?? (displayAnalysis?.tariffExtractionItem as Array<{amount?: number}> | null | undefined)
          ?.reduce((s, i) => s + (i.amount ?? 0), 0)
      ?? 0;
    if (packageAmount > 0 || tariffAmtForBilling > 0) {
      window.parent.postMessage(
        {
          source:             "claimai",
          type:               "setBillingDetails",
          hospitalBillAmount: packageAmount,
          tariffAmount:       tariffAmtForBilling,
        },
        "*",
      );
    }

    // Fetch ICD codes in background and send as separate message
    if (diagnosis) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const icdRes = await fetch(`/api/icd?diagnosis=${encodeURIComponent(diagnosis)}`, { signal: controller.signal });
        clearTimeout(timer);
        if (icdRes.ok) {
          const icdData = await icdRes.json() as { slots?: Array<{ code: string; description: string; level: number } | null> };
          const icdSlots = icdData.slots ?? [];
          window.parent.postMessage(
            {
              source:        "claimai",
              type:          "setIcdSlots",
              icdSlots,
              procedureHint,
              eligibleAmount,
              packageAmount,
            },
            "*",
          );
        }
      } catch { /* ignore */ }
    }
  };

  const determineApprovedAccommodation = async (): Promise<string | null> => {
    try {
      const claimId = state?.claimId?.trim();
      const facilityOptions = (spectraFields?.facilityOptions as Array<{ id: string; text: string }> | undefined) ?? [];
      const availedId = spectraFields?.availedAccommodationId as string | undefined;
      if (!claimId || !facilityOptions.length || !availedId) return availedId ?? null;

      // Find availed room text
      const availedOption = facilityOptions.find((f) => f.id === availedId);
      const availedText = availedOption?.text ?? availedId;

      // Fetch benefit plan room conditions
      let roomNotes = "";
      let roomRows: Array<Record<string, unknown>> = [];
      try {
        const bpRes = await fetch("/api/benefit-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ claimId }),
        });
        if (bpRes.ok) {
          const bpData = await bpRes.json() as {
            snapshot?: {
              remarks?: {
                room?: Array<Record<string, unknown>>;
                main?: Array<Record<string, unknown>>;
              };
            };
          };
          const mainRow = bpData?.snapshot?.remarks?.main?.[0] ?? {};
          roomNotes = String(mainRow["RoomNotes"] ?? "").trim();
          roomRows = bpData?.snapshot?.remarks?.room ?? [];
        }
      } catch { /* use empty */ }

      // Collect tariff room rent cap
      const tariffItems = displayAnalysis?.tariffExtractionItem ?? [];
      const roomRentCapItem = tariffItems.find((t) =>
        /room\s*rent\s*cap/i.test(t.name) || /accommodation\s*cap/i.test(t.name)
      );
      const roomRentCap = roomRentCapItem ? `₹${roomRentCapItem.amount}/day` : null;

      // Collect hospital bill room charges
      const billSummary = displayAnalysis?.hospitalSummary ?? [];
      const roomChargeItem = billSummary.find((s) =>
        /room/i.test(s.serviceName) || /accommodation/i.test(s.serviceName)
      );
      const roomCharge = roomChargeItem ? `₹${roomChargeItem.amount}` : null;

      // Days in hospital
      const admDate = displayAnalysis?.admissionDate?.value;
      const disDate = displayAnalysis?.dischargeDate?.value;
      let days: number | null = null;
      if (admDate && disDate) {
        const d1 = new Date(admDate), d2 = new Date(disDate);
        if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
          days = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000));
        }
      }

      // Build prompt — using string concat to avoid nested template literal syntax errors
      const facilityList = facilityOptions.map((f) => "  " + f.id + ": " + f.text).join("\n");
      const roomRowsText = roomRows.length > 0
        ? "Room details: " + JSON.stringify(roomRows)
        : "";
      const roomChargeNum = (days && roomCharge)
        ? Math.round(Number(String(roomCharge).replace(/[^0-9]/g, "")) / days)
        : 0;
      const roomChargePerDay = (days && roomCharge)
        ? " over " + String(days) + " days (approx Rs." + String(roomChargeNum) + "/day)"
        : "";

      const prompt = [
        "You are a health insurance claim auditor. Based on the following information, decide which approved accommodation type should be applied.",
        "",
        "AVAILED ACCOMMODATION (what patient used): " + availedText,
        "",
        "AVAILABLE ACCOMMODATION OPTIONS (id - name):",
        facilityList,
        "",
        "BENEFIT PLAN ROOM CONDITIONS:",
        roomNotes || "(no room notes in benefit plan)",
        roomRowsText,
        "",
        "TARIFF ROOM RENT CAP: " + (roomRentCap ?? "(not specified in tariff)"),
        "",
        "HOSPITAL ROOM CHARGES: " + (roomCharge ?? "(not found in bill summary)") + roomChargePerDay,
        "",
        "INSTRUCTIONS:",
        "1. Compare the availed accommodation with the benefit plan room conditions and tariff cap.",
        "2. If the availed room is within the eligible limit, approve the same room type.",
        "3. If the availed room exceeds the limit (e.g. private room but policy covers semi-private), approve the highest eligible room type.",
        "4. If no room conditions are specified, approve same as availed.",
        "5. Return ONLY a JSON object with exactly this shape, no explanation:",
        '{"facilityId": "<id from options above>", "reason": "<one sentence reason>"}',
      ].join("\n");

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 200,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!response.ok) return availedId;

      const data = await response.json() as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = data.content?.find((b) => b.type === "text")?.text ?? "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return availedId;

      const parsed = JSON.parse(jsonMatch[0]) as { facilityId?: string; reason?: string };
      const recommendedId = parsed?.facilityId?.toString().trim();

      // Validate the returned ID is in the options list
      if (recommendedId && facilityOptions.some((f) => f.id === recommendedId)) {
        console.log("[ClaimAI] Accommodation recommendation:", parsed.reason);
        return recommendedId;
      }
      return availedId;
    } catch (err) {
      console.warn("[ClaimAI] determineApprovedAccommodation error:", err);
      return spectraFields?.availedAccommodationId ?? null;
    }
  };

  // Run accommodation determination in background as soon as data is available
  // so the result is ready by the time Save is clicked (no delay on save)
  // Placed here — after displayAnalysis and determineApprovedAccommodation are defined
  useEffect(() => {
    approvedAccommodationRef.current = null;
    if (!spectraFields?.availedAccommodationId || !spectraFields?.facilityOptions?.length) return;
    if (!displayAnalysis) return;

    let cancelled = false;
    const run = async () => {
      const result = await determineApprovedAccommodation();
      if (!cancelled) approvedAccommodationRef.current = result;
    };
    void run();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spectraFields?.availedAccommodationId, displayAnalysis]);

  const handleSave = async () => {
    if (!editedAnalysis || !selectedFileResult) return;

    setIsSaving(true);
    try {
      // Move pending changes to changelog before saving
      // Group by tab+record+field to merge multiple changes to same field
      // Get all entries (not reversed, so we can process chronologically)
      const allPendingEntries = pendingChanges.getEntries().reverse(); // Reverse to get chronological order
      const mergedEntries = new Map<
        string,
        {
          tab: string;
          record: string;
          field: string;
          originalValue: string;
          finalValue: string;
        }
      >();

      // Group entries by tab+record+field
      const entriesByKey = new Map<string, typeof allPendingEntries>();
      allPendingEntries.forEach((entry) => {
        const key = `${entry.tab}|${entry.record}|${entry.field}`;
        if (!entriesByKey.has(key)) {
          entriesByKey.set(key, []);
        }
        entriesByKey.get(key)!.push(entry);
      });

      // For each field, use the first entry's previousValue and last entry's newValue
      entriesByKey.forEach((entries, key) => {
        // Entries are already in chronological order
        const firstEntry = entries[0];
        const lastEntry = entries[entries.length - 1];
        mergedEntries.set(key, {
          tab: firstEntry.tab,
          record: firstEntry.record,
          field: firstEntry.field,
          originalValue: firstEntry.previousValue,
          finalValue: lastEntry.newValue,
        });
      });

      // Add merged entries to changelog
      mergedEntries.forEach((entry) => {
        changeLog.addEntry(
          entry.tab,
          entry.record,
          entry.field,
          entry.originalValue,
          entry.finalValue,
        );
      });
      // Clear pending changes after moving to changelog
      pendingChanges.clear();
      updateChangeLog();

      // Serialize changelog entries for persistence
      const changelogEntries = changeLog.serialize();

      const recalculatedClaim = computeClaimCalculation(editedAnalysis);
      const analysisToSave: PdfAnalysis = {
        ...editedAnalysis,
        baseInsurerPayable: recalculatedClaim.insurerPayable,
        benefitAmount:
          recalculatedClaim.benefitAmount ?? editedAnalysis.benefitAmount,
        finalInsurerPayable:
          recalculatedClaim.finalInsurerPayable ?? undefined,
        finalInsurerPayableNotes:
          recalculatedClaim.finalInsurerPayableNotes || undefined,
      };

      await updateResult({
        filePath: selectedFileResult.filePath,
        analysis: analysisToSave,
        changelogEntries:
          changelogEntries.length > 0 ? changelogEntries : undefined,
      });

      setEditedAnalysis(analysisToSave);

      alert("Changes saved successfully!");

      // Send Refer to Insurer data — built from field mismatches + missing documents
      // Uses buildQueryMessage() which checks:
      //   1. Name/Age/Gender/Policy/Hospital/Date mismatches vs Spectra DB
      //   2. Missing investigation reports from conditionTests
      const referQuery = buildQueryMessage();
      if (referQuery.message.trim()) {
        window.parent.postMessage(
          {
            source:   "claimai",
            type:     "setReferToInsurer",
            remarks:  referQuery.message.trim(),
          },
          "*",
        );
      }

      // Notify Spectra: save complete — read jobId from URL path /job/{jobId}
      const urlJobId = typeof window !== "undefined"
        ? window.location.pathname.split("/").filter(Boolean).pop() ?? ""
        : "";
      window.parent.postMessage(
        { source: "claimai", type: "claimAISaveComplete", jobId: urlJobId },
        "*",
      );
    } catch (error) {
      console.error("Error saving:", error);
      alert(
        error instanceof Error
          ? error.message
          : "Failed to save changes. Please try again.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanges = useMemo(() => {
    if (!editedAnalysis || !selectedAnalysis) return false;
    return JSON.stringify(editedAnalysis) !== JSON.stringify(selectedAnalysis);
  }, [editedAnalysis, selectedAnalysis]);

  const changeLogEntries = useMemo(
    () => changeLog.getEntries(),
    [changeLogVersion, changeLog],
  );

  const fileName = selectedFileResult
    ? getBasename(selectedFileResult.filePath)
    : "—";

  const handleAnalysisUpdate = (
    updater: (analysis: PdfAnalysis) => PdfAnalysis,
  ) => {
    setEditedAnalysis((prev) => {
      const base = prev || selectedAnalysis;
      if (!base) return prev;
      const updated = updater({ ...base });
      return updated;
    });
  };

  // Show processing logs when:
  // 1. Currently processing
  // 2. Status is idle
  // 3. No analysis available (regardless of status) - this includes error cases
  const hasLogs = (state?.logs?.length ?? 0) > 0;
  const isAwaitingResults =
    isProcessing || state?.status === "idle" || !selectedAnalysis;
  const shouldShowProcessingLogs =
    !showSampleData && (isAwaitingResults || isLogsPanelForced);
  const canToggleLogsPanel = !showSampleData && !isAwaitingResults && hasLogs;

  useEffect(() => {
    if (
      (!hasLogs || showSampleData) &&
      isLogsPanelForced &&
      !isAwaitingResults
    ) {
      setIsLogsPanelForced(false);
    }
  }, [hasLogs, isLogsPanelForced, isAwaitingResults, showSampleData]);

  const handlePdfWidthChange = (width: number) => {
    setPdfWidth(width);
  };

  useEffect(() => {
    const container = reportScrollRef.current;
    if (!container) return;

    const sectionElements = reportSections
      .map((section) => document.getElementById(section.id))
      .filter((el): el is HTMLElement => Boolean(el));

    if (sectionElements.length === 0) return;

    let raf = 0;
    const updateActive = () => {
      raf = 0;
      const containerTop = container.getBoundingClientRect().top;
      const activationOffset = 80;
      let current = sectionElements[0].id;

      for (const section of sectionElements) {
        const offset = section.getBoundingClientRect().top - containerTop;
        if (offset <= activationOffset) {
          current = section.id;
        } else {
          break;
        }
      }

      setActiveSection(current);
    };

    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(updateActive);
    };

    const onResize = () => {
      updateActive();
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    updateActive();

    return () => {
      container.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [reportSections, selectedFileResult?.filePath]);

  return (
    <main className="flex-1 w-full h-full overflow-hidden">
      <ResizablePanelGroup orientation="horizontal" className="h-full">
        {/* Tabs Content - Left Side */}
        <ResizablePanel
          defaultSize={40}
          className="flex h-full min-w-0 flex-col overflow-hidden border-r border-slate-200/80 bg-gradient-to-b from-slate-50 to-white"
        >
          {shouldShowProcessingLogs ? (
            <ProcessingLogs
              isProcessing={isProcessing}
              state={state}
              showLogs={logContentVisible}
              onToggleLogs={setLogContentVisible}
              logs={logs}
            />
          ) : selectedFileResult && selectedAnalysis ? (
            <div className="flex h-full w-full flex-col overflow-hidden">
              <div className="sticky top-0 z-10 w-full bg-background px-3 py-2">
                <div>
                  <div className="group/tabs" data-orientation="horizontal">
                    <div
                      data-slot="tabs-list"
                      data-variant="default"
                      className={cn(
                        tabsListVariants({ variant: "default" }),
                         "grid w-full grid-cols-3",
                      )}
                    >
                      {reportSections.map((section) => (
                        <button
                          key={section.id}
                          type="button"
                          data-active={
                            activeSection === section.id ? true : undefined
                          }
                          onClick={() => {
                            const target = document.getElementById(section.id);
                            if (target) {
                              setActiveSection(section.id);
                              target.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              });
                            }
                            // Fix 10: when clicking Summary (Benefit Extraction), open Benefit Plan on right panel
                            if (section.id === "financialSummary") {
                              setActivePdfFile("benefitPlan");
                            }
                          }}
                           className={cn(
                             "gap-1.5 rounded-md border border-transparent px-1.5 py-1 text-sm font-medium group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg:not([class*='size-'])]:size-4 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring text-foreground/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center whitespace-nowrap transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
                             "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
                             "data-active:bg-background dark:data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 data-active:text-foreground",
                             "after:bg-foreground after:absolute after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
                            )}
                        >
                          {section.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div
                ref={reportScrollRef}
                className="flex-1 overflow-y-auto scroll-smooth scroll-pt-0 px-3 pb-8 pt-3"
              >
                <section id="patient" className="py-2">
                  <PatientInfoTab
                    fileName={fileName}
                    claimId={state?.claimId}
                    displayAnalysis={displayAnalysis || null}
                    hasChanges={hasChanges}
                    isSaving={isSaving}
                    onSave={handleSave}
                    onUpdateAnalysis={handleAnalysisUpdate}
                    addChangeLogEntry={addChangeLogEntry}
                    onScrollToPage={handleScrollToPage}
                  />
                </section>
                <section id="medicalAdmissibility" className="py-2">
                  <MedicalAdmissibilityTab
                    fileName={fileName}
                    medicalAdmissibility={displayAnalysis?.medicalAdmissibility}
                    onScrollToPage={handleScrollToPage}
                    presentingComplaint={presentingComplaint}
                    onPresentingComplaintChange={setPresentingComplaint}
                  />
                </section>
                <section id="financialSummary" className="py-2">
                  <FinancialSummaryTab
                    fileName={fileName}
                    claimCalculation={claimCalculation}
                    financialSummaryTotals={financialSummaryTotals}
                    onBenefitExtractionClick={() => setActivePdfFile("benefitPlan")}
                    diagnosis={selectedAnalysis?.medicalAdmissibility?.diagnosis ?? null}
                    finalInsurerPayable={finalInsurerPayable}
                    finalInsurerPayableNotes={finalInsurerPayableNotes}
                    formatAmountValue={formatAmountValue}
                    lensType={displayAnalysis?.lensType}
                    lensTypePageNumber={displayAnalysis?.lensTypePageNumber}
                    lensTypeApproved={displayAnalysis?.lensTypeApproved}
                    eyeType={displayAnalysis?.eyeType}
                    isAllInclusivePackage={displayAnalysis?.isAllInclusivePackage ?? false}
                    tariffPageNumber={displayAnalysis?.tariffPageNumber}
                    tariffNotes={displayAnalysis?.tariffNotes}
                    tariffClarificationNote={displayAnalysis?.tariffClarificationNote}
                    tariffExtractionItem={displayAnalysis?.tariffExtractionItem}
                    hospitalBillBreakdown={displayAnalysis?.hospitalBillBreakdown}
                    hospitalBillPageNumber={displayAnalysis?.totalAmount?.pageNumber}
                    benefitAmount={claimCalculation?.benefitAmount ?? displayAnalysis?.benefitAmount}
                    onHospitalAmountClick={(pageNumber) => {
                      if (pageNumber) {
                        handleScrollToPage(pageNumber);
                      }
                    }}
                    onTariffAmountClick={handleScrollToTariffPage}
                    claimId={state?.claimId}
                    memberPolicyId={(spectraFields?.memberPolicyId as string | undefined) ?? undefined}
                    onAmountsChange={(claimed, tariff, approved) =>
                      setEditedAmounts({ claimed, tariff, approved })
                    }
                  />
                </section>

                <div className="mt-4 space-y-2">
                  <label className="text-sm font-medium text-gray-700">
                    Processing Remarks
                  </label>
                  <textarea
                    value={processingRemarks}
                    onChange={(e) => setProcessingRemarks(e.target.value)}
                    placeholder="Enter processing remarks..."
                    rows={3}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 resize-none"
                  />
                </div>
                <div className="mt-4 space-y-2">
                  <label className="text-sm font-medium text-gray-700">
                    Processing Doctor Notes
                  </label>
                  <textarea
                    value={doctorNotes}
                    onChange={(e) => setDoctorNotes(e.target.value)}
                    placeholder="Doctor notes..."
                    rows={3}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 resize-none"
                  />
                </div>
                <div className="mt-4 border-t border-border/80 py-4">
                  <SaveDropdown
                    onSave={() => {
                      sendAccommodationToSpectra();
                      handleSave();
                    }}
                    onSaveAndRaiseQuery={() => {
                      sendAccommodationToSpectra();
                      handleSave();
                      const q = buildQueryMessage();
                      if (q.type) setQueryType(q.type);
                      if (q.message) setQueryMessage(q.message);
                      setIsQueryDialogOpen(true);
                    }}
                    onDontSaveAndRaiseQuery={() => {
                      sendAccommodationToSpectra();
                      const q = buildQueryMessage();
                      if (q.type) setQueryType(q.type);
                      if (q.message) setQueryMessage(q.message);
                      setIsQueryDialogOpen(true);
                    }}
                    isSaving={isSaving}
                  />
                </div>
                {isQueryDialogOpen ? (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-xl rounded-xl border border-border bg-background p-4 shadow-lg">
                      <div className="mb-3 text-base font-semibold">Raise Query</div>
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <div className="text-sm font-medium">Query Type</div>
                          <Select value={queryType} onValueChange={setQueryType}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select query type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="documentation">Documentation</SelectItem>
                              <SelectItem value="coding">Coding Clarification</SelectItem>
                              <SelectItem value="billing">Billing Clarification</SelectItem>
                              <SelectItem value="clinical">Clinical Clarification</SelectItem>
                              <SelectItem value="policy">Policy Clarification</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <div className="text-sm font-medium">Query Details</div>
                          <textarea
                            value={queryMessage}
                            onChange={(event) => setQueryMessage(event.target.value)}
                            placeholder="Enter query details..."
                            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 min-h-28 w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
                          />
                        </div>
                        <div className="flex items-center justify-end gap-2 pt-1">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setIsQueryDialogOpen(false)}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            variant="default"
                            disabled={!queryType || !queryMessage.trim()}
                            onClick={() => {
                              setReviewDecision("query");
                              setIsQueryDialogOpen(false);
                            }}
                          >
                            Submit Query
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : state?.status === "completed" && selectedFileResult ? (
            <Card className="flex-1 overflow-y-auto">
              <CardContent className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                No analysis data found for this file.
              </CardContent>
            </Card>
          ) : (
            <Card className="flex-1 overflow-y-auto">
              <CardContent className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                Loading...
              </CardContent>
            </Card>
          )}
        </ResizablePanel>

        <ResizableHandle withHandle className="bg-slate-200/90" />

        <ResizablePanel defaultSize={60} className="h-full min-w-0 overflow-hidden bg-white">
          <PdfViewerPanel
            activePdfFile={activePdfFile}
            onActivePdfChange={(value) =>
              setActivePdfFile(value as "hospital" | "tariff" | "benefitPlan")
            }
            hospitalBill={hospitalBill}
            tariffFile={tariffFile}
            claimId={state?.claimId}
            pdfContainerRef={pdfContainerRef}
            onPdfWidthChange={handlePdfWidthChange}
            pdfPages={pdfPages}
            setPdfPages={setPdfPages}
            onDocumentLoadSuccess={onDocumentLoadSuccess}
            onDocumentLoadError={onDocumentLoadError}
            pdfWidth={pdfWidth}
            pdfError={pdfError}
            showSampleData={showSampleData}
            pageRotations={pageRotations}
            onRotatePage={rotatePage}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
  );
}
