import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { useLocation, useParams } from "wouter";
import {
  ArrowLeft,
  Download,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  Image,
  Package,
  Store,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

const statusConfig = {
  pending: { icon: Clock, color: "text-amber-600", bg: "bg-amber-50", label: "Pending" },
  processing: { icon: Loader2, color: "text-blue-600", bg: "bg-blue-50", label: "Processing" },
  completed: { icon: CheckCircle, color: "text-emerald-600", bg: "bg-emerald-50", label: "Completed" },
  partial: { icon: AlertCircle, color: "text-orange-600", bg: "bg-orange-50", label: "Partial" },
  failed: { icon: XCircle, color: "text-red-600", bg: "bg-red-50", label: "Failed" },
  skipped: { icon: AlertCircle, color: "text-gray-500", bg: "bg-gray-50", label: "Skipped" },
};

export default function OrderDetail() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();
  const orderId = parseInt(params.id || "0");

  const retryMutation = trpc.orders.retry.useMutation({
    onSuccess: (result) => {
      toast.success(result.message);
      refetch();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const { data, isLoading, refetch } = trpc.orders.get.useQuery(
    { orderId },
    {
      enabled: !!user && orderId > 0,
      refetchInterval: (query) => {
        return query.state.data?.order?.status === "processing" ? 3000 : false;
      },
    }
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-16">
        <h2 className="text-xl font-medium mb-2 text-foreground">Order not found</h2>
        <Button onClick={() => setLocation("/orders")} variant="outline" size="sm">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Orders
        </Button>
      </div>
    );
  }

  const { order, items } = data;
  const status = statusConfig[order.status as keyof typeof statusConfig] || statusConfig.pending;
  const StatusIcon = status.icon;
  const isProcessing = order.status === "processing";
  const progress = order.totalSkus > 0 ? (order.processedSkus / order.totalSkus) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/orders")} className="h-9 w-9">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Order #{order.id}</h1>
            <Badge variant="secondary" className={`${status.bg} ${status.color} border-0 text-xs font-medium`}>
              <StatusIcon className={`h-3 w-3 mr-1 ${isProcessing ? "animate-spin" : ""}`} />
              {status.label}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Created {new Date(order.createdAt).toLocaleString()}
          </p>
        </div>
        {order.zipFileUrl && (
          <Button onClick={() => window.open(order.zipFileUrl!, "_blank")} size="sm">
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Download ZIP
          </Button>
        )}
        {(order.status === "failed" || order.status === "processing" || order.status === "pending") && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => retryMutation.mutate({ orderId: order.id })}
            disabled={retryMutation.isPending}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${retryMutation.isPending ? "animate-spin" : ""}`} />
            {retryMutation.isPending ? "Retrying..." : "Retry"}
          </Button>
        )}
      </div>

      {/* Progress Card (for processing orders) */}
      {isProcessing && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="p-5">
            <div className="flex items-center gap-3.5 mb-3.5">
              <div className="p-2.5 rounded-lg bg-blue-100">
                <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
              </div>
              <div>
                <h3 className="font-medium text-foreground">Scraping in Progress</h3>
                <p className="text-sm text-muted-foreground">
                  Processing {order.processedSkus} of {order.totalSkus} SKUs...
                </p>
              </div>
            </div>
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground mt-1.5 text-right">
              {progress.toFixed(0)}% complete
            </p>
          </CardContent>
        </Card>
      )}

      {/* Order Summary */}
      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/8">
                <Package className="h-4.5 w-4.5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Total SKUs</p>
                <p className="text-xl font-bold text-foreground">{order.totalSkus}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-50">
                <CheckCircle className="h-4.5 w-4.5 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Processed</p>
                <p className="text-xl font-bold text-foreground">{order.processedSkus}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50">
                <Image className="h-4.5 w-4.5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">Charged</p>
                <p className="text-xl font-bold text-foreground">${parseFloat(order.chargedAmount).toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* SKU Items */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Store className="h-4.5 w-4.5 text-primary" />
            SKU Results
          </CardTitle>
          <CardDescription>Individual results for each SKU in this order</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {items.map((item) => {
              const itemStatus =
                statusConfig[item.status as keyof typeof statusConfig] || statusConfig.pending;
              const ItemStatusIcon = itemStatus.icon;
              const isItemProcessing = item.status === "processing";

              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3.5 rounded-lg border border-border/50 bg-muted/20"
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${itemStatus.bg}`}>
                      <ItemStatusIcon
                        className={`h-4 w-4 ${itemStatus.color} ${isItemProcessing ? "animate-spin" : ""}`}
                      />
                    </div>
                    <div>
                      <p className="font-mono font-medium text-sm text-foreground">{item.sku}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {item.status === "completed" || (item.status as string) === "partial"
                          ? `${item.imagesFound} images found`
                          : (item.status as string) === "skipped"
                          ? "Skipped (insufficient balance)"
                          : item.status === "failed"
                          ? item.errorMessage || "Failed to scrape"
                          : item.status === "processing"
                          ? "Scraping..."
                          : "Waiting..."}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary" className={`${itemStatus.bg} ${itemStatus.color} border-0 text-xs`}>
                    {itemStatus.label}
                  </Badge>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Download Section */}
      {order.zipFileUrl && (order.status === "completed" || order.status === "partial") && (
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3.5">
                <div className="p-2.5 rounded-lg bg-emerald-100">
                  <Download className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <h3 className="font-medium text-foreground">Download Ready</h3>
                  <p className="text-sm text-muted-foreground">
                    Your images are packaged and ready for download
                  </p>
                </div>
              </div>
              <Button
                onClick={() => window.open(order.zipFileUrl!, "_blank")}
                size="sm"
              >
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Download ZIP
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
