interface ParsedEmail {
  subject: string;
  fromEmail: string;
  fromName?: string;
  receivedAt: Date;
  content: string;
  isTransaction: boolean;
  extractedAmount?: number;
  extractedCurrency?: string;
  merchantName?: string;
}

export class EmailParser {
  private transactionKeywords = [
    'payment', 'receipt', 'invoice', 'bill', 'subscription', 'charged', 'paid',
    'transaction', 'purchase', 'order', 'confirmation', 'statement',
    'renewal', 'billing', 'autopay', 'recurring', 'monthly', 'yearly'
  ];

  private merchantDomains = [
    'netflix.com', 'spotify.com', 'amazon.com', 'apple.com', 'google.com',
    'microsoft.com', 'adobe.com', 'dropbox.com', 'slack.com', 'github.com',
    'youtube.com', 'hulu.com', 'disney.com', 'paypal.com', 'stripe.com',
    'verizon.com', 'att.com', 'tmobile.com', 'comcast.com', 'xfinity.com',
    // Indian and specific vendors
    'airtel.com', 'airtel.in', 'myairtel.in', 'replit.com', 'replit.dev',
    'bolt.new', 'bolt.eu', 'jio.com', 'vi.in', 'idea.in', 'vodafone.in',
    'paytm.com', 'phonepe.com', 'googlepay.com', 'razorpay.com', 'instamojo.com',
    'zomato.com', 'swiggy.in', 'hotstar.com', 'zee5.com', 'sonyliv.com',
    'makemytrip.com', 'goibibo.com', 'olacabs.com', 'uber.com', 'flipkart.com'
  ];

  parseEmail(gmailMessage: any): ParsedEmail {
    const headers = gmailMessage.payload?.headers || [];
    const subject = this.getHeader(headers, 'Subject') || '';
    const fromHeader = this.getHeader(headers, 'From') || '';
    const dateHeader = this.getHeader(headers, 'Date') || '';

    const { email: fromEmail, name: fromName } = this.parseFromHeader(fromHeader);
    const receivedAt = new Date(dateHeader);
    const content = this.extractContent(gmailMessage.payload);

    const isTransaction = this.isTransactionEmail(subject, content, fromEmail);
    let extractedAmount: number | undefined;
    let extractedCurrency: string | undefined;
    let merchantName: string | undefined;

    if (isTransaction) {
      const amountMatch = this.extractAmount(content + ' ' + subject);
      extractedAmount = amountMatch?.amount;
      extractedCurrency = amountMatch?.currency;
      merchantName = this.extractMerchantName(fromEmail, fromName, subject);
    }

    return {
      subject,
      fromEmail,
      fromName,
      receivedAt,
      content,
      isTransaction,
      extractedAmount,
      extractedCurrency,
      merchantName
    };
  }

  private getHeader(headers: any[], name: string): string | undefined {
    const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
    return header?.value;
  }

  private parseFromHeader(fromHeader: string): { email: string; name?: string } {
    const emailMatch = fromHeader.match(/<(.+?)>/);
    if (emailMatch) {
      const email = emailMatch[1];
      const name = fromHeader.replace(`<${email}>`, '').trim().replace(/^"|"$/g, '');
      return { email, name: name || undefined };
    }
    return { email: fromHeader };
  }

  private extractContent(payload: any): string {
    if (!payload) return '';

    // Single part message
    if (payload.body?.data) {
      // Gmail uses URL-safe base64 encoding - convert to standard base64
      const standardBase64 = payload.body.data.replace(/-/g, '+').replace(/_/g, '/');
      const content = Buffer.from(standardBase64, 'base64').toString('utf-8');
      return this.cleanContent(content, payload.mimeType);
    }

    // Multi-part message - extract all parts recursively
    if (payload.parts) {
      return this.extractFromParts(payload.parts);
    }

    return '';
  }

  private extractFromParts(parts: any[]): string {
    let textContent = '';
    let htmlContent = '';

    const traverseParts = (partsList: any[]) => {
      for (const part of partsList) {
        // Recursive traversal for nested parts
        if (part.parts) {
          traverseParts(part.parts);
          continue;
        }

        if (part.body?.data) {
          // Gmail uses URL-safe base64 encoding - convert to standard base64
          const standardBase64 = part.body.data.replace(/-/g, '+').replace(/_/g, '/');
          const content = Buffer.from(standardBase64, 'base64').toString('utf-8');
          
          if (part.mimeType === 'text/plain') {
            textContent += content + '\n';
          } else if (part.mimeType === 'text/html') {
            htmlContent += content + '\n';
          }
        }
      }
    };

    traverseParts(parts);

    // Prefer text/plain, but use HTML if no plain text available
    if (textContent.trim()) {
      return textContent.trim();
    } else if (htmlContent.trim()) {
      return this.cleanContent(htmlContent, 'text/html');
    }

    return '';
  }

  private cleanContent(content: string, mimeType?: string): string {
    if (mimeType === 'text/html' || content.includes('<html') || content.includes('<div')) {
      // Strip HTML tags and decode entities
      return content
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove scripts
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '') // Remove styles  
        .replace(/<[^>]*>/g, ' ') // Remove HTML tags
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
    }
    
