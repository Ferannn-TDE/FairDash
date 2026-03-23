import { useState } from "react";
import {
  FaFacebookF,
  FaEnvelope,
  FaPhone,
  FaMapMarkerAlt,
} from "react-icons/fa";

const Contact = () => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    message: "",
  });

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Form submission logic would go here
    console.log("Form submitted:", formData);
    // Reset form
    setFormData({ name: "", email: "", phone: "", message: "" });
    alert("Thank you for contacting us! We will get back to you soon.");
  };

  return (
    <div className="pt-20 min-h-screen">
      {/* Hero Section */}
      <section className="bg-[radial-gradient(circle_at_top_center,rgba(255,0,119,0.1),transparent_50%),#1a1a1a] py-16 lg:py-12 md:py-10 border-b border-white/10">
        <div className="max-w-[1400px] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4">
          <h1 className="font-bebas text-[clamp(3rem,6vw,5rem)] text-center mb-4 tracking-[2px]">
            <span className="text-neon-pink">Contact</span> Us
          </h1>
          <p className="text-center text-text-gray text-lg max-w-2xl mx-auto">
            Reach out to us and let us know if there is anything we can do for
            you
          </p>
        </div>
      </section>

      {/* Main Content */}
      <section className="py-16 lg:py-12 md:py-10">
        <div className="max-w-[1400px] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-8">
            {/* Contact Form */}
            <div className="bg-bg-card rounded-3xl p-8 lg:p-6 border border-white/5">
              <h2 className="font-bebas text-3xl mb-6 tracking-wide">
                Send Us A Message
              </h2>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label
                    htmlFor="name"
                    className="block text-sm font-medium mb-2 uppercase tracking-wide"
                  >
                    Name <span className="text-neon-pink">*</span>
                  </label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    required
                    value={formData.name}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-bg-dark border border-white/10 rounded-xl text-white outline-none transition-all duration-300 focus:border-neon-pink focus:shadow-glow"
                    placeholder="Your name"
                  />
                </div>

                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium mb-2 uppercase tracking-wide"
                  >
                    Email <span className="text-neon-pink">*</span>
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-bg-dark border border-white/10 rounded-xl text-white outline-none transition-all duration-300 focus:border-neon-pink focus:shadow-glow"
                    placeholder="your@email.com"
                  />
                </div>

                <div>
                  <label
                    htmlFor="phone"
                    className="block text-sm font-medium mb-2 uppercase tracking-wide"
                  >
                    Phone
                  </label>
                  <input
                    type="tel"
                    id="phone"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-bg-dark border border-white/10 rounded-xl text-white outline-none transition-all duration-300 focus:border-neon-pink focus:shadow-glow"
                    placeholder="(555) 123-4567"
                  />
                </div>

                <div>
                  <label
                    htmlFor="message"
                    className="block text-sm font-medium mb-2 uppercase tracking-wide"
                  >
                    Message <span className="text-neon-pink">*</span>
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    required
                    value={formData.message}
                    onChange={handleChange}
                    rows="5"
                    className="w-full px-4 py-3 bg-bg-dark border border-white/10 rounded-xl text-white outline-none transition-all duration-300 focus:border-neon-pink focus:shadow-glow resize-none"
                    placeholder="How can we help you?"
                  ></textarea>
                </div>

                <button
                  type="submit"
                  className="w-full py-4 bg-neon-pink text-white font-bold text-base rounded-xl cursor-pointer transition-all duration-300 ease-out uppercase tracking-wide hover:bg-[#e0006b] hover:shadow-glow-intense"
                >
                  Send Message
                </button>

                <div className="text-xs text-text-gray space-y-2 pt-2">
                  <p>
                    You may receive marketing and promotional materials. Contact
                    the merchant for their privacy practices.
                  </p>
                  <p>
                    This form is protected by reCAPTCHA and the Google{" "}
                    <a
                      href="https://policies.google.com/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-neon-pink hover:opacity-80 transition-opacity"
                    >
                      Privacy Policy
                    </a>{" "}
                    and{" "}
                    <a
                      href="https://policies.google.com/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-neon-pink hover:opacity-80 transition-opacity"
                    >
                      Terms of Service
                    </a>{" "}
                    apply.
                  </p>
                </div>
              </form>
            </div>

            {/* Location & Contact Info */}
            <div className="space-y-6">
              {/* Location & Hours Card */}
              <div className="bg-bg-card rounded-3xl p-8 lg:p-6 border border-white/5">
                <h2 className="font-bebas text-3xl mb-6 tracking-wide">
                  Location & Hours
                </h2>

                <div className="space-y-4 mb-6">
                  <h3 className="font-bebas text-2xl text-neon-pink">
                    Fair Dash
                  </h3>
                  <div className="space-y-2 text-text-gray">
                    <p>147 E Grove Ave</p>
                    <p>Collinsville, Illinois 62234</p>
                  </div>

                  <div className="space-y-1 text-text-gray">
                    <p className="flex items-center gap-2">
                      <FaPhone className="text-neon-pink" />
                      <a
                        href="tel:+18336065308"
                        className="hover:text-neon-pink transition-colors"
                      >
                        (833) 606-5308
                      </a>
                    </p>
                    <p className="flex items-center gap-2">
                      <FaEnvelope className="text-neon-pink" />
                      <a
                        href="mailto:fairdash217@gmail.com"
                        className="hover:text-neon-pink transition-colors"
                      >
                        fairdash217@gmail.com
                      </a>
                    </p>
                  </div>
                </div>

                <div className="border-t border-white/10 pt-6">
                  <h4 className="font-semibold text-lg mb-4">Hours</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <span className="text-text-gray">Monday</span>
                    <span className="text-right">Closed</span>
                    <span className="text-text-gray">Tuesday</span>
                    <span className="text-right">Closed</span>
                    <span className="text-text-gray">Wednesday</span>
                    <span className="text-right">Closed</span>
                    <span className="text-text-gray">Thursday</span>
                    <span className="text-right">Closed</span>
                    <span className="text-text-gray">Friday</span>
                    <span className="text-right text-neon-pink font-semibold">
                      12:00 PM - 8:45 PM
                    </span>
                    <span className="text-text-gray">Saturday</span>
                    <span className="text-right text-neon-pink font-semibold">
                      12:00 PM - 8:45 PM
                    </span>
                    <span className="text-text-gray">Sunday</span>
                    <span className="text-right">Closed</span>
                  </div>
                </div>
              </div>

              {/* Contact Methods */}
              <div className="grid grid-cols-2 gap-4">
                <a
                  href="tel:+18336065308"
                  className="bg-bg-card rounded-2xl p-6 border border-white/5 flex flex-col items-center justify-center gap-3 transition-all duration-300 ease-out hover:scale-[1.02] hover:border-neon-pink hover:shadow-glow group"
                >
                  <FaPhone className="text-4xl text-neon-pink" />
                  <span className="font-semibold text-sm text-center">
                    Call Us
                  </span>
                </a>

                <a
                  href="mailto:fairdash217@gmail.com"
                  className="bg-bg-card rounded-2xl p-6 border border-white/5 flex flex-col items-center justify-center gap-3 transition-all duration-300 ease-out hover:scale-[1.02] hover:border-neon-pink hover:shadow-glow group"
                >
                  <FaEnvelope className="text-4xl text-neon-pink" />
                  <span className="font-semibold text-sm text-center">
                    Email Us
                  </span>
                </a>

                <a
                  href="https://www.facebook.com/fairdash217"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-bg-card rounded-2xl p-6 border border-white/5 flex flex-col items-center justify-center gap-3 transition-all duration-300 ease-out hover:scale-[1.02] hover:border-neon-pink hover:shadow-glow group"
                >
                  <FaFacebookF className="text-4xl text-neon-pink" />
                  <span className="font-semibold text-sm text-center">
                    Facebook
                  </span>
                </a>

                <a
                  href="https://maps.google.com/?q=147+E+Grove+Ave+Collinsville+Illinois+62234"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-bg-card rounded-2xl p-6 border border-white/5 flex flex-col items-center justify-center gap-3 transition-all duration-300 ease-out hover:scale-[1.02] hover:border-neon-pink hover:shadow-glow group"
                >
                  <FaMapMarkerAlt className="text-4xl text-neon-pink" />
                  <span className="font-semibold text-sm text-center">
                    Directions
                  </span>
                </a>
              </div>

              {/* Payment Methods */}
              <div className="bg-bg-card rounded-3xl p-8 lg:p-6 border border-white/5">
                <h3 className="font-bebas text-2xl mb-5 tracking-wide text-neon-pink text-center">
                  We Accept
                </h3>
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
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Contact;
