// Supported employee loan types (#183). `Loan.type` stays a free-text String in the schema so
// legacy rows keep displaying, but new loans are chosen from this canonical list (form select +
// server validation on both the page action and the API).
export const LOAN_TYPES = ['SSS Loan', 'Salary Loan', 'Calamity Loan'] as const
export type LoanType = (typeof LOAN_TYPES)[number]
