import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";

export default function Settings() {
  const { data: user } = useQuery({ 
    queryKey: ['/api/user']
  });

  return (
    <div className="container mx-auto px-6 py-8" data-testid="settings-page">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-2">
          Manage your account settings and preferences
        </p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Gmail Connection</CardTitle>
            <CardDescription>
              Manage your Gmail integration for subscription tracking
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Account</p>
                <p className="text-sm text-muted-foreground">
                  {user?.username || 'Not connected'}
                </p>
              </div>
              <Badge variant={user?.gmailConnected ? "default" : "secondary"}>
                {user?.gmailConnected ? "Connected" : "Disconnected"}
              </Badge>
            </div>
            <Button variant="outline" size="sm">
              Reconnect Gmail
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Detection Settings</CardTitle>
            <CardDescription>
              Configure how subscriptions are detected and processed
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Currency</p>
                <p className="text-sm text-muted-foreground">
                  Primary currency for subscription tracking
                </p>
              </div>
              <Badge variant="outline">INR</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}