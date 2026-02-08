import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { toast } from "sonner";
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
  RefreshCw,
} from "lucide-react";

const statusConfig = {
  pending: { icon: Clock, color: "text-amber-600", bg: "bg-amber-50", label: "Pending" },
  processing: { icon: Loader2, color: "text-blue-600", bg: "bg-blue-50", label: "Processing" },
  completed: { icon: CheckCircle, color: "text-emerald-600", bg: "bg-emerald-50", label: "Completed" },
  partial: { icon: AlertCircle, color: "text-orange-600", bg: "bg-orange-50", label: "Partial" },
  failed: { icon: XCircle, color: "text-red-600", bg: "bg-red-50", label: "Failed" },
};

export default function Orders() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const { data: orders, isLoading } = trpc.orders.list.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: 5000,
  });

  const retryMutation = trpc.orders.retry.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
      utils.orders.list.invalidate();
    },
    onError: (err) => {
      toast.error(err.message);
    },
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
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Order History</h1>
        <p className="text-muted-foreground text-sm">View and download your scraping results</p>
      </div>

      {orders && orders.length > 0 ? (
        <div className="space-y-3">
          {orders.map((order) => {
            const status = statusConfig[order.status as keyof typeof statusConfig] || statusConfig.pending;
            const StatusIcon = status.icon;
            const isProcessing = order.status === "processing";
            const isFailed = order.status === "failed";

            return (
              <Card
                key={order.id}
                className="cursor-pointer hover:shadow-md transition-shadow border-border/60"
                onClick={() => setLocation(`/orders/${order.id}`)}
              >
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3.5">
                      <div className={`p-2.5 rounded-lg ${status.bg}`}>
                        <StatusIcon
                          className={`h-5 w-5 ${status.color} ${isProcessing ? "animate-spin" : ""}`}
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-foreground">Order #{order.id}</h3>
                          <Badge variant="secondary" className={`${status.bg} ${status.color} border-0 text-xs font-medium`}>
                            {status.label}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {order.processedSkus} of {order.totalSkus} SKUs processed
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(order.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Cost</p>
                        <p className="font-semibold text-foreground">${parseFloat(order.chargedAmount).toFixed(2)}</p>
                      </div>

                      {isFailed && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-red-200 text-red-600 hover:bg-red-50"
                          onClick={(e) => {
                            e.stopPropagation();
                            retryMutation.mutate({ orderId: order.id });
                          }}
                          disabled={retryMutation.isPending}
                        >
                          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${retryMutation.isPending ? "animate-spin" : ""}`} />
                          Retry
                        </Button>
                      )}

                      {order.zipFileUrl && order.status === "completed" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(order.zipFileUrl!, "_blank");
                          }}
                        >
                          <Download className="h-3.5 w-3.5 mr-1.5" />
                          Download
                        </Button>
                      )}

                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>

                  {isProcessing && (
                    <div className="mt-3.5">
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>Progress</span>
                        <span>
                          {order.processedSkus} / {order.totalSkus}
                        </span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-500"
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
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <History className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
            <h3 className="text-lg font-medium mb-1 text-foreground">No orders yet</h3>
            <p className="text-muted-foreground text-sm mb-4">
              Start by entering SKUs to scrape product images
            </p>
            <Button onClick={() => setLocation("/")} size="sm">
              <Package className="h-4 w-4 mr-2" />
              Start Scraping
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
