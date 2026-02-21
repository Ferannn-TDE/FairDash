import { useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  Navigate,
  useLocation,
} from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { CartProvider } from "./context/CartContext";
import { MobileMenuProvider } from "./context/MobileMenuContext";
import { FaFacebookF, FaEnvelope } from "react-icons/fa";
import LoadingAnimation from "./components/LoadingAnimation";
import ToastConfig from "./components/Toast";
import Navbar from "./components/Navbar";
import Cart from "./components/Cart";
import MobileNavPanel from "./components/MobileNavPanel";
import Landing from "./pages/Landing";
import Home from "./pages/Home";
import Menu from "./pages/Menu";
import Vendors from "./pages/Vendors";
import VendorDetail from "./pages/VendorDetail";
import Contact from "./pages/Contact";
import RefundPolicy from "./pages/RefundPolicy";

const ProtectedRoute = ({ children }) => {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-dark">
        <div className="w-8 h-8 border-2 border-neon-pink border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isSignedIn) {
    return <Navigate to="/" />;
  }

  return children;
};

const AppLayout = () => {
  const location = useLocation();
  const isLanding = location.pathname === "/";
  const isHome = location.pathname === "/home";
  const hideChrome = isLanding || isHome;

  return (
    <div className="min-h-screen flex flex-col">
      {!hideChrome && <Navbar />}
      <Cart />
      <MobileNavPanel />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route
          path="/home"
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          }
        />
        <Route
          path="/menu"
          element={
            <ProtectedRoute>
              <Menu />
            </ProtectedRoute>
          }
        />
        <Route path="/contact" element={<Contact />} />
        <Route path="/refund-policy" element={<RefundPolicy />} />
        <Route
          path="/vendors"
          element={
            <ProtectedRoute>
              <Vendors />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vendors/:vendorId"
          element={
            <ProtectedRoute>
              <VendorDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/track"
          element={
            <ProtectedRoute>
              <ComingSoon title="Track Order" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/location"
          element={
            <ProtectedRoute>
              <ComingSoon title="Live Location Map" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/favorites"
          element={
            <ProtectedRoute>
              <ComingSoon title="Favorites" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/history"
          element={
            <ProtectedRoute>
              <ComingSoon title="Order History" />
            </ProtectedRoute>
          }
        />
      </Routes>
      {!hideChrome && <Footer />}
    </div>
  );
};

function App() {
  const [loading, setLoading] = useState(true);

  return (
    <CartProvider>
      <ToastConfig />
      <MobileMenuProvider>
        {loading ? (
          <LoadingAnimation onComplete={() => setLoading(false)} />
        ) : (
          <Router>
            <AppLayout />
          </Router>
        )}
      </MobileMenuProvider>
    </CartProvider>
  );
}

const ComingSoon = ({ title }) => {
  return (
    <div className="min-h-[calc(100vh-80px)] flex items-center justify-center pt-20 pb-5 px-5">
      <div className="text-center max-w-[600px]">
        <h1 className="font-bebas text-[clamp(2.5rem,6vw,4.5rem)] leading-tight mb-5 tracking-[2px]">
          <span className="text-neon-pink">{title}</span>
          <br />
          Coming Soon
        </h1>
        <p className="text-text-gray text-xl mb-10 leading-relaxed">
          We're working hard to bring you this feature. Check back soon!
        </p>
        <img
          src="/images/logo/fairdash-logo.png"
          alt="FairDash"
          className="w-48 mx-auto opacity-20 animate-float"
        />
      </div>
    </div>
  );
};

const Footer = () => {
  return (
    <footer className="bg-bg-dark border-t border-white/10 py-12 md:py-8 mt-auto">
      <div className="max-w-[1400px] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4">

        {/* Logo */}
        <div className="mb-8 md:mb-6">
          <div className="font-bebas text-[1.75rem] md:text-[1.5rem] tracking-[2px] text-white [text-shadow:0_0_20px_rgba(255,0,119,0.4)] mb-2">
            FAIR<span className="text-neon-pink">DASH</span>
          </div>
          <p className="text-text-gray text-[0.875rem] leading-relaxed m-0">
            The fair comes to your door. Fresh. Fast. Fair.
          </p>
        </div>

        {/* Columns — 3 on desktop, 1 on mobile */}
        <div className="grid grid-cols-3 md:grid-cols-1 gap-8 md:gap-6 mb-8">
          <div>
            <h4 className="font-bebas text-[1rem] tracking-wide mb-3 text-neon-pink">Company</h4>
            <ul className="list-none p-0 space-y-2">
              <li><Link to="/contact" className="text-text-gray no-underline text-[0.875rem] transition-colors duration-300 hover:text-neon-pink">Contact Us</Link></li>
              <li><Link to="/refund-policy" className="text-text-gray no-underline text-[0.875rem] transition-colors duration-300 hover:text-neon-pink">Refund Policy</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-bebas text-[1rem] tracking-wide mb-3 text-neon-pink">Join Us</h4>
            <ul className="list-none p-0 space-y-2">
              <li><Link to="/contact" className="text-text-gray no-underline text-[0.875rem] transition-colors duration-300 hover:text-neon-pink">Become a Vendor</Link></li>
              <li><Link to="/contact" className="text-text-gray no-underline text-[0.875rem] transition-colors duration-300 hover:text-neon-pink">Become a Driver</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-bebas text-[1rem] tracking-wide mb-3 text-neon-pink">Connect</h4>
            <ul className="list-none p-0 space-y-2">
              <li><a href="https://www.facebook.com/fairdash217" target="_blank" rel="noopener noreferrer" className="text-text-gray no-underline text-[0.875rem] transition-colors duration-300 hover:text-neon-pink">Facebook</a></li>
              <li><a href="mailto:fairdash217@gmail.com" className="text-text-gray no-underline text-[0.875rem] transition-colors duration-300 hover:text-neon-pink">Email Us</a></li>
            </ul>
          </div>
        </div>

        {/* Copyright — remove the unused mb-10 wrapper */}
        <div className="pt-6 border-t border-white/5 flex justify-between items-center md:flex-col md:gap-4">
          <p className="text-text-gray text-[0.875rem] m-0">&copy; 2026 FairDash. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <a
              href="mailto:fairdash217@gmail.com"
              aria-label="Email"
              className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-neon-pink transition-all duration-300 hover:bg-neon-pink hover:text-white hover:scale-110"
            >
              <FaEnvelope className="w-4 h-4" />
            </a>
            <a
              href="https://www.facebook.com/fairdash217"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Facebook"
              className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-neon-pink transition-all duration-300 hover:bg-neon-pink hover:text-white hover:scale-110"
            >
              <FaFacebookF className="w-4 h-4" />
            </a>
          </div>
        </div>

      </div>
    </footer>
  );
};

export default App;
