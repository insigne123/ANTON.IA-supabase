// src/lib/apollo-taxonomies.ts
// ✅ Este archivo ahora exporta constantes para el UI y mapeadores para el backend.

function norm(v: string) {
  return v
    .toString()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

/** ====== LISTAS CANÓNICAS PARA EL UI ====== */
export const APOLLO_SENIORITIES: Array<{value: string, label: string}> = [
  { value: "c_suite", label: "C-Suite" },
  { value: "vp", label: "VP" },
  { value: "director", label: "Director" },
  { value: "manager", label: "Manager" },
  { value: "head", label: "Head" },
  { value: "lead", label: "Lead" },
  { value: "owner", label: "Owner" },
  { value: "partner", label: "Partner" },
  { value: "intern", label: "Intern" },
];

export const APOLLO_DEPARTMENTS: Array<{value: string, label: string}> = [
  { value: "human_resources", label: "Human Resources" },
  { value: "sales", label: "Sales" },
  { value: "marketing", label: "Marketing" },
  { value: "engineering", label: "Engineering" },
  { value: "product", label: "Product" },
  { value: "finance", label: "Finance" },
  { value: "operations", label: "Operations" },
  { value: "customer_success", label: "Customer Success" },
  { value: "support", label: "Support" },
  { value: "design", label: "Design" },
  { value: "legal", label: "Legal" },
  { value: "procurement", label: "Procurement" },
];


/** ====== MAPEOS UI -> APOLLO (para backend) ====== */
const SENIORITY_MAP: Record<string, string> = {
  c_suite: "c_suite",
  "c-level": "c_suite",
  "c level": "c_suite",
  c_level: "c_suite",
  vp: "vp",
  vicepresidente: "vp",

  director: "director",
  gerente: "manager",
  manager: "manager",
  head: "head",
  lead: "lead",
  owner: "owner",
  partner: "partner",
  intern: "intern",
};

const DEPARTMENT_MAP: Record<string, string> = {
  human_resources: "human_resources",
  "recursos_humanos": "human_resources",
  "recursos-humanos": "human_resources",
  "recursos humanos": "human_resources",
  hr: "human_resources",

  sales: "sales",
  ventas: "sales",

  marketing: "marketing",
  mercadeo: "marketing",

  engineering: "engineering",
  it: "engineering",
  ingenieria: "engineering",

  finance: "finance",
  finanzas: "finance",

  operations: "operations",
  operaciones: "operations",

  product: "product",
  design: "design",
  legal: "legal",
  support: "support",
  customer_success: "customer_success",
  procurement: "procurement",
};

export function mapSenioritiesToApollo(values?: string[] | null): string[] {
  if (!values?.length) return [];
  const out: string[] = [];
  for (const raw of values) {
    const key = norm(raw);
    const mapped = SENIORITY_MAP[key];
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

export function mapDepartmentsToApollo(values?: string[] | null): string[] {
  if (!values?.length) return [];
  const out: string[] = [];
  for (const raw of values) {
    const key = norm(raw);
    const mapped = DEPARTMENT_MAP[key] ?? key; // fallback: slug normalizado
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}
