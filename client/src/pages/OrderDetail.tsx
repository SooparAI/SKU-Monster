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
  pending: { icon: Clock, color: "bg-yellow-500/20 text-yellow-500", label: "Pending" },
  processing: { icon: Loader2, color: "bg-blue-500/20 text-blue-500", label: "Processing" },
  completed: { icon: CheckCircle, color: "bg-green-500/20 text-green-500", label: "Completed" },
  partial: { icon: AlertCircle, color: "bg-orange-500/20 text-orange-500", label: "Partial" },
  failed: { icon: XCircle, color: "bg-red-500/20 text-red-500", label: "Failed" },
  skipped: { icon: AlertCircle, color: "bg-gray-500/20 text-gray-500", label: "Skipped" },
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
        // Keep refreshing while processing
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
        <h2 className="text-xl font-semibold mb-2">Order not found</h2>
        <Button onClick={() => setLocation("/orders")}>
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
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/orders")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">Order #{order.id}</h1>
            <Badge variant="outline" className={status.color}>
              <StatusIcon className={`h-3 w-3 mr-1 ${isProcessing ? "animate-spin" : ""}`} />
              {status.label}
            </Badge>
          </div>
          <p className="text-muted-foreground">
            Created {new Date(order.createdAt).toLocaleString()}
          </p>
        </div>
        {order.zipFileUrl && (
          <Button onClick={() => window.open(order.zipFileUrl!, "_blank")}>
            <Download className="h-4 w-4 mr-2" />
            Download ZIP
          </Button>
        )}
        {(order.status === "failed" || order.status === "processing") && (
          <Button
            variant="outline"
            onClick={() => retryMutation.mutate({ orderId: order.id })}
            disabled={retryMutation.isPending}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${retryMutation.isPending ? "animate-spin" : ""}`} />
            {retryMutation.isPending ? "Retrying..." : "Retry"}
          </Button>
        )}
      </div>

      {/* Progress Card (for processing orders) */}
      {isProcessing && (
        <Card className="border-blue-500/50 bg-blue-500/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 rounded-xl bg-blue-500/20">
                <Loader2 className="h-6 w-6 text-blue-500 animate-spin" />
              </div>
              <div>
                <h3 className="font-semibold">Scraping in Progress</h3>
                <p className="text-sm text-muted-foreground">
                  Processing {order.processedSkus} of {order.totalSkus} SKUs...
                </p>
              </div>
            </div>
            <Progress value={progress} className="h-3" />
            <p className="text-xs text-muted-foreground mt-2 text-right">
              {progress.toFixed(0)}% complete
            </p>
          </CardContent>
        </Card>
      )}

      {/* Order Summary */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/20">
                <Package className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total SKUs</p>
                <p className="text-2xl font-bold">{order.totalSkus}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/20">
                <CheckCircle className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Processed</p>
                <p className="text-2xl font-bold">{order.processedSkus}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/20">
                <Image className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Charged</p>
                <p className="text-2xl font-bold">${parseFloat(order.chargedAmount).toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* SKU Items */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            SKU Results
          </CardTitle>
          <CardDescription>Individual results for each SKU in this order</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {items.map((item) => {
              const itemStatus =
                statusConfig[item.status as keyof typeof statusConfig] || statusConfig.pending;
              const ItemStatusIcon = itemStatus.icon;
              const isItemProcessing = item.status === "processing";

              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-4 rounded-lg bg-muted/30"
                >
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-lg ${itemStatus.color}`}>
                      <ItemStatusIcon
                        className={`h-4 w-4 ${isItemProcessing ? "animate-spin" : ""}`}
                      />
                    </div>
                    <div>
                      <p className="font-mono font-medium">{item.sku}</p>
                      <p className="text-xs text-muted-foreground">
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
                  <Badge variant="outline" className={itemStatus.color}>
                    {itemStatus.label}
                  </Badge>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Download Section (for completed orders) */}
      {order.zipFileUrl && (order.status === "completed" || order.status === "partial") && (
        <Card className="border-green-500/50 bg-green-500/5">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-green-500/20">
                  <Download className="h-6 w-6 text-green-500" />
                </div>
                <div>
                  <h3 className="font-semibold">Download Ready</h3>
                  <p className="text-sm text-muted-foreground">
                    Your Photo.1 Output ZIP file is ready for download
                  </p>
                </div>
              </div>
              <Button
                size="lg"
                onClick={() => window.open(order.zipFileUrl!, "_blank")}
              >
                <Download className="h-4 w-4 mr-2" />
                Download Photo.1 Output.zip
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
