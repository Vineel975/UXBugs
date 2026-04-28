import { NextResponse } from "next/server";

/**
 * POST /api/bsi
 *
 * Fetches Balance Sum Insured data by calling Spectra's GetBSIForClaimAI
 * endpoint via the bsi-proxy (which handles CORS/auth).
 * Spectra uses SpectraUtils.Main().GetBSI() DLL which correctly calculates
 * Utilized, Blocked, Reserved from MemberUtilization table.
 */

const SPECTRA_BASE_URL =
  process.env.SPECTRA_BASE_URL ?? "http://localhost:50052";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { claimId?: string };
    const claimId = body?.claimId?.trim();

    if (!claimId) {
      return NextResponse.json(
        { error: "claimId is required" },
        { status: 400 },
      );
    }

    // Call Spectra's GetBSIForClaimAI — uses SpectraUtils DLL for correct
    // Utilized/Blocked/Reserved calculation matching what Spectra UI shows
    const spectraUrl = `${SPECTRA_BASE_URL}/MedicalScrutiny/GetBSIForClaimAI?claimId=${encodeURIComponent(claimId)}`;

    let spectraResponse: Response;
    try {
      spectraResponse = await fetch(spectraUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      return NextResponse.json(
        { error: "Cannot reach Spectra for BSI data", detail: msg },
        { status: 503 },
      );
    }

    if (!spectraResponse.ok) {
      const text = await spectraResponse.text().catch(() => "");
      return NextResponse.json(
        { error: `Spectra BSI returned HTTP ${spectraResponse.status}`, detail: text.slice(0, 200) },
        { status: 502 },
      );
    }

    // BSIinfo from Spectra DLL — already has correct Suminsured/Utilized/Blocked/Reserved
    const bsiRaw = await spectraResponse.json() as Record<string, unknown>;

    // Map BSIinfo shape → BSIData shape expected by financial-summary-tab
    // BSIinfo.Suminsured is an array of SI rows with Utilized/Blocked/Reserved
    const siRows = Array.isArray(bsiRaw.Suminsured) ? bsiRaw.Suminsured : [];
    const otherRows = Array.isArray(bsiRaw.OtherBenefits) ? bsiRaw.OtherBenefits : [];

    const mapRow = (row: Record<string, unknown>) => ({
      BPSIID:           Number(row.BPSIID          ?? row.BPSumInsuredID ?? 0),
      MemberSIID:       Number(row.MemberSIID       ?? 0),
      SITypeID:         Number(row.SITypeID         ?? 6),
      SICategery:       Number(row.SICategery       ?? row.SICategoryID  ?? 69),
      Suminsured:       Number(row.Suminsured        ?? row.SumInsured    ?? 0),
      CBAmount:         Number(row.CBAmount          ?? row.CB_Amount     ?? 0),
      Reserved:         Number(row.Reserved          ?? 0),
      Blocked:          Number(row.Blocked           ?? 0),
      Utilized:         Number(row.Utilized          ?? 0),
      Balance:          Number(row.Balance           ?? 0),
      EffectiveBalance: Number(row.EffectiveBalance  ?? row.Balance       ?? 0),
      Utilization:      Array.isArray(row.Utilization) ? row.Utilization : [],
    });

    const bsiData = {
      Suminsured:     siRows.map(r => mapRow(r as Record<string, unknown>)),
      OtherBenefits:  otherRows.map(r => mapRow(r as Record<string, unknown>)),
      EligibleAmount: Number(bsiRaw.EligibleAmount ?? bsiRaw.EffectiveBalance ?? 0),
    };

    return NextResponse.json({ bsiData });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch BSI data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
