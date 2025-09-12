import { useQuery } from "@tanstack/react-query";
import { EmailAnalysis } from "@/components/EmailAnalysis";

export default function Emails() {
  const { data: emails, isLoading } = useQuery({ 
    queryKey: ['/api/emails'] 
  });

  return (
    <div className="container mx-auto px-6 py-8" data-testid="emails-page">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">Email Analysis</h1>
        <p className="text-muted-foreground mt-2">
          Review processed transaction emails and detection results
        </p>
      </div>

      <EmailAnalysis emails={emails || []} isLoading={isLoading} />
    </div>
  );
}