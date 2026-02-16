import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { XMarkIcon } from "@heroicons/react/24/outline";

const AuthModal = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState("signin");
  const navigate = useNavigate();

  // Sign In form state
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");

  // Sign Up form state
  const [signUpName, setSignUpName] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPhone, setSignUpPhone] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [signUpConfirm, setSignUpConfirm] = useState("");

  if (!isOpen) return null;

  // TODO: Replace with real authentication backend integration
  const handleSignIn = (e) => {
    e.preventDefault();
    onClose();
    navigate("/home");
  };

  // TODO: Replace with real account creation backend integration
  const handleSignUp = (e) => {
    e.preventDefault();
    onClose();
    navigate("/home");
  };

  const inputClass =
    "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none placeholder:text-text-gray transition-all duration-300 focus:border-neon-pink focus:shadow-glow";

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/80 z-[999] animate-fadeIn"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-5">
        <div
          className="bg-bg-card border border-white/10 rounded-2xl w-full max-w-[440px] relative animate-fadeIn"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            className="absolute top-4 right-4 bg-transparent border-0 text-text-gray cursor-pointer p-1 transition-all duration-300 ease-out hover:text-white hover:rotate-90 z-10"
            onClick={onClose}
          >
            <XMarkIcon className="w-5 h-5" />
          </button>

          {/* Logo */}
          <div className="text-center pt-8 pb-2">
            <span className="font-bebas text-3xl tracking-[2px] text-white [text-shadow:0_0_20px_rgba(255,0,119,0.4)]">
              FAIR<span className="text-neon-pink">DASH</span>
            </span>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-white/10 mx-8 mt-4">
            <button
              className={`flex-1 pb-3 text-sm font-semibold uppercase tracking-wide border-0 bg-transparent cursor-pointer transition-all duration-300 ${
                activeTab === "signin"
                  ? "text-neon-pink border-b-2 border-neon-pink"
                  : "text-text-gray hover:text-white"
              }`}
              style={
                activeTab === "signin"
                  ? { borderBottom: "2px solid #FF0077" }
                  : {}
              }
              onClick={() => setActiveTab("signin")}
            >
              Sign In
            </button>
            <button
              className={`flex-1 pb-3 text-sm font-semibold uppercase tracking-wide border-0 bg-transparent cursor-pointer transition-all duration-300 ${
                activeTab === "signup"
                  ? "text-neon-pink"
                  : "text-text-gray hover:text-white"
              }`}
              style={
                activeTab === "signup"
                  ? { borderBottom: "2px solid #FF0077" }
                  : {}
              }
              onClick={() => setActiveTab("signup")}
            >
              Sign Up
            </button>
          </div>

          {/* Forms */}
          <div className="p-8">
            {activeTab === "signin" ? (
              <form onSubmit={handleSignIn} className="flex flex-col gap-4">
                <input
                  type="email"
                  placeholder="Email address"
                  className={inputClass}
                  value={signInEmail}
                  onChange={(e) => setSignInEmail(e.target.value)}
                  required
                />
                <input
                  type="password"
                  placeholder="Password"
                  className={inputClass}
                  value={signInPassword}
                  onChange={(e) => setSignInPassword(e.target.value)}
                  required
                />
                <button
                  type="submit"
                  className="w-full py-3.5 bg-neon-pink border-0 text-white font-bold text-sm rounded-xl cursor-pointer transition-all duration-300 ease-out uppercase tracking-wide hover:bg-[#e0006b] hover:shadow-glow-intense mt-2"
                >
                  Sign In
                </button>
                <button
                  type="button"
                  className="bg-transparent border-0 text-text-gray text-sm cursor-pointer hover:text-neon-pink transition-colors duration-300"
                >
                  Forgot password?
                </button>
              </form>
            ) : (
              <form onSubmit={handleSignUp} className="flex flex-col gap-4">
                <input
                  type="text"
                  placeholder="Full Name"
                  className={inputClass}
                  value={signUpName}
                  onChange={(e) => setSignUpName(e.target.value)}
                  required
                />
                <input
                  type="email"
                  placeholder="Email address"
                  className={inputClass}
                  value={signUpEmail}
                  onChange={(e) => setSignUpEmail(e.target.value)}
                  required
                />
                <input
                  type="tel"
                  placeholder="Phone number (optional)"
                  className={inputClass}
                  value={signUpPhone}
                  onChange={(e) => setSignUpPhone(e.target.value)}
                />
                <input
                  type="password"
                  placeholder="Password"
                  className={inputClass}
                  value={signUpPassword}
                  onChange={(e) => setSignUpPassword(e.target.value)}
                  required
                />
                <input
                  type="password"
                  placeholder="Confirm Password"
                  className={inputClass}
                  value={signUpConfirm}
                  onChange={(e) => setSignUpConfirm(e.target.value)}
                  required
                />
                <button
                  type="submit"
                  className="w-full py-3.5 bg-neon-pink border-0 text-white font-bold text-sm rounded-xl cursor-pointer transition-all duration-300 ease-out uppercase tracking-wide hover:bg-[#e0006b] hover:shadow-glow-intense mt-2"
                >
                  Create Account
                </button>
                <p className="text-text-gray text-xs text-center leading-relaxed">
                  By creating an account, you agree to our{" "}
                  <span className="text-neon-pink cursor-pointer">
                    Terms of Service
                  </span>{" "}
                  and{" "}
                  <span className="text-neon-pink cursor-pointer">
                    Privacy Policy
                  </span>
                  .
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default AuthModal;
