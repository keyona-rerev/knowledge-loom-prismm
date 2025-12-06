import * as pdfjsLib from 'pdfjs-dist';

// Set up the worker using local bundled version (works with Vite)
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

export interface PDFParseResult {
  text: string;
  title: string;
  pageCount: number;
}

// PDF magic bytes (%PDF)
const PDF_MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46];

/**
 * Validates that a file is a legitimate PDF by checking:
 * 1. MIME type is application/pdf
 * 2. File starts with PDF magic bytes (%PDF)
 */
async function validatePDFFile(file: File): Promise<boolean> {
  // Check MIME type
  if (file.type !== 'application/pdf') {
    throw new Error('Invalid file type. Only PDF files are allowed.');
  }
  
  // Check PDF magic bytes (%PDF header)
  const buffer = await file.slice(0, 4).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  
  const isValidMagicBytes = PDF_MAGIC_BYTES.every((byte, i) => bytes[i] === byte);
  if (!isValidMagicBytes) {
    throw new Error('Invalid PDF file. File does not have a valid PDF header.');
  }
  
  return true;
}

export async function parsePDF(file: File): Promise<PDFParseResult> {
  try {
    // Validate PDF before processing (security check)
    await validatePDFFile(file);
    
    // Read file as array buffer
    const arrayBuffer = await file.arrayBuffer();
    
    // Load PDF document
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    const pageCount = pdf.numPages;
    let fullText = '';
    
    // Extract text from all pages (limit to first 50 pages for performance)
    const maxPages = Math.min(pageCount, 50);
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      fullText += pageText + '\n\n';
    }
    
    // Clean up text
    fullText = fullText
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 50000); // Limit to 50k characters
    
    // Get title from filename
    const title = file.name.replace('.pdf', '').replace(/[_-]/g, ' ');
    
    return {
      text: fullText,
      title: title,
      pageCount: pageCount
    };
  } catch (error) {
    console.error('PDF parsing error:', error);
    throw new Error(`Failed to parse PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
