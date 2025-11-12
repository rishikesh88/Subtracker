import { gmailService } from './gmail';
import { ObjectStorageService } from '../objectStorage';
import type { InsertInvoice } from '@shared/schema';
import { randomUUID } from 'crypto';

interface AttachmentMetadata {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

interface ExtractedInvoice {
  fileName: string;
  fileType: string;
  fileSize: number;
  fileUrl: string;
  source: 'gmail';
}

export class InvoiceExtractor {
  private objectStorage: ObjectStorageService;

  constructor() {
    this.objectStorage = new ObjectStorageService();
  }

  /**
   * Extract attachment metadata from emails
   * This parses the attachmentData JSON field stored in the emails table
   */
  parseAttachmentMetadata(attachmentDataJson: string | null): AttachmentMetadata[] {
    if (!attachmentDataJson) return [];
    
    try {
      const data = JSON.parse(attachmentDataJson);
      if (Array.isArray(data)) {
        return data.filter((att: any) => {
          // Only PDFs and images
          const mimeType = att.mimeType || '';
          return (mimeType.includes('pdf') || mimeType.includes('image')) && att.attachmentId;
        });
      }
    } catch (error) {
      console.error('Error parsing attachment metadata:', error);
    }
    
    return [];
  }

  /**
   * Download Gmail attachment and upload to object storage
   * Returns the normalized /objects/... path
   */
  async downloadAndUploadAttachment(
    gmail: any,
    messageId: string,
    attachmentId: string,
    filename: string,
    mimeType: string,
    userId: string
  ): Promise<string | null> {
    try {
      console.log(`📎 Downloading attachment: ${filename} from message ${messageId}`);
      
      // Download from Gmail with retry logic
      let attachment;
      let retries = 3;
      while (retries > 0) {
        try {
          attachment = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: messageId,
            id: attachmentId
          });
          break;
        } catch (error: any) {
          retries--;
          if (error?.code === 429 && retries > 0) {
            // Rate limit hit, wait and retry
            await new Promise(resolve => setTimeout(resolve, 1000 * (4 - retries)));
          } else {
            throw error;
          }
        }
      }

      if (!attachment || !attachment.data || !attachment.data.data) {
        console.error('No attachment data returned from Gmail');
        return null;
      }

      const fileBuffer = Buffer.from(attachment.data.data, 'base64');
      
      // Generate unique object path
      const privateObjectDir = this.objectStorage.getPrivateObjectDir();
      const objectId = randomUUID();
      const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const fullPath = `${privateObjectDir}/invoices/${objectId}/${sanitizedFilename}`;

      // Upload to object storage with ACL
      const normalizedPath = await this.objectStorage.uploadBufferWithAcl(
        fullPath,
        fileBuffer,
        mimeType,
        {
          owner: userId,
          visibility: 'private'
        }
      );

      console.log(`✅ Uploaded attachment to: ${normalizedPath}`);
      
      return normalizedPath;
    } catch (error) {
      console.error(`Error downloading/uploading attachment ${filename}:`, error);
      return null;
    }
  }

  /**
   * Extract all invoice attachments from a list of email records
   * This is called when approving subscription suggestions
   */
  async extractInvoicesFromEmails(
    gmailAccessToken: string,
    emailRecords: Array<{ gmailId: string; attachmentData: string | null }>,
    userId: string
  ): Promise<ExtractedInvoice[]> {
    const invoices: ExtractedInvoice[] = [];

    if (emailRecords.length === 0) {
      return invoices;
    }

    try {
      // Initialize Gmail API client
      // Note: We don't have refreshToken here, but Gmail operations during approval
      // should work with just the access token since user is actively using the app
      const gmail = gmailService.getGmailClient(gmailAccessToken, '');
      
      for (const emailRecord of emailRecords) {
        const attachments = this.parseAttachmentMetadata(emailRecord.attachmentData);
        
        if (attachments.length === 0) continue;
        
        console.log(`📧 Processing ${attachments.length} attachment(s) from email ${emailRecord.gmailId}`);
        
        for (const attachment of attachments) {
          const fileUrl = await this.downloadAndUploadAttachment(
            gmail,
            emailRecord.gmailId,
            attachment.attachmentId,
            attachment.filename,
            attachment.mimeType,
            userId
          );

          if (fileUrl) {
            invoices.push({
              fileName: attachment.filename,
              fileType: attachment.mimeType,
              fileSize: attachment.size,
              fileUrl,
              source: 'gmail'
            });
          }
        }
      }

      console.log(`📊 Extracted ${invoices.length} invoice(s) from ${emailRecords.length} email(s)`);
    } catch (error) {
      console.error('Error extracting invoices from emails:', error);
    }

    return invoices;
  }
}

export const invoiceExtractor = new InvoiceExtractor();
