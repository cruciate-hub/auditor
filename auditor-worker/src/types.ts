// ─── Worker Environment ─────────────────────────────────────────
export interface Env {
  CACHE: KVNamespace;
  ANTHROPIC_API_KEY: string;
  ALLOWED_ORIGIN: string;
  GITHUB_TOKEN?: string;
}

// ─── Request / Response shapes ──────────────────────────────────
export interface AnalyzeRequest {
  content: string;
  contentType: string;
  sourceUrl: string | null;
  mode: AnalysisMode;
  persona?: "cpo" | "cto" | "developer" | null;
}

export type AnalysisMode =
  | "full"
  | "terminology"
  | "hierarchy"
  | "tone"
  | "persona"
  | "positioning";

export interface ExtractRequest {
  url: string;
}

export interface ExtractResponse {
  content: string;
  title: string;
  url: string;
}

// ─── Analysis Result (matches frontend mock data shape) ─────────
export interface DimensionScore {
  dimension: string;
  score: number;
  fullMark: number;
}

export interface Finding {
  id: number;
  severity: "critical" | "warning" | "suggestion";
  category: "Terminology" | "Hierarchy" | "Tone" | "Claims" | "Positioning";
  text: string;
  location: string;
  explanation: string;
  docRef: string;
  suggestion: string;
  original: string;
  revised: string;
}

export interface TermCheck {
  term: string;
  found: boolean;
  count: number;
}

export interface TermsResult {
  approved: TermCheck[];
  forbidden: TermCheck[];
}

export interface AuditResult {
  overallScore: number;
  dimensions: DimensionScore[];
  findings: Finding[];
  terms: TermsResult;
  guidelinesVersion: string;
  analyzedUrl: string | null;
  mode: AnalysisMode;
  contentType: string;
}

// ─── Annotated content for side-by-side view ────────────────────
export interface AnnotatedSection {
  location: string;
  original: string;
  revised: string;
  highlights: Array<{
    text: string;
    severity: "critical" | "warning" | "suggestion";
    tooltip: string;
  }>;
}

export interface FullAuditResult extends AuditResult {
  annotated?: AnnotatedSection[];
}
