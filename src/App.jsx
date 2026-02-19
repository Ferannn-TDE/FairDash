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
import { FaFacebookF, FaEnvelope } from "react-icons/fa";
import LoadingAnimation from "./components/LoadingAnimation";
import Navbar from "./components/Navbar";
import Cart from "./components/Cart";
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
      {!hideChrome && <Cart />}
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
      </Routes>
      {!hideChrome && <Footer />}
    </div>
  );
};

function App() {
  const [loading, setLoading] = useState(true);

  return (
    <CartProvider>
      {loading ? (
        <LoadingAnimation onComplete={() => setLoading(false)} />
      ) : (
        <Router>
          <AppLayout />
        </Router>
      )}
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
    <footer className="bg-bg-card border-t border-white/10 py-16 lg:py-12 md:py-10 mt-auto">
      <div className="max-w-[1400px] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr] lg:grid-cols-2 md:grid-cols-1 gap-12 lg:gap-10 md:gap-8 mb-10">
          <div>
            <img
              src="/images/logo/fairdash-logo.png"
              alt="FairDash Logo"
              className="w-48 mb-4 drop-shadow-[0_0_15px_rgba(255,0,119,0.4)]"
            />
            <p className="text-text-gray text-sm leading-relaxed">
              The fair comes to your door.
              <br />
              <br />
              Fresh. Fast. Fair.
            </p>
          </div>

          <div>
            <h4 className="font-bebas text-lg tracking-wide mb-5 text-neon-pink">
              Company
            </h4>
            <ul className="list-none p-0">
              <li className="mb-3">
                <a
                  href="#about"
                  className="text-text-gray no-underline text-sm transition-colors duration-300 hover:text-neon-pink"
                >
                  About Us
                </a>
              </li>
              <li className="mb-3">
                <a
                  href="#careers"
                  className="text-text-gray no-underline text-sm transition-colors duration-300 hover:text-neon-pink"
                >
                  Careers
                </a>
              </li>
              <li className="mb-3">
                <a
                  href="#press"
                  className="text-text-gray no-underline text-sm transition-colors duration-300 hover:text-neon-pink"
                >
                  Press
                </a>
              </li>
              <li className="mb-3">
                <a
                  href="#blog"
                  className="text-text-gray no-underline text-sm transition-colors duration-300 hover:text-neon-pink"
                >
                  Blog
                </a>
              </li>
              <li className="mb-3">
                <Link
                  to="/contact"
                  className="text-text-gray no-underline text-sm transition-colors duration-300 hover:text-neon-pink"
                >
                  Contact Us
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-bebas text-lg tracking-wide mb-5 text-neon-pink">
              Support
            </h4>
            <ul className="list-none p-0">
              <li className="mb-3">
                <a
                  href="#help"
                  className="text-text-gray no-underline text-sm transition-colors duration-300 hover:text-neon-pink"
                >
                  Help Center
                </a>
              </li>
              <li className="mb-3">
                <a
                  href="#safety"
                  className="text-text-gray no-underline text-sm transition-colors duration-300 hover:text-neon-pink"
                >
                  Safety
                </a>
              </li>
              <li className="mb-3">
                <a
                  href="#terms"
                  className="text-text-gray no-underline text-sm transition-colors duration-300 hover:text-neon-pink"
                >
                  Terms
                </a>
              </li>
              <li className="mb-3">
                <a
                  href="#privacy"
                  className="text-text-gray no-underline text-sm transition-colors duration-300 hover:text-neon-pink"
                >
                  Privacy
                </a>
              </li>
              <li className="mb-3">
                <Link
                  to="/refund-policy"
                  className="text-text-gray no-underline text-sm transition-colors duration-300 hover:text-neon-pink"
                >
                  Refund Policy
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-bebas text-lg tracking-wide mb-5 text-neon-pink">
              Vendors
            </h4>
            <ul className="list-none p-0">
              <li className="mb-3">
                <a
                  href="#partner"
                  className="text-text-gray no-underline text-sm transition-colors duration-300 hover:text-neon-pink"
                >
                  Partner With Us
                </a>
              </li>
              <li className="mb-3">
                <a
                  href="#vendor-portal"
                  className="text-text-gray no-underline text-sm transition-colors duration-300 hover:text-neon-pink"
                >
                  Vendor Portal
                </a>
              </li>
              <li className="mb-3">
                <a
                  href="#guidelines"
                  className="text-text-gray no-underline text-sm transition-colors duration-300 hover:text-neon-pink"
                >
                  Guidelines
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Payment Methods */}
        <div className="py-8 border-t border-white/5">
          <h4 className="font-bebas text-lg tracking-wide mb-5 text-neon-pink text-center">
            We Accept
          </h4>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <img
              src="/images/payments/cashapp.svg"
              alt="Cash App"
              className="h-10 transition-all duration-300 hover:scale-110"
            />
            <img
              src="/images/payments/applepay.svg"
              alt="Apple Pay"
              className="h-10 transition-all duration-300 hover:scale-110"
            />
            <img
              src="/images/payments/googlepay.svg"
              alt="Google Pay"
              className="h-10 transition-all duration-300 hover:scale-110"
            />
            <img
              src="/images/payments/visa.svg"
              alt="Visa"
              className="h-10 transition-all duration-300 hover:scale-110"
            />
            <img
              src="/images/payments/mastercard.svg"
              alt="Mastercard"
              className="h-10 transition-all duration-300 hover:scale-110"
            />
            <img
              src="/images/payments/americanexpress.svg"
              alt="American Express"
              className="h-10 transition-all duration-300 hover:scale-110"
            />
            <img
              src="/images/payments/discover.svg"
              alt="Discover"
              className="h-10 transition-all duration-300 hover:scale-110"
            />
            <img
              src="/images/payments/jcb.svg"
              alt="JCB"
              className="h-10 transition-all duration-300 hover:scale-110"
            />
          </div>
        </div>

        <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row md:justify-between md:items-center gap-5 text-center md:text-left text-text-gray text-sm">
          <p className="m-0">&copy; 2026 FairDash. All rights reserved.</p>
          <div className="flex gap-5 justify-center">
            <a
              href="mailto:fairdash217@gmail.com"
              aria-label="Email"
              className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-neon-pink transition-all duration-300 ease-out hover:bg-neon-pink hover:text-white hover:scale-110 hover:shadow-glow"
            >
              <FaEnvelope className="w-5 h-5" />
            </a>
            <a
              href="https://www.facebook.com/fairdash217"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Facebook"
              className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-neon-pink transition-all duration-300 ease-out hover:bg-neon-pink hover:text-white hover:scale-110 hover:shadow-glow"
            >
              <FaFacebookF className="w-5 h-5" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default App;
