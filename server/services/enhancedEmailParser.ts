import { EmailParser } from './emailParser';

interface Attachment {
  filename: string;
  mimeType: string;
  content: string; // Base64 encoded content
  size: number;
}

interface EnhancedParsedEmail {
  subject: string;
  fromEmail: string;
  fromName?: string;
  receivedAt: Date;
  content: string;
  attachments: Attachment[];
  isTransaction: boolean;
  extractedAmount?: number;
  extractedCurrency?: string;
  merchantName?: string;
}

export class EnhancedEmailParser extends EmailParser {
  async parseEmailWithAttachments(gmailMessage: any, gmail: any): Promise<EnhancedParsedEmail> {
    // Get base email parsing
    const baseEmail = this.parseEmail(gmailMessage);
    
    // Extract attachments
    const attachments = await this.extractAttachments(gmailMessage, gmail);
    
    // Enhance content with attachment text
    const enhancedContent = await this.combineContentWithAttachments(baseEmail.content, attachments);
    
    return {
      ...baseEmail,
      content: enhancedContent,
      attachments
    };
  }

  private async extractAttachments(gmailMessage: any, gmail: any): Promise<Attachment[]> {
    const attachments: Attachment[] = [];
    
    if (!gmailMessage.payload?.parts) {
      return attachments;
    }

    await this.processPartsForAttachments(gmailMessage.payload.parts, gmail, gmailMessage.id, attachments);
    
    return attachments;
  }

  private async processPartsForAttachments(parts: any[], gmail: any, messageId: string, attachments: Attachment[]): Promise<void> {
    for (const part of parts) {
      // Recursive processing for nested parts
      if (part.parts) {
        await this.processPartsForAttachments(part.parts, gmail, messageId, attachments);
        continue;
      }

      // Check if this part is an attachment
      if (part.body?.attachmentId && part.filename) {
        const mimeType = part.mimeType || 'application/octet-stream';
        
        // Only process PDF and image attachments as specified by user
        if (this.isSupportedAttachmentType(mimeType)) {
          try {
            const attachment = await gmail.users.messages.attachments.get({
              userId: 'me',
              messageId: messageId,
              id: part.body.attachmentId
            });

            const content = attachment.data.data;
            
            attachments.push({
              filename: part.filename,
              mimeType: mimeType,
              content: content, // Keep as base64 for Gemini processing
              size: part.body.size || 0
            });

            console.log(`Extracted attachment: ${part.filename} (${mimeType})`);
          } catch (error) {
            console.error(`Failed to extract attachment ${part.filename}:`, error);
          }
        }
      }
    }
  }

  private isSupportedAttachmentType(mimeType: string): boolean {
    const supportedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/gif',
      'image/webp'
    ];
    
    return supportedTypes.includes(mimeType.toLowerCase());
  }

  private async combineContentWithAttachments(emailContent: string, attachments: Attachment[]): Promise<string> {
    let combinedContent = emailContent;
    
    for (const attachment of attachments) {
      if (attachment.mimeType === 'application/pdf') {
        // For PDFs, add a note that it's included - Gemini will process the base64 directly
        combinedContent += `\n\n[PDF Attachment: ${attachment.filename}]`;
      } else if (attachment.mimeType.startsWith('image/')) {
        // For images, add a note - Gemini will process the base64 directly
        combinedContent += `\n\n[Image Attachment: ${attachment.filename}]`;
      }
    }
    
    return combinedContent;
  }

  // Serialize attachments for database storage
  serializeAttachments(attachments: Attachment[]): string {
    // Store only metadata, not the full content (too large for DB)
    const metadata = attachments.map(att => ({
      filename: att.filename,
      mimeType: att.mimeType,
      size: att.size,
      hasContent: att.content.length > 0
    }));
    
    return JSON.stringify(metadata);
  }
}