import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Home from "./pages/Home";
import TopUp from "./pages/TopUp";
import Orders from "./pages/Orders";
import OrderDetail from "./pages/OrderDetail";
import Login from "./pages/Login";
import Register from "./pages/Register";

function Router() {
  return (
    <Switch>
      {/* Public auth routes */}
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      
      {/* Protected routes wrapped in DashboardLayout */}
      <Route>
        <DashboardLayout>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/topup" component={TopUp} />
            <Route path="/orders" component={Orders} />
            <Route path="/orders/:id" component={OrderDetail} />
            <Route path="/404" component={NotFound} />
            <Route component={NotFound} />
          </Switch>
        </DashboardLayout>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
