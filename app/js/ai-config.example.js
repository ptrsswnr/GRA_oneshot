// Copy this file to ai-config.local.js (gitignored — never commit it) and put your own
// OpenRouter API key in it. Pages that call the AI (new-receipt.html, project-budget.html) load
// ai-config.local.js if present, before receipt-ai.js — without it, window.OPENROUTER_API_KEY
// stays undefined and every AI-backed step (FS-02 receipt reading, FS-02 document-type guessing,
// FS-08 field extraction, FS-04 explanation) falls back to its non-AI path instead (never blocks
// the app — see spec section 7/9). Get a key at https://openrouter.ai/keys
window.OPENROUTER_API_KEY = "sk-or-v1-your-key-here";