    return content.trim();
  }

  private isTransactionEmail(subject: string, content: string, fromEmail: string): boolean {
    const text = (subject + ' ' + content).toLowerCase();
    const domain = fromEmail.split('@')[1]?.toLowerCase();

    // Check for transaction keywords
    const hasTransactionKeywords = this.transactionKeywords.some(keyword => 
      text.includes(keyword)
    );

    // Check if from known merchant domain
    const isFromMerchant = this.merchantDomains.some(merchantDomain => 
      domain?.includes(merchantDomain)
    );

    // Check for amount patterns (including INR)
    const hasAmountPattern = /\$\d+|\d+\.\d{2}|USD|EUR|GBP|₹\d+|\d+\s*INR|Rs\.?\s*\d+/.test(text);

    return hasTransactionKeywords || (isFromMerchant && hasAmountPattern);
  }

  private extractAmount(text: string): { amount: number; currency: string } | undefined {
    // Match currency symbols and amounts (including Indian formats)
    const patterns = [
      // USD patterns
      /\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g, // $123.45 or $1,234.56
      /(\d+(?:,\d{3})*(?:\.\d{2})?)\s*USD/gi, // 123.45 USD
      
      // EUR patterns
      /(\d+(?:,\d{3})*(?:\.\d{2})?)\s*EUR/gi, // 123.45 EUR
      /€(\d+(?:,\d{3})*(?:\.\d{2})?)/g, // €123.45
      
      // GBP patterns  
      /£(\d+(?:,\d{3})*(?:\.\d{2})?)/g, // £123.45
      
      // INR patterns - comprehensive coverage
      /₹\s*(\d+(?:,\d{2,3})*(?:\.\d{2})?)/g, // ₹123.45 or ₹12,34,567.89
      /Rs\.?\s*(\d+(?:,\d{2,3})*(?:\.\d{2})?)/gi, // Rs. 123.45 or Rs 12,34,567
      /INR\s*(\d+(?:,\d{2,3})*(?:\.\d{2})?)/gi, // INR 123.45
      /(\d+(?:,\d{2,3})*(?:\.\d{2})?)\s*INR/gi, // 123.45 INR
      /(\d+(?:,\d{2,3})*(?:\.\d{2})?)\s*rupees?/gi, // 123.45 rupees
      // Indian lakh/crore notation
      /₹\s*(\d+(?:\.\d+)?\s*(?:lakh|crore))/gi, // ₹2.5 lakh
      /Rs\.?\s*(\d+(?:\.\d+)?\s*(?:lakh|crore))/gi, // Rs. 2.5 lakh
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match) {
        let amountStr = match[1].replace(/,/g, '').trim();
        let amount: number;
        
        // Handle lakh/crore conversions
        if (amountStr.includes('lakh')) {
          const num = parseFloat(amountStr.replace(/lakh/gi, '').trim());
          amount = num * 100000; // 1 lakh = 100,000
        } else if (amountStr.includes('crore')) {
          const num = parseFloat(amountStr.replace(/crore/gi, '').trim());
          amount = num * 10000000; // 1 crore = 10,000,000
        } else {
          amount = parseFloat(amountStr);
        }
        
        if (amount > 0 && amount < 100000) { // reasonable subscription range (up to ₹1L/year)
          let currency = 'USD'; // default
          
          // Detect currency from patterns
          if (text.includes('₹') || /Rs\.?/i.test(text) || /INR/i.test(text) || 
              /rupees?/i.test(text) || /lakh|crore/i.test(text)) {
            currency = 'INR';
          } else if (text.includes('EUR') || text.includes('€')) {
            currency = 'EUR';
          } else if (text.includes('GBP') || text.includes('£')) {
            currency = 'GBP';
          }
          
          return { amount, currency };
        }
      }
    }

    return undefined;
  }

  private extractMerchantName(fromEmail: string, fromName?: string, subject?: string): string {
    // Try to extract from fromName first
    if (fromName && fromName !== fromEmail) {
      // Clean up common patterns
      const cleaned = fromName
        .replace(/\b(no-?reply|noreply|support|billing|payments?)\b/gi, '')
        .replace(/\b(team|inc\.?|llc|ltd\.?|corp\.?)\b/gi, '')
        .trim();
      
      if (cleaned.length > 2) {
        return cleaned;
      }
    }

    // Extract from domain
    const domain = fromEmail.split('@')[1];
    if (domain) {
      const domainParts = domain.split('.');
      const mainDomain = domainParts[domainParts.length - 2];
      
      // Capitalize first letter
      return mainDomain.charAt(0).toUpperCase() + mainDomain.slice(1);
    }

    // Fallback to subject parsing
    if (subject) {
      const subjectMatch = subject.match(/(?:from|by)\s+([A-Za-z0-9\s]+)/i);
      if (subjectMatch) {
        return subjectMatch[1].trim();
      }
    }

    return 'Unknown Merchant';
  }
}

export const emailParser = new EmailParser();
