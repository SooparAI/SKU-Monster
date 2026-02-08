import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { toast } from "sonner";
import {
  CreditCard,
  Wallet,
  DollarSign,
  ArrowLeft,
  Check,
  Loader2,
  CheckCircle,
  Copy,
  ExternalLink,
  QrCode,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const PRESET_AMOUNTS = [
  { credits: 5, price: 75 },
  { credits: 10, price: 150 },
  { credits: 25, price: 375 },
  { credits: 50, price: 750 },
];

export default function TopUp() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [selectedTier, setSelectedTier] = useState(PRESET_AMOUNTS[1]);
  const [customAmount, setCustomAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"stripe" | "solana">("stripe");
  const [isProcessing, setIsProcessing] = useState(false);
  const [solanaPaymentData, setSolanaPaymentData] = useState<{
    transactionId: number;
    reference: string;
    solanaPayUrl: string;
    walletAddress: string;
    amount: number;
    credits: number;
  } | null>(null);
  const [showSolanaDialog, setShowSolanaDialog] = useState(false);

  const params = new URLSearchParams(search);
  const isSuccess = params.get("success") === "true";
  const sessionId = params.get("session_id");
  const isCanceled = params.get("canceled") === "true";

  const { data: balanceData, refetch: refetchBalance } = trpc.balance.get.useQuery(undefined, {
    enabled: !!user,
  });

  const { data: transactions, refetch: refetchTransactions } = trpc.balance.getTransactions.useQuery(undefined, {
    enabled: !!user,
  });

  const { data: solanaConfig } = trpc.balance.getSolanaConfig.useQuery(undefined, {
    enabled: !!user,
  });

  const { data: checkoutStatus } = trpc.balance.verifyCheckout.useQuery(
    { sessionId: sessionId || "" },
    { enabled: !!sessionId && isSuccess }
  );

  const createStripeCheckoutMutation = trpc.balance.createStripeCheckout.useMutation({
    onSuccess: (data) => {
      toast.info("Redirecting to Stripe checkout...");
      window.open(data.checkoutUrl, "_blank");
    },
    onError: (error) => {
      toast.error(error.message);
      setIsProcessing(false);
    },
  });

  const createSolanaPaymentMutation = trpc.balance.createSolanaPayment.useMutation({
    onSuccess: (data) => {
      setSolanaPaymentData(data);
      setShowSolanaDialog(true);
      setIsProcessing(false);
    },
    onError: (error) => {
      toast.error(error.message);
      setIsProcessing(false);
    },
  });

  const confirmSolanaPaymentMutation = trpc.balance.confirmSolanaPayment.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      setShowSolanaDialog(false);
      setSolanaPaymentData(null);
      refetchBalance();
      refetchTransactions();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  useEffect(() => {
    if (isSuccess && checkoutStatus?.status === "paid") {
      toast.success(`Payment successful! $${checkoutStatus.amount.toFixed(2)} added to your balance.`);
      refetchBalance();
      refetchTransactions();
      setLocation("/topup", { replace: true });
    } else if (isCanceled) {
      toast.error("Payment was canceled.");
      setLocation("/topup", { replace: true });
    }
  }, [isSuccess, isCanceled, checkoutStatus, refetchBalance, refetchTransactions, setLocation]);

  const handleTierSelect = (tier: typeof PRESET_AMOUNTS[0]) => {
    setSelectedTier(tier);
    setCustomAmount("");
  };

  const handleCustomAmountChange = (value: string) => {
    setCustomAmount(value);
    const parsed = parseFloat(value);
    if (!isNaN(parsed) && parsed >= 10) {
      const credits = Math.floor(parsed / 10);
      setSelectedTier({ credits, price: parsed });
    }
  };

  const handleTopUp = async () => {
    if (selectedTier.price < 15) {
      toast.error("Minimum top-up amount is $15");
      return;
    }

    setIsProcessing(true);

    if (paymentMethod === "stripe") {
      createStripeCheckoutMutation.mutate({ amount: selectedTier.price });
      setTimeout(() => setIsProcessing(false), 5000);
    } else {
      if (!solanaConfig?.enabled) {
        toast.error("Solana Pay is not configured");
        setIsProcessing(false);
        return;
      }
      createSolanaPaymentMutation.mutate({
        amount: selectedTier.price,
        credits: selectedTier.credits,
      });
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const handleConfirmSolanaPayment = () => {
    if (solanaPaymentData) {
      confirmSolanaPaymentMutation.mutate({
        transactionId: solanaPaymentData.transactionId,
      });
    }
  };

  const balance = balanceData?.balance || 0;
  const skusAffordable = Math.floor((balance + selectedTier.price) / (balanceData?.pricePerSku || 10));

  if (isSuccess && sessionId) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/")} className="h-9 w-9">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Payment Successful</h1>
            <p className="text-sm text-muted-foreground">Your balance has been updated</p>
          </div>
        </div>

        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="py-12 text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
              <CheckCircle className="h-7 w-7 text-emerald-600" />
            </div>
            <h2 className="text-xl font-semibold mb-1.5 text-foreground">Thank you!</h2>
            <p className="text-muted-foreground text-sm mb-6">
              {checkoutStatus?.amount
                ? `$${checkoutStatus.amount.toFixed(2)} has been added to your balance.`
                : "Your payment is being processed..."}
            </p>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => setLocation("/")} size="sm">
                Start Scraping
              </Button>
              <Button variant="outline" size="sm" onClick={() => setLocation("/topup", { replace: true })}>
                Top Up More
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/")} className="h-9 w-9">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Top Up Balance</h1>
          <p className="text-sm text-muted-foreground">Add funds to your account</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Up Form */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <DollarSign className="h-4.5 w-4.5 text-primary" />
              Select Credits
            </CardTitle>
            <CardDescription>Choose a credit package or enter a custom amount</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Preset Amounts */}
            <div className="grid grid-cols-2 gap-2.5">
              {PRESET_AMOUNTS.map((tier) => {
                const isSelected = selectedTier.credits === tier.credits && !customAmount;
                return (
                  <button
                    key={tier.credits}
                    className={`h-[72px] flex flex-col items-center justify-center gap-0.5 rounded-lg border-2 transition-all ${
                      isSelected
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border hover:border-primary/30 hover:bg-muted/30"
                    }`}
                    onClick={() => handleTierSelect(tier)}
                  >
                    <span className="text-base font-semibold">{tier.credits} SKUs</span>
                    <span className="text-sm text-muted-foreground">${tier.price}</span>
                  </button>
                );
              })}
            </div>

            {/* Custom Amount */}
            <div className="space-y-1.5">
              <Label htmlFor="custom-amount" className="text-sm">Custom Amount (USD)</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="custom-amount"
                  type="number"
                  min="15"
                  step="15"
                  placeholder="Enter amount (min $15)"
                  className="pl-9"
                  value={customAmount}
                  onChange={(e) => handleCustomAmountChange(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">$10 per SKU (~3 HQ images)</p>
            </div>

            {/* Payment Method */}
            <div className="space-y-2">
              <Label className="text-sm">Payment Method</Label>
              <RadioGroup
                value={paymentMethod}
                onValueChange={(v) => setPaymentMethod(v as "stripe" | "solana")}
                className="grid grid-cols-2 gap-2.5"
              >
                <div>
                  <RadioGroupItem value="stripe" id="stripe" className="peer sr-only" />
                  <Label
                    htmlFor="stripe"
                    className="flex flex-col items-center justify-between rounded-lg border-2 border-border bg-background p-3.5 hover:bg-muted/30 peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer transition-all"
                  >
                    <CreditCard className="mb-2 h-5 w-5 text-muted-foreground" />
                    <span className="font-medium text-sm">Credit Card</span>
                    <span className="text-xs text-muted-foreground">via Stripe</span>
                  </Label>
                </div>
                <div>
                  <RadioGroupItem value="solana" id="solana" className="peer sr-only" disabled={!solanaConfig?.enabled} />
                  <Label
                    htmlFor="solana"
                    className={`flex flex-col items-center justify-between rounded-lg border-2 border-border bg-background p-3.5 hover:bg-muted/30 peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer transition-all ${!solanaConfig?.enabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <svg className="mb-2 h-5 w-5 text-muted-foreground" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.28 6.882a.714.714 0 0 0-.505-.21H4.286a.357.357 0 0 0-.252.61l2.679 2.678a.714.714 0 0 0 .505.21h12.489a.357.357 0 0 0 .252-.61l-2.679-2.678ZM6.72 17.118a.714.714 0 0 0 .505.21h12.489a.357.357 0 0 0 .252-.61l-2.679-2.678a.714.714 0 0 0-.505-.21H4.293a.357.357 0 0 0-.252.61l2.679 2.678ZM19.714 10.17H7.225a.714.714 0 0 0-.505.21l-2.679 2.678a.357.357 0 0 0 .252.61h12.489a.714.714 0 0 0 .505-.21l2.679-2.678a.357.357 0 0 0-.252-.61Z"/>
                    </svg>
                    <span className="font-medium text-sm">Solana Pay</span>
                    <span className="text-xs text-muted-foreground">USDC</span>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Summary */}
            <div className="bg-muted/30 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Current Balance</span>
                <span className="text-foreground">${balance.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Credits to Add</span>
                <span className="text-primary font-medium">+{selectedTier.credits} SKUs (${selectedTier.price})</span>
              </div>
              <div className="border-t border-border pt-2 flex justify-between font-medium">
                <span className="text-foreground">New Balance</span>
                <span className="text-foreground">${(balance + selectedTier.price).toFixed(2)}</span>
              </div>
              <div className="text-xs text-muted-foreground text-right">
                ≈ {skusAffordable} total SKUs available
              </div>
            </div>

            {/* Submit Button */}
            <Button
              onClick={handleTopUp}
              disabled={isProcessing || selectedTier.price < 15}
              className="w-full"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Pay ${selectedTier.price} for {selectedTier.credits} Credits
                </>
              )}
            </Button>

            {paymentMethod === "stripe" && (
              <p className="text-xs text-center text-muted-foreground">
                Test with card: 4242 4242 4242 4242
              </p>
            )}
          </CardContent>
        </Card>

        {/* Transaction History */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wallet className="h-4.5 w-4.5 text-primary" />
              Recent Transactions
            </CardTitle>
            <CardDescription>Your payment and usage history</CardDescription>
          </CardHeader>
          <CardContent>
            {!transactions || transactions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Wallet className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm font-medium">No transactions yet</p>
                <p className="text-xs mt-0.5">Your payment history will appear here</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {transactions.slice(0, 10).map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/20"
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          tx.type === "topup"
                            ? "bg-emerald-50 text-emerald-600"
                            : "bg-blue-50 text-blue-600"
                        }`}
                      >
                        {tx.type === "topup" ? (
                          <DollarSign className="h-4 w-4" />
                        ) : (
                          <QrCode className="h-4 w-4" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-sm text-foreground">
                          {tx.type === "topup" ? "Balance Top-up" : "SKU Scrape"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(tx.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p
                        className={`font-medium text-sm ${
                          tx.type === "topup" ? "text-emerald-600" : "text-foreground"
                        }`}
                      >
                        {tx.type === "topup" ? "+" : "-"}${parseFloat(tx.amount).toFixed(2)}
                      </p>
                      <p
                        className={`text-xs ${
                          tx.status === "completed"
                            ? "text-emerald-600"
                            : tx.status === "pending"
                            ? "text-amber-600"
                            : "text-red-600"
                        }`}
                      >
                        {tx.status}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Solana Pay Dialog */}
      <Dialog open={showSolanaDialog} onOpenChange={setShowSolanaDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.28 6.882a.714.714 0 0 0-.505-.21H4.286a.357.357 0 0 0-.252.61l2.679 2.678a.714.714 0 0 0 .505.21h12.489a.357.357 0 0 0 .252-.61l-2.679-2.678ZM6.72 17.118a.714.714 0 0 0 .505.21h12.489a.357.357 0 0 0 .252-.61l-2.679-2.678a.714.714 0 0 0-.505-.21H4.293a.357.357 0 0 0-.252.61l2.679 2.678ZM19.714 10.17H7.225a.714.714 0 0 0-.505.21l-2.679 2.678a.357.357 0 0 0 .252.61h12.489a.714.714 0 0 0 .505-.21l2.679-2.678a.357.357 0 0 0-.252-.61Z"/>
              </svg>
              Solana Pay
            </DialogTitle>
            <DialogDescription>
              Send exactly ${solanaPaymentData?.amount} USDC to complete your purchase
            </DialogDescription>
          </DialogHeader>

          {solanaPaymentData && (
            <div className="space-y-4">
              <div className="bg-muted/30 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-foreground">${solanaPaymentData.amount} USDC</p>
                <p className="text-sm text-muted-foreground">{solanaPaymentData.credits} SKU Credits</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">Send to this wallet address:</Label>
                <div className="flex gap-2">
                  <Input
                    value={solanaPaymentData.walletAddress}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(solanaPaymentData.walletAddress, "Wallet address")}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">Payment Reference (include in memo):</Label>
                <div className="flex gap-2">
                  <Input
                    value={solanaPaymentData.reference}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(solanaPaymentData.reference, "Reference")}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={() => window.open(solanaPaymentData.solanaPayUrl, "_blank")}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open in Solana Wallet
              </Button>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                <p className="font-medium text-amber-700 mb-1">Important:</p>
                <ul className="text-muted-foreground space-y-1 text-xs">
                  <li>Send exactly ${solanaPaymentData.amount} USDC (SPL Token)</li>
                  <li>Include the reference in your transaction memo</li>
                  <li>Click "I've Sent Payment" after completing the transfer</li>
                </ul>
              </div>

              <Button
                onClick={handleConfirmSolanaPayment}
                disabled={confirmSolanaPaymentMutation.isPending}
                className="w-full"
              >
                {confirmSolanaPaymentMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Confirming...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    I've Sent the Payment
                  </>
                )}
              </Button>

              <p className="text-xs text-center text-muted-foreground">
                Credits will be added after payment verification
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
