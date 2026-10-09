// src/utils/sanitizeHtml.js
import DOMPurify from 'dompurify';
 
export const cleanHtml = (html) =>
  DOMPurify.sanitize(String(html ?? ''), {
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'link', 'meta', 'base'],
    FORBID_ATTR: ['srcdoc', 'formaction'],
  });
 
