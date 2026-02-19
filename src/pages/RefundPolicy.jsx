import { Link } from 'react-router-dom';
import { FaFacebookF, FaEnvelope, FaPhone } from 'react-icons/fa';

const RefundPolicy = () => {
  return (
    <div className="pt-20 min-h-screen">
      {/* Hero Section */}
      <section className="bg-[radial-gradient(circle_at_top_center,rgba(255,0,119,0.1),transparent_50%),#1a1a1a] py-16 lg:py-12 md:py-10 border-b border-white/10">
        <div className="max-w-[1400px] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4">
          <h1 className="font-bebas text-[clamp(3rem,6vw,5rem)] text-center mb-4 tracking-[2px]">
            <span className="text-neon-pink">Refund</span> Policy
          </h1>
        </div>
      </section>

      {/* Content */}
      <section className="py-16 lg:py-12 md:py-10">
        <div className="max-w-[800px] mx-auto px-[6%] lg:px-8 md:px-5 sm:px-4">
          <div className="bg-bg-card rounded-3xl p-10 lg:p-8 md:p-6 border border-white/5">
            <div className="space-y-6 text-text-gray leading-relaxed">
              <p className="text-lg">
                <strong className="text-white">All sales are final.</strong> If you have an issue, just reach out to us by email, Facebook, or text message.
              </p>

              <p className="text-lg">
                As a reminder, <strong className="text-white">Fair Dash is a delivery service</strong>. We aren't responsible for how your food is cooked or how it tastes.
              </p>

              <p className="text-lg">
                Have a question? Don't hesitate to contact our team—we're here to help!
              </p>
            </div>

            {/* Contact Methods */}
            <div className="mt-10 pt-8 border-t border-white/10">
              <h2 className="font-bebas text-2xl mb-6 tracking-wide text-center">Get In Touch</h2>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <a
                  href="mailto:fairdash217@gmail.com"
                  className="bg-bg-dark rounded-2xl p-6 border border-white/5 flex flex-col items-center justify-center gap-3 transition-all duration-300 ease-out hover:scale-[1.02] hover:border-neon-pink hover:shadow-glow"
                >
                  <FaEnvelope className="text-3xl text-neon-pink" />
                  <span className="font-semibold text-sm text-center">Email</span>
                  <span className="text-xs text-text-gray text-center break-all">fairdash217@gmail.com</span>
                </a>

                <a
                  href="https://facebook.com/fairdash"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-bg-dark rounded-2xl p-6 border border-white/5 flex flex-col items-center justify-center gap-3 transition-all duration-300 ease-out hover:scale-[1.02] hover:border-neon-pink hover:shadow-glow"
                >
                  <FaFacebookF className="text-3xl text-neon-pink" />
                  <span className="font-semibold text-sm text-center">Facebook</span>
                  <span className="text-xs text-text-gray text-center">Message us</span>
                </a>

                <a
                  href="tel:+18336065308"
                  className="bg-bg-dark rounded-2xl p-6 border border-white/5 flex flex-col items-center justify-center gap-3 transition-all duration-300 ease-out hover:scale-[1.02] hover:border-neon-pink hover:shadow-glow"
                >
                  <FaPhone className="text-3xl text-neon-pink" />
                  <span className="font-semibold text-sm text-center">Phone</span>
                  <span className="text-xs text-text-gray text-center">(833) 606-5308</span>
                </a>
              </div>

              <div className="text-center mt-8">
                <Link
                  to="/contact"
                  className="inline-block px-8 py-3 bg-transparent border-2 border-neon-pink text-neon-pink font-semibold uppercase cursor-pointer transition-all duration-300 ease-out rounded-xl text-sm tracking-wide shadow-glow hover:bg-neon-pink hover:text-white hover:shadow-glow-intense no-underline"
                >
                  Full Contact Page
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default RefundPolicy;
