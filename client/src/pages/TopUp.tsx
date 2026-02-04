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
  Sparkles,
  CheckCircle,
} from "lucide-react";

const PRESET_AMOUNTS = [50, 100, 250, 500];

export default function TopUp() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [amount, setAmount] = useState<number>(100);
  const [customAmount, setCustomAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"stripe" | "solana">("stripe");
  const [isProcessing, setIsProcessing] = useState(false);

  // Parse URL params for success/cancel
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

  // Verify checkout session on success
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

  // Handle success/cancel redirects
  useEffect(() => {
    if (isSuccess && checkoutStatus?.status === "paid") {
      toast.success(`Payment successful! $${checkoutStatus.amount.toFixed(2)} added to your balance.`);
      refetchBalance();
      refetchTransactions();
      // Clear URL params
      setLocation("/topup", { replace: true });
    } else if (isCanceled) {
      toast.error("Payment was canceled.");
      setLocation("/topup", { replace: true });
    }
  }, [isSuccess, isCanceled, checkoutStatus, refetchBalance, refetchTransactions, setLocation]);

  const handleAmountSelect = (value: number) => {
    setAmount(value);
    setCustomAmount("");
  };

  const handleCustomAmountChange = (value: string) => {
    setCustomAmount(value);
    const parsed = parseFloat(value);
    if (!isNaN(parsed) && parsed >= 15) {
      setAmount(parsed);
    }
  };

  const handleTopUp = async () => {
    if (amount < 15) {
      toast.error("Minimum top-up amount is $15");
      return;
    }

    setIsProcessing(true);

    if (paymentMethod === "stripe") {
      createStripeCheckoutMutation.mutate({ amount });
      // Don't set isProcessing to false here - user will be redirected
      setTimeout(() => setIsProcessing(false), 5000); // Reset after 5s if redirect fails
    } else {
      // Solana Pay - coming soon
      toast.info("Solana Pay integration coming soon!");
      setIsProcessing(false);
    }
  };

  const balance = balanceData?.balance || 0;
  const skusAffordable = Math.floor((balance + amount) / (balanceData?.pricePerSku || 15));

  // Show success state
  if (isSuccess && sessionId) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Payment Successful</h1>
            <p className="text-muted-foreground">Your balance has been updated</p>
          </div>
        </div>

        <Card className="border-green-500/50 bg-green-500/5">
          <CardContent className="py-12 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
              <CheckCircle className="h-8 w-8 text-green-500" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Thank you!</h2>
            <p className="text-muted-foreground mb-6">
              {checkoutStatus?.amount
                ? `$${checkoutStatus.amount.toFixed(2)} has been added to your balance.`
                : "Your payment is being processed..."}
            </p>
            <div className="flex gap-4 justify-center">
              <Button onClick={() => setLocation("/")}>
                Start Scraping
              </Button>
              <Button variant="outline" onClick={() => setLocation("/topup", { replace: true })}>
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
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Top Up Balance</h1>
          <p className="text-muted-foreground">Add funds to your account</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Up Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Select Amount
            </CardTitle>
            <CardDescription>Choose a preset amount or enter a custom value</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Preset Amounts */}
            <div className="grid grid-cols-2 gap-3">
              {PRESET_AMOUNTS.map((preset) => (
                <Button
                  key={preset}
                  variant={amount === preset && !customAmount ? "default" : "outline"}
                  className="h-16 text-lg font-semibold"
                  onClick={() => handleAmountSelect(preset)}
                >
                  ${preset}
                </Button>
              ))}
            </div>

            {/* Custom Amount */}
            <div className="space-y-2">
              <Label htmlFor="custom-amount">Custom Amount</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="custom-amount"
                  type="number"
                  min="15"
                  step="1"
                  placeholder="Enter amount (min $15)"
                  className="pl-9"
                  value={customAmount}
                  onChange={(e) => handleCustomAmountChange(e.target.value)}
                />
              </div>
            </div>

            {/* Payment Method */}
            <div className="space-y-3">
              <Label>Payment Method</Label>
              <RadioGroup
                value={paymentMethod}
                onValueChange={(v) => setPaymentMethod(v as "stripe" | "solana")}
                className="grid grid-cols-2 gap-3"
              >
                <div>
                  <RadioGroupItem value="stripe" id="stripe" className="peer sr-only" />
                  <Label
                    htmlFor="stripe"
                    className="flex flex-col items-center justify-between rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                  >
                    <CreditCard className="mb-3 h-6 w-6" />
                    <span className="font-medium">Credit Card</span>
                    <span className="text-xs text-muted-foreground">via Stripe</span>
                  </Label>
                </div>
                <div>
                  <RadioGroupItem value="solana" id="solana" className="peer sr-only" />
                  <Label
                    htmlFor="solana"
                    className="flex flex-col items-center justify-between rounded-lg border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer opacity-60"
                  >
                    <Sparkles className="mb-3 h-6 w-6" />
                    <span className="font-medium">Solana Pay</span>
                    <span className="text-xs text-muted-foreground">Coming Soon</span>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Summary */}
            <div className="bg-muted/30 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Current Balance</span>
                <span>${balance.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Top Up Amount</span>
                <span className="text-primary">+${amount.toFixed(2)}</span>
              </div>
              <div className="border-t border-border pt-2 flex justify-between font-medium">
                <span>New Balance</span>
                <span>${(balance + amount).toFixed(2)}</span>
              </div>
              <div className="text-xs text-muted-foreground text-right">
                ≈ {skusAffordable} SKUs at ${balanceData?.pricePerSku || 15}/SKU
              </div>
            </div>

            {/* Submit Button */}
            <Button
              onClick={handleTopUp}
              disabled={isProcessing || amount < 15}
              className="w-full"
              size="lg"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Top Up ${amount.toFixed(2)}
                </>
              )}
            </Button>

            {/* Test card info */}
            <p className="text-xs text-center text-muted-foreground">
              Test with card: 4242 4242 4242 4242
            </p>
          </CardContent>
        </Card>

        {/* Transaction History */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              Recent Transactions
            </CardTitle>
            <CardDescription>Your payment and usage history</CardDescription>
          </CardHeader>
          <CardContent>
            {transactions && transactions.length > 0 ? (
              <div className="space-y-3">
                {transactions.slice(0, 10).map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/30"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2 rounded-full ${
                          tx.type === "topup"
                            ? "bg-green-500/20 text-green-500"
                            : tx.type === "charge"
                            ? "bg-blue-500/20 text-blue-500"
                            : "bg-yellow-500/20 text-yellow-500"
                        }`}
                      >
                        {tx.type === "topup" ? (
                          <DollarSign className="h-4 w-4" />
                        ) : tx.type === "charge" ? (
                          <CreditCard className="h-4 w-4" />
                        ) : (
                          <ArrowLeft className="h-4 w-4" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-sm capitalize">{tx.type}</p>
                        <p className="text-xs text-muted-foreground">
                          {tx.description || tx.paymentMethod || "—"}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p
                        className={`font-medium ${
                          tx.type === "topup" ? "text-green-500" : ""
                        }`}
                      >
                        {tx.type === "topup" ? "+" : "-"}${parseFloat(tx.amount).toFixed(2)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(tx.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Wallet className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No transactions yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
