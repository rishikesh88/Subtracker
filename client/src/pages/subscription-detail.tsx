import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import type { Subscription, Invoice, GmailAccount, OutlookAccount } from "@shared/schema";
import type { UploadResult } from "@uppy/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Edit, Save, X, Upload, Download, Trash2, FileText, Image, FileIcon, Mail } from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ObjectUploader } from "@/components/ObjectUploader";
import { format } from "date-fns";

export default function SubscriptionDetail() {
  const [, params] = useRoute("/subscriptions/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isEditMode, setIsEditMode] = useState(false);
  const [formData, setFormData] = useState<Partial<Subscription>>({});

  const subscriptionId = params?.id;

  // Fetch subscription details
  const { data: subscription, isLoading: loadingSubscription } = useQuery<Subscription>({
    queryKey: ['/api/subscriptions', subscriptionId],
    enabled: !!subscriptionId,
  });

  // Fetch invoices
  const { data: invoices = [] } = useQuery<Invoice[]>({
    queryKey: ['/api/subscriptions', subscriptionId, 'invoices'],
    enabled: !!subscriptionId,
  });
  
  // Determine provider and account ID to fetch
  const isOutlookSubscription = subscription?.emailProvider === 'outlook';
  const isGmailSubscription = subscription?.emailProvider === 'gmail' || subscription?.gmailAccountId; // Legacy fallback
  
  const gmailAccountIdToFetch = isGmailSubscription 
    ? (subscription?.providerAccountId || subscription?.gmailAccountId)
    : null;
  
  const outlookAccountIdToFetch = isOutlookSubscription
    ? subscription?.providerAccountId
    : null;

  // Fetch Gmail account
  const { data: gmailAccount } = useQuery<GmailAccount>({
    queryKey: [`/api/gmail/accounts/${gmailAccountIdToFetch}`],
    enabled: !!gmailAccountIdToFetch,
  });

  // Fetch Outlook account
  const { data: outlookAccount } = useQuery<OutlookAccount>({
    queryKey: [`/api/outlook/accounts/${outlookAccountIdToFetch}`],
    enabled: !!outlookAccountIdToFetch,
  });

  // Initialize form data when subscription is loaded
  useEffect(() => {
    if (subscription) {
      setFormData({
        serviceName: subscription.serviceName,
        category: subscription.category,
        description: subscription.description || '',
        ownerName: subscription.ownerName || '',
        ownerEmail: subscription.ownerEmail || '',
        amount: subscription.amount,
        frequency: subscription.frequency,
        currency: subscription.currency,
      });
    }
  }, [subscription]);

  // Update subscription mutation
  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<Subscription>) => {
      const res = await apiRequest('PATCH', `/api/subscriptions/${subscriptionId}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions', subscriptionId] });
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions'] });
      setIsEditMode(false);
      toast({
        title: "Success",
        description: "Subscription updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update subscription",
        variant: "destructive",
      });
    },
  });

  // Delete invoice mutation
  const deleteInvoiceMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await apiRequest('DELETE', `/api/invoices/${invoiceId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions', subscriptionId, 'invoices'] });
      toast({
        title: "Success",
        description: "Invoice deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete invoice",
        variant: "destructive",
      });
    },
  });

  // Get upload URL
  const handleGetUploadParameters = async () => {
    const res = await apiRequest('POST', '/api/objects/upload');
    const response = await res.json();
    return {
      method: 'PUT' as const,
      url: response.uploadURL,
    };
  };

  // Handle upload complete
  const handleUploadComplete = async (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
    if (result.successful && result.successful.length > 0) {
      for (const file of result.successful) {
        const fileUrl = file.uploadURL;
        const fileName = file.name;
        const fileType = file.type || 'application/octet-stream';
        const fileSize = file.size || 0;

        try {
          await apiRequest('POST', `/api/subscriptions/${subscriptionId}/invoices`, {
            fileUrl,
            fileName,
            fileType,
            fileSize,
            source: 'manual',
          });
        } catch (error) {
          console.error('Failed to save invoice:', error);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions', subscriptionId, 'invoices'] });
      toast({
        title: "Success",
        description: `${result.successful.length} invoice(s) uploaded successfully`,
      });
    }
  };

  const handleSave = () => {
    updateMutation.mutate(formData);
  };

  const handleCancel = () => {
    if (subscription) {
      setFormData({
        serviceName: subscription.serviceName,
        category: subscription.category,
        description: subscription.description || '',
        ownerName: subscription.ownerName || '',
        ownerEmail: subscription.ownerEmail || '',
      });
    }
    setIsEditMode(false);
  };

  const getFileIcon = (fileType: string) => {
    if (fileType.includes('pdf')) return <FileText className="h-8 w-8 text-red-500" />;
    if (fileType.includes('image')) return <Image className="h-8 w-8 text-blue-500" />;
    return <FileIcon className="h-8 w-8 text-gray-500" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  if (loadingSubscription) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/3"></div>
          <div className="h-64 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  if (!subscription) {
    return (
      <div className="container mx-auto px-6 py-8">
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">Subscription not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 py-8" data-testid="subscription-detail-page">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation('/subscriptions')}
            data-testid="back-to-list-btn"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-foreground" data-testid="subscription-name">
              {subscription.serviceName}
            </h1>
            <p className="text-muted-foreground">Subscription Details</p>
          </div>
        </div>
        <div className="flex space-x-2">
          {!isEditMode ? (
            <Button onClick={() => setIsEditMode(true)} data-testid="edit-btn">
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={handleCancel}
                data-testid="cancel-edit-btn"
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={updateMutation.isPending}
                data-testid="save-btn"
              >
                <Save className="h-4 w-4 mr-2" />
                {updateMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* About Subscription */}
        <Card data-testid="about-section">
          <CardHeader>
            <CardTitle>About Subscription</CardTitle>
            <CardDescription>Basic information about this subscription</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Subscription Name</Label>
              {isEditMode ? (
                <Input
                  value={formData.serviceName || ''}
                  onChange={(e) => setFormData({ ...formData, serviceName: e.target.value })}
                  data-testid="input-service-name"
                />
              ) : (
                <p className="text-sm text-muted-foreground">{subscription.serviceName}</p>
              )}
            </div>
            <div>
              <Label>Category</Label>
              {isEditMode ? (
                <Input
                  value={formData.category || ''}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  placeholder="e.g., Entertainment, Software, Utilities"
                  data-testid="input-category"
                />
              ) : (
                <p className="text-sm text-muted-foreground">{subscription.category || 'Not specified'}</p>
              )}
            </div>
            <div>
              <Label>Description</Label>
              {isEditMode ? (
                <Textarea
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Add notes about this subscription..."
                  rows={3}
                  data-testid="input-description"
                />
              ) : (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {subscription.description || 'No description'}
                </p>
              )}
            </div>
            {(gmailAccount || outlookAccount) && (
              <div>
                <Label>Source Email Account</Label>
                <div className="flex items-center gap-2 mt-1" data-testid="source-email-account">
                  {gmailAccount && (
                    <>
                      <div className="flex items-center justify-center h-5 w-5 rounded bg-primary/10">
                        <SiGoogle className="h-3 w-3 text-primary" />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {gmailAccount.gmailEmail}
                      </p>
                    </>
                  )}
                  {outlookAccount && (
                    <>
                      <div className="flex items-center justify-center h-5 w-5 rounded bg-blue-100 dark:bg-blue-900">
                        <Mail className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {outlookAccount.outlookEmail}
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Timeline */}
        <Card data-testid="timeline-section">
          <CardHeader>
            <CardTitle>Subscription Timeline</CardTitle>
            <CardDescription>Payment history and upcoming charges</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Last Invoice/Email</Label>
              <p className="text-sm text-muted-foreground">
                {subscription.lastEmailDate
                  ? format(new Date(subscription.lastEmailDate!), 'PPP')
                  : 'No emails found'}
              </p>
            </div>
            <div>
              <Label>Next Payment Due</Label>
              <p className="text-sm text-muted-foreground">
                {subscription.nextBillingDate
                  ? format(new Date(subscription.nextBillingDate!), 'PPP')
                  : 'Not scheduled'}
              </p>
            </div>
            <div>
              <Label>Amount</Label>
              <p className="text-lg font-semibold">
                {subscription.currency} {subscription.amount}
              </p>
            </div>
            <div>
              <Label>Frequency</Label>
              <p className="text-sm text-muted-foreground capitalize">{subscription.frequency}</p>
            </div>
          </CardContent>
        </Card>

        {/* Ownership */}
        <Card data-testid="ownership-section">
          <CardHeader>
            <CardTitle>Subscription Ownership</CardTitle>
            <CardDescription>Who owns or manages this subscription</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Owner Name</Label>
              {isEditMode ? (
                <Input
                  value={formData.ownerName || ''}
                  onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })}
                  placeholder="Enter owner name"
                  data-testid="input-owner-name"
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {subscription.ownerName || 'Not specified'}
                </p>
              )}
            </div>
            <div>
              <Label>Owner Email</Label>
              {isEditMode ? (
                <Input
                  type="email"
                  value={formData.ownerEmail || ''}
                  onChange={(e) => setFormData({ ...formData, ownerEmail: e.target.value })}
                  placeholder="owner@example.com"
                  data-testid="input-owner-email"
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {subscription.ownerEmail || 'Not specified'}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Invoices */}
        <Card data-testid="invoices-section">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Invoices</CardTitle>
                <CardDescription>Upload and manage invoice files</CardDescription>
              </div>
              <ObjectUploader
                maxNumberOfFiles={10}
                maxFileSize={10485760}
                allowedFileTypes={['.pdf', '.png', '.jpg', '.jpeg', '.docx', '.doc']}
                onGetUploadParameters={handleGetUploadParameters}
                onComplete={handleUploadComplete}
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload
              </ObjectUploader>
            </div>
          </CardHeader>
          <CardContent>
            {invoices.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No invoices uploaded yet</p>
                <p className="text-sm">Upload PDFs, images, or documents to track your invoices</p>
              </div>
            ) : (
              <div className="space-y-2">
                {invoices.map((invoice) => (
                  <div
                    key={invoice.id}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent transition-colors"
                    data-testid={`invoice-${invoice.id}`}
                  >
                    <div className="flex items-center space-x-3">
                      {getFileIcon(invoice.fileType)}
                      <div>
                        <p className="text-sm font-medium">{invoice.fileName}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(invoice.fileSize)} • {invoice.uploadedAt ? format(new Date(invoice.uploadedAt), 'PP') : 'Unknown date'}
                        </p>
                      </div>
                    </div>
                    <div className="flex space-x-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => window.open(invoice.fileUrl, '_blank')}
                        data-testid={`download-invoice-${invoice.id}`}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteInvoiceMutation.mutate(invoice.id)}
                        disabled={deleteInvoiceMutation.isPending}
                        data-testid={`delete-invoice-${invoice.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
