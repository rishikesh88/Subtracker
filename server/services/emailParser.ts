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
    'verizon.com', 'att.com', 'tmobile.com', 'comcast.com', 'xfinity.com'
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

    if (payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }

    if (payload.parts) {
      let content = '';
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          content += Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      }
      return content;
    }

    return '';
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

    // Check for amount patterns
    const hasAmountPattern = /\$\d+|\d+\.\d{2}|USD|EUR|GBP/.test(text);

    return hasTransactionKeywords || (isFromMerchant && hasAmountPattern);
  }

  private extractAmount(text: string): { amount: number; currency: string } | undefined {
    // Match currency symbols and amounts
    const patterns = [
      /\$(\d+(?:,\d{3})*(?:\.\d{2})?)/g, // $123.45 or $1,234.56
      /(\d+(?:,\d{3})*(?:\.\d{2})?)\s*USD/gi, // 123.45 USD
      /(\d+(?:,\d{3})*(?:\.\d{2})?)\s*EUR/gi, // 123.45 EUR
      /€(\d+(?:,\d{3})*(?:\.\d{2})?)/g, // €123.45
      /£(\d+(?:,\d{3})*(?:\.\d{2})?)/g, // £123.45
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match) {
        const amountStr = match[1].replace(/,/g, '');
        const amount = parseFloat(amountStr);
        
        if (amount > 0 && amount < 10000) { // reasonable subscription range
          let currency = 'USD';
          if (text.includes('EUR') || text.includes('€')) currency = 'EUR';
          else if (text.includes('GBP') || text.includes('£')) currency = 'GBP';
          
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
