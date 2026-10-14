// Provider layer: error taxonomy, PDF handling, extraction with one repair, Gemini, and shared AI limits.
// The model only extracts data; code checks every amount it returns and never asks it to compute one.
export { classify, httpError, parseRetryAfter, PermanentError, TransientError } from './errors.ts';
export { extractInvoices, type ExtractedInvoice, type GenerateInput, type Provider, type Usage } from './extract.ts';
export { createGeminiProvider } from './gemini.ts';
export { createLimits, metered, type Limits } from './limits.ts';
export { MAX_PAGES, readPdf, splitPdf } from './pdf.ts';
