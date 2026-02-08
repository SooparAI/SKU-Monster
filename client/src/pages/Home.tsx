import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  Upload,
  Search,
  Wallet,
  FileSpreadsheet,
  Loader2,
  Package,
  DollarSign,
  AlertCircle,
} from "lucide-react";
import * as XLSX from "xlsx";

export default function Home() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [skuInput, setSkuInput] = useState("");
  const [parsedSkus, setParsedSkus] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: balanceData, refetch: refetchBalance } = trpc.balance.get.useQuery(undefined, {
    enabled: !!user,
  });

  const parseSkusMutation = trpc.orders.parseSkus.useMutation({
    onSuccess: (data) => {
      setParsedSkus(data.skus);
      if (data.skus.length === 0) {
        toast.error("No valid SKUs found in your input");
      } else {
        toast.success(`Found ${data.skus.length} SKU(s) - Total cost: $${data.totalCost}`);
      }
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const createOrderMutation = trpc.orders.create.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      refetchBalance();
      setLocation(`/orders/${data.orderId}`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleParseSkus = () => {
    if (!skuInput.trim()) {
      toast.error("Please enter at least one SKU");
      return;
    }
    parseSkusMutation.mutate({ text: skuInput });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as string[][];

      const allValues = jsonData.flat().filter(Boolean).join("\n");
      setSkuInput(allValues);
      toast.success(`Loaded ${file.name}`);

      parseSkusMutation.mutate({ text: allValues });
    } catch (error) {
      toast.error("Failed to read file. Please ensure it's a valid CSV or Excel file.");
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmitOrder = () => {
    if (parsedSkus.length === 0) {
      toast.error("No SKUs to process. Please parse your input first.");
      return;
    }

    const totalCost = parsedSkus.length * (balanceData?.pricePerSku || 10);
    const balance = balanceData?.balance || 0;

    if (balance < (balanceData?.pricePerSku || 10)) {
      toast.error("Insufficient balance. Please top up to continue.");
      setLocation("/topup");
      return;
    }

    if (balance < totalCost) {
      const affordableSkus = Math.floor(balance / (balanceData?.pricePerSku || 10));
      toast.warning(
        `You can only process ${affordableSkus} of ${parsedSkus.length} SKUs with your current balance.`
      );
    }

    setIsProcessing(true);
    createOrderMutation.mutate(
      { skus: parsedSkus },
      {
        onSettled: () => setIsProcessing(false),
      }
    );
  };

  const balance = balanceData?.balance || 0;
  const pricePerSku = balanceData?.pricePerSku || 10;
  const totalCost = parsedSkus.length * pricePerSku;
  const canAfford = balance >= pricePerSku;
  const affordableSkus = Math.floor(balance / pricePerSku);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Scrape SKUs</h1>
        <p className="text-muted-foreground text-sm">
          Enter product SKUs to scrape HQ images from 20+ online retailers
        </p>
      </div>

      {/* Balance Card */}
      <Card className="border-primary/15 bg-primary/3">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-2.5 rounded-xl bg-primary/10">
                <Wallet className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Available Balance</p>
                <p className="text-2xl font-bold text-foreground">${balance.toFixed(2)}</p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Button onClick={() => setLocation("/topup")} size="sm">
                <DollarSign className="h-3.5 w-3.5 mr-1.5" />
                Top Up
              </Button>
              <p className="text-xs text-muted-foreground">${pricePerSku}/SKU</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SKU Input Section */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Search className="h-4.5 w-4.5 text-primary" />
            Enter SKUs
          </CardTitle>
          <CardDescription>
            Enter SKU/EAN/UPC codes to search across 20 fragrance retailers
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs defaultValue="text" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="text">Text Input</TabsTrigger>
              <TabsTrigger value="file">File Upload</TabsTrigger>
            </TabsList>

            <TabsContent value="text" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="sku-input" className="text-foreground">SKU Numbers</Label>
                <Textarea
                  id="sku-input"
                  placeholder="Enter SKU numbers (one per line, comma-separated, or paste from spreadsheet)&#10;&#10;Example:&#10;701666410164&#10;3770006409028&#10;3614225621932"
                  className="min-h-[180px] font-mono text-sm"
                  value={skuInput}
                  onChange={(e) => setSkuInput(e.target.value)}
                />
              </div>
              <Button
                onClick={handleParseSkus}
                disabled={parseSkusMutation.isPending || !skuInput.trim()}
                className="w-full"
              >
                {parseSkusMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                Parse SKUs
              </Button>
            </TabsContent>

            <TabsContent value="file" className="space-y-4">
              <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/30 transition-colors">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="file-upload"
                />
                <label
                  htmlFor="file-upload"
                  className="cursor-pointer flex flex-col items-center gap-3"
                >
                  <div className="p-3 rounded-full bg-muted">
                    <FileSpreadsheet className="h-7 w-7 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Click to upload CSV or Excel file</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      Supports .csv, .xlsx, and .xls files
                    </p>
                  </div>
                </label>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Parsed SKUs Preview */}
      {parsedSkus.length > 0 && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Package className="h-4.5 w-4.5 text-primary" />
              Ready to Process
            </CardTitle>
            <CardDescription>
              {parsedSkus.length} SKU(s) found — Total cost: ${totalCost.toFixed(2)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* SKU List */}
            <div className="bg-muted/40 rounded-lg p-4 max-h-[200px] overflow-y-auto">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {parsedSkus.map((sku, index) => (
                  <div
                    key={index}
                    className="bg-background px-3 py-2 rounded-md text-sm font-mono border border-border/60 text-foreground"
                  >
                    {sku}
                  </div>
                ))}
              </div>
            </div>

            {/* Cost Summary */}
            <div className="bg-muted/30 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">SKUs to process</span>
                <span className="text-foreground">{parsedSkus.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Price per SKU</span>
                <span className="text-foreground">${pricePerSku.toFixed(2)}</span>
              </div>
              <div className="border-t border-border pt-2 flex justify-between font-medium">
                <span className="text-foreground">Total Cost</span>
                <span className="text-primary">${totalCost.toFixed(2)}</span>
              </div>
              {!canAfford && (
                <div className="flex items-center gap-2 text-destructive text-sm mt-2">
                  <AlertCircle className="h-4 w-4" />
                  <span>Insufficient balance. Please top up to continue.</span>
                </div>
              )}
              {canAfford && affordableSkus < parsedSkus.length && (
                <div className="flex items-center gap-2 text-amber-600 text-sm mt-2">
                  <AlertCircle className="h-4 w-4" />
                  <span>
                    You can only process {affordableSkus} of {parsedSkus.length} SKUs with your
                    current balance.
                  </span>
                </div>
              )}
            </div>

            {/* Submit Button */}
            <Button
              onClick={handleSubmitOrder}
              disabled={isProcessing || !canAfford}
              className="w-full"
              size="lg"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : !canAfford ? (
                <>
                  <DollarSign className="h-4 w-4 mr-2" />
                  Top Up Required
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Start Scraping ({affordableSkus < parsedSkus.length ? affordableSkus : parsedSkus.length} SKUs)
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
