import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import {
  Package,
  Download,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  ArrowRight,
  History,
} from "lucide-react";

const statusConfig = {
  pending: { icon: Clock, color: "bg-yellow-500/20 text-yellow-500", label: "Pending" },
  processing: { icon: Loader2, color: "bg-blue-500/20 text-blue-500", label: "Processing" },
  completed: { icon: CheckCircle, color: "bg-green-500/20 text-green-500", label: "Completed" },
  partial: { icon: AlertCircle, color: "bg-orange-500/20 text-orange-500", label: "Partial" },
  failed: { icon: XCircle, color: "bg-red-500/20 text-red-500", label: "Failed" },
};

export default function Orders() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const { data: orders, isLoading } = trpc.orders.list.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: 5000, // Refresh every 5 seconds to check for updates
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Order History</h1>
        <p className="text-muted-foreground">View and download your scraping results</p>
      </div>

      {/* Orders List */}
      {orders && orders.length > 0 ? (
        <div className="space-y-4">
          {orders.map((order) => {
            const status = statusConfig[order.status as keyof typeof statusConfig] || statusConfig.pending;
            const StatusIcon = status.icon;
            const isProcessing = order.status === "processing";

            return (
              <Card
                key={order.id}
                className={`cursor-pointer hover:border-primary/50 transition-colors ${
                  isProcessing ? "border-blue-500/50" : ""
                }`}
                onClick={() => setLocation(`/orders/${order.id}`)}
              >
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`p-3 rounded-xl ${status.color}`}>
                        <StatusIcon
                          className={`h-6 w-6 ${isProcessing ? "animate-spin" : ""}`}
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">Order #{order.id}</h3>
                          <Badge variant="outline" className={status.color}>
                            {status.label}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {order.processedSkus} of {order.totalSkus} SKUs processed
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(order.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">Cost</p>
                        <p className="font-semibold">${parseFloat(order.chargedAmount).toFixed(2)}</p>
                      </div>

                      {order.zipFileUrl && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(order.zipFileUrl!, "_blank");
                          }}
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Download
                        </Button>
                      )}

                      <ArrowRight className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </div>

                  {/* Progress Bar for Processing Orders */}
                  {isProcessing && (
                    <div className="mt-4">
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>Progress</span>
                        <span>
                          {order.processedSkus} / {order.totalSkus}
                        </span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all duration-500"
                          style={{
                            width: `${(order.processedSkus / order.totalSkus) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="py-16 text-center">
            <History className="h-16 w-16 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="text-lg font-semibold mb-2">No orders yet</h3>
            <p className="text-muted-foreground mb-4">
              Start by entering SKUs on the home page to scrape product images
            </p>
            <Button onClick={() => setLocation("/")}>
              <Package className="h-4 w-4 mr-2" />
              Start Scraping
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
