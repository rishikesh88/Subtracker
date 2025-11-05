/**
 * Robust date parsing utility for handling various date formats from AI responses
 * Returns null for invalid dates instead of throwing errors
 */

export function parseFlexibleDate(dateString: string | undefined | null): Date | null {
  if (!dateString) return null;
  
  try {
    // Try standard ISO date parsing first
    const isoDate = new Date(dateString);
    if (!isNaN(isoDate.getTime())) {
      return isoDate;
    }
    
    // Handle relative dates like "in 2 days", "in 7 days"
    const relativeMatch = dateString.match(/in\s+(\d+)\s+(day|days|week|weeks|month|months)/i);
    if (relativeMatch) {
      const count = parseInt(relativeMatch[1]);
      const unit = relativeMatch[2].toLowerCase();
      const now = new Date();
      
      if (unit.startsWith('day')) {
        now.setDate(now.getDate() + count);
      } else if (unit.startsWith('week')) {
        now.setDate(now.getDate() + (count * 7));
      } else if (unit.startsWith('month')) {
        now.setMonth(now.getMonth() + count);
      }
      
      return now;
    }
    
    // Handle partial dates like "Oct 5", "October 15"
    const partialMatch = dateString.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})$/i);
    if (partialMatch) {
      const monthStr = partialMatch[1];
      const day = parseInt(partialMatch[2]);
      const currentYear = new Date().getFullYear();
      
      // Create date string like "Oct 5, 2025"
      const fullDateStr = `${monthStr} ${day}, ${currentYear}`;
      const parsedDate = new Date(fullDateStr);
      
      if (!isNaN(parsedDate.getTime())) {
        // If date is in the past, assume next year
        if (parsedDate < new Date()) {
          parsedDate.setFullYear(currentYear + 1);
        }
        return parsedDate;
      }
    }
    
    // Handle formats like "on Oct 5", "renews on October 15"
    const onMatch = dateString.match(/on\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})/i);
    if (onMatch) {
      const monthStr = onMatch[1];
      const day = parseInt(onMatch[2]);
      const currentYear = new Date().getFullYear();
      
      const fullDateStr = `${monthStr} ${day}, ${currentYear}`;
      const parsedDate = new Date(fullDateStr);
      
      if (!isNaN(parsedDate.getTime())) {
        if (parsedDate < new Date()) {
          parsedDate.setFullYear(currentYear + 1);
        }
        return parsedDate;
      }
    }
    
    // If all parsing attempts fail, return null
    console.warn(`Could not parse date string: "${dateString}"`);
    return null;
    
  } catch (error) {
    console.warn(`Date parsing error for "${dateString}":`, error);
    return null;
  }
}

/**
 * Validates that a Date object is valid
 */
export function isValidDate(date: Date | null | undefined): boolean {
  if (!date) return false;
  return date instanceof Date && !isNaN(date.getTime());
}
