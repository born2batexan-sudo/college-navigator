// Plain TypeScript types mirroring schema.sql (snake_case columns mapped to
// camelCase fields at the repo boundary — see repo.ts's row mappers).

export type Household = {
  id: string;
  name: string;
  timezone: string;
  subState: string;
  createdAt: string;
};

export type Person = {
  id: string;
  householdId: string;
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  consentState: string;
  createdAt: string;
};

export type Student = {
  id: string;
  householdId: string;
  name: string;
  gradYear: number;
  applicantType: string;
  residency: string;
  attributes: string; // JSON string
  createdAt: string;
};

export type Institution = {
  id: string;
  name: string;
  slug: string;
  domains: string; // JSON string array
  pathway: string;
  coverageStatus: string;
  coveragePct: number;
  createdAt: string;
};

export type InstitutionRelationship = {
  id: string;
  studentId: string;
  institutionId: string;
  lifecycleState: string;
  decisionDate: string | null;
  commitDate: string | null;
  createdAt: string;
};

export type Source = {
  id: string;
  institutionId: string;
  url: string;
  label: string;
  authorityLevel: string;
  owner: string | null;
  lastVerified: string | null;
  fingerprint: string | null;
  lastContent: string | null;
  createdAt: string;
};

export type Rule = {
  id: string;
  institutionId: string;
  checkpointCode: string;
  domain: string;
  title: string;
  critical: boolean;
  population: string;
  requirement: string;
  trigger: string | null;
  dependsOnCode: string | null;
  deadlineExpr: string | null;
  actor: string;
  costCents: number | null;
  refundable: string;
  consequence: string | null;
  status: string;
  confidence: string;
  verifiedAt: string | null;
  sourceId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GuidanceAsset = {
  id: string;
  ruleId: string;
  what: string;
  when: string;
  why: string;
  how: string;
  consequence: string;
  deepLink: string | null;
  generatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ObservationPattern = {
  id: string;
  institutionId: string;
  workflow: string;
  urlPattern: string;
  signal: string;
  impliesState: string;
  relatedCheckpointCode: string | null;
  confidenceThreshold: number;
  createdAt: string;
};

export type ActionInstance = {
  id: string;
  relationshipId: string;
  ruleId: string;
  dueAt: string | null;
  applicabilityReason: string;
  priority: string;
  state: string;
  createdAt: string;
  updatedAt: string;
};

export type ActionEvent = {
  id: string;
  actionId: string;
  eventType: string;
  fromState: string | null;
  toState: string | null;
  actorType: string;
  evidenceRef: string | null;
  observedAt: string;
};

export type ChangeEvent = {
  id: string;
  sourceId: string;
  detectedAt: string;
  materiality: string;
  oldFingerprint: string | null;
  newFingerprint: string | null;
  summary: string | null;
  reviewState: string;
};
