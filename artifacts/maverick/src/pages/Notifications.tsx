import { useListNotifications, useMarkAllNotificationsRead } from "@workspace/api-client-react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell, CheckCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function Notifications() {
  const { data: notifications, isLoading, refetch } = useListNotifications();

  const markAllRead = useMarkAllNotificationsRead();

  const handleMarkAllRead = () => {
    markAllRead.mutate(undefined, {
      onSuccess: () => {
        refetch();
      }
    });
  };

  return (
    <Layout>
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
            <p className="text-muted-foreground">System alerts and updates.</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleMarkAllRead} disabled={markAllRead.isPending}>
            <CheckCheck className="mr-2 h-4 w-4" />
            Mark all as read
          </Button>
        </div>

        <div className="space-y-4">
          {isLoading ? (
             <div className="text-center py-8 text-muted-foreground">Loading notifications...</div>
           ) : notifications?.length === 0 ? (
             <Card>
               <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                 <Bell className="h-12 w-12 mb-4 opacity-20" />
                 <p>You're all caught up!</p>
               </CardContent>
             </Card>
           ) : notifications?.map((notification) => (
            <Card key={notification.id} className={!notification.isRead ? "border-l-4 border-l-primary" : "opacity-75"}>
              <CardContent className="p-4 flex gap-4">
                <div className="mt-1">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    <Bell className="h-4 w-4" />
                  </div>
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm">{notification.title}</p>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{notification.message}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </Layout>
  );
}
