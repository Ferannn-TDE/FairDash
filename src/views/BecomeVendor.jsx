import { useState } from "react";
import { Link } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import {
  BuildingStorefrontIcon,
  CheckIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  XMarkIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import toast from "react-hot-toast";

const STEPS = [
  { id: 1, label: "Business Info" },
  { id: 2, label: "Menu & Offerings" },
  { id: 3, label: "Terms" },
  { id: 4, label: "Confirmation" },
];

const VENDOR_TERMS = `FAIRSYNQ VENDOR AGREEMENT

Last Updated: January 1, 2026

This Vendor Agreement ("Agreement") is entered into between FairSynq LLC ("FairSynq," "we," or "us") and the vendor ("Vendor," "you") applying to participate on the FairSynq platform. By completing this application and clicking "I Agree," you accept the following terms and conditions in full.

1. VENDOR ELIGIBILITY
To become a FairSynq vendor, you must: (a) be a legally registered business or sole proprietor operating under applicable local and state law; (b) hold all required food handler permits, health department certifications, and business licenses for your jurisdiction; (c) maintain valid general liability insurance of at least $1,000,000 per occurrence; and (d) agree to operate within the designated FairSynq service area during scheduled fair events.

2. PLATFORM FEES & COMMISSIONS
FairSynq charges a commission of 7% on each completed order processed through the platform. This commission covers payment processing, platform maintenance, customer support, and driver dispatch services. Vendors will receive payment via ACH direct deposit within 3–5 business days after each event settlement period. FairSynq reserves the right to adjust commission rates with 30 days' written notice.

3. MENU & PRICING
Vendors are responsible for maintaining accurate, up-to-date menu listings including item names, descriptions, allergen information, and pricing. Prices listed on FairSynq must match or be lower than prices charged at your on-site booth. FairSynq may remove or flag menu items that violate health guidelines, contain misleading information, or are consistently reported as unavailable.

4. ORDER FULFILLMENT & QUALITY
You agree to: (a) prepare orders promptly and to the same quality standard as your on-site menu items; (b) notify FairSynq immediately if an item becomes unavailable so it may be temporarily removed from the platform; (c) package orders securely for delivery or curbside pickup; and (d) maintain a minimum order fulfillment rate of 95% per event. Repeated failures to meet this standard may result in account suspension.

5. FOOD SAFETY & COMPLIANCE
All food prepared and sold through FairSynq must comply with applicable food safety regulations, including proper temperature control, allergen labeling, and handling procedures. FairSynq reserves the right to conduct unannounced quality checks and may suspend vendor access pending investigation of any food safety complaint. Vendors indemnify FairSynq against any claims arising from foodborne illness or improper food handling.

6. CUSTOMER REVIEWS & RATINGS
FairSynq operates a public rating and review system. Vendors with an average rating below 3.5 stars over a 30-day rolling period may receive a performance notice. Continued low ratings may result in reduced platform visibility or account suspension. Vendors may not incentivize, solicit, or manipulate reviews in any way.

7. INTELLECTUAL PROPERTY
By submitting photos, menu descriptions, logos, and other materials to FairSynq, you grant FairSynq a non-exclusive, royalty-free, worldwide license to use, reproduce, and display such materials in connection with the FairSynq platform, marketing, and promotional activities. You retain ownership of your content and warrant that you have the right to grant this license.

8. TERMINATION
Either party may terminate this Agreement with 14 days' written notice. FairSynq may terminate immediately, without notice, for violations of this Agreement, fraudulent activity, repeated food safety complaints, or conduct that harms the FairSynq brand or customers. Upon termination, any outstanding payments will be settled within 14 business days.

9. LIMITATION OF LIABILITY
FairSynq's liability to you for any claim arising out of this Agreement shall not exceed the total commissions paid by you to FairSynq in the 30 days preceding the claim. FairSynq is not liable for loss of revenue, loss of data, or any indirect, incidental, or consequential damages.

10. GOVERNING LAW
This Agreement is governed by the laws of the State of Illinois, without regard to conflict of law principles. Any disputes shall be resolved by binding arbitration in Sangamon County, Illinois, under the rules of the American Arbitration Association.

11. MODIFICATIONS
FairSynq reserves the right to update this Agreement at any time. You will be notified of material changes via email or in-platform notification. Continued use of the FairSynq platform after notice of changes constitutes acceptance of the revised terms.

By checking "I agree to the Vendor Terms & Conditions," you confirm that you have read, understood, and agree to be bound by this Agreement.`;

const BecomeVendor = () => {
  const { user } = useUser();
  const [step, setStep] = useState(1);
  const [agreed, setAgreed] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [business, setBusiness] = useState({
    name: "",
    type: "",
    location: "",
    email: "",
    phone: "",
    website: "",
  });

  const [foodCategories, setFoodCategories] = useState([]);
  const [menuItems, setMenuItems] = useState([
    { id: 1, name: "", price: "", description: "", image: null, imagePreview: null },
  ]);

  const FOOD_CATEGORY_OPTIONS = ["Grilled & BBQ", "Fried Food", "Desserts & Sweets", "Drinks & Beverages", "Italian", "Fair Classics", "Vegan/Vegetarian", "Merchandise"];

  const toggleCategory = (cat) => {
    setFoodCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const addMenuItem = () => {
    setMenuItems((prev) => [
      ...prev,
      { id: prev.length + 1, name: "", price: "", description: "", image: null, imagePreview: null },
    ]);
  };

  const removeMenuItem = (id) => {
    if (menuItems.length > 1) {
      setMenuItems((prev) => prev.filter((item) => item.id !== id));
    }
  };

  const updateMenuItem = (id, field, value) => {
    setMenuItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const handleImageUpload = (id, file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setMenuItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, image: file, imagePreview: reader.result } : item
        )
      );
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    try {
      // Mark user as a vendor in Clerk metadata so the portal becomes accessible
      await user?.update({ unsafeMetadata: { isVendor: true } });
    } catch {
      // Non-fatal — portal link will appear after next sign-in if this fails
    }
    setSubmitted(true);
    setStep(4);
    toast.success("Application submitted! We'll be in touch within 2–3 business days.");
  };

  const canProceedStep1 = business.name.trim() && business.type && business.email.trim();
  const canProceedStep2 =
    menuItems.some((item) => item.name.trim() && item.price.trim()) &&
    foodCategories.length > 0;
  const canProceedStep3 = agreed;

  return (
    <div className="pt-20 min-h-screen pb-16">
      <div className="max-w-[700px] mx-auto px-[6%] md:px-5 py-10">

        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-neon-pink/10 border border-neon-pink/20 rounded-2xl mb-4">
            <BuildingStorefrontIcon className="w-8 h-8 text-neon-pink" />
          </div>
          <h1 className="font-bebas text-[clamp(2rem,5vw,3.5rem)] tracking-wide mb-2">
            Become a <span className="text-neon-pink">Vendor</span>
          </h1>
          <p className="text-text-gray text-base">
            Join the FairSynq marketplace and reach thousands of fair-goers.
          </p>
        </div>

        {/* Progress Bar */}
        {step < 4 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
              {STEPS.slice(0, 3).map((s, i) => (
                <div key={s.id} className="flex items-center flex-1">
                  <div className="flex flex-col items-center w-full">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 border-2 ${
                        step > s.id
                          ? "bg-neon-pink border-neon-pink text-white"
                          : step === s.id
                          ? "border-neon-pink text-neon-pink bg-neon-pink/10"
                          : "border-white/20 text-text-gray bg-white/5"
                      }`}
                    >
                      {step > s.id ? <CheckIcon className="w-4 h-4" /> : s.id}
                    </div>
                    <span className={`text-[0.625rem] uppercase tracking-wide mt-1 font-semibold hidden sm:block text-center ${step >= s.id ? "text-white" : "text-text-gray"}`}>
                      {s.label}
                    </span>
                  </div>
                  {i < 2 && (
                    <div className={`flex-1 h-0.5 mx-2 transition-colors duration-300 ${step > s.id ? "bg-neon-pink" : "bg-white/10"}`} />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 1: Business Info */}
        {step === 1 && (
          <div className="bg-bg-card border border-white/10 rounded-2xl p-7 animate-fadeIn">
            <h2 className="font-bebas text-2xl tracking-wide mb-6 text-white">Business Information</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                    Business Name <span className="text-neon-pink">*</span>
                  </label>
                  <input
                    type="text"
                    value={business.name}
                    onChange={(e) => setBusiness((b) => ({ ...b, name: e.target.value }))}
                    className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40"
                    placeholder="Big Bob's Corn Dogs"
                  />
                </div>
                <div>
                  <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                    Business Type <span className="text-neon-pink">*</span>
                  </label>
                  <select
                    value={business.type}
                    onChange={(e) => setBusiness((b) => ({ ...b, type: e.target.value }))}
                    className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors cursor-pointer appearance-none"
                  >
                    <option value="" disabled>Select type...</option>
                    <option value="food">Food & Beverage</option>
                    <option value="dessert">Desserts & Sweets</option>
                    <option value="drinks">Drinks & Beverages</option>
                    <option value="merchandise">Merchandise</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                  Booth / Stand Location (if known)
                </label>
                <input
                  type="text"
                  value={business.location}
                  onChange={(e) => setBusiness((b) => ({ ...b, location: e.target.value }))}
                  className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40"
                  placeholder="e.g. Midway Row, Booth 12"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                    Contact Email <span className="text-neon-pink">*</span>
                  </label>
                  <input
                    type="email"
                    value={business.email}
                    onChange={(e) => setBusiness((b) => ({ ...b, email: e.target.value }))}
                    className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40"
                    placeholder="hello@yourbusiness.com"
                  />
                </div>
                <div>
                  <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={business.phone}
                    onChange={(e) => setBusiness((b) => ({ ...b, phone: e.target.value }))}
                    className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40"
                    placeholder="(555) 000-0000"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                  Website / Social (optional)
                </label>
                <input
                  type="url"
                  value={business.website}
                  onChange={(e) => setBusiness((b) => ({ ...b, website: e.target.value }))}
                  className="w-full bg-bg-dark border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40"
                  placeholder="https://yourbusiness.com"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Menu & Offerings */}
        {step === 2 && (
          <div className="bg-bg-card border border-white/10 rounded-2xl p-7 animate-fadeIn">
            <h2 className="font-bebas text-2xl tracking-wide mb-1 text-white">Menu & Offerings</h2>
            <p className="text-text-gray text-sm mb-6">Tell us about your delicious menu items.</p>

            {/* Food Categories */}
            <div className="mb-6">
              <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-2">
                Food Categories <span className="text-neon-pink">*</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {FOOD_CATEGORY_OPTIONS.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => toggleCategory(cat)}
                    className={`px-4 py-2 rounded-full text-sm font-medium border cursor-pointer transition-all duration-200 ${
                      foodCategories.includes(cat)
                        ? "bg-neon-pink border-neon-pink text-white active:scale-[0.97]"
                        : "bg-white/5 border-white/10 text-text-gray hover:border-white/20 hover:text-white active:scale-[0.97]"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Menu Items */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bebas text-lg tracking-wide text-white">Menu Items</h3>
                <span className="text-xs text-text-gray">At least 1 item required</span>
              </div>

              {menuItems.map((item, index) => (
                <div key={item.id} className="bg-bg-dark border border-white/10 rounded-xl p-5">
                  {/* Item header */}
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-white font-semibold text-sm">Item {index + 1}</h4>
                    {menuItems.length > 1 && (
                      <button
                        onClick={() => removeMenuItem(item.id)}
                        className="flex items-center gap-1 text-text-gray hover:text-red-400 transition-colors text-xs font-medium bg-transparent border-0 cursor-pointer"
                      >
                        <XMarkIcon className="w-3.5 h-3.5" />
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="space-y-4">
                    {/* Name & Price */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                          Item Name <span className="text-neon-pink">*</span>
                        </label>
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) => updateMenuItem(item.id, "name", e.target.value)}
                          className="w-full bg-bg-card border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40"
                          placeholder="e.g., BBQ Pulled Pork Sandwich"
                        />
                      </div>
                      <div>
                        <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                          Price <span className="text-neon-pink">*</span>
                        </label>
                        <div className="relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text-gray text-sm">$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={item.price}
                            onChange={(e) => updateMenuItem(item.id, "price", e.target.value)}
                            className="w-full bg-bg-card border border-white/10 rounded-xl pl-8 pr-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40"
                            placeholder="8.00"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Description */}
                    <div>
                      <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                        Description
                      </label>
                      <textarea
                        value={item.description}
                        onChange={(e) => updateMenuItem(item.id, "description", e.target.value)}
                        className="w-full bg-bg-card border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-neon-pink transition-colors placeholder:text-text-gray/40 resize-none h-20"
                        placeholder="Describe your item, ingredients, or what makes it special..."
                      />
                    </div>

                    {/* Image Upload */}
                    <div>
                      <label className="block text-[0.6875rem] uppercase tracking-wide text-text-gray font-semibold mb-1.5">
                        Item Image
                      </label>
                      {!item.imagePreview ? (
                        <label className="flex flex-col items-center justify-center w-full h-28 bg-bg-card border-2 border-dashed border-white/10 rounded-xl cursor-pointer hover:border-neon-pink/30 hover:bg-white/[0.02] transition-all group">
                          <svg className="w-7 h-7 mx-auto mb-1.5 text-text-gray group-hover:text-neon-pink transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <p className="text-sm text-text-gray group-hover:text-white transition-colors">
                            <span className="text-neon-pink font-semibold">Click to upload</span> or drag and drop
                          </p>
                          <p className="text-xs text-text-gray/60 mt-1">PNG, JPG up to 5MB</p>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleImageUpload(item.id, e.target.files[0])}
                            className="hidden"
                          />
                        </label>
                      ) : (
                        <div className="relative">
                          <img
                            src={item.imagePreview}
                            alt="Preview"
                            className="w-full h-28 object-cover rounded-xl border border-white/10"
                          />
                          <button
                            onClick={() => {
                              updateMenuItem(item.id, "image", null);
                              updateMenuItem(item.id, "imagePreview", null);
                            }}
                            className="absolute top-2 right-2 p-1.5 bg-bg-dark/90 border border-white/10 rounded-lg text-text-gray hover:text-red-400 hover:border-red-400/30 transition-colors cursor-pointer"
                          >
                            <XMarkIcon className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* Add Item Button */}
              <button
                onClick={addMenuItem}
                className="w-full py-3 bg-white/[0.03] border-2 border-dashed border-white/10 rounded-xl text-white font-semibold text-sm hover:border-neon-pink/30 hover:bg-white/[0.06] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <PlusIcon className="w-4 h-4 text-neon-pink" />
                Add Another Menu Item
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Terms & Conditions */}
        {step === 3 && (
          <div className="bg-bg-card border border-white/10 rounded-2xl p-7 animate-fadeIn">
            <h2 className="font-bebas text-2xl tracking-wide mb-2 text-white">Terms & Conditions</h2>
            <p className="text-text-gray text-sm mb-4">Please read the full vendor agreement before proceeding.</p>
            <div className="h-64 overflow-y-auto bg-bg-dark border border-white/10 rounded-xl p-5 mb-5 text-text-gray text-[0.8125rem] leading-relaxed whitespace-pre-line">
              {VENDOR_TERMS}
            </div>
            <label className="flex items-start gap-3 cursor-pointer group">
              <button
                onClick={() => setAgreed((a) => !a)}
                className={`mt-0.5 w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-all duration-200 cursor-pointer bg-transparent ${
                  agreed ? "bg-neon-pink border-neon-pink" : "border-white/20 group-hover:border-white/40"
                }`}
              >
                {agreed && <CheckIcon className="w-3 h-3 text-white" />}
              </button>
              <span className="text-sm text-text-gray leading-relaxed">
                I have read and agree to the{" "}
                <span className="text-neon-pink font-semibold">Vendor Terms & Conditions</span>{" "}
                outlined above. I understand that FairSynq charges a 7% commission on all orders.
              </span>
            </label>
          </div>
        )}

        {/* Step 4: Confirmation */}
        {step === 4 && (
          <div className="bg-bg-card border border-white/10 rounded-2xl p-10 text-center animate-fadeIn">
            <div className="w-20 h-20 bg-neon-pink/10 border border-neon-pink/30 rounded-full flex items-center justify-center mx-auto mb-5">
              <CheckIcon className="w-10 h-10 text-neon-pink" />
            </div>
            <h2 className="font-bebas text-[2rem] tracking-wide text-white mb-2">Application Submitted!</h2>
            <p className="text-text-gray text-base mb-2">
              Thanks for applying to become a FairSynq vendor, <strong className="text-white">{business.name || "your business"}</strong>.
            </p>
            <p className="text-text-gray text-sm mb-8">
              Our team will review your application and reach out to{" "}
              <span className="text-neon-pink">{business.email}</span>{" "}
              within 2–3 business days.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                to="/vendor/dashboard"
                className="px-8 py-3 bg-neon-pink text-white rounded-xl font-semibold text-sm hover:bg-[#e0006b] active:scale-[0.97] transition-all duration-200 no-underline shadow-[0_4px_12px_rgba(255,0,119,0.3)]"
              >
                Go to Vendor Portal
              </Link>
              <Link
                to="/home"
                className="px-8 py-3 bg-white/5 border border-white/10 text-white rounded-xl font-semibold text-sm hover:bg-white/10 active:scale-[0.97] transition-all duration-200 no-underline"
              >
                Back to Home
              </Link>
            </div>
          </div>
        )}

        {/* Navigation Buttons */}
        {step < 4 && (
          <div className="flex justify-between mt-6">
            {step > 1 ? (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="flex items-center gap-2 px-6 py-3 bg-white/5 border border-white/10 text-white rounded-xl font-semibold text-sm hover:bg-white/10 active:scale-[0.97] transition-all duration-200 cursor-pointer"
              >
                <ChevronLeftIcon className="w-4 h-4" />
                Back
              </button>
            ) : (
              <Link
                to="/home"
                className="flex items-center gap-2 px-6 py-3 bg-white/5 border border-white/10 text-text-gray rounded-xl font-semibold text-sm hover:bg-white/10 active:scale-[0.97] transition-all duration-200 no-underline"
              >
                Cancel
              </Link>
            )}

            {step < 3 ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                disabled={step === 1 ? !canProceedStep1 : !canProceedStep2}
                className="flex items-center gap-2 px-6 py-3 bg-neon-pink text-white rounded-xl font-semibold text-sm hover:bg-[#e0006b] active:scale-[0.97] transition-all duration-200 cursor-pointer border-0 shadow-[0_4px_12px_rgba(255,0,119,0.3)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-neon-pink disabled:active:scale-100"
              >
                Next
                <ChevronRightIcon className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!canProceedStep3}
                className="flex items-center gap-2 px-6 py-3 bg-neon-pink text-white rounded-xl font-semibold text-sm hover:bg-[#e0006b] active:scale-[0.97] transition-all duration-200 cursor-pointer border-0 shadow-[0_4px_12px_rgba(255,0,119,0.3)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-neon-pink disabled:active:scale-100"
              >
                Submit Application
                <CheckIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  );
};

export default BecomeVendor;
